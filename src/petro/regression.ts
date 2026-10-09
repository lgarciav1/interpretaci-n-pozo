/**
 * Líneas de tendencia: ajuste por mínimos cuadrados lineal, logarítmico, exponencial y potencial.
 *
 * Modelos (x e y en las unidades que use el llamador; el motor no asume ninguna):
 *   linear   y = a + b·x
 *   log      y = a + b·ln(x)            (x > 0)
 *   exp      y = a·e^(b·x)              (y > 0)
 *   power    y = a·x^b                  (x > 0, y > 0)
 *
 * Ajuste: se linealiza (u = x o ln x; v = y o ln y) y se resuelve la recta v = c + b·u por mínimos cuadrados
 * ordinarios: b = Suv/Suu, c = v̄ − b·ū, con Suu = Σ(u−ū)², Suv = Σ(u−ū)(v−v̄). En exp y power, a = e^c.
 * Es el mismo criterio que la línea de tendencia de Excel (los modelos exp y power NO minimizan el error en el
 * espacio original de y, sino en ln y; por eso el rmse se informa aparte, en el espacio original).
 *
 * R²: convención de Excel, calculada en el espacio linealizado: R² = Suv² / (Suu·Svv) = 1 − SSE/SST con
 * SSE/SST medidos sobre v (ln y para exp y power; y para linear y log). Si y es constante (Svv = 0) el ajuste es
 * exacto y se informa R² = 1.
 *
 * Numérica: algoritmo de dos pasadas (medias con corrimiento respecto de la primera muestra, luego sumas
 * centradas), sin asignar arrays. Con profundidades ~8000 m y pendientes de 1e-2 recupera los coeficientes con
 * error relativo ≪ 1e-9. Costo O(n) (tres recorridos), apto para recalcular en vivo con 50 000 muestras.
 *
 * Referencias: Draper y Smith (1998), "Applied Regression Analysis", cap. 1-2 (mínimos cuadrados y R²);
 * Anscombe, F.J. (1973), "Graphs in statistical analysis", The American Statistician 27(1):17-21;
 * Asquith y Krygowski (2004), cap. 1 (ajustes empíricos φ–k, relaciones exponenciales y potenciales).
 */

export type TrendModel = 'linear' | 'log' | 'exp' | 'power';

/** Coeficientes de una tendencia: linear y=a+b·x; log y=a+b·ln x; exp y=a·e^(b·x); power y=a·x^b. */
export interface TrendCoefficients {
  model: TrendModel;
  a: number;
  b: number;
}

export interface TrendFit extends TrendCoefficients {
  /** R² en el espacio linealizado (convención Excel): sobre ln y para exp y power, sobre y para linear y log. */
  r2: number;
  /** Puntos usados en el ajuste. */
  n: number;
  /** Puntos descartados por dato no finito (NaN, ±Inf) o fuera de dominio (x ≤ 0 en log/power, y ≤ 0 en exp/power). */
  skipped: number;
  /** Rango de x de los puntos usados. */
  xMin: number;
  xMax: number;
  /** Raíz del error cuadrático medio, √(Σ(y − ŷ)²/n), en el espacio original de y. */
  rmse: number;
}

export interface FitOptions {
  /** Primer índice (inclusive) del tramo a ajustar. Por defecto 0. */
  start?: number;
  /** Último índice (exclusivo). Por defecto, el largo de los arrays. */
  end?: number;
  /** Si se da, se ajustan solo estos índices (tiene prioridad sobre start/end). Los fuera de rango se ignoran. */
  indices?: ArrayLike<number>;
  /** Puntos que el usuario sacó a mano (outliers): no se usan ni cuentan como descartados. */
  exclude?: (i: number) => boolean;
}

/** Etiquetas (español) y forma LaTeX de cada modelo, para el módulo Ecuaciones. */
export const TREND_MODEL_DOCS: Record<TrendModel, { label: string; latex: string }> = {
  linear: { label: 'Lineal', latex: 'y = a + b\\,x' },
  log: { label: 'Logarítmica', latex: 'y = a + b\\,\\ln x' },
  exp: { label: 'Exponencial', latex: 'y = a\\,e^{b\\,x}' },
  power: { label: 'Potencial', latex: 'y = a\\,x^{b}' },
};

function usesLnX(model: TrendModel): boolean {
  return model === 'log' || model === 'power';
}

function usesLnY(model: TrendModel): boolean {
  return model === 'exp' || model === 'power';
}

/** Recorre los índices que pide `opts` (acotados a [0, len)). */
function visit(len: number, opts: FitOptions, fn: (i: number) => void): void {
  const exclude = opts.exclude;
  if (opts.indices) {
    const idx = opts.indices;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k]!;
      if (!Number.isInteger(i) || i < 0 || i >= len) continue;
      if (exclude && exclude(i)) continue;
      fn(i);
    }
    return;
  }
  const start = Math.max(0, Math.floor(opts.start ?? 0));
  const end = Math.min(len, Math.floor(opts.end ?? len));
  for (let i = start; i < end; i++) {
    if (exclude && exclude(i)) continue;
    fn(i);
  }
}

/**
 * Ajusta una línea de tendencia y = f(x) por mínimos cuadrados (ver cabecera del archivo).
 *
 * @param x     variable independiente (p. ej. profundidad en m)
 * @param y     variable dependiente (misma longitud; si difiere se usa la menor)
 * @param model 'linear' | 'log' | 'exp' | 'power'
 * @param opts  tramo (`start`/`end`), `indices` explícitos y `exclude` de outliers
 * @returns el ajuste, o null si quedan menos de 2 puntos válidos o x (transformada) es constante.
 *
 * Para tendencias no lineales en profundidad, la pendiente local dy/dx se obtiene con `trendSlopeAt`; para un
 * gradiente "único" (p. ej. compactación exp), evaluarla en el centro del tramo ((xMin+xMax)/2).
 */
export function fitTrend(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  model: TrendModel,
  opts: FitOptions = {},
): TrendFit | null {
  const len = Math.min(x.length, y.length);
  const lnX = usesLnX(model);
  const lnY = usesLnY(model);

  let n = 0;
  let skipped = 0;
  let u0 = 0;
  let v0 = 0;
  let shiftU = 0;
  let shiftV = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  let uMin = Infinity;
  let uMax = -Infinity;

  // Pasada 1: conteo, dominio, rango y medias (con corrimiento respecto del primer punto válido).
  visit(len, opts, (i) => {
    const xi = x[i]!;
    const yi = y[i]!;
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || (lnX && xi <= 0) || (lnY && yi <= 0)) {
      skipped++;
      return;
    }
    const u = lnX ? Math.log(xi) : xi;
    const v = lnY ? Math.log(yi) : yi;
    if (n === 0) {
      u0 = u;
      v0 = v;
    }
    shiftU += u - u0;
    shiftV += v - v0;
    n++;
    if (xi < xMin) xMin = xi;
    if (xi > xMax) xMax = xi;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
  });

  if (n < 2 || !(uMax > uMin)) return null;

  const meanU = u0 + shiftU / n;
  const meanV = v0 + shiftV / n;

  // Pasada 2: sumas centradas.
  let suu = 0;
  let suv = 0;
  let svv = 0;
  visit(len, opts, (i) => {
    const xi = x[i]!;
    const yi = y[i]!;
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || (lnX && xi <= 0) || (lnY && yi <= 0)) return;
    const du = (lnX ? Math.log(xi) : xi) - meanU;
    const dv = (lnY ? Math.log(yi) : yi) - meanV;
    suu += du * du;
    suv += du * dv;
    svv += dv * dv;
  });

  if (!(suu > 0)) return null;
  const slope = suv / suu;
  const intercept = meanV - slope * meanU;
  const a = lnY ? Math.exp(intercept) : intercept;
  if (!Number.isFinite(slope) || !Number.isFinite(a) || (lnY && a === 0)) return null;

  const coef: TrendCoefficients = { model, a, b: slope };
  const r2raw = svv > 0 ? (suv * suv) / (suu * svv) : 1;
  const r2 = Math.min(1, Math.max(0, r2raw));

  // Pasada 3: error cuadrático medio en el espacio original de y.
  let sse = 0;
  visit(len, opts, (i) => {
    const xi = x[i]!;
    const yi = y[i]!;
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || (lnX && xi <= 0) || (lnY && yi <= 0)) return;
    const e = yi - evalTrend(coef, xi);
    sse += e * e;
  });

  return { ...coef, r2, n, skipped, xMin, xMax, rmse: Math.sqrt(sse / n) };
}

/** Evalúa la tendencia en x. NaN si x cae fuera del dominio (x ≤ 0 en log y power) o es NaN. */
export function evalTrend(c: TrendCoefficients, x: number): number {
  switch (c.model) {
    case 'linear':
      return c.a + c.b * x;
    case 'log':
      return x > 0 ? c.a + c.b * Math.log(x) : NaN;
    case 'exp':
      return c.a * Math.exp(c.b * x);
    case 'power':
      return x > 0 ? c.a * Math.pow(x, c.b) : NaN;
  }
}

/**
 * Inversa: x tal que f(x) = y. NaN si no existe (pendiente nula, o y/a ≤ 0 en exp y power, o resultado no finito).
 *   linear x = (y − a)/b;  log x = e^((y − a)/b);  exp x = ln(y/a)/b;  power x = (y/a)^(1/b).
 */
export function invertTrend(c: TrendCoefficients, y: number): number {
  let x = NaN;
  if (Number.isNaN(y) || c.b === 0) return NaN;
  switch (c.model) {
    case 'linear':
      x = (y - c.a) / c.b;
      break;
    case 'log':
      x = Math.exp((y - c.a) / c.b);
      break;
    case 'exp': {
      const r = y / c.a;
      x = r > 0 ? Math.log(r) / c.b : NaN;
      break;
    }
    case 'power': {
      const r = y / c.a;
      x = r > 0 ? Math.pow(r, 1 / c.b) : NaN;
      break;
    }
  }
  return Number.isFinite(x) ? x : NaN;
}

/**
 * Pendiente dy/dx de la tendencia en x:
 *   linear b;  log b/x;  exp a·b·e^(b·x);  power a·b·x^(b−1).
 * NaN fuera del dominio (x ≤ 0 en log y power). En modelos no lineales el gradiente depende de x: para un valor
 * representativo de un tramo usar su centro, (xMin + xMax)/2.
 */
export function trendSlopeAt(c: TrendCoefficients, x: number): number {
  switch (c.model) {
    case 'linear':
      return c.b;
    case 'log':
      return x > 0 ? c.b / x : NaN;
    case 'exp':
      return c.a * c.b * Math.exp(c.b * x);
    case 'power':
      return x > 0 ? c.a * c.b * Math.pow(x, c.b - 1) : NaN;
  }
}

/**
 * Tendencia "dibujada a mano": la única curva del modelo que pasa exactamente por los dos puntos.
 * null si los puntos no definen la curva: x iguales (tras transformar), valores no finitos o fuera de dominio
 * (x ≤ 0 en log/power, y ≤ 0 en exp/power), o coeficientes no representables.
 */
export function trendThroughPoints(
  model: TrendModel,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): TrendCoefficients | null {
  const vals = [p1.x, p1.y, p2.x, p2.y];
  if (!vals.every(Number.isFinite)) return null;
  if (usesLnX(model) && (p1.x <= 0 || p2.x <= 0)) return null;
  if (usesLnY(model) && (p1.y <= 0 || p2.y <= 0)) return null;
  const u1 = usesLnX(model) ? Math.log(p1.x) : p1.x;
  const u2 = usesLnX(model) ? Math.log(p2.x) : p2.x;
  const v1 = usesLnY(model) ? Math.log(p1.y) : p1.y;
  const v2 = usesLnY(model) ? Math.log(p2.y) : p2.y;
  if (u1 === u2) return null;
  const b = (v2 - v1) / (u2 - u1);
  const c = v1 - b * u1;
  const a = usesLnY(model) ? Math.exp(c) : c;
  if (!Number.isFinite(a) || !Number.isFinite(b) || (usesLnY(model) && a === 0)) return null;
  return { model, a, b };
}

const SCAN_STEPS = 512;
const BISECT_ITERATIONS = 200;

/**
 * Abscisa donde se cortan dos tendencias, o null si no se cortan o el corte es ambiguo.
 *
 * - Mismo modelo: forma cerrada, único corte posible.
 *     linear/log: a1 + b1·t = a2 + b2·t con t = x (linear) o ln x (log) → t = (a2 − a1)/(b1 − b2).
 *     exp:   x = ln(a2/a1)/(b1 − b2)        (requiere a2/a1 > 0)
 *     power: x = (a2/a1)^(1/(b1 − b2))      (requiere a2/a1 > 0)
 *   Curvas paralelas o idénticas (b1 = b2) → null.
 * - Modelos distintos: requiere `xRange`. Se muestrea f1 − f2 en 512 tramos, se detectan los cambios de signo
 *   (o ceros exactos) y se refina por bisección. Con exactamente un corte se devuelve; sin cortes, con varios o con
 *   tramos coincidentes → null (ambiguo). Un contacto tangente (sin cambio de signo) no se detecta.
 * - Si se da `xRange` [x1, x2], el corte debe caer dentro (inclusive); si no → null.
 *
 * Uso típico: contacto entre dos gradientes de fluido (rectas P(z) de agua y petróleo).
 */
export function intersectTrends(
  c1: TrendCoefficients,
  c2: TrendCoefficients,
  xRange?: [number, number],
): number | null {
  const inRange = (x: number): boolean => {
    if (!xRange) return true;
    const lo = Math.min(xRange[0], xRange[1]);
    const hi = Math.max(xRange[0], xRange[1]);
    return x >= lo && x <= hi;
  };

  if (c1.model === c2.model) {
    const db = c1.b - c2.b;
    if (!(db !== 0) || !Number.isFinite(db)) return null;
    let x = NaN;
    switch (c1.model) {
      case 'linear':
        x = (c2.a - c1.a) / db;
        break;
      case 'log':
        x = Math.exp((c2.a - c1.a) / db);
        break;
      case 'exp': {
        const r = c2.a / c1.a;
        x = r > 0 ? Math.log(r) / db : NaN;
        break;
      }
      case 'power': {
        const r = c2.a / c1.a;
        x = r > 0 ? Math.pow(r, 1 / db) : NaN;
        break;
      }
    }
    if ((c1.model === 'log' || c1.model === 'power') && !(x > 0)) return null; // exp(−∞) = 0 no es una abscisa válida
    return Number.isFinite(x) && inRange(x) ? x : null;
  }

  if (!xRange) return null;
  const lo = Math.min(xRange[0], xRange[1]);
  const hi = Math.max(xRange[0], xRange[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null;

  const g = (x: number): number => evalTrend(c1, x) - evalTrend(c2, x);
  const step = (hi - lo) / SCAN_STEPS;
  let found: number | null = null;
  let count = 0;
  let prevX = NaN;
  let prevG = NaN;
  for (let k = 0; k <= SCAN_STEPS; k++) {
    const xk = k === SCAN_STEPS ? hi : lo + k * step;
    const gk = g(xk);
    if (Number.isNaN(gk)) {
      prevG = NaN;
      continue;
    }
    if (gk === 0) {
      // Dos ceros consecutivos: curvas coincidentes en un tramo → ambiguo.
      if (prevG === 0) return null;
      found = xk;
      count++;
    } else if (!Number.isNaN(prevG) && prevG !== 0 && prevG < 0 !== gk < 0) {
      let a = prevX;
      let b = xk;
      let ga = prevG;
      for (let it = 0; it < BISECT_ITERATIONS; it++) {
        const m = 0.5 * (a + b);
        if (m === a || m === b) break;
        const gm = g(m);
        if (gm === 0) {
          a = m;
          b = m;
          break;
        }
        if (ga < 0 !== gm < 0) b = m;
        else {
          a = m;
          ga = gm;
        }
      }
      found = 0.5 * (a + b);
      count++;
    }
    prevX = xk;
    prevG = gk;
  }
  return count === 1 ? found : null;
}

/** Número con `digits` cifras significativas, coma decimal, signo menos tipográfico y sin ceros finales. */
function formatNumber(v: number, digits: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (v === 0) return '0';
  const sign = v < 0 ? '−' : '';
  const abs = Math.abs(v);
  let body: string;
  if (abs >= Math.pow(10, digits) && abs < 1e12) {
    // Parte entera completa (no se redondea a cifras significativas para no falsear el orden de magnitud).
    body = Math.round(abs).toString();
  } else if (abs < 1e-4 || abs >= 1e12) {
    const [mant, exp] = abs.toExponential(digits - 1).split('e') as [string, string];
    return `${sign}${trimZeros(mant).replace('.', ',')}·10${superscript(Number(exp))}`;
  } else {
    body = abs.toPrecision(digits);
    if (body.includes('e')) body = abs.toFixed(Math.max(0, digits - 1 - Math.floor(Math.log10(abs))));
  }
  return sign + trimZeros(body).replace('.', ',');
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

function superscript(n: number): string {
  return String(n).split('').map((ch) => SUPERSCRIPT[ch] ?? ch).join('');
}

/**
 * Ecuación para mostrar en la interfaz (coma decimal, signo menos tipográfico "−", `digits` cifras significativas,
 * 3 por defecto; sin ceros finales). Ejemplos:
 *   linear "y = 0,433·x + 14,7"     log "y = 12,3·ln(x) − 4,5"
 *   exp    "y = 152·e^(−0,00031·x)"  power "y = 152·x^(−0,5)"
 * `x` e `y` son los nombres de las variables (por defecto "x" e "y"). Coeficientes menores que 1e-4 se escriben en
 * notación científica ("3,1·10⁻⁵").
 */
export function formatTrendEquation(
  c: TrendCoefficients,
  opts: { x?: string; y?: string; digits?: number } = {},
): string {
  const xs = opts.x ?? 'x';
  const ys = opts.y ?? 'y';
  const digits = Math.max(1, Math.min(10, Math.round(opts.digits ?? 3)));
  const fa = formatNumber(c.a, digits);
  const fb = formatNumber(c.b, digits);
  const withOffset = (term: string): string => {
    if (c.a === 0 || fa === '0') return term;
    const neg = fa.startsWith('−');
    return `${term} ${neg ? '−' : '+'} ${neg ? fa.slice(1) : fa}`;
  };
  switch (c.model) {
    case 'linear':
      if (c.b === 0 || fb === '0') return `${ys} = ${fa}`;
      return `${ys} = ${withOffset(`${fb}·${xs}`)}`;
    case 'log':
      if (c.b === 0 || fb === '0') return `${ys} = ${fa}`;
      return `${ys} = ${withOffset(`${fb}·ln(${xs})`)}`;
    case 'exp':
      return `${ys} = ${fa}·e^(${fb}·${xs})`;
    case 'power':
      return `${ys} = ${fa}·${xs}^${c.b < 0 ? `(${fb})` : fb}`;
  }
}
