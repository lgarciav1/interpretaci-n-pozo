/**
 * Lógica pura de la mesa del Log Digitizer (docs/decisiones/0063): vista (pantalla ↔ imagen), formulario → tipos del
 * motor, pasos, edición manual de trazas y política de importación.
 */
import { describe, expect, it } from 'vitest';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell } from '../../src/core/well';
import { registry } from '../../src/modules';
import { calibrationOf, depthInImageUnit, emptyWork, frameOf, newCurveDraft, overlayColor, pickColorAt, regionOf, scaleForRole, specOf, updateCurve, type CurveDraft, type WorkState } from '../../src/modules/digitizer/model/form';
import { freeMnemonic, importPlan } from '../../src/modules/digitizer/model/outputs';
import { stepStates, suggestedStep } from '../../src/modules/digitizer/model/steps';
import { emptyTrace, eraseTrace, paintTrace, traceExtent, tracePolylines, tracedRows, traceXAt } from '../../src/modules/digitizer/model/traceEdit';
import { centerOn, clampPan, fitImage, fitWidth, imageToScreen, screenToImage, visibleRows, zoomAt } from '../../src/modules/digitizer/model/viewport';
import { FIX, smallLog } from './fixture';

describe('vista del lienzo', () => {
  const vp = { scale: 2.5, ox: 30, oy: -40 };
  it('pantalla ↔ imagen es una ida y vuelta exacta; el centro del píxel (i, j) cae en (i, j)', () => {
    for (const [x, y] of [[0, 0], [10.25, 7.5], [399, 899]] as const) {
      const s = imageToScreen(vp, x, y);
      const p = screenToImage(vp, s.x, s.y);
      expect(p.x).toBeCloseTo(x, 12);
      expect(p.y).toBeCloseTo(y, 12);
    }
    // borde del píxel 0 = origen de la imagen en pantalla
    expect(imageToScreen(vp, -0.5, -0.5)).toEqual({ x: 30, y: -40 });
  });
  it('zoom alrededor de un punto lo deja fijo en pantalla', () => {
    const before = screenToImage(vp, 300, 200);
    const z = zoomAt(vp, 1.7, 300, 200);
    const after = screenToImage(z, 300, 200);
    expect(z.scale).toBeCloseTo(4.25);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomAt(vp, 1e9, 0, 0).scale).toBe(32);
  });
  it('encuadres, límites del desplazamiento y filas visibles', () => {
    const f = fitImage(400, 2000, 800, 600, 20);
    expect(f.scale).toBeCloseTo(560 / 2000);
    expect(f.ox + 200 * f.scale).toBeCloseTo(400);
    const w = fitWidth(400, 820, 10);
    expect(w.scale).toBe(2);
    expect(w.oy).toBe(10);
    const lost = clampPan({ scale: 1, ox: 5000, oy: -9000 }, 400, 2000, 800, 600);
    expect(lost.ox).toBeLessThanOrEqual(800 - 48);
    expect(lost.oy + 2000).toBeGreaterThanOrEqual(48);
    const [a, b] = visibleRows({ scale: 2, ox: 0, oy: -200 }, 2000, 600);
    expect(a).toBe(99);
    expect(b).toBe(400);
    const c = centerOn({ scale: 2, ox: 0, oy: 0 }, 100, 500, 800, 600);
    expect(imageToScreen(c, 100, 500)).toEqual({ x: 400, y: 300 });
  });
});

describe('formulario → motor', () => {
  const work = (ties: WorkState['ties']): WorkState => ({ ...emptyWork(), ties });
  it('calibración: amarres sin profundidad quedan pendientes; con 2 válidos calibra', () => {
    const one = calibrationOf(work([{ id: 'a', y: 100, depth: 1505 }, { id: 'b', y: 300, depth: null }]));
    expect(one.calibration).toBeNull();
    expect(one.pending).toBe(1);
    expect(one.problems[0]).toMatch(/al menos 2 amarres/);
    const ok = calibrationOf(work([{ id: 'a', y: 100, depth: 1505 }, { id: 'b', y: 300, depth: 1515 }]));
    expect(ok.calibration!.slopeMPerPx).toBeCloseTo(0.05);
    expect(depthInImageUnit(ok.calibration, 200)).toBeCloseTo(1510);
    const ft = calibrationOf({ ...work([{ id: 'a', y: 0, depth: 1000 }, { id: 'b', y: 100, depth: 1100 }]), depthUnit: 'ft' });
    expect(depthInImageUnit(ft.calibration, 50)).toBeCloseTo(1050, 9);
    const bad = calibrationOf(work([{ id: 'a', y: 100, depth: 1515 }, { id: 'b', y: 300, depth: 1505 }]));
    expect(bad.calibration).toBeNull();
    expect(bad.problems.join(' ')).toMatch(/profundidad/i);
  });

  it('curva nueva: el mnemónico sugiere rol, unidad y escala típica (NPHI invertida)', () => {
    const gr = newCurveDraft('GR', registry.roles);
    expect(gr).toMatchObject({ role: 'GR', unit: 'gAPI', leftValue: 0, rightValue: 150, scaleKind: 'linear', median: 1, despike: false, mode: 'auto' });
    const nphi = newCurveDraft('NPHI', registry.roles);
    expect(nphi.role).toBe('NPHI');
    expect(nphi.leftValue).toBeGreaterThan(nphi.rightValue);
    expect(scaleForRole('RT', registry.roles)?.scaleKind).toBe('log');
    expect(newCurveDraft('XYZ', defaultRoleCatalog).role).toBeNull();
  });

  it('marco, región por defecto y spec del motor; mientras falta algo, la lista de qué falta', () => {
    const c0 = newCurveDraft('GR', registry.roles);
    const img = { width: FIX.W, height: FIX.H };
    expect(specOf(c0, img).problems).toEqual(expect.arrayContaining([expect.stringMatching(/bordes/), expect.stringMatching(/color/)]));
    const c: CurveDraft = { ...c0, leftPx: 40, rightPx: 380, color: { mode: 'color', rgb: [30, 140, 60] } };
    expect(regionOf(c, img)).toEqual({ x0: 43, y0: 0, x1: 378, y1: FIX.H });
    const { spec } = specOf(c, img);
    expect(spec).toMatchObject({ id: c.id, mnemonic: 'GR', unit: 'gAPI', role: 'GR', mode: 'auto', frame: { leftPx: 40, rightPx: 380, scale: { kind: 'linear', min: 0, max: 150, reversed: false } } });
    expect(frameOf({ ...c, leftValue: 0.45, rightValue: -0.15 }).frame!.scale.reversed).toBe(true);
    expect(frameOf({ ...c, scaleKind: 'log', leftValue: 0, rightValue: 2000 }).problems[0]).toMatch(/positivos/);
    expect(specOf({ ...c, mode: 'guided', guide: [{ x: 1, y: 1 }] }, img).problems[0]).toMatch(/guía/);
    const g = specOf({ ...c, mode: 'guided', guide: [{ x: 100, y: 10 }, { x: 120, y: 800 }], corridor: 9 }, img).spec!;
    expect(g.guide).toEqual({ points: [{ x: 100, y: 10 }, { x: 120, y: 800 }], corridor: 9 });
    expect(regionOf({ ...c, region: { x0: -5, y0: 10.4, x1: 9999, y1: 500.2 } }, img)).toEqual({ x0: 0, y0: 10, x1: FIX.W, y1: 501 });
  });

  it('cuentagotas: toma el núcleo del trazo verde; papel → null; negro → modo oscuro', () => {
    const { image, log } = smallLog();
    const x = log.trueX('GR', 400);
    const g = pickColorAt(image, x, 400)!;
    expect(g.spec.mode).toBe('color');
    expect(g.rgb[1]).toBeGreaterThan(g.rgb[0] + 40);
    expect(pickColorAt(image, 5, 5)).toBeNull();
    const black = { width: 9, height: 9, data: new Uint8ClampedArray(9 * 9 * 4).fill(255) };
    for (let j = 0; j < 9; j++) black.data.set([10, 10, 12, 255], (j * 9 + 4) * 4);
    expect(pickColorAt(black, 4, 4)!.spec).toEqual({ mode: 'dark' });
  });

  it('color de la traza sobre la imagen: complementario de la tinta; negro → naranja', () => {
    expect(overlayColor({ color: { mode: 'color', rgb: [30, 140, 60] } })).toMatch(/^hsl\(3\d\d /);
    expect(overlayColor({ color: { mode: 'dark' } })).toBe('#ff6a00');
  });

  it('updateCurve cambia solo la curva pedida', () => {
    const w: WorkState = { ...emptyWork(), curves: [newCurveDraft('GR', registry.roles), newCurveDraft('SP', registry.roles)] };
    const n = updateCurve(w, w.curves[1]!.id, { leftPx: 10 });
    expect(n.curves[0]).toBe(w.curves[0]);
    expect(n.curves[1]!.leftPx).toBe(10);
  });
});

describe('pasos de la mesa', () => {
  const base = { hasImage: true, geometryApplied: false, geometrySkipped: false, reviewed: false, delivered: false };
  it('sin imagen sugiere Imagen; después Geometría; omitir la marca como saltada', () => {
    const w = emptyWork();
    const s0 = stepStates({ ...base, hasImage: false, work: w, calibration: calibrationOf(w) });
    expect(suggestedStep(s0)).toBe('image');
    const s1 = stepStates({ ...base, work: w, calibration: calibrationOf(w) });
    expect(suggestedStep(s1)).toBe('geometry');
    const s2 = stepStates({ ...base, geometrySkipped: true, work: w, calibration: calibrationOf(w) });
    expect(s2.find((s) => s.id === 'geometry')!.status).toBe('skipped');
    expect(suggestedStep(s2)).toBe('depth');
  });
  it('profundidad parcial con amarres incompletos; curvas, revisión y salida según las trazas', () => {
    const w: WorkState = { ...emptyWork(), ties: [{ id: 'a', y: 0, depth: 1 }, { id: 'b', y: 10, depth: null }] };
    const s = stepStates({ ...base, geometryApplied: true, work: w, calibration: calibrationOf(w) });
    expect(s.find((x) => x.id === 'depth')).toMatchObject({ status: 'partial' });
    const c = { ...newCurveDraft('GR', registry.roles), trace: emptyTrace(0, 3) };
    const w2: WorkState = { ...w, ties: [{ id: 'a', y: 0, depth: 1 }, { id: 'b', y: 10, depth: 2 }], curves: [c, newCurveDraft('SP', registry.roles)] };
    const s2 = stepStates({ ...base, geometryApplied: true, work: w2, calibration: calibrationOf(w2) });
    expect(s2.map((x) => x.status)).toEqual(['done', 'done', 'done', 'partial', 'partial', 'todo']);
    const s3 = stepStates({ ...base, geometryApplied: true, reviewed: true, delivered: true, work: w2, calibration: calibrationOf(w2) });
    expect(s3.slice(4).map((x) => x.status)).toEqual(['done', 'done']);
  });
});

describe('edición manual de la traza', () => {
  it('pintar crea la traza, interpola entre dos puntos y la hace crecer; no modifica la original', () => {
    const t1 = paintTrace(null, { x: 10, y: 5 }, { x: 20, y: 15 });
    expect(t1.y0).toBe(5);
    expect(t1.x.length).toBe(11);
    expect(traceXAt(t1, 10)).toBeCloseTo(15);
    expect(t1.observed[3]).toBe(1);
    expect(t1.confidence[3]).toBe(1);
    const t2 = paintTrace(t1, { x: 30, y: 30 });
    expect(t2.y0).toBe(5);
    expect(t2.x.length).toBe(26);
    expect(Number.isNaN(traceXAt(t2, 20))).toBe(true);
    expect(traceXAt(t2, 30)).toBe(30);
    expect(t1.x.length).toBe(11);
    expect(traceExtent(t2)).toEqual([5, 30]);
    expect(tracedRows(t2)).toBe(12);
  });
  it('borrar un tramo deja NaN sin dato; las polilíneas se cortan en los huecos', () => {
    const t = paintTrace(null, { x: 0, y: 0 }, { x: 100, y: 100 });
    const e = eraseTrace(t, 40.2, 59.6);
    expect(tracedRows(e)).toBe(101 - 21);
    expect(e.observed[50]).toBe(0);
    expect(tracedRows(t)).toBe(101);
    const lines = tracePolylines(e, 0, 100, 5);
    expect(lines).toHaveLength(2);
    expect(lines[0]![0]).toEqual({ x: 0, y: 0 });
    expect(lines[0]![lines[0]!.length - 1]!.y).toBe(39);
    expect(lines[1]![0]!.y).toBe(61);
    expect(eraseTrace(t, 500, 600)).toBe(t);
  });
});

describe('importación: roles y mnemónicos repetidos', () => {
  const well = createWell({
    id: 'w',
    name: 'W',
    depth: Float64Array.from({ length: 10 }, (_, i) => 1500 + i),
    curves: [{ id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: new Float64Array(10), origin: { kind: 'measured' } }],
  });
  const gr = { ...newCurveDraft('GR', registry.roles) };
  it('por defecto: mnemónico con sufijo _DIG y sin rol si el pozo ya tiene ese rol', () => {
    const p = importPlan(gr, well);
    expect(p.meta).toMatchObject({ id: 'GR_DIG', mnemonic: 'GR_DIG', role: null, unit: 'gAPI', description: 'Digitalizada con Log Digitizer' });
    expect(p.roleConflict).toBe('GR');
    expect(p.notes.join(' ')).toMatch(/sin rol/);
  });
  it('la persona puede conservar el rol; sin pozo o sin conflicto, todo queda como está', () => {
    expect(importPlan(gr, well, { keepRole: true }).meta.role).toBe('GR');
    expect(importPlan(gr, null).meta).toMatchObject({ mnemonic: 'GR', role: 'GR' });
    const sp = newCurveDraft('SP', registry.roles);
    expect(importPlan(sp, well)).toMatchObject({ meta: { mnemonic: 'SP', role: 'SP' }, notes: [], roleConflict: null });
    expect(freeMnemonic(['GR', 'GR_DIG'], 'gr')).toBe('gr_DIG2');
  });
});
