/**
 * Fichas de zona (docs/decisiones/0018): lo puro. Toma lo que ya calcularon el sumario por zona y el volumétrico
 * (tablas `ZONE_SUMMARY` y `VOLUMETRICS`) y las curvas PHIE y SW activas; no recalcula petrofísica.
 */
import type { TableCell } from '../../core/module';
import type { ZoneKind } from '../../core/well';

export type Row = Readonly<Record<string, TableCell>>;

/** Zona tal como la necesita la ficha. */
export interface CardZone {
  id: string;
  name: string;
  color: string;
  kind: ZoneKind;
  top: number;
  base: number;
}

// ── semáforo de pay ──────────────────────────────────────────────────────────────────────────────────────────────

/** N/G pay (neto pay / bruto) por debajo del cual el pay es marginal: menos de la décima parte de la zona. */
export const PAY_MARGINAL_NTG = 0.1;
/** Espesor de pay neto (m) por debajo del cual el pay es marginal: un intervalo delgado, difícil de probar. */
export const PAY_MARGINAL_THICKNESS = 1;

/**
 * 'pay' (verde): hay pay y no es marginal · 'marginal' (ámbar): hay pay pero con N/G pay < 10 % o menos de 1 m netos ·
 * 'none' (gris, «Sin pay»): hay dato y el pay es 0, o la zona es un sello · 'nodata' (gris, «Sin dato»): el sumario no
 * pudo clasificar la zona (sin muestras, sin cutoffs aplicables o sin Sw en todo el reservorio).
 */
export type PayLight = 'pay' | 'marginal' | 'none' | 'nodata';

export const PAY_LIGHT_LABEL: Readonly<Record<PayLight, string>> = { pay: 'Pay', marginal: 'Pay marginal', none: 'Sin pay', nodata: 'Sin dato' };

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Semáforo de pay de una zona. `ntgPay` es opcional: si falta se calcula como `netPay / gross`. Puro. */
export function payLight(z: { kind: ZoneKind | null; gross?: number | null; netPay: number | null | undefined; ntgPay?: number | null }): PayLight {
  if (z.kind === 'seal') return 'none';
  if (!finite(z.netPay)) return 'nodata';
  if (z.netPay <= 0) return 'none';
  const ntg = finite(z.ntgPay) ? z.ntgPay : finite(z.gross) && z.gross > 0 ? z.netPay / z.gross : null;
  if (z.netPay < PAY_MARGINAL_THICKNESS || (ntg !== null && ntg < PAY_MARGINAL_NTG)) return 'marginal';
  return 'pay';
}

/** Explicación del criterio (tooltip del semáforo). */
export const PAY_CRITERION = `Verde: hay pay. Ámbar: pay marginal (menos de ${PAY_MARGINAL_THICKNESS} m netos o N/G pay menor a ${PAY_MARGINAL_NTG * 100} %). Gris: sin pay, sello o sin dato.`;

// ── datos de la ficha ────────────────────────────────────────────────────────────────────────────────────────────

/** Volumen in situ de la zona, con las unidades del sumario: petróleo en MMbbl (y Mm³), gas en Bcf (y MMm³). */
export interface CardVolume {
  fluid: 'oil' | 'gas' | 'both';
  /** Petróleo: MMbbl y Mm³ estándar. */
  oil?: { field: number; si: number };
  /** Gas: Bcf y MMm³ estándar. */
  gas?: { field: number; si: number };
}

export interface ZoneCard {
  id: string;
  name: string;
  color: string;
  kind: ZoneKind;
  top: number;
  base: number;
  /** Espesor bruto (m). */
  gross: number;
  /** Neto de reservorio y neto pay (m); null = sin dato. */
  netRes: number | null;
  netPay: number | null;
  ntgPay: number | null;
  /** φ y Sw promedio del pay (v/v); null = sin dato. */
  phiPay: number | null;
  swPay: number | null;
  light: PayLight;
  /** Fluido de la zona según el volumétrico («Petróleo», «Gas», «Sello»…) o null si no hay tabla. */
  fluid: string | null;
  volume: CardVolume | null;
}

const num = (c: TableCell | undefined): number | null => (typeof c === 'number' && Number.isFinite(c) ? c : null);

/** Volumen de una fila del volumétrico (null si la zona no tiene fluido o es un sello). */
export function cardVolume(row: Row | undefined): CardVolume | null {
  if (!row) return null;
  const oilField = num(row.ooipField);
  const oilSi = num(row.ooipSi);
  const gasField = num(row.ogipField);
  const gasSi = num(row.ogipSi);
  const oil = oilField !== null && oilSi !== null ? { field: oilField, si: oilSi } : null;
  const gas = gasField !== null && gasSi !== null ? { field: gasField, si: gasSi } : null;
  if (row.fluid === 'Sello' || (!oil && !gas)) return null;
  return { fluid: oil && gas ? 'both' : gas ? 'gas' : 'oil', ...(oil ? { oil } : {}), ...(gas ? { gas } : {}) };
}

/**
 * Una ficha por zona, en orden de tope. Las filas de las tablas se ubican por nombre de zona (los nombres son únicos,
 * `validateZoneName`); la fila «Total» no es de ninguna zona. Sin tabla de sumario, los campos vienen en null.
 */
export function buildZoneCards(zones: readonly CardZone[], summary: readonly Row[] | null, volumetrics: readonly Row[] | null): ZoneCard[] {
  return [...zones]
    .sort((a, b) => a.top - b.top)
    .map((z) => {
      const s = summary?.find((r) => r.zone === z.name && r.zone !== 'Total');
      const v = volumetrics?.find((r) => r.zone === z.name && r.zone !== 'Total');
      const gross = num(s?.gross) ?? z.base - z.top;
      const netPay = num(s?.netPay);
      const ntgPay = num(s?.ntgPay);
      return {
        id: z.id,
        name: z.name,
        color: z.color,
        kind: z.kind,
        top: z.top,
        base: z.base,
        gross,
        netRes: num(s?.netRes),
        netPay,
        ntgPay,
        phiPay: num(s?.phiPay),
        swPay: num(s?.swPay),
        light: payLight({ kind: z.kind, gross, netPay, ntgPay }),
        fluid: typeof v?.fluid === 'string' ? v.fluid : null,
        volume: cardVolume(v),
      };
    });
}

// ── minigráficos ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Serie para un minigráfico en profundidad: promedio por franja de profundidad dentro de [top, base]. `y` va de 0
 * (tope) a 1 (base); `v` es NaN en las franjas sin dato (el trazo se corta). `depth` debe ser creciente. Puro.
 */
export function sparkSeries(depth: ArrayLike<number>, values: ArrayLike<number>, top: number, base: number, buckets = 48): { y: Float64Array; v: Float64Array } {
  const y = new Float64Array(buckets);
  const v = new Float64Array(buckets).fill(NaN);
  const sum = new Float64Array(buckets);
  const cnt = new Uint32Array(buckets);
  const span = base - top;
  for (let b = 0; b < buckets; b++) y[b] = (b + 0.5) / buckets;
  if (!(span > 0)) return { y, v };
  // primera muestra con profundidad ≥ top (búsqueda binaria)
  let lo = 0;
  let hi = depth.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (depth[mid]! < top) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < depth.length && depth[i]! <= base; i++) {
    const x = values[i];
    if (x === undefined || !Number.isFinite(x)) continue;
    const b = Math.min(buckets - 1, Math.floor(((depth[i]! - top) / span) * buckets));
    sum[b]! += x;
    cnt[b]!++;
  }
  for (let b = 0; b < buckets; b++) if (cnt[b]! > 0) v[b] = sum[b]! / cnt[b]!;
  return { y, v };
}

export interface SparkScale {
  min: number;
  max: number;
  /** true: el mayor queda a la izquierda (Sw, como en el visor). */
  reversed: boolean;
}

/** Escala redondeada hacia arriba (0,1 / 0,15 / 0,2 / 0,25 / 0,3 / 0,4 / 0,5…) para que dos fichas se comparen a simple vista. */
export function niceCeil(x: number, fallback = 1): number {
  if (!Number.isFinite(x) || x <= 0) return fallback;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= x - 1e-12) return Math.round(m * p * 1e6) / 1e6;
  return 10 * p;
}

/** Máximo de la escala de φ: el percentil 99 de la curva en las zonas con ficha, redondeado (mínimo 0,1). */
export function porosityScaleMax(values: ArrayLike<number>): number {
  const xs: number[] = [];
  const step = Math.max(1, Math.floor(values.length / 4000));
  for (let i = 0; i < values.length; i += step) {
    const x = values[i]!;
    if (Number.isFinite(x) && x >= 0) xs.push(x);
  }
  if (xs.length === 0) return 0.4;
  xs.sort((a, b) => a - b);
  return Math.max(0.1, niceCeil(xs[Math.floor((xs.length - 1) * 0.99)]!, 0.4));
}

/**
 * Trazo SVG de un minigráfico: x según la escala (con `reversed`), y = profundidad hacia abajo, en un recuadro w × h.
 * `line` es el trazado; `area` cierra contra el borde izquierdo (`edge: 'left'`) o derecho. Las franjas sin dato
 * cortan el trazo. Vacío si no hay ningún dato.
 */
export function sparkPaths(series: { y: ArrayLike<number>; v: ArrayLike<number> }, scale: SparkScale, w: number, h: number, edge: 'left' | 'right'): { line: string; area: string } {
  const span = scale.max - scale.min;
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  const xOf = (val: number) => {
    const t = Math.min(1, Math.max(0, (val - scale.min) / span));
    return (scale.reversed ? 1 - t : t) * w;
  };
  const x0 = edge === 'left' ? 0 : w;
  let line = '';
  let area = '';
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length > 0) {
      line += run.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`).join('');
      const first = run[0]!;
      const last = run[run.length - 1]!;
      area += `M${f(x0)} ${f(first[1])}` + run.map(([x, y]) => `L${f(x)} ${f(y)}`).join('') + `L${f(x0)} ${f(last[1])}Z`;
    }
    run = [];
  };
  if (!(span > 0)) return { line, area };
  for (let i = 0; i < series.v.length; i++) {
    const val = series.v[i]!;
    if (!Number.isFinite(val)) {
      flush();
      continue;
    }
    run.push([xOf(val), series.y[i]! * h]);
  }
  flush();
  return { line, area };
}
