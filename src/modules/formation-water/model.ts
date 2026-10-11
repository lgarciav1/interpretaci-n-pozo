/**
 * Calculadora de agua de formación — lógica pura del panel (sin React ni stores; la cuenta está en `src/petro/brine.ts`):
 * de dónde sale la temperatura, la tabla de Rw por zona, la serie de Rw contra profundidad y los valores que se
 * pueden escribir en `rw-manual`. Ver docs/decisiones/0017.
 */
import { arpsResistivityC, formationTemperature } from '../../petro/temperature';
import { NACL_REF_TEMP_C, valueAtDepth } from '../../petro/brine';
import rwManual from '../rw-manual';

/** De dónde sale la temperatura del perfil: curva TEMP calculada (módulo), medida, o el gradiente de los parámetros. */
export type TempSourceKind = 'computed' | 'measured' | 'gradient';

export interface TempProfile {
  depth: ArrayLike<number>;
  /** °C por muestra. */
  temp: ArrayLike<number>;
  source: TempSourceKind;
}

/** Parámetros de `temp-gradient` (°C, °C por 100 m, m). */
export interface GradientParams {
  tSurface: number;
  gradientPer100m: number;
  datum: number;
}

/** Temperatura del gradiente en cada profundidad: la misma cuenta que el módulo `temp-gradient`. */
export function gradientTemperature(depth: ArrayLike<number>, p: GradientParams): Float64Array {
  const out = new Float64Array(depth.length);
  for (let i = 0; i < out.length; i++) out[i] = formationTemperature(depth[i]! - p.datum, p.tSurface, p.gradientPer100m / 100);
  return out;
}

const hasData = (a: ArrayLike<number> | undefined): a is ArrayLike<number> => {
  if (!a) return false;
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]!)) return true;
  return false;
};

/**
 * Perfil de temperatura del pozo: la curva TEMP calculada que alimenta la cadena, si no la medida, si no el gradiente
 * del proyecto (siempre hay uno: es la misma cuenta del módulo `temp-gradient`). Una curva sin ningún dato se descarta.
 */
export function chooseTempProfile(depth: ArrayLike<number>, candidates: { computed?: ArrayLike<number>; measured?: ArrayLike<number> }, gradient: GradientParams): TempProfile {
  if (hasData(candidates.computed) && candidates.computed.length === depth.length) return { depth, temp: candidates.computed, source: 'computed' };
  if (hasData(candidates.measured) && candidates.measured.length === depth.length) return { depth, temp: candidates.measured, source: 'measured' };
  return { depth, temp: gradientTemperature(depth, gradient), source: 'gradient' };
}

export const TEMP_SOURCE_LABEL: Readonly<Record<TempSourceKind, string>> = {
  computed: 'curva TEMP del proyecto (gradiente)',
  measured: 'curva TEMP medida',
  gradient: 'gradiente del proyecto',
};

/** Temperatura (°C) a una profundidad (m) del perfil; NaN fuera del pozo. */
export function temperatureAt(profile: TempProfile, z: number): number {
  return valueAtDepth(profile.depth, profile.temp, z);
}

export interface ZoneRwRow {
  id: string;
  name: string;
  /** Profundidad del tope (m). */
  top: number;
  /** Temperatura en el tope (°C); NaN si el tope queda fuera del perfil. */
  tempC: number;
  /** Rw en el tope (Ω·m): la misma agua, llevada a esa temperatura. */
  rw: number;
}

/** Rw en el tope de cada zona (en orden de profundidad) para un agua de `rw` Ω·m medida a `tRefC`. */
export function zoneTopRows(zones: readonly { id: string; name: string; top: number }[], profile: TempProfile, rw: number, tRefC: number): ZoneRwRow[] {
  return [...zones]
    .sort((a, b) => a.top - b.top)
    .map((z) => {
      const tempC = temperatureAt(profile, z.top);
      return { id: z.id, name: z.name, top: z.top, tempC, rw: arpsResistivityC(rw, tRefC, tempC) };
    });
}

/** Serie Rw–profundidad para el minigráfico: hasta `maxPoints` muestras con temperatura, a paso regular. */
export function rwDepthSeries(profile: TempProfile, rw: number, tRefC: number, maxPoints = 120): { depth: number[]; rw: number[] } {
  const n = profile.depth.length;
  const step = Math.max(1, Math.ceil(n / maxPoints));
  const depth: number[] = [];
  const out: number[] = [];
  for (let i = 0; i < n; i += step) {
    const r = arpsResistivityC(rw, tRefC, profile.temp[i]!);
    if (!Number.isFinite(r)) continue;
    depth.push(profile.depth[i]!);
    out.push(r);
  }
  return { depth, rw: out };
}

const { rwRef: RW_SPEC, tRef: T_SPEC } = rwManual.params;

/** Redondeo de lo que se escribe en `rw-manual`: Rw a 4 decimales, T a 0,1 °C. */
const round = (v: number, decimals: number): number => Math.round(v * 10 ** decimals) / 10 ** decimals;

const es = (v: number): string => String(v).replace('.', ',');

export type ManualRwWrite = { ok: true; rwRef: number; tRef: number; converted: boolean } | { ok: false; reason: string };

/** Temperatura a la que se guarda la Rw cuando la de la calculadora no entra en el control: 75 °F (23,9 °C). */
export const MANUAL_FALLBACK_TEMP_C = round(NACL_REF_TEMP_C, 1);

/**
 * Valores para «Usar como Rw manual»: Rw (4 decimales) y su temperatura de referencia (0,1 °C), dentro del rango de
 * los controles de `rw-manual` (Rw 0,005–5 Ω·m; T 0–200 °C). Si la temperatura queda fuera del control (pozos
 * profundos, > 200 °C), se guarda LA MISMA AGUA expresada a 75 °F con Arps (`converted: true`): el módulo la lleva de
 * vuelta a cada profundidad con la misma ley, así que el resultado es el mismo. Si la Rw queda fuera del control no
 * se recorta: se informa por qué no se puede.
 */
export function manualRwWrite(rw: number, tC: number): ManualRwWrite {
  if (!Number.isFinite(rw) || !Number.isFinite(tC)) return { ok: false, reason: 'Completá dos de los tres valores para calcular Rw y su temperatura.' };
  const converted = tC < T_SPEC.min || tC > T_SPEC.max;
  const tRef = converted ? MANUAL_FALLBACK_TEMP_C : round(tC, 1);
  const rwAtRef = converted ? arpsResistivityC(rw, tC, tRef) : rw;
  if (!Number.isFinite(rwAtRef)) return { ok: false, reason: 'La temperatura está fuera del rango de la corrección por temperatura.' };
  const rwRef = round(rwAtRef, 4);
  if (rwRef < RW_SPEC.min || rwRef > RW_SPEC.max) {
    return { ok: false, reason: `La Rw manual admite entre ${es(RW_SPEC.min)} y ${es(RW_SPEC.max)} ohm·m${converted ? ` a ${es(tRef)} °C` : ''}.` };
  }
  return { ok: true, rwRef, tRef, converted };
}
