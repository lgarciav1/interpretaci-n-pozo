/**
 * Perfil clásico (docs/decisiones/0067): reglas de trazo por densidad de muestras, banda mínimo–máximo, columnas
 * MD/TVDSS, escalas de impresión, tramas litológicas, estilo guardado en el proyecto y menú contextual.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { sanitizeDisplay, type TrackSpec } from '../../src/core/display';
import { addWell, createProject, setViewerLook } from '../../src/core/state/project';
import { addTopAt } from '../../src/core/state/zones';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell, type Curve, type Zone } from '../../src/core/well';
import { readWellFile } from '../../src/io';
import { pxPerMeterForScale } from '../../src/io/export/figures/sizing';
import { registry } from '../../src/modules';
import { CLASSIC_MAX_LINE_WIDTH, curveStyle, CURVE_PALETTE, fillColor } from '../../src/ui/curves';
import { contrastRatio } from '../../src/ui/color';
import { THEMES } from '../../src/ui/tokens';
import { measureInterval, measureLabel, nearestCurveAt, readingsText } from '../../src/viewer/contextMenu';
import { blockSummary, createRowBuffers, decimateWithBounds, ROW_DATA, rowBounds } from '../../src/viewer/decimate';
import { computeTvdss, DEPTH_TRACK_WIDTH_TVDSS, depthReference, headerLengthM, tvdssTicks, wellTvdss } from '../../src/viewer/depthColumns';
import { lithologyTile, LITHOLOGY_TILES, patternOpacity, patternPhase, PATTERN_FULL_SCALE, PATTERN_HIDDEN_SCALE } from '../../src/viewer/lithology';
import { DASH_MAX_SAMPLES_PER_PX, DEFAULT_LOOK, ENVELOPE_MIN_SAMPLES_PER_PX, lookOf, strokeMode, VIEWER_LOOKS } from '../../src/viewer/look';
import { cmPer100m, matchingPrintScale, printScaleOptions, PRINT_SCALES, scaleButtonLabel } from '../../src/viewer/printScale';
import { DEPTH_TRACK_WIDTH, resolveTracks } from '../../src/viewer/resolve';
import { BUILTIN_LAYOUTS, factoryLayout, layoutFor, MODERN_LAYOUTS } from '../../src/viewer/templates';
import { fractionArray } from '../../src/viewer/scale';
import { scaleRatio, viewportLimits } from '../../src/viewer/viewport';

const classic = VIEWER_LOOKS.classic;
const modern = VIEWER_LOOKS.modern;

describe('trazo según las muestras por píxel', () => {
  it('patrón con a lo sumo 1 muestra por píxel; sólida por encima; banda desde 3', () => {
    expect(DASH_MAX_SAMPLES_PER_PX).toBe(1);
    expect(ENVELOPE_MIN_SAMPLES_PER_PX).toBe(3);
    expect(strokeMode(0.4, 'dashed', classic)).toBe('pattern');
    expect(strokeMode(1, 'dotted', classic)).toBe('pattern');
    expect(strokeMode(1.01, 'dotted', classic)).toBe('solid');
    expect(strokeMode(2.9, 'dashed', classic)).toBe('solid');
    expect(strokeMode(3, 'dashed', classic)).toBe('envelope');
    expect(strokeMode(40, 'solid', classic)).toBe('envelope');
    // Una curva sólida no cambia hasta la banda.
    expect(strokeMode(2, 'solid', classic)).toBe('pattern');
  });

  it('«Moderno» dibuja siempre con su patrón y sin banda (como antes)', () => {
    for (const d of [0.2, 1.5, 3, 50]) expect(strokeMode(d, 'dashed', modern)).toBe('pattern');
  });

  it('en el pozo del TP (paso 0,1524 m): patrón a 1:500, sólida a 1:1000, banda a 1:2000', () => {
    const density = (n: number) => 1 / (pxPerMeterForScale(n) * 0.1524);
    expect(strokeMode(density(500), 'dashed', classic)).toBe('pattern');
    expect(strokeMode(density(1000), 'dashed', classic)).toBe('solid');
    expect(strokeMode(density(2000), 'dashed', classic)).toBe('envelope');
  });
});

describe('banda mínimo–máximo (buffers M4 por fila)', () => {
  it('cada fila conserva el mínimo y el máximo (ningún pico se pierde) y la media para la línea', () => {
    // 10 filas de 10 muestras: un pico aislado en la fila 3.
    const n = 100;
    const depth = Float64Array.from({ length: n }, (_, i) => i);
    const data = Float64Array.from({ length: n }, (_, i) => (i === 34 ? 9 : (i % 10) / 10));
    const frac = fractionArray(data, { kind: 'linear', min: 0, max: 10, reversed: false });
    const bounds = rowBounds(depth, 0, n, 0, 0.1, 10);
    const b = decimateWithBounds(frac, bounds, 10, createRowBuffers(10), blockSummary(frac));
    expect(b.state[3]).toBe(ROW_DATA);
    expect(b.max[3]).toBeCloseTo(0.9, 6);
    expect(b.min[3]).toBeCloseTo(0, 6);
    expect(b.max[4]).toBeCloseTo(0.09, 6);
    // la media de la fila 3 queda entre el mín y el máx, lejos del pico
    expect(b.mean[3]).toBeGreaterThan(b.min[3]!);
    expect(b.mean[3]).toBeLessThan(0.15);
  });
});

describe('columnas de profundidad MD y TVDSS', () => {
  const depth = Float64Array.from([1000, 1010, 1020, 1030]);
  it('elevación de referencia: KB en pies se pasa a metros; sin elevación no hay TVDSS', () => {
    expect(headerLengthM({ value: 100, unit: 'ft' })).toBeCloseTo(30.48, 9);
    expect(headerLengthM({ value: '1.234,5', unit: 'm' })).toBeCloseTo(1234.5, 9);
    const base = { depth: { unit: 'm' as const, values: depth, step: 10 }, curves: [] as Curve[] };
    expect(depthReference({ ...base, header: {} })).toBeNull();
    expect(depthReference({ ...base, header: { EKB: { value: 250, unit: 'm' } } })).toMatchObject({ elevation: 250, source: 'KB', inclination: null });
    expect(depthReference({ ...base, header: { EDF: { value: 820, unit: 'ft' } } })!.elevation).toBeCloseTo(249.936, 6);
  });

  it('pozo vertical: TVDSS = MD − KB', () => {
    expect([...computeTvdss(depth, 250)]).toEqual([750, 760, 770, 780]);
  });

  it('con inclinación: tangente balanceada (60° constante → ΔTVD = ΔMD/2), vertical hasta la primera muestra', () => {
    const tv = computeTvdss(depth, 0, [60, 60, 60, 60]);
    expect(tv[0]).toBe(1000);
    expect(tv[3]! - tv[0]!).toBeCloseTo(15, 9);
    // 0° → 60°: el primer tramo usa el promedio de los cosenos.
    const ramp = computeTvdss(Float64Array.from([0, 10]), 0, [0, 60]);
    expect(ramp[1]).toBeCloseTo(10 * (1 + 0.5) / 2, 9);
    // hueco: repite el último valor válido
    expect(computeTvdss(Float64Array.from([0, 10, 20]), 0, [60, NaN, 60])[2]).toBeCloseTo(10, 9);
  });

  it('una curva DEVI en grados se usa; una con valores fuera de 0–90 no', () => {
    const header = { EKB: { value: 10, unit: 'm' as const } };
    const devi = (vals: number[]): Curve => ({ id: 'DEVI', mnemonic: 'DEVI', role: null, unit: 'unitless', data: Float64Array.from(vals), origin: { kind: 'measured' } });
    const w = (c: Curve) => ({ header, depth: { unit: 'm' as const, values: depth, step: 10 }, curves: [c] });
    expect(depthReference(w(devi([0, 30, 30, 30])))!.inclinationName).toBe('DEVI');
    expect(depthReference(w(devi([0, 300, 30, 30])))!.inclination).toBeNull();
  });

  it('rótulos TVDSS en valores redondos, ubicados en la MD verdadera', () => {
    const tv = computeTvdss(depth, 3); // 997, 1007, 1017, 1027
    const ticks = tvdssTicks(depth, tv, 1000, 1030, 10);
    expect(ticks.map((t) => t.value)).toEqual([1000, 1010, 1020]);
    expect(ticks[0]!.md).toBeCloseTo(1003, 9);
    // desviado: 60° → los valores se separan el doble en MD
    const dev = computeTvdss(Float64Array.from([0, 10, 20, 30, 40]), 0, [60, 60, 60, 60, 60]);
    expect(tvdssTicks(Float64Array.from([0, 10, 20, 30, 40]), dev, 0, 40, 5).map((t) => +t.md.toFixed(6))).toEqual([0, 10, 20, 30, 40]);
  });

  it('el pozo del TP no tiene elevación: solo MD y la pista de profundidad no se ensancha', () => {
    const { well } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    expect(wellTvdss(well)).toBeNull();
    const t = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth: well.depth.values, curves: well.curves, computed: [], catalog: registry.roles, tvdss: wellTvdss(well) }, {}, { look: 'classic' });
    const d = t.find((x) => x.kind === 'depth')!;
    expect(d.tvdss).toBeUndefined();
    expect(d.fixed).toBe(DEPTH_TRACK_WIDTH);
  });

  it('con KB, el perfil clásico suma la columna TVDSS; «Moderno» no', () => {
    const w = createWell({ id: 'w', name: 'W', header: { EKB: { value: 25, unit: 'm' } }, depth, curves: [] });
    const tvdss = wellTvdss(w);
    expect(tvdss).not.toBeNull();
    expect(wellTvdss(w)).toBe(tvdss); // en caché
    const src = { depth, curves: [], computed: [], catalog: defaultRoleCatalog, tvdss };
    const c = resolveTracks(BUILTIN_LAYOUTS.petrophysics, src, {}, { look: 'classic' }).find((x) => x.kind === 'depth')!;
    expect(c.tvdss).toBe(tvdss);
    expect(c.fixed).toBe(DEPTH_TRACK_WIDTH_TVDSS);
    const m = resolveTracks(MODERN_LAYOUTS.petrophysics, src, {}, { look: 'modern' }).find((x) => x.kind === 'depth')!;
    expect(m.tvdss).toBeUndefined();
  });
});

describe('escalas de impresión', () => {
  it('1:200 … 1:5000 con su equivalencia en cm cada 100 m', () => {
    expect([...PRINT_SCALES]).toEqual([200, 500, 1000, 2000, 5000]);
    expect(PRINT_SCALES.map(cmPer100m)).toEqual([50, 20, 10, 5, 2]);
    const opts = printScaleOptions({ minPxPerM: 0.1, maxPxPerM: 1000 });
    expect(opts.map((o) => [o.label, o.detail])).toEqual([
      ['1:200', '50 cm cada 100 m'],
      ['1:500', '20 cm cada 100 m'],
      ['1:1.000', '10 cm cada 100 m'],
      ['1:2.000', '5 cm cada 100 m'],
      ['1:5.000', '2 cm cada 100 m'],
    ]);
    // la escala del visor y la del selector son la misma cuenta
    for (const o of opts) expect(scaleRatio(o.pxPerM)).toBeCloseTo(o.denominator, 6);
  });

  it('fuera de los límites del pozo, deshabilitadas con el motivo', () => {
    const depth = Float64Array.from({ length: 101 }, (_, i) => 1000 + i); // 100 m, paso 1 m
    const lim = viewportLimits(depth, 800, 1); // 8 px/m para verlo entero ≈ 1:470
    const opts = printScaleOptions(lim);
    expect(opts.find((o) => o.denominator === 200)!.disabled).toBeNull();
    expect(opts.find((o) => o.denominator === 1000)!.disabled).toMatch(/entero/);
    const fine = printScaleOptions({ minPxPerM: 0.1, maxPxPerM: 10 });
    expect(fine.find((o) => o.denominator === 200)!.disabled).toMatch(/zoom máximo/);
  });

  it('marca la escala elegida y rotula el botón', () => {
    expect(matchingPrintScale(pxPerMeterForScale(1000))).toBe(1000);
    expect(matchingPrintScale(pxPerMeterForScale(1300))).toBeNull();
    expect(scaleButtonLabel(pxPerMeterForScale(500))).toBe('1:500');
    expect(scaleButtonLabel(pxPerMeterForScale(9612))).toBe('1:9.600');
  });
});

describe('tramas litológicas', () => {
  it('convención: puntos para arena, rayas horizontales para arcilla, ladrillos para caliza, juntas inclinadas en dolomía', () => {
    expect(lithologyTile('sand')!.dots!.length).toBeGreaterThan(0);
    expect(lithologyTile('sand')!.lines).toBeUndefined();
    const shale = lithologyTile('shale')!;
    expect(shale.lines!.every(([, y0, , y1]) => y0 === y1)).toBe(true); // horizontales
    const lime = lithologyTile('limestone')!;
    const vertical = lime.lines!.filter(([x0, , x1]) => x0 === x1);
    expect(vertical.length).toBe(2);
    expect(new Set(vertical.map(([x]) => x)).size).toBe(2); // juntas alternadas (ladrillos)
    const dolo = lithologyTile('dolomite')!;
    expect(dolo.lines!.some(([x0, y0, x1, y1]) => x0 !== x1 && y0 !== y1)).toBe(true); // inclinadas
    // fluidos, carbón y resto sin partir van lisos
    for (const f of ['water', 'hydrocarbon', 'pore', 'coal', 'undivided', 'desconocido']) expect(lithologyTile(f)).toBeNull();
    for (const t of Object.values(LITHOLOGY_TILES)) expect(t!.width * t!.height).toBeGreaterThan(0);
  });

  it('se ven a 1:200, se aclaran al alejar y desaparecen a escala de pozo completo', () => {
    expect(patternOpacity(pxPerMeterForScale(200))).toBe(1);
    expect(patternOpacity(pxPerMeterForScale(PATTERN_FULL_SCALE))).toBe(1);
    const mid = patternOpacity(pxPerMeterForScale(2500));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(patternOpacity(pxPerMeterForScale(PATTERN_HIDDEN_SCALE))).toBe(0);
    expect(patternOpacity(pxPerMeterForScale(10000))).toBe(0);
    expect(patternOpacity(0)).toBe(0);
  });

  it('la trama acompaña a la profundidad al desplazar (fase en [0, alto del mosaico))', () => {
    expect(patternPhase(0, 10, 8)).toBe(0);
    const a = patternPhase(100.3, 10, 8);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(8);
    // bajar 0,8 m a 10 px/m = 8 px = un mosaico: misma fase
    expect(patternPhase(101.1, 10, 8)).toBeCloseTo(a, 6);
  });
});

describe('estilo de fábrica y proyectos guardados', () => {
  it('el de fábrica es el clásico; un proyecto sin estilo lo usa y conserva sus pistas propias', () => {
    expect(DEFAULT_LOOK).toBe('classic');
    expect(lookOf(undefined).id).toBe('classic');
    expect(lookOf('cualquiera').id).toBe('classic');
    expect(layoutFor('petrophysics', {})).toBe(BUILTIN_LAYOUTS.petrophysics);
    expect(layoutFor('petrophysics', {}, 'modern')).toBe(MODERN_LAYOUTS.petrophysics);
    const mine: TrackSpec[] = [{ id: 'a', title: 'Mía', kind: 'curves', curves: [{ select: { role: 'GR' } }] }];
    expect(layoutFor('petrophysics', { petrophysics: mine }, 'classic')).toBe(mine);
    expect(layoutFor('petrophysics', { petrophysics: mine }, 'modern')).toBe(mine);
  });

  it('el estilo se guarda solo si no es el de fábrica y se valida al abrir', () => {
    const p = createProject('P');
    expect(setViewerLook(p, 'classic')).toBe(p);
    const m = setViewerLook(p, 'modern');
    expect(m.display.look).toBe('modern');
    expect(setViewerLook(m, 'classic').display.look).toBeUndefined();
    const warn: string[] = [];
    expect(sanitizeDisplay({ look: 'modern' }, (w) => warn.push(w)).look).toBe('modern');
    expect(sanitizeDisplay({ look: 'classic' }).look).toBeUndefined();
    expect(sanitizeDisplay({ look: 'neón' }, (w) => warn.push(w)).look).toBeUndefined();
    expect(warn).toHaveLength(1);
  });

  it('clásico: GR con un solo relleno (arcilla); Porosidad · Sw con el relleno de BVW; Moderno sin cambios', () => {
    const corr = factoryLayout('petrophysics').find((t) => t.id === 'correlation')!;
    expect(corr.fills!.map((f) => f.kind === 'edge' ? f.fill : f.kind)).toEqual(['shale', 'between']);
    const sat = factoryLayout('petrophysics').find((t) => t.id === 'saturation')!;
    expect(sat.fills).toEqual([
      { kind: 'between', a: 'BVW', b: 'PHIE', aLeft: 'hydrocarbon', compare: 'value', opacity: 1 },
      { kind: 'baseline', curve: 'BVW', value: 0, left: 'water', right: 'water', opacity: 1 },
    ]);
    expect(factoryLayout('petrophysics', 'modern').find((t) => t.id === 'correlation')!.fills!.some((f) => f.kind === 'edge' && f.fill === 'sand')).toBe(true);
    expect(factoryLayout('petrophysics').map((t) => t.id)).toEqual(factoryLayout('petrophysics', 'modern').map((t) => t.id));
  });

  it('BVW: hidrocarburo = PHIE − BVW (entre las curvas) y agua = BVW (hasta cero), por valor', () => {
    const depth = Float64Array.from([0, 1]);
    const phie: Curve = { id: 'p', mnemonic: 'PHIE', role: 'PHIE', unit: 'v/v', data: Float64Array.from([0.25, 0.25]), origin: { kind: 'measured' } };
    const bvw: Curve = { id: 'b', mnemonic: 'BVW', role: 'BVW', unit: 'v/v', data: Float64Array.from([0.1, 0.1]), origin: { kind: 'measured' } };
    const t = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth, curves: [phie, bvw], computed: [], catalog: defaultRoleCatalog }, {}, { look: 'classic' }).find((x) => x.id === 'saturation')!;
    const between = t.fills.find((f) => f.kind === 'between')!;
    expect([between.a.role, between.b!.role, between.aLeft, between.compare]).toEqual(['BVW', 'PHIE', 'hydrocarbon', 'value']);
    const base = t.fills.find((f) => f.kind === 'baseline')!;
    expect([base.a.role, base.baseline, base.aLeft, base.bLeft]).toEqual(['BVW', 0, 'water', 'water']);
  });
});

describe('paleta del perfil clásico', () => {
  it('líneas finas (≤ 1,25 px) y convención de color por curva', () => {
    for (const role of Object.keys(CURVE_PALETTE)) expect(curveStyle(role, 'light', defaultRoleCatalog, role, 'classic').width).toBeLessThanOrEqual(CLASSIC_MAX_LINE_WIDTH);
    const s = (r: string) => curveStyle(r, 'light', defaultRoleCatalog, r, 'classic');
    expect(s('RT').line).toBe('solid');
    expect(s('RM').line).toBe('dashed');
    expect(s('RS').line).toBe('dotted');
    expect(s('NPHI').line).toBe('dashed');
    expect(s('CALI').line).toBe('dashed');
    expect(s('GR').color).toBe('#17663a'); // verde oscuro
    // colores oscuros: contraste de línea ≥ 4,5 sobre el fondo de pista
    for (const r of ['GR', 'RT', 'RM', 'RS', 'RHOB', 'NPHI', 'PEF', 'DT', 'CALI']) {
      expect(contrastRatio(s(r).color, THEMES.light.viewer.trackBg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(curveStyle(r, 'dark', defaultRoleCatalog, r, 'classic').color, THEMES.dark.viewer.trackBg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el grosor de plantilla se acota y el del usuario manda', () => {
    const depth = Float64Array.from([0, 1]);
    const gr: Curve = { id: 'gr', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.from([50, 60]), origin: { kind: 'measured' } };
    const layout: TrackSpec[] = [{ id: 't', title: 'T', kind: 'curves', curves: [{ select: { role: 'GR' }, style: { width: 3 } }] }];
    const src = { depth, curves: [gr], computed: [], catalog: defaultRoleCatalog };
    expect(resolveTracks(layout, src, {}, { look: 'classic' })[0]!.curves[0]!.styles.light.width).toBe(CLASSIC_MAX_LINE_WIDTH);
    expect(resolveTracks(layout, src, { roles: { GR: { width: 2.5 } } }, { look: 'classic' })[0]!.curves[0]!.styles.light.width).toBe(2.5);
    expect(resolveTracks(layout, src)[0]!.curves[0]!.styles.light.width).toBe(3);
  });

  it('rellenos apagados: el de arcilla menos opaco y menos saturado que en Moderno', () => {
    const c = fillColor('shale', 'light', 'classic');
    const m = fillColor('shale', 'light', 'modern');
    expect(c.alpha).toBeLessThan(m.alpha);
    expect(c.color).not.toBe(m.color);
    expect(fillColor('water', 'light')).toEqual(fillColor('water', 'light', 'modern'));
  });
});

describe('menú contextual y medir', () => {
  const depth = Float64Array.from([100, 101, 102, 103]);
  const gr: Curve = { id: 'gr', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.from([20, 40, 140, 60]), origin: { kind: 'measured' } };
  const sp: Curve = { id: 'sp', mnemonic: 'SP', role: 'SP', unit: 'mV', data: Float64Array.from([-20, -20, -20, -20]), origin: { kind: 'measured' } };
  const tracks = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth, curves: [gr, sp], computed: [], catalog: defaultRoleCatalog }, {}, { look: 'classic' });

  it('copia la profundidad y una lectura por curva, separadas por tabulador', () => {
    const text = readingsText(tracks, 2, 102, null);
    const lines = text.split('\n');
    expect(lines[0]).toBe('MD\t102,00 m');
    expect(lines).toContain('GR\t140 gAPI');
    expect(text).not.toContain('TVDSS');
    expect(readingsText(tracks, 2, 102, Float64Array.from([90, 91, 92, 93])).split('\n')[1]).toBe('TVDSS\t92,00 m');
  });

  it('elige la curva más cercana al puntero en esa muestra', () => {
    const corr = tracks.find((t) => t.id === 'correlation')!;
    const box = { x: 0, width: 150 };
    // GR 140 en 0–150 → x ≈ 140
    expect(nearestCurveAt(corr, box, 2, 139)!.name).toBe('GR');
  });

  it('mide el intervalo en cualquier orden, con el espesor vertical si hay TVDSS', () => {
    const m = measureInterval(110, 100);
    expect(m).toEqual({ top: 100, base: 110, thickness: 10 });
    expect(measureLabel(m)).toBe('100,00–110,00 m · espesor 10,00 m');
    const dev = measureInterval(0, 20, Float64Array.from([0, 10, 20]), Float64Array.from([0, 5, 10]));
    expect(dev.vertical).toBeCloseTo(10, 9);
    expect(measureLabel(dev)).toContain('vertical 10,00 m');
  });

  it('crear un tope parte la zona en esa profundidad y la nueva hereda los parámetros', () => {
    const d = Float64Array.from({ length: 101 }, (_, i) => 1000 + i * 0.5); // 1000–1050 m
    const zones: Zone[] = [{ id: 'z', name: 'C', top: 1000, base: 1050, color: '#888888', kind: 'formation' }];
    const r = addTopAt(zones, 1020, { id: 'n', name: 'Z1', color: '#123456' }, { depth: d });
    if ('error' in r) throw new Error(r.error);
    expect(r.zones.map((z) => [z.name, z.top, z.base])).toEqual([
      ['C', 1000, 1019.5],
      ['Z1', 1020, 1050],
    ]);
    expect(r.clone).toEqual({ from: 'z', to: 'n' });
    // demasiado cerca del tope de la zona: error en español, sin cambios
    const near = addTopAt(zones, 1000.2, { id: 'n', name: 'Z1', color: '#123456' }, { depth: d });
    expect('error' in near && near.error).toMatch(/tope de C/);
    // en un hueco: zona nueva hasta la siguiente
    const gap = addTopAt([{ ...zones[0]!, top: 1030 }], 1010, { id: 'n', name: 'Z1', color: '#123456' }, { depth: d });
    if ('error' in gap) throw new Error(gap.error);
    expect(gap.created.top).toBe(1010);
    expect(gap.created.base).toBe(1029.5);
    expect(gap.clone).toBeNull();
  });
});

describe('proyecto del TP con el perfil clásico', () => {
  it('se resuelve con la paleta clásica y el mismo juego de pistas', () => {
    const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    const p = addWell(createProject('TP'), well, zones);
    const t = resolveTracks(layoutFor('petrophysics', p.display.layouts, p.display.look), { depth: well.depth.values, curves: well.curves, computed: [], catalog: registry.roles }, {}, { look: 'classic' });
    const gr = t.find((x) => x.id === 'correlation')!.curves.find((c) => c.role === 'GR')!;
    expect(gr.styles.light.width).toBe(1);
    expect(gr.styles.light.color).toBe('#17663a');
  });
});

describe('zonas en el perfil clásico', () => {
  // Contexto 2D falso: registra rectángulos rellenos y textos.
  function fakeCtx() {
    const rects: { x: number; w: number; style: string }[] = [];
    const texts: string[] = [];
    const ctx = new Proxy(
      { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', lineJoin: '' } as Record<string, unknown>,
      {
        get(target, k) {
          if (k === 'fillRect') return (x: number, _y: number, w: number) => rects.push({ x, w, style: String(target.fillStyle) });
          if (k === 'fillText') return (t: string) => texts.push(t);
          if (k in target) return target[k as string];
          return () => {};
        },
        set(target, k, v) {
          target[k as string] = v;
          return true;
        },
      },
    );
    return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, texts };
  }
  const n = 201;
  const d = Float64Array.from({ length: n }, (_, i) => 1000 + i * 0.5);
  const grC: Curve = { id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: new Float64Array(n).fill(60), origin: { kind: 'measured' } };
  const layout: TrackSpec[] = [{ id: 'depth', title: 'Prof.', kind: 'depth' }, { id: 'c', title: 'Correlación', kind: 'curves', curves: [{ select: { role: 'GR' } }] }];

  it('sin teñir las pistas: solo la franja junto a la profundidad; tope como línea y nombre en texto', async () => {
    const { createZonesOverlay } = await import('../../src/viewer/overlays/zones');
    const { overlayTracks, overlayViewport } = await import('../../src/viewer/render');
    const { layoutTracks } = await import('../../src/viewer/layout');
    const tracks = resolveTracks(layout, { depth: d, curves: [grC], computed: [], catalog: defaultRoleCatalog });
    const boxes = layoutTracks(tracks, 400).boxes;
    const zones = [{ id: 'a', name: 'A', top: 1000, base: 1040, color: '#5b8def' }, { id: 'b', name: 'B', top: 1040.5, base: 1100, color: '#e58f3c' }];
    const [under, over] = createZonesOverlay({});
    const frame = (look: 'classic' | 'modern') => {
      const f = fakeCtx();
      const base = {
        ctx: f.ctx,
        theme: THEMES.light,
        viewport: overlayViewport({ top: 1000, pxPerM: 4, height: 400 }),
        tracks: overlayTracks(tracks, boxes),
        data: { wellId: 'w', depth: d, zones, selectedZoneId: null, qc: null, well: {} as never, interpretation: {} as never, computed: [] },
        invalidate: () => {},
        look,
      };
      under!.draw(base);
      over!.draw(base);
      return f;
    };
    const c = frame('classic');
    const depthBox = boxes[0]!;
    // Todas las franjas en la pista de profundidad, angostas; ninguna banda en la pista de curvas.
    expect(c.rects.length).toBe(2);
    for (const r of c.rects) {
      expect(r.x).toBe(depthBox.x);
      expect(r.w).toBeLessThanOrEqual(8);
    }
    expect(c.texts).toEqual(['A', 'B']);
    // «Moderno»: bandas en la pista de curvas (como antes).
    const m = frame('modern');
    expect(m.rects.some((r) => r.x === boxes[1]!.x && r.w === boxes[1]!.width)).toBe(true);
  });
});
