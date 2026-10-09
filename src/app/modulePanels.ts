/** Descubre los paneles a medida (`src/modules/<id>/panel.tsx`) sin que haya que registrarlos. */
import type { Registry } from '../core/registry';
import type { ModulePanel } from '../ui/modulePanel';

const found = import.meta.glob<{ panel?: ModulePanel }>('../modules/*/panel.tsx', { eager: true });

export function collectPanels(registry: Registry): Map<string, ModulePanel> {
  const panels = new Map<string, ModulePanel>();
  for (const [path, mod] of Object.entries(found)) {
    const folder = path.split('/').at(-2);
    const panel = mod.panel;
    if (!panel) {
      console.warn(`${path} no exporta 'panel'; se ignora.`);
      continue;
    }
    if (panel.moduleId !== folder || !registry.get(panel.moduleId)) {
      console.warn(`${path}: el panel declara moduleId '${panel.moduleId}', que no coincide con un módulo registrado en esa carpeta.`);
      continue;
    }
    panels.set(panel.moduleId, panel);
  }
  return panels;
}
