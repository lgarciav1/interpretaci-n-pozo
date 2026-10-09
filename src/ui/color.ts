/**
 * Utilidades de color puras (sin DOM): parseo de hex, mezcla y contraste WCAG.
 * Las usan la paleta de curvas (para garantizar contraste contra el fondo de pista) y los tests.
 */

export type Rgb = readonly [number, number, number];

/** '#rgb' o '#rrggbb' → [r, g, b] en 0–255. Lanza si no es un hex válido. */
export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Color hex inválido: '${hex}'.`);
  const h = m[1]!;
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function toHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mezcla lineal en sRGB: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [parseHex(a), parseHex(b)];
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Luminancia relativa WCAG 2.x. */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Relación de contraste WCAG (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Devuelve `color` o, si no llega a `min` de contraste contra `bg`, lo mezcla de a poco con blanco (fondo oscuro)
 * o negro (fondo claro) hasta llegar. Conserva el tono lo más posible.
 */
export function ensureContrast(color: string, bg: string, min = 3): string {
  if (contrastRatio(color, bg) >= min) return color;
  const toward = luminance(bg) < 0.18 ? '#ffffff' : '#000000';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(color, toward, t);
    if (contrastRatio(c, bg) >= min) return c;
  }
  return toward;
}

/** Hex + alfa → 'rgba(r, g, b, a)' (para rellenos en canvas o CSS). */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
