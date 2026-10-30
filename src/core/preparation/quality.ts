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
