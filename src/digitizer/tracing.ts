/**
 * Trazado de la curva: de una máscara de trazo a x(y) por fila, con programación dinámica (Viterbi). Puro (sin DOM).
 *
 * MODELO. En cada fila de la máscara se buscan CANDIDATOS: los tramos horizontales contiguos de píxeles activos
 * (intensidad ≥ `threshold`; huecos de ≤ `bridge` px se puentean por el ruido JPEG/anti-aliasing). Cada candidato tiene
 * extremos [a, b], centro subpíxel (centroide ponderado por la intensidad) y calidad q = intensidad media / 255.
 * Se descartan los tramos de ≤ 2 px sin ningún apoyo en las filas vecinas (sal y pimienta) y, si quedan más de
 * `maxCandidates` por fila, se conservan los de mayor masa.
 *
 * Se elige LA trayectoria (un candidato por fila, o ninguno) que minimiza el costo total
 *     C = Σ_j [ (1 − q_j) − R ]  +  Σ_(i→j) T(i,j)  +  Σ_cadenas S
 * con R = `coverageReward` (cada fila explicada "paga" R: la trayectoria prefiere cubrir), y
 *     T(i,j) = ( g' / (σ·√d) )² + 0,02·|c_j − c_i| / d,    g' = max(0, g − freeSlope·d)
 * donde d ≥ 1 es la distancia en filas entre i y j (d > 1 = atraviesa un hueco), g la distancia horizontal entre los
 * tramos (0 si se solapan o se tocan: un barrido casi horizontal es continuo aunque su centro salte), σ = `sigma` y
 * `freeSlope` la pendiente (px/fila) que no se penaliza (una curva empinada que atraviesa un hueco sigue siendo curva).
 * Una transición es admisible si d ≤ `maxGapRows`+1 y g ≤ `maxJump`·d. Una cadena nueva (tras un hueco más largo que
 * `maxGapRows`, o un salto no admisible) cuesta S = `restartCost`: los tramos aislados con menos de S/R filas (≈ 6) nunca
 * valen la pena, lo que descarta rótulos y manchas. Es un Viterbi sobre candidatos con aristas "salteadas" hasta
 * `maxGapRows`+1 filas; la cadena óptima se encuentra en O(filas · (maxGapRows+1) · K²) con K = `maxCandidates`.
 * Ref.: Viterbi (1967); Forney, "The Viterbi algorithm", Proc. IEEE 61 (1973).
 *
 * HUECOS. Un hueco de hasta `maxGapRows` filas (curva punteada, cruce con otra curva o texto que la tapa) se atraviesa
 * interpolando x linealmente: esos puntos salen con `observed = 0` y confianza baja. Un hueco más largo deja NaN: el
 * motor NO inventa datos.
 *
 * TRAMOS ANCHOS. Si el tramo elegido es más ancho que `wideRun` (barrido casi horizontal, la curva se mueve rápido), el
 * centro del tramo no es la posición de la curva en esa fila: se toma el punto del tramo más cercano a la interpolación
 * entre los vecinos angostos (hasta 3 filas a cada lado) y se baja la confianza ∝ wideRun/ancho. El ancho queda registrado.
 *
 * MODOS. AUTOMÁTICO: toda la pista, con un prior opcional ({x, y}) que penaliza cuadráticamente los candidatos lejos de
 * donde se espera la curva. GUIADO: el usuario da una polilínea aproximada; solo se aceptan píxeles dentro de un corredor
 * de ± `corridor` px alrededor de ella y se trazan solo las filas que abarca la polilínea; dentro del corredor los
 * candidatos cercanos a la guía se favorecen levemente.
 */
import { DigitizerError, throwIfAborted, type ProgressOptions } from './errors';
import type { TraceGuide, TraceMask, TracePrior, TraceSettings, TracedCurve } from './types';

export const DEFAULT_TRACE_SETTINGS: Readonly<TraceSettings> = {
  threshold: 96,
  bridge: 1,
  maxCandidates: 12,
  maxGapRows: 25,
  sigma: 2,
  freeSlope: 6,
  maxJump: 40,
  coverageReward: 4,
  restartCost: 24,
  wideRun: 30,
  despeckle: true,
};

export const DEFAULT_CORRIDOR = 12;

export interface TraceOptions extends ProgressOptions {
  settings?: Partial<TraceSettings>;
  guide?: TraceGuide;
  prior?: TracePrior;
}

const bad = (message: string): never => {
  throw new DigitizerError('invalid-options', message);
};

/** Mezcla con los defaults y valida. Lanza `DigitizerError` si un ajuste no es válido. */
export function resolveTraceSettings(partial: Partial<TraceSettings> | undefined): TraceSettings {
  const s: TraceSettings = { ...DEFAULT_TRACE_SETTINGS, ...(partial ?? {}) };
  const positive: Array<keyof TraceSettings> = ['sigma', 'freeSlope', 'maxJump', 'coverageReward', 'restartCost', 'wideRun'];
  for (const key of positive) {
    const v = s[key] as number;
    if (!(Number.isFinite(v) && v > 0)) bad(`El ajuste '${key}' debe ser un número positivo (vale ${String(v)}).`);
  }
  if (!(s.threshold >= 1 && s.threshold <= 255)) bad(`El umbral de intensidad debe estar entre 1 y 255 (vale ${s.threshold}).`);
  if (!(Number.isInteger(s.bridge) && s.bridge >= 0 && s.bridge <= 10)) bad(`El puenteo de huecos debe ser un entero entre 0 y 10 px (vale ${s.bridge}).`);
  if (!(Number.isInteger(s.maxCandidates) && s.maxCandidates >= 1 && s.maxCandidates <= 64)) bad(`El máximo de candidatos por fila debe ser un entero entre 1 y 64 (vale ${s.maxCandidates}).`);
  if (!(Number.isInteger(s.maxGapRows) && s.maxGapRows >= 0 && s.maxGapRows <= 500)) bad(`El hueco máximo debe ser un entero entre 0 y 500 filas (vale ${s.maxGapRows}).`);
  return s;
}

function checkMask(mask: TraceMask): void {
  if (!mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width < 1 || mask.height < 1) {
    throw new DigitizerError('invalid-mask', 'La máscara está vacía: la región de búsqueda no tiene píxeles.');
  }
  if (mask.data.length !== mask.width * mask.height) {
    throw new DigitizerError('invalid-mask', `La máscara declara ${mask.width}×${mask.height} y trae ${mask.data.length} valores.`);
  }
  if (!Number.isFinite(mask.x0) || !Number.isFinite(mask.y0)) throw new DigitizerError('invalid-mask', 'El origen de la máscara no es válido.');
}

/** Guía ordenada por fila y sin filas repetidas; función x(y) por interpolación lineal. */
function prepareGuide(guide: TraceGuide): { ys: number[]; xs: number[]; corridor: number } {
  const pts = guide.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((p, q) => p.y - q.y);
  const ys: number[] = [];
  const xs: number[] = [];
  for (const p of pts) {
    if (ys.length > 0 && p.y - ys[ys.length - 1]! < 1e-9) {
      xs[xs.length - 1] = (xs[xs.length - 1]! + p.x) / 2;
    } else {
      ys.push(p.y);
      xs.push(p.x);
    }
  }
  if (ys.length < 2) bad('La guía necesita al menos 2 puntos en filas distintas.');
  const corridor = guide.corridor ?? DEFAULT_CORRIDOR;
  if (!(Number.isFinite(corridor) && corridor >= 1)) bad('El ancho del corredor debe ser de al menos 1 px.');
  return { ys, xs, corridor };
}

function emptyTrace(y0: number, n: number, warnings: string[]): TracedCurve {
  return {
    y0,
    x: new Float64Array(n).fill(NaN),
    width: new Float64Array(n).fill(NaN),
    confidence: new Float64Array(n),
    observed: new Uint8Array(n),
    warnings,
  };
}

/**
 * Traza la curva en la máscara. Devuelve x(y) en coordenadas de la imagen (la fila de la muestra i es `y0 + i`).
 * Máscara estructuralmente inválida o ajustes inválidos: lanza `DigitizerError`. Máscara sin trazo: devuelve todo NaN con
 * una advertencia. Admite progreso y cancelación.
 */
export function traceCurve(mask: TraceMask, options: TraceOptions = {}): TracedCurve {
  checkMask(mask);
  const S = resolveTraceSettings(options.settings);
  const { onProgress, signal } = options;
  const W = mask.width;
  const data = mask.data;
  const warnings: string[] = [];

  // Tramo de filas (coordenadas de imagen)
  let rowA = mask.y0;
  let rowB = mask.y0 + mask.height - 1;
  let guide: { ys: number[]; xs: number[]; corridor: number } | null = null;
  if (options.guide) {
    guide = prepareGuide(options.guide);
    rowA = Math.max(rowA, Math.ceil(guide.ys[0]!));
    rowB = Math.min(rowB, Math.floor(guide.ys[guide.ys.length - 1]!));
  }
  const n = rowB - rowA + 1;
  if (n < 1) {
    return emptyTrace(rowA, 0, ['La guía no cae dentro de la región de búsqueda: no hay filas que trazar.']);
  }
  const guideX = (y: number): number => {
    const { ys, xs } = guide!;
    let lo = 0;
    let hi = ys.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ys[mid]! <= y) lo = mid;
      else hi = mid;
    }
    const t = (y - ys[lo]!) / (ys[hi]! - ys[lo]!);
    return xs[lo]! + t * (xs[hi]! - xs[lo]!);
  };

  // ---- 1) candidatos por fila ------------------------------------------------------------------------------
  const cap = n * S.maxCandidates;
  const cA = new Int32Array(cap); // extremos en coordenadas de imagen
  const cB = new Int32Array(cap);
  const cX = new Float64Array(cap);
  const cQ = new Float32Array(cap);
  const cMass = new Float32Array(cap);
  const rowStart = new Int32Array(n + 1);
  let M = 0;
  // temporales de la fila
  const tA: number[] = [];
  const tB: number[] = [];
  const tX: number[] = [];
  const tQ: number[] = [];
  const tM: number[] = [];
  const thr = S.threshold;

  for (let r = 0; r < n; r++) {
    if ((r & 255) === 0) {
      throwIfAborted(signal);
      onProgress?.((0.3 * r) / n);
    }
    rowStart[r] = M;
    const yImg = rowA + r;
    const ly = yImg - mask.y0;
    const base = ly * W;
    let xlo = 0;
    let xhi = W - 1;
    if (guide) {
      const gx = guideX(yImg) - mask.x0;
      xlo = Math.max(0, Math.ceil(gx - guide.corridor));
      xhi = Math.min(W - 1, Math.floor(gx + guide.corridor));
      if (xlo > xhi) continue;
    }
    tA.length = tB.length = tX.length = tQ.length = tM.length = 0;
    let a = -1;
    let b = -1;
    const emit = () => {
      let mass = 0;
      let mx = 0;
      for (let x = a; x <= b; x++) {
        const v = data[base + x]!;
        mass += v;
        mx += v * x;
      }
      if (S.despeckle && b - a + 1 <= 2) {
        // apoyo vertical: algún píxel activo en la fila de arriba o de abajo, dentro de [a-1, b+1]
        let supported = false;
        for (let dy = -1; dy <= 1 && !supported; dy += 2) {
          const ny = ly + dy;
          if (ny < 0 || ny >= mask.height) continue;
          const nb = ny * W;
          for (let x = Math.max(0, a - 1); x <= Math.min(W - 1, b + 1); x++) {
            if (data[nb + x]! >= thr) {
              supported = true;
              break;
            }
          }
        }
        if (!supported) return;
      }
      tA.push(a + mask.x0);
      tB.push(b + mask.x0);
      tX.push(mx / mass + mask.x0);
      tQ.push(mass / (b - a + 1) / 255);
      tM.push(mass);
    };
    for (let x = xlo; x <= xhi; x++) {
      if (data[base + x]! >= thr) {
        if (a < 0) a = x;
        else if (x - b - 1 > S.bridge) {
          emit();
          a = x;
        }
        b = x;
      }
    }
    if (a >= 0) emit();
    let idx: number[] = tA.map((_, k) => k);
    if (idx.length > S.maxCandidates) {
      idx = idx.sort((p, q) => tM[q]! - tM[p]!).slice(0, S.maxCandidates).sort((p, q) => p - q);
    }
    for (const k of idx) {
      cA[M] = tA[k]!;
      cB[M] = tB[k]!;
      cX[M] = tX[k]!;
      cQ[M] = tQ[k]!;
      cMass[M] = tM[k]!;
      M++;
    }
  }
  rowStart[n] = M;

  if (M === 0) {
    return emptyTrace(rowA, n, ['No se encontró trazo en la región con el color y la tolerancia elegidos.']);
  }

  // ---- 2) Viterbi ------------------------------------------------------------------------------------------
  const best = new Float64Array(M);
  const pred = new Int32Array(M).fill(-1);
  const restart = new Uint8Array(M);
  const tcost = new Float64Array(M); // costo de la transición entrante elegida (0 si es inicio de cadena)
  const rowOf = new Int32Array(M);
  const maxD = S.maxGapRows + 1;
  const invSig2 = 1 / (S.sigma * S.sigma);
  const priorY = options.prior ? (options.prior.y ?? rowA) : 0;
  const priorSigma = options.prior?.sigma ?? 30;
  const priorRows = options.prior?.rows ?? 40;
  let pminVal = 0;
  let pminArg = -1;

  for (let r = 0; r < n; r++) {
    if ((r & 255) === 0) {
      throwIfAborted(signal);
      onProgress?.(0.3 + (0.6 * r) / n);
    }
    const j0 = rowStart[r]!;
    const j1 = rowStart[r + 1]!;
    let rowMin = Infinity;
    let rowArg = -1;
    for (let j = j0; j < j1; j++) {
      rowOf[j] = r;
      // emisión
      let emis = 1 - cQ[j]! - S.coverageReward;
      if (guide) {
        const dg = (cX[j]! - guideX(rowA + r)) / guide.corridor;
        emis += dg * dg;
      }
      if (options.prior && Math.abs(rowA + r - priorY) <= priorRows) {
        const dp = (cX[j]! - options.prior.x) / priorSigma;
        emis += Math.min(dp * dp, 25);
      }
      // mejor predecesor conectado
      let bestC = Infinity;
      let bestP = -1;
      let bestT = 0;
      const aj = cA[j]!;
      const bj = cB[j]!;
      const xj = cX[j]!;
      for (let d = 1; d <= maxD && r - d >= 0; d++) {
        const i0 = rowStart[r - d]!;
        const i1 = rowStart[r - d + 1]!;
        if (i0 === i1) continue;
        const lim = S.maxJump * d;
        const freeD = S.freeSlope * d;
        const invs = invSig2 / d;
        for (let i = i0; i < i1; i++) {
          const lo = aj > cA[i]! ? aj : cA[i]!;
          const hi = bj < cB[i]! ? bj : cB[i]!;
          const g = lo - hi - 1 > 0 ? lo - hi - 1 : 0;
          if (g > lim) continue;
          const ge = g - freeD > 0 ? g - freeD : 0;
          const t = ge * ge * invs + (0.02 * Math.abs(xj - cX[i]!)) / d;
          const c = best[i]! + t;
          if (c < bestC) {
            bestC = c;
            bestP = i;
            bestT = t;
          }
        }
      }
      const restartC = pminVal + S.restartCost;
      if (bestP >= 0 && bestC <= restartC) {
        best[j] = bestC + emis;
        pred[j] = bestP;
        tcost[j] = bestT;
      } else {
        best[j] = restartC + emis;
        pred[j] = pminArg;
        restart[j] = 1;
        tcost[j] = 0;
      }
      if (best[j]! < rowMin) {
        rowMin = best[j]!;
        rowArg = j;
      }
    }
    if (rowArg >= 0 && rowMin < pminVal) {
      pminVal = rowMin;
      pminArg = rowArg;
    }
  }

  if (pminArg < 0) {
    return emptyTrace(rowA, n, ['El trazo encontrado es demasiado corto o inconsistente para ser una curva (se descartó como ruido o texto).']);
  }

  // ---- 3) reconstrucción -----------------------------------------------------------------------------------
  const chain: number[] = [];
  for (let cur = pminArg; cur >= 0; cur = pred[cur]!) {
    chain.push(cur); // en un reinicio, pred apunta al final de la cadena anterior: se sigue para recuperarla
  }
  chain.reverse();

  const out = emptyTrace(rowA, n, warnings);
  const x = out.x;
  const width = out.width;
  const conf = out.confidence;
  const obs = out.observed;
  const cand = new Int32Array(n).fill(-1);
  for (let k = 0; k < chain.length; k++) {
    const j = chain[k]!;
    const r = rowOf[j]!;
    cand[r] = j;
    x[r] = cX[j]!;
    width[r] = cB[j]! - cA[j]! + 1;
    obs[r] = 1;
    // confianza: calidad × (ancho) × continuidad (transición entrante y saliente)
    const next = chain[k + 1];
    const tout = next !== undefined && !restart[next] ? tcost[next]! : 0;
    const wideF = width[r]! <= S.wideRun ? 1 : Math.max(0.2, S.wideRun / width[r]!);
    conf[r] = Math.max(0.02, Math.min(1, cQ[j]! * wideF * Math.exp(-0.35 * Math.max(tcost[j]!, tout))));
    // relleno interpolado del hueco tolerado
    if (k > 0 && !restart[j]) {
      const p = chain[k - 1]!;
      const rp = rowOf[p]!;
      for (let rr = rp + 1; rr < r; rr++) {
        const t = (rr - rp) / (r - rp);
        x[rr] = cX[p]! + t * (cX[j]! - cX[p]!);
        width[rr] = 0;
        obs[rr] = 0;
      }
    }
  }
  // confianza de los puntos interpolados: 25 % del menor entre sus vecinos observados
  for (let k = 1; k < chain.length; k++) {
    const j = chain[k]!;
    if (restart[j]) continue;
    const p = chain[k - 1]!;
    const rp = rowOf[p]!;
    const r = rowOf[j]!;
    const cm = Math.min(conf[rp]!, conf[r]!);
    for (let rr = rp + 1; rr < r; rr++) conf[rr] = 0.25 * cm;
  }

  // ---- 4) refinamiento de tramos anchos --------------------------------------------------------------------
  const refined = new Float64Array(x);
  let wideCount = 0;
  for (let r = 0; r < n; r++) {
    const j = cand[r]!;
    if (j < 0 || !(width[r]! > S.wideRun)) continue;
    wideCount++;
    let rl = -1;
    let rr2 = -1;
    for (let s = 1; s <= 3 && rl < 0; s++) if (r - s >= 0 && cand[r - s]! >= 0 && width[r - s]! <= S.wideRun) rl = r - s;
    for (let s = 1; s <= 3 && rr2 < 0; s++) if (r + s < n && cand[r + s]! >= 0 && width[r + s]! <= S.wideRun) rr2 = r + s;
    let target = NaN;
    if (rl >= 0 && rr2 >= 0) target = x[rl]! + ((r - rl) / (rr2 - rl)) * (x[rr2]! - x[rl]!);
    else if (rl >= 0) target = x[rl]!;
    else if (rr2 >= 0) target = x[rr2]!;
    if (!Number.isNaN(target)) refined[r] = Math.min(cB[j]!, Math.max(cA[j]!, target));
  }
  x.set(refined);

  let covered = 0;
  for (let r = 0; r < n; r++) if (!Number.isNaN(x[r]!)) covered++;
  if (covered < 0.5 * n) warnings.push(`El trazo se encontró en solo el ${((100 * covered) / n).toFixed(0)} % de las filas: revisá el color, la tolerancia o usá el modo guiado.`);
  if (wideCount > 0.1 * n) warnings.push('Hay muchos tramos casi horizontales (curva muy empinada o trazo sobre una línea de la grilla): la precisión baja en esos puntos.');
  onProgress?.(1);
  return out;
}
