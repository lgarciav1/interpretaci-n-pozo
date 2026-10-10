/**
 * Presiones de formación: densidad de fluido a partir del gradiente y clasificación del fluido.
 *
 * Ecuaciones:
 *   Gradiente hidrostático de un fluido     dP/dz = ρ · g
 *     ρ [g/cm³] = (dP/dz [psi/ft]) / 0,4335275          (0,4335275 psi/ft = 1 g/cm³ · g estándar)
 *     ρ [g/cm³] = (dP/dz [kPa/m]) / 9,80665
 *   Presión hidrostática de una columna     P(z) = P(z₀) + ρ · g · (z − z₀)
 *
 * Rangos típicos de densidad en condiciones de reservorio (g/cm³), con los que se sugiere el fluido de un gradiente:
 *   gas        0,05 – 0,35   (≈ 0,02 – 0,15 psi/ft; gas seco a alta presión ≈ 0,2–0,3 g/cm³)
 *   petróleo   0,55 – 0,95   (≈ 0,24 – 0,41 psi/ft; liviano a pesado)
 *   agua       0,98 – 1,20   (≈ 0,425 – 0,52 psi/ft; dulce a salmuera saturada)
 * Entre gas y petróleo (0,35–0,55) hay condensados y petróleos volátiles; entre petróleo y agua (0,95–0,98), crudos
 * pesados y agua dulce: el resultado es ambiguo y se dice así.
 *
 * Referencias:
 * - Dake, L.P. (1978), "Fundamentals of Reservoir Engineering", Elsevier, cap. 1.4 (presión de fluidos, gradientes:
 *   agua 0,45 psi/ft, petróleo 0,35 psi/ft, gas 0,08 psi/ft en su ejemplo de contactos).
 * - Schlumberger (2006), "Fundamentals of Formation Testing", cap. 4 (gradientes de gas ≈ 0,02–0,15 psi/ft, petróleo
 *   ≈ 0,25–0,40 psi/ft, agua ≈ 0,43–0,50 psi/ft; contactos por intersección de gradientes = nivel de agua libre).
 * - Bourgoyne, A.T. et al. (1986), "Applied Drilling Engineering", SPE Textbook 2, cap. 6 (agua dulce 0,433 psi/ft,
 *   agua de formación típica 0,465 psi/ft).
 */
import { pressureGradientToDensity } from './gradients';

export type FluidKind = 'gas' | 'oil' | 'water';

/** Rango típico [mín, máx] de densidad (g/cm³) de cada fluido en reservorio. Ver la cabecera. */
export const FLUID_DENSITY_RANGES: Readonly<Record<FluidKind, readonly [number, number]>> = {
  gas: [0.05, 0.35],
  oil: [0.55, 0.95],
  water: [0.98, 1.2],
};

/** 1 g/cm³ en psi/ft con g estándar: 9,80665 kPa/m · 0,3048 m/ft / 6,894757 kPa/psi. */
export const PSI_PER_FT_PER_G_CM3 = (9.80665 * 0.3048) / 6.894757293168361;

/** Densidad del fluido (g/cm³) a partir de un gradiente de presión en psi/ft. */
export function densityFromPsiPerFt(psiPerFt: number): number {
  return psiPerFt / PSI_PER_FT_PER_G_CM3;
}

/** Gradiente de presión (psi/ft) de un fluido de densidad ρ (g/cm³). */
export function psiPerFtFromDensity(gPerCm3: number): number {
  return gPerCm3 * PSI_PER_FT_PER_G_CM3;
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

/** Densidad (g/cm³) de un gradiente en kPa/m (atajo de `pressureGradientToDensity`, para leer junto a lo anterior). */
export function densityFromKPaPerM(kPaPerM: number): number {
  return pressureGradientToDensity(kPaPerM);
}

/**
 * Presión hidrostática a la profundidad z de una columna de densidad ρ que tiene P₀ a z₀:
 * P = P₀ + ρ·g·(z − z₀). Unidades: z en m, ρ en g/cm³, P en kPa.
 */
export function hydrostaticPressureKPa(p0KPa: number, z0M: number, densityGPerCm3: number, zM: number): number {
  return p0KPa + densityGPerCm3 * 9.80665 * (zM - z0M);
}
