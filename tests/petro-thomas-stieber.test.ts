/**
 * Diagrama de Thomas y Stieber (1975) (docs/decisiones/0061; Clase 8, slide 14). Valores de control calculados a mano
 * FUERA del código con φsand = 0,30 y φsh = 0,10:
 *   laminada en x = 0,5                  → 0,5·0,30 + 0,5·0,10 = 0,20
 *   dispersa (relleno) en x = 0,1        → 0,30 − 0,1·0,90 = 0,21
 *   vértice inferior                     → (0,30; 0,30·0,10) = (0,30; 0,03)
 *   vértice superior                     → (0,70; 0,30 + 0,70·0,10) = (0,70; 0,37)
 *   estructural (relleno) en x = 0,85    → 1 − 0,85·0,90 = 0,235
 *   dispersa (reemplazo) en x = 0,6      → 0,6·0,10 = 0,06
 *   estructural (reemplazo) en x = 0,5   → 0,30 + 0,05 = 0,35
 */
import { describe, expect, it } from 'vitest';
import {
  CLAY_DISTRIBUTION_CODE, classifyClayDistribution, clayDistributionSummary, countClayDistribution, dispersedGrainReplacingPhi, dispersedPoreFillingPhi, dispersedVertex,
  estimateClayEndpoints, laminatedPhi, lowerBoundPhi, structuralGrainReplacingPhi, structuralPoreFillingPhi, structuralVertex, thomasStieberGeometry, upperBoundPhi, validEndpoints,
} from '../src/petro/clayDistribution';

const S = 0.3;
const H = 0.1;

describe('rectas y vértices contra los valores de control', () => {
  it('laminada, dispersa y estructural', () => {
    expect(laminatedPhi(0.5, S, H)).toBeCloseTo(0.2, 12);
    expect(laminatedPhi(0, S, H)).toBeCloseTo(0.3, 12);
    expect(laminatedPhi(1, S, H)).toBeCloseTo(0.1, 12);
    expect(dispersedPoreFillingPhi(0.1, S, H)).toBeCloseTo(0.21, 12);
    expect(dispersedGrainReplacingPhi(0.6, S, H)).toBeCloseTo(0.06, 12);
    expect(structuralGrainReplacingPhi(0.5, S, H)).toBeCloseTo(0.35, 12);
    expect(structuralPoreFillingPhi(0.85, S, H)).toBeCloseTo(0.235, 12);
  });
  it('vértices', () => {
    const lo = dispersedVertex(S, H)!;
    const up = structuralVertex(S, H)!;
    expect(lo.x).toBeCloseTo(0.3, 12);
    expect(lo.y).toBeCloseTo(0.03, 12);
    expect(up.x).toBeCloseTo(0.7, 12);
    expect(up.y).toBeCloseTo(0.37, 12);
    // Las dos ramas de cada región se encuentran en su vértice.
    expect(dispersedPoreFillingPhi(0.3, S, H)).toBeCloseTo(dispersedGrainReplacingPhi(0.3, S, H), 12);
    expect(structuralGrainReplacingPhi(0.7, S, H)).toBeCloseTo(structuralPoreFillingPhi(0.7, S, H), 12);
    // Y todas terminan en la lutita.
    expect(dispersedGrainReplacingPhi(1, S, H)).toBeCloseTo(0.1, 12);
    expect(structuralPoreFillingPhi(1, S, H)).toBeCloseTo(0.1, 12);
  });
  it('bordes inferior y superior por tramos', () => {
    expect(lowerBoundPhi(0.1, S, H)).toBeCloseTo(0.21, 12);
    expect(lowerBoundPhi(0.6, S, H)).toBeCloseTo(0.06, 12);
    expect(upperBoundPhi(0.5, S, H)).toBeCloseTo(0.35, 12);
    expect(upperBoundPhi(0.85, S, H)).toBeCloseTo(0.235, 12);
  });
  it('geometría completa: regiones A y B', () => {
    const g = thomasStieberGeometry(S, H)!;
    expect(g.regionA[1]![0]).toBeCloseTo(0.3, 12);
    expect(g.regionA[1]![1]).toBeCloseTo(0.03, 12);
    expect(g.regionB[1]![0]).toBeCloseTo(0.7, 12);
    expect(g.regionB[1]![1]).toBeCloseTo(0.37, 12);
    expect(g.laminated).toEqual({ x: [0, 1], y: [0.3, 0.1] });
  });
  it('fuera de dominio: NaN o null, sin excepciones', () => {
    expect(validEndpoints(0.3, 0.1)).toBe(true);
    expect(validEndpoints(0.1, 0.3)).toBe(false);
    expect(validEndpoints(0.3, 0)).toBe(false);
    expect(validEndpoints(1, 0.1)).toBe(false);
    expect(validEndpoints(NaN, 0.1)).toBe(false);
    expect(laminatedPhi(0.5, 0.1, 0.3)).toBeNaN();
    expect(laminatedPhi(1.2, S, H)).toBeNaN();
    expect(dispersedPoreFillingPhi(0.5, S, H)).toBeNaN(); // pasado el vértice inferior
    expect(dispersedGrainReplacingPhi(0.2, S, H)).toBeNaN();
    expect(structuralGrainReplacingPhi(0.8, S, H)).toBeNaN();
    expect(structuralPoreFillingPhi(0.5, S, H)).toBeNaN();
    expect(dispersedVertex(0.1, 0.3)).toBeNull();
    expect(thomasStieberGeometry(0.2, 0.2)).toBeNull();
  });
});

describe('clasificación por muestra', () => {
  const k = (v: number, f: number, tol = 0.02) => classifyClayDistribution(v, f, S, H, tol);
  it('un punto en cada región y en la banda laminar', () => {
    expect(k(0.5, 0.2).kind).toBe('laminated');
    expect(k(0.5, 0.219).kind).toBe('laminated');
    expect(k(0.5, 0.181).kind).toBe('laminated');
    expect(k(0.5, 0.1).kind).toBe('dispersed');
    expect(k(0.5, 0.3).kind).toBe('structural');
  });
  it('fuera del diagrama, arena limpia, lutita y sin dato', () => {
    expect(k(0.5, 0.4)).toEqual({ kind: 'unclassified', reason: 'outside' });
    expect(k(0.5, 0.02)).toEqual({ kind: 'unclassified', reason: 'outside' });
    expect(k(0.05, 0.3)).toEqual({ kind: 'unclassified', reason: 'clean-sand' });
    expect(k(0.95, 0.1)).toEqual({ kind: 'unclassified', reason: 'shale' });
    expect(k(1.2, 0.1)).toEqual({ kind: 'unclassified', reason: 'outside' });
    expect(k(NaN, 0.1)).toEqual({ kind: 'unclassified', reason: 'no-data' });
    expect(k(0.5, NaN)).toEqual({ kind: 'unclassified', reason: 'no-data' });
    expect(classifyClayDistribution(0.5, 0.2, 0.1, 0.3)).toEqual({ kind: 'unclassified', reason: 'invalid-endpoints' });
  });
  it('bordes: Vsh = 0,1 y 0,9 se clasifican; la tolerancia también vale fuera de los bordes', () => {
    expect(k(0.1, 0.28).kind).toBe('laminated'); // laminada en 0,1 = 0,28
    expect(k(0.9, 0.12).kind).toBe('laminated'); // laminada en 0,9 = 0,12
    // Un poco debajo del borde inferior (0,05 en x = 0,5) pero dentro de la tolerancia: dispersa.
    expect(k(0.5, 0.035).kind).toBe('dispersed');
    // Encima del borde superior (0,35) dentro de la tolerancia: estructural.
    expect(k(0.5, 0.365).kind).toBe('structural');
    // Con tolerancia 0,05 el punto (0,5; 0,24) pasa a la banda laminar.
    expect(k(0.5, 0.24).kind).toBe('structural');
    expect(k(0.5, 0.24, 0.05).kind).toBe('laminated');
  });
  it('códigos de la curva', () => {
    expect(CLAY_DISTRIBUTION_CODE).toEqual({ unclassified: 0, laminated: 1, dispersed: 2, structural: 3 });
  });
  it('conteo y resumen de una nube', () => {
    const vsh = [0.5, 0.5, 0.5, 0.4, 0.5, 0.05, NaN];
    const phi = [0.1, 0.12, 0.2, 0.08, 0.3, 0.3, 0.2];
    const c = countClayDistribution(vsh, phi, S, H);
    expect(c).toEqual({ laminated: 1, dispersed: 3, structural: 1, unclassified: 1, total: 6 });
    const s = clayDistributionSummary(c)!;
    expect(s.dominant).toBe('dispersed');
    expect(s.pct.dispersed).toBeCloseTo(60, 9);
    expect(s.text).toBe('60 % bajo la diagonal: predomina arcilla dispersa');
    expect(clayDistributionSummary({ laminated: 0, dispersed: 0, structural: 0, unclassified: 3, total: 3 })).toBeNull();
  });
});

describe('estimación de los extremos', () => {
  // 21 arenas limpias (Vsh 0,05) con PHIT 0,20…0,30 cada 0,005 → percentil 95 = índice 19 = 0,295.
  // 11 lutitas (Vsh 0,95) con PHIT 0,05…0,15 cada 0,01 → mediana 0,10. Muestras intermedias no cuentan.
  const sandPhi = Array.from({ length: 21 }, (_, i) => 0.2 + 0.005 * i);
  const shalePhi = Array.from({ length: 11 }, (_, i) => 0.05 + 0.01 * i);
  const vsh = [...sandPhi.map(() => 0.05), ...shalePhi.map(() => 0.95), 0.5, 0.5, NaN];
  const phit = [...sandPhi, ...shalePhi, 0.4, 0.01, 0.2];
  it('extremos conocidos', () => {
    const e = estimateClayEndpoints(vsh, phit);
    expect(e.phiSand).toBeCloseTo(0.295, 12);
    expect(e.phiShale).toBeCloseTo(0.1, 12);
    expect(e.nSand).toBe(21);
    expect(e.nShale).toBe(11);
    expect(e.problem).toBeNull();
  });
  it('sin muestras suficientes de un extremo: null y el motivo', () => {
    const e = estimateClayEndpoints(vsh.slice(0, 21), phit.slice(0, 21));
    expect(e.phiSand).toBeCloseTo(0.295, 12);
    expect(e.phiShale).toBeNull();
    expect(e.problem).toMatch(/0 muestras de lutita/);
    const few = estimateClayEndpoints([0.05, 0.05], [0.2, 0.25]);
    expect(few.phiSand).toBeNull();
    expect(few.problem).toMatch(/2 muestras de arena limpia/);
  });
  it('φsh no menor que φsand: el par se informa como problema', () => {
    const e = estimateClayEndpoints([...Array(10).fill(0.05), ...Array(10).fill(0.95)], [...Array(10).fill(0.1), ...Array(10).fill(0.2)]);
    expect(e.problem).toMatch(/no queda por debajo/);
  });
});
