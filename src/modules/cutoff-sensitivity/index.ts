/**
 * Módulo de sensibilidad a los cutoffs — barrido de cada corte (Vsh, φ, Sw) con los otros dos fijos. Ver 0007, C20,
 * D5 y D6. Produce una tabla oculta (`CUTOFF_SWEEP`) que dibuja su panel a medida (`panel.tsx`).
 *
 * Filas: para cada variable, para cada intervalo (las zonas en orden y el «Total», o «Pozo completo» sin zonas),
 * `steps` umbrales de la grilla fija de la variable y UNA fila más con `current = 1`, evaluada exactamente en el
 * cutoff vigente del intervalo (en el Total, cada zona con el suyo). Esa fila coincide con el sumario y el
 * volumétrico sin depender de que el cutoff caiga sobre la grilla.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import type { Cutoffs } from '../../petro/cutoffs';
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
  },
  params: {
    vshCutoff: SHARED_PARAMS.vshCutoff,
    phiCutoff: SHARED_PARAMS.phiCutoff,
    swCutoff: SHARED_PARAMS.swCutoff,
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
        { key: 'hphiSh', label: 'h·φ·Sh pay', unit: 'm' },
        { key: 'ooip', label: 'Petróleo in situ', unit: 'm3' },
        { key: 'ogip', label: 'Gas in situ', unit: 'm3' },
      ],
    }),
  },
  compute({ n, thickness, inputs, params, zones, paramsFor }) {
    const steps = Math.round(params.steps);
    const rows: Record<string, TableCell>[] = [];
    const cutoffsOf = (p: { vshCutoff: number; phiCutoff: number; swCutoff: number }): Cutoffs => ({
      vshMax: p.vshCutoff,
      phiMin: p.phiCutoff,
      swMax: p.swCutoff,
    });
    const sweep = (c: Cutoffs, v: SweepVariable, grid: SweepGrid, start: number, end: number): SweepCurves =>
      cutoffSweep(inputs.vsh, inputs.phi, inputs.sw, thickness, c, v, grid, [{ start, end }]);

    const push = (variable: SweepVariable, zoneId: string, zone: string, threshold: number, current: boolean, v: Record<'netRes' | 'netPay' | 'hphiSh' | 'ooip' | 'ogip', number | null>) =>
      rows.push({
        variable,
        zoneId,
        zone,
        threshold,
        current: current ? 1 : 0,
        netRes: v.netRes === null ? null : num(v.netRes),
        netPay: v.netPay === null ? null : num(v.netPay),
        hphiSh: v.hphiSh === null ? null : num(v.hphiSh),
        ooip: v.ooip === null ? null : num(v.ooip),
        ogip: v.ogip === null ? null : num(v.ogip),
      });

    // Sin zonas (D6): una serie «Pozo completo» con los cutoffs globales; el volumen necesita zonas.
    if (zones.length === 0) {
      const c = cutoffsOf(params);
      for (const variable of VARIABLES) {
        const grid = { ...SWEEP_GRIDS[variable], steps };
        const s = sweep(c, variable, grid, 0, n);
        for (let j = 0; j < steps; j++) {
          push(variable, '', 'Pozo completo', s.thresholds[j]!, false, { netRes: s.netRes[j]!, netPay: s.netPay[j]!, hphiSh: s.hphiShPay[j]!, ooip: null, ogip: null });
        }
        const cur = sweep(c, variable, exactGrid(c[CUTOFF_KEY[variable]]), 0, n);
        push(variable, '', 'Pozo completo', c[CUTOFF_KEY[variable]], true, { netRes: cur.netRes[0]!, netPay: cur.netPay[0]!, hphiSh: cur.hphiShPay[0]!, ooip: null, ogip: null });
      }
      return { sweep: { rows } };
    }

    // Zonas: ¿hay alguna muestra clasificable (Vsh y φ con dato)? Si no, la zona queda «sin dato» (como el sumario).
    const classifiable = zones.map((z) => {
      for (let i = z.start; i < z.end; i++) if (!Number.isNaN(inputs.vsh[i]!) && !Number.isNaN(inputs.phi[i]!)) return true;
      return false;
    });
    const anyClassifiable = classifiable.some(Boolean);

    for (const variable of VARIABLES) {
      const grid = { ...SWEEP_GRIDS[variable], steps };
      const totNetRes = new Float64Array(steps);
      const totNetPay = new Float64Array(steps);
      const totHphi = new Float64Array(steps);
      const totOoip = new Float64Array(steps);
      const totOgip = new Float64Array(steps);
      const totCur = { netRes: 0, netPay: 0, hphiSh: 0, ooip: 0, ogip: 0 };

      zones.forEach((z, zi) => {
        const p = paramsFor(z.id);
        const c = cutoffsOf(p);
        const seal = z.kind === 'seal';
        const volume = (hphiSh: number) => (seal ? { ooip: 0, ogip: 0 } : zoneInPlace(p.fluid, p.area * 1e6, hphiSh, p.bo, p.bg));
        const s = sweep(c, variable, grid, z.start, z.end);
        const cur = sweep(c, variable, exactGrid(c[CUTOFF_KEY[variable]]), z.start, z.end);
        const ok = classifiable[zi]!;
        for (let j = 0; j < steps; j++) {
          const vol = volume(s.hphiShPay[j]!);
          totNetRes[j]! += s.netRes[j]!;
          totNetPay[j]! += s.netPay[j]!;
          totHphi[j]! += s.hphiShPay[j]!;
          if (Number.isFinite(vol.ooip)) totOoip[j]! += vol.ooip;
          if (Number.isFinite(vol.ogip)) totOgip[j]! += vol.ogip;
          push(
            variable,
            z.id,
            z.name,
            s.thresholds[j]!,
            false,
            ok ? { netRes: s.netRes[j]!, netPay: s.netPay[j]!, hphiSh: s.hphiShPay[j]!, ooip: vol.ooip, ogip: vol.ogip } : { netRes: null, netPay: null, hphiSh: null, ooip: null, ogip: null },
          );
        }
        const vc = volume(cur.hphiShPay[0]!);
        totCur.netRes += cur.netRes[0]!;
        totCur.netPay += cur.netPay[0]!;
        totCur.hphiSh += cur.hphiShPay[0]!;
        if (Number.isFinite(vc.ooip)) totCur.ooip += vc.ooip;
        if (Number.isFinite(vc.ogip)) totCur.ogip += vc.ogip;
        push(
          variable,
          z.id,
          z.name,
          c[CUTOFF_KEY[variable]],
          true,
          ok ? { netRes: cur.netRes[0]!, netPay: cur.netPay[0]!, hphiSh: cur.hphiShPay[0]!, ooip: vc.ooip, ogip: vc.ogip } : { netRes: null, netPay: null, hphiSh: null, ooip: null, ogip: null },
        );
      });

      const empty = { netRes: null, netPay: null, hphiSh: null, ooip: null, ogip: null };
      const thresholds = sweepThresholds(grid);
      for (let j = 0; j < steps; j++) {
        push(
          variable,
          '',
          'Total',
          thresholds[j]!,
          false,
          anyClassifiable ? { netRes: totNetRes[j]!, netPay: totNetPay[j]!, hphiSh: totHphi[j]!, ooip: totOoip[j]!, ogip: totOgip[j]! } : empty,
        );
      }
      push(variable, '', 'Total', cutoffsOf(params)[CUTOFF_KEY[variable]], true, anyClassifiable ? totCur : empty);
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
      'Grillas fijas: Vsh de 0 a 1, porosidad de 0 a 0,4 y Sw de 0 a 1. El total suma las zonas en cada umbral (cada zona con sus otros dos cortes). Además de la grilla se evalúa el cutoff vigente exacto de cada zona, que coincide con el sumario y el volumétrico.',
  },
});
