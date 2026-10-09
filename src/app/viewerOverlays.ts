/**
 * Superposiciones del visor aportadas por módulos: `src/modules/<id>/overlay.ts` que exporte
 * `overlays: ViewerOverlay[]`. Se descubren solas, como los paneles a medida (no hay que registrarlas). El worker
 * del motor nunca importa estos archivos.
 */
import type { ViewerOverlay } from '../viewer/overlay';

const found = import.meta.glob<{ overlays?: ViewerOverlay[] }>('../modules/*/overlay.ts', { eager: true });

/** Junta y valida las superposiciones de un conjunto de archivos (puro: recibe lo que encontró el glob). */
export function collectOverlays(files: Record<string, { overlays?: ViewerOverlay[] }>): ViewerOverlay[] {
  const out: ViewerOverlay[] = [];
  const ids = new Set<string>();
  for (const [path, mod] of Object.entries(files)) {
    if (!Array.isArray(mod.overlays)) {
      console.warn(`${path} no exporta 'overlays' (ViewerOverlay[]); se ignora.`);
      continue;
    }
    for (const o of mod.overlays) {
      if (!o || typeof o.id !== 'string' || typeof o.draw !== 'function' || (o.layer !== 'under' && o.layer !== 'over')) {
        console.warn(`${path}: superposición inválida (falta id, draw o layer); se ignora.`);
        continue;
      }
      if (ids.has(o.id)) {
        console.warn(`${path}: la superposición '${o.id}' está repetida; se ignora.`);
        continue;
      }
      ids.add(o.id);
      out.push(o);
    }
  }
  return out;
}

export const MODULE_OVERLAYS: readonly ViewerOverlay[] = collectOverlays(found);
