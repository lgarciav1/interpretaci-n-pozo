/** Navegación de profundidad: solo ventanas de visualización, nunca modifica muestras ni zonas. */
import { parseDecimal } from '../ui/format';

export interface DepthRange { top: number; base: number }
export interface DepthBounds { min: number; max: number }

export function validateDepthRange(topText: string, baseText: string, bounds: DepthBounds, minimumSpan: number):
  { range: DepthRange; error?: never } | { range?: never; error: string } {
  const top = parseDecimal(topText);
  const base = parseDecimal(baseText);
  if (top === null || base === null) return { error: 'Ingresá dos profundidades válidas.' };
  if (base <= top) return { error: 'La base debe ser mayor que el tope.' };
  if (top < bounds.min || base > bounds.max) return { error: 'El tramo debe quedar dentro del pozo.' };
  if (base - top < minimumSpan - 1e-6) return { error: 'El tramo es menor que el detalle máximo del visor. Elegí un intervalo más amplio.' };
  return { range: { top, base } };
}

/** Centra una ventana conservando su longitud; junto a los extremos la desplaza hacia adentro. */
export function centeredDepthRange(current: DepthRange, length: number, bounds: DepthBounds): DepthRange {
  const span = Math.min(bounds.max - bounds.min, length);
  const top = Math.max(bounds.min, Math.min(bounds.max - span, (current.top + current.base - span) / 2));
  return { top, base: top + span };
}

/** Avanza el 90 % de la ventana para conservar un 10 % de contexto compartido. */
export function adjacentDepthRange(current: DepthRange, direction: -1 | 1, bounds: DepthBounds): DepthRange {
  const delta = (current.base - current.top) * 0.9 * direction;
  return centeredDepthRange({ top: current.top + delta, base: current.base + delta }, current.base - current.top, bounds);
}
