/**
 * Tamaño de interfaz: Compacto / Normal / Grande (docs/decisiones/0013-tamano-de-interfaz.md). Mismo patrón que el
 * tema (`theme.ts`):
 *
 * - Preferencia del usuario en localStorage (`pozo.ui.scale`), nunca en el proyecto. Por defecto, Normal.
 * - Nivel aplicado en `<html data-ui-scale>`: el CSS generado por los tokens cambia texto, espaciado y medidas, y
 *   `--ui-scale` escala las medidas sueltas del CSS (`calc(18px * var(--ui-scale))`).
 * - Canvas: `getUiScaleFactor()` + `subscribeUiScale(redibujar)`, o el 4.º argumento de `useCanvas`.
 *   React: `useUiScale()` / `useUiScaleFactor()`.
 *
 * Las figuras exportadas NO leen este estado: dibujan siempre con factor 1.
 */
import { useSyncExternalStore } from 'react';
import { scalePx, uiScaleFactor, UI_SCALES, type UiScale } from './tokens';

export type { UiScale } from './tokens';

export const UI_SCALE_STORAGE_KEY = 'pozo.ui.scale';
export const DEFAULT_UI_SCALE: UiScale = 'normal';

export function isUiScale(v: unknown): v is UiScale {
  return UI_SCALES.some((s) => s.id === v);
}

/** Puro: el nivel que corresponde a lo guardado (cualquier valor desconocido o ausente → Normal). */
export function resolveUiScale(stored: unknown): UiScale {
  return isUiScale(stored) ? stored : DEFAULT_UI_SCALE;
}

let current: UiScale = DEFAULT_UI_SCALE;
let initialized = false;
const listeners = new Set<() => void>();

function readStored(): UiScale {
  try {
    return resolveUiScale(localStorage.getItem(UI_SCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_SCALE;
  }
}

function apply(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset['uiScale'] = current;
}

/** Lee la preferencia guardada y la aplica. Idempotente. Llamar antes del primer render (lo hace `main.tsx`). */
export function initUiScale(): void {
  if (initialized) return;
  current = readStored();
  apply();
  initialized = true;
}

export function setUiScale(scale: UiScale): void {
  if (scale === current) return;
  current = scale;
  try {
    localStorage.setItem(UI_SCALE_STORAGE_KEY, scale);
  } catch {
    // Sin almacenamiento (file:// restringido, modo privado): la preferencia dura la sesión.
  }
  apply();
  for (const l of listeners) l();
}

export const getUiScale = (): UiScale => current;
export const getUiScaleFactor = (): number => uiScaleFactor(current);

/** Una medida de Compacto (px) en el nivel actual: para tamaños que se pasan por props (íconos, altos de gráficos). */
export const uiPx = (px: number): number => scalePx(px, getUiScaleFactor());

/**
 * Medida CSS que sigue al tamaño de interfaz sin re-renderizar: `scaledCss(260)` → 'calc(260px * var(--ui-scale, 1))'.
 * Para estilos en línea de medidas pensadas en Compacto. Un valor que no es número (p. ej. '50%') queda igual.
 */
export function scaledCss(value: number): string;
export function scaledCss<T>(value: number | T): string | Exclude<T, number>;
export function scaledCss<T>(value: number | T): string | T {
  return typeof value === 'number' ? (value === 0 ? '0' : `calc(${value}px * var(--ui-scale, 1))`) : value;
}

/** Se llama cuando cambia el nivel. */
export function subscribeUiScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiScale(): UiScale {
  return useSyncExternalStore(subscribeUiScale, getUiScale, getUiScale);
}

export function useUiScaleFactor(): number {
  return useSyncExternalStore(subscribeUiScale, getUiScaleFactor, getUiScaleFactor);
}
