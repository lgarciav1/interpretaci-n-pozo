/**
 * Presiones de formación: densidad de fluido a partir del gradiente, clasificación del fluido, exceso de presión y
 * densidad equivalente de lodo (EMW). Ver `docs/decisiones/0089-exceso-de-presion-y-emw-en-mdt.md`.
 *
 * Ecuaciones:
 *   Gradiente hidrostático de un fluido     dP/dz = ρ · g
 *     ρ [g/cm³] = (dP/dz [psi/ft]) / 0,4335275          (0,4335275 psi/ft = 1 g/cm³ · g estándar)
 *     ρ [g/cm³] = (dP/dz [kPa/m]) / 9,80665
 *   Presión hidrostática de una columna     P(z) = P(z₀) + ρ · g · (z − z₀)
 *   Exceso de presión                       P_ex(z) = P(z) − [P₀ + ρ_ref · g · (z − z₀)]
 *   Proyección lineal a exceso              a_ex = a − P₀ + ρ_ref · g · z₀,   b_ex = b − ρ_ref · g
 *   Densidad equivalente (EMW, datum z = 0) ρ_eq(z) = P(z) / (g · z)          (z > 0, P ≥ 0)
 *
 * Rangos típicos de densidad en condiciones de reservorio (g/cm³), con los que se sugiere el fluido de un gradiente:
 *   gas        0,05 – 0,35   (≈ 0,02 – 0,15 psi/ft; gas seco a alta presión ≈ 0,2–0,3 g/cm³)
 *   petróleo   0,55 – 0,95   (≈ 0,24 – 0,41 psi/ft; liviano a pesado)
 *   agua       0,98 – 1,20   (≈ 0,425 – 0,52 psi/ft; dulce a salmuera saturada)
 * Entre gas y petróleo (0,35–0,55) hay condensados y petróleos volátiles; entre petróleo y agua (0,95–0,98), crudos
 * pesados y agua dulce: el resultado es ambiguo y se dice así. Por encima de 1,25 g/cm³ una regresión zonal excede
 * una columna continua de salmuera saturada y sugiere compartimentalización o sobrepresión escalonada.
 *
 * Referencias:
 * - Dake, L.P. (1978), "Fundamentals of Reservoir Engineering", Elsevier, cap. 1.4 (presión de fluidos, gradientes:
 *   agua 0,45 psi/ft, petróleo 0,35 psi/ft, gas 0,08 psi/ft en su ejemplo de contactos).
 * - Schlumberger (2006), "Fundamentals of Formation Testing", cap. 4 (gradientes de gas ≈ 0,02–0,15 psi/ft, petróleo
 *   ≈ 0,25–0,40 psi/ft, agua ≈ 0,43–0,50 psi/ft; contactos por intersección de gradientes = nivel de agua libre;
 *   gráficos de exceso de presión para compartimentos y sellos).
 * - Bourgoyne, A.T. et al. (1986), "Applied Drilling Engineering", SPE Textbook 2, cap. 6 (agua dulce 0,433 psi/ft,
 *   agua de formación típica 0,465 psi/ft, densidad equivalente de lodo EMW).
 * - Mouchet, J.P. y Mitchell, A. (1989), "Abnormal Pressures While Drilling", Elf Aquitaine (sobrepresión y EMW).
 */
import { conversionCoefficients, type UnitId } from '../core/units';
import {
  G_STANDARD,
  densityToPressureGradient,
  densityToPressureGradientInUnit,
  gradientKindOf,
  pressureGradientToDensity,
} from './gradients';
import type { TrendCoefficients } from './regression';

export type FluidKind = 'gas' | 'oil' | 'water';
export const EMW_UNITS = ['lb/gal', 'g/cm3'] as const;
export type EmwUnit = (typeof EMW_UNITS)[number];

/** Rango típico [mín, máx] de densidad (g/cm³) de cada fluido en reservorio. Ver la cabecera. */
export const FLUID_DENSITY_RANGES: Readonly<Record<FluidKind, readonly [number, number]>> = {
  gas: [0.05, 0.35],
  oil: [0.55, 0.95],
  water: [0.98, 1.2],
};

/** Densidad de referencia por defecto para exceso de presión (agua dulce, g/cm³). */
export const HYDROSTATIC_NORMAL_DENSITY = 1.0;
/** Densidad de referencia de salmuera típica para exceso de presión (g/cm³). */
export const BRINE_REFERENCE_DENSITY = 1.07;
/** Umbral superior (g/cm³) de densidad aparente de una columna continua de agua/salmuera; por encima sugiere compartimentalización. */
export const APPARENT_DENSITY_COMPARTMENT_LIMIT = 1.25;

/** 1 g/cm³ en psi/ft con g estándar: 9,80665 kPa/m · 0,3048 m/ft / 6,894757 kPa/psi. */
export const PSI_PER_FT_PER_G_CM3 = (G_STANDARD * 0.3048) / 6.894757293168361;
/** 1 g/cm³ en psi/m con g estándar: 9,80665 kPa/m / 6,894757 kPa/psi. */
export const PSI_PER_M_PER_G_CM3 = G_STANDARD / 6.894757293168361;
/** 1 lb/gal US (ppg) en g/cm³ (SI exacto: 453,59237 g / (231 · 2,54³ cm³)). */
export const G_PER_CM3_PER_LB_GAL = 453.59237 / (231 * 2.54 ** 3);
/** 1 g/cm³ en lb/gal US (ppg). */
export const LB_GAL_PER_G_CM3 = (231 * 2.54 ** 3) / 453.59237;

/** Densidad del fluido (g/cm³) a partir de un gradiente de presión en psi/ft. */
export function densityFromPsiPerFt(psiPerFt: number): number {
  return psiPerFt / PSI_PER_FT_PER_G_CM3;
}

/** Gradiente de presión (psi/ft) de un fluido de densidad ρ (g/cm³). */
export function psiPerFtFromDensity(gPerCm3: number): number {
  return gPerCm3 * PSI_PER_FT_PER_G_CM3;
}

/** Densidad del fluido (g/cm³) a partir de un gradiente de presión en psi/m. */
export function densityFromPsiPerM(psiPerM: number): number {
  return psiPerM / PSI_PER_M_PER_G_CM3;
}

/** Gradiente de presión (psi/m) de un fluido de densidad ρ (g/cm³). */
export function psiPerMFromDensity(gPerCm3: number): number {
  return gPerCm3 * PSI_PER_M_PER_G_CM3;
}

/** Convierte densidad de g/cm³ a lb/gal (ppg, galón estadounidense). */
export function densityToLbPerGal(gPerCm3: number): number {
  return gPerCm3 * LB_GAL_PER_G_CM3;
}

/** Convierte densidad de lb/gal (ppg, galón estadounidense) a g/cm³. */
export function lbPerGalToDensity(lbPerGal: number): number {
  return lbPerGal * G_PER_CM3_PER_LB_GAL;
}

export interface FluidSuggestion {
  /** Fluido sugerido (null si la densidad no es física: ≤ 0, > 1,6 o no finita). */
  fluid: FluidKind | null;
  /** Si la densidad cae en el hueco entre dos rangos: los dos candidatos (el más cercano primero). */
  between: [FluidKind, FluidKind] | null;
  /** true si cae dentro del rango típico del fluido sugerido. */
  inRange: boolean;
  density: number;
}

const ORDER: readonly FluidKind[] = ['gas', 'oil', 'water'];

/**
 * Fluido más probable para una densidad (g/cm³): el del rango que la contiene o, si cae entre dos rangos, el más
 * cercano (y `between` con los dos). Densidades no físicas (≤ 0, > 1,6, NaN) → fluido null: el gradiente no es de
 * una columna de fluido continua (puntos de compartimentos distintos, sobrecargados, tramo mal elegido).
 */
export function classifyFluidByDensity(density: number): FluidSuggestion {
  if (!Number.isFinite(density) || density <= 0 || density > 1.6) return { fluid: null, between: null, inRange: false, density };
  for (const f of ORDER) {
    const [lo, hi] = FLUID_DENSITY_RANGES[f];
    if (density >= lo && density <= hi) return { fluid: f, between: null, inRange: true, density };
  }
  if (density < FLUID_DENSITY_RANGES.gas[0]) return { fluid: 'gas', between: null, inRange: false, density };
  if (density > FLUID_DENSITY_RANGES.water[1]) return { fluid: 'water', between: null, inRange: false, density };
  for (let k = 0; k < ORDER.length - 1; k++) {
    const a = ORDER[k]!;
    const b = ORDER[k + 1]!;
    const hiA = FLUID_DENSITY_RANGES[a][1];
    const loB = FLUID_DENSITY_RANGES[b][0];
    if (density > hiA && density < loB) {
      const nearA = density - hiA <= loB - density;
      return { fluid: nearA ? a : b, between: nearA ? [a, b] : [b, a], inRange: false, density };
    }
  }
  return { fluid: null, between: null, inRange: false, density };
}

/**
 * ¿Es compatible la densidad con el fluido elegido? Sí si cae en su rango o en un hueco contiguo a él (los candidatos
 * de `between`) o más allá del extremo de gas/agua. Es la comparación que corresponde para avisar de un fluido mal
 * asignado: `classifyFluidByDensity(d).fluid !== fluid` da falsos avisos en los huecos (p. ej. petróleo volátil de
 * 0,45 g/cm³ rotulado «petróleo», que el vecino más cercano manda al gas).
 */
export function fluidFitsDensity(fluid: FluidKind, density: number): boolean {
  const s = classifyFluidByDensity(density);
  return s.fluid === fluid || (s.between?.includes(fluid) ?? false);
}

/** Densidad (g/cm³) de un gradiente en kPa/m (atajo de `pressureGradientToDensity`, para leer junto a lo anterior). */
export function densityFromKPaPerM(kPaPerM: number): number {
  return pressureGradientToDensity(kPaPerM);
}

/**
 * Presión hidrostática a la profundidad z de una columna de densidad ρ que tiene P₀ a z₀:
 * P = P₀ + ρ·g·(z − z₀). Unidades: z en m, ρ en g/cm³, P en kPa.
 */
export function hydrostaticPressureKPa(p0KPa: number, z0M: number, densityGPerCm3: number, zM: number): number {
  return p0KPa + densityToPressureGradient(densityGPerCm3) * (zM - z0M);
}

/** Referencia hidrostática para exceso de presión: P_ref(z) = P₀ + ρ_ref · g · (z − z₀). */
export interface ExcessPressureRef {
  /** Densidad de referencia ρ_ref (g/cm³), finita y ≥ 0 (p. ej. 1,00 agua dulce o 1,07 salmuera). */
  rhoRef: number;
  /** Profundidad de referencia z₀ (m), finita. */
  z0: number;
  /** Presión de referencia P₀ en z₀ (en `pressureUnit`), finita. */
  p0: number;
  /** Unidad de presión de P y P₀ (por defecto 'psi', unidad interna de las series MDT). */
  pressureUnit?: UnitId;
}

function validExcessRef(ref: ExcessPressureRef): number {
  if (!Number.isFinite(ref.rhoRef) || ref.rhoRef < 0 || !Number.isFinite(ref.z0) || !Number.isFinite(ref.p0)) return NaN;
  const unit = ref.pressureUnit ?? 'psi';
  return densityToPressureGradientInUnit(ref.rhoRef, unit);
}

/** Presión de la columna hidrostática de referencia a la profundidad z (m), en `ref.pressureUnit` ('psi' por defecto). */
export function referencePressureAt(zM: number, ref: ExcessPressureRef): number {
  if (!Number.isFinite(zM)) return NaN;
  const grad = validExcessRef(ref);
  if (!Number.isFinite(grad)) return NaN;
  const val = ref.p0 + grad * (zM - ref.z0);
  return Number.isFinite(val) ? val : NaN;
}

/**
 * Exceso de presión P_ex(z) = P(z) − [P₀ + ρ_ref · g · (z − z₀)], en `ref.pressureUnit` ('psi' por defecto).
 * Devuelve NaN si algún dato o parámetro no es finito, si ρ_ref < 0 o si la unidad no es de presión.
 */
export function excessPressure(pressure: number, zM: number, ref: ExcessPressureRef): number {
  if (!Number.isFinite(pressure)) return NaN;
  const refP = referencePressureAt(zM, ref);
  if (!Number.isFinite(refP)) return NaN;
  const out = pressure - refP;
  return Number.isFinite(out) ? out : NaN;
}

/** Inversa del exceso de presión: recupera P(z) = P_ex(z) + [P₀ + ρ_ref · g · (z − z₀)]. */
export function pressureFromExcess(excess: number, zM: number, ref: ExcessPressureRef): number {
  if (!Number.isFinite(excess)) return NaN;
  const refP = referencePressureAt(zM, ref);
  if (!Number.isFinite(refP)) return NaN;
  const out = excess + refP;
  return Number.isFinite(out) ? out : NaN;
}

/**
 * Calcula P_ex(z) sobre dos arreglos paralelos (profundidad en m, presión en `ref.pressureUnit`).
 * No muta las entradas. Si `out` no se pasa, devuelve un nuevo `Float64Array` del largo común `min(depth, pressure)`.
 */
export function excessPressureArray(
  depth: ArrayLike<number>,
  pressure: ArrayLike<number>,
  ref: ExcessPressureRef,
  out?: Float64Array,
): Float64Array {
  const n = Math.min(depth.length, pressure.length);
  const target = out && out.length >= n ? out : new Float64Array(n);
  const grad = validExcessRef(ref);
  if (!Number.isFinite(grad)) {
    for (let i = 0; i < n; i++) target[i] = NaN;
    return target;
  }
  const { p0, z0 } = ref;
  for (let i = 0; i < n; i++) {
    const z = depth[i]!;
    const p = pressure[i]!;
    if (!Number.isFinite(z) || !Number.isFinite(p)) {
      target[i] = NaN;
      continue;
    }
    const v = p - (p0 + grad * (z - z0));
    target[i] = Number.isFinite(v) ? v : NaN;
  }
  return target;
}

/**
 * Proyecta exactamente una tendencia lineal de presión P(z) = a + b·z al espacio de exceso de presión:
 *   P_ex(z) = (a − P₀ + g_ref · z₀) + (b − g_ref) · z
 * donde g_ref = ρ_ref · g en `ref.pressureUnit / m`.
 *
 * Propiedades exactas:
 * - Si ρ_fluido = ρ_ref, la pendiente proyectada b_ex = 0 (recta vertical).
 * - La intersección de dos rectas proyectadas coincide algebraicamente con la intersección en P(z).
 * Devuelve null si el modelo no es lineal o si algún coeficiente o parámetro de referencia es inválido.
 */
export function projectLinearTrendToExcess(coeffs: TrendCoefficients, ref: ExcessPressureRef): TrendCoefficients | null {
  if (coeffs.model !== 'linear' || !Number.isFinite(coeffs.a) || !Number.isFinite(coeffs.b)) return null;
  const grad = validExcessRef(ref);
  if (!Number.isFinite(grad)) return null;
  const a = coeffs.a - ref.p0 + grad * ref.z0;
  const b = coeffs.b - grad;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { model: 'linear', a, b };
}

export interface EmwOptions {
  /** Unidad de la presión de entrada/salida (por defecto 'psi'). */
  pressureUnit?: UnitId;
  /** Unidad de densidad equivalente (por defecto 'lb/gal'). */
  densityUnit?: EmwUnit;
}

/**
 * Densidad equivalente de lodo (EMW) referida al datum de superficie z = 0:
 *   ρ_eq(z) = P(z) / (g · z)
 * Devuelve NaN si P < 0, z ≤ 0, algún argumento no es finito o la unidad de presión no corresponde.
 */
export function equivalentMudWeight(pressure: number, zM: number, opts: EmwOptions = {}): number {
  if (!Number.isFinite(pressure) || pressure < 0 || !Number.isFinite(zM) || zM <= 0) return NaN;
  const pUnit = opts.pressureUnit ?? 'psi';
  if (gradientKindOf(pUnit) !== 'pressure') return NaN;
  const pKPa = pressure * conversionCoefficients(pUnit, 'kPa')[0];
  const gPerCm3 = pKPa / (G_STANDARD * zM);
  if (!Number.isFinite(gPerCm3)) return NaN;
  return (opts.densityUnit ?? 'lb/gal') === 'lb/gal' ? densityToLbPerGal(gPerCm3) : gPerCm3;
}

/** Inversa de `equivalentMudWeight`: presión P(z) = ρ_eq · g · z en `pressureUnit` ('psi' por defecto). */
export function pressureFromEmw(emw: number, zM: number, opts: EmwOptions = {}): number {
  if (!Number.isFinite(emw) || emw < 0 || !Number.isFinite(zM) || zM <= 0) return NaN;
  const pUnit = opts.pressureUnit ?? 'psi';
  if (gradientKindOf(pUnit) !== 'pressure') return NaN;
  const gPerCm3 = (opts.densityUnit ?? 'lb/gal') === 'lb/gal' ? lbPerGalToDensity(emw) : emw;
  const pKPa = gPerCm3 * G_STANDARD * zM;
  const out = pKPa * conversionCoefficients('kPa', pUnit)[0];
  return Number.isFinite(out) ? out : NaN;
}

/** Calcula EMW sobre dos arreglos paralelos (profundidad en m, presión en `pressureUnit`). No muta entradas. */
export function equivalentMudWeightArray(
  depth: ArrayLike<number>,
  pressure: ArrayLike<number>,
  opts: EmwOptions = {},
  out?: Float64Array,
): Float64Array {
  const n = Math.min(depth.length, pressure.length);
  const target = out && out.length >= n ? out : new Float64Array(n);
  const pUnit = opts.pressureUnit ?? 'psi';
  if (gradientKindOf(pUnit) !== 'pressure') {
    for (let i = 0; i < n; i++) target[i] = NaN;
    return target;
  }
  const toKPa = conversionCoefficients(pUnit, 'kPa')[0];
  const toLbGal = (opts.densityUnit ?? 'lb/gal') === 'lb/gal' ? LB_GAL_PER_G_CM3 : 1;
  const factor = (toKPa / G_STANDARD) * toLbGal;
  for (let i = 0; i < n; i++) {
    const z = depth[i]!;
    const p = pressure[i]!;
    if (!Number.isFinite(z) || z <= 0 || !Number.isFinite(p) || p < 0) {
      target[i] = NaN;
      continue;
    }
    const v = (p / z) * factor;
    target[i] = Number.isFinite(v) ? v : NaN;
  }
  return target;
}

/**
 * ¿Excede la densidad aparente el límite físico de una columna continua de agua/salmuera (> 1,25 g/cm³)?
 * En una regresión zonal sugiere compartimentalización o sobrepresión escalonada (p. ej. 1,69 g/cm³ en la Zona D del TP).
 */
export function isCompartmentalizedDensity(densityGPerCm3: number): boolean {
  return Number.isFinite(densityGPerCm3) && densityGPerCm3 > APPARENT_DENSITY_COMPARTMENT_LIMIT;
}

/** ¿Es no física la densidad aparente de un gradiente zonal (≤ 0 o > 1,25 g/cm³)? */
export function isApparentDensityNonPhysical(densityGPerCm3: number): boolean {
  return Number.isFinite(densityGPerCm3) && (densityGPerCm3 <= 0 || densityGPerCm3 > APPARENT_DENSITY_COMPARTMENT_LIMIT);
}
