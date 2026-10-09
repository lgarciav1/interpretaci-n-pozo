import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { createWell, type Curve, type Well } from '../../src/core/well';
import { QC_FLAGS, getCurveQc, readWellFile, runQc, unreliableMask } from '../../src/io';

// ── Pozo del TP: los problemas conocidos de datos/README.md ──────────────────────────────────────────────────

describe('QC del CSV del TP (datos/README.md)', () => {
  const { well } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const snapshot = well.curves.map((c) => Float64Array.from(c.data));
  const report = runQc(well);
  const q = (id: string) => getCurveQc(report, id)!;

  it('no modifica los datos del pozo', () => {
    well.curves.forEach((c, i) => expect(c.data).toEqual(snapshot[i]));
    expect(report.curves).toHaveLength(18);
    expect(report.samples).toBe(5810);
  });

  it('CAL: 189 muestras < 5 in (mínimo 1,098 in) → caliper inválido, en warning', () => {
    const b = report.borehole!;
    expect(b.caliperId).toBe('CAL');
    expect(b.bitSizeCurveId).toBe('BS');
    expect(b.invalidCaliperSamples).toBe(189);
    expect(Math.min(...b.invalidCaliper.map((r) => r.extreme))).toBe(1.098);
    expect(b.invalidCaliper.reduce((s, r) => s + r.samples, 0)).toBe(189);
    const cal = q('CAL');
    expect(cal.stats!.min).toBe(1.098);
    expect(cal.status).not.toBe('ok');
    const reason = cal.reasons.find((r) => r.code === 'invalid-caliper')!;
    expect(reason.message).toContain('189 muestras');
    expect(reason.message).toContain('1,098 in');
    // Las lecturas inválidas son casi constantes (1,098–1,315 in): aparecen también como rachas constantes.
    expect(cal.reasons.some((r) => r.code === 'constant' && r.message.includes('1,104 in'))).toBe(true);
    const mask = unreliableMask(report, 'CAL')!;
    const calData = well.curves.find((c) => c.id === 'CAL')!.data;
    for (let i = 0; i < mask.length; i++) if (calData[i]! < 5) expect(mask[i]).toBe(1);
  });

  it('derrumbe: tramos con CAL − BS > 1 in; ZDEN y PE no confiables ahí y donde el caliper es inválido', () => {
    const b = report.borehole!;
    expect(b.washoutSamples).toBe(71);
    expect(b.washouts.length).toBeGreaterThan(0);
    for (const r of b.washouts) {
      expect(r.topM).toBeLessThanOrEqual(r.baseM);
      expect(r.extreme).toBeGreaterThan(1);
    }
    expect(b.affectedCurveIds.sort()).toEqual(['PE', 'ZDEN']);
    const rhoMask = unreliableMask(report, 'ZDEN', ~QC_FLAGS.BOREHOLE & 0xff)!;
    expect(rhoMask.reduce((s, v) => s + v, 0)).toBe(71 + 189);
    for (const id of ['ZDEN', 'PE']) expect(q(id).reasons.some((r) => r.code === 'borehole')).toBe(true);
    // GR no es una curva de patín
    expect(q('GR').flags.some((f) => f & QC_FLAGS.BOREHOLE)).toBe(false);
  });

  it('NPHI: picos de hasta 3,3 v/v fuera del rango físico', () => {
    const nphi = q('NPHI');
    expect(nphi.stats!.max).toBeCloseTo(3.3172, 4);
    expect(nphi.outOfRangeCount).toBe(2);
    expect(nphi.status).not.toBe('ok');
    const reason = nphi.reasons.find((r) => r.code === 'out-of-range')!;
    expect(reason.message).toContain('3,317 v/v');
  });

  it('AT10 (sin rol): aislados de hasta 110 ohm·m con percentil 99 ≈ 6,7', () => {
    const at10 = q('AT10');
    expect(at10.role).toBeNull();
    expect(at10.stats!.max).toBeCloseTo(109.967, 3);
    expect(at10.stats!.p99).toBeGreaterThan(6.6);
    expect(at10.stats!.p99).toBeLessThan(6.8);
    expect(at10.status).toBe('warning');
    const data = well.curves.find((c) => c.id === 'AT10')!.data;
    expect(at10.spikeIndices.every((i) => at10.flags[i]! & QC_FLAGS.SPIKE)).toBe(true);
    expect(Math.max(...at10.spikeIndices.map((i) => data[i]!))).toBeCloseTo(109.967, 3);
    expect(at10.reasons.find((r) => r.code === 'spikes')!.message).toContain('110 ohm·m');
    // AT90 (Rt) es una curva limpia
    expect(q('AT90').status).toBe('ok');
  });

  it('SP: solo 12 muestras con dato → bad', () => {
    const sp = q('SP');
    expect(sp.stats!.count).toBe(12);
    expect(sp.nullCount).toBe(5798);
    expect(sp.status).toBe('bad');
    expect(sp.reasons[0]!.message).toContain('12 muestras');
  });

  it('DT: 70 nulos (1,2 %) solo informativos; BS constante no se marca', () => {
    const dt = q('DT');
    expect(dt.nullCount).toBe(70);
    expect(dt.reasons.find((r) => r.code === 'nulls')!.severity).toBe('info');
    expect(q('BS').status).toBe('ok');
    expect(q('BS').constantRuns).toEqual([]);
  });

  it('PE: valores por encima de 20 b/e fuera de rango', () => {
    expect(q('PE').outOfRangeCount).toBe(72);
  });

  it('el semáforo general es el peor de las curvas', () => {
    expect(report.status).toBe('bad');
  });
});

// ── Casos sintéticos ─────────────────────────────────────────────────────────────────────────────────────────

function wellOf(curves: Array<Pick<Curve, 'id' | 'role' | 'unit'> & { data: number[] | Float64Array }>, step = 0.1524): Well {
  const n = curves[0]!.data.length;
  return createWell({
    id: 'w',
    name: 'w',
    depth: Float64Array.from({ length: n }, (_, i) => 1000 + i * step),
    curves: curves.map((c) => ({ ...c, mnemonic: c.id, data: Float64Array.from(c.data), origin: { kind: 'measured' } })),
  });
}

/** Curva "real" suave con ruido determinístico. */
const smooth = (n: number, base: number, amp: number, noise: number) =>
  Array.from({ length: n }, (_, i) => base + amp * Math.sin(i / 25) + noise * Math.sin(i * 12.9898) * Math.cos(i * 78.233));

describe('QC: casos sintéticos', () => {
  it('curva limpia → ok, sin razones', () => {
    const r = runQc(wellOf([{ id: 'GR', role: 'GR', unit: 'gAPI', data: smooth(400, 70, 30, 3) }]));
    const gr = r.curves[0]!;
    expect(gr.status).toBe('ok');
    expect(gr.reasons).toEqual([]);
    expect(gr.spikeIndices).toEqual([]);
    expect(r.borehole).toBeNull();
    expect(unreliableMask(r, 'GR')!.every((v) => v === 0)).toBe(true);
  });

  it('pico aislado: se detecta solo esa muestra', () => {
    const data = smooth(400, 70, 30, 3);
    data[200] = 400;
    const gr = runQc(wellOf([{ id: 'GR', role: 'GR', unit: 'gAPI', data }])).curves[0]!;
    expect(gr.spikeIndices).toEqual([200]);
    expect(gr.status).toBe('warning');
    expect(gr.reasons[0]!.message).toContain('400 gAPI');
  });

  it('un escalón (cambio de capa) no es un pico', () => {
    const data = smooth(400, 40, 2, 1).map((v, i) => (i >= 200 ? v + 80 : v));
    expect(runQc(wellOf([{ id: 'GR', role: 'GR', unit: 'gAPI', data }])).curves[0]!.spikeIndices).toEqual([]);
  });

  it('resistividad: pico detectado en escala logarítmica', () => {
    const data = smooth(400, 2, 0.5, 0.05);
    data[100] = 200;
    const rt = runQc(wellOf([{ id: 'ILD', role: 'RT', unit: 'ohm.m', data }])).curves[0]!;
    expect(rt.spikeIndices).toEqual([100]);
  });

  it('racha constante: muestras y valor en la razón', () => {
    const data = smooth(400, 2.4, 0.1, 0.01);
    for (let i = 100; i < 140; i++) data[i] = 2.373;
    const rho = runQc(wellOf([{ id: 'RHOB', role: 'RHOB', unit: 'g/cm3', data }])).curves[0]!;
    expect(rho.constantRuns).toHaveLength(1);
    expect(rho.constantRuns[0]).toMatchObject({ value: 2.373, start: 100, end: 140 });
    expect(rho.status).toBe('warning');
    expect(rho.reasons[0]!.message).toBe('40 muestras con valor constante 2,373 g/cm³.');
  });

  it('rango físico en la unidad canónica: NPHI en % se convierte', () => {
    const data = smooth(100, 20, 5, 0.5);
    data[10] = 120; // 1,2 v/v
    const nphi = runQc(wellOf([{ id: 'NPHI', role: 'NPHI', unit: '%', data }])).curves[0]!;
    expect(nphi.outOfRangeCount).toBe(1);
    expect(nphi.flags[10]! & QC_FLAGS.OUT_OF_RANGE).toBeTruthy();
  });

  it('nulos: >5 % warning, >50 % bad, sin datos bad', () => {
    const base = smooth(100, 70, 10, 1);
    const some = base.map((v, i) => (i < 10 ? NaN : v));
    const most = base.map((v, i) => (i < 80 ? NaN : v));
    const r = runQc(
      wellOf([
        { id: 'A', role: 'GR', unit: 'gAPI', data: some },
        { id: 'B', role: 'GR', unit: 'gAPI', data: most },
        { id: 'C', role: 'GR', unit: 'gAPI', data: base.map(() => NaN) },
      ]),
    );
    expect(r.curves.map((c) => c.status)).toEqual(['warning', 'bad', 'bad']);
    expect(r.curves[2]!.reasons[0]!.code).toBe('no-data');
  });

  it('derrumbe sin curva BS: usa el trépano por defecto (8,5 in) y tolerancia configurable', () => {
    const cal = Array.from({ length: 100 }, (_, i) => (i >= 40 && i < 50 ? 10.2 : 8.7 + 0.01 * Math.sin(i)));
    cal[70] = 3; // caliper inválido
    const rhob = smooth(100, 2.4, 0.05, 0.01);
    const w = wellOf([
      { id: 'CALI', role: 'CALI', unit: 'in', data: cal },
      { id: 'RHOB', role: 'RHOB', unit: 'g/cm3', data: rhob },
    ]);
    const r = runQc(w);
    const b = r.borehole!;
    expect(b.bitSizeCurveId).toBeNull();
    expect(b.bitSize).toBe(8.5);
    expect(b.washouts).toHaveLength(1);
    expect(b.washouts[0]).toMatchObject({ start: 40, end: 50, samples: 10 });
    expect(b.washouts[0]!.topM).toBeCloseTo(1000 + 40 * 0.1524, 6);
    expect(b.washouts[0]!.baseM).toBeCloseTo(1000 + 49 * 0.1524, 6);
    expect(b.washouts[0]!.extreme).toBeCloseTo(1.7, 6);
    expect(b.invalidCaliper).toHaveLength(1);
    expect(b.invalidCaliper[0]).toMatchObject({ start: 70, end: 71, extreme: 3 });
    expect(b.affectedCurveIds).toEqual(['RHOB']);
    const mask = unreliableMask(r, 'RHOB')!;
    expect(mask.reduce((s, v) => s + v, 0)).toBe(11);
    expect(mask[45]).toBe(1);
    expect(mask[70]).toBe(1);
    expect(getCurveQc(r, 'RHOB')!.status).toBe('warning');

    // Con trépano de 9 in y tolerancia 1,5 in, 10,2 in ya no es derrumbe.
    expect(runQc(w, { bitSize: 9, washoutTolerance: 1.5 }).borehole!.washouts).toEqual([]);
  });

  it('huecos chicos entre muestras de derrumbe se unen en un tramo', () => {
    const cal = Array.from({ length: 60 }, (_, i) => ([10, 11, 13, 14, 30].includes(i) ? 10 : 8.6));
    const b = runQc(wellOf([{ id: 'CALI', role: 'CALI', unit: 'in', data: cal }])).borehole!;
    expect(b.washouts.map((r) => [r.start, r.end, r.samples])).toEqual([
      [10, 15, 4],
      [30, 31, 1],
    ]);
  });
});
