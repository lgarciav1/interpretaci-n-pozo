/**
 * Plugs de corona sobre el visor (src/modules/core/overlay.ts, docs/decisiones/0010 D5): ubicación en la profundidad
 * corregida, arrastre de una corona con vista previa y UN solo commit al soltar, Escape (cancel) sin commit, ↑/↓
 * (`nudge`) y clic para incluir o descartar. El visor traduce Escape y las flechas a `drag.cancel` y `hit.nudge`.
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation, type Interpretation } from '../../src/core/interpretation';
import { createPointSet } from '../../src/core/pointSets';
import { defaultRoleCatalog } from '../../src/core/roles';
import { addWell, createProject, getWellEntry, type Project } from '../../src/core/state/project';
import { createWell, type Curve } from '../../src/core/well';
import { corePreview, overlays as coreOverlays, plugTracks } from '../../src/modules/core/overlay';
import { THEMES } from '../../src/ui/tokens';
import { layoutTracks, trackAt } from '../../src/viewer/layout';
import type { OverlayHitFrame, OverlayPointer, ViewerData } from '../../src/viewer/overlay';
import { overlayTracks, overlayViewport } from '../../src/viewer/render';
import { resolveTracks } from '../../src/viewer/resolve';
import { showRange, viewportLimits, yOf, type Viewport } from '../../src/viewer/viewport';

const depth = Float64Array.from({ length: 401 }, (_, i) => 7900 + i * 0.5); // 7900–8100 m
const phie: Curve = { id: 'PHIE', mnemonic: 'PHIE', role: 'PHIE', unit: 'v/v', data: Float64Array.from(depth, () => 0.15), origin: { kind: 'measured' } };
const gr: Curve = { id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.from(depth, () => 60), origin: { kind: 'measured' } };

// Seis plugs: corona 1 (3) y corona 2 (3); el archivo está sin poner en profundidad.
const set = createPointSet({
  id: 'c1',
  kind: 'core',
  name: 'Corona',
  depth: Float64Array.of(8000, 8001, 8002, 8040, 8041, 8042),
  pointIds: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'],
  columns: {
    phi: { label: 'φ', unit: 'v/v', values: Float64Array.of(0.1, 0.12, 0.15, 0.2, 0.18, 0.22) },
    k: { label: 'k', unit: 'mD', values: Float64Array.of(1, 3, 20, 200, 80, 500) },
    run: { label: 'Corona', values: ['1', '1', '1', '2', '2', '2'] },
  },
});
const well = createWell({ id: 'w', name: 'W', depth, curves: [phie, gr], pointSets: [set] });
const project0 = (): Project => addWell(createProject(), well);

function setup(opts: { commit?: boolean; shifts?: Record<string, number> } = {}) {
  const tracks = resolveTracks(
    [
      { id: 'gr', title: 'GR', kind: 'curves', curves: [{ select: { role: 'GR' } }] },
      { id: 'phi', title: 'Porosidad', kind: 'curves', curves: [{ select: { role: 'PHIE' } }] },
    ],
    { depth, curves: [phie, gr], computed: [], catalog: defaultRoleCatalog },
  );
  const boxes = layoutTracks(tracks, 500).boxes;
  const commits: { label: string; recipe: (p: Project) => Project }[] = [];
  let invalidations = 0;
  const lim = viewportLimits(depth, 400, 0.5);
  const vp = showRange(lim, 400, 7980, 8060) as Viewport;
  const interpretation: Interpretation = { ...emptyInterpretation(), pointSets: opts.shifts ? { c1: { points: {}, runShifts: opts.shifts } } : ({} as Interpretation['pointSets']) };
  const data: ViewerData = {
    wellId: 'w',
    depth,
    zones: [],
    selectedZoneId: null,
    qc: null,
    well,
    interpretation,
    computed: [],
    ...(opts.commit === false ? {} : { commit: (label: string, recipe: (p: Project) => Project) => commits.push({ label, recipe }) }),
  };
  const ovTracks = overlayTracks(tracks, boxes);
  const frame = (): OverlayHitFrame => ({ theme: THEMES.light, viewport: overlayViewport(vp), tracks: ovTracks, data, invalidate: () => invalidations++, active: null });
  const at = (x: number, d: number): OverlayPointer => {
    const f = frame();
    const y = yOf(vp, d);
    const ti = trackAt(boxes, x);
    return { x, y, depth: f.viewport.depthOf(y), track: ti >= 0 ? f.tracks[ti]! : null };
  };
  const main = coreOverlays.find((o) => o.id === 'core')!;
  const phiTrack = () => frame().tracks.find((t) => t.id === 'phi')!;
  /** Punto en px de un plug de φ (su profundidad corregida con `shift`). */
  const plugAt = (i: number, shift = 0) => {
    const t = phiTrack();
    return at(t.x + t.xOf('PHIE', (set.columns['phi']!.values as Float64Array)[i]!)!, set.depth[i]! + shift);
  };
  return { main, frame, at, plugAt, commits, invalidations: () => invalidations, project: project0 };
}

describe('plugs de corona en el visor: ubicación', () => {
  it('φ va a la pista de porosidad (la que tiene PHIE), no a la de GR; k y densidad de grano no tienen pista acá', () => {
    const s = setup();
    const placed = plugTracks(s.frame().tracks);
    expect(placed.map((p) => [p.track.id, p.pl.col])).toEqual([['phi', 'phi']]);
  });

  it('el plug se encuentra en la profundidad corregida: con la corona 2 puesta en +3 m, el punto está en 8043', () => {
    const s = setup({ shifts: { '2': 3 } });
    expect(s.main.hit!(s.frame(), s.plugAt(3, 0))).toBeNull(); // donde estaba en el archivo ya no hay nada
    const hit = s.main.hit!(s.frame(), s.plugAt(3, 3))!;
    expect(hit.key).toBe('c1|b1');
    expect(hit.label).toMatch(/b1 · Corona 2/);
    expect(hit.label).toMatch(/8\.043,00 m \(archivo 8\.040,00 m, \+3,00 m\)/);
  });

  it('tooltip: valores, estado y ayuda de arrastre', () => {
    const s = setup();
    const hit = s.main.hit!(s.frame(), s.plugAt(0))!;
    expect(hit.label).toMatch(/a1 · Corona 1/);
    expect(hit.label).toMatch(/sin poner en profundidad/);
    expect(hit.label).toMatch(/φ 0,100 · k 1 mD/);
    expect(hit.label).toMatch(/clic para descartarlo/);
    expect(hit.label).toMatch(/Arrastrá arriba o abajo para mover la corona 1/);
  });

  it('teclado: un elemento por plug dibujable, en orden de profundidad', () => {
    const s = setup();
    const t = s.main.targets!(s.frame());
    expect(t).toHaveLength(6);
    expect(t.map((x) => x.depth)).toEqual([8000, 8001, 8002, 8040, 8041, 8042]);
    expect(t[0]!.hit.key).toBe('c1|a1');
  });
});

describe('arrastre de una corona', () => {
  it('mover no escribe nada; soltar hace UN solo commit con la corona entera corrida (redondeado a 1 cm)', () => {
    const s = setup();
    const hit = s.main.hit!(s.frame(), s.plugAt(1))!;
    expect(hit.drag).toBeTruthy();
    const start = s.plugAt(1);
    hit.drag!.move(s.at(start.x, start.depth + 1.234), start);
    hit.drag!.move(s.at(start.x, start.depth + 2.4), start);
    // vista previa viva, sin commits
    expect(s.commits).toHaveLength(0);
    expect(corePreview()).toMatchObject({ setId: 'c1', run: '1' });
    expect(corePreview()!.delta).toBeCloseTo(2.4, 1);
    expect(s.invalidations()).toBeGreaterThanOrEqual(2);
    hit.drag!.end(s.at(start.x, start.depth + 2.4), start);
    expect(corePreview()).toBeNull();
    expect(s.commits).toHaveLength(1);
    expect(s.commits[0]!.label).toBe('Poner en profundidad la corona 1');
    const e = getWellEntry(s.commits[0]!.recipe(s.project()), 'w');
    const dec = e.interpretation.pointSets['c1']!;
    expect(dec.runShifts!['1']).toBeCloseTo(2.4, 1);
    expect(dec.runShifts!['2']).toBeUndefined(); // la otra corona no se toca
  });

  it('la vista previa mueve los plugs de la corona en pantalla (y solo los de esa corona)', () => {
    const s = setup();
    const hit = s.main.hit!(s.frame(), s.plugAt(3))!; // corona 2
    const start = s.plugAt(3);
    hit.drag!.move(s.at(start.x, start.depth + 5), start);
    // el plug b1 ahora está 5 m más abajo y a1 sigue donde estaba
    expect(s.main.hit!(s.frame(), s.plugAt(3, 5))?.key).toBe('c1|b1');
    expect(s.main.hit!(s.frame(), s.plugAt(0))?.key).toBe('c1|a1');
    hit.drag!.cancel!();
  });

  it('Escape (cancel): suelta la vista previa y NO hace commit', () => {
    const s = setup();
    const hit = s.main.hit!(s.frame(), s.plugAt(1))!;
    const start = s.plugAt(1);
    hit.drag!.move(s.at(start.x, start.depth + 3), start);
    expect(corePreview()).not.toBeNull();
    hit.drag!.cancel!();
    expect(corePreview()).toBeNull();
    expect(s.commits).toHaveLength(0);
    // y el plug vuelve a su lugar
    expect(s.main.hit!(s.frame(), s.plugAt(1))?.key).toBe('c1|a2');
  });

  it('soltar sin haberse movido (delta 0): sin commit', () => {
    const s = setup();
    const hit = s.main.hit!(s.frame(), s.plugAt(1))!;
    const start = s.plugAt(1);
    hit.drag!.move(s.at(start.x, start.depth + 0.001), start);
    hit.drag!.end(s.at(start.x, start.depth + 0.001), start);
    expect(s.commits).toHaveLength(0);
    expect(corePreview()).toBeNull();
  });

  it('la receta suma a la puesta ACTUAL del proyecto (no a la del cuadro que la creó): dos arrastres seguidos se acumulan', () => {
    const s = setup();
    const hit = s.main.hit!(s.frame(), s.plugAt(1))!;
    const start = s.plugAt(1);
    hit.drag!.end(s.at(start.x, start.depth + 1.5), start);
    hit.drag!.end(s.at(start.x, start.depth + 0.5), start);
    expect(s.commits).toHaveLength(2);
    const p = s.commits[1]!.recipe(s.commits[0]!.recipe(s.project()));
    expect(getWellEntry(p, 'w').interpretation.pointSets['c1']!.runShifts!['1']).toBeCloseTo(2, 2);
  });

  it('sin `commit` en el visor (solo lectura): ni arrastre ni clic ni teclado', () => {
    const s = setup({ commit: false });
    const hit = s.main.hit!(s.frame(), s.plugAt(1))!;
    expect(hit.drag).toBeUndefined();
    expect(hit.activate).toBeUndefined();
    expect(hit.nudge).toBeUndefined();
    expect(hit.cursor).toBe('default');
  });
});

describe('teclado y clic', () => {
  it('↑/↓ (nudge): un commit por pulsación con el paso recibido (el visor manda ±paso, Mayús ×10)', () => {
    const s = setup();
    const hit = s.main.hit!(s.frame(), s.plugAt(4))!;
    hit.nudge!(0.05);
    hit.nudge!(-0.5);
    expect(s.commits.map((c) => c.label)).toEqual(['Poner en profundidad la corona 2', 'Poner en profundidad la corona 2']);
    const p = s.commits[1]!.recipe(s.commits[0]!.recipe(s.project()));
    expect(getWellEntry(p, 'w').interpretation.pointSets['c1']!.runShifts!['2']).toBeCloseTo(-0.45, 2);
  });

  it('nudge desde el elemento de teclado de la lista de targets', () => {
    const s = setup();
    const target = s.main.targets!(s.frame()).find((t) => t.hit.key === 'c1|a3')!;
    target.hit.nudge!(1);
    const p = s.commits[0]!.recipe(s.project());
    expect(getWellEntry(p, 'w').interpretation.pointSets['c1']!.runShifts!['1']).toBe(1);
  });

  it('clic: descarta el plug (decisión explícita) y otro clic lo vuelve a incluir (la decisión se borra al coincidir con la propuesta)', () => {
    const s = setup();
    const hit = s.main.hit!(s.frame(), s.plugAt(2))!;
    hit.activate!();
    expect(s.commits.map((c) => c.label)).toEqual(['Descartar plug']);
    const p1 = s.commits[0]!.recipe(s.project());
    expect(getWellEntry(p1, 'w').interpretation.pointSets['c1']!.points['a3']).toEqual({ status: 'exclude' });
    // recetas idempotentes: si ya está descartado, la misma receta no cambia nada
    expect(s.commits[0]!.recipe(p1)).toBe(p1);
  });
});
