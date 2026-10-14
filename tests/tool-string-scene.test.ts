/**
 * Escena 3D de la sarta (docs/decisiones/0033): la descripción pura, sin WebGL. Lo importante es que no engañe: radios
 * y profundidades de investigación a escala real entre sí, largos con una compresión uniforme, nada que atraviese la
 * pared y el estado de cada herramienta (apagada, planificada sin datos, seleccionada) visible.
 */
import { describe, expect, it } from 'vitest';
import type { RoleId } from '../src/core/roles';
import { resolveToolString, type ToolStringState } from '../src/core/toolString';
import { defaultToolCatalog } from '../src/core/tools';
import { THEMES } from '../src/ui/tokens';
import {
  AXIAL_SCENE_PER_M,
  CM_PER_IN,
  DEFAULT_BOREHOLE_IN,
  GENERIC_DIAMETER_IN,
  GENERIC_LENGTH_M,
  bandAlpha,
  boreholeDiameter,
  buildToolStringScene,
  initialCamera,
  shellSpecs,
  type ScenePrimitive,
  type SceneInput,
} from '../src/app/toolString/scene';

const curve = (id: string, role: RoleId) => ({ id, mnemonic: id, role });
/** Pozo tipo del TP: calibre, GR, SP, densidad, neutrón, sónico, inducción de arreglo, microrresistividad. */
const CURVES = [
  curve('CAL', 'CALI'),
  curve('GR', 'GR'),
  curve('SP', 'SP'),
  curve('ZDEN', 'RHOB'),
  curve('PE', 'PEF'),
  curve('NPHI', 'NPHI'),
  curve('DT', 'DT'),
  curve('AT10', 'RA10'),
  curve('AT30', 'RA30'),
  curve('AT60', 'RM'),
  curve('AT90', 'RT'),
  curve('MSFL', 'RXO'),
];

const ACCENT = '#ff00aa';
function scene(state?: Partial<ToolStringState>, extra: Partial<SceneInput> = {}, curves = CURVES) {
  const st: ToolStringState | undefined = state ? { mode: 'data', off: [], order: [], plan: [], planOff: [], ...state } : undefined;
  const resolved = resolveToolString(curves, st, defaultToolCatalog);
  return buildToolStringScene({
    entries: resolved.entries,
    mode: resolved.mode,
    borehole: { diameterIn: 8.5, schematic: false },
    colors: THEMES.light.scene,
    accent: ACCENT,
    curveColor: (r) => `color-${r}`,
    ...extra,
  });
}
const rWall = (8.5 * CM_PER_IN) / 2;
const layout = (s: ReturnType<typeof scene>, id: string) => s.tools.find((t) => t.toolId === id)!;
const prims = (s: ReturnType<typeof scene>, toolId: string) => s.primitives.filter((p) => p.pick && 'toolId' in p.pick && p.pick.toolId === toolId);

describe('escena de la sarta: escala', () => {
  it('las profundidades de investigación están a escala real desde la pared (la inducción profunda ≫ la microrresistividad)', () => {
    const s = scene();
    const ind = s.shells.filter((x) => x.toolId === 'induction');
    expect(ind.map((x) => x.role)).toEqual(['RA10', 'RA20', 'RA30', 'RM', 'RT']);
    for (const [x, doi] of ind.map((x, i) => [x, [10, 20, 30, 60, 90][i]!] as const)) {
      expect(x.radius - rWall).toBeCloseTo(doi * CM_PER_IN, 9);
      expect(x.rWall).toBeCloseTo(rWall, 9);
    }
    const rxo = s.shells.find((x) => x.toolId === 'microresistivity')!;
    expect(rxo.doiCm).toBeCloseTo(2 * CM_PER_IN, 9);
    // Lo que la vista enseña: 90 in contra 2 in, en la misma escala que los radios de las herramientas.
    expect(ind.at(-1)!.doiCm / rxo.doiCm).toBeCloseTo(45, 9);
    expect(ind.at(-1)!.doiCm).toBeGreaterThan(100);
    expect(rxo.doiCm).toBeLessThan(10);
    // Cáscaras con el color de la curva del visor.
    expect(ind.map((x) => x.color)).toEqual(['color-RA10', 'color-RA20', 'color-RA30', 'color-RM', 'color-RT']);
  });

  it('radios a escala real y largos con compresión uniforme; las medidas faltantes son esquemáticas', () => {
    const s = scene({ mode: 'planning', plan: ['spectral-gr', 'density', 'nmr', 'laterolog', 'gr'] });
    const den = layout(s, 'density');
    expect(den.radius).toBeCloseTo((4.5 * CM_PER_IN) / 2, 9);
    expect(den.schematicDiameter).toBe(false);
    expect(den.schematicLength).toBe(true);
    expect(den.y1 - den.y0).toBeCloseTo(GENERIC_LENGTH_M * AXIAL_SCENE_PER_M, 9);
    const nmr = layout(s, 'nmr');
    const sgr = layout(s, 'spectral-gr');
    const ll = layout(s, 'laterolog');
    expect(nmr.y1 - nmr.y0).toBeCloseTo(16 * AXIAL_SCENE_PER_M, 9);
    expect(ll.y1 - ll.y0).toBeCloseTo(7.35 * AXIAL_SCENE_PER_M, 9);
    // Misma compresión para todas: la relación de largos es la real.
    expect((nmr.y1 - nmr.y0) / (sgr.y1 - sgr.y0)).toBeCloseTo(16 / 2.6, 9);
    expect(ll.schematicLength).toBe(false);
    const gr = layout(s, 'gr');
    expect(gr.diameterIn).toBe(3.6);
    expect(layout(s, 'induction' as string)).toBeUndefined();
    expect(AXIAL_SCENE_PER_M).toBe(10);
    expect(GENERIC_DIAMETER_IN).toBeGreaterThan(0);
  });

  it('apila de arriba a abajo en el orden de la sarta, sin superponerse', () => {
    const s = scene({ order: ['induction', 'gr'] });
    const own = s.tools.filter((t) => !t.hostId);
    for (let i = 1; i < own.length; i++) expect(own[i]!.y1).toBeLessThan(own[i - 1]!.y0);
    expect(own[0]!.toolId).toBe('induction');
    expect(own[1]!.toolId).toBe('gr');
    expect(own[0]!.y1).toBeLessThan(0); // debajo de la cabeza de cable
  });

  it('nada de la sarta atraviesa la pared del pozo', () => {
    const s = scene();
    const radial = (x: number, z: number) => Math.hypot(x, z);
    for (const p of s.primitives) {
      switch (p.kind) {
        case 'cylinder':
          expect(radial(...p.center) + p.radius, p.key).toBeLessThanOrEqual(rWall + 1e-9);
          break;
        case 'pad':
          expect(p.rOuter, p.key).toBeLessThan(rWall);
          break;
        case 'rod':
          expect(Math.max(radial(p.from[0], p.from[2]), radial(p.to[0], p.to[2])), p.key).toBeLessThan(rWall);
          break;
        case 'bow':
          expect(p.rOut, p.key).toBeLessThan(rWall);
          break;
        case 'ring':
          expect(radial(...p.center) + p.radius, p.key).toBeLessThan(rWall);
          break;
      }
    }
  });

  it('montaje: excentralizada apoyada en la pared, centralizada en el eje con flejes, patín contra la pared', () => {
    const s = scene({}, {}, [...CURVES, curve('PHIT', 'PHIT_NMR')]);
    const nmr = layout(s, 'nmr');
    expect(Math.hypot(...nmr.center) + nmr.radius).toBeCloseTo(rWall, 9);
    const ind = layout(s, 'induction');
    expect(ind.center).toEqual([0, 0]);
    expect(s.primitives.filter((p) => p.kind === 'bow' && p.key.startsWith('bow:induction:'))).toHaveLength(4);
    for (const p of s.primitives.filter((p) => p.kind === 'bow')) expect(p.pick).toEqual({ fixed: 'Centralizador de flejes' });
    const pad = s.primitives.find((p) => p.key === 'pad:density')!;
    expect(pad.kind).toBe('pad');
    expect(s.primitives.find((p) => p.key === 'head')!.pick).toEqual({ fixed: 'Cabeza de cable y telemetría' });
  });
});

describe('escena de la sarta: piezas', () => {
  it('el SP es un anillo sobre la inducción y el calibre el brazo de la densidad', () => {
    const s = scene();
    const ring = s.primitives.find((p) => p.kind === 'ring')!;
    expect(ring.pick).toEqual({ toolId: 'sp' });
    expect(layout(s, 'sp').hostId).toBe('induction');
    const ind = layout(s, 'induction');
    expect(ring.kind === 'ring' && ring.y).toBeGreaterThan(ind.y0);
    expect(layout(s, 'caliper').hostId).toBe('density');
    expect(prims(s, 'caliper').map((p) => p.kind).sort()).toEqual(['pad', 'rod']);
    // Sin cuerpo propio.
    expect(s.primitives.find((p) => p.key === 'body:sp' || p.key === 'body:caliper')).toBeUndefined();
  });

  it('sin resistividad ni densidad, el SP y el calibre son piezas cortas esquemáticas', () => {
    const s = scene({}, {}, [curve('SP', 'SP'), curve('CAL', 'CALI'), curve('GR', 'GR')]);
    for (const id of ['sp', 'caliper']) {
      const l = layout(s, id);
      expect(l.hostId).toBeUndefined();
      expect(l.y1 - l.y0).toBeCloseTo(1 * AXIAL_SCENE_PER_M, 9);
      expect(l.schematicLength).toBe(true);
    }
    // El SP no tiene profundidad de investigación: sin cáscara.
    expect(s.shells.find((x) => x.toolId === 'sp')).toBeUndefined();
  });

  it('banda difusa del rango cuando va más allá de las cáscaras (laterolog 25–98 in), no en la inducción (10–90 cubierto)', () => {
    const s = scene({ mode: 'planning', plan: ['laterolog', 'induction', 'density'] });
    const ll = s.bands.find((b) => b.toolId === 'laterolog')!;
    expect(ll.rMin - rWall).toBeCloseTo(25 * CM_PER_IN, 9);
    expect(ll.rPeak - rWall).toBeCloseTo(80 * CM_PER_IN, 9);
    expect(ll.rMax - rWall).toBeCloseTo(98 * CM_PER_IN, 9);
    expect(s.bands.find((b) => b.toolId === 'induction')).toBeUndefined();
    const den = s.bands.find((b) => b.toolId === 'density')!;
    expect(den.rMin).toBeCloseTo(den.rPeak, 9); // sin mínimo: arranca en el típico
    expect(bandAlpha(ll, ll.rPeak)).toBe(1);
    expect(bandAlpha(ll, ll.rMin)).toBe(0);
    expect(bandAlpha(ll, ll.rMax)).toBe(0);
    expect(bandAlpha(ll, (ll.rPeak + ll.rMax) / 2)).toBeCloseTo(0.5, 9);
    expect(bandAlpha(den, den.rPeak)).toBe(1);
  });

  it('la regla mide desde la pared y la formación encierra la cáscara más profunda', () => {
    const s = scene();
    expect(s.ruler.ticks.map((t) => t.label)).toEqual(['pared', '10 cm', '50 cm', '1 m', '2 m']);
    for (const t of s.ruler.ticks) expect(t.r - rWall).toBeGreaterThanOrEqual(0);
    expect(s.ruler.ticks[3]!.r - rWall).toBe(100);
    expect(s.environment.rOuter).toBeGreaterThan(Math.max(...s.shells.map((x) => x.radius)));
    expect(s.environment.y0).toBeLessThan(Math.min(...s.tools.map((t) => t.y0)));
  });
});

describe('escena de la sarta: estados', () => {
  it('apagada: gris translúcida y sin cáscaras; la formación no cambia de tamaño', () => {
    const on = scene();
    const off = scene({ off: ['induction'] });
    const body = off.primitives.find((p) => p.key === 'body:induction') as Extract<ScenePrimitive, { kind: 'cylinder' }>;
    expect(body.style.look).toBe('off');
    expect(body.style.color).toBe(THEMES.light.scene.off);
    expect(body.style.opacity).toBeLessThan(1);
    expect(off.shells.filter((x) => x.toolId === 'induction')).toEqual([]);
    expect(off.environment.rOuter).toBe(on.environment.rOuter);
  });

  it('planificada sin datos en el pozo: contorno y cáscaras más tenues', () => {
    const s = scene({ mode: 'planning', plan: ['gr', 'nmr'] });
    const nmr = s.primitives.find((p) => p.key === 'body:nmr') as Extract<ScenePrimitive, { kind: 'cylinder' }>;
    const gr = s.primitives.find((p) => p.key === 'body:gr') as Extract<ScenePrimitive, { kind: 'cylinder' }>;
    expect(nmr.style.look).toBe('ghost');
    expect(nmr.style.edge).toBe(THEMES.light.scene.outline);
    expect(gr.style.look).toBe('on');
    const sn = s.shells.find((x) => x.toolId === 'nmr')!;
    const sg = s.shells.find((x) => x.toolId === 'gr')!;
    expect(sn.opacity).toBeLessThan(sg.opacity);
  });

  it('seleccionada: color de acento, rótulo con su nombre y una etiqueta por cáscara', () => {
    const s = scene({}, { selectedId: 'induction', hoverId: 'gr' });
    const body = s.primitives.find((p) => p.key === 'body:induction') as Extract<ScenePrimitive, { kind: 'cylinder' }>;
    expect(body.style.emphasis).toBe('selected');
    expect(body.style.color).toBe(ACCENT);
    expect((s.primitives.find((p) => p.key === 'body:gr') as Extract<ScenePrimitive, { kind: 'cylinder' }>).style.emphasis).toBe('hover');
    expect(s.labels.filter((l) => l.kind === 'shell').map((l) => l.text)).toEqual(['RA10 · 10 in', 'RA20 · 20 in', 'RA30 · 30 in', 'RM · 60 in', 'RT · 90 in']);
    expect(s.labels.find((l) => l.kind === 'tool')!.text).toBe('Inducción');
  });

  it('las claves son únicas (el renderizador reutiliza mallas por clave)', () => {
    const s = scene({}, { selectedId: 'density' }, [...CURVES, curve('PHIT', 'PHIT_NMR'), curve('URAN', 'URAN')]);
    const keys = [...s.primitives.map((p) => p.key), ...s.shells.map((x) => x.key), ...s.bands.map((b) => b.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('escena de la sarta: auxiliares', () => {
  it('diámetro del pozo: mediana del trépano, si no del calibre, si no 8,5 in esquemático', () => {
    const f = (v: number[]) => Float64Array.from(v);
    expect(boreholeDiameter([{ role: 'BS', unit: 'in', data: f([8.5, 8.5, NaN, 12.25]) }, { role: 'CALI', unit: 'in', data: f([9]) }])).toEqual({ diameterIn: 8.5, schematic: false, source: 'BS' });
    expect(boreholeDiameter([{ role: 'CALI', unit: 'mm', data: f([215.9, 215.9, 300]) }]).diameterIn).toBeCloseTo(8.5, 9);
    expect(boreholeDiameter([{ role: 'GR', unit: 'gAPI', data: f([50]) }])).toEqual({ diameterIn: DEFAULT_BOREHOLE_IN, schematic: true, source: null });
  });

  it('cáscaras por curva cuando la ficha las tiene, si no la de la herramienta', () => {
    const sonic = defaultToolCatalog.get('sonic')!;
    expect(shellSpecs(sonic, { investigation: { typical: 8, unit: 'in' } })).toEqual([{ role: null, doiIn: 8 }]);
    expect(shellSpecs(sonic, { investigation: { typical: 20, unit: 'cm' } })[0]!.doiIn).toBeCloseTo(20 / CM_PER_IN, 9);
    expect(shellSpecs(sonic, {})).toEqual([]);
  });

  it('la vista inicial mira al centro desde el lado del corte y se aleja más en una vista angosta', () => {
    const s = scene();
    const wide = initialCamera(s, 2);
    const narrow = initialCamera(s, 0.6);
    expect(wide.target[1]).toBeCloseTo((s.bounds.min[1] + s.bounds.max[1]) / 2, 9);
    expect(wide.position[0]).toBeGreaterThan(0);
    expect(wide.position[2]).toBeGreaterThan(0);
    expect(wide.position[1]).toBeGreaterThan(wide.target[1]);
    expect(Math.hypot(...narrow.position.map((v, i) => v - narrow.target[i]!))).toBeGreaterThan(Math.hypot(...wide.position.map((v, i) => v - wide.target[i]!)));
  });
});
