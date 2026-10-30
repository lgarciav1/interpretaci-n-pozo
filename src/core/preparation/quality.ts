/** Flags combinables. Corrected nunca implica exactitud garantizada. */
export const Quality = Object.freeze({ OriginallyMissing: 1, Excluded: 2, Suspect: 4, Interpolated: 8, Filtered: 16, Shifted: 32, Corrected: 64, OutOfDomain: 128 });
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
