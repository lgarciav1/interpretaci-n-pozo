/**
 * Flags combinables. Corrected nunca implica exactitud garantizada. Normalized (0060): valor finito transformado por la
 * normalización; junto con OutOfDomain, el valor normalizado se conserva pero cae fuera del dominio físico del rol.
 */
export const Quality = Object.freeze({ OriginallyMissing: 1, Excluded: 2, Suspect: 4, Interpolated: 8, Filtered: 16, Shifted: 32, Corrected: 64, OutOfDomain: 128, Normalized: 256 });

/** Muestras normalizadas y, de ellas, las que quedan fuera del dominio físico del rol. */
export function normalizationQualityCounts(quality: Uint16Array) {
  let normalized = 0, outOfDomain = 0;
  for (const q of quality) if (q & Quality.Normalized) { normalized++; if (q & Quality.OutOfDomain) outOfDomain++; }
  return { normalized, outOfDomain };
}
export function maskQualityCounts(quality: Uint16Array) {
  let excluded = 0, originallyMissing = 0, newlyExcluded = 0;
  for (const q of quality) {
    if (q & Quality.OriginallyMissing) originallyMissing++;
    if (q & Quality.Excluded) { excluded++; if (!(q & Quality.OriginallyMissing)) newlyExcluded++; }
  }
  return { excluded, originallyMissing, newlyExcluded };
}

/** Conserva la API de conteo de máscaras; las estimaciones se cuentan aparte. */
export function preparationQualityCounts(quality: Uint16Array) {
  let interpolated = 0;
  for (const q of quality) if ((q & Quality.Interpolated) && (q & Quality.OriginallyMissing)) interpolated++;
  return { ...maskQualityCounts(quality), interpolated };
}

/** Flag de interpolación de un contribuyente no implica faltante original del centro. */
export function stageQualityCounts(quality: Uint16Array) {
  let filtered = 0, estimatedInfluence = 0;
  for (const q of quality) { if (q & Quality.Filtered) filtered++; if ((q & Quality.Interpolated) && !(q & Quality.OriginallyMissing)) estimatedInfluence++; }
  return { ...preparationQualityCounts(quality), filtered, estimatedInfluence };
}

export function alignmentQualityCounts(data: Float64Array, quality: Uint16Array) {
  let finite = 0, estimatedSupport = 0, unsupported = 0, missing = 0;
  for (let k = 0; k < data.length; k++) {
    if (Number.isFinite(data[k]!)) { finite++; if (quality[k]! & Quality.Interpolated) estimatedSupport++; }
    else if (quality[k]! & Quality.OutOfDomain) unsupported++; else missing++;
  }
  return { finite, estimatedSupport, unsupported, missing };
}
