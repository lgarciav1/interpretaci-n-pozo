/**
 * Tema claro/oscuro (ver docs/decisiones/0004-sistema-de-diseno.md, D2).
 *
 * - Preferencia del usuario: 'system' (por defecto), 'light' o 'dark', en localStorage (nunca en el proyecto).
 * - Tema resuelto: se escribe en `<html data-theme>`; el CSS generado por los tokens hace el resto.
 * - Canvas: `subscribeTheme(redibujar)` y `getThemeTokens()`; React: `useResolvedTheme()` / `useThemeTokens()`.
 */
import { useSyncExternalStore } from 'react';
import { THEMES, type ThemeName, type ThemeTokens } from './tokens';

export type { ThemeName } from './tokens';
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'pozo.ui.theme';

/** Puro: qué tema corresponde a una preferencia. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ThemeName {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark';
}

let preference: ThemePreference = 'system';
let systemDark = false;
let resolved: ThemeName = 'light';
let initialized = false;
const listeners = new Set<() => void>();

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(): void {
  const next = resolveTheme(preference, systemDark);
  const changed = next !== resolved;
  resolved = next;
  if (typeof document !== 'undefined') document.documentElement.dataset['theme'] = resolved;
  if (changed || !initialized) for (const l of listeners) l();
}

/** Lee la preferencia guardada, sigue al sistema y aplica el tema. Idempotente. */
export function initTheme(): void {
  if (initialized) return;
  preference = readStored();
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  systemDark = mq?.matches ?? false;
  mq?.addEventListener('change', (e) => {
    systemDark = e.matches;
    apply();
  });
  apply();
  initialized = true;
}

export function setThemePreference(p: ThemePreference): void {
  if (p === preference) return;
  preference = p;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, p);
  } catch {
    // Sin almacenamiento (file:// restringido, modo privado): la preferencia dura la sesión.
  }
  apply();
  for (const l of listeners) l();
}

export const getThemePreference = (): ThemePreference => preference;
export const getResolvedTheme = (): ThemeName => resolved;
export const getThemeTokens = (): ThemeTokens => THEMES[resolved];

/** Se llama cuando cambia la preferencia o el tema resuelto (también por cambio del sistema). */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, getThemePreference, getThemePreference);
}

export function useResolvedTheme(): ThemeName {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme, getResolvedTheme);
}

export function useThemeTokens(): ThemeTokens {
  return THEMES[useResolvedTheme()];
}

/** true si el usuario pidió reducir el movimiento (para animaciones hechas en TS/canvas). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
