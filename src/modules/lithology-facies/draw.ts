/**
 * Colores de las 12 clases FORCE 2020 para la pista de litología sugerida (hilo principal; no lo importa el worker).
 * Salen de los rellenos de litología del sistema de diseño (`FILL_PALETTE`), los mismos que usa la columna
 * sedimentológica: arenisca amarilla, lutita gris parda, caliza azul, dolomía violeta, anhidrita rosa, sal celeste,
 * carbón negro; marga verde-gris, creta casi blanca, toba naranja y basamento rojo. Arenisca/Lutita es la mezcla.
 */
import { ensureContrast, mix } from '../../ui/color';
import { fillColor, type FillId } from '../../ui/curves';
import type { ThemeTokens } from '../../ui/tokens';

const FILL_OF_CLASS: readonly (FillId | readonly [FillId, FillId])[] = [
  'sand', ['sand', 'shale'], 'shale', 'marl', 'dolomite', 'limestone', 'chalk', 'salt', 'anhydrite', 'tuff', 'coal', 'basement',
];

const cache = new Map<string, readonly string[]>();

/** Colores por índice de clase FORCE (0–11), con contraste mínimo contra el fondo de pista del tema. */
export function classColors(theme: ThemeTokens): readonly string[] {
  const k = `${theme.name}|${theme.viewer.trackBg}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const base = (id: FillId) => fillColor(id, theme.name).color;
  const out = FILL_OF_CLASS.map((f) => {
    const c = typeof f === 'string' ? base(f) : mix(base(f[0]), base(f[1]), 0.5);
    return ensureContrast(c, theme.viewer.trackBg, 1.25);
  });
  cache.set(k, out);
  return out;
}
