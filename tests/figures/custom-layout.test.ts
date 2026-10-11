/** La figura del perfil (0012) usa las pistas armadas por el usuario (0016): orden, pistas nuevas y ocultas. */
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { figureTracks } from '../../src/app/export/figureSources';
import { useProject } from '../../src/app/store/project';
import { useUi } from '../../src/app/store/ui';
import type { TrackSpec } from '../../src/core/display';
import { addWell, createProject } from '../../src/core/state/project';
import { addCurveToTrack, addTrack, moveCurveEntry, removeTrack, updateTrackLayout } from '../../src/core/state/tracks';
import { BUILTIN_LAYOUTS } from '../../src/viewer/templates';

describe('figura con pistas armadas', () => {
  it('toma la pista nueva, la curva movida y no dibuja las quitadas', () => {
    const demo = syntheticWell(300);
    const p0 = addWell(createProject('P'), demo.well, demo.zones);
    const p = updateTrackLayout(p0, 'petrophysics', BUILTIN_LAYOUTS.petrophysics, (tracks) => {
      let t = addTrack(tracks, { id: 'u-caliper', title: 'Caliper', kind: 'curves', curves: [] }, 'sonic') as TrackSpec[];
      t = addCurveToTrack(t, 'u-caliper', { select: { role: 'CALI' } });
      t = addCurveToTrack(t, 'u-caliper', { select: { role: 'BS' } });
      t = moveCurveEntry(t, 'porosity', 1, 'u-caliper'); // PE
      return removeTrack(t, 'sonic');
    });
    useUi.getState().set({ workspace: 'petrophysics' });
    useProject.getState().replace(p);
    const tracks = figureTracks(demo.well);
    const ids = tracks.map((t) => t.id);
    expect(ids).toContain('u-caliper');
    expect(ids).not.toContain('sonic');
    expect(ids.indexOf('u-caliper')).toBe(ids.indexOf('porosity') + 1);
    expect(tracks.find((t) => t.id === 'u-caliper')!.curves.map((c) => c.name)).toEqual(['CAL', 'BS', 'PE']);
    expect(tracks.find((t) => t.id === 'porosity')!.curves.map((c) => c.name)).not.toContain('PE');
  });
});
