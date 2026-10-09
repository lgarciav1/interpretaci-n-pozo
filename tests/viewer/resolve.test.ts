import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import type { TrackSpec } from '../../src/core/display';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell, type Curve } from '../../src/core/well';
import { readWellFile } from '../../src/io';
import { registry } from '../../src/modules';
import { AreaSink, fillBetween } from '../../src/viewer/fills';
import { resolveTracks, type ComputedCurve, type ResolvedTrack } from '../../src/viewer/resolve';
import { fractionArray } from '../../src/viewer/scale';
import { BUILTIN_LAYOUTS, layoutFor } from '../../src/viewer/templates';

const PURE = import.meta.glob(['../../src/viewer/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function measured(id: string, role: string | null, values: number[], unit?: string): Curve {
  return { id, mnemonic: id, role, unit: unit ?? (role ? defaultRoleCatalog.unitOf(role) : 'unitless'), data: Float64Array.from(values), origin: { kind: 'measured' } };
}

const track = (tracks: ResolvedTrack[], id: string) => tracks.find((t) => t.id === id)!;

/** Áreas de un relleno entre dos curvas resueltas, en fracciones de ancho × muestras. */
function crossoverAreas(t: ResolvedTrack) {
  const fill = t.fills.find((f) => f.kind === 'between')!;
  const fa = fractionArray(fill.a.data, fill.a.axis);
  const fb = fractionArray(fill.b!.data, fill.b!.axis);
  const n = fa.length;
  const y = Float64Array.from({ length: n }, (_, i) => i);
  const aLeft = new AreaSink();
  const bLeft = new AreaSink();
  fillBetween(n, y, fa, fb, aLeft, bLeft, 0, 1);
  return { fill, aLeft: aLeft.area, bLeft: bLeft.area };
}

describe('las fuentes puras del visor no importan React ni stores', () => {
  it('src/viewer/**/*.ts (todo menos WellViewer.tsx)', () => {
    const files = Object.entries(PURE);
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const [f, src] of files) {
      expect(src, f).not.toMatch(/from ['"](react|react-dom|zustand)(\/[^'"]*)?['"]/);
      expect(src, f).not.toMatch(/from ['"][./]*app\//);
      expect(src, f).not.toMatch(/from ['"][./]*ui['"]/); // el índice de ui trae componentes React
    }
  });
});

describe('densidad–neutrón en escalas compatibles (RHOB 1,95–2,95; NPHI 0,45 → −0,15)', () => {
  const tracksFor = (rhob: number[], nphi: number[]) => {
    const n = rhob.length;
    const w = createWell({ id: 'w', name: 'W', depth: Float64Array.from({ length: n }, (_, i) => 1000 + i), curves: [measured('RHOZ', 'RHOB', rhob), measured('TNPH', 'NPHI', nphi)] });
    return resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth: w.depth.values, curves: w.curves, computed: [], catalog: defaultRoleCatalog });
  };

  it('arena con gas (RHOB 2,10; NPHI 0,08): la densidad queda a la izquierda → cruce de gas', () => {
    const t = track(tracksFor([2.1, 2.1], [0.08, 0.08]), 'porosity');
    const { fill, aLeft, bLeft } = crossoverAreas(t);
    expect(fill.a.role).toBe('RHOB');
    expect(fill.aLeft).toBe('gasCrossover');
    expect(fill.bLeft).toBe('shaleCrossover');
    // x_RHOB = (2,10 − 1,95)/1 = 0,15; x_NPHI = (0,45 − 0,08)/0,6 = 0,6167 → 0,4667 de ancho por muestra
    expect(aLeft).toBeCloseTo(0.6166667 - 0.15, 5);
    expect(bLeft).toBe(0);
  });

  it('arcilla (RHOB 2,55; NPHI 0,36): el neutrón queda a la izquierda → separación de arcilla', () => {
    const { aLeft, bLeft } = crossoverAreas(track(tracksFor([2.55, 2.55], [0.36, 0.36]), 'porosity'));
    // x_RHOB = 0,60; x_NPHI = 0,15
    expect(bLeft).toBeCloseTo(0.45, 6);
    expect(aLeft).toBe(0);
  });

  it('caliza con agua (φ = 0,20: RHOB = 2,71 − 0,2·1,71 = 2,368; NPHI = 0,20): las curvas se superponen', () => {
    const { aLeft, bLeft } = crossoverAreas(track(tracksFor([2.368, 2.368], [0.2, 0.2]), 'porosity'));
    expect(aLeft + bLeft).toBeLessThan(0.005);
  });

  it('transición gas → arcilla: el cruce se reparte en la profundidad interpolada', () => {
    // muestra 0: gas (densidad 0,30 a la izquierda); muestra 1: arcilla (neutrón 0,30 a la izquierda) → cruce en 0,5
    const { aLeft, bLeft } = crossoverAreas(track(tracksFor([2.15, 2.55], [0.15, 0.45 - 0.6 * 0.3]), 'porosity'));
    // x_RHOB: 0,20 → 0,60; x_NPHI: 0,50 → 0,30. Diferencias −0,30 y +0,30 → triángulos de 0,30 × 0,5 / 2
    expect(aLeft).toBeCloseTo(0.075, 6);
    expect(bLeft).toBeCloseTo(0.075, 6);
  });

  it('NPHI en % y densidad en kg/m³ se convierten a la unidad canónica antes de dibujar', () => {
    const w = createWell({ id: 'w', name: 'W', depth: Float64Array.from([1, 2]), curves: [measured('RHOZ', 'RHOB', [2100, 2100], 'kg/m3'), measured('NPOR', 'NPHI', [8, 8], '%')] });
    const t = track(resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth: w.depth.values, curves: w.curves, computed: [], catalog: defaultRoleCatalog }), 'porosity');
    expect(t.curves.find((c) => c.role === 'RHOB')!.data[0]).toBeCloseTo(2.1, 12);
    expect(t.curves.find((c) => c.role === 'NPHI')!.data[0]).toBeCloseTo(0.08, 12);
    expect(t.curves.find((c) => c.role === 'NPHI')!.unitLabel).toBe('v/v');
    expect(crossoverAreas(t).aLeft).toBeCloseTo(0.6166667 - 0.15, 5);
  });
});

describe('caliper vs. trépano', () => {
  it('relleno de derrumbe solo donde CALI > BS', () => {
    const w = createWell({ id: 'w', name: 'W', depth: Float64Array.from([1, 2, 3]), curves: [measured('CAL', 'CALI', [8.5, 10.5, 10.5]), measured('BS', 'BS', [8.5, 8.5, 8.5])] });
    const t = track(resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth: w.depth.values, curves: w.curves, computed: [], catalog: defaultRoleCatalog }), 'correlation');
    const f = t.fills.find((x) => x.kind === 'between')!;
    expect([f.a.role, f.b!.role, f.aLeft, f.bLeft]).toEqual(['BS', 'CALI', 'washout', undefined]);
    const fa = fractionArray(f.a.data, f.a.axis);
    const fb = fractionArray(f.b!.data, f.b!.axis);
    const washout = new AreaSink();
    const mudcake = new AreaSink();
    fillBetween(3, [0, 1, 2], fa, fb, washout, mudcake, 0, 1);
    // 2 in de 10 (escala 6–16): triángulo 0→1 (0,1) + rectángulo 1→2 (0,2)
    expect(washout.area).toBeCloseTo(0.3, 6); // fracciones en Float32
    expect(mudcake.area).toBe(0);
  });
});

describe('pistas del pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  const { well } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const src = { depth: well.depth.values, curves: well.curves, computed: [] as ComputedCurve[], catalog: registry.roles };
  const tracks = resolveTracks(BUILTIN_LAYOUTS.petrophysics, src);

  it('resistividad en log 0,2–2000 con AT10/AT30 (sin rol) y la profunda (AT90) encima', () => {
    const t = track(tracks, 'resistivity');
    expect(t.grid).toEqual({ kind: 'log', min: 0.2, max: 2000, reversed: false });
    expect(t.curves.map((c) => c.name)).toEqual(['AT10', 'AT30', 'AT60', 'AT90']);
    for (const c of t.curves) expect(c.axis).toEqual({ kind: 'log', min: 0.2, max: 2000, reversed: false });
    const at90 = t.curves.at(-1)!;
    expect(at90.role).toBe('RT');
    expect(at90.styles.light.width).toBeGreaterThan(t.curves[0]!.styles.light.width);
    // dos curvas sin rol con colores distintos (categóricos estables)
    expect(t.curves[0]!.styles.light.color).not.toBe(t.curves[1]!.styles.light.color);
  });

  it('correlación: GR con curva de respaldo y rellenos arena/arcilla; caliper vs. trépano', () => {
    const t = track(tracks, 'correlation');
    expect(t.curves.map((c) => c.name)).toEqual(['BS', 'CAL', 'SP', 'GR']);
    expect(t.curves.find((c) => c.name === 'GR')!.wrap).toBe(true);
    expect(t.fills.map((f) => [f.kind, f.aLeft ?? f.bLeft, f.compare])).toEqual([
      ['edge', 'shale', 'screen'],
      ['edge', 'sand', 'screen'],
      ['between', 'washout', 'value'],
    ]);
  });

  it('sin calculadas: la pista de interpretación existe y está vacía; las que se ocultan no aparecen', () => {
    expect(track(tracks, 'computed').curves).toEqual([]);
    expect(track(tracks, 'computed').emptyHint).toBeTruthy();
    expect(tracks.map((t) => t.id)).toEqual(['correlation', 'depth', 'resistivity', 'porosity', 'sonic', 'computed']);
  });

  it('las calculadas aparecen solas: IGR en su lugar, banderas en su franja y un rol nuevo en Interpretación', () => {
    const n = well.depth.values.length;
    const computed: ComputedCurve[] = [
      { port: 'IGR', moduleId: 'igr', label: 'IGR', data: new Float64Array(n).fill(0.4), active: true },
      { port: 'SHALE_FLAG', moduleId: 'shale-flag', label: 'Bandera', data: new Float64Array(n).fill(1), active: true },
      { port: 'VSH', moduleId: 'vsh-alt', label: 'VSH alternativa', data: new Float64Array(n), active: false },
      { port: 'XYZ', moduleId: 'nuevo', label: 'Rol desconocido', data: new Float64Array(n).fill(3), active: true },
    ];
    const t2 = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { ...src, computed });
    expect(track(t2, 'computed').curves.map((c) => c.key)).toEqual(['c:igr:IGR', 'c:nuevo:XYZ']);
    expect(track(t2, 'flags').curves.map((c) => c.name)).toEqual(['SHALE_FLAG']);
    expect(track(t2, 'flags').fixed).toBeGreaterThan(0);
    // rol sin escala conocida → rango de los datos
    const xyz = track(t2, 'computed').curves[1]!;
    expect(xyz.axis.min).toBeLessThan(3);
    expect(xyz.axis.max).toBeGreaterThan(3);
    // las alternativas (compare) no se dibujan
    expect(t2.flatMap((t) => t.curves).some((c) => c.moduleId === 'vsh-alt')).toBe(false);
  });

  it('overrides: curva > rol > plantilla; color con contraste en ambos temas; ocultar', () => {
    const t2 = resolveTracks(BUILTIN_LAYOUTS.petrophysics, src, {
      roles: { GR: { min: 0, max: 200, wrap: false }, RM: { hidden: true } },
      curves: { GR: { color: '#ffff00' } },
    });
    const gr = track(t2, 'correlation').curves.find((c) => c.name === 'GR')!;
    expect(gr.axis).toEqual({ kind: 'linear', min: 0, max: 200, reversed: false });
    expect(gr.wrap).toBe(false);
    expect(gr.styles.dark.color).toBe('#ffff00');
    expect(gr.styles.light.color).not.toBe('#ffff00'); // amarillo sobre blanco se oscurece hasta 3:1
    expect(track(t2, 'resistivity').curves.map((c) => c.name)).toEqual(['AT10', 'AT30', 'AT90']);
  });

  it('una pista con { curveId } toma esa curva; layoutFor prefiere las pistas propias del proyecto', () => {
    const custom: TrackSpec[] = [{ id: 'mia', title: 'Mía', kind: 'curves', curves: [{ select: { curveId: 'AT10' } }] }];
    expect(layoutFor('petrophysics', { petrophysics: custom })).toBe(custom);
    expect(layoutFor('geology', { petrophysics: custom })).toBe(BUILTIN_LAYOUTS.geology);
    const t = resolveTracks(custom, src);
    expect(t[0]!.curves.map((c) => c.name)).toEqual(['AT10']);
    expect(t[0]!.grid).toEqual(t[0]!.curves[0]!.axis);
  });

  it('geología: GR espectral, litología con cruce y RMN con agua ligada y libre', () => {
    const g = resolveTracks(BUILTIN_LAYOUTS.geology, src);
    expect(track(g, 'spectral').curves.map((c) => c.name)).toEqual(['POTA', 'THOR', 'URAN', 'GR']);
    expect(track(g, 'nmr').curves.map((c) => c.name)).toEqual(['PHI_BVI', 'PHIE_CMR', 'PHIT_CMR']);
    expect(track(g, 'nmr').fills.map((f) => f.aLeft ?? f.bLeft)).toEqual(['boundWater', 'water']);
    expect(track(g, 'lithology').fills).toHaveLength(1);
  });

  it('las plantillas de fábrica solo usan roles conocidos y rellenos de la paleta', () => {
    for (const layout of Object.values(BUILTIN_LAYOUTS)) {
      for (const t of layout) {
        for (const c of t.curves ?? []) if ('role' in c.select) expect(registry.roles.has(c.select.role), c.select.role).toBe(true);
      }
    }
  });
});
