/**
 * Gradientes en unidades de campo: presión, temperatura, lentitud (compactación) y otras curvas.
 *
 * Ecuaciones:
 *   Gradiente de presión de un fluido   dP/dz = ρ · g          (ρ = densidad, g = 9,80665 m/s²)
 *     → con ρ en g/cm³ y dP/dz en kPa/m:  dP/dz [kPa/m] = 9,80665 · ρ [g/cm³]   (ρ·g en kg/m³·m/s² = Pa/m, /1000)
 *     → en psi/ft:  dP/dz = 0,43353 · ρ [g/cm³]   (agua dulce, 1 g/cm³ → 0,433 psi/ft)
 *   Temperatura       dT/dz en °C/100 m  (primaria) o °F/100 ft; solo escala, nunca desplazamiento (es una diferencia)
 *   Lentitud (DT)     dΔt/dz en µs/ft por m  o  µs/ft por 1000 ft  (tendencia de compactación normal)
 *
 * Entrada común: la pendiente `slopePerM` = dy/dz de una tendencia en profundidad z (m), con y en la unidad
 * `valueUnit` registrada en `src/core/units.ts`. Para modelos no lineales (p. ej. compactación exponencial
 * DT = a·e^(b·z)) la interfaz debe pasar la pendiente local `trendSlopeAt(c, z)` evaluada en el centro del tramo.
 *
 * Referencias: Dake, L.P. (1978), "Fundamentals of Reservoir Engineering", cap. 2 (gradientes y contactos);
 * Asquith y Krygowski (2004), cap. 1-2 (gradiente de presión del agua 0,433 psi/ft, 9,8 kPa/m);
 * Bourgoyne et al. (1986), "Applied Drilling Engineering", cap. 5 (gradientes de formación; 0,433 psi/ft agua dulce,
 * 0,465 psi/ft agua de formación salada típica); Athy, L.F. (1930), "Density, porosity and compaction of
 * sedimentary rocks", AAPG Bull. 14 (decaimiento exponencial con la profundidad).
 */

import type { TrendCoefficients } from './regression';
import { conversionCoefficients, getUnit, unitLabel } from '../core/units';

/** Aceleración estándar de la gravedad (m/s²), CGPM 1901. */
export const G_STANDARD = 9.80665;

/** kPa/m → densidad equivalente del fluido en g/cm³ (ρ = grad / g). */
export function pressureGradientToDensity(kPaPerM: number): number {
  return kPaPerM / G_STANDARD;
}

/** Densidad del fluido en g/cm³ → gradiente de presión en kPa/m (grad = ρ · g). */
export function densityToPressureGradient(gPerCm3: number): number {
  return gPerCm3 * G_STANDARD;
}

export type GradientKind = 'pressure' | 'temperature' | 'slowness' | 'density' | 'resistivity' | 'generic';

export interface GradientReading {
  value: number;
  /** Etiqueta para mostrar, p. ej. 'psi/ft'. */
  unit: string;
  /** La lectura principal (la que se destaca en la interfaz); hay exactamente una por llamada. */
  primary: boolean;
}

const FT_PER_M = 1 / 0.3048;
const KPA_PER_M_TO_PSI_PER_FT = 0.3048 / 6.894757293168361;

/** Clase de gradiente según la dimensión de la unidad del valor (desconocida → 'generic'). */
export function gradientKindOf(valueUnit: string): GradientKind {
  switch (getUnit(valueUnit)?.dimension) {
    case 'pressure':
      return 'pressure';
    case 'temperature':
      return 'temperature';
    case 'slowness':
      return 'slowness';
    case 'density':
      return 'density';
    case 'resistivity':
      return 'resistivity';
    default:
      return 'generic';
  }
}

/** Escala (solo multiplicativa) para pasar un cambio de `valueUnit` a `target`. Para temperaturas ignora el offset. */
function scaleTo(valueUnit: string, target: string): number {
  return conversionCoefficients(valueUnit, target)[0];
}

/**
 * Lecturas en unidades de campo de un gradiente vertical dy/dz.
 *
 * @param slopePerM pendiente por metro de profundidad, en `valueUnit` por m (dy/dz)
 * @param valueUnit unidad de y (id de units.ts, p. ej. 'psi', 'degC', 'us/ft', 'g/cm3')
 *
 * - pressure: psi/ft (primaria), bar/m, kPa/m y densidad de fluido equivalente en g/cm³.
 * - temperature: °C/100 m (primaria) y °F/100 ft. Solo se usa la escala de conversión (un gradiente es una
 *   diferencia de temperatura: 3 °C/100 m = 1,646 °F/100 ft, sin los 32 °F).
 * - slowness: µs/ft por m (primaria) y µs/ft por 1000 ft.
 * - resto (densidad, resistividad, genérico): unidad/m.
 * Pendiente NaN → todas las lecturas NaN.
 */
export function gradientReadings(slopePerM: number, valueUnit: string): GradientReading[] {
  switch (gradientKindOf(valueUnit)) {
    case 'pressure': {
      const kPaPerM = slopePerM * scaleTo(valueUnit, 'kPa');
      return [
        { value: kPaPerM * KPA_PER_M_TO_PSI_PER_FT, unit: 'psi/ft', primary: true },
        { value: kPaPerM / 100, unit: 'bar/m', primary: false },
        { value: kPaPerM, unit: 'kPa/m', primary: false },
        { value: pressureGradientToDensity(kPaPerM), unit: 'g/cm³ (equiv.)', primary: false },
      ];
    }
    case 'temperature': {
      const degCPerM = slopePerM * scaleTo(valueUnit, 'degC');
      return [
        { value: degCPerM * 100, unit: '°C/100 m', primary: true },
        { value: degCPerM * 1.8 * 0.3048 * 100, unit: '°F/100 ft', primary: false },
      ];
    }
    case 'slowness': {
      const usFtPerM = slopePerM * scaleTo(valueUnit, 'us/ft');
      return [
        { value: usFtPerM, unit: 'µs/ft por m', primary: true },
        { value: usFtPerM / FT_PER_M * 1000, unit: 'µs/ft por 1000 ft', primary: false },
      ];
    }
    default:
      return [{ value: slopePerM, unit: `${unitLabel(valueUnit)}/m`, primary: true }];
  }
}

/**
 * "Constante de compactación" de una tendencia exponencial en profundidad y = a·e^(b·z) (z en m):
 * `perM` = b (1/m, negativa si la propiedad decrece con z, como φ de Athy 1930) y `scaleLengthM` = 1/|b| (m): la
 * profundidad en la que la propiedad cambia en un factor e. null si el modelo no es exponencial o b = 0.
 */
export function compactionConstant(c: TrendCoefficients): { perM: number; scaleLengthM: number } | null {
  if (c.model !== 'exp' || c.b === 0 || !Number.isFinite(c.b)) return null;
  return { perM: c.b, scaleLengthM: 1 / Math.abs(c.b) };
}
