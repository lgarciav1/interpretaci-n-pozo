/**
 * Puesta en profundidad corona–perfil (src/petro/depthMatch.ts, docs/decisiones/0010 D3): interpolación lineal,
 * correlación de Pearson y barrido de desplazamientos. Convención: profundidad corregida = archivo + s.
 * Las curvas son sintéticas y sin ruido (la forma conocida permite verificar el desplazamiento exacto); los valores
 * de Pearson e interpolación se verifican con cuentas a mano.
 */
import { describe, expect, it } from 'vitest';
import { interpolateAt, pearson, suggestDepthShift } from '../src/petro/depthMatch';

// Perfil sintético: 1000–1100 m cada 0,1 m, suma de senos de periodos inconmensurables (sin simetrías ni repeticiones).
const logDepth = Float64Array.from({ length: 1001 }, (_, i) => 1000 + i * 0.1);
const f = (z: number) => 0.15 + 0.05 * Math.sin(z / 2.7) + 0.03 * Math.sin(z / 1.1 + 1) + 0.02 * Math.sin(z / 5.3 + 2);
const logValue = Float64Array.from(logDepth, f);
// Plugs cada 0,5 m entre 1030 y 1070 (81 plugs).
const plugZ = Float64Array.from({ length: 81 }, (_, i) => 1030 + i * 0.5);
/** Valor de corona de un plug cuyo archivo dice `z` y cuya profundidad verdadera es z + shift. */
const plugsFor = (shift: number) => Float64Array.from(plugZ, (z) => f(z + shift));

describe('interpolateAt', () => {
  const d = [0, 1, 2];
  const v = [0, 10, 30];
  it('interpola linealmente (a mano: 0,5 → 5; 1,5 → 20) y respeta los nodos', () => {
    expect(interpolateAt(d, v, 0.5)).toBeCloseTo(5, 12);
    expect(interpolateAt(d, v, 1.5)).toBeCloseTo(20, 12);
    expect(interpolateAt(d, v, 0)).toBe(0);
    expect(interpolateAt(d, v, 1)).toBe(10);
    expect(interpolateAt(d, v, 2)).toBe(30);
  });
  it('fuera del rango, z no finito, vacío o vecino sin dato → NaN', () => {
    expect(interpolateAt(d, v, -0.1)).toBeNaN();
    expect(interpolateAt(d, v, 2.1)).toBeNaN();
    expect(interpolateAt(d, v, NaN)).toBeNaN();
    expect(interpolateAt([], [], 1)).toBeNaN();
    expect(interpolateAt(d, [0, NaN, 30], 0.5)).toBeNaN();
    expect(interpolateAt(d, [0, NaN, 30], 1.5)).toBeNaN();
    expect(interpolateAt(d, [0, NaN, 30], 1)).toBeNaN();
  });
});

describe('pearson', () => {
  it('x = 1…5, y = 2, 1, 4, 3, 5 → r = 0,8 (Sxy = 8, Sxx = Syy = 10)', () => {
    const { r, n } = pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]);
    expect(n).toBe(5);
    expect(r).toBeCloseTo(0.8, 12);
  });
  it('relación lineal exacta: +1 (pendiente positiva) y −1 (negativa), insensible a escala y sesgo', () => {
    const x = [0.1, 0.2, 0.35, 0.4];
    expect(pearson(x, x.map((v) => 3 * v + 7)).r).toBeCloseTo(1, 12);
    expect(pearson(x, x.map((v) => -0.5 * v + 1)).r).toBeCloseTo(-1, 12);
  });
  it('ignora los pares con NaN; varianza nula o menos de 2 pares → NaN', () => {
    const { r, n } = pearson([1, 2, NaN, 3], [2, 4, 9, 6]);
    expect(n).toBe(3);
    expect(r).toBeCloseTo(1, 12);
    expect(pearson([1, 1, 1], [1, 2, 3]).r).toBeNaN();
    expect(pearson([1], [2]).r).toBeNaN();
    expect(pearson([NaN, 1], [1, NaN]).n).toBe(0);
  });
  it('una serie constante da NaN aunque el redondeo de la media deje una varianza ~1e-33 (no un r de ruido)', () => {
    const c = Array.from({ length: 81 }, (_, i) => Math.sin(i / 3));
    expect(pearson(c, c.map(() => 0.2)).r).toBeNaN();
  });
});

describe('suggestDepthShift', () => {
  it('recupera un desplazamiento de +2,4 m (la corona del archivo está 2,4 m más arriba) con error ≤ paso', () => {
    const r = suggestDepthShift(plugZ, plugsFor(2.4), logDepth, logValue);
    expect(r.best).not.toBeNull();
    expect(Math.abs(r.best! - 2.4)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(r.r).toBeGreaterThan(0.99);
    expect(r.n).toBe(81);
    expect(r.atEdge).toBe(false);
    expect(r.ambiguous).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('desplazamiento negativo: −1,7 m', () => {
    const r = suggestDepthShift(plugZ, plugsFor(-1.7), logDepth, logValue);
    expect(Math.abs(r.best! + 1.7)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(r.warnings).toEqual([]);
  });

  it('desplazamiento nulo: sugiere 0 exacto', () => {
    const r = suggestDepthShift(plugZ, plugsFor(0), logDepth, logValue);
    expect(r.best).toBe(0);
    expect(r.r).toBeCloseTo(1, 9);
  });

  it('es insensible a escala y sesgo entre corona y perfil (φ de laboratorio ≠ φ de perfil)', () => {
    const c = Float64Array.from(plugsFor(2.4), (v) => 0.8 * v - 0.02);
    const r = suggestDepthShift(plugZ, c, logDepth, logValue);
    expect(Math.abs(r.best! - 2.4)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('opciones: paso 0,01 afina el resultado (error ≤ 0,01) y el barrido tiene 2·maxShift/paso + 1 puntos', () => {
    const r = suggestDepthShift(plugZ, plugsFor(2.4), logDepth, logValue, { step: 0.01, maxShift: 4 });
    expect(Math.abs(r.best! - 2.4)).toBeLessThanOrEqual(0.01 + 1e-9);
    expect(r.shifts).toHaveLength(801);
    expect(r.rs).toHaveLength(801);
    expect(r.shifts[0]).toBeCloseTo(-4, 9);
    expect(r.shifts[800]).toBeCloseTo(4, 9);
  });

  it('máximo en el borde del barrido: avisa que el verdadero puede estar más allá', () => {
    const r = suggestDepthShift(plugZ, plugsFor(2.4), logDepth, logValue, { maxShift: 1.5 });
    expect(r.atEdge).toBe(true);
    expect(r.warnings.some((w) => w.includes('borde de la búsqueda'))).toBe(true);
  });

  it('máximo ambiguo: una señal periódica (periodo 4 m) tiene dos máximos iguales dentro de ±5 m', () => {
    const per = (z: number) => 0.15 + 0.05 * Math.sin((2 * Math.PI * z) / 4);
    const lv = Float64Array.from(logDepth, per);
    const c = Float64Array.from(plugZ, (z) => per(z + 2.4));
    const r = suggestDepthShift(plugZ, c, logDepth, lv);
    // 2,4 y 2,4 − 4 = −1,6 correlacionan igual: gana el de menor |s| (no mover la corona sin motivo) y se avisa.
    expect(Math.abs(r.best!)).toBeCloseTo(1.6, 1);
    expect(r.ambiguous).toBe(true);
    expect(r.warnings.some((w) => w.includes('ambigua'))).toBe(true);
  });

  it('perfil constante (máximo plano): no hay correlación calculable → sin sugerencia y con aviso', () => {
    const flat = Float64Array.from(logDepth, () => 0.2);
    const r = suggestDepthShift(plugZ, plugsFor(1), logDepth, flat);
    expect(r.best).toBeNull();
    expect(r.r).toBeNaN();
    expect(r.n).toBe(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/no se puede correlacionar/);
  });

  it('correlación débil (datos sin relación): avisa r < 0,5', () => {
    // Plugs con una señal de otra frecuencia: la mejor correlación posible es baja.
    const noise = Float64Array.from(plugZ, (z) => Math.sin(z * 7.77) + Math.cos(z * 3.1));
    const r = suggestDepthShift(plugZ, noise, logDepth, logValue);
    expect(r.best).not.toBeNull();
    expect(r.r).toBeLessThan(0.5);
    expect(r.warnings.some((w) => w.includes('débil'))).toBe(true);
  });

  it('datos con NaN: plugs sin valor y huecos del perfil se ignoran y aun así recupera 2,4 m', () => {
    const c = Float64Array.from(plugsFor(2.4));
    c[3] = NaN;
    c[40] = NaN;
    const lv = Float64Array.from(logValue);
    for (let i = 300; i < 306; i++) lv[i] = NaN; // hueco de 0,6 m en el perfil
    const r = suggestDepthShift(plugZ, c, logDepth, lv);
    expect(Math.abs(r.best! - 2.4)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(r.n).toBeLessThanOrEqual(79);
    expect(r.n).toBeGreaterThanOrEqual(Math.ceil(0.7 * 79));
  });

  it('un perfil todo NaN no da sugerencia', () => {
    const lv = new Float64Array(logDepth.length).fill(NaN);
    expect(suggestDepthShift(plugZ, plugsFor(1), logDepth, lv).best).toBeNull();
  });

  it('pocos puntos (< 5 plugs con dato): sin sugerencia, avisa cuántos hay', () => {
    const r = suggestDepthShift(plugZ.slice(0, 4), plugsFor(2.4).slice(0, 4), logDepth, logValue);
    expect(r.best).toBeNull();
    expect(r.warnings[0]).toMatch(/al menos 5 plugs con dato para sugerir un desplazamiento \(hay 4\)/);
    // y con minPoints menor sí calcula
    const r2 = suggestDepthShift(plugZ.slice(0, 4), plugsFor(2.4).slice(0, 4), logDepth, logValue, { minPoints: 3 });
    expect(r2.best).not.toBeNull();
  });

  it('sin plugs: sin sugerencia', () => {
    const r = suggestDepthShift([], [], logDepth, logValue);
    expect(r.best).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });

  it('plugs que caen fuera del perfil no inflan r: si menos del 70 % es comparable, no hay sugerencia en ese desplazamiento', () => {
    // Mitad de los plugs fuera del perfil (arriba de 1000 m): ningún desplazamiento compara el 70 %.
    const z = Float64Array.from({ length: 40 }, (_, i) => 990 + i * 0.5); // 990–1009,5; solo los ≥ 1000 caen en el perfil
    const c = Float64Array.from(z, (v) => f(v));
    const r = suggestDepthShift(z, c, logDepth, logValue, { maxShift: 0.5 });
    expect(r.best).toBeNull();
  });
});
