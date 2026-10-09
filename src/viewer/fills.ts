/**
 * Geometría de rellenos entre dos perfiles x(y) sobre la misma grilla de y (muestras o filas de píxel). Puro.
 *
 * `fillBetween` recorre los tramos i → i+1 y emite cuadriláteros (o dos triángulos si las curvas se cruzan, con el
 * punto de cruce interpolado) a uno de dos destinos según qué curva queda a la izquierda EN PANTALLA:
 *   - `aLeft`: x_a < x_b (densidad a la izquierda del neutrón → cruce de gas)
 *   - `bLeft`: x_b < x_a (neutrón a la izquierda → separación de arcilla)
 * Los destinos son `Path2D` (en el visor) o cualquier objeto con moveTo/lineTo/closePath (en los tests). Rellenar
 * todos los polígonos de un destino con un solo `fill()` evita costuras entre tramos vecinos.
 * Un NaN en cualquiera de las dos curvas corta el relleno.
 */

export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

type Profile = ArrayLike<number> | number;

const at = (p: Profile, i: number): number => (typeof p === 'number' ? p : p[i]!);

// Puntos del tramo en curso (reusados entre llamadas: sin asignar memoria por cuadro).
const runA: number[] = [];
const runB: number[] = [];

/**
 * Rellena entre `xa` y `xb` (arrays o un valor fijo: borde de pista o línea base) para i en [0, n).
 * `lo`/`hi` acotan las x (bordes de la pista): un valor fuera de escala rellena hasta el borde.
 *
 * Emite UN polígono por tramo continuo del mismo lado (ida por `a`, vuelta por `b`), no uno por muestra: el
 * rasterizado de pocos polígonos grandes es mucho más barato que el de cientos de cuadriláteros.
 */
export function fillBetween(
  n: number,
  y: ArrayLike<number>,
  xa: Profile,
  xb: Profile,
  aLeft: PathSink | null,
  bLeft: PathSink | null,
  lo = -Infinity,
  hi = Infinity,
): void {
  const clampX = (v: number) => (v < lo ? lo : v > hi ? hi : v);
  let side = 0; // −1: a a la izquierda; +1: b a la izquierda; 0: todavía iguales
  let pd = NaN; // diferencia a − b del punto anterior
  let pa = NaN;
  let py = NaN;
  runA.length = 0;
  runB.length = 0;
  const flush = () => {
    const sink = side < 0 ? aLeft : side > 0 ? bLeft : null;
    if (sink && runA.length >= 4) {
      sink.moveTo(runA[0]!, runA[1]!);
      for (let k = 2; k < runA.length; k += 2) sink.lineTo(runA[k]!, runA[k + 1]!);
      for (let k = runB.length - 2; k >= 0; k -= 2) sink.lineTo(runB[k]!, runB[k + 1]!);
      sink.closePath();
    }
    runA.length = 0;
    runB.length = 0;
  };
  for (let i = 0; i < n; i++) {
    const ca = clampX(at(xa, i));
    const cb = clampX(at(xb, i));
    const cy = y[i]!;
    if (ca !== ca || cb !== cb || cy !== cy) {
      flush();
      side = 0;
      pd = NaN;
      continue;
    }
    const d = ca - cb;
    const s = d < 0 ? -1 : d > 0 ? 1 : 0;
    if (pd === pd && s !== 0 && side !== 0 && s !== side) {
      // Cruce entre el punto anterior y este: se cierra el polígono en el punto de cruce y se abre otro.
      const t = pd / (pd - d);
      const yc = py + t * (cy - py);
      const xc = pa + t * (ca - pa);
      runA.push(xc, yc);
      runB.push(xc, yc);
      flush();
      runA.push(xc, yc);
      runB.push(xc, yc);
      side = s;
    } else if (side === 0) side = s;
    runA.push(ca, cy);
    runB.push(cb, cy);
    pd = d;
    pa = ca;
    py = cy;
  }
  flush();
}

/** Destino que acumula el área (fórmula del área de Gauss) — para tests y para medir rellenos. */
export class AreaSink implements PathSink {
  area = 0;
  polygons = 0;
  private pts: number[] = [];
  moveTo(x: number, y: number) {
    this.pts = [x, y];
  }
  lineTo(x: number, y: number) {
    this.pts.push(x, y);
  }
  closePath() {
    const p = this.pts;
    let a = 0;
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      a += p[i]! * p[j + 1]! - p[j]! * p[i + 1]!;
    }
    this.area += Math.abs(a) / 2;
    this.polygons++;
    this.pts = [];
  }
}
