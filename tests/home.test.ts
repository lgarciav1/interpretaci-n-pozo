/**
 * Pantalla de Inicio (docs/decisiones/0065): composición de demostración, elección de la entrada al pozo y sus
 * duraciones. Lo visual (escena, transición, alternativa sin WebGL) se verifica en el navegador con
 * `scripts/qa/inicio.cjs`.
 */
import { describe, expect, it } from 'vitest';
import { DEMO_TOOL_IDS, demoToolString } from '../src/app/home/demoString';
import { ENTRY_TIMING, entryKind } from '../src/app/home/store';
import { buildToolStringScene } from '../src/app/toolString/scene';
import { registry } from '../src/modules';
import { THEMES } from '../src/ui/tokens';

describe('composición de demostración', () => {
  const entries = demoToolString(registry.tools);

  it('usa herramientas del catálogo, prendidas y en el orden típico de la sarta', () => {
    expect(entries.map((e) => e.tool.id).sort()).toEqual([...DEMO_TOOL_IDS].sort());
    const orders = entries.map((e) => e.tool.typicalOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(entries.every((e) => e.on && e.curveIds.length === 0)).toBe(true);
  });

  it('arma la escena de la sarta con las mismas funciones que el configurador, con formación neutra', () => {
    const t = THEMES.light;
    const scene = buildToolStringScene({
      entries,
      mode: 'data',
      borehole: { diameterIn: 8.5, schematic: true },
      colors: t.scene,
      accent: t.color.accent,
      curveColor: () => '#888888',
      formation: null,
    });
    // SP y calibre van montados sobre la inducción y la densidad: cada herramienta tiene su lugar en la escena.
    expect(scene.tools.map((x) => x.toolId).sort()).toEqual([...DEMO_TOOL_IDS].sort());
    expect(scene.environment.source).toBe('neutral');
    expect(scene.primitives.filter((p) => p.key.startsWith('body:')).length).toBeGreaterThanOrEqual(5);
  });
});

describe('entrada al pozo', () => {
  it('completa la primera vez en la sesión, breve las siguientes', () => {
    expect(entryKind({ reducedMotion: false, fullEntrySeen: false, hasScene: true })).toBe('full');
    expect(entryKind({ reducedMotion: false, fullEntrySeen: true, hasScene: true })).toBe('short');
  });

  it('sin recorrido de cámara con movimiento reducido o sin escena 3D', () => {
    expect(entryKind({ reducedMotion: true, fullEntrySeen: false, hasScene: true })).toBe('reduced');
    expect(entryKind({ reducedMotion: false, fullEntrySeen: false, hasScene: false })).toBe('reduced');
    expect(ENTRY_TIMING.reduced.camera).toBe(0);
    expect(ENTRY_TIMING.skip).toEqual({ camera: 0, fade: 0 });
  });

  it('la completa dura entre 2 y 3 s; la breve, menos de 1 s', () => {
    const total = (k: keyof typeof ENTRY_TIMING) => ENTRY_TIMING[k].camera + ENTRY_TIMING[k].fade;
    expect(total('full')).toBeGreaterThanOrEqual(2000);
    expect(total('full')).toBeLessThanOrEqual(3000);
    expect(total('short')).toBeLessThan(1000);
  });
});
