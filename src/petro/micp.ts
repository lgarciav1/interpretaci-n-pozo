/**
 * Usos de las curvas de inyección de mercurio (MICP): ajuste de Thomeer, permeabilidad desde la curva (Swanson,
 * Thomeer), Brooks–Corey por muestra, paso laboratorio → reservorio y altura sobre el agua libre, permeabilidades
 * relativas de Brooks–Corey–Burdine, flujo fraccional, cutoff de Sw basado en datos y comparación con el CMR.
 *
 * Convenciones (las mismas del resto del motor de roca):
 * - Presión capilar de laboratorio en psi (mercurio–aire). El llamador convierte kg/cm² con `KGF_CM2_TO_PSI`.
 * - Saturación de la fase mojante `sw` y porosidad `phi` en v/v (no en %). SHg = 1 − Sw.
 * - Volumen de mercurio sobre volumen TOTAL (Bv, Sb) en % del volumen total de roca: Bv = SHg·φ·100.
 * - Alturas en m, densidades en g/cm³, gradientes de presión en psi/ft, tensión interfacial en dyn/cm.
 * - Funciones escalares: NaN fuera de dominio. Ajustes: `null` si no se pueden calcular (como `fitTrend`).
 *
 * Reutiliza `rockTyping.ts` (interpolación de curvas, Brooks–Corey, mercurio–aire), `regression.ts` (`fitTrend`) y
 * `saturationHeight.ts` (`capillaryTransferFactor`). Sin UI ni estado.
 *
 * Referencias:
 * - Thomeer, J.H.M. (1960), «Introduction of a pore geometrical factor defined by the capillary pressure curve»,
 *   JPT 12(3):73–77 (Trans. AIME 219:354–358).
 * - Thomeer, J.H.M. (1983), «Air permeability as a function of three pore-network parameters», JPT 35(4):809–814.
 * - Swanson, B.F. (1981), «A simple correlation between permeabilities and mercury capillary pressures», JPT
 *   33(12):2498–2504.
 * - Brooks, R.H. y Corey, A.T. (1964), «Hydraulic properties of porous media», Colorado State Univ., Hydrology
 *   Paper 3; y (1966) J. Irrig. Drain. Div. ASCE 92(IR2):61–88.
 * - Burdine, N.T. (1953), «Relative permeability calculations from pore size distribution data», Trans. AIME 198:71–78.
 * - Buckley, S.E. y Leverett, M.C. (1942), «Mechanism of fluid displacement in sands», Trans. AIME 146:107–116.
 * - Purcell, W.R. (1949), «Capillary pressures – their measurement using mercury and the calculation of permeability
 *   therefrom», Trans. AIME 186:39–48.
 */
import { fitTrend } from './regression';
import {
  brooksCoreySw,
  HG_AIR_SIGMA,
  HG_AIR_THETA_DEG,
  pcAtWettingSaturation,
  PSI_TO_DYN_PER_CM2,
  wettingSaturationAtPc,
} from './rockTyping';
import { capillaryTransferFactor, type CapillarySystem } from './saturationHeight';

// ── constantes de unidades ──────────────────────────────────────────────────────────────────────────────────────

/** 1 psi en Pa (1 dyn/cm² = 0,1 Pa). */
export const PA_PER_PSI = PSI_TO_DYN_PER_CM2 / 10;
/** Gravedad estándar (m/s²). */
export const GRAVITY_M_PER_S2 = 9.80665;
/** 1 ft en m (exacto). */
export const M_PER_FT = 0.3048;

/** Un tramo de curva debe tener al menos tantos puntos para ajustar tres parámetros con algún grado de libertad. */
const MIN_FIT_POINTS = 5;

function isPos(x: number): boolean {
  return Number.isFinite(x) && x > 0;
}

// ── sistemas fluido–fluido ──────────────────────────────────────────────────────────────────────────────────────

/** Sistema capilar: tensión interfacial σ (dyn/cm) y ángulo de contacto θ (°, medido en la fase mojante). */
export interface InterfacialSystem {
  id: string;
  label: string;
  sigmaDynPerCm: number;
  thetaDeg: number;
}

/**
 * Mercurio–aire (laboratorio, MICP): σ = 480 dyn/cm, θ = 140° (Purcell, 1949); es el par estándar de la app
 * (`HG_AIR_SIGMA`, `HG_AIR_THETA_DEG`). σ|cosθ| = 367,7 dyn/cm.
 */
export const SYSTEM_HG_AIR: InterfacialSystem = {
  id: 'hg-air',
  label: 'Mercurio–aire (laboratorio)',
  sigmaDynPerCm: HG_AIR_SIGMA,
  thetaDeg: HG_AIR_THETA_DEG,
};

/**
 * Petróleo–agua de reservorio: σ = 30 dyn/cm, θ = 30°. Valores típicos de uso corriente (rango habitual de σ:
 * 20–50 dyn/cm; θ 0–30° en rocas mojadas por agua), p. ej. los que usan Core Laboratories y Tiab y Donaldson,
 * «Petrophysics» (cap. de presión capilar). σ|cosθ| = 26,0 dyn/cm. Son un supuesto: la σ real depende de P, T y del crudo.
 */
export const SYSTEM_OIL_WATER: InterfacialSystem = {
  id: 'oil-water',
  label: 'Petróleo–agua (reservorio)',
  sigmaDynPerCm: 30,
  thetaDeg: 30,
};

/**
 * Gas–agua de reservorio: σ = 50 dyn/cm, θ = 0°. Valor típico a presión de reservorio (a baja presión, aire–salmuera
 * de laboratorio: 72 dyn/cm, 0°); misma fuente y mismas salvedades que `SYSTEM_OIL_WATER`. σ|cosθ| = 50 dyn/cm.
 */
export const SYSTEM_GAS_WATER: InterfacialSystem = {
  id: 'gas-water',
  label: 'Gas–agua (reservorio)',
  sigmaDynPerCm: 50,
  thetaDeg: 0,
};

/** Densidad de agua de formación por defecto (g/cm³): salmuera moderada (~70 000 ppm NaCl). Supuesto. */
export const DEFAULT_WATER_DENSITY_GCC = 1.05;
/** Densidad de petróleo por defecto (g/cm³): crudo mediano, ~45 °API. Supuesto. */
export const DEFAULT_OIL_DENSITY_GCC = 0.8;
/** Δρ agua–petróleo por defecto (g/cm³) = 1,05 − 0,80. */
export const DEFAULT_DELTA_RHO_OIL_WATER_GCC = DEFAULT_WATER_DENSITY_GCC - DEFAULT_OIL_DENSITY_GCC;

// ── ajuste de Thomeer ───────────────────────────────────────────────────────────────────────────────────────────

/** Resultado del ajuste de Thomeer de una curva. */
export interface ThomeerFit {
  /** Presión de desplazamiento (misma unidad que la Pc de entrada). */
  pd: number;
  /** Factor geométrico de poro G (adimensional): pequeño = distribución estrecha, curva «cuadrada». */
  g: number;
  /** Bv∞ (% del volumen total): volumen de mercurio a presión infinita. */
  bvInfPct: number;
  /** Raíz del error cuadrático medio de Bv (puntos de la curva con Pc ≤ Pd incluidos, con Bv modelo = 0), % del volumen total. */
  rmsePct: number;
  /** R² sobre Bv. */
  r2: number;
  n: number;
  /** Bv máximo observado (% del volumen total). */
  bvMaxObservedPct: number;
  /** true si Bv∞ quedó en el tope φ·100 (no puede haber más mercurio que volumen poral). */
  bvInfAtPorosityCap: boolean;
  /** Fracción del Bv∞ alcanzada por la curva medida: bvMaxObserved / bvInf. Cerca de 1 = la asíntota está medida. */
  reachedFraction: number;
}

/**
 * Hipérbola de Thomeer (1960): Bv = Bv∞·exp(−G / log10(Pc/Pd)) para Pc > Pd, y Bv = 0 para Pc ≤ Pd.
 * Bv en % del volumen total, Pc y Pd en la misma unidad. NaN si Pd, G o Bv∞ no son positivos o Pc < 0.
 */
export function thomeerBv(pc: number, pd: number, g: number, bvInfPct: number): number {
  if (!isPos(pd) || !isPos(g) || !isPos(bvInfPct) || !(pc >= 0)) return NaN;
  if (pc <= pd) return 0;
  if (pc === Infinity) return bvInfPct;
  return bvInfPct * Math.exp(-g / Math.log10(pc / pd));
}

/** Suma de cuadrados con Bv∞ óptimo (mínimos cuadrados cerrado, acotado) para un (Pd, G) dado. Interno. */
function thomeerObjective(
  pc: Float64Array,
  bv: Float64Array,
  f: Float64Array,
  pd: number,
  g: number,
  bvLo: number,
  bvHi: number,
): { sse: number; bvInf: number } {
  let num = 0;
  let den = 0;
  for (let i = 0; i < pc.length; i++) {
    if (pc[i]! > pd) {
      const fi = Math.exp(-g / Math.log10(pc[i]! / pd));
      f[i] = fi;
      num += bv[i]! * fi;
      den += fi * fi;
    } else f[i] = 0;
  }
  // Para un (Pd, G) fijo el modelo es lineal en Bv∞; la cuadrática en Bv∞ es convexa, así que el óptimo acotado es el recorte.
  const bvInf = den > 0 ? Math.min(bvHi, Math.max(bvLo, num / den)) : bvLo;
  let sse = 0;
  for (let i = 0; i < pc.length; i++) {
    const e = bvInf * f[i]! - bv[i]!;
    sse += e * e;
  }
  return { sse, bvInf };
}

/** Nelder–Mead de dos variables (determinista). Devuelve el mejor punto. Interno. */
function nelderMead2(
  fn: (x: number, y: number) => number,
  x0: number,
  y0: number,
  step: number,
  maxIter = 600,
): { x: number; y: number; v: number } {
  type P = { x: number; y: number; v: number };
  const mk = (x: number, y: number): P => ({ x, y, v: fn(x, y) });
  let s: P[] = [mk(x0, y0), mk(x0 + step, y0), mk(x0, y0 + step)];
  for (let it = 0; it < maxIter; it++) {
    s.sort((a, b) => a.v - b.v);
    const [b, m, w] = s as [P, P, P];
    if (Math.abs(w.v - b.v) <= 1e-14 * (Math.abs(b.v) + 1e-30) && Math.hypot(w.x - b.x, w.y - b.y) < 1e-10) break;
    const cx = (b.x + m.x) / 2;
    const cy = (b.y + m.y) / 2;
    const r = mk(cx + (cx - w.x), cy + (cy - w.y));
    if (r.v < b.v) {
      const e = mk(cx + 2 * (cx - w.x), cy + 2 * (cy - w.y));
      s = [b, m, e.v < r.v ? e : r];
    } else if (r.v < m.v) s = [b, m, r];
    else {
      const c = r.v < w.v ? mk(cx + 0.5 * (cx - w.x), cy + 0.5 * (cy - w.y)) : mk(cx - 0.5 * (cx - w.x), cy - 0.5 * (cy - w.y));
      if (c.v < Math.min(w.v, r.v)) s = [b, m, c];
      else s = [b, mk(b.x + 0.5 * (m.x - b.x), b.y + 0.5 * (m.y - b.y)), mk(b.x + 0.5 * (w.x - b.x), b.y + 0.5 * (w.y - b.y))];
    }
  }
  s.sort((a, b) => a.v - b.v);
  return s[0]!;
}

/**
 * Ajuste de Thomeer (1960) de una curva de inyección de mercurio:
 *   Bv = Bv∞·exp(−G / log10(Pc/Pd))   (Pc > Pd),   Bv = SHg·φ·100  (% del volumen total)
 * Devuelve Pd (unidad de `pc`), G, Bv∞ y la bondad del ajuste.
 *
 * MÉTODO. Mínimos cuadrados sobre Bv de TODOS los puntos de la curva (los de Pc ≤ Pd aportan el residuo Bv − 0, que fija
 * Pd). Para (Pd, G) fijos el modelo es lineal en Bv∞, que sale en forma cerrada (Σ Bv·f / Σ f², f = exp(−G/log10(Pc/Pd)))
 * y se recorta al intervalo [Bv máx. observado, φ·100]: la asíntota no puede quedar por debajo de lo medido ni por encima
 * del volumen poral. Queda un problema de dos variables (log Pd, log G): barrido de una grilla de 160 × 120 puntos
 * (Pd entre la primera y la última Pc; G entre 0,005 y 20) y refinamiento con Nelder–Mead desde el mejor nodo. Se
 * eligió esto en vez de linealizar (ln Bv contra 1/log10(Pc/Pd)) porque ese ajuste pesa de más los puntos de Bv casi cero
 * del comienzo de la curva, y en vez de un Gauss–Newton con arranque único porque la función de Pd tiene varios mínimos
 * locales (hay curvas con dos familias de gargantas). Es determinista y barato (≈ 10⁶ evaluaciones simples).
 *
 * @param pc     presión de inyección, estrictamente creciente (psi: Pd sale en psi, la unidad que pide `thomeerPermeability`)
 * @param swFrac saturación de la fase mojante (v/v), no creciente; SHg = 1 − Sw
 * @param phiFrac porosidad (v/v) de la muestra, en (0; 0,5]
 * @returns el ajuste, o null si hay menos de 5 puntos válidos, la curva no inyecta mercurio o los datos están fuera de rango
 */
export function fitThomeer(pc: ArrayLike<number>, swFrac: ArrayLike<number>, phiFrac: number): ThomeerFit | null {
  if (!(phiFrac > 0 && phiFrac <= 0.5)) return null;
  const px: number[] = [];
  const bvx: number[] = [];
  const n0 = Math.min(pc.length, swFrac.length);
  for (let i = 0; i < n0; i++) {
    const p = pc[i]!;
    const sw = swFrac[i]!;
    if (!isPos(p) || !Number.isFinite(sw)) continue;
    if (sw < 0 || sw > 1 + 1e-9) return null; // casi seguro Sw en %: mejor no inventar
    if (px.length > 0 && !(p > px[px.length - 1]!)) return null;
    px.push(p);
    bvx.push(Math.max(0, 1 - sw) * phiFrac * 100);
  }
  const n = px.length;
  if (n < MIN_FIT_POINTS) return null;
  const pcA = Float64Array.from(px);
  const bv = Float64Array.from(bvx);
  let bvMax = 0;
  for (const v of bv) if (v > bvMax) bvMax = v;
  if (!(bvMax > 0)) return null;
  const bvHi = Math.max(bvMax, phiFrac * 100);
  const f = new Float64Array(n);

  const lnPdLo = Math.log(pcA[0]!);
  const lnPdHi = Math.log(pcA[n - 1]! * 0.999);
  const lnGLo = Math.log(0.005);
  const lnGHi = Math.log(20);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const obj = (lp: number, lg: number) =>
    thomeerObjective(pcA, bv, f, Math.exp(clamp(lp, lnPdLo, lnPdHi)), Math.exp(clamp(lg, lnGLo, lnGHi)), bvMax, bvHi).sse +
    // Penalización suave fuera de los límites para que Nelder–Mead no se escape y la función siga siendo continua.
    1e3 * ((lp - clamp(lp, lnPdLo, lnPdHi)) ** 2 + (lg - clamp(lg, lnGLo, lnGHi)) ** 2);

  const NP = 160;
  const NG = 120;
  const dP = (lnPdHi - lnPdLo) / (NP - 1);
  const dG = (lnGHi - lnGLo) / (NG - 1);
  let best = { v: Infinity, lp: lnPdLo, lg: lnGLo };
  for (let i = 0; i < NP; i++) {
    for (let j = 0; j < NG; j++) {
      const lp = lnPdLo + i * dP;
      const lg = lnGLo + j * dG;
      const v = obj(lp, lg);
      if (v < best.v) best = { v, lp, lg };
    }
  }
  let nm = nelderMead2(obj, best.lp, best.lg, 0.5 * Math.min(dP, dG));
  nm = nelderMead2(obj, nm.x, nm.y, 0.1 * Math.min(dP, dG)); // reinicio para salir de simplex degenerados
  const pd = Math.exp(clamp(nm.x, lnPdLo, lnPdHi));
  const g = Math.exp(clamp(nm.y, lnGLo, lnGHi));
  const { sse, bvInf } = thomeerObjective(pcA, bv, f, pd, g, bvMax, bvHi);
  let mean = 0;
  for (const v of bv) mean += v;
  mean /= n;
  let sst = 0;
  for (const v of bv) sst += (v - mean) ** 2;
  return {
    pd,
    g,
    bvInfPct: bvInf,
    rmsePct: Math.sqrt(sse / n),
    r2: sst > 0 ? 1 - sse / sst : NaN,
    n,
    bvMaxObservedPct: bvMax,
    bvInfAtPorosityCap: bvInf >= phiFrac * 100 * (1 - 1e-9),
    reachedFraction: bvMax / bvInf,
  };
}

// ── permeabilidad desde la curva ────────────────────────────────────────────────────────────────────────────────

/**
 * Coeficientes de Swanson (1981) para permeabilidad AL AIRE: k = a·(Sb/Pc)_A^b, k en mD, Sb en % del volumen total, Pc en
 * psi. a = 399, b = 1,691. Verificación: no pude abrir el artículo original (JPT dic. 1981); las constantes coinciden con
 * las que reproduce una presentación de flujo de trabajo MICP (LR Senergy) y, sobre las 8 muestras del TP, la k estimada
 * reproduce la k de gas de la hoja SCAL dentro del 1–4 % en 7 de 8 (la k de la tabla del laboratorio parece derivada de
 * Swanson). Otra correlación general de Swanson (355·(Sb/Pc)^2,005, citada en una patente) NO es la de aire.
 */
export const SWANSON_AIR = { a: 399, b: 1.691 } as const;

/** Ápice de la hipérbola de Swanson. */
export interface SwansonApex {
  /** (Sb/Pc) máximo (% del volumen total por psi). */
  sbOverPc: number;
  /** Pc del ápice (psi). */
  pcPsi: number;
  /** Sb del ápice (% del volumen total). */
  sbPct: number;
  /** Índice del punto en la curva. */
  index: number;
}

/**
 * Ápice de la hipérbola Sb/Pc de Swanson (1981): el punto de la curva de inyección donde Sb/Pc es máximo, con
 * Sb = SHg·φ·100 (% del volumen total) y Pc en psi. Se toma entre los puntos medidos (como en el artículo, no entre
 * valores interpolados). Representa la presión a la que el mercurio llena la red de poros que controla el flujo.
 * @param pcPsi presión de inyección (psi)
 * @param swFrac saturación mojante (v/v)
 * @param phiFrac porosidad (v/v)
 * @returns el ápice o null si la curva no inyecta mercurio o los datos son inválidos
 */
export function swansonApex(pcPsi: ArrayLike<number>, swFrac: ArrayLike<number>, phiFrac: number): SwansonApex | null {
  if (!(phiFrac > 0 && phiFrac <= 0.5)) return null;
  let best: SwansonApex | null = null;
  const n = Math.min(pcPsi.length, swFrac.length);
  for (let i = 0; i < n; i++) {
    const p = pcPsi[i]!;
    const sw = swFrac[i]!;
    if (!isPos(p) || !Number.isFinite(sw) || sw < 0 || sw > 1 + 1e-9) continue;
    const sb = Math.max(0, 1 - sw) * phiFrac * 100;
    const ratio = sb / p;
    if (ratio > 0 && (!best || ratio > best.sbOverPc)) best = { sbOverPc: ratio, pcPsi: p, sbPct: sb, index: i };
  }
  return best;
}

/**
 * Permeabilidad al aire de Swanson (1981): k = a·(Sb/Pc)_A^b, con k en mD, (Sb/Pc)_A el máximo de Sb/Pc
 * (Sb en % del volumen total, Pc en psi). Por defecto a = 399 y b = 1,691 (`SWANSON_AIR`). NaN si el argumento no es > 0.
 */
export function swansonPermeability(sbOverPc: number, a: number = SWANSON_AIR.a, b: number = SWANSON_AIR.b): number {
  if (!isPos(sbOverPc) || !isPos(a) || !Number.isFinite(b)) return NaN;
  return a * Math.pow(sbOverPc, b);
}

/** Atajo: k de Swanson (mD) directamente de la curva (Pc en psi, Sw y φ en v/v). NaN si no hay ápice. */
export function swansonPermeabilityFromCurve(pcPsi: ArrayLike<number>, swFrac: ArrayLike<number>, phiFrac: number): number {
  const apex = swansonApex(pcPsi, swFrac, phiFrac);
  return apex ? swansonPermeability(apex.sbOverPc) : NaN;
}

/**
 * Permeabilidad al aire de Thomeer (1983) desde los tres parámetros de la hipérbola:
 *   k = 3,8068·G^(−1,3334)·(Bv∞/Pd)²      (k en mD, Pd en psi, Bv∞ en % del volumen total, G adimensional)
 * Verificación: no pude abrir el artículo (JPT abr. 1983); la forma 3,8068·G^−1,334·(Bv∞/Pd)² figura citada en la patente
 * US 4 648 261. Aquí se usa el exponente −1,3334 (= −4/3, como en la bibliografía de petrofísica); la diferencia con −1,334
 * es < 0,03 % para G ∈ [0,1; 1]. La correlación tiene dispersión de un factor ~2 (en el TP da 0,5–0,9 veces la k de gas).
 * NaN si algún argumento no es > 0.
 */
export function thomeerPermeability(g: number, pdPsi: number, bvInfPct: number): number {
  if (!isPos(g) || !isPos(pdPsi) || !isPos(bvInfPct)) return NaN;
  return 3.8068 * Math.pow(g, -1.3334) * (bvInfPct / pdPsi) ** 2;
}

// ── Brooks–Corey por curva ──────────────────────────────────────────────────────────────────────────────────────

/** Opciones del ajuste de Brooks–Corey. */
export interface BrooksCoreyFitOptions {
  /** La rama de invasión empieza donde Sw ≤ este valor (v/v): excluye el tramo previo a la entrada. Por defecto 0,99. */
  entrySw?: number;
  /** Se usan solo puntos con Pc ≤ pcMax (misma unidad que `pc`). Por defecto, sin tope. */
  pcMax?: number;
  /** Se usan solo puntos con Sw ≥ swFitMin (v/v): descarta la cola de microporos. Por defecto 0. */
  swFitMin?: number;
}

/** Ajuste de Brooks–Corey de una curva. */
export interface BrooksCoreyFit {
  /** Presión de desplazamiento (unidad de `pc`): Pc de la recta ajustada en Sw = 1 (extrapolada, no la medida). */
  pd: number;
  /** Índice de distribución de tamaño de poros λ. */
  lambda: number;
  /** Saturación irreducible (v/v). */
  swirr: number;
  /** R² del ajuste lineal de ln Pc contra ln Sw* (en el Swirr elegido). */
  r2: number;
  /** Puntos de la rama usados. */
  n: number;
  /** 'lower' o 'upper' si Swirr quedó en un extremo del intervalo explorado (no identificable con esa curva); null si es interior. */
  swirrAtBound: 'lower' | 'upper' | null;
}

/**
 * Ajuste de Brooks y Corey (1964) a una curva medida, en la rama de invasión (Pc > Pd):
 *   Pc = Pd·Sw*^(−1/λ),   Sw* = (Sw − Swirr)/(1 − Swirr)   ⇒   ln Pc = ln Pd − (1/λ)·ln Sw*
 * Para un Swirr dado es una recta en ln–ln: se ajusta con `fitTrend(Sw*, Pc, 'power')` (a = Pd, b = −1/λ). Swirr se elige
 * en [0, 0,999·Sw mínimo de la rama] por el R² máximo de esa recta (equivale a mínimos cuadrados de ln Pc porque la
 * variable dependiente no cambia con Swirr): barrido de 200 valores y refinamiento por sección áurea. Pd sale de la
 * ordenada, no de la entrada medida. Pd, λ y Swirr se devuelven juntos porque dependen entre sí.
 *
 * ADVERTENCIA. Una curva MICP real no es una Brooks–Corey ideal: suele tener entrada abrupta y cola larga. Cuando la cola
 * (Sw < 0,2) está en la rama, el R² máximo se logra con Swirr = 0 (`swirrAtBound = 'lower'`): el Swirr de este ajuste no es una
 * medida de agua irreducible. Para ajustar la zona relevante use `pcMax` o `swFitMin`.
 *
 * @param pc presión de inyección creciente (cualquier unidad; Pd sale en la misma)
 * @param swFrac saturación mojante (v/v), no creciente
 * @returns el ajuste, o null si quedan menos de 4 puntos en la rama o la pendiente no es negativa
 */
export function fitBrooksCorey(pc: ArrayLike<number>, swFrac: ArrayLike<number>, opts: BrooksCoreyFitOptions = {}): BrooksCoreyFit | null {
  const entrySw = opts.entrySw ?? 0.99;
  const pcMax = opts.pcMax ?? Infinity;
  const swFitMin = opts.swFitMin ?? 0;
  const px: number[] = [];
  const sx: number[] = [];
  const n0 = Math.min(pc.length, swFrac.length);
  for (let i = 0; i < n0; i++) {
    const p = pc[i]!;
    const sw = swFrac[i]!;
    if (!isPos(p) || !Number.isFinite(sw) || sw > 1 + 1e-9 || sw < 0) continue;
    if (sw <= entrySw && sw > 0 && sw >= swFitMin && p <= pcMax) {
      px.push(p);
      sx.push(sw);
    }
  }
  if (px.length < 4) return null;
  let swMin = Infinity;
  for (const s of sx) if (s < swMin) swMin = s;
  const swirrHi = swMin * 0.999;

  const trial = (swirr: number) => {
    const se = sx.map((s) => (s - swirr) / (1 - swirr));
    const fit = fitTrend(se, px, 'power');
    return fit && fit.b < 0 && fit.n === px.length ? fit : null;
  };
  const score = (swirr: number) => trial(swirr)?.r2 ?? -Infinity;

  const N = 200;
  let bestI = 0;
  let bestS = -Infinity;
  for (let i = 0; i <= N; i++) {
    const s = score((swirrHi * i) / N);
    if (s > bestS) {
      bestS = s;
      bestI = i;
    }
  }
  if (!Number.isFinite(bestS)) return null;
  let swirr = (swirrHi * bestI) / N;
  const atLower = bestI === 0;
  const atUpper = bestI === N;
  if (!atLower && !atUpper) {
    let lo = (swirrHi * (bestI - 1)) / N;
    let hi = (swirrHi * (bestI + 1)) / N;
    const phi = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - phi * (hi - lo);
    let x2 = lo + phi * (hi - lo);
    let f1 = score(x1);
    let f2 = score(x2);
    for (let k = 0; k < 80; k++) {
      if (f1 > f2) {
        hi = x2;
        x2 = x1;
        f2 = f1;
        x1 = hi - phi * (hi - lo);
        f1 = score(x1);
      } else {
        lo = x1;
        x1 = x2;
        f1 = f2;
        x2 = lo + phi * (hi - lo);
        f2 = score(x2);
      }
    }
    swirr = (lo + hi) / 2;
  }
  const fit = trial(swirr);
  if (!fit) return null;
  return {
    pd: fit.a,
    lambda: -1 / fit.b,
    swirr,
    r2: fit.r2,
    n: fit.n,
    swirrAtBound: atLower ? 'lower' : atUpper ? 'upper' : null,
  };
}

// ── laboratorio → reservorio, altura sobre el agua libre ────────────────────────────────────────────────────────

function toCapillarySystem(s: InterfacialSystem): CapillarySystem {
  // dyn/cm = mN/m. Incertidumbre angular nominal de 1° (solo para reutilizar la validación de capillaryTransferFactor).
  return { tensionNPerM: s.sigmaDynPerCm / 1000, angleDeg: s.thetaDeg, angleUncertaintyDeg: 1 };
}

/**
 * Factor de paso de presión capilar de laboratorio a reservorio:
 *   Pc_res = Pc_lab · (σ·cosθ)_res / (σ·cosθ)_lab
 * (Leverett, 1941; misma roca, misma geometría poral). Reutiliza `capillaryTransferFactor` (valida σ y exige que θ no
 * se acerque a 90°). NaN si algún sistema es inválido. Con mercurio–aire → petróleo–agua: 26,0/367,7 = 0,0707.
 */
export function labToReservoirFactor(lab: InterfacialSystem, reservoir: InterfacialSystem): number {
  const r = capillaryTransferFactor(toCapillarySystem(lab), toCapillarySystem(reservoir), 1);
  return r.ok ? r.factor : NaN;
}

/** Pc de reservorio (psi) desde la de laboratorio (psi). NaN si Pc < 0 o el factor es inválido. */
export function labPcToReservoirPc(pcLabPsi: number, lab: InterfacialSystem, reservoir: InterfacialSystem): number {
  if (!(pcLabPsi >= 0)) return NaN;
  return pcLabPsi * labToReservoirFactor(lab, reservoir);
}

/**
 * Altura sobre el agua libre (m) de una presión capilar de reservorio: h = Pc_res/(Δρ·g), con Pc_res en psi (→ Pa),
 * Δρ = ρ_agua − ρ_hidrocarburo en g/cm³ (→ kg/m³) y g = 9,80665 m/s². En campo: h[ft] = Pc[psi]/(0,4335·Δρ[g/cm³]).
 * NaN si Pc < 0 o Δρ ≤ 0.
 */
export function heightFromReservoirPc(pcResPsi: number, deltaRhoGcc: number): number {
  if (!(pcResPsi >= 0) || !isPos(deltaRhoGcc)) return NaN;
  return (pcResPsi * PA_PER_PSI) / (deltaRhoGcc * 1000 * GRAVITY_M_PER_S2);
}

/** Inversa: Pc de reservorio (psi) a una altura h (m) sobre el FWL. NaN si h < 0 o Δρ ≤ 0. */
export function reservoirPcFromHeight(heightM: number, deltaRhoGcc: number): number {
  if (!(heightM >= 0) || !isPos(deltaRhoGcc)) return NaN;
  return (deltaRhoGcc * 1000 * GRAVITY_M_PER_S2 * heightM) / PA_PER_PSI;
}

/** Contexto de conversión: sistema de laboratorio, sistema de reservorio y contraste de densidades. */
export interface HeightContext {
  lab: InterfacialSystem;
  reservoir: InterfacialSystem;
  /** Δρ agua–hidrocarburo (g/cm³), > 0. */
  deltaRhoGcc: number;
}

/** Altura (m) sobre el FWL equivalente a una Pc de laboratorio (psi). */
export function heightFromLabPc(pcLabPsi: number, ctx: HeightContext): number {
  return heightFromReservoirPc(labPcToReservoirPc(pcLabPsi, ctx.lab, ctx.reservoir), ctx.deltaRhoGcc);
}

/** Pc de laboratorio (psi) que corresponde a una altura (m) sobre el FWL. */
export function labPcFromHeight(heightM: number, ctx: HeightContext): number {
  const factor = labToReservoirFactor(ctx.lab, ctx.reservoir);
  return reservoirPcFromHeight(heightM, ctx.deltaRhoGcc) / factor;
}

/**
 * Altura de entrada (m): columna mínima de hidrocarburo para que entre en la roca, h_d = Pd_res/(Δρ·g), con
 * Pd_res = Pd_lab·(σcosθ)_res/(σcosθ)_lab. Por debajo de h_d la roca sigue con Sw = 1.
 * @param pdLabPsi presión de desplazamiento de laboratorio (psi), de `fitThomeer` o `fitBrooksCorey`
 */
export function entryHeightM(pdLabPsi: number, ctx: HeightContext): number {
  if (!isPos(pdLabPsi)) return NaN;
  return heightFromLabPc(pdLabPsi, ctx);
}

/**
 * Sw a una altura h (m) sobre el FWL para una curva MEDIDA (tabular): Pc_lab = Pc_res/factor y Sw por interpolación de
 * `wettingSaturationAtPc` (lineal en Sw, logarítmica en Pc), SIN extrapolar. h = 0 → Sw = 1. Si Pc_lab queda por debajo de
 * la primera presión medida y la curva arranca en Sw = 1, vale 1 (es una meseta medida); por encima de la última, NaN.
 * @param pcLabPsi presión de la curva (psi), creciente
 * @param swFrac saturación mojante (v/v)
 */
export function swAtHeightFromCurve(
  pcLabPsi: ArrayLike<number>,
  swFrac: ArrayLike<number>,
  heightM: number,
  ctx: HeightContext,
): number {
  if (!(heightM >= 0)) return NaN;
  if (heightM === 0) return swFrac.length > 0 && swFrac[0]! >= 1 ? 1 : NaN;
  const pc = labPcFromHeight(heightM, ctx);
  if (!isPos(pc) || pcLabPsi.length < 2) return NaN;
  if (pc < pcLabPsi[0]!) return swFrac[0]! >= 1 ? 1 : NaN;
  return wettingSaturationAtPc(pcLabPsi, swFrac, pc);
}

/**
 * Sw a una altura h (m) sobre el FWL con Brooks–Corey: Sw = Swirr + (1 − Swirr)·(Pd_res/Pc_res)^λ, Pc_res = Δρ·g·h
 * (Sw = 1 si h ≤ h_d). Reutiliza `brooksCoreySw`. `pdLabPsi` es la Pd de laboratorio (psi) del ajuste.
 */
export function swAtHeightBrooksCorey(
  pdLabPsi: number,
  lambda: number,
  swirr: number,
  heightM: number,
  ctx: HeightContext,
): number {
  if (!(heightM >= 0)) return NaN;
  const factor = labToReservoirFactor(ctx.lab, ctx.reservoir);
  const pcRes = reservoirPcFromHeight(heightM, ctx.deltaRhoGcc);
  return brooksCoreySw(pcRes, pdLabPsi * factor, lambda, swirr);
}

/**
 * Densidad (g/cm³) de un fluido desde su gradiente de presión (psi/ft): ρ = (dP/dz)/g con dP/dz en Pa/m:
 * ρ[g/cm³] = gradiente[psi/ft]·6894,757/(0,3048·9,80665·1000) = gradiente / 0,43353. NaN si el gradiente no es > 0.
 */
export function densityFromGradientPsiPerFt(gradientPsiPerFt: number): number {
  if (!isPos(gradientPsiPerFt)) return NaN;
  return (gradientPsiPerFt * PA_PER_PSI) / M_PER_FT / GRAVITY_M_PER_S2 / 1000;
}

/** Inversa de `densityFromGradientPsiPerFt`: gradiente (psi/ft) de una densidad (g/cm³). 1 g/cm³ → 0,43353 psi/ft. */
export function gradientPsiPerFtFromDensity(densityGcc: number): number {
  if (!isPos(densityGcc)) return NaN;
  return (densityGcc * 1000 * GRAVITY_M_PER_S2 * M_PER_FT) / PA_PER_PSI;
}

// ── permeabilidades relativas y flujo fraccional ────────────────────────────────────────────────────────────────

/** Saturación efectiva Se = (Sw − Swirr)/(1 − Swirr), acotada a [0, 1]. NaN si Sw ∉ [0, 1] o Swirr ∉ [0, 1). */
function effectiveSaturation(sw: number, swirr: number): number {
  if (!(sw >= 0 && sw <= 1) || !(swirr >= 0 && swirr < 1)) return NaN;
  return Math.max(0, (sw - swirr) / (1 - swirr));
}

/**
 * Permeabilidad relativa del agua (mojante) de Brooks–Corey–Burdine: krw = Se^((2 + 3λ)/λ) = Se^(3 + 2/λ)
 * (Brooks y Corey, 1966, con el modelo de Burdine, 1953; Corey, 1994). Se = (Sw − Swirr)/(1 − Swirr) (0 si Sw < Swirr).
 * NaN si λ ≤ 0 o Sw ∉ [0, 1].
 */
export function krwBrooksCorey(sw: number, lambda: number, swirr: number): number {
  const se = effectiveSaturation(sw, swirr);
  if (!isPos(lambda) || Number.isNaN(se)) return NaN;
  return Math.pow(se, (2 + 3 * lambda) / lambda);
}

/**
 * Permeabilidad relativa de la fase no mojante (petróleo o gas) de Brooks–Corey–Burdine:
 *   krnw = (1 − Se)²·(1 − Se^((2 + λ)/λ))        (Se^(1 + 2/λ))
 * con el extremo krnw(Swirr) = 1 (sin saturación residual no mojante ni escala de extremos). NaN si λ ≤ 0 o Sw ∉ [0, 1].
 */
export function krnwBrooksCorey(sw: number, lambda: number, swirr: number): number {
  const se = effectiveSaturation(sw, swirr);
  if (!isPos(lambda) || Number.isNaN(se)) return NaN;
  return (1 - se) ** 2 * (1 - Math.pow(se, (2 + lambda) / lambda));
}

/**
 * Flujo fraccional de agua (Buckley y Leverett, 1942; flujo lineal horizontal, sin capilaridad ni gravedad):
 *   fw = 1 / (1 + (krnw/μnw)/(krw/μw))
 * con krw y krnw de Brooks–Corey–Burdine. Sube de 0 (Sw ≤ Swirr) a 1 (Sw = 1). μ en cP (solo importa su cociente).
 * NaN si λ ≤ 0, μ ≤ 0 o Sw ∉ [0, 1].
 */
export function fractionalFlowWater(sw: number, lambda: number, swirr: number, muWaterCp: number, muNonWettingCp: number): number {
  const krw = krwBrooksCorey(sw, lambda, swirr);
  const krnw = krnwBrooksCorey(sw, lambda, swirr);
  if (!isPos(muWaterCp) || !isPos(muNonWettingCp) || Number.isNaN(krw) || Number.isNaN(krnw)) return NaN;
  const mw = krw / muWaterCp;
  const mn = krnw / muNonWettingCp;
  return mw + mn > 0 ? mw / (mw + mn) : NaN;
}

/** Viscosidad del agua por defecto (cP) para el cutoff de fw: supuesto de reservorio profundo y caliente. */
export const DEFAULT_WATER_VISCOSITY_CP = 0.5;
/** Viscosidad del petróleo por defecto (cP): crudo mediano vivo. Supuesto. */
export const DEFAULT_OIL_VISCOSITY_CP = 1;

/**
 * CUTOFF DE Sw BASADO EN DATOS: la Sw a la que el flujo fraccional de agua alcanza un umbral (por defecto 0,5), con la
 * permeabilidad relativa de la propia curva capilar de la muestra (λ y Swirr de Brooks–Corey). fw crece de forma
 * monótona con Sw, así que la raíz es única (bisección). Es defendible porque el corte sale del comportamiento de flujo de
 * la roca (la saturación a la que agua e hidrocarburo se mueven en partes iguales a las viscosidades dadas) y no de un valor
 * fijo de libro, y porque su variación entre muestras es una medida de la incertidumbre del cutoff; depende de μw/μo,
 * de λ y de Swirr, todos declarados. Por encima del cutoff la roca produce agua con corte > umbral.
 * @param fwTarget umbral de fw en (0, 1); por defecto 0,5
 * @returns Sw (v/v) en (Swirr, 1), o NaN si fwTarget ∉ (0, 1) o los parámetros son inválidos
 */
export function swAtFractionalFlow(
  lambda: number,
  swirr: number,
  muWaterCp: number = DEFAULT_WATER_VISCOSITY_CP,
  muNonWettingCp: number = DEFAULT_OIL_VISCOSITY_CP,
  fwTarget = 0.5,
): number {
  if (!isPos(lambda) || !(swirr >= 0 && swirr < 1) || !isPos(muWaterCp) || !isPos(muNonWettingCp) || !(fwTarget > 0 && fwTarget < 1)) {
    return NaN;
  }
  let lo = swirr;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fw = fractionalFlowWater(mid, lambda, swirr, muWaterCp, muNonWettingCp);
    if (!(fw === fw)) return NaN;
    if (fw < fwTarget) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15) break;
  }
  return (lo + hi) / 2;
}

/** Resumen de un conjunto de cutoffs por muestra. */
export interface CutoffSummary {
  n: number;
  median: number;
  min: number;
  max: number;
}

/** Mediana y rango de los valores finitos. null si no hay ninguno. */
export function summarizeCutoffs(values: ArrayLike<number>): CutoffSummary | null {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) v.push(values[i]!);
  if (v.length === 0) return null;
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return { n: v.length, median: v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2, min: v[0]!, max: v[v.length - 1]! };
}

// ── CMR: BVI/PHIE contra la curva capilar ───────────────────────────────────────────────────────────────────────

/** Muestra de corona con su curva MICP (Pc en psi, Sw en v/v) y su profundidad. */
export interface CmrSample {
  depthM: number;
  pcPsi: ArrayLike<number>;
  swFrac: ArrayLike<number>;
}

export interface CmrBviResult {
  /** BVI/PHIE de la ventana (v/v): saturación de agua ligada que declara el CMR. */
  bviOverPhie: number;
  /** Muestras del perfil en la ventana con BVI y PHIE finitos y PHIE > 0. */
  nWindow: number;
  /** Pc de laboratorio (psi) a la que la curva MICP tiene Sw = BVI/PHIE (sin extrapolar; NaN si no la alcanza). */
  pcLabPsi: number;
  /** Altura equivalente sobre el FWL (m) con el contexto dado. */
  heightM: number;
}

/**
 * BVI/PHIE del CMR a la profundidad de cada muestra y su altura capilar equivalente.
 *
 * BVI/PHIE = ΣBVI/ΣPHIE en la ventana [d − w, d + w] (cociente de sumas = cociente de medias: no se disparan los
 * puntos con PHIE ≈ 0, y es el mismo número que el promedio de cocientes cuando PHIE casi no varía en la ventana). Ese
 * cociente es la saturación de agua ligada que declara el CMR con su corte de T2. Se busca la Pc de laboratorio a la
 * que la curva MICP de la muestra tiene esa Sw (`pcAtWettingSaturation`) y se la lleva a altura sobre el FWL con
 * `heightFromLabPc`.
 *
 * LECTURA. `heightM` es la columna a la que el equilibrio capilar daría Sw = BVI/PHIE. Hay que compararla con la
 * columna REAL de la muestra sobre el FWL: si `heightM` es mucho menor, a la altura real la roca ya está a una Sw mucho
 * más baja que BVI/PHIE y el corte de T2 sobreestima el agua ligada (parte de lo que el CMR llama «ligado» es en realidad
 * móvil por capilaridad). Una altura equivalente mayor que la columna real indicaría lo contrario (agua que el CMR no ve
 * como ligada). Cuanto más abierta es la curva (λ bajo, Pd bajo), menor es la altura equivalente.
 *
 * @param depth profundidad del perfil (m); no hace falta que esté ordenada
 * @param bvi PHI_BVI (v/v), misma longitud
 * @param phie PHIE_CMR (v/v), misma longitud
 * @param windowM semiancho de la ventana (m), por defecto 0,5
 */
export function cmrBviEquivalentHeights(
  depth: ArrayLike<number>,
  bvi: ArrayLike<number>,
  phie: ArrayLike<number>,
  samples: readonly CmrSample[],
  ctx: HeightContext,
  windowM = 0.5,
): CmrBviResult[] {
  const n = Math.min(depth.length, bvi.length, phie.length);
  return samples.map((s) => {
    let sb = 0;
    let sp = 0;
    let count = 0;
    if (Number.isFinite(s.depthM) && windowM >= 0) {
      for (let i = 0; i < n; i++) {
        const d = depth[i]!;
        const b = bvi[i]!;
        const p = phie[i]!;
        if (!Number.isFinite(d) || Math.abs(d - s.depthM) > windowM || !Number.isFinite(b) || !(p > 0) || !Number.isFinite(p)) continue;
        sb += b;
        sp += p;
        count++;
      }
    }
    const ratio = count > 0 && sp > 0 ? sb / sp : NaN;
    const pcLabPsi = Number.isFinite(ratio) ? pcAtWettingSaturation(s.pcPsi, s.swFrac, ratio) : NaN;
    return { bviOverPhie: ratio, nWindow: count, pcLabPsi, heightM: heightFromLabPc(pcLabPsi, ctx) };
  });
}
