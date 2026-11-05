/**
 * Profundidad vertical bajo el nivel del mar (TVDSS) para la segunda columna de profundidad del perfil clásico
 * (docs/decisiones/0067, D6). Puro.
 *
 * El modelo de pozo (`src/core/well.ts`) guarda solo MD en metros. TVDSS necesita:
 * 1. una ELEVACIÓN de referencia del cero de la MD sobre el nivel del mar: KB (mesa rotary), si no DF y si no la del
 *    punto de referencia permanente (claves LAS EKB/EDF/EREF y sus nombres en español, como el encabezado de pozo).
 *    Sin elevación no hay TVDSS: la columna no se muestra (nunca vacía).
 * 2. la DESVIACIÓN si existe: una curva de inclinación (DEVI, INCL, HDEV…, en grados, 0–90). Se integra con el método
 *    de la tangente balanceada, ΔTVD = ΔMD · (cos I₁ + cos I₂) / 2, suponiendo el pozo vertical hasta la primera
 *    muestra (no hay registro arriba). Sin curva de inclinación, el pozo se toma vertical: TVD = MD.
 * TVDSS = TVD − elevación (positiva bajo el nivel del mar).
 */
import { getUnit } from '../core/units';
import type { HeaderEntry, Well } from '../core/well';

export interface DepthReference {
  /** Elevación del cero de la MD sobre el nivel del mar (m). */
  elevation: number;
  /** De dónde salió («KB», «DF», «referencia»). */
  source: string;
  /** Inclinación en grados por muestra (null = pozo vertical). */
  inclination: Float64Array | null;
  /** Mnemónico de la curva de inclinación. */
  inclinationName?: string;
}

const ELEVATION_KEYS: readonly { source: string; keys: readonly string[] }[] = [
  { source: 'KB', keys: ['EKB', 'KB', 'ELEV_KB', 'KB_ELEV', 'ELEVKB', 'ELEVACION_KB', 'MESA_ROTARY'] },
  { source: 'DF', keys: ['EDF', 'DF', 'ELEV_DF'] },
  { source: 'referencia', keys: ['EREF', 'ELEV', 'EPD', 'ELEVACION'] },
];

const INCLINATION = /^(DEVI|DEV|DEVIATION|INCL|INC|INCLINATION|HDEV|DEVIM|SDEV|ANGLE|INCLINACION)$/i;

const norm = (k: string) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/** Valor numérico de una entrada de encabezado («1.234,5» o «1234.5»), en metros; null si no se puede leer. */
export function headerLengthM(e: HeaderEntry, fallbackUnit?: string): number | null {
  let v: number;
  if (typeof e.value === 'number') v = e.value;
  else {
    const t = String(e.value).trim().replace(/\s/g, '');
    // «1.234,5» (es) o «1234.5» (LAS): si hay coma decimal, los puntos son de miles.
    const s = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    v = Number(s.replace(/[^0-9eE+.-]/g, ''));
  }
  if (!Number.isFinite(v)) return null;
  const unit = getUnit(e.unit ?? fallbackUnit ?? 'm');
  return unit && unit.dimension === 'length' ? v * unit.factor : v;
}

/** Elevación de referencia y curva de inclinación del pozo; null sin elevación (no hay TVDSS). */
export function depthReference(well: Pick<Well, 'header' | 'curves' | 'depth'>): DepthReference | null {
  const entries = Object.entries(well.header ?? {}).map(([k, e]) => ({ n: norm(k), e }));
  let found: { elevation: number; source: string } | null = null;
  for (const g of ELEVATION_KEYS) {
    for (const x of entries) {
      if (!g.keys.includes(x.n)) continue;
      const m = headerLengthM(x.e, well.depth.sourceUnit);
      if (m !== null && Math.abs(m) < 10000) {
        found = { elevation: m, source: g.source };
        break;
      }
    }
    if (found) break;
  }
  if (!found) return null;
  const n = well.depth.values.length;
  const inc = well.curves.find((c) => INCLINATION.test(c.mnemonic.trim()) && c.data.length === n && validInclination(c.data));
  return { ...found, inclination: inc ? inc.data : null, ...(inc ? { inclinationName: inc.mnemonic } : {}) };
}

/** Inclinación plausible en grados: algún valor finito y todos en [0, 90]. */
function validInclination(data: ArrayLike<number>): boolean {
  let any = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < 0 || v > 90) return false;
    any = true;
  }
  return any;
}

/**
 * TVDSS por muestra. Con inclinación, tangente balanceada desde la primera muestra (vertical hasta ahí); un hueco en
 * la inclinación repite el último valor válido (0 antes del primero).
 */
export function computeTvdss(md: ArrayLike<number>, elevation: number, inclinationDeg?: ArrayLike<number> | null): Float64Array {
  const n = md.length;
  const out = new Float64Array(n);
  if (!n) return out;
  if (!inclinationDeg) {
    for (let i = 0; i < n; i++) out[i] = md[i]! - elevation;
    return out;
  }
  const rad = Math.PI / 180;
  let last = 0;
  let prevCos = 1;
  let tvd = md[0]!;
  for (let i = 0; i < n; i++) {
    const v = inclinationDeg[i]!;
    if (Number.isFinite(v)) last = v;
    const c = Math.cos(last * rad);
    // Vertical hasta la primera muestra: ahí TVD = MD.
    if (i > 0) tvd += ((md[i]! - md[i - 1]!) * (prevCos + c)) / 2;
    out[i] = tvd - elevation;
    prevCos = c;
  }
  return out;
}

const cache = new WeakMap<Float64Array, { header: Well['header']; curves: Well['curves']; value: Float64Array | null }>();

/** TVDSS del pozo (en caché por profundidad, encabezado y curvas); null si no hay datos para calcularla. */
export function wellTvdss(well: Pick<Well, 'header' | 'curves' | 'depth'>): Float64Array | null {
  const depth = well.depth.values;
  const hit = cache.get(depth);
  if (hit && hit.header === well.header && hit.curves === well.curves) return hit.value;
  const ref = depthReference(well);
  const value = ref ? computeTvdss(depth, ref.elevation, ref.inclination) : null;
  cache.set(depth, { header: well.header, curves: well.curves, value });
  return value;
}

/**
 * Rótulos de la columna TVDSS: valores redondos (múltiplos de `step`, el paso de los rótulos de la MD) ubicados en la
 * MD donde la TVDSS los alcanza (interpolación lineal; la TVDSS crece con la MD mientras la inclinación sea < 90°).
 * Así cada número queda a su profundidad verdadera, aunque el pozo esté desviado.
 */
export function tvdssTicks(md: ArrayLike<number>, tvdss: ArrayLike<number>, top: number, base: number, step: number): { md: number; value: number }[] {
  const n = Math.min(md.length, tvdss.length);
  if (n < 2 || !(step > 0) || !(base > top)) return [];
  const at = (d: number) => {
    // TVDSS en una MD (búsqueda binaria + interpolación; acotada a los extremos).
    if (d <= md[0]!) return tvdss[0]! + (d - md[0]!);
    if (d >= md[n - 1]!) return tvdss[n - 1]! + (d - md[n - 1]!);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (md[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - md[lo]!) / (md[hi]! - md[lo]!);
    return tvdss[lo]! + f * (tvdss[hi]! - tvdss[lo]!);
  };
  const t0 = at(top);
  const t1 = at(base);
  const out: { md: number; value: number }[] = [];
  const k0 = Math.ceil(t0 / step - 1e-9);
  const k1 = Math.floor(t1 / step + 1e-9);
  if (k1 - k0 > 2000) return [];
  let lo = 0;
  for (let k = k0; k <= k1; k++) {
    const value = +(k * step).toPrecision(12);
    // MD donde la TVDSS vale `value`: avanzar hasta el tramo que lo contiene (los rótulos van en orden).
    while (lo < n - 2 && tvdss[lo + 1]! < value) lo++;
    const a = tvdss[lo]!;
    const b = tvdss[lo + 1]!;
    let d: number;
    if (value <= tvdss[0]!) d = md[0]! + (value - tvdss[0]!);
    else if (value >= tvdss[n - 1]!) d = md[n - 1]! + (value - tvdss[n - 1]!);
    else d = b > a ? md[lo]! + ((value - a) / (b - a)) * (md[lo + 1]! - md[lo]!) : md[lo]!;
    if (d >= top - 1e-9 && d <= base + 1e-9) out.push({ md: d, value });
  }
  return out;
}

/** Ancho de la pista de profundidad con la columna TVDSS (px de Compacto). La de solo MD es `DEPTH_TRACK_WIDTH`. */
export const DEPTH_TRACK_WIDTH_TVDSS = 112;
