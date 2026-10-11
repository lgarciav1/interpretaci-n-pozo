/**
 * Temperatura de formación y corrección de resistividad por temperatura (Arps).
 *
 * Ecuaciones:
 *   Gradiente lineal   T(z) = Tsurf + grad · z
 *   Arps (°F)          R2 = R1 · (T1 + 6,77) / (T2 + 6,77)
 *   Arps (°C)          R2 = R1 · (T1 + 21,5) / (T2 + 21,5)      (21,5389 exacto; ver nota)
 *   Conversión         °F = 1,8·°C + 32
 *
 * Unidades: la temperatura resultante usa la unidad con la que el llamador entra Tsurf. `grad` está en
 * [unidad de temperatura] por [unidad de profundidad] y `depth` en esa misma unidad de profundidad (ft o m, el
 * llamador elige; estas funciones no asumen ninguna). Ej.: Tsurf en °F, grad en °F/ft, profundidad en ft; o bien
 * Tsurf en °C, grad en °C/m, profundidad en m. Gradientes geotérmicos típicos: ~0,015 °F/ft (~0,027 °C/m).
 * Las resistividades están en Ω·m (o cualquier unidad: la corrección de Arps es una razón).
 *
 * Nota sobre Arps en °C: como °F + 6,77 = 1,8·(°C + 21,5389), la versión °C es exactamente equivalente a la
 * de °F con constante 21,5389. La carta Gen-9 de Schlumberger redondea a 21,5; aquí se convierte internamente
 * a °F (exacto), y la diferencia con la forma redondeada es < 0,1 % en rangos de yacimiento.
 *
 * Referencias: Arps, J.J. (1953), "The effect of temperature on the density and electrical resistivity of sodium
 * chloride solutions", Trans. AIME 198; Asquith y Krygowski (2004), ecuación de Arps; Schlumberger,
 * "Log Interpretation Charts", carta Gen-9.
 */

const ARPS_F = 6.77;

/** °C → °F. */
export function celsiusToFahrenheit(c: number): number {
  return c * 1.8 + 32;
}

/** °F → °C. */
export function fahrenheitToCelsius(f: number): number {
  return (f - 32) / 1.8;
}

/**
 * Temperatura de formación por gradiente lineal: T = Tsurf + grad · depth.
 * @param depth    profundidad (unidad a elección del llamador, la misma que en `gradient`)
 * @param tSurface temperatura en superficie (misma unidad de temperatura que el resultado)
 * @param gradient gradiente geotérmico: unidad de temperatura por unidad de profundidad
 */
export function formationTemperature(depth: number, tSurface: number, gradient: number): number {
  if (Number.isNaN(depth) || Number.isNaN(tSurface) || Number.isNaN(gradient)) return NaN;
  return tSurface + gradient * depth;
}

export function formationTemperatureInto(
  depth: ArrayLike<number>,
  out: Float64Array,
  tSurface: number,
  gradient: number,
  start = 0,
  end = depth.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = formationTemperature(depth[i]!, tSurface, gradient);
  return out;
}

/**
 * Corrección de Arps (°F): resistividad a T2 a partir de R1 medida a T1. R2 = R1·(T1 + 6,77)/(T2 + 6,77).
 * R1 debe ser > 0 y ambas temperaturas > −6,77 °F, si no → NaN.
 */
export function arpsResistivityF(r1: number, t1F: number, t2F: number): number {
  const a = t1F + ARPS_F;
  const b = t2F + ARPS_F;
  if (!(r1 > 0) || !(a > 0) || !(b > 0)) return NaN;
  return (r1 * a) / b;
}

/**
 * Corrección de Arps con temperaturas en °C (conversión interna a °F; equivale a la forma con 21,5389).
 * R1 > 0 y ambas temperaturas > −21,5389 °C, si no → NaN.
 */
export function arpsResistivityC(r1: number, t1C: number, t2C: number): number {
  return arpsResistivityF(r1, celsiusToFahrenheit(t1C), celsiusToFahrenheit(t2C));
}

/**
 * Arps (°F) sobre el tramo [start, end): R1 por muestra, T2 por muestra (p. ej. `formationTemperatureInto`),
 * T1 única a la que se midió la resistividad. Escribe en `out` (mismo índice).
 */
export function arpsResistivityFInto(
  r1: ArrayLike<number>,
  t2F: ArrayLike<number>,
  out: Float64Array,
  t1F: number,
  start = 0,
  end = r1.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = arpsResistivityF(r1[i]!, t1F, t2F[i]!);
  return out;
}

/**
 * Temperatura a la que una solución de resistividad R1 (medida a T1) tiene resistividad R2: inversa de Arps (°F).
 * T2 + 6,77 = (R1/R2)·(T1 + 6,77). R1 y R2 > 0 y T1 > −6,77 °F; si no → NaN. Con R2 muy grande el resultado tiende
 * a −6,77 °F (fuera de todo rango físico: el llamador valida).
 */
export function arpsTemperatureF(r1: number, t1F: number, r2: number): number {
  const a = t1F + ARPS_F;
  if (!(r1 > 0) || !(r2 > 0) || !(a > 0) || r1 === Infinity || r2 === Infinity) return NaN;
  return (r1 / r2) * a - ARPS_F;
}

/** Inversa de Arps con temperaturas en °C (conversión interna a °F). */
export function arpsTemperatureC(r1: number, t1C: number, r2: number): number {
  const f = arpsTemperatureF(r1, celsiusToFahrenheit(t1C), r2);
  return Number.isNaN(f) ? NaN : fahrenheitToCelsius(f);
}
