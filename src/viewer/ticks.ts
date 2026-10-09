/**
 * Ticks de profundidad "lindos" y grillas de pista (lineal y logarítmica por décadas). Puro.
 */

export interface DepthTicks {
  /** Paso entre rótulos (m). */
  step: number;
  /** Paso de las subdivisiones (m), o null si quedarían demasiado juntas. */
  minorStep: number | null;
  /** Profundidades rotuladas. */
  major: number[];
  /** Subdivisiones (sin las mayores). */
  minor: number[];
  /** Decimales para rotular con este paso. */
  decimals: number;
}

const MANTISSAS = [1, 2, 5] as const;

const clean = (v: number) => +v.toPrecision(12);

/** Menor paso 1-2-5 × 10ᵏ que deja al menos `minPx` píxeles entre rótulos. */
export function niceStep(pxPerM: number, minPx: number): number {
  const raw = minPx / Math.max(pxPerM, 1e-12);
  let exp = Math.floor(Math.log10(raw));
  for (;;) {
    for (const m of MANTISSAS) {
      const s = clean(m * 10 ** exp);
      if (s >= raw * (1 - 1e-9)) return s;
    }
    exp++;
  }
}

/** Subdivisión natural de un paso: 1 → 5 partes, 2 → 4 partes, 5 → 5 partes. */
function minorOf(step: number): number {
  const m = Math.round(step / 10 ** Math.floor(Math.log10(step) + 1e-9));
  return clean(m === 2 ? step / 4 : step / 5);
}

function decimalsOf(step: number): number {
  return step >= 1 ? 0 : Math.ceil(-Math.log10(step) - 1e-9);
}

/** Valores múltiplos de `step` dentro de [top, base]. */
function multiples(top: number, base: number, step: number): number[] {
  const out: number[] = [];
  const k0 = Math.ceil(top / step - 1e-9);
  const k1 = Math.floor(base / step + 1e-9);
  for (let k = k0; k <= k1; k++) out.push(clean(k * step));
  return out;
}

/** Ticks para el tramo [top, base] con `pxPerM` píxeles por metro. */
export function depthTicks(top: number, base: number, pxPerM: number, minLabelPx = 56, minMinorPx = 7): DepthTicks {
  const step = niceStep(pxPerM, minLabelPx);
  const major = multiples(top, base, step);
  let minorStep: number | null = minorOf(step);
  if (minorStep * pxPerM < minMinorPx) minorStep = null;
  const minor: number[] = [];
  if (minorStep) {
    for (const v of multiples(top, base, minorStep)) {
      const r = v / step;
      if (Math.abs(r - Math.round(r)) > 1e-6) minor.push(v);
    }
  }
  return { step, minorStep, major, minor, decimals: decimalsOf(step) };
}

export interface GridLine {
  /** Posición en fracción del ancho (0 = izquierda). */
  f: number;
  major: boolean;
  value?: number;
}

/** Grilla lineal: `divisions` partes; mayor en la mitad (si es par). Sin los bordes. */
export function linearGrid(divisions = 10): GridLine[] {
  const out: GridLine[] = [];
  for (let i = 1; i < divisions; i++) out.push({ f: i / divisions, major: divisions % 2 === 0 && i === divisions / 2 });
  return out;
}

/**
 * Grilla logarítmica por décadas entre min y max (> 0): líneas en m·10ᵏ (m = 1…9) dentro del rango, mayores en
 * 10ᵏ. Sin los bordes. Con `reversed`, la fracción se mide desde la derecha.
 */
export function logGrid(min: number, max: number, reversed = false): GridLine[] {
  if (!(min > 0) || !(max > min)) return [];
  const [lo, hi] = [Math.log10(min), Math.log10(max)];
  const out: GridLine[] = [];
  for (let k = Math.floor(lo); k <= Math.ceil(hi); k++) {
    for (let m = 1; m <= 9; m++) {
      const value = clean(m * 10 ** k);
      if (value <= min * (1 + 1e-9) || value >= max * (1 - 1e-9)) continue;
      const f = (Math.log10(value) - lo) / (hi - lo);
      out.push({ f: reversed ? 1 - f : f, major: m === 1, value });
    }
  }
  return out;
}
