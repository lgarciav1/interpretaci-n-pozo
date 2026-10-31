/** Diagnóstico Pearson por desplazamientos declarados. No elige ni aplica una receta. */
export interface DepthWindow {
  top: number;
  base: number;
}
export interface CorrelationScore {
  offsetM: number;
  pairs: number;
  coverage: number;
  r: number | null;
}
export function sampleLinear(
  depth: Float64Array,
  data: Float64Array,
  target: number,
  maxGapM: number,
): number {
  let lo = 0,
    hi = depth.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (depth[m]! < target) lo = m + 1;
    else hi = m;
  }
  if (depth[lo] === target) return Number.isFinite(data[lo]) ? data[lo]! : NaN;
  if (!lo || lo === depth.length || depth[lo]! - depth[lo - 1]! > maxGapM)
    return NaN;
  const a = data[lo - 1]!,
    b = data[lo]!;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const t = (target - depth[lo - 1]!) / (depth[lo]! - depth[lo - 1]!);
  return (1 - t) * a + t * b;
}
export async function diagnoseShift(
  depth: Float64Array,
  moving: Float64Array,
  reference: Float64Array,
  offsets: readonly number[],
  search: DepthWindow,
  validation: DepthWindow,
  maxGapM: number,
  checkpoint: () => Promise<void> = async () => {},
) {
  if (
    moving.length !== depth.length ||
    reference.length !== depth.length ||
    !depth.length ||
    offsets.length < 3 ||
    offsets.length > 101 ||
    offsets.some(
      (v, i) => !Number.isFinite(v) || (i > 0 && v <= offsets[i - 1]!),
    ) ||
    !Number.isFinite(maxGapM) ||
    maxGapM <= 0
  )
    throw new Error("Parámetros de correlación inválidos.");
  for (const w of [search, validation])
    if (
      !Number.isFinite(w.top) ||
      !Number.isFinite(w.base) ||
      w.base <= w.top ||
      w.top < depth[0]! ||
      w.base > depth.at(-1)!
    )
      throw new Error("Elegí ventanas válidas dentro del pozo.");
  // Además de no solapar los destinos, separar todos los soportes posibles del origen.
  const margin = Math.max(...offsets.map(Math.abs)) + maxGapM;
  if (!(
    search.base + 2 * margin < validation.top ||
    validation.base + 2 * margin < search.top
  ))
    throw new Error(
      "Separá búsqueda y validación para que tampoco compartan soporte desplazado.",
    );
  const score = async (
    offsetM: number,
    window: DepthWindow,
  ): Promise<CorrelationScore> => {
    let n = 0,
      eligible = 0,
      mx = 0,
      my = 0,
      xx = 0,
      yy = 0,
      xy = 0;
    for (let i = 0; i < depth.length; i++) {
      if (i % 2048 === 0) await checkpoint();
      const d = depth[i]!;
      if (d < window.top || d > window.base) continue;
      eligible++;
      const x = sampleLinear(depth, moving, d - offsetM, maxGapM),
        y = reference[i]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      n++;
      const dx = x - mx,
        dy = y - my;
      mx += dx / n;
      my += dy / n;
      xx += dx * (x - mx);
      yy += dy * (y - my);
      xy += dx * (y - my);
    }
    const r =
      n >= 3 && xx > 0 && yy > 0 ? xy / Math.sqrt(xx) / Math.sqrt(yy) : NaN;
    return {
      offsetM,
      pairs: n,
      coverage: eligible ? n / eligible : 0,
      r: Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null,
    };
  };
  const scores: CorrelationScore[] = [];
  for (const offset of offsets) scores.push(await score(offset, search));
  const ranked = scores.filter((s) => s.r !== null).sort((a, b) => b.r! - a.r!);
  const peak = ranked[0] ?? null;
  const atEdge = !!peak && (peak === scores[0] || peak === scores.at(-1));
  const ambiguous =
    !peak ||
    ranked.some(
      (s) =>
        s !== peak &&
        Math.abs(s.offsetM - peak.offsetM) >
          (offsets[1]! - offsets[0]!) * 1.5 &&
        peak.r! - s.r! < 0.05,
    );
  return {
    scores,
    peak,
    atEdge,
    ambiguous,
    validation: peak ? await score(peak.offsetM, validation) : null,
    method: "pearson-md-v1" as const,
  };
}
