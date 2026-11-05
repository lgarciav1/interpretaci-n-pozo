/**
 * Estadísticas del sumario por zona fuera del motor (docs/decisiones/0068): `zoneSummaryStats` da, por fila de la tabla,
 * el sumario COMPLETO (percentiles y medias) con las mismas zonas que el motor, y el motor sigue sin pagarlo.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { layoutZones, sampleThickness, type Zone } from '../src/core/well';
import { summarizeRanges, type SummaryInput } from '../src/petro/summary';
import { TOTAL_ROW, WHOLE_WELL_ROW, zoneSummaryStats } from '../src/modules/zone-summary/stats';

function tp() {
  const lines = csvText.trim().split(/\r?\n/);
  const head = lines[0]!.split(',');
  const rows = lines.slice(1).map((l) => l.split(','));
  const get = (name: string) => rows.map((r) => (r[head.indexOf(name)] === '' ? NaN : Number(r[head.indexOf(name)])));
  const depth = get(head[0]!);
  const zona = rows.map((r) => r[head.indexOf('ZONA')]!);
  const phi = get('PHIE_CMR');
  const rt = get('AT90');
  const gr = get('GR');
  const vsh = gr.map((g) => Math.min(1, Math.max(0, (g - 30) / 90)));
  const sw = phi.map((p, i) => Math.min(1, Math.sqrt(0.02 / (p * p * rt[i]!))));
  const netRes = phi.map((p) => (p >= 0.08 ? 1 : 0));
  const netPay = phi.map((_, i) => (netRes[i] === 1 && rt[i]! >= 2 ? 1 : 0));
  const zones: Zone[] = ['A', 'B', 'C', 'D', 'E'].map((z, k) => {
    const idx = zona.map((x, i) => (x === z ? i : -1)).filter((i) => i >= 0);
    return { id: `z${k}`, name: z, top: depth[idx[0]!]!, base: depth[idx[idx.length - 1]!]! + 0.1524, color: '#888', kind: 'reservoir' } as Zone;
  });
  const input: SummaryInput = { thickness: sampleThickness(depth), netRes, netPay, phi, sw, vsh, rt };
  return { depth, zones, input };
}

describe('zone-summary/stats: sumario completo por fila, aparte del motor', () => {
  const { depth, zones, input } = tp();
  const stats = zoneSummaryStats(input, depth, zones);

  it('una fila por zona (las del motor, layoutZones) y el total; mismos valores que summarizeRanges completo', () => {
    expect([...stats.keys()]).toEqual(['A', 'B', 'C', 'D', 'E', TOTAL_ROW]);
    const spans = layoutZones(depth, zones).spans;
    const a = spans.find((s) => s.name === 'A')!;
    const ref = summarizeRanges(input, [{ start: a.start, end: a.end }]);
    expect(stats.get('A')).toEqual(ref);
    const total = summarizeRanges(input, spans.map((s) => ({ start: s.start, end: s.end })));
    expect(stats.get(TOTAL_ROW)!.statsPay.rt.p50).toBe(total.statsPay.rt.p50);
    expect(stats.get(TOTAL_ROW)!.rtMeansPay.harm).toBe(total.rtMeansPay.harm);
    expect(stats.get(TOTAL_ROW)!.statsRes.rt.n).toBeGreaterThan(0);
  });

  it('los promedios coinciden con los del motor (distributions: false): solo se agregan percentiles y medias', () => {
    const lean = summarizeRanges(input, [{ start: 0, end: depth.length }], { distributions: false });
    const full = zoneSummaryStats(input, depth, []).get(WHOLE_WELL_ROW)!;
    expect(full.phiPay).toBe(lean.phiPay);
    expect(full.swPay).toBe(lean.swPay);
    expect(full.netPay).toBe(lean.netPay);
    expect(full.rtMeansPay.geo).toBeGreaterThan(0);
  });

  it('cuesta poco (se calcula una vez por resultado, fuera del recálculo de cutoffs)', () => {
    for (let k = 0; k < 3; k++) zoneSummaryStats(input, depth, zones); // calentar el JIT
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) zoneSummaryStats(input, depth, zones);
    const ms = (performance.now() - t0) / 10;
    console.info(`[0068] zoneSummaryStats (5 zonas + total, TP): ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(60);
  });
});
