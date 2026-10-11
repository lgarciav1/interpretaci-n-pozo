/**
 * Fichas de zona (docs/decisiones/0018): semáforo de pay, estadísticas tomadas del sumario y del volumétrico y
 * minigráficos en profundidad. Puro.
 */
import { describe, expect, it } from 'vitest';
import {
  buildZoneCards,
  cardVolume,
  niceCeil,
  PAY_MARGINAL_NTG,
  PAY_MARGINAL_THICKNESS,
  payLight,
  porosityScaleMax,
  sparkPaths,
  sparkSeries,
  type CardZone,
  type Row,
} from '../src/modules/zone-cards/model';

describe('semáforo de pay', () => {
  it('verde: hay pay y no es marginal', () => {
    expect(payLight({ kind: 'reservoir', gross: 40, netPay: 20, ntgPay: 0.5 })).toBe('pay');
  });
  it('ámbar: N/G pay bajo (< 10 %) aunque haya metros', () => {
    expect(payLight({ kind: 'reservoir', gross: 100, netPay: 5, ntgPay: 0.05 })).toBe('marginal');
    // justo en el umbral ya es pay
    expect(payLight({ kind: 'reservoir', gross: 100, netPay: 10, ntgPay: PAY_MARGINAL_NTG })).toBe('pay');
  });
  it('ámbar: menos de 1 m netos de pay', () => {
    expect(payLight({ kind: 'reservoir', gross: 5, netPay: 0.6, ntgPay: 0.12 })).toBe('marginal');
    expect(payLight({ kind: 'reservoir', gross: 5, netPay: PAY_MARGINAL_THICKNESS, ntgPay: 0.2 })).toBe('pay');
  });
  it('sin ntgPay lo calcula con el bruto', () => {
    expect(payLight({ kind: 'formation', gross: 100, netPay: 5 })).toBe('marginal');
    expect(payLight({ kind: 'formation', gross: 10, netPay: 5 })).toBe('pay');
    // sin bruto tampoco hay N/G: solo cuenta el espesor
    expect(payLight({ kind: null, netPay: 5 })).toBe('pay');
  });
  it('gris «sin dato»: el sumario no pudo clasificar la zona (NaN o null)', () => {
    expect(payLight({ kind: 'reservoir', gross: 40, netPay: null })).toBe('nodata');
    expect(payLight({ kind: 'reservoir', gross: 40, netPay: NaN })).toBe('nodata');
    expect(payLight({ kind: 'reservoir', gross: 40, netPay: undefined })).toBe('nodata');
  });
  it('gris «sin pay»: dato con 0 m de pay, y los sellos', () => {
    expect(payLight({ kind: 'reservoir', gross: 40, netPay: 0, ntgPay: 0 })).toBe('none');
    expect(payLight({ kind: 'seal', gross: 40, netPay: 12, ntgPay: 0.3 })).toBe('none');
    expect(payLight({ kind: 'seal', gross: 40, netPay: null })).toBe('none');
  });
});

const zones: CardZone[] = [
  { id: 'z2', name: 'B', color: '#e58f3c', kind: 'reservoir', top: 7700, base: 7760 },
  { id: 'z1', name: 'A', color: '#5b8def', kind: 'formation', top: 7633, base: 7700 },
  { id: 'z3', name: 'C', color: '#4fb07d', kind: 'seal', top: 7760, base: 7800 },
];
const summary: Row[] = [
  { zone: 'A', kind: 'Formación', top: 7633, base: 7700, gross: 67, netRes: 30, netPay: 12.5, ntgRes: 0.45, ntgPay: 0.187, phiRes: 0.14, swRes: 0.5, phiPay: 0.162, swPay: 0.31 },
  { zone: 'B', kind: 'Reservorio', top: 7700, base: 7760, gross: 60, netRes: 20, netPay: 3, ntgRes: 0.33, ntgPay: 0.05, phiPay: 0.11, swPay: 0.42 },
  { zone: 'C', kind: 'Sello', top: 7760, base: 7800, gross: 40, netRes: 0, netPay: null, ntgPay: null, phiPay: null, swPay: null },
  { zone: 'Total', kind: null, top: 7633, base: 7800, gross: 167, netRes: 50, netPay: 15.5 },
];
const vols: Row[] = [
  { zone: 'A', fluid: 'Petróleo', ooipSi: 1.95, ooipField: 12.26, ogipSi: null, ogipField: null },
  { zone: 'B', fluid: 'Gas', ooipSi: null, ooipField: null, ogipSi: 3.5, ogipField: 0.12 },
  { zone: 'C', fluid: 'Sello', ooipSi: 0, ooipField: 0, ogipSi: 0, ogipField: 0 },
  { zone: 'Total', fluid: null, ooipSi: 1.95, ooipField: 12.26, ogipSi: 3.5, ogipField: 0.12 },
];

describe('estadísticas de las fichas', () => {
  const cards = buildZoneCards(zones, summary, vols);

  it('una ficha por zona, en orden de tope, sin la fila «Total»', () => {
    expect(cards.map((c) => c.name)).toEqual(['A', 'B', 'C']);
    expect(cards.map((c) => c.id)).toEqual(['z1', 'z2', 'z3']);
  });

  it('toma de la tabla del sumario los espesores, φ y Sw del pay (sin recalcular)', () => {
    const a = cards[0]!;
    expect(a).toMatchObject({ top: 7633, base: 7700, gross: 67, netRes: 30, netPay: 12.5, ntgPay: 0.187, phiPay: 0.162, swPay: 0.31, color: '#5b8def', kind: 'formation' });
  });

  it('semáforo por ficha: verde, ámbar (N/G pay 5 %), gris en el sello', () => {
    expect(cards.map((c) => c.light)).toEqual(['pay', 'marginal', 'none']);
  });

  it('volumen in situ en las unidades del sumario: petróleo MMbbl y Mm³, gas Bcf y MMm³; el sello no tiene', () => {
    expect(cards[0]!.volume).toEqual({ fluid: 'oil', oil: { field: 12.26, si: 1.95 } });
    expect(cards[1]!.volume).toEqual({ fluid: 'gas', gas: { field: 0.12, si: 3.5 } });
    expect(cards[2]!.volume).toBeNull();
    expect(cards.map((c) => c.fluid)).toEqual(['Petróleo', 'Gas', 'Sello']);
  });

  it('cardVolume: ambos fluidos, nada y sin fila', () => {
    expect(cardVolume({ fluid: 'Petróleo y gas', ooipSi: 1, ooipField: 6, ogipSi: 2, ogipField: 0.07 })).toEqual({ fluid: 'both', oil: { field: 6, si: 1 }, gas: { field: 0.07, si: 2 } });
    expect(cardVolume({ fluid: 'Ninguno', ooipSi: null, ooipField: null, ogipSi: null, ogipField: null })).toBeNull();
    expect(cardVolume(undefined)).toBeNull();
  });

  it('sin tablas (todavía no hay resultado): el bruto sale de la zona y lo demás queda sin dato', () => {
    const c = buildZoneCards(zones, null, null)[0]!;
    expect(c).toMatchObject({ name: 'A', gross: 67, netRes: null, netPay: null, phiPay: null, swPay: null, volume: null, fluid: null, light: 'nodata' });
  });

  it('una zona sin fila en el sumario (zona nueva sin recalcular) queda sin dato', () => {
    const c = buildZoneCards([...zones, { id: 'z4', name: 'D', color: '#000', kind: 'reservoir', top: 7800, base: 7850 }], summary, vols)[3]!;
    expect(c.light).toBe('nodata');
    expect(c.gross).toBe(50);
  });
});

describe('minigráficos', () => {
  const depth = Float64Array.from({ length: 11 }, (_, i) => 1000 + i); // 1000…1010
  const values = Float64Array.from([0.1, 0.1, 0.2, 0.2, NaN, NaN, 0.3, 0.3, 0.4, 0.4, 0.5]);

  it('sparkSeries: promedio por franja dentro de la zona, NaN donde no hay dato', () => {
    const s = sparkSeries(depth, values, 1000, 1008, 4);
    // franjas de 2 m: [1000,1002) → 0,1 · [1002,1004) → 0,2 · [1004,1006) → sin dato · [1006,1008) → 0,3 ; la base (1008) cae en la última
    expect(s.v[0]).toBeCloseTo(0.1);
    expect(s.v[1]).toBeCloseTo(0.2);
    expect(s.v[2]).toBeNaN();
    expect(s.v[3]).toBeCloseTo((0.3 + 0.3 + 0.4) / 3);
    expect([...s.y]).toEqual([0.125, 0.375, 0.625, 0.875]);
  });

  it('sparkSeries: ignora lo que está fuera de la zona y devuelve todo NaN si no hay datos o la zona es inválida', () => {
    expect(sparkSeries(depth, values, 2000, 2010, 4).v.every(Number.isNaN)).toBe(true);
    expect(sparkSeries(depth, values, 1005, 1005, 4).v.every(Number.isNaN)).toBe(true);
    const only = sparkSeries(depth, values, 1008, 1010, 2);
    expect(only.v[0]).toBeCloseTo(0.4);
    expect(only.v[1]).toBeCloseTo(0.45); // la base (1010) cae en la última franja
  });

  it('sparkPaths: x según la escala (normal e invertida) y el trazo se corta en los vacíos', () => {
    const series = { y: Float64Array.from([0.25, 0.75]), v: Float64Array.from([0.1, 0.3]) };
    const normal = sparkPaths(series, { min: 0, max: 0.4, reversed: false }, 40, 100, 'left');
    expect(normal.line).toBe('M10 25L30 75');
    expect(normal.area).toBe('M0 25L10 25L30 75L0 75Z');
    const rev = sparkPaths(series, { min: 0, max: 0.4, reversed: true }, 40, 100, 'right');
    expect(rev.line).toBe('M30 25L10 75');
    expect(rev.area).toBe('M40 25L30 25L10 75L40 75Z');
    const gap = sparkPaths({ y: Float64Array.from([0.1, 0.5, 0.9]), v: Float64Array.from([0.1, NaN, 0.3]) }, { min: 0, max: 0.4, reversed: false }, 40, 100, 'left');
    expect(gap.line).toBe('M10 10M30 90');
  });

  it('sparkPaths: valores fuera de escala se acotan al recuadro; sin datos, trazos vacíos', () => {
    const p = sparkPaths({ y: Float64Array.from([0.5]), v: Float64Array.from([9]) }, { min: 0, max: 1, reversed: false }, 40, 100, 'left');
    expect(p.line).toBe('M40 50');
    const empty = sparkPaths({ y: Float64Array.from([0.5]), v: Float64Array.from([NaN]) }, { min: 0, max: 1, reversed: false }, 40, 100, 'left');
    expect(empty).toEqual({ line: '', area: '' });
  });

  it('escala de φ: percentil 99 redondeado hacia arriba (mínimo 0,1)', () => {
    expect(niceCeil(0.27)).toBe(0.3);
    expect(niceCeil(0.3)).toBe(0.3);
    expect(niceCeil(0.31)).toBe(0.4);
    expect(niceCeil(0)).toBe(1);
    expect(porosityScaleMax(Float64Array.from({ length: 200 }, (_, i) => i / 1000))).toBe(0.2);
    expect(porosityScaleMax(Float64Array.from([0.01, 0.02]))).toBe(0.1);
    expect(porosityScaleMax(Float64Array.from([NaN]))).toBe(0.4);
  });
});
