/** Grilla efectiva en MD (m). Calibre y diámetro de invasión en pulgadas. */
export interface RadialLog {
  depth: Float64Array;
  step: number | null;
  cal?: Float64Array;
  di?: Float64Array;
  rxo?: Float64Array;
}

export interface RadialBand {
  top: number;
  base: number;
  wall: number;
  measured: boolean;
  invasion: number | null;
  incompatible: boolean;
  rxo: number | null;
}

export function typicalStep(depth: Float64Array): number | null {
  if (depth.length < 2) return null;
  const intervals = depth.slice(1).map((d, i) => d - depth[i]!).sort();
  return intervals[Math.floor((intervals.length - 1) / 2)]!;
}

export function radialBands(log: RadialLog, window: { top: number; base: number }, nominalWall: number): RadialBand[] {
  const out: RadialBand[] = [];
  const { depth } = log;
  const step = log.step ?? typicalStep(depth);
  const positive = (data: Float64Array | undefined, i: number) => {
    const v = data?.length === depth.length ? data[i] : undefined;
    return v !== undefined && Number.isFinite(v) && v > 0 ? v : null;
  };
  function add(top: number, base: number, i = -1) {
    if (base <= top) return;
    const cal = positive(log.cal, i);
    const di = positive(log.di, i);
    const wall = cal === null ? nominalWall : cal * 1.27;
    const radius = di === null ? null : di * 1.27;
    const invasion = radius !== null && radius > wall ? radius : null;
    out.push({ top, base, wall, measured: cal !== null, invasion, incompatible: radius !== null && invasion === null,
      rxo: invasion !== null ? positive(log.rxo, i) : null });
  }
  function edges(left: number, right: number): [number, number] {
    if (step && right - left > 2 * step) return [left + step / 2, right - step / 2];
    const mid = left + (right - left) / 2;
    return [mid, mid];
  }
  // Se incluye la muestra anterior porque su soporte puede entrar en la ventana.
  let lo = 0, hi = depth.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (depth[mid]! < window.top) lo = mid + 1;
    else hi = mid;
  }
  let cursor = window.top;
  for (let i = Math.max(0, lo - 1); i < depth.length; i++) {
    const md = depth[i]!;
    const top = Math.max(window.top, i ? edges(depth[i - 1]!, md)[1] : md);
    const base = Math.min(window.base, i + 1 < depth.length ? edges(md, depth[i + 1]!)[0] : md);
    if (top >= window.base) break;
    if (base <= cursor) continue;
    add(cursor, top);
    add(Math.max(cursor, top), base, i);
    cursor = base;
  }
  add(cursor, window.base);
  return out;
}
