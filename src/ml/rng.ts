/**
 * Generador pseudoaleatorio con semilla (mulberry32) y utilidades derivadas. Todo el módulo `ml` usa este generador:
 * nunca `Math.random`, para que entrenamiento, clustering y validación sean determinísticos y reproducibles.
 *
 * mulberry32 (Tommy Ettinger, dominio público): estado de 32 bits, período 2³², suficiente para el muestreo de
 * este módulo (no es criptográfico).
 */

export type Rng = () => number;

/** Generador uniforme en [0, 1) a partir de una semilla entera de 32 bits. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deriva una semilla independiente para el elemento `index` (árbol, repetición, fold...) a partir de una semilla
 * base, mezclando con la finalización de MurmurHash3. Así cada árbol tiene su propia secuencia sin depender del
 * orden en que se construyan.
 */
export function deriveSeed(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Entero uniforme en [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

/** Baraja in situ (Fisher–Yates) un arreglo tipado o común. */
export function shuffleInPlace<T extends { length: number; [i: number]: number }>(arr: T, rng: Rng): T {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Normal estándar (Box–Muller) con el generador dado. */
export function randNormal(rng: Rng): number {
  const u = Math.max(rng(), 1e-300);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
