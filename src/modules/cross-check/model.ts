/**
 * G08 — Adaptador puro del panel «Coherencia cruzada entre herramientas» (docs/decisiones/0092).
 *
 * Sin React, sin stores ni `src/app/`: extrae las salidas vigentes de `Well` + `Interpretation` + `ClientResult`
 * (ya preparado cuando corresponde), delega la auditoría matemática en `src/petro/crossCheck.ts` y produce
 * resúmenes ligeros para el Informe HTML y `chatContext` sin retener arreglos del motor.
 */
import type { ClientResult } from '../../core/engine/client';
import type { Interpretation } from '../../core/interpretation';
import { resolveParamsForModule, type TableValue } from '../../core/module';
import type { Registry } from '../../core/registry';
import type { Well } from '../../core/well';
import {
  CROSS_CHECK_META,
  CROSS_CHECK_STATUS_LABEL,
  ZONE_CHECK_IDS,
  evaluateCrossCheck,
  type CrossCheckCorePlug,
  type CrossCheckItem,
  type CrossCheckReport,
  type CrossCheckSealSample,
  type CrossCheckStatus,
  type CrossCheckWaterContact,
  type ZoneCheckId,
} from '../../petro/crossCheck';
import { fitThomeer } from '../../petro/micp';
import { SW_BELOW_SWI_TOLERANCE } from '../../petro/swiPc';
import { coreSets } from '../core/model';
import { calibWindow, includedPlugs, porosityCalibration } from '../core-calibration/model';
import { mdtAnalysis } from '../mdt/series';
import {
  MICP_ID,
  RESERVOIR_SYSTEMS,
  cmrConclusion,
  cmrRows,
  heightContext,
  micpSamples,
  readMicpSettings,
} from '../micp/model';
import { SWI_PC_ID, SWI_ZONES } from '../swi-pc/index';
import { CROSS_CHECK_ID } from './index';

export { CROSS_CHECK_ID };
export const CROSS_CHECK_DOCK_ID = CROSS_CHECK_ID;

/** Roles cuyas curvas medidas pueden venir en % y deben normalizarse a v/v. */
const FRACTION_ROLES = new Set(['PHIE', 'PHIE_NMR', 'BVI_NMR', 'SW', 'SWI', 'BVW', 'VSH', 'MOS']);

/** Resuelve el arreglo de datos de un puerto desde las salidas activas del motor o las curvas medidas del pozo. */
function resolvePortCurve(well: Readonly<Well>, result: ClientResult | null, port: string): Float64Array | null {
  const n = well.depth.values.length;
  const current = result?.wellId === well.id ? result : null;
  const src = current?.sources[port];
  if (src?.kind === 'module') {
    const out =
      current!.outputs.find((o) => o.kind === 'curve' && o.port === port && o.moduleId === src.moduleId) ??
      current!.outputs.find((o) => o.kind === 'curve' && o.port === port && o.active);
    if (out && out.value instanceof Float64Array && out.value.length === n) return out.value;
  } else if (src?.kind === 'curve') {
    const c = well.curves.find((x) => x.id === src.curveId && x.data.length === n);
    if (c) return FRACTION_ROLES.has(port) && c.unit === '%' ? Float64Array.from(c.data, (v) => v / 100) : c.data;
  }
  const active = current?.outputs.find((o) => o.kind === 'curve' && o.active && o.port === port);
  if (active && active.value instanceof Float64Array && active.value.length === n) return active.value;
  const measured = well.curves.find((x) => x.role === port && x.data.length === n);
  if (measured) return FRACTION_ROLES.has(port) && measured.unit === '%' ? Float64Array.from(measured.data, (v) => v / 100) : measured.data;
  return null;
}

/** Primera presión de entrada medida (respaldo si el ajuste de Thomeer no converge en una curva MICP). */
function fallbackEntryPdPsi(pcPsi: ArrayLike<number>, sw: ArrayLike<number>): number {
  const n = Math.min(pcPsi.length, sw.length);
  for (let i = 0; i < n; i++) {
    const p = pcPsi[i]!;
    const s = sw[i]!;
    if (Number.isFinite(p) && p > 0 && Number.isFinite(s) && s < 0.99) return p;
  }
  return NaN;
}

/** Arma la auditoría completa de coherencia cruzada a partir del pozo efectivo, su interpretación y resultado vigente. */
export function buildCrossCheckReport(
  well: Readonly<Well>,
  interpretation: Readonly<Interpretation>,
  result: ClientResult | null,
  catalog?: Registry,
): CrossCheckReport {
  const current = result?.wellId === well.id ? result : null;
  const depth = well.depth.values;
  const zones = interpretation.zones;

  const sw = resolvePortCurve(well, current, 'SW');
  const swi = resolvePortCurve(well, current, 'SWI');
  const bvw = resolvePortCurve(well, current, 'BVW');
  const bviNmr = resolvePortCurve(well, current, 'BVI_NMR');
  const phie = resolvePortCurve(well, current, 'PHIE');
  const phieNmr = resolvePortCurve(well, current, 'PHIE_NMR');
  const vsh = resolvePortCurve(well, current, 'VSH');
  const netRes = resolvePortCurve(well, current, 'NET_RES');
  const netPay = resolvePortCurve(well, current, 'NET_PAY');
  const indWashout = resolvePortCurve(well, current, 'IND_WASHOUT');
  const indNmrDeficit = resolvePortCurve(well, current, 'IND_NMR_DEFICIT');
  const uGrFrac = resolvePortCurve(well, current, 'U_GR_FRAC');
  const mos = resolvePortCurve(well, current, 'MOS');
  const mhi = resolvePortCurve(well, current, 'MHI');

  // Tolerancia efectiva y % fuera de rango SCAL por zona.
  let swiToleranceGlobal = SW_BELOW_SWI_TOLERANCE;
  const swiToleranceByZone = new Map<string, number>();
  const swiMod = catalog?.get(SWI_PC_ID);
  if (swiMod) {
    const resolved = resolveParamsForModule(swiMod, interpretation.params, zones.map((z) => z.id));
    const gTol = resolved.global['tolerance'];
    if (typeof gTol === 'number' && Number.isFinite(gTol)) swiToleranceGlobal = gTol;
    for (const z of zones) {
      const zTol = resolved.byZone.get(z.id)?.['tolerance'];
      if (typeof zTol === 'number' && Number.isFinite(zTol)) swiToleranceByZone.set(z.id, zTol);
    }
  }
  const swiOutOfRangePctByZone = new Map<string, number>();
  const swiLevelByZone = new Map<string, string>();
  const swiTable = current?.outputs.find((o) => o.kind === 'table' && o.active && o.port === SWI_ZONES);
  if (swiTable && swiTable.kind === 'table') {
    for (const row of (swiTable.value as TableValue).rows) {
      const id = typeof row.zoneId === 'string' ? row.zoneId : '';
      const pct = typeof row.pctOutRange === 'number' && Number.isFinite(row.pctOutRange) ? row.pctOutRange : null;
      const lvl = typeof row.level === 'string' && row.level.trim() ? row.level.trim() : null;
      if (id && pct !== null) swiOutOfRangePctByZone.set(id, pct);
      if (id && lvl) swiLevelByZone.set(id, lvl);
    }
  }

  // Plugs de corona incluidos y emparejados con PHIE.
  const corePlugs: CrossCheckCorePlug[] = [];
  if (phie) {
    for (const set of coreSets(well.pointSets)) {
      const dec = interpretation.pointSets[set.id];
      const plugs = includedPlugs(set, dec);
      const cal = porosityCalibration(set, dec, depth, phie, calibWindow(dec));
      if (!cal) continue;
      for (let j = 0; j < cal.core.length; j++) {
        const d = plugs.depth[j]!;
        const pc = cal.core[j]!;
        const pl = cal.log[j]!;
        if (Number.isFinite(d) && Number.isFinite(pc) && Number.isFinite(pl)) {
          corePlugs.push({ depthM: d, phiCore: pc, phiLog: pl });
        }
      }
    }
  }

  // Contactos de agua válidos resueltos en MDT.
  const mdt = mdtAnalysis(well as Well, interpretation as Interpretation);
  const waterContacts: CrossCheckWaterContact[] = [];
  for (const c of mdt.contacts) {
    if (c.depth === null || !Number.isFinite(c.depth) || (c.kind !== 'OWC' && c.kind !== 'GWC')) continue;
    waterContacts.push({
      kind: c.kind,
      depthM: c.depth,
      spanTopM: Math.min(c.upper.span[0], c.lower.span[0]),
      spanBaseM: Math.max(c.upper.span[1], c.lower.span[1]),
      warning: c.warning,
      label: `${c.upper.name} / ${c.lower.name}`,
    });
  }

  // MICP: supuestos vigentes, presiones de desplazamiento Pd y cociente CMR/MICP.
  const micpSettings = readMicpSettings(interpretation.moduleState?.[MICP_ID]);
  const hCtx = heightContext(micpSettings);
  const sysDef = RESERVOIR_SYSTEMS.find((r) => r.id === micpSettings.system) ?? RESERVOIR_SYSTEMS[0]!;
  const mSamples = micpSamples(well.pointSets);
  const sealSamples: CrossCheckSealSample[] = [];
  for (const s of mSamples) {
    const th = fitThomeer(s.pcPsi, s.sw, s.phi);
    const pdLabPsi = th ? th.pd : fallbackEntryPdPsi(s.pcPsi, s.sw);
    if (!Number.isFinite(pdLabPsi) || pdLabPsi <= 0) continue;
    const zMatch = Number.isFinite(s.depthM)
      ? zones.find((z) => s.depthM >= Math.min(z.top, z.base) && s.depthM <= Math.max(z.top, z.base))
      : undefined;
    sealSamples.push({
      id: s.id,
      label: s.label,
      depthM: s.depthM,
      pdLabPsi,
      source: 'micp',
      isSeal: zMatch?.kind === 'seal',
      zoneName: zMatch?.name ?? null,
    });
  }

  const micpCmrRatioRange =
    mSamples.length > 0 && bviNmr && phieNmr
      ? cmrConclusion(cmrRows(depth, bviNmr, phieNmr, mSamples, hCtx))?.ratio ?? null
      : null;

  // Altura de columna observada para contrastar contra h_max del sello.
  let payTop = Infinity;
  let payBase = -Infinity;
  if (netPay) {
    for (let i = 0; i < depth.length; i++) {
      if (netPay[i] === 1 && Number.isFinite(depth[i]!)) {
        const d = depth[i]!;
        if (d < payTop) payTop = d;
        if (d > payBase) payBase = d;
      }
    }
  }
  let observedColumnM: number | null = null;
  let columnBasis: string | null = null;
  if (Number.isFinite(payTop)) {
    const contactBelow = waterContacts.filter((c) => c.depthM > payTop).sort((a, b) => a.depthM - b.depthM)[0];
    if (contactBelow) {
      observedColumnM = contactBelow.depthM - payTop;
      columnBasis = `tope de pay a ${contactBelow.kind} MDT`;
    } else if (micpSettings.fwlM !== null && micpSettings.fwlM > payTop) {
      observedColumnM = micpSettings.fwlM - payTop;
      columnBasis = 'tope de pay a FWL del panel MICP';
    } else if (zones.length > 0 && netPay) {
      // Sin FWL confirmado: acotar a la mayor columna de pay dentro de una misma zona no sello (sin cruzar sellos intermedios).
      let maxZoneCol = 0;
      let bestZoneName = '';
      for (const z of zones) {
        if (z.kind === 'seal') continue;
        const lo = Math.min(z.top, z.base);
        const hi = Math.max(z.top, z.base);
        let zTop = Infinity;
        let zBase = -Infinity;
        for (let i = 0; i < depth.length; i++) {
          const d = depth[i]!;
          if (Number.isFinite(d) && d >= lo && d <= hi && netPay[i] === 1) {
            if (d < zTop) zTop = d;
            if (d > zBase) zBase = d;
          }
        }
        if (Number.isFinite(zTop) && Number.isFinite(zBase) && zBase > zTop && zBase - zTop > maxZoneCol) {
          maxZoneCol = zBase - zTop;
          bestZoneName = z.name;
        }
      }
      if (maxZoneCol > 0) {
        observedColumnM = maxZoneCol;
        columnBasis = `mayor rango vertical con pay en zona ${bestZoneName} (sin FWL confirmado)`;
      }
    } else if (Number.isFinite(payBase) && payBase > payTop) {
      observedColumnM = payBase - payTop;
      columnBasis = 'rango vertical con pay neto (sin FWL confirmado)';
    }
  }

  const igrSrc = current?.sources['IGR'];
  const igrUsesCgr = igrSrc?.kind === 'module' && igrSrc.moduleId === 'igr-cgr';

  return evaluateCrossCheck({
    depth,
    zones: zones.map((z) => ({ id: z.id, name: z.name, top: z.top, base: z.base, kind: z.kind })),
    curves: {
      sw,
      swi,
      bvw,
      bviNmr,
      phie,
      phieNmr,
      vsh,
      netRes,
      netPay,
      indWashout,
      indNmrDeficit,
      uGrFrac,
      mos,
      mhi,
    },
    swiToleranceGlobal,
    swiToleranceByZone,
    swiOutOfRangePctByZone,
    swiLevelByZone,
    corePlugs,
    waterContacts,
    sealSamples,
    sealAssumptions: {
      systemLabel: sysDef.label,
      heightContext: hCtx,
      rhoWaterGcc: micpSettings.rhoWater,
      rhoHcGcc: micpSettings.rhoHc,
    },
    micpCmrRatioRange,
    observedColumnM,
    columnBasis,
    igrUsesCgr,
    hasMicp: mSamples.length > 0,
  });
}

// ── copia ligera para Informe HTML y chatContext (sin referencias a Float64Array) ───────────────────────────────

export interface CrossCheckCellSummary {
  status: CrossCheckStatus;
  headline: string;
}

export interface CrossCheckFindingSummary {
  zoneName: string;
  checkTitle: string;
  status: CrossCheckStatus;
  headline: string;
  detail: string;
}

export interface CrossCheckReportSummary {
  overallStatus: CrossCheckStatus;
  counts: Readonly<Record<CrossCheckStatus, number>>;
  zones: readonly {
    zoneName: string;
    worstStatus: CrossCheckStatus;
    cells: Readonly<Record<ZoneCheckId, CrossCheckCellSummary>>;
  }[];
  seal: CrossCheckFindingSummary;
  /** Hallazgos en tensión o atención, ordenados por gravedad (primero tensiones). */
  highlights: readonly CrossCheckFindingSummary[];
}

export function summarizeCrossCheckForReport(report: CrossCheckReport): CrossCheckReportSummary {
  const highlights: CrossCheckFindingSummary[] = [];
  const collect = (item: CrossCheckItem) => {
    if (item.status === 'tension' || item.status === 'warn') {
      highlights.push({
        zoneName: item.zoneName,
        checkTitle: CROSS_CHECK_META[item.id].shortTitle,
        status: item.status,
        headline: item.headline,
        detail: item.detail,
      });
    }
  };
  const zones = report.zones.map((z) => {
    const cells = {} as Record<ZoneCheckId, CrossCheckCellSummary>;
    for (const id of ZONE_CHECK_IDS) {
      const it = z.checks[id];
      cells[id] = { status: it.status, headline: it.headline };
      collect(it);
    }
    return { zoneName: z.zoneName, worstStatus: z.worstStatus, cells };
  });
  collect(report.seal);
  highlights.sort((a, b) => (a.status === b.status ? 0 : a.status === 'tension' ? -1 : 1));

  return {
    overallStatus: report.overallStatus,
    counts: { ...report.counts },
    zones,
    seal: {
      zoneName: report.seal.zoneName,
      checkTitle: CROSS_CHECK_META['seal-capacity'].title,
      status: report.seal.status,
      headline: report.seal.headline,
      detail: report.seal.detail,
    },
    highlights,
  };
}

const REPORT_BADGE_STYLE: Readonly<Record<CrossCheckStatus, string>> = {
  ok: 'background:#e6f4ea;color:#137333;border:1px solid #b7dfbf',
  warn: 'background:#fef7e0;color:#8a5300;border:1px solid #f4d37d',
  tension: 'background:#fce8e6;color:#b3261e;border:1px solid #f1b5b0',
  unsupported: 'background:#f1f3f5;color:#59667a;border:1px solid #d5dce4',
};

/** Sección HTML autónoma de coherencia cruzada para el Informe imprimible. */
export function crossCheckReportHtml(data: CrossCheckReportSummary, escape: (s: unknown) => string): string {
  const badge = (s: CrossCheckStatus) =>
    `<span style="display:inline-block;padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;${REPORT_BADGE_STYLE[s]}">${escape(CROSS_CHECK_STATUS_LABEL[s])}</span>`;
  const countsText = `Acuerdo: ${data.counts.ok} · Atención: ${data.counts.warn} · Tensión: ${data.counts.tension} · Sin soporte: ${data.counts.unsupported}`;
  const headCells = ZONE_CHECK_IDS.map((id) => `<th>${escape(CROSS_CHECK_META[id].shortTitle)}</th>`).join('');
  const bodyRows = data.zones
    .map(
      (z) =>
        `<tr><td><strong>${escape(z.zoneName)}</strong></td>${ZONE_CHECK_IDS.map((id) => {
          const c = z.cells[id];
          return `<td>${badge(c.status)}<br><small>${escape(c.headline)}</small></td>`;
        }).join('')}</tr>`,
    )
    .join('');

  const highlightItems = data.highlights
    .map((h) => `<li>${badge(h.status)} <strong>${escape(h.zoneName)} · ${escape(h.checkTitle)}:</strong> ${escape(h.detail)}</li>`)
    .join('');

  return `<section><h2>Coherencia cruzada entre herramientas</h2><p class="meta">Estado general: ${escape(CROSS_CHECK_STATUS_LABEL[data.overallStatus])} · ${escape(countsText)}. Los umbrales son criterios operativos de auditoría (ADR 0092), no leyes universales.</p><div class="table-wrap"><table><thead><tr><th>Zona</th>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table></div><p><strong>Capacidad de sello vs. columna:</strong> ${badge(data.seal.status)} ${escape(data.seal.detail)}</p>${highlightItems ? `<h3>Hallazgos principales</h3><ul>${highlightItems}</ul>` : '<p>No se detectaron tensiones ni advertencias entre las herramientas con soporte.</p>'}</section>`;
}

const chatZoneLabel = (name: string) => (/^(?:zona|pozo)\b/i.test(name) ? name : `Zona ${name}`);

/** Líneas en texto plano compacto para `chatContext` (sin HTML ni ecuaciones). */
export function crossCheckChatLines(
  data: CrossCheckReportSummary,
  detail: 'full' | 'compact' = 'full',
  maxHighlights = 3,
): string[] {
  const out: string[] = [
    '## Coherencia cruzada entre herramientas',
    `- Estado general: ${CROSS_CHECK_STATUS_LABEL[data.overallStatus]} (acuerdo ${data.counts.ok}, atención ${data.counts.warn}, tensión ${data.counts.tension}, sin soporte ${data.counts.unsupported}; umbrales operativos, ADR 0092).`,
    `- Capacidad de sello: [${CROSS_CHECK_STATUS_LABEL[data.seal.status]}] ${data.seal.headline}`,
  ];
  if (detail === 'compact') {
    const flagged = data.zones
      .map((z) => {
        const bad = ZONE_CHECK_IDS.filter((id) => z.cells[id].status === 'tension' || z.cells[id].status === 'warn').map(
          (id) => `${CROSS_CHECK_META[id].shortTitle} ${CROSS_CHECK_STATUS_LABEL[z.cells[id].status].toLowerCase()}`,
        );
        return bad.length ? `${chatZoneLabel(z.zoneName)} (${bad.join(', ')})` : null;
      })
      .filter((x): x is string => x !== null);
    if (flagged.length) out.push(`- Alertas por zona: ${flagged.join(' · ')}`);
    return out;
  }
  for (const z of data.zones) {
    const items = ZONE_CHECK_IDS.filter((id) => z.cells[id].status !== 'unsupported').map((id) => {
      const c = z.cells[id];
      return `${CROSS_CHECK_META[id].shortTitle} ${CROSS_CHECK_STATUS_LABEL[c.status].toLowerCase()} (${c.headline})`;
    });
    const unsupportedCount = ZONE_CHECK_IDS.length - items.length;
    if (unsupportedCount > 0) items.push(`${unsupportedCount} sin soporte`);
    out.push(`- ${chatZoneLabel(z.zoneName)}: ${items.join(' · ')}`);
  }
  const top = data.highlights.slice(0, maxHighlights);
  for (const h of top) {
    out.push(`- [${CROSS_CHECK_STATUS_LABEL[h.status]}] ${h.zoneName} · ${h.checkTitle}: ${h.headline}`);
  }
  if (data.highlights.length > top.length) {
    out.push(`- … (+${data.highlights.length - top.length} alertas adicionales en el panel Coherencia)`);
  }
  return out;
}
