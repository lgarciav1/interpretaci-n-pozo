/**
 * Lógica pura del editor de escalas y colores (fase 4b): validación con mensajes en español, alcance del cambio
 * («esta curva» → `setCurveDisplay`, «todas las curvas del rol» → `setRoleDisplay`) y armado del override.
 * docs/decisiones/0005-visor-multipista.md, D11. El componente está en src/app/shell/CurveEditor.tsx.
 */
import type { CurveDisplayOverride, ScaleKind } from '../core/display';
import type { ResolvedCurve } from './resolve';

export interface ScaleDraft {
  scale: ScaleKind;
  min: number;
  max: number;
}

/** Errores por campo (ausente = válido). */
export interface ScaleErrors {
  min?: string;
  max?: string;
}

/** Valida una escala. null si sirve. */
export function validateScale(d: ScaleDraft): ScaleErrors | null {
  const e: ScaleErrors = {};
  if (!Number.isFinite(d.min)) e.min = 'Escribí un número.';
  if (!Number.isFinite(d.max)) e.max = 'Escribí un número.';
  if (d.scale === 'log') {
    if (!e.min && !(d.min > 0)) e.min = 'En escala logarítmica el mínimo tiene que ser mayor que 0.';
    if (!e.max && !(d.max > 0)) e.max = 'En escala logarítmica el máximo tiene que ser mayor que 0.';
  }
  if (!e.min && !e.max) {
    if (d.min === d.max) e.max = 'El mínimo y el máximo no pueden ser iguales.';
    else if (d.min > d.max) e.max = 'El máximo tiene que ser mayor que el mínimo. Para dar vuelta la escala usá «Invertir».';
  }
  return e.min || e.max ? e : null;
}

/** Paso "lindo" para las flechas de los campos: una décima de la década del rango. */
export function scaleEditStep(min: number, max: number): number {
  const span = Math.abs(max - min);
  return span > 0 && Number.isFinite(span) ? 10 ** (Math.floor(Math.log10(span)) - 1) : 0.1;
}

export const WIDTH_RANGE = { min: 0.5, max: 6, step: 0.25 } as const;

/** Valida el grosor del trazo. */
export function validateWidth(w: number): string | null {
  if (!Number.isFinite(w)) return 'Escribí un número.';
  if (w < WIDTH_RANGE.min || w > WIDTH_RANGE.max) return `El grosor va de ${String(WIDTH_RANGE.min).replace('.', ',')} a ${WIDTH_RANGE.max} px.`;
  return null;
}

export type EditScope = 'curve' | 'role';

export interface ScopeOption {
  scope: EditScope;
  label: string;
  /** Motivo si no se puede usar. */
  disabled?: string;
}

/** Alcances posibles para una curva: las calculadas se ajustan por rol; las sin rol, solo como curva. */
export function scopeOptions(c: Pick<ResolvedCurve, 'origin' | 'role' | 'name' | 'curveId'>): ScopeOption[] {
  return [
    {
      scope: 'curve',
      label: 'Esta curva',
      ...(c.origin === 'computed' || !c.curveId ? { disabled: 'Las curvas calculadas se ajustan para todo su rol.' } : {}),
    },
    {
      scope: 'role',
      label: c.role ? `Todas las ${c.role}` : 'Todo el rol',
      ...(!c.role ? { disabled: 'La curva no tiene rol asignado.' } : {}),
    },
  ];
}

/** Alcance por defecto: la curva si se puede (medida con id), si no el rol. */
export function defaultScope(c: Pick<ResolvedCurve, 'origin' | 'role' | 'name' | 'curveId'>): EditScope {
  return scopeOptions(c).find((o) => !o.disabled)?.scope ?? 'curve';
}

/** Override nuevo: el actual del alcance + el cambio; `undefined` en el cambio quita el campo. null = vacío. */
export function patchOverride(current: CurveDisplayOverride | undefined, patch: Partial<Record<keyof CurveDisplayOverride, unknown>>): CurveDisplayOverride | null {
  const out: Record<string, unknown> = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return Object.keys(out).length ? (out as CurveDisplayOverride) : null;
}

/**
 * Campos que el override de la CURVA fija y que, por precedencia, tapan un cambio hecho para todo el rol (para
 * avisarlo en el editor).
 */
export function shadowedFields(curveOverride: CurveDisplayOverride | undefined): (keyof CurveDisplayOverride)[] {
  return curveOverride ? (Object.keys(curveOverride) as (keyof CurveDisplayOverride)[]).filter((k) => curveOverride[k] !== undefined) : [];
}
