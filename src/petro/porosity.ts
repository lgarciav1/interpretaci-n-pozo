/**
 * Porosidad: densidad, sónico (Wyllie, Raymer-Hunt-Gardner), neutrón, densidad–neutrón y correcciones por arcilla.
 *
 * Unidades: densidades en g/cc, tiempo de tránsito Δt en µs/ft, porosidades y Vsh en v/v (fracción, NO %).
 * Sin dato (NaN) → NaN. Parámetros degenerados (denominador ≤ 0) → NaN. Toda porosidad devuelta se recorta al
 * rango físico [0, 0,5] (chequeo del plan: φ 0–0,5); el recorte oculta valores no físicos, no los corrige.
 *
 * Ecuaciones:
 *   Densidad          φD = (ρma − ρb) / (ρma − ρf)
 *   Sónico Wyllie     φS = (Δt − Δtma) / (Δtf − Δtma)                 (sin factor de compactación)
 *   Sónico RHG        φS = 0,625 · (Δt − Δtma) / Δt                   (forma simplificada de Raymer-Hunt-Gardner)
 *   Neutrón           φN = NPHI + offset                              (offset = corrección de matriz opcional)
 *   Dens–neutrón      φDN = (φD + φN) / 2                             (líquido)
 *                     φDN = √((φD² + φN²) / 2)                        (zonas con gas)
 *   Corr. por arcilla φcorr = φ − Vsh · φsh
 *   Efectiva          φe = φt · (1 − Vsh)
 *
 * Referencias: Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16, cap. 5
 * (densidad, sónico, neutrón, densidad–neutrón, porosidad efectiva); Wyllie et al. (1956); Raymer, Hunt y
 * Gardner (1980), "An improved sonic transit time-to-porosity transform", SPWLA 21st Annual Logging Symposium;
 * Schlumberger, "Log Interpretation Charts" (cartas Por-). Valores típicos de matriz (Asquith): arenisca
 * ρma 2,65 g/cc, Δtma 55,5 µs/ft; caliza 2,71 / 47,5; dolomía 2,87 / 43,5; Δtf 189 µs/ft (lodo dulce), ρf 1,0 g/cc.
 */

/** Porosidad máxima físicamente aceptada (v/v) por el chequeo del plan. */
export const POROSITY_MAX = 0.5;

/** Coeficiente de la forma simplificada de Raymer-Hunt-Gardner (5/8). */
export const RAYMER_COEFFICIENT = 0.625;

/** Recorta una porosidad a [0, POROSITY_MAX]; NaN se propaga. */
export function clipPorosity(phi: number): number {
  if (Number.isNaN(phi)) return NaN;
  return phi < 0 ? 0 : phi > POROSITY_MAX ? POROSITY_MAX : phi;
}

/** Recorta a [0, 1]. Interno (Vsh). */
function clip01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ---------------------------------------------------------------------------------------------------------------
// Densidad
// ---------------------------------------------------------------------------------------------------------------

/**
 * Porosidad densidad φD = (ρma − ρb)/(ρma − ρf).
 * @param rhoB  densidad de formación medida (g/cc)
 * @param rhoMa densidad de matriz (g/cc)
 * @param rhoF  densidad de fluido (g/cc); debe ser menor que ρma, si no → NaN
 */
export function densityPorosity(rhoB: number, rhoMa: number, rhoF: number): number {
  const span = rhoMa - rhoF;
  if (!(span > 0) || Number.isNaN(rhoB)) return NaN;
  return clipPorosity((rhoMa - rhoB) / span);
}

/** Variante por tramo [start, end) de `densityPorosityInto`, escrita en `out` (mismo índice). */
export function densityPorosityInto(
  rhoB: ArrayLike<number>,
  out: Float64Array,
  rhoMa: number,
  rhoF: number,
  start = 0,
  end = rhoB.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = densityPorosity(rhoB[i]!, rhoMa, rhoF);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Sónico
// ---------------------------------------------------------------------------------------------------------------

/**
 * Porosidad sónica de Wyllie (promedio en tiempo): φS = (Δt − Δtma)/(Δtf − Δtma).
 * No incluye factor de compactación (Cp = 1): en arenas no consolidadas/someras sobreestima la porosidad.
 * @param dt   Δt medido (µs/ft)
 * @param dtMa Δt de matriz (µs/ft)
 * @param dtF  Δt de fluido (µs/ft); debe ser mayor que Δtma, si no → NaN
 */
export function sonicPorosityWyllie(dt: number, dtMa: number, dtF: number): number {
  const span = dtF - dtMa;
  if (!(span > 0) || Number.isNaN(dt)) return NaN;
  return clipPorosity((dt - dtMa) / span);
}

/** Variante por tramo [start, end) de `sonicPorosityWyllieInto`, escrita en `out` (mismo índice). */
export function sonicPorosityWyllieInto(
  dt: ArrayLike<number>,
  out: Float64Array,
  dtMa: number,
  dtF: number,
  start = 0,
  end = dt.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = sonicPorosityWyllie(dt[i]!, dtMa, dtF);
  return out;
}

/**
 * Porosidad sónica de Raymer-Hunt-Gardner, forma simplificada usada por Asquith y Krygowski:
 *   φS = (5/8) · (Δt − Δtma) / Δt = 0,625 · (Δt − Δtma)/Δt
 * No depende de Δtf (el coeficiente 5/8 absorbe un Δtf típico). Es una aproximación empírica de la
 * transformada completa de RHG, 1/Δt = (1 − φ)²/Δtma + φ/Δtf, útil para porosidades hasta ~0,35–0,40.
 * @param dt   Δt medido (µs/ft); debe ser > 0, si no → NaN
 * @param dtMa Δt de matriz (µs/ft); debe ser > 0, si no → NaN
 */
export function sonicPorosityRaymer(dt: number, dtMa: number): number {
  if (!(dt > 0) || !(dtMa > 0)) return NaN;
  return clipPorosity((RAYMER_COEFFICIENT * (dt - dtMa)) / dt);
}

/** Variante por tramo [start, end) de `sonicPorosityRaymerInto`, escrita en `out` (mismo índice). */
export function sonicPorosityRaymerInto(
  dt: ArrayLike<number>,
  out: Float64Array,
  dtMa: number,
  start = 0,
  end = dt.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = sonicPorosityRaymer(dt[i]!, dtMa);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Neutrón
// ---------------------------------------------------------------------------------------------------------------

/**
 * Porosidad neutrón φN = NPHI + offset (v/v).
 * El NPHI viene calibrado en una matriz de referencia (normalmente caliza). Para otra litología se suma un
 * `matrixOffset` aditivo en v/v (orden de 0,03–0,04 entre caliza y arenisca; su signo y valor exactos dependen
 * de la herramienta y de la porosidad: tomarlo de la carta del fabricante, p. ej. Schlumberger Por-13). Con
 * offset 0 (por defecto) solo recorta al rango físico. Un NPHI levemente negativo (matriz densa) se lleva a 0.
 */
export function neutronPorosity(nphi: number, matrixOffset = 0): number {
  if (Number.isNaN(nphi) || Number.isNaN(matrixOffset)) return NaN;
  return clipPorosity(nphi + matrixOffset);
}

/** Variante por tramo [start, end) de `neutronPorosityInto`, escrita en `out` (mismo índice). */
export function neutronPorosityInto(
  nphi: ArrayLike<number>,
  out: Float64Array,
  matrixOffset = 0,
  start = 0,
  end = nphi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = neutronPorosity(nphi[i]!, matrixOffset);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Densidad–neutrón
// ---------------------------------------------------------------------------------------------------------------

/**
 * Densidad–neutrón, promedio simple (zonas con líquido): φDN = (φD + φN)/2.
 * Las entradas se recortan a [0, 0,5] antes de combinar.
 */
export function densityNeutronPorosity(phiD: number, phiN: number): number {
  if (Number.isNaN(phiD) || Number.isNaN(phiN)) return NaN;
  return clipPorosity((clipPorosity(phiD) + clipPorosity(phiN)) / 2);
}

/** Variante por tramo [start, end) de `densityNeutronPorosityInto`, escrita en `out` (mismo índice). */
export function densityNeutronPorosityInto(
  phiD: ArrayLike<number>,
  phiN: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = phiD.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = densityNeutronPorosity(phiD[i]!, phiN[i]!);
  return out;
}

/**
 * Densidad–neutrón para zonas con gas (raíz cuadrática ponderada): φDN = √((φD² + φN²)/2).
 * En gas el neutrón lee de menos y la densidad de más; el promedio cuadrático pondera hacia el mayor de los dos
 * (siempre ≥ promedio simple, igual cuando φD = φN). Entradas recortadas a [0, 0,5] antes de elevar al cuadrado
 * (un φN negativo no debe aportar porosidad positiva por el cuadrado).
 */
export function densityNeutronGasPorosity(phiD: number, phiN: number): number {
  if (Number.isNaN(phiD) || Number.isNaN(phiN)) return NaN;
  const d = clipPorosity(phiD);
  const n = clipPorosity(phiN);
  return clipPorosity(Math.sqrt((d * d + n * n) / 2));
}

/** Variante por tramo [start, end) de `densityNeutronGasPorosityInto`, escrita en `out` (mismo índice). */
export function densityNeutronGasPorosityInto(
  phiD: ArrayLike<number>,
  phiN: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = phiD.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = densityNeutronGasPorosity(phiD[i]!, phiN[i]!);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Arcilla: corrección y porosidad efectiva
// ---------------------------------------------------------------------------------------------------------------

/**
 * Corrección por arcilla con la porosidad aparente de la lutita adyacente: φcorr = φ − Vsh · φsh.
 * Es la forma preferida cuando se dispone de φsh medida en una lutita limpia (la porosidad aparente de la
 * lutita sobre la misma curva y con los mismos parámetros de matriz). Vsh se recorta a [0, 1].
 * @param phi   porosidad aparente de la formación (v/v), con la misma curva/método que `phiSh`
 * @param vsh   volumen de arcilla (v/v)
 * @param phiSh porosidad aparente en la lutita (v/v)
 */
export function shaleCorrectedPorosity(phi: number, vsh: number, phiSh: number): number {
  if (Number.isNaN(phi) || Number.isNaN(vsh) || Number.isNaN(phiSh)) return NaN;
  return clipPorosity(phi - clip01(vsh) * phiSh);
}

/** Variante por tramo [start, end) de `shaleCorrectedPorosityInto`, escrita en `out` (mismo índice). */
export function shaleCorrectedPorosityInto(
  phi: ArrayLike<number>,
  vsh: ArrayLike<number>,
  out: Float64Array,
  phiSh: number,
  start = 0,
  end = phi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = shaleCorrectedPorosity(phi[i]!, vsh[i]!, phiSh);
  return out;
}

/**
 * Porosidad efectiva a partir de la total: φe = φt · (1 − Vsh) (Asquith y Krygowski, cap. 5).
 * Equivale a `shaleCorrectedPorosity` con φsh = φt, es decir, supone que la porosidad aparente de la arcilla
 * es la de la propia formación. Se ofrece como aproximación cuando NO hay una φsh de referencia; si hay una
 * lutita limpia en el pozo, usar `shaleCorrectedPorosity` (más rigurosa: usa la φsh realmente medida).
 * φt se recorta a [0, 0,5] antes de multiplicar, igual que en las combinaciones densidad–neutrón.
 */
export function effectivePorosity(phiT: number, vsh: number): number {
  if (Number.isNaN(phiT) || Number.isNaN(vsh)) return NaN;
  return clipPorosity(clipPorosity(phiT) * (1 - clip01(vsh)));
}

/** Variante por tramo [start, end) de `effectivePorosityInto`, escrita en `out` (mismo índice). */
export function effectivePorosityInto(
  phiT: ArrayLike<number>,
  vsh: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = phiT.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = effectivePorosity(phiT[i]!, vsh[i]!);
  return out;
}
