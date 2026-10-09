import { describe, expect, it, vi } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { collectOverlays } from '../../src/app/viewerOverlays';
import type { TrackSpec } from '../../src/core/display';
import { addWell, createProject, setCurveDisplay, setRoleDisplay, setTrackLayout } from '../../src/core/state/project';
import { deserializeProject, PROJECT_VERSION, serializeProject } from '../../src/core/state/serialize';
import type { ViewerOverlay } from '../../src/viewer/overlay';

const demo = syntheticWell(200);
const base = () => addWell(createProject('P'), demo.well, demo.zones);

describe('configuración del visor en el proyecto (formato v3)', () => {
  it('recetas puras: pistas propias, override por rol y por curva; quitar devuelve el mismo proyecto si no había nada', () => {
    const p0 = base();
    expect(p0.display).toEqual({ layouts: {}, roles: {}, curves: {} });
    const tracks: TrackSpec[] = [{ id: 't', title: 'T', kind: 'curves', curves: [{ select: { role: 'GR' } }] }];
    const p1 = setTrackLayout(p0, 'petrophysics', tracks);
    expect(p1.display.layouts['petrophysics']).toBe(tracks);
    expect(p1.wells).toBe(p0.wells); // los pozos no se tocan
    const p2 = setRoleDisplay(p1, 'GR', { min: 0, max: 200 });
    const p3 = setCurveDisplay(p2, demo.well.id, 'GR', { color: '#123456' });
    expect(p3.display.curves[demo.well.id]).toEqual({ GR: { color: '#123456' } });
    // vacío = quitar
    const p4 = setCurveDisplay(p3, demo.well.id, 'GR', {});
    expect(p4.display.curves).toEqual({});
    expect(setCurveDisplay(p4, demo.well.id, 'GR', null)).toBe(p4);
    expect(setRoleDisplay(setRoleDisplay(p4, 'GR', null), 'GR', null).display.roles).toEqual({});
    expect(setTrackLayout(p0, 'geology', null)).toBe(p0);
    expect(() => setCurveDisplay(p0, 'no-existe', 'GR', { color: '#000000' })).toThrow(/No existe el pozo/);
  });

  it('se guarda y se abre igual; la interpretación no cambia (no entra en snapshots ni recalcula)', async () => {
    const tracks: TrackSpec[] = [{ id: 't', title: 'T', kind: 'curves', curves: [{ select: { unassigned: 'resistivity' } }], scale: { kind: 'log', min: 0.2, max: 2000 } }];
    const p = setCurveDisplay(setRoleDisplay(setTrackLayout(base(), 'geology', tracks), 'NPHI', { reversed: false }), demo.well.id, 'GR', { wrap: true });
    const text = await serializeProject(p, { codec: 'f64le-b64' });
    expect(JSON.parse(text).version).toBe(PROJECT_VERSION);
    expect(PROJECT_VERSION).toBe(4);
    const back = await deserializeProject(text);
    expect(back.display).toEqual(p.display);
    expect(back.wells[0]!.interpretation).toEqual(p.wells[0]!.interpretation);
  });

  it('migra un archivo v2 (sin display) a v3 con display vacío', async () => {
    const file = JSON.parse(await serializeProject(base(), { codec: 'f64le-b64' }));
    file.version = 2;
    delete file.project.display;
    const back = await deserializeProject(JSON.stringify(file));
    expect(back.display).toEqual({ layouts: {}, roles: {}, curves: {} });
  });
});

describe('superposiciones aportadas por módulos', () => {
  const ok = (id: string): ViewerOverlay => ({ id, label: id, layer: 'over', draw: () => {} });

  it('junta las de todos los archivos e ignora las inválidas o repetidas (con aviso)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = collectOverlays({
      '../modules/a/overlay.ts': { overlays: [ok('a'), { id: 'mal', label: 'x', layer: 'encima', draw: () => {} } as unknown as ViewerOverlay] },
      '../modules/b/overlay.ts': { overlays: [ok('b'), ok('a')] },
      '../modules/c/overlay.ts': {},
    });
    expect(out.map((o) => o.id)).toEqual(['a', 'b']);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
