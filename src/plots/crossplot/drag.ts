/**
 * Elementos arrastrables del crossplot (fase 7b; docs/decisiones/0015). Puro y testeado: punto de matriz del
 * densidad–neutrón y recta de agua del Pickett ↔ parámetros del proyecto, en datos. El paso de píxeles a datos lo hace
 * `movePointPx` (`src/plots/xy/axes.ts`) con el mismo mapeo que dibuja el gráfico.
 */
import { arpsResistivityC } from '../../petro/temperature';
import { medianAt } from './crossplot';
import { DN_LITHOLOGIES, type ArchieParams, type Lithology } from './templates';

// ── punto de matriz (densidad–neutrón) ──────────────────────────────────────────────────────────────────────────

/** Punto de matriz en el gráfico: x = NPHI leído en la matriz (v/v), y = RHOB de la matriz (g/cm³). */
export interface MatrixPoint {
  nphi: number;
  rhob: number;
}

/**
 * Punto de matriz de los parámetros. El módulo `phi-neutron` corrige φN = NPHI + offset (src/petro/porosity.ts,
 * `neutronPorosity`), así que la matriz (φN corregido = 0) queda en NPHI = −offset. La densidad es ρma de
 * `phi-density`.
 */
export function matrixPointOf(rhoMa: number, matrixOffset: number): MatrixPoint {
  return { nphi: 0 - matrixOffset, rhob: rhoMa };
}

/** Parámetros de un punto de matriz (sin acotar ni redondear: lo hace `normalizeParam`). */
export function matrixParamsOf(p: MatrixPoint): { rhoMa: number; matrixOffset: number } {
  return { rhoMa: p.rhob, matrixOffset: 0 - p.nphi };
}

/**
 * Imán hacia los puntos de matriz de las litologías de referencia (arenisca, caliza, dolomía): si el punto cae a menos
 * de `tol` del ancho del eje en x Y del alto en y, toma los valores exactos de la litología. `span` = (máx − mín) de
 * cada eje.
 */
export function snapMatrixToLithology(p: MatrixPoint, span: { x: number; y: number }, tol = 0.015, liths: readonly Lithology[] = DN_LITHOLOGIES): { point: MatrixPoint; lith: Lithology | null } {
  let best: Lithology | null = null;
  let bestD = Infinity;
  for (const l of liths) {
    const dx = Math.abs(p.nphi - l.phiNMa) / Math.abs(span.x);
    const dy = Math.abs(p.rhob - l.rhoMa) / Math.abs(span.y);
    if (dx <= tol && dy <= tol && Math.hypot(dx, dy) < bestD) {
      bestD = Math.hypot(dx, dy);
      best = l;
    }
  }
  return best ? { point: { nphi: best.phiNMa, rhob: best.rhoMa }, lith: best } : { point: p, lith: null };
}

/**
 * Línea de la matriz DEL PROYECTO: los puntos donde la porosidad por densidad y la neutrónica corregida del motor
 * coinciden (φD = φN = φ). Con φD = (ρma − ρb)/(ρma − ρf) y φN = NPHI + offset:
 *   ρb = ρma − φ·(ρma − ρf),   NPHI = φ − offset.
 * Sale del punto de matriz (φ = 0) y se mueve con él; las marcas cada 0,1 leen la porosidad del motor. Puntos cada
 * `step` hasta `phiMax`.
 */
export function projectMatrixLine(rhoMa: number, matrixOffset: number, rhoFl: number, phiMax = 0.45, step = 0.05): { phi: number[]; nphi: number[]; rhob: number[] } {
  const phi: number[] = [];
  const nphi: number[] = [];
  const rhob: number[] = [];
  for (let k = 0; k * step <= phiMax + 1e-9; k++) {
    const f = +(k * step).toFixed(6);
    phi.push(f);
    rhob.push(rhoMa - f * (rhoMa - rhoFl));
    nphi.push(f - matrixOffset);
  }
  return { phi, nphi, rhob };
}

// ── recta de agua (Pickett) ─────────────────────────────────────────────────────────────────────────────────────

/** Punto del gráfico de Pickett: x = Rt (ohm·m), y = φ (v/v). */
export interface PickettPoint {
  rt: number;
  phi: number;
}

/** Rt de la recta de agua (Sw = 1) a una porosidad: Rt = a·Rw / φ^m. En φ = 1 vale a·Rw. */
export function waterLineRt(phi: number, p: Pick<ArchieParams, 'a' | 'm' | 'rw'>): number {
  return (p.a * p.rw) / phi ** p.m;
}

/**
 * TRASLADAR la recta de agua (pendiente −1/m fija) para que pase por `pt`: Rw = Rt·φ^m / a (Rw de formación).
 * NaN si el punto no sirve.
 */
export function rwFromTranslate(pt: PickettPoint, a: number, m: number): number {
  if (!(pt.rt > 0) || !(pt.phi > 0) || !(a > 0)) return NaN;
  return (pt.rt * pt.phi ** m) / a;
}

/**
 * ROTAR la recta de agua alrededor de su corte en φ = 1 (Rt = a·Rw, que no cambia) hasta que pase por `pt`:
 * log Rt = log(a·Rw) − m·log φ  ⇒  m = (log(a·Rw) − log Rt) / log φ. NaN si `pt` está en φ ≥ 1 (no define pendiente).
 * Puede dar m fuera de rango (o ≤ 0 si Rt < a·Rw): lo acota `normalizeParam`.
 */
export function mFromRotate(pt: PickettPoint, a: number, rw: number): number {
  if (!(pt.rt > 0) || !(pt.phi > 0) || !(pt.phi < 1) || !(a * rw > 0)) return NaN;
  return (Math.log(a * rw) - Math.log(pt.rt)) / Math.log(pt.phi);
}

/**
 * Manijas de la recta de agua dentro del gráfico (rangos de Rt y φ, ejes log): la de TRASLADAR en el medio del tramo
 * visible (en log) y la de ROTAR cerca del extremo de φ baja (el otro extremo, φ = 1, es el pivote). Si la recta queda
 * fuera del gráfico, la manija de trasladar va al centro (arrastrarla trae la recta) y no hay manija de rotar.
 */
export function waterLineHandles(p: Pick<ArchieParams, 'a' | 'm' | 'rw'>, rtRange: [number, number], phiRange: [number, number]): { translate: PickettPoint; rotate: PickettPoint | null; visible: boolean } {
  const L = Math.log(p.a * p.rw);
  const [x0, x1] = [Math.log(Math.min(...rtRange)), Math.log(Math.max(...rtRange))];
  const [y0, y1] = [Math.log(Math.min(...phiRange)), Math.log(Math.max(...phiRange))];
  // X = L − m·Y dentro de [x0, x1]  ⇔  Y ∈ [(L − x1)/m, (L − x0)/m].
  const lo = Math.max(y0, (L - x1) / p.m);
  const hi = Math.min(y1, (L - x0) / p.m);
  if (!(p.m > 0) || !Number.isFinite(L) || !(hi > lo)) {
    return { translate: { rt: Math.exp((x0 + x1) / 2), phi: Math.exp((y0 + y1) / 2) }, rotate: null, visible: false };
  }
  const at = (Y: number): PickettPoint => ({ rt: Math.exp(L - p.m * Y), phi: Math.exp(Y) });
  return { translate: at(lo + 0.5 * (hi - lo)), rotate: at(lo + 0.1 * (hi - lo)), visible: true };
}

// ── Rw: temperatura de referencia ↔ formación ───────────────────────────────────────────────────────────────────

/**
 * Temperatura representativa de los puntos visibles: la MEDIANA de la curva TEMP que alimenta `rw-manual`, en °C.
 * NaN si no hay temperaturas.
 */
export function representativeTemperature(temp: ArrayLike<number>, idx: ArrayLike<number>): number {
  return medianAt(temp, idx);
}

/**
 * Rw de formación a la temperatura `tC` a partir de la Rw de referencia, con la MISMA fórmula que el motor
 * (`rw-manual`: `correct ? arpsResistivityC(rwRef, tRef, T) : rwRef`).
 */
export function rwAtFormation(rwRef: number, tRef: number, tC: number, correct: boolean): number {
  return correct ? arpsResistivityC(rwRef, tRef, tC) : rwRef;
}

/** Inversa de `rwAtFormation`: Rw a la temperatura de referencia que, llevada a `tC`, da `rwForm` (Arps es una razón). */
export function rwAtReference(rwForm: number, tRef: number, tC: number, correct: boolean): number {
  return correct ? arpsResistivityC(rwForm, tC, tRef) : rwForm;
}
