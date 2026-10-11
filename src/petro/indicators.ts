/**
 * Indicadores automáticos: banderas 0/1/NaN de crossover de gas, arcilla, carbón y derrumbe.
 *
 * Unidades (las canónicas del motor): porosidades y Vsh en v/v (fracción, NO %), densidad en g/cm³, Δt en µs/ft,
 * caliper y trépano en pulgadas. Cada bandera vale 1 (el indicador está presente), 0 (no lo está) o NaN (sin dato:
 * falta una curva necesaria para decidir). Un descarte seguro vale 0 aunque falte otra curva (si una curva conocida
 * ya excluye la muestra, el indicador no puede ser 1).
 *
 * Reglas (los bordes se indican en cada una; salvo el derrumbe, el valor igual al umbral CUENTA como presente):
 *   Crossover de gas   1 si (PHID − PHIN) ≥ Δmín  y  Vsh ≤ Vsh_máx   (la muestra no es arcillosa)
 *                      0 si PHID − PHIN < Δmín, o Vsh > Vsh_máx (aunque falte una porosidad)
 *                      Sin curva Vsh la exclusión de arcilla no se aplica. PHID y PHIN deben estar en la MISMA escala
 *                      litológica (matriz del neutrón corregida): si no, la diferencia no mide gas.
 *   Arcilla            1 si Vsh > Vsh_máx  (complemento exacto del corte de reservorio de `cutoffs`, donde
 *                      Vsh ≤ Vsh_máx es reservorio: Vsh = Vsh_máx NO es arcilla)
 *   Carbón             1 si RHOB ≤ ρ_máx  y  (Δt ≥ Δt_mín  o  NPHI ≥ φN_mín)
 *                      0 si RHOB > ρ_máx, o si RHOB ≤ ρ_máx y ninguna curva de confirmación disponible lo confirma
 *                      NaN si RHOB ≤ ρ_máx, nada lo confirma y falta Δt o NPHI (no se puede descartar)
 *   Derrumbe           1 si CALI − BS > tolerancia  (ESTRICTO: es el criterio del control de calidad, `io/qc.ts`)
 *                      NaN si el caliper no tiene dato o es inválido (< 5 in: físicamente imposible con un trépano
 *                      de 8,5 in; el control de calidad lo informa aparte como «caliper inválido»)
 *                      BS sin dato → se usa el trépano nominal indicado.
 *
 * Umbrales por defecto y su respaldo (son criterios prácticos, NO valores de libro: dependen de la litología, la
 * calibración de las herramientas y el criterio del intérprete; por eso son parámetros):
 *   gas   Δmín = 0,03 v/v   Un cruce de ~3 puntos de porosidad sobre el ruido de las dos curvas; el efecto del gas
 *                           hace que el neutrón lea de menos y la densidad de más (Asquith y Krygowski 2004, cap. 5).
 *   carbón ρ_máx = 2,0 g/cm³ (carbones 1,2–1,8 g/cm³; Rider y Kennedy 2011), Δt_mín = 100 µs/ft (el carbón lee
 *                           ≈ 105–140 µs/ft frente a ≈ 55–100 de las rocas clásticas) y φN_mín = 0,40 v/v (alto índice
 *                           de hidrógeno). Basta una de las dos confirmaciones. Falsos positivos posibles: areniscas poco
 *                           consolidadas o derrumbes (baja densidad con Δt alto): mirar también el indicador de derrumbe.
 *   derrumbe tolerancia = 1 in (QC_DEFAULTS.washoutTolerance, ≈ 2,5 cm de separación del patín).
 *
 * Referencias: Asquith y Krygowski (2004), «Basic Well Log Analysis», AAPG Methods in Exploration 16 (cap. 5, efecto
 * del gas en densidad–neutrón; cap. 4, caliper); Rider, M. y Kennedy, M. (2011), «The Geological Interpretation of
 * Well Logs», 3.ª ed., Rider-French (carbón: densidad baja, Δt y neutrón altos); Schlumberger, «Log Interpretation
 * Principles/Applications» (1989), cap. 4 (efecto de gas y caliper).
 */

/** Δ de porosidad (PHID − PHIN) mínimo para marcar crossover de gas (v/v). */
export const GAS_CROSSOVER_MIN = 0.03;
/** Densidad máxima del carbón (g/cm³). */
export const COAL_RHOB_MAX = 2.0;
/** Δt mínimo que confirma carbón (µs/ft). */
export const COAL_DT_MIN = 100;
/** Porosidad neutrónica mínima que confirma carbón (v/v). */
export const COAL_NPHI_MIN = 0.4;
/** Tolerancia de derrumbe: CALI − BS por encima de esto es derrumbe (in). */
export const WASHOUT_TOLERANCE_IN = 1;
/** Caliper menor que esto es una lectura inválida, no un derrumbe (in). */
export const MIN_VALID_CALIPER_IN = 5;

/**
 * Criterio de derrumbe del control de calidad: CALI − BS > tolerancia (estricto). Sin dato → false.
 * @param caliperIn  caliper (in)
 * @param bitSizeIn  diámetro del trépano (in)
 * @param toleranceIn tolerancia (in)
 */
export function isWashout(caliperIn: number, bitSizeIn: number, toleranceIn: number): boolean {
  return caliperIn - bitSizeIn > toleranceIn;
}

/**
 * Crossover de gas: 1 si PHID − PHIN ≥ minDiff y Vsh ≤ vshMax; 0 si la diferencia es menor o Vsh > vshMax (descarte
 * seguro, aunque falte una porosidad); NaN si no se puede decidir (falta una porosidad o Vsh).
 * @param phid    porosidad por densidad (v/v)
 * @param phin    porosidad neutrónica en la misma escala litológica (v/v)
 * @param vsh     volumen de arcilla (v/v); pasar 0 si no se aplica la exclusión
 * @param minDiff diferencia mínima PHID − PHIN (v/v), inclusiva
 * @param vshMax  Vsh máxima para no ser arcilloso (v/v), inclusiva
 */
export function gasCrossoverFlag(phid: number, phin: number, vsh: number, minDiff: number, vshMax: number): number {
  if (vsh > vshMax) return 0;
  const diff = phid - phin;
  if (Number.isNaN(diff)) return NaN;
  if (diff < minDiff) return 0;
  return Number.isNaN(vsh) ? NaN : 1;
}

/** Banderas de crossover de gas en [start, end), escritas en `out`. Sin `vsh` (undefined) no se excluye arcilla. */
export function gasCrossoverFlagInto(
  phid: ArrayLike<number>,
  phin: ArrayLike<number>,
  vsh: ArrayLike<number> | undefined,
  out: Float64Array,
  minDiff: number,
  vshMax: number,
  start = 0,
  end = phid.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = gasCrossoverFlag(phid[i]!, phin[i]!, vsh ? vsh[i]! : 0, minDiff, vshMax);
  return out;
}

/** Arcilla: 1 si Vsh > vshMax, 0 si no, NaN sin dato. Vsh = vshMax no es arcilla (es reservorio por Vsh). */
export function shaleFlag(vsh: number, vshMax: number): number {
  if (Number.isNaN(vsh)) return NaN;
  return vsh > vshMax ? 1 : 0;
}

export function shaleFlagInto(vsh: ArrayLike<number>, out: Float64Array, vshMax: number, start = 0, end = vsh.length): Float64Array {
  for (let i = start; i < end; i++) out[i] = shaleFlag(vsh[i]!, vshMax);
  return out;
}

/**
 * Carbón: 1 si RHOB ≤ rhobMax y (Δt ≥ dtMin o NPHI ≥ nphiMin); 0 si RHOB > rhobMax, o si ninguna confirmación
 * disponible se cumple y no falta ninguna; NaN si RHOB no tiene dato, o si ninguna confirmación se cumple pero falta
 * Δt o NPHI.
 * @param rhob    densidad (g/cm³)
 * @param dt      sónico compresional (µs/ft); NaN si no hay curva
 * @param nphi    porosidad neutrónica (v/v); NaN si no hay curva
 */
export function coalFlag(rhob: number, dt: number, nphi: number, rhobMax: number, dtMin: number, nphiMin: number): number {
  if (Number.isNaN(rhob)) return NaN;
  if (rhob > rhobMax) return 0;
  if (dt >= dtMin || nphi >= nphiMin) return 1;
  return Number.isNaN(dt) || Number.isNaN(nphi) ? NaN : 0;
}

/** Banderas de carbón en [start, end). `dt` o `nphi` pueden ser undefined (sin curva: nunca confirman). */
export function coalFlagInto(
  rhob: ArrayLike<number>,
  dt: ArrayLike<number> | undefined,
  nphi: ArrayLike<number> | undefined,
  out: Float64Array,
  rhobMax: number,
  dtMin: number,
  nphiMin: number,
  start = 0,
  end = rhob.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = coalFlag(rhob[i]!, dt ? dt[i]! : NaN, nphi ? nphi[i]! : NaN, rhobMax, dtMin, nphiMin);
  return out;
}

/**
 * Derrumbe: 1 si CALI − BS > tolerancia (estricto), 0 si no, NaN si el caliper no tiene dato o es menor que
 * `minValidCaliperIn` (inválido). Si BS no tiene dato se usa `nominalBitIn`.
 */
export function washoutFlag(caliperIn: number, bitSizeIn: number, nominalBitIn: number, toleranceIn: number, minValidCaliperIn: number): number {
  if (!Number.isFinite(caliperIn) || caliperIn < minValidCaliperIn) return NaN;
  const bit = Number.isFinite(bitSizeIn) ? bitSizeIn : nominalBitIn;
  return isWashout(caliperIn, bit, toleranceIn) ? 1 : 0;
}

/** Banderas de derrumbe en [start, end). `bs` puede ser undefined (se usa el trépano nominal). */
export function washoutFlagInto(
  cali: ArrayLike<number>,
  bs: ArrayLike<number> | undefined,
  out: Float64Array,
  nominalBitIn: number,
  toleranceIn: number,
  minValidCaliperIn: number,
  start = 0,
  end = cali.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = washoutFlag(cali[i]!, bs ? bs[i]! : NaN, nominalBitIn, toleranceIn, minValidCaliperIn);
  return out;
}
