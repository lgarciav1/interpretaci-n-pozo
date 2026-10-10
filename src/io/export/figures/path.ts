/**
 * Trazados para el exportador SVG: un constructor de `d` de SVG con la parte de la API de `Path2D` que usa el dibujo
 * (moveTo, lineTo, closePath, rect, arc, roundRect, curvas) y un `Path2D` de reemplazo (`SvgPath2D`) que el dibujo del
 * visor puede instanciar con `new Path2D()` mientras se exporta (ver `withSvgPath2D`). Puro: sin DOM.
 * docs/decisiones/0012-exportacion-de-figuras.md.
 */

const TAU = Math.PI * 2;

/** Número para un atributo SVG: 2 decimales, sin «-0» ni notación científica; un valor no finito se escribe como 0. */
export function num(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 100) / 100;
  if (r === 0) return '0';
  const s = String(r);
  return s.includes('e') ? r.toFixed(2).replace(/\.?0+$/, '') : s;
}

/** Constructor del atributo `d`. Las coordenadas se escriben tal cual (sin transformar): quien pinta aplica la matriz. */
export class PathBuilder {
  private parts: string[] = [];
  private cx = NaN;
  private cy = NaN;
  private sx = NaN;
  private sy = NaN;

  get d(): string {
    return this.parts.join('');
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  clear(): void {
    this.parts = [];
    this.cx = this.cy = this.sx = this.sy = NaN;
  }

  private hasPoint(): boolean {
    return Number.isFinite(this.cx);
  }

  moveTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.parts.push(`M${num(x)} ${num(y)}`);
    this.cx = this.sx = x;
    this.cy = this.sy = y;
  }

  lineTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // Como en el canvas: un lineTo sin subtrazado abre uno nuevo.
    if (!this.hasPoint()) return this.moveTo(x, y);
    this.parts.push(`L${num(x)} ${num(y)}`);
    this.cx = x;
    this.cy = y;
  }

  closePath(): void {
    if (!this.hasPoint()) return;
    this.parts.push('Z');
    this.cx = this.sx;
    this.cy = this.sy;
  }

  rect(x: number, y: number, w: number, h: number): void {
    if (![x, y, w, h].every(Number.isFinite)) return;
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    // closePath deja el punto actual en el origen del rectángulo, como el canvas.
    this.closePath();
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (![c1x, c1y, c2x, c2y, x, y].every(Number.isFinite)) return;
    if (!this.hasPoint()) this.moveTo(c1x, c1y);
    this.parts.push(`C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(x)} ${num(y)}`);
    this.cx = x;
    this.cy = y;
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    if (![cx, cy, x, y].every(Number.isFinite)) return;
    if (!this.hasPoint()) this.moveTo(cx, cy);
    this.parts.push(`Q${num(cx)} ${num(cy)} ${num(x)} ${num(y)}`);
    this.cx = x;
    this.cy = y;
  }

  /** Arco de circunferencia con la semántica del canvas (ángulos en radianes, sentido horario salvo `ccw`). */
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    if (![x, y, r, a0, a1].every(Number.isFinite) || r < 0) return;
    let delta = a1 - a0;
    if (!ccw) delta = delta >= TAU ? TAU : ((delta % TAU) + TAU) % TAU;
    else delta = delta <= -TAU ? -TAU : -((((-delta) % TAU) + TAU) % TAU);
    const px = (a: number) => x + r * Math.cos(a);
    const py = (a: number) => y + r * Math.sin(a);
    if (this.hasPoint()) this.lineTo(px(a0), py(a0));
    else this.moveTo(px(a0), py(a0));
    if (delta === 0 || r === 0) return;
    const sweep = delta > 0 ? 1 : 0;
    const arcTo = (a: number, large: 0 | 1) => {
      this.parts.push(`A${num(r)} ${num(r)} 0 ${large} ${sweep} ${num(px(a))} ${num(py(a))}`);
      this.cx = px(a);
      this.cy = py(a);
    };
    if (Math.abs(delta) >= TAU - 1e-9) {
      // Circunferencia entera: un arco SVG con el mismo punto de partida y llegada no se dibuja; van dos mitades.
      arcTo(a0 + delta / 2, 0);
      arcTo(a0 + delta, 0);
    } else arcTo(a0 + delta, Math.abs(delta) > Math.PI ? 1 : 0);
  }

  /** Rectángulo de esquinas redondeadas (radio único). */
  roundRect(x: number, y: number, w: number, h: number, radius: number | readonly number[] = 0): void {
    if (![x, y, w, h].every(Number.isFinite)) return;
    const r0 = typeof radius === 'number' ? radius : (radius[0] ?? 0);
    const r = Math.max(0, Math.min(Number.isFinite(r0) ? r0 : 0, Math.abs(w) / 2, Math.abs(h) / 2));
    if (r === 0) {
      this.rect(x, y, w, h);
      return;
    }
    const x1 = x + w;
    const y1 = y + h;
    this.moveTo(x + r, y);
    this.lineTo(x1 - r, y);
    this.parts.push(`A${num(r)} ${num(r)} 0 0 1 ${num(x1)} ${num(y + r)}`);
    this.lineTo(x1, y1 - r);
    this.parts.push(`A${num(r)} ${num(r)} 0 0 1 ${num(x1 - r)} ${num(y1)}`);
    this.lineTo(x + r, y1);
    this.parts.push(`A${num(r)} ${num(r)} 0 0 1 ${num(x)} ${num(y1 - r)}`);
    this.lineTo(x, y + r);
    this.parts.push(`A${num(r)} ${num(r)} 0 0 1 ${num(x + r)} ${num(y)}`);
    this.cx = x + r;
    this.cy = y;
    this.closePath();
  }

  /** Agrega los segmentos de otro trazado. */
  append(other: PathBuilder): void {
    if (other.isEmpty) return;
    this.parts.push(other.d);
    this.cx = other.cx;
    this.cy = other.cy;
    this.sx = other.sx;
    this.sy = other.sy;
  }
}

/** Reemplazo de `Path2D` para exportar: guarda el trazado como `d` de SVG (el `Path2D` nativo no se puede leer). */
export class SvgPath2D extends PathBuilder {
  addPath(other: SvgPath2D): void {
    this.append(other);
  }
}

/**
 * Ejecuta `fn` con `globalThis.Path2D` reemplazado por `SvgPath2D` y lo restaura siempre. El dibujo del visor hace
 * `new Path2D()` para los rellenos; el dibujo es síncrono, así que nadie más ve el reemplazo.
 */
export function withSvgPath2D<T>(fn: () => T): T {
  const g = globalThis as { Path2D?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, 'Path2D');
  const prev = g.Path2D;
  g.Path2D = SvgPath2D;
  try {
    return fn();
  } finally {
    if (had) g.Path2D = prev;
    else delete g.Path2D;
  }
}
