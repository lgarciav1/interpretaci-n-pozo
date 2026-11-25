/**
 * Panel de capacidad de flujo (src/modules/flow-capacity/model.ts y panel.tsx): lectura de las tablas del módulo,
 * tramos por zona y del total, series de Lorenz decimadas y empalme del panel con el módulo.
 */
import { describe, expect, it, vi } from 'vitest';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation, sameEngineInputs } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { addWell, applyZoneEdit, createProject, getWellEntry, setModuleState } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createWell, type Zone } from '../src/core/well';
import {
  SMLP_BANDS_OVERLAY_ID,
  SMLP_OVERLAY_ID,
  TOTAL_KEY,
  applySplitZoneAtBreak,
  breakDepthKey,
  cleanOrphanBreaksRecipe,
  decimateIndices,
  lorenzSeries,
  planSplitZoneAtBreak,
  readFlowState,
  resolveSmlp,
  setSmlpOverlayRecipe,
  setZoneBreaksRecipe,
  staleZoneBreakKeys,
  toggleDepthKey,
  unitsFor,
  viewRangeFor,
} from '../src/modules/flow-capacity/model';
import { overlays, resolveOverlaySmlp, smlpCharacterColor } from '../src/modules/flow-capacity/overlay';
import { setSmlpPreviewZone } from '../src/modules/flow-capacity/overlaySync';
import { panel } from '../src/modules/flow-capacity/panel';
import { registry } from '../src/modules';
import { useProject } from '../src/app/store/project';
import { xyMapping } from '../src/plots/xy/axes';
import { buildPointGrid, pickInteractivePoint } from '../src/plots/xy/pick';
import { contrastRatio, ensureContrast } from '../src/ui/color';
import { THEMES } from '../src/ui/tokens';
import type { OverlayFrame, OverlayHitFrame, OverlayTrack } from '../src/viewer/overlay';
import { curve, well, zone } from './helpers';

const ZONES: Zone[] = [
  { ...zone('za', 1000, 1003), kind: 'reservoir' },
  { ...zone('zb', 1004, 1007), kind: 'seal' },
  { ...zone('zc', 1008, 1011), kind: 'formation' },
];
const PHI = [0.2, 0.5, 0.1, 0.2, 0.3, 0.3, 0.3, 0.3, 0.1, 0.1, 0.1, 0.1];
const PERM = [2, 250, 10, 38, 7, 7, 7, 7, 5, 5, NaN, 5];
const WELL = well([curve('PHIE', 'PHIE', PHI), curve('PERM', 'PERM', PERM)], 12, 1000, 1);

function tables(zones: Zone[]) {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(WELL);
  const r = engine.run({ ...emptyInterpretation(zones), compare: ['flow-capacity'], params: { global: { filter: 'all' }, zones: {} } });
  const rows = (port: string) => (r.outputs.find((o) => o.key === `flow-capacity:${port}`)!.value as TableValue).rows;
  return { units: rows('FLOW_UNITS'), lorenz: rows('FLOW_LORENZ'), summary: rows('FLOW_SUMMARY') };
}

describe('panel de capacidad de flujo', () => {
  it('se engancha al módulo', () => {
    expect(panel.moduleId).toBe('flow-capacity');
    expect(registry.get('flow-capacity')).toBeDefined();
  });

  it('tramos de una zona: los porcentajes del motor, en orden de profundidad', () => {
    const t = tables(ZONES);
    const za = unitsFor(t.units, 'za');
    expect(za.map((u) => u.top)).toEqual([...za.map((u) => u.top)].sort((a, b) => a - b));
    expect(za.at(-1)!.cumPhiHPct).toBeCloseTo(100, 9);
    expect(za.at(-1)!.cumKHPct).toBeCloseTo(100, 9);
  });

  it('tramos del total: todas las zonas calculadas, con porcentajes del total que coinciden con el Lorenz total', () => {
    const t = tables(ZONES);
    const all = unitsFor(t.units, TOTAL_KEY);
    expect(all.length).toBe(t.units.length);
    expect(all.reduce((s, u) => s + u.phiHPct, 0)).toBeCloseTo(100, 9);
    const strat = lorenzSeries(t.lorenz, TOTAL_KEY, 'strat');
    expect(strat.n).toBe(all.length + 1);
    all.forEach((u, i) => {
      expect(strat.x[i + 1]).toBeCloseTo(u.cumPhiHPct, 9);
      expect(strat.y[i + 1]).toBeCloseTo(u.cumKHPct, 9);
    });
  });

  it('sin zonas: una sola fila «Pozo completo» y sus tramos', () => {
    const t = tables([]);
    expect(t.summary).toHaveLength(1);
    const all = unitsFor(t.units, TOTAL_KEY);
    expect(all.length).toBe(t.units.length);
    expect(all.at(-1)!.cumKHPct).toBeCloseTo(100, 9);
    expect(lorenzSeries(t.lorenz, TOTAL_KEY, 'ordered').n).toBeGreaterThan(1);
  });

  it('decimación: a lo sumo max puntos, con extremos y monótona', () => {
    expect(decimateIndices(5, 1000)).toEqual([0, 1, 2, 3, 4]);
    const d = decimateIndices(5811, 1000);
    expect(d.length).toBeLessThanOrEqual(1000);
    expect(d[0]).toBe(0);
    expect(d.at(-1)).toBe(5810);
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThan(d[i - 1]!);
  });

  it('ir al tramo: centrado y con contexto mínimo', () => {
    const r = viewRangeFor(1000, 1000.15);
    expect(r.base - r.top).toBeCloseTo(20, 9);
    expect((r.top + r.base) / 2).toBeCloseTo(1000.075, 9);
  });
});

describe('SMLP: persistencia en moduleState, huérfanos, Ctrl+Z y partido de zona', () => {
  // Pozo sintético con una zona de 30 m (2000..2029 m) dividida en 3 capas hidráulicas claras.
  const n = 30;
  const depth = Float64Array.from({ length: n }, (_, i) => 2000 + i);
  const phi = Float64Array.from({ length: n }, () => 0.2);
  const perm = Float64Array.from({ length: n }, (_, i) => (i < 10 ? 180 : i < 20 ? 20 : 100));
  const w3 = createWell({
    id: 'w-smlp',
    name: 'Pozo SMLP',
    depth,
    curves: [
      { id: 'c-phi', mnemonic: 'PHIE', role: 'PHIE', unit: 'v/v', data: phi, origin: { kind: 'measured', source: 'smlp.csv' } },
      { id: 'c-k', mnemonic: 'PERM', role: 'PERM', unit: 'mD', data: perm, origin: { kind: 'measured', source: 'smlp.csv' } },
    ],
  });
  const mainZone: Zone = { id: 'z1', name: 'A', top: 2000, base: 2029, color: '#2563eb', kind: 'reservoir' };
  const baseProject = applyZoneEdit(addWell(createProject('smlp'), w3), 'w-smlp', [mainZone]);

  function runFlowUnits(zones: Zone[]) {
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(toEngineWell(w3));
    const r = engine.run({ ...emptyInterpretation(zones), compare: ['flow-capacity'], params: { global: { filter: 'all' }, zones: {} } });
    return r.outputs.find((o) => o.key === 'flow-capacity:FLOW_UNITS')!.value as TableValue;
  }

  it('guarda, alterna, sanea y persiste en v7 sin alterar sameEngineInputs', async () => {
    const before = getWellEntry(baseProject, 'w-smlp').interpretation;
    const p1 = setZoneBreaksRecipe('w-smlp', 'z1', ['2020.004', '2010', '2010.00'])(baseProject);
    const after = getWellEntry(p1, 'w-smlp').interpretation;
    expect(sameEngineInputs(before, after)).toBe(true);
    expect(readFlowState(after)).toEqual({
      breaksByZone: { z1: ['2010.00', '2020.00'] },
      overlayEnabled: true,
      overlayZoneKey: 'z1',
    });

    // Idempotencia: repetir los mismos quiebres devuelve el mismo proyecto (sin paso extra en Ctrl+Z).
    expect(setZoneBreaksRecipe('w-smlp', 'z1', ['2010.00', '2020.00'])(p1)).toBe(p1);
    expect(toggleDepthKey(['2010.00', '2020.00'], '2010.00')).toEqual(['2020.00']);
    expect(toggleDepthKey(['2020.00'], '2010.00')).toEqual(['2010.00', '2020.00']);

    // Apagar y prender superposición.
    const pOff = setSmlpOverlayRecipe('w-smlp', false, 'z1')(p1);
    expect(readFlowState(getWellEntry(pOff, 'w-smlp').interpretation).overlayEnabled).toBe(false);
    expect(setSmlpOverlayRecipe('w-smlp', false, 'z1')(pOff)).toBe(pOff);

    // Round-trip de serialización v7.
    const reopened = await deserializeProject(await serializeProject(pOff));
    expect(readFlowState(getWellEntry(reopened, 'w-smlp').interpretation)).toEqual({
      breaksByZone: { z1: ['2010.00', '2020.00'] },
      overlayEnabled: false,
      overlayZoneKey: 'z1',
    });

    // Limpiar todos los quiebres elimina el estado del módulo.
    const cleared = setZoneBreaksRecipe('w-smlp', 'z1', [])(pOff);
    expect(getWellEntry(cleared, 'w-smlp').interpretation.moduleState).toBeUndefined();

    // Datos corruptos en moduleState se ignoran con seguridad.
    const corrupt = setModuleState(baseProject, 'w-smlp', 'flow-capacity', {
      breaks: { z1: ['basura', '', '2015.001', '2015.00'], vacia: ['no'] },
      overlay: 'no-booleano',
      overlayZone: '',
    });
    expect(readFlowState(getWellEntry(corrupt, 'w-smlp').interpretation)).toEqual({
      breaksByZone: { z1: ['2015.00'] },
      overlayEnabled: true,
      overlayZoneKey: null,
    });
  });

  it('resuelve quiebres válidos, informa huérfanos cuando cambia la zona y los limpia con Ctrl+Z', () => {
    const table = runFlowUnits([mainZone]);
    const u = unitsFor(table.rows, 'z1');
    const resolved = resolveSmlp(u, ['2010.00', '2020.00', '1990.00', '2000.00']); // 1990 fuera; 2000 es tope (no interior)
    expect(resolved.breaks.map((b) => b.depth)).toEqual([2010, 2020]);
    expect(resolved.orphanKeys).toEqual(['1990.00', '2000.00']);
    expect(resolved.subUnits.map((s) => s.character)).toEqual(['conduit', 'barrier', 'homogeneous']);
    expect(resolved.subUnits.reduce((acc, s) => acc + 100 * s.phiHFrac, 0)).toBeCloseTo(100, 12);
    expect(resolved.subUnits.reduce((acc, s) => acc + 100 * s.kHFrac, 0)).toBeCloseTo(100, 12);

    // Zonas borradas detectadas y limpiadas:
    const withStale = setZoneBreaksRecipe('w-smlp', 'z-borrada', ['2012.00'])(
      setZoneBreaksRecipe('w-smlp', 'z1', ['2010.00', '1990.00'])(baseProject),
    );
    const st = readFlowState(getWellEntry(withStale, 'w-smlp').interpretation);
    expect(staleZoneBreakKeys(st, new Set(['z1']))).toEqual(['z-borrada']);
    const cleaned = cleanOrphanBreaksRecipe('w-smlp', 'z1', ['2010.00'], new Set(['z1']))(withStale);
    expect(readFlowState(getWellEntry(cleaned, 'w-smlp').interpretation).breaksByZone).toEqual({ z1: ['2010.00'] });
  });

  it('entra en Ctrl+Z (useProject) y parte la zona en un quiebre redistribuyendo los quiebres restantes', () => {
    useProject.getState().replace(baseProject);
    useProject.getState().commit('Marcar quiebres SMLP', setZoneBreaksRecipe('w-smlp', 'z1', ['2010.00', '2020.00']));
    expect(readFlowState(getWellEntry(useProject.getState().project, 'w-smlp').interpretation).breaksByZone).toEqual({
      z1: ['2010.00', '2020.00'],
    });

    // Deshacer quita los quiebres; rehacer los restaura.
    useProject.getState().undo();
    expect(readFlowState(getWellEntry(useProject.getState().project, 'w-smlp').interpretation).breaksByZone).toEqual({});
    useProject.getState().redo();
    expect(readFlowState(getWellEntry(useProject.getState().project, 'w-smlp').interpretation).breaksByZone).toEqual({
      z1: ['2010.00', '2020.00'],
    });

    // Partir la zona A en 2010 m: A queda [2000..2009], nueva Z1 queda [2010..2029] y hereda el quiebre 2020.00.
    const entry = getWellEntry(useProject.getState().project, 'w-smlp');
    const plan = planSplitZoneAtBreak(
      entry.interpretation.zones,
      entry.well.depth.values,
      2010,
      { id: 'z2', name: 'Z1', color: '#16a34a' },
      readFlowState(entry.interpretation),
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;

    useProject.getState().commit('Partir zona A en 2010 m', (p) => applySplitZoneAtBreak(p, 'w-smlp', plan));
    const afterSplit = getWellEntry(useProject.getState().project, 'w-smlp').interpretation;
    expect(afterSplit.zones.map((z) => [z.id, z.top, z.base])).toEqual([
      ['z1', 2000, 2009],
      ['z2', 2010, 2029],
    ]);
    expect(readFlowState(afterSplit).breaksByZone).toEqual({ z2: ['2020.00'] });

    // Un solo Ctrl+Z revierte tanto el partido de zona como la redistribución de quiebres.
    useProject.getState().undo();
    const reverted = getWellEntry(useProject.getState().project, 'w-smlp').interpretation;
    expect(reverted.zones).toHaveLength(1);
    expect(reverted.zones[0]!.base).toBe(2029);
    expect(readFlowState(reverted).breaksByZone).toEqual({ z1: ['2010.00', '2020.00'] });
  });

  it('superposición SMLP del visor: dibuja, responde a hit/targets, respeta encendido/apagado y vista previa vs export', () => {
    const table = runFlowUnits([mainZone]);
    const pWithBreaks = setZoneBreaksRecipe('w-smlp', 'z1', [breakDepthKey(2010), breakDepthKey(2020)])(baseProject);
    const entry = getWellEntry(pWithBreaks, 'w-smlp');

    const tracks: OverlayTrack[] = [
      { id: 'depth', kind: 'depth', title: 'MD', x: 0, width: 64, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
      { id: 'gr', kind: 'curves', title: 'GR', x: 64, width: 160, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
      { id: 'perm', kind: 'curves', title: 'PERM', x: 224, width: 160, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
    ];
    const makeHitFrame = (interpretation = entry.interpretation, purpose: 'interactive' | 'export' = 'interactive'): OverlayHitFrame => ({
      purpose,
      theme: THEMES.light,
      viewport: { top: 2000, base: 2030, pxPerM: 10, height: 300, yOf: (d) => (d - 2000) * 10, depthOf: (y) => 2000 + y / 10 },
      tracks,
      data: {
        wellId: 'w-smlp',
        depth,
        zones: [{ id: 'z1', name: 'A', top: 2000, base: 2029, color: '#2563eb' }],
        selectedZoneId: null,
        qc: null,
        well: entry.well,
        interpretation,
        computed: [],
        tables: [{ moduleId: 'flow-capacity', port: 'FLOW_UNITS', active: true, value: table }],
      },
      invalidate: () => {},
    });

    const resolvedState = resolveOverlaySmlp(makeHitFrame());
    expect(resolvedState?.zoneKey).toBe('z1');
    expect(resolvedState?.resolved.subUnits).toHaveLength(3);
    // Caché: segunda invocación con misma tabla y quiebres reutiliza la misma instancia resuelta.
    expect(resolveOverlaySmlp(makeHitFrame())?.resolved).toBe(resolvedState?.resolved);

    // Si se apaga la superposición, no dibuja nada.
    const pOff = setSmlpOverlayRecipe('w-smlp', false, 'z1')(pWithBreaks);
    expect(resolveOverlaySmlp(makeHitFrame(getWellEntry(pOff, 'w-smlp').interpretation))).toBeNull();

    // Vista previa de otra zona con quiebres funciona en interactivo pero se ignora en exportación.
    const pTwoZones = setZoneBreaksRecipe('w-smlp', TOTAL_KEY, ['2010.00'])(pWithBreaks);
    const interpTwo = getWellEntry(pTwoZones, 'w-smlp').interpretation;
    setSmlpPreviewZone({ wellId: 'w-smlp', zoneKey: 'z1' });
    expect(resolveOverlaySmlp(makeHitFrame(interpTwo, 'interactive'))?.zoneKey).toBe('z1');
    expect(resolveOverlaySmlp(makeHitFrame(interpTwo, 'export'))?.zoneKey).toBe(TOTAL_KEY);
    setSmlpPreviewZone(null);

    // Hit sobre línea de quiebre, barra derecha y pastilla; borde izquierdo libre para zones-tops y centro libre.
    const over = overlays.find((o) => o.id === SMLP_OVERLAY_ID)!;
    const under = overlays.find((o) => o.id === SMLP_BANDS_OVERLAY_ID)!;
    expect(over).toBeDefined();
    expect(under).toBeDefined();

    const frame = makeHitFrame();
    expect(over.targets!(frame)).toHaveLength(3);
    expect(over.hit!(frame, { x: 140, y: 100, depth: 2010, track: tracks[1]! })?.label).toMatch(/Quiebre SMLP S1\/S2/);
    expect(over.hit!(frame, { x: 222, y: 50, depth: 2005, track: tracks[1]! })?.label).toMatch(/Unidad SMLP S1 · Conducto/);
    expect(over.hit!(frame, { x: 196, y: 45, depth: 2004.5, track: tracks[1]! })?.label).toMatch(/Unidad SMLP S1/);
    // Borde izquierdo de la primera pista (zonas/notas) y centro quedan libres:
    expect(over.hit!(frame, { x: 66, y: 50, depth: 2005, track: tracks[1]! })).toBeNull();
    expect(over.hit!(frame, { x: 70, y: 10, depth: 2001, track: tracks[1]! })).toBeNull();
    expect(over.hit!(frame, { x: 100, y: 50, depth: 2005, track: tracks[1]! })).toBeNull();
    expect(over.hit!(frame, { x: 196, y: 20, depth: 2002, track: tracks[1]! })).toBeNull();
    expect(over.hit!(frame, { x: 20, y: 50, depth: 2005, track: tracks[0]! })).toBeNull();

    // Dibujo sin errores en tema claro y oscuro.
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      roundRect: vi.fn(),
      setLineDash: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 48 })),
    } as unknown as CanvasRenderingContext2D;

    for (const theme of [THEMES.light, THEMES.dark]) {
      const drawFrame: OverlayFrame = { ...frame, theme, ctx: mockCtx };
      expect(() => under.draw(drawFrame)).not.toThrow();
      expect(() => over.draw(drawFrame)).not.toThrow();
    }
    expect(mockCtx.fillRect).toHaveBeenCalled();
    expect(mockCtx.stroke).toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalled();
  });

  it('pickInteractivePoint prioriza los marcadores de quiebre SMLP sobre la curva densa en toda el área del círculo', () => {
    const m = xyMapping(
      { kind: 'linear', min: 0, max: 100, label: 'x' },
      { kind: 'linear', min: 0, max: 100, label: 'y' },
      { x: 40, y: 10, width: 240, height: 210 },
    );
    const nPts = 500;
    const denseX = Float64Array.from({ length: nPts }, (_, i) => (100 * i) / (nPts - 1));
    const denseY = Float64Array.from({ length: nPts }, (_, i) => (100 * i) / (nPts - 1));
    const breakX = [50];
    const breakY = [50];
    const layers = [{ dense: true, radius: 2 }, { dense: false, radius: 4.5 }];
    const grids = [buildPointGrid(denseX, denseY, m), buildPointGrid(breakX, breakY, m)];
    const cx = m.x(50);
    const cy = m.y(50);

    // Muestrea todo el disco visible (r = 4,5 px) alrededor del marcador: 100 % debe elegir el marcador (layer 1).
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        if (dx * dx + dy * dy > 4.5 * 4.5) continue;
        expect(pickInteractivePoint(layers, grids, cx + dx, cy + dy, 1)).toEqual({ layer: 1, i: 0 });
      }
    }
    // Lejos del marcador cae en la curva densa (layer 0).
    expect(pickInteractivePoint(layers, grids, m.x(20), m.y(20), 1)?.layer).toBe(0);
  });

  it('colores de carácter SMLP cumplen contraste AA en pastilla activa y ≥ 3:1 en trazos/puntos (claro y oscuro)', () => {
    const chars = ['conduit', 'homogeneous', 'subordinate', 'barrier', null] as const;
    for (const theme of [THEMES.light, THEMES.dark]) {
      for (const ch of chars) {
        const raw = smlpCharacterColor(ch, theme);
        const onTrack = ensureContrast(raw, theme.viewer.trackBg, 3);
        const onSurface = ensureContrast(raw, theme.color.surface, 3);
        expect(contrastRatio(onTrack, theme.viewer.trackBg)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(onSurface, theme.color.surface)).toBeGreaterThanOrEqual(3);
        const pillInk = contrastRatio(onTrack, '#ffffff') >= contrastRatio(onTrack, '#111418') ? '#ffffff' : '#111418';
        expect(contrastRatio(onTrack, pillInk)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
