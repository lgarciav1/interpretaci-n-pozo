/**
 * Módulo de sensibilidad a los cutoffs — barrido de cada corte (Vsh, φ, Sw) con los otros dos fijos. Ver 0007, C20,
 * D5 y D6. Produce una tabla oculta (`CUTOFF_SWEEP`) que dibuja su panel a medida (`panel.tsx`).
 *
 * Filas: para cada variable, para cada intervalo (las zonas en orden y el «Total», o «Pozo completo» sin zonas),
 * `steps` umbrales de la grilla fija de la variable y UNA fila más con `current = 1`, evaluada exactamente en el
 * cutoff vigente del intervalo (en el Total, cada zona con el suyo). Esa fila coincide con el sumario y el
 * volumétrico sin depender de que el cutoff caiga sobre la grilla.
 * Datos faltantes (D6): una zona sin ninguna muestra clasificada con sus cutoffs vigentes queda «sin dato» (nulos); el
 * pay de una zona o del total es nulo si hay reservorio pero ninguna muestra de reservorio tiene Sw. `noDataPay` es el
 * espesor de reservorio sin Sw (se suma lo conocido).
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { netReservoirFlagK, type Cutoffs } from '../../petro/cutoffs';
import { cutoffSweep, sweepThresholds, type SweepCurves, type SweepGrid, type SweepVariable } from '../../petro/sensitivity';
import { zoneInPlace } from '../../petro/volumetrics';
import { SHARED_PARAMS } from '../sharedParams';

/** Grillas fijas de cada variable (v/v), en el orden en que se publican. */
export const SWEEP_GRIDS: Readonly<Record<SweepVariable, { min: number; max: number }>> = {
  vsh: { min: 0, max: 1 },
  phi: { min: 0, max: 0.4 },
  sw: { min: 0, max: 1 },
};
const VARIABLES: readonly SweepVariable[] = ['vsh', 'phi', 'sw'];
const CUTOFF_KEY = { vsh: 'vshMax', phi: 'phiMin', sw: 'swMax' } as const satisfies Record<SweepVariable, keyof Cutoffs>;

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

/** Grilla de dos umbrales cuyo primero es exactamente `c` (t₀ = min): evalúa el barrido en el cutoff vigente. */
const exactGrid = (c: number): SweepGrid => ({ min: c, max: c + 1, steps: 2 });

export default defineModule({
  id: 'cutoff-sensitivity',
  name: 'Sensibilidad a los cutoffs',
  description: 'Cuánto cambian el espesor neto pay y el volumen in situ al mover cada cutoff, con los otros dos fijos.',
  category: 'cutoffs',
  workspace: 'petrophysics',
  inputs: {
    vsh: input.curve('VSH'),
    phi: input.curve('PHIE'),
    sw: input.curve('SW'),
    perm: input.optionalCurve('PERM', { label: 'Permeabilidad (solo para el corte de k)' }),
  },
  params: {
    vshCutoff: SHARED_PARAMS.vshCutoff,
    phiCutoff: SHARED_PARAMS.phiCutoff,
    swCutoff: SHARED_PARAMS.swCutoff,
    permCutoffOn: SHARED_PARAMS.permCutoffOn,
    permCutoff: SHARED_PARAMS.permCutoff,
    area: SHARED_PARAMS.area,
    fluid: SHARED_PARAMS.fluid,
    bo: SHARED_PARAMS.bo,
    bg: SHARED_PARAMS.bg,
    steps: param.number({
      label: 'Puntos del barrido',
      tooltip: 'Cantidad de umbrales en que se evalúa cada cutoff. Más puntos dan curvas más finas.',
      default: 41,
      min: 11,
      max: 201,
      step: 1,
      scope: 'global',
    }),
  },
  outputs: {
    sweep: output.table('CUTOFF_SWEEP', {
      label: 'Barrido de sensibilidad de los cutoffs',
      hidden: true,
      columns: [
        { key: 'variable', label: 'Variable', kind: 'text' },
        { key: 'zoneId', label: 'Id de zona', kind: 'text' },
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'threshold', label: 'Umbral', unit: 'v/v' },
        { key: 'current', label: 'Cutoff vigente', unit: 'unitless' },
        { key: 'netRes', label: 'Neto reservorio', unit: 'm' },
        { key: 'netPay', label: 'Neto pay', unit: 'm' },
        { key: 'noDataPay', label: 'Reservorio sin dato de pay', unit: 'm' },
        { key: 'hphiSh', label: 'h·φ·Sh pay', unit: 'm' },
        { key: 'ooip', label: 'Petróleo in situ', unit: 'm3' },
        { key: 'ogip', label: 'Gas in situ', unit: 'm3' },
      ],
    }),
  },
  compute({ n, thickness, inputs, params, zones, paramsFor }) {
    const steps = Math.round(params.steps);
    const rows: Record<string, TableCell>[] = [];
    // El corte de k (0054), si está activo, es un corte fijo más: no se barre.
    const cutoffsOf = (p: { vshCutoff: number; phiCutoff: number; swCutoff: number; permCutoffOn: boolean; permCutoff: number }): Cutoffs => ({
      vshMax: p.vshCutoff,
      phiMin: p.phiCutoff,
      swMax: p.swCutoff,
      ...(p.permCutoffOn && Number.isFinite(p.permCutoff) ? { permMin: p.permCutoff } : {}),
    });
    const sweep = (c: Cutoffs, v: SweepVariable, grid: SweepGrid, start: number, end: number): SweepCurves =>
      cutoffSweep(inputs.vsh, inputs.phi, inputs.sw, thickness, c, v, grid, [{ start, end }], inputs.perm);

    type Vals = Record<'netRes' | 'netPay' | 'noDataPay' | 'hphiSh' | 'ooip' | 'ogip', number | null>;
    const EMPTY: Vals = { netRes: null, netPay: null, noDataPay: null, hphiSh: null, ooip: null, ogip: null };
    const push = (variable: SweepVariable, zoneId: string, zone: string, threshold: number, current: boolean, v: Vals) =>
      rows.push({
        variable,
        zoneId,
        zone,
        threshold,
        current: current ? 1 : 0,
        netRes: v.netRes === null ? null : num(v.netRes),
        netPay: v.netPay === null ? null : num(v.netPay),
        noDataPay: v.noDataPay === null ? null : num(v.noDataPay),
        hphiSh: v.hphiSh === null ? null : num(v.hphiSh),
        ooip: v.ooip === null ? null : num(v.ooip),
        ogip: v.ogip === null ? null : num(v.ogip),
      });

    // Sin zonas (D6): una serie «Pozo completo» con los cutoffs globales; el volumen necesita zonas.
    if (zones.length === 0) {
      const c = cutoffsOf(params);
      const vals = (s: SweepCurves, j: number): Vals => ({ netRes: s.netRes[j]!, netPay: s.netPay[j]!, noDataPay: s.noDataPay[j]!, hphiSh: s.hphiShPay[j]!, ooip: null, ogip: null });
      for (const variable of VARIABLES) {
        const grid = { ...SWEEP_GRIDS[variable], steps };
        const s = sweep(c, variable, grid, 0, n);
        for (let j = 0; j < steps; j++) push(variable, '', 'Pozo completo', s.thresholds[j]!, false, vals(s, j));
        const cur = sweep(c, variable, exactGrid(c[CUTOFF_KEY[variable]]), 0, n);
        push(variable, '', 'Pozo completo', c[CUTOFF_KEY[variable]], true, vals(cur, 0));
      }
      return { sweep: { rows } };
    }

    // Zonas: ¿hay alguna muestra clasificada (0 o 1) con los cutoffs vigentes de la zona? Si no, queda «sin dato».
    const classified = zones.map((z) => {
      const c = cutoffsOf(paramsFor(z.id));
      for (let i = z.start; i < z.end; i++) {
        const k = inputs.perm ? inputs.perm[i]! : NaN;
        if (!Number.isNaN(netReservoirFlagK(inputs.vsh[i]!, inputs.phi[i]!, k, c.vshMax, c.phiMin, c.permMin ?? NaN))) return true;
      }
      return false;
    });

    /** Acumulador del total en un umbral: suma de zonas con las reglas del sumario (D6). */
    interface Acc {
      netRes: number;
      netPay: number;
      noDataPay: number;
      hphi: number;
      ooip: number;
      ogip: number;
      ooipN: number;
      ogipN: number;
      anyClassified: boolean;
      anyUnknown: boolean; // alguna zona con reservorio sin Sw en todas sus muestras
      anyKnown: boolean; // alguna zona con reservorio y pay conocido
    }
    const newAcc = (): Acc => ({ netRes: 0, netPay: 0, noDataPay: 0, hphi: 0, ooip: 0, ogip: 0, ooipN: 0, ogipN: 0, anyClassified: false, anyUnknown: false, anyKnown: false });
    const addVolume = (a: Acc, vol: { ooip: number; ogip: number }) => {
      if (Number.isFinite(vol.ooip)) {
        a.ooip += vol.ooip;
        a.ooipN++;
      }
      if (Number.isFinite(vol.ogip)) {
        a.ogip += vol.ogip;
        a.ogipN++;
      }
    };
    const addZone = (a: Acc, netRes: number, netPay: number, noDataPay: number, hphi: number) => {
      a.anyClassified = true;
      a.netRes += netRes;
      a.noDataPay += noDataPay;
      if (Number.isNaN(netPay)) a.anyUnknown = true;
      else {
        a.netPay += netPay;
        a.hphi += hphi;
        if (netRes > 0) a.anyKnown = true;
      }
    };
    const accVals = (a: Acc): Vals => {
      if (!a.anyClassified) return { ...EMPTY, ooip: a.ooipN > 0 ? a.ooip : null, ogip: a.ogipN > 0 ? a.ogip : null };
      const unknown = a.anyUnknown && !a.anyKnown;
      return {
        netRes: a.netRes,
        netPay: unknown ? null : a.netPay,
        noDataPay: a.noDataPay,
        hphiSh: unknown ? null : a.hphi,
        ooip: a.ooipN > 0 ? a.ooip : null,
        ogip: a.ogipN > 0 ? a.ogip : null,
      };
    };

    for (const variable of VARIABLES) {
      const grid = { ...SWEEP_GRIDS[variable], steps };
      const tot = Array.from({ length: steps }, newAcc);
      const totCur = newAcc();

      zones.forEach((z, zi) => {
        const p = paramsFor(z.id);
        const c = cutoffsOf(p);
        const seal = z.kind === 'seal';
        const ok = classified[zi]!;
        // zona sin clasificar: h·φ·Sh sin dato (el volumen es NaN, salvo el sello, que no aporta volumen)
        const volume = (hphiSh: number) => (seal ? { ooip: 0, ogip: 0 } : zoneInPlace(p.fluid, p.area * 1e6, ok ? hphiSh : NaN, p.bo, p.bg));
        const valsOf = (s: SweepCurves, j: number): Vals => {
          const vol = volume(s.hphiShPay[j]!);
          return ok
            ? { netRes: s.netRes[j]!, netPay: s.netPay[j]!, noDataPay: s.noDataPay[j]!, hphiSh: s.hphiShPay[j]!, ooip: vol.ooip, ogip: vol.ogip }
            : { ...EMPTY, ooip: seal ? 0 : null, ogip: seal ? 0 : null };
        };
        const s = sweep(c, variable, grid, z.start, z.end);
        for (let j = 0; j < steps; j++) {
          addVolume(tot[j]!, volume(s.hphiShPay[j]!));
          if (ok) addZone(tot[j]!, s.netRes[j]!, s.netPay[j]!, s.noDataPay[j]!, s.hphiShPay[j]!);
          push(variable, z.id, z.name, s.thresholds[j]!, false, valsOf(s, j));
        }
        const cur = sweep(c, variable, exactGrid(c[CUTOFF_KEY[variable]]), z.start, z.end);
        addVolume(totCur, volume(cur.hphiShPay[0]!));
        if (ok) addZone(totCur, cur.netRes[0]!, cur.netPay[0]!, cur.noDataPay[0]!, cur.hphiShPay[0]!);
        push(variable, z.id, z.name, c[CUTOFF_KEY[variable]], true, valsOf(cur, 0));
      });

      const thresholds = sweepThresholds(grid);
      for (let j = 0; j < steps; j++) push(variable, '', 'Total', thresholds[j]!, false, accVals(tot[j]!));
      push(variable, '', 'Total', cutoffsOf(params)[CUTOFF_KEY[variable]], true, accVals(totCur));
    }
    return { sweep: { rows } };
  },
  docs: {
    summary:
      'Barrido de cada cutoff (Vsh máxima, porosidad mínima, Sw máxima) con los otros dos fijos en sus valores de cada zona: espesor neto de reservorio y de pay, espesor equivalente de hidrocarburo y volumen in situ en cada umbral. Muestra qué tan robusto es el resultado frente a la elección de los cortes.',
    equations: [
      { latex: 'h_{pay}(t) = \\sum_i h_i\\,[\\,NET_{pay,i}(t) = 1\\,]', description: 'Con el cutoff barrido igual a t y los otros dos fijos.' },
      { latex: 'h\\phi S_h(t) = \\sum_i h_i\\,\\phi_i\\,(1 - S_{w,i})\\,[\\,NET_{pay,i}(t) = 1\\,]' },
      { latex: 'V(t) = \\frac{A\\,h\\phi S_h(t)}{B}', description: 'Bo para petróleo, Bg para gas; las zonas de tipo sello no aportan volumen.' },
    ],
    references: [
      'Worthington, P. F. y Cosentino, L. (2005). The role of cut-offs in integrated reservoir studies. SPE Reservoir Evaluation & Engineering 8(4).',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
    notes:
      'Grillas fijas: Vsh de 0 a 1, porosidad de 0 a 0,4 y Sw de 0 a 1. El total suma las zonas en cada umbral (cada zona con sus otros dos cortes). Además de la grilla se evalúa el cutoff vigente exacto de cada zona, que coincide con el sumario y el volumétrico. Si el corte de permeabilidad está activo se aplica fijo en todos los umbrales (no se barre).',
  },
});
