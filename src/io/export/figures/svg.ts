/**
 * Contexto 2D «grabador» que emite SVG. Implementa la parte de `CanvasRenderingContext2D` que usan el visor, los
 * gráficos x–y y las tendencias (trazados, rellenos, trazos con rayas, recortes, degradados, texto, rotaciones y
 * traslaciones, transparencia global), de modo que las MISMAS funciones de dibujo producen la pantalla, el PNG y el SVG.
 * Puro: sin DOM. docs/decisiones/0012-exportacion-de-figuras.md.
 *
 * Reglas de la traducción:
 * - Cada operación de pintura es un elemento (`path`, `rect`, `text`) con la matriz vigente en `transform`. El trazado
 *   se escribe en coordenadas locales: la matriz tiene que ser la misma al construirlo y al pintarlo (así lo hace todo
 *   el dibujo de la app).
 * - `clip()` abre un `<g clip-path>` que dura hasta el `restore()` del `save()` vigente (recortes anidados = grupos
 *   anidados); los grupos vacíos no se escriben.
 * - Los colores se escriben como hex + `*-opacity` (los programas de edición no siempre entienden `rgba()`).
 * - El texto es `<text>` con la fuente que se pidió. La línea de base se resuelve con un desplazamiento en `em`
 *   (`dominant-baseline` no lo respetan todos los programas).
 * - `clearRect` solo vacía el documento si cubre todo el lienzo sin transformar; en otro caso se ignora (el dibujo de
 *   las figuras siempre pinta primero su fondo).
 * - Lo que no está implementado (`drawImage`, `strokeText`, patrones…) no existe: llamarlo falla con un TypeError en
 *   vez de dibujar mal en silencio (las superposiciones están aisladas con `guard`: el error se registra y el resto
 *   de la figura sigue).
 */
import { num, PathBuilder, SvgPath2D } from './path';

export type TextMeasure = (font: string, text: string) => number;

/** Ancho aproximado de un texto en `font` (px) cuando no hay un canvas real para medir (tests, Node). */
export const approximateMeasure: TextMeasure = (font, text) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const bold = /\b(600|700|800|bold)\b/.test(font);
  let w = 0;
  for (const ch of text) {
    if ('iljI.,:;|!\'`'.includes(ch)) w += 0.27;
    else if (' ()[]{}-/\\"'.includes(ch)) w += 0.33;
    else if ('mwMW@%'.includes(ch)) w += 0.85;
    else if (ch >= '0' && ch <= '9') w += 0.56;
    else if (ch >= 'A' && ch <= 'Z') w += 0.67;
    else w += 0.52;
  }
  return w * size * (bold ? 1.06 : 1);
};

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const isIdentity = (m: Matrix) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
const transformAttr = (m: Matrix) => (isIdentity(m) ? '' : ` transform="matrix(${m.map(matrixNum).join(' ')})"`);
const matrixNum = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e5) / 1e5) : '0');

// ── colores ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ParsedColor {
  /** '#rrggbb' */
  hex: string;
  /** 0–1 */
  alpha: number;
}

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

/** Color CSS (hex de 3, 4, 6 u 8 dígitos, `rgb()`/`rgba()`, `transparent`) → hex + opacidad. null si no lo entiende. */
export function parseCssColor(input: string): ParsedColor | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { hex: '#000000', alpha: 0 };
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { hex: `#${h.slice(0, 6)}`, alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1]!.split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const ch = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const [r, g, b] = [ch(p[0]!), ch(p[1]!), ch(p[2]!)];
    const a = p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    if (![r, g, b, a].every(Number.isFinite)) return null;
    return { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha: Math.min(1, Math.max(0, a)) };
  }
  return null;
}

// ── degradado ────────────────────────────────────────────────────────────────────────────────────────────────────

export class SvgGradient {
  readonly stops: { offset: number; color: string }[] = [];
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly x1: number,
    readonly y1: number,
  ) {}
  addColorStop(offset: number, color: string): void {
    if (!(offset >= 0 && offset <= 1)) throw new Error('El desplazamiento de una parada de color tiene que estar entre 0 y 1.');
    this.stops.push({ offset, color });
  }
}

// ── árbol de elementos ───────────────────────────────────────────────────────────────────────────────────────────

interface Group {
  clipId: string;
  clipDef: string;
  children: (string | Group)[];
}

interface DrawState {
  fillStyle: string | SvgGradient;
  strokeStyle: string | SvgGradient;
  lineWidth: number;
  lineJoin: string;
  lineCap: string;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  dash: number[];
  ctm: Matrix;
  groupDepth: number;
}

const escText = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

/** Desplazamiento vertical (em) de la línea de base alfabética para cada `textBaseline` del canvas. */
const BASELINE_DY: Record<string, number> = { top: 0.85, hanging: 0.8, middle: 0.35, alphabetic: 0, ideographic: -0.1, bottom: -0.15 };
const ANCHOR: Record<string, string> = { left: 'start', start: 'start', center: 'middle', right: 'end', end: 'end' };

export interface SvgContextOptions {
  width: number;
  height: number;
  measure?: TextMeasure;
  /** Título accesible del documento. */
  title?: string;
  description?: string;
}

export class SvgContext2D {
  fillStyle: string | SvgGradient = '#000000';
  strokeStyle: string | SvgGradient = '#000000';
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  globalAlpha = 1;
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  // Propiedades que el canvas real tiene y el dibujo puede asignar sin efecto en un SVG.
  miterLimit = 10;
  imageSmoothingEnabled = true;

  private dash: number[] = [];
  private ctm: Matrix = IDENTITY;
  private path = new PathBuilder();
  private stack: DrawState[] = [];
  private root: Group = { clipId: '', clipDef: '', children: [] };
  private groups: Group[] = [this.root];
  private gradients = new Map<SvgGradient, string>();
  private gradientDefs: string[] = [];
  private clipCount = 0;
  private readonly measure: TextMeasure;

  constructor(private readonly opts: SvgContextOptions) {
    this.measure = opts.measure ?? approximateMeasure;
  }

  /** Para pasarlo a funciones de dibujo que piden un `CanvasRenderingContext2D`. */
  asCanvas(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }

  // ── estado ──────────────────────────────────────────────────────────────────────────────────────────────────

  save(): void {
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineJoin: this.lineJoin,
      lineCap: this.lineCap,
      globalAlpha: this.globalAlpha,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      dash: this.dash,
      ctm: this.ctm,
      groupDepth: this.groups.length,
    });
  }

  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.lineJoin = s.lineJoin;
    this.lineCap = s.lineCap;
    this.globalAlpha = s.globalAlpha;
    this.font = s.font;
    this.textAlign = s.textAlign;
    this.textBaseline = s.textBaseline;
    this.dash = s.dash;
    this.ctm = s.ctm;
    this.groups.length = s.groupDepth;
  }

  setLineDash(segments: Iterable<number>): void {
    const d = [...segments];
    // Como el canvas: una lista con un valor negativo o no finito se ignora; una impar se repite.
    if (d.some((v) => !Number.isFinite(v) || v < 0)) return;
    this.dash = d.length % 2 ? [...d, ...d] : d;
  }
  getLineDash(): number[] {
    return [...this.dash];
  }

  // ── transformaciones ────────────────────────────────────────────────────────────────────────────────────────

  translate(x: number, y: number): void {
    this.ctm = multiply(this.ctm, [1, 0, 0, 1, x, y]);
  }
  rotate(angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.ctm = multiply(this.ctm, [c, s, -s, c, 0, 0]);
  }
  scale(x: number, y: number): void {
    this.ctm = multiply(this.ctm, [x, 0, 0, y, 0, 0]);
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ctm = multiply(this.ctm, [a, b, c, d, e, f]);
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ctm = [a, b, c, d, e, f];
  }
  resetTransform(): void {
    this.ctm = IDENTITY;
  }

  // ── trazados ────────────────────────────────────────────────────────────────────────────────────────────────

  beginPath(): void {
    this.path.clear();
  }
  closePath(): void {
    this.path.closePath();
  }
  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.path.rect(x, y, w, h);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    this.path.arc(x, y, r, a0, a1, ccw);
  }
  roundRect(x: number, y: number, w: number, h: number, radii: number | readonly number[] = 0): void {
    this.path.roundRect(x, y, w, h, radii);
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.path.bezierCurveTo(a, b, c, d, e, f);
  }
  quadraticCurveTo(a: number, b: number, c: number, d: number): void {
    this.path.quadraticCurveTo(a, b, c, d);
  }

  private pathOf(arg: unknown): PathBuilder {
    if (arg === undefined || typeof arg === 'string') return this.path;
    if (arg instanceof SvgPath2D) return arg;
    throw new Error('Al exportar a SVG solo se pueden pintar trazados creados con Path2D durante la exportación.');
  }

  // ── pintura ─────────────────────────────────────────────────────────────────────────────────────────────────

  private paint(attr: 'fill' | 'stroke', style: string | SvgGradient): string {
    const alpha = this.globalAlpha;
    if (style instanceof SvgGradient) {
      let id = this.gradients.get(style);
      if (!id) {
        id = `g${this.gradients.size + 1}`;
        this.gradients.set(style, id);
        const stops = style.stops
          .map((st) => {
            const c = parseCssColor(st.color);
            return `<stop offset="${num(st.offset * 100)}%" stop-color="${c ? c.hex : escAttr(st.color)}"${c && c.alpha < 1 ? ` stop-opacity="${num3(c.alpha)}"` : ''}/>`;
          })
          .join('');
        this.gradientDefs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(style.x0)}" y1="${num(style.y0)}" x2="${num(style.x1)}" y2="${num(style.y1)}">${stops}</linearGradient>`);
      }
      return ` ${attr}="url(#${id})"${alpha < 1 ? ` ${attr}-opacity="${num3(alpha)}"` : ''}`;
    }
    const c = parseCssColor(style);
    if (!c) return ` ${attr}="${escAttr(style)}"${alpha < 1 ? ` ${attr}-opacity="${num3(alpha)}"` : ''}`;
    const a = c.alpha * alpha;
    if (a <= 0) return ` ${attr}="none"`;
    return ` ${attr}="${c.hex}"${a < 1 ? ` ${attr}-opacity="${num3(a)}"` : ''}`;
  }

  private strokeAttrs(): string {
    let s = this.paint('stroke', this.strokeStyle) + ` stroke-width="${num(this.lineWidth)}"`;
    if (this.lineJoin !== 'miter') s += ` stroke-linejoin="${this.lineJoin}"`;
    if (this.lineCap !== 'butt') s += ` stroke-linecap="${this.lineCap}"`;
    if (this.dash.length && this.dash.some((v) => v > 0)) s += ` stroke-dasharray="${this.dash.map(num).join(' ')}"`;
    return s;
  }

  private emit(el: string): void {
    this.groups[this.groups.length - 1]!.children.push(el);
  }

  fill(pathOrRule?: unknown, rule?: unknown): void {
    const p = this.pathOf(pathOrRule);
    if (p.isEmpty) return;
    const evenodd = pathOrRule === 'evenodd' || rule === 'evenodd';
    this.emit(`<path d="${p.d}"${this.paint('fill', this.fillStyle)}${evenodd ? ' fill-rule="evenodd"' : ''}${transformAttr(this.ctm)}/>`);
  }

  stroke(path?: unknown): void {
    const p = this.pathOf(path);
    if (p.isEmpty) return;
    this.emit(`<path d="${p.d}" fill="none"${this.strokeAttrs()}${transformAttr(this.ctm)}/>`);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (![x, y, w, h].every(Number.isFinite)) return;
    const [rx, rw] = w < 0 ? [x + w, -w] : [x, w];
    const [ry, rh] = h < 0 ? [y + h, -h] : [y, h];
    this.emit(`<rect x="${num(rx)}" y="${num(ry)}" width="${num(rw)}" height="${num(rh)}"${this.paint('fill', this.fillStyle)}${transformAttr(this.ctm)}/>`);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    if (![x, y, w, h].every(Number.isFinite)) return;
    this.emit(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="none"${this.strokeAttrs()}${transformAttr(this.ctm)}/>`);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    if (isIdentity(this.ctm) && this.groups.length === 1 && x <= 0 && y <= 0 && x + w >= this.opts.width && y + h >= this.opts.height) {
      this.root.children.length = 0;
      this.gradients.clear();
      this.gradientDefs.length = 0;
    }
  }

  clip(pathOrRule?: unknown): void {
    const p = this.pathOf(typeof pathOrRule === 'string' ? undefined : pathOrRule);
    const id = `c${++this.clipCount}`;
    const group: Group = { clipId: id, clipDef: `<clipPath id="${id}"><path d="${p.d}"${transformAttr(this.ctm)}/></clipPath>`, children: [] };
    this.groups[this.groups.length - 1]!.children.push(group);
    this.groups.push(group);
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SvgGradient {
    return new SvgGradient(x0, y0, x1, y1);
  }

  // ── texto ───────────────────────────────────────────────────────────────────────────────────────────────────

  measureText(text: string): { width: number } {
    return { width: this.measure(this.font, text) };
  }

  fillText(text: string, x: number, y: number): void {
    if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const f = parseFont(this.font);
    const dy = BASELINE_DY[this.textBaseline] ?? 0;
    const anchor = ANCHOR[this.textAlign] ?? 'start';
    this.emit(
      `<text x="${num(x)}" y="${num(y)}"${dy ? ` dy="${num(dy)}em"` : ''} font-family="${escAttr(f.family)}" font-size="${num(f.size)}"${f.weight !== '400' ? ` font-weight="${f.weight}"` : ''}${f.style ? ` font-style="${f.style}"` : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${this.paint('fill', this.fillStyle)}${transformAttr(this.ctm)}>${escText(text)}</text>`,
    );
  }

  // ── salida ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Documento SVG completo (UTF-8). `background`: color de fondo opcional (un `<rect>` detrás de todo). */
  toSvg(background?: string): string {
    const defs: string[] = [];
    const body = this.render(this.root, defs);
    const { width, height } = this.opts;
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">`;
    const title = this.opts.title ? `<title>${escText(this.opts.title)}</title>` : '';
    const desc = this.opts.description ? `<desc>${escText(this.opts.description)}</desc>` : '';
    const allDefs = [...this.gradientDefs, ...defs];
    const bg = background ? `<rect width="${num(width)}" height="${num(height)}"${this.paintStatic(background)}/>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n${head}${title}${desc}${allDefs.length ? `<defs>${allDefs.join('')}</defs>` : ''}${bg}${body}</svg>\n`;
  }

  private paintStatic(color: string): string {
    const c = parseCssColor(color);
    return c ? ` fill="${c.hex}"${c.alpha < 1 ? ` fill-opacity="${num3(c.alpha)}"` : ''}` : ` fill="${escAttr(color)}"`;
  }

  private render(g: Group, defs: string[]): string {
    let out = '';
    for (const child of g.children) {
      if (typeof child === 'string') out += child;
      else {
        // El clipPath del padre va antes que el de sus hijos (orden estable); si el grupo queda vacío no se escribe.
        const slot = defs.length;
        defs.push(child.clipDef);
        const inner = this.render(child, defs);
        if (!inner) {
          defs.splice(slot, 1);
          continue;
        }
        out += `<g clip-path="url(#${child.clipId})">${inner}</g>`;
      }
    }
    return out;
  }
}

const num3 = (v: number) => String(Math.round(v * 1000) / 1000);

/** `«600 11px "Segoe UI", sans-serif»` → pieza por pieza. */
export function parseFont(font: string): { style: string; weight: string; size: number; family: string } {
  const m = /^\s*(?:(italic|oblique)\s+)?(?:(normal|bold|bolder|lighter|[1-9]00)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/i.exec(font);
  if (!m) return { style: '', weight: '400', size: 10, family: 'sans-serif' };
  const w = (m[2] ?? '400').toLowerCase();
  return { style: m[1] ?? '', weight: w === 'normal' ? '400' : w === 'bold' ? '700' : w, size: Number(m[3]), family: m[4]! };
}
