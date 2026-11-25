/**
 * G05 — Exceso de presión (P − [P₀ + ρ_ref·g·(z − z₀)]), EMW (datum z = 0), proyección exacta de gradientes y
 * diagnóstico zonal de compartimentalización en MDT (docs/decisiones/0089-exceso-de-presion-y-emw-en-mdt.md).
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation } from '../src/core/interpretation';
import { createPointSet } from '../src/core/pointSets';
import { defaultRoleCatalog } from '../src/core/roles';
import { addPointSet, setPointDecision, setPointSetDepthShift } from '../src/core/state/pointSets';
import { addWell, createProject, getWellEntry, setOverlaySetting, type Project } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { convert, parseUnit, unitLabel } from '../src/core/units';
import { createWell, type Curve } from '../src/core/well';
import { SvgContext2D, templateById, withSvgPath2D } from '../src/io/export/figures';
import {
  APPARENT_DENSITY_COMPARTMENT_LIMIT,
  G_PER_CM3_PER_LB_GAL,
  LB_GAL_PER_G_CM3,
  PSI_PER_M_PER_G_CM3,
  densityFromPsiPerFt,
  densityToLbPerGal,
  equivalentMudWeight,
  equivalentMudWeightArray,
  excessPressure,
  excessPressureArray,
  isApparentDensityNonPhysical,
  isCompartmentalizedDensity,
  lbPerGalToDensity,
  pressureFromEmw,
  pressureFromExcess,
  projectLinearTrendToExcess,
  psiPerMFromDensity,
  referencePressureAt,
} from '../src/petro/pressure';
import {
  G_STANDARD,
  densityToPressureGradientInUnit,
  pressureGradientToDensityFromUnit,
} from '../src/petro/gradients';
import { evalTrend, intersectTrends, type TrendCoefficients } from '../src/petro/regression';
import { addExample, examplePressureSet } from '../src/modules/mdt/example';
import { drawdownScale } from '../src/modules/mdt/draw';
import {
  MDT_OVERLAY_ID,
  contactPressurePsi,
  mdtAxisValue,
  mdtPressureFromAxisValue,
  parseMdtAxisSettings,
  resolveExcessRef,
  summarizeMdtZones,
} from '../src/modules/mdt/model';
import { mdtTrackState, overlays as mdtOverlays } from '../src/modules/mdt/overlay';
import { activeWaterDensity, mdtAnalysis, mdtSeries, mdtSeriesProvider } from '../src/modules/mdt/series';
import { TP_MDT_ZONE_COLUMN, tpMdtSet } from '../src/modules/mdt/tp';
import { createTrendsOverlays } from '../src/plots/trend/overlay';
import { THEMES } from '../src/ui/tokens';
import { drawViewerFigure, layoutViewerFigure } from '../src/viewer/figure';
import { buildViewerFigure } from '../src/viewer/figureInput';
import { layoutTracks } from '../src/viewer/layout';
import type { OverlayFrame, ViewerData } from '../src/viewer/overlay';
import { overlayTracks, overlayViewport } from '../src/viewer/render';
import { resolveTracks } from '../src/viewer/resolve';
import { withOverlayTracks } from '../src/viewer/templates';
import { showRange, viewportLimits, type Viewport } from '../src/viewer/viewport';
import { zone } from './helpers';

const FT = 0.3048;

function makeTpWellProject(): Project {
  const depth = Float64Array.from({ length: 5810 }, (_, i) => 7633.26 + i * 0.1524);
  const gr: Curve = { id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.from(depth, () => 60), origin: { kind: 'measured' } };
  const w = createWell({ id: 'tp', name: 'Pozo TP', depth, curves: [gr], pointSets: [] });
  let p = addWell(createProject(), w, [
    zone('A', 7633.26, 7724.39),
    zone('B', 7724.55, 7906.05),
    zone('C', 7906.21, 7969.91),
    zone('D', 7970.06, 8246.97),
    zone('E', 8247.13, 8518.55),
  ]);
  p = addPointSet(p, 'tp', tpMdtSet('mdt-tp'));
  return p;
}

function makeExampleProject(): Project {
  const depth = Float64Array.from({ length: 801 }, (_, i) => 7900 + i * 0.5);
  const gr: Curve = { id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.from(depth, () => 55), origin: { kind: 'measured' } };
  const w = createWell({ id: 'w', name: 'Pozo', depth, curves: [gr], pointSets: [] });
  const p = addWell(createProject(), w, [zone('D', 7950, 8250)]);
  return addExample(p, 'w', { set: 'ej', trends: { gas: 'tg', oil: 'to', water: 'tw' } });
}

describe('petro/pressure y gradients: unidades, exceso de presión, proyección lineal y EMW', () => {
  it('unidad lb/gal (ppg) registrada con conversión SI exacta y alias habituales', () => {
    expect(parseUnit('ppg')).toBe('lb/gal');
    expect(parseUnit('LB/GAL')).toBe('lb/gal');
    expect(unitLabel('lb/gal')).toBe('lb/gal');
    expect(convert(1, 'g/cm3', 'lb/gal')).toBeCloseTo(LB_GAL_PER_G_CM3, 12);
    expect(convert(1, 'lb/gal', 'g/cm3')).toBeCloseTo(G_PER_CM3_PER_LB_GAL, 12);
    expect(densityToLbPerGal(1)).toBeCloseTo(8.34540445201933, 12);
    expect(lbPerGalToDensity(densityToLbPerGal(1.74))).toBeCloseTo(1.74, 12);
    // Exacto: 1 lb/gal · g · 1 ft = 12/231 psi/ft ≈ 0,05194805 psi/ft
    expect(G_PER_CM3_PER_LB_GAL * PSI_PER_M_PER_G_CM3 * FT).toBeCloseTo(12 / 231, 12);
  });

  it('densityToPressureGradientInUnit ↔ pressureGradientToDensityFromUnit en psi, bar, kPa y kgf/cm2', () => {
    for (const unit of ['psi', 'bar', 'kPa', 'kgf/cm2'] as const) {
      const grad = densityToPressureGradientInUnit(1.07, unit);
      expect(pressureGradientToDensityFromUnit(grad, unit)).toBeCloseTo(1.07, 12);
    }
    expect(densityToPressureGradientInUnit(1, 'kPa')).toBeCloseTo(G_STANDARD, 12);
    expect(densityToPressureGradientInUnit(1, 'psi')).toBeCloseTo(PSI_PER_M_PER_G_CM3, 12);
    expect(densityToPressureGradientInUnit(1, 'g/cm3')).toBeNaN();
    expect(pressureGradientToDensityFromUnit(1, 'g/cm3')).toBeNaN();
    expect(densityToPressureGradientInUnit(NaN, 'psi')).toBeNaN();
    expect(pressureGradientToDensityFromUnit(Infinity, 'psi')).toBeNaN();
  });

  it('exceso de presión: fórmula analítica, ida/vuelta, acuífero constante e inmutabilidad', () => {
    const ref = { rhoRef: 1.0, z0: 2000, p0: 2850, pressureUnit: 'psi' as const };
    // Columna de agua dulce ρ = 1,00 g/cm³ que pasa por (2000 m, 2850 psi): exceso = 0 en toda la columna
    for (const z of [1800, 2000, 2250, 3000]) {
      const p = referencePressureAt(z, ref);
      expect(excessPressure(p, z, ref)).toBeCloseTo(0, 12);
      expect(pressureFromExcess(0, z, ref)).toBeCloseTo(p, 12);
    }
    // Sobrepresión de +350 psi sobre la columna de referencia
    const z = 2400;
    const p = referencePressureAt(z, ref) + 350;
    expect(excessPressure(p, z, ref)).toBeCloseTo(350, 10);
    expect(pressureFromExcess(350, z, ref)).toBeCloseTo(p, 10);

    // En bar: 1,07 g/cm³ → 1,07 · 9,80665 / 100 bar/m
    const refBar = { rhoRef: 1.07, z0: 0, p0: 0, pressureUnit: 'bar' as const };
    const pBar = 1.07 * (G_STANDARD / 100) * 1500 + 25;
    expect(excessPressure(pBar, 1500, refBar)).toBeCloseTo(25, 11);

    // Arreglo: no muta entradas y maneja bordes
    const zs = Float64Array.of(2000, 2100, NaN, 2200);
    const ps = Float64Array.of(2850, 2850 + psiPerMFromDensity(1.0) * 100 + 40, 3000, Infinity);
    const zSnap = Float64Array.from(zs);
    const pSnap = Float64Array.from(ps);
    const out = excessPressureArray(zs, ps, ref);
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo(40, 11);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBeNaN();
    expect(zs).toEqual(zSnap);
    expect(ps).toEqual(pSnap);

    // Bordes inválidos
    expect(excessPressure(3000, 2000, { ...ref, rhoRef: -0.1 })).toBeNaN();
    expect(excessPressure(3000, 2000, { ...ref, pressureUnit: 'g/cm3' })).toBeNaN();
    expect(excessPressure(NaN, 2000, ref)).toBeNaN();
    expect(excessPressure(3000, Infinity, ref)).toBeNaN();
  });

  it('proyección lineal a exceso: acuífero con ρ = ρ_ref queda vertical (b_ex = 0) y los contactos coinciden al submilímetro', () => {
    // Columna realista profunda: gas 0,08, petróleo 0,33, agua 0,45 psi/ft con CGP=8009 m y CAP=8086 m
    const gWater = 0.45 / FT; // psi/m
    const gOil = 0.33 / FT;
    const gGas = 0.08 / FT;
    const pFwl = 11950;
    const water: TrendCoefficients = { model: 'linear', a: pFwl - gWater * 8086, b: gWater };
    const oil: TrendCoefficients = { model: 'linear', a: pFwl - gOil * 8086, b: gOil };
    const pGoc = evalTrend(oil, 8009);
    const gas: TrendCoefficients = { model: 'linear', a: pGoc - gGas * 8009, b: gGas };

    const rhoWater = densityFromPsiPerFt(0.45);
    const refs = [
      { rhoRef: 0, z0: 0, p0: 0, pressureUnit: 'psi' as const },
      { rhoRef: 1.0, z0: 7970, p0: evalTrend(gas, 7970), pressureUnit: 'psi' as const },
      { rhoRef: 1.07, z0: 7970, p0: 0, pressureUnit: 'psi' as const },
      { rhoRef: rhoWater, z0: 8086, p0: pFwl, pressureUnit: 'psi' as const },
    ];

    const zGoc0 = intersectTrends(gas, oil)!;
    const zFwl0 = intersectTrends(oil, water)!;
    expect(zGoc0).toBeCloseTo(8009, 10);
    expect(zFwl0).toBeCloseTo(8086, 10);

    for (const ref of refs) {
      const pGas = projectLinearTrendToExcess(gas, ref)!;
      const pOil = projectLinearTrendToExcess(oil, ref)!;
      const pWater = projectLinearTrendToExcess(water, ref)!;
      const zGocEx = intersectTrends(pGas, pOil)!;
      const zFwlEx = intersectTrends(pOil, pWater)!;
      // Exactitud mucho mejor que 1 mm (1e-3 m): < 1e-6 m
      expect(Math.abs(zGocEx - zGoc0)).toBeLessThan(1e-6);
      expect(Math.abs(zFwlEx - zFwl0)).toBeLessThan(1e-6);
      // Coincidencia punto a punto entre recta proyectada y excessPressure(evalTrend)
      for (const z of [7975, 8009, 8050, 8086, 8200]) {
        expect(evalTrend(pWater, z)).toBeCloseTo(excessPressure(evalTrend(water, z), z, ref), 9);
      }
    }

    // Con ρ_ref = ρ_agua, el gradiente del agua es estrictamente vertical (pendiente 0)
    const waterVert = projectLinearTrendToExcess(water, { rhoRef: rhoWater, z0: 8086, p0: pFwl, pressureUnit: 'psi' })!;
    expect(Math.abs(waterVert.b)).toBeLessThan(1e-12);
    expect(evalTrend(waterVert, 8086)).toBeCloseTo(0, 11);
    expect(evalTrend(waterVert, 8250)).toBeCloseTo(0, 11);

    // Modelo no lineal o referencia inválida → null
    expect(projectLinearTrendToExcess({ model: 'exp', a: 100, b: 0.001 }, refs[1]!)).toBeNull();
    expect(projectLinearTrendToExcess(water, { rhoRef: -1, z0: 0, p0: 0 })).toBeNull();
  });

  it('EMW (datum z = 0): exactitud analítica, pozo del TP (~14,5 lb/gal / 1,74 g/cm³), ida/vuelta y bordes', () => {
    // Agua dulce hidrostática a 3000 m: 1,00 g/cm³ = 8,3454 lb/gal
    const pFreshKPa = 1.0 * G_STANDARD * 3000;
    expect(equivalentMudWeight(pFreshKPa, 3000, { pressureUnit: 'kPa', densityUnit: 'g/cm3' })).toBeCloseTo(1.0, 12);
    expect(equivalentMudWeight(pFreshKPa, 3000, { pressureUnit: 'kPa', densityUnit: 'lb/gal' })).toBeCloseTo(LB_GAL_PER_G_CM3, 12);

    // Relación exacta en unidades de campo: P [psi] / ((12/231) · z [ft])
    const zM = 7729.0727;
    const pPsi = 19126.47;
    const emwLb = equivalentMudWeight(pPsi, zM, { pressureUnit: 'psi', densityUnit: 'lb/gal' });
    const emwG = equivalentMudWeight(pPsi, zM, { pressureUnit: 'psi', densityUnit: 'g/cm3' });
    expect(emwLb).toBeCloseTo(pPsi / ((12 / 231) * (zM / FT)), 11);
    expect(emwLb).toBeCloseTo(14.52, 2);
    expect(emwG).toBeCloseTo(1.74, 2);
    expect(pressureFromEmw(emwLb, zM, { pressureUnit: 'psi', densityUnit: 'lb/gal' })).toBeCloseTo(pPsi, 9);
    expect(pressureFromEmw(emwG, zM, { pressureUnit: 'bar', densityUnit: 'g/cm3' })).toBeCloseTo(convert(pPsi, 'psi', 'bar'), 9);

    // Arreglo y bordes (z ≤ 0, P < 0, P = 0, NaN, ±Infinity)
    const arr = equivalentMudWeightArray(
      Float64Array.of(0, -10, 1000, 1000, 1000, NaN),
      Float64Array.of(1000, 1000, -5, 0, psiPerMFromDensity(1.5) * 1000, 1000),
      { pressureUnit: 'psi', densityUnit: 'g/cm3' },
    );
    expect(arr[0]).toBeNaN();
    expect(arr[1]).toBeNaN();
    expect(arr[2]).toBeNaN();
    expect(arr[3]).toBe(0);
    expect(arr[4]).toBeCloseTo(1.5, 12);
    expect(arr[5]).toBeNaN();
    expect(equivalentMudWeight(1000, 1000, { pressureUnit: 'g/cm3' })).toBeNaN();
    expect(pressureFromEmw(-1, 1000)).toBeNaN();
    expect(pressureFromEmw(10, 0)).toBeNaN();
  });

  it('umbral de densidad aparente no física (> 1,25 g/cm³) y compartimentalización', () => {
    expect(APPARENT_DENSITY_COMPARTMENT_LIMIT).toBe(1.25);
    expect(isCompartmentalizedDensity(1.25)).toBe(false);
    expect(isCompartmentalizedDensity(1.251)).toBe(true);
    expect(isCompartmentalizedDensity(1.69)).toBe(true);
    expect(isApparentDensityNonPhysical(0)).toBe(true);
    expect(isApparentDensityNonPhysical(-0.2)).toBe(true);
    expect(isApparentDensityNonPhysical(1.05)).toBe(false);
    expect(isApparentDensityNonPhysical(NaN)).toBe(false);
  });
});

describe('mdt/model: ajustes, referencia de exceso y resumen zonal EMW / compartimentos', () => {
  it('parseMdtAxisSettings sanea valores inválidos y conserva defaults', () => {
    expect(parseMdtAxisSettings(undefined)).toEqual({
      axisMode: 'pressure',
      unit: 'psi',
      emwUnit: 'lb/gal',
      excessRhoRef: 1,
      excessRhoSource: 'manual',
      excessZ0: null,
      excessAnchor: 'first',
    });
    expect(
      parseMdtAxisSettings({
        axisMode: 'desconocido',
        unit: 'MPa',
        emwUnit: 'kg/m3',
        excessRhoRef: -2,
        excessRhoSource: 'otra',
        excessZ0: Infinity,
        excessAnchor: 'otro',
      }),
    ).toEqual({
      axisMode: 'pressure',
      unit: 'psi',
      emwUnit: 'lb/gal',
      excessRhoRef: 1,
      excessRhoSource: 'manual',
      excessZ0: null,
      excessAnchor: 'first',
    });
  });

  it('resolveExcessRef ancla por defecto a la primera prueba incluida, respeta descartes y shift, y sigue al gradiente de agua', () => {
    const p0 = makeExampleProject();
    const e0 = getWellEntry(p0, 'w');
    const sets = e0.well.pointSets;
    const axis = parseMdtAxisSettings({ axisMode: 'excess' });
    const r0 = resolveExcessRef(sets, e0.interpretation.pointSets, axis, null);
    expect(r0.z0Auto).toBe(7971.5);
    expect(r0.ref.z0).toBe(7971.5);
    expect(r0.ref.p0).toBe((sets[0]!.columns['pressure']!.values as Float64Array)[0]);
    // Con anclaje en la primera prueba, P_ex(z0) = 0
    expect(mdtAxisValue(r0.ref.p0, r0.ref.z0, axis, r0.ref)).toBeCloseTo(0, 12);

    // Descartar la primera prueba mueve z0Auto y p0First a la segunda prueba (7977,5 m)
    const p1 = setPointDecision(p0, 'w', 'ej', 'MDT-01', { status: 'exclude' });
    const e1 = getWellEntry(p1, 'w');
    const r1 = resolveExcessRef(e1.well.pointSets, e1.interpretation.pointSets, axis, null);
    expect(r1.z0Auto).toBe(7977.5);
    expect(r1.ref.p0).toBe((sets[0]!.columns['pressure']!.values as Float64Array)[1]);

    // Shift de profundidad del conjunto se refleja en z0Auto
    const pShift = setPointSetDepthShift(p0, 'w', 'ej', 2.5);
    const eShift = getWellEntry(pShift, 'w');
    const rShift = resolveExcessRef(eShift.well.pointSets, eShift.interpretation.pointSets, axis, null);
    expect(rShift.z0Auto).toBeCloseTo(7974.0, 9);

    // Preset de gradiente de agua activo
    const waterDens = activeWaterDensity(e0.well, e0.interpretation);
    expect(waterDens).not.toBeNull();
    expect(waterDens!).toBeCloseTo(densityFromPsiPerFt(0.45), 1);
    const axisWater = parseMdtAxisSettings({ axisMode: 'excess', excessRhoSource: 'water' });
    const rWater = resolveExcessRef(sets, e0.interpretation.pointSets, axisWater, waterDens);
    expect(rWater.rhoSource).toBe('water');
    expect(rWater.ref.rhoRef).toBeCloseTo(waterDens!, 12);
    expect(rWater.hasActiveWaterFallback).toBe(false);

    // Sin gradiente de agua activo: cae al valor manual con aviso de respaldo
    const rFallback = resolveExcessRef(sets, e0.interpretation.pointSets, axisWater, null);
    expect(rFallback.rhoSource).toBe('manual');
    expect(rFallback.ref.rhoRef).toBe(1.0);
    expect(rFallback.hasActiveWaterFallback).toBe(true);

    // Inversa mdtPressureFromAxisValue en los tres modos
    for (const mode of ['pressure', 'excess', 'emw'] as const) {
      const a = parseMdtAxisSettings({ axisMode: mode, unit: 'bar', emwUnit: 'g/cm3' });
      const val = mdtAxisValue(12000, 8050, a, r0.ref);
      expect(mdtPressureFromAxisValue(val, 8050, a, r0.ref)).toBeCloseTo(12000, 8);
    }
  });

  it('pozo del TP: informa EMW medio (~14,4–14,5 lb/gal / ~1,72–1,74 g/cm³), alerta compartimentalización en Zona D (~1,69 g/cm³) y detecta salto de +55,5 psi', () => {
    const p = makeTpWellProject();
    const e = getWellEntry(p, 'tp');
    const set = e.well.pointSets[0]!;
    const rep = summarizeMdtZones(set, e.interpretation.pointSets[set.id], e.interpretation.zones, {
      rhoRef: 1.0,
      originZoneColumn: TP_MDT_ZONE_COLUMN,
    });

    expect(rep.overall.n).toBe(58);
    expect(rep.overall.overpressured).toBe(true);
    expect(rep.overall.emwMeanLbGal).toBeGreaterThan(14.3);
    expect(rep.overall.emwMeanLbGal).toBeLessThan(14.55);
    expect(rep.overall.emwMeanGCm3).toBeGreaterThan(1.71);
    expect(rep.overall.emwMeanGCm3).toBeLessThan(1.75);
    expect(rep.hasCompartmentAlert).toBe(true);

    // Solo zonas con pruebas (B, C, D)
    expect(rep.zones.map((z) => z.name)).toEqual(['B', 'C', 'D']);

    const zB = rep.zones[0]!;
    expect(zB.n).toBe(25);
    expect(zB.apparentDensityGCm3).toBeCloseTo(0.951, 2);
    expect(zB.compartmentAlert).toBe(false);
    expect(zB.emwMeanLbGal).toBeCloseTo(14.46, 1);

    const zC = rep.zones[1]!;
    expect(zC.n).toBe(2);
    expect(zC.compartmentAlert).toBe(false);

    const zD = rep.zones[2]!;
    expect(zD.n).toBe(31);
    expect(zD.apparentDensityGCm3).toBeCloseTo(1.69, 2);
    expect(zD.compartmentAlert).toBe(true);
    expect(zD.maxJump).not.toBeNull();
    // Salto principal de Zona D: MDT-39 (8070,95 m) → MDT-40 (8075,25 m), ΔP_ex ≈ +55,5 psi
    expect(zD.maxJump!.topDepth).toBeCloseTo(8070.95, 1);
    expect(zD.maxJump!.baseDepth).toBeCloseTo(8075.25, 1);
    expect(zD.maxJump!.deltaExcessPsi).toBeGreaterThan(50);
    expect(zD.maxJump!.deltaExcessPsi).toBeLessThan(60);

    // Sin zonas interpretadas: agrupa por columna de origen 'zone'
    const repOrigin = summarizeMdtZones(set, undefined, [], { rhoRef: 1.0, originZoneColumn: TP_MDT_ZONE_COLUMN });
    expect(repOrigin.zones.map((z) => ({ name: z.name, source: z.source, n: z.n }))).toEqual([
      { name: 'B', source: 'origin', n: 25 },
      { name: 'C', source: 'origin', n: 2 },
      { name: 'D', source: 'origin', n: 31 },
    ]);
  });

  it('gradiente invertido (ρ_ap ≤ 0) se señala en summarizeMdtZones', () => {
    const s = createPointSet({
      id: 'inv',
      kind: 'pressure',
      name: 'Invertida',
      depth: Float64Array.of(2000, 2020, 2040),
      pointIds: ['P1', 'P2', 'P3'],
      columns: { pressure: { label: 'P', unit: 'psi', values: Float64Array.of(3200, 3150, 3100) } },
    });
    const rep = summarizeMdtZones(s, undefined, []);
    expect(rep.zones).toHaveLength(1);
    expect(rep.zones[0]!.invertedAlert).toBe(true);
    expect(rep.zones[0]!.compartmentAlert).toBe(false);
  });
});

describe('mdt visor, proyección de rectas, persistencia y exportación de figuras', () => {
  it('alternar Presión ↔ Exceso ↔ EMW conserva exactamente mdtAnalysis y se persiste en v7', async () => {
    let p = makeExampleProject();
    const e0 = getWellEntry(p, 'w');
    const an0 = mdtAnalysis(e0.well, e0.interpretation);

    p = setOverlaySetting(p, MDT_OVERLAY_ID, 'axisMode', 'excess');
    p = setOverlaySetting(p, MDT_OVERLAY_ID, 'excessRhoSource', 'water');
    p = setOverlaySetting(p, MDT_OVERLAY_ID, 'unit', 'bar');
    const e1 = getWellEntry(p, 'w');
    expect(mdtAnalysis(e1.well, e1.interpretation)).toBe(an0);

    const json = await serializeProject(p);
    const back = await deserializeProject(json);
    expect(back.display.overlays?.[MDT_OVERLAY_ID]).toEqual({
      axisMode: 'excess',
      excessRhoSource: 'water',
      unit: 'bar',
    });
    const eBack = getWellEntry(back, 'w');
    const anBack = mdtAnalysis(eBack.well, eBack.interpretation);
    expect(anBack.contacts.map((c) => c.depth)).toEqual(an0.contacts.map((c) => c.depth));
    expect(anBack.gradients.map((g) => g.density)).toEqual(an0.gradients.map((g) => g.density));
  });

  it('en Exceso con ρ_ref = gradiente de agua, la recta del agua se dibuja vertical y los cruces caen en los contactos', () => {
    const p0 = makeExampleProject();
    const e = getWellEntry(p0, 'w');
    const settings = { mdt: { axisMode: 'excess', excessRhoSource: 'water' } };
    const layout = withOverlayTracks(
      [{ id: 'gr', title: 'GR', kind: 'curves', curves: [{ select: { role: 'GR' } }] }],
      mdtOverlays,
      'petrophysics',
      { well: e.well, interpretation: e.interpretation, settings },
    );
    const tracks = resolveTracks(layout, { depth: e.well.depth.values, curves: [...e.well.curves], computed: [], catalog: defaultRoleCatalog });
    const boxes = layoutTracks(tracks, 420).boxes;
    const ovTracks = overlayTracks(tracks, boxes);
    const mdtTrack = ovTracks.find((t) => t.overlayId === MDT_OVERLAY_ID)!;
    expect(mdtTrack.title).toMatch(/^Exceso P/);
    expect(mdtTrack.unit).toBe('psi');

    const data: ViewerData = {
      wellId: 'w',
      depth: e.well.depth.values,
      zones: [],
      selectedZoneId: null,
      qc: null,
      well: e.well,
      interpretation: e.interpretation,
      computed: [],
      overlaySettings: settings,
    };
    const an = mdtAnalysis(e.well, e.interpretation);
    const waterSeries = mdtSeriesProvider.resolve({ well: e.well, interpretation: e.interpretation, computed: [], catalog: defaultRoleCatalog }, 'ej:water')!;
    const oilSeries = mdtSeriesProvider.resolve({ well: e.well, interpretation: e.interpretation, computed: [], catalog: defaultRoleCatalog }, 'ej:oil')!;
    const tfWater = waterSeries.displayTransform!(data, mdtTrack)!;
    const tfOil = oilSeries.displayTransform!(data, mdtTrack)!;
    const waterCoeffs = an.gradients.find((g) => g.fluid === 'water')!.result!.coeffs!;
    const oilCoeffs = an.gradients.find((g) => g.fluid === 'oil')!.result!.coeffs!;

    // Acuífero vertical: mismo valor proyectado en todo el tramo de agua
    const x1 = mdtTrack.xOf(null, tfWater.toTrack(evalTrend(waterCoeffs, 8095), 8095))!;
    const x2 = mdtTrack.xOf(null, tfWater.toTrack(evalTrend(waterCoeffs, 8230), 8230))!;
    expect(Math.abs(x1 - x2)).toBeLessThan(1e-6);

    // En el contacto FWL, petróleo y agua proyectan exactamente a la misma X (píxel del rombo)
    const fwl = an.contacts.find((c) => c.kind === 'OWC')!;
    const xOilAtFwl = mdtTrack.xOf(null, tfOil.toTrack(evalTrend(oilCoeffs, fwl.depth!), fwl.depth!))!;
    const xWaterAtFwl = mdtTrack.xOf(null, tfWater.toTrack(evalTrend(waterCoeffs, fwl.depth!), fwl.depth!))!;
    expect(Math.abs(xOilAtFwl - xWaterAtFwl)).toBeLessThan(1e-6);

    // Las líneas de tendencia sobre canvas se dibujan sin errores y con trazos visibles
    const [, trendsOver] = createTrendsOverlays({
      resolve: (d, ref) => (ref.provider === 'mdt' ? mdtSeriesProvider.resolve({ well: d.well, interpretation: d.interpretation, computed: [], catalog: defaultRoleCatalog }, ref.key) : null),
      presentation: true,
    });
    const lim = viewportLimits(e.well.depth.values, 400, 0.5);
    const vp = showRange(lim, 400, 7960, 8240) as Viewport;
    const linePts: [number, number][] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'lineTo' || prop === 'moveTo') return (x: number, y: number) => linePts.push([x, y]);
        if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
        return () => {};
      },
      set(target, prop, v) {
        target[prop] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const frame: OverlayFrame = { theme: THEMES.light, viewport: overlayViewport(vp), tracks: ovTracks, data, invalidate: () => {}, active: null, ctx };
    trendsOver!.draw(frame);
    expect(linePts.length).toBeGreaterThan(6);
  });

  it('en modo EMW, la pista declara datum z = 0, cubre la sobrepresión del TP (~14,5 lb/gal), y drawdown mantiene su unidad de presión', () => {
    const p = makeTpWellProject();
    const e = getWellEntry(p, 'tp');
    const settings = { mdt: { axisMode: 'emw', unit: 'bar', pointColor: 'drawdown' } };
    const stLb = mdtTrackState(e.well.pointSets, e.interpretation, settings.mdt)!;
    expect(stLb.title).toBe('EMW (z = 0)');
    expect(stLb.unit).toBe('lb/gal');
    expect(stLb.scale.min).toBeLessThan(14.3);
    expect(stLb.scale.max).toBeGreaterThan(14.52);

    const stG = mdtTrackState(e.well.pointSets, e.interpretation, { ...settings.mdt, emwUnit: 'g/cm3' })!;
    expect(stG.unit).toBe('g/cm3');
    expect(stG.scale.min).toBeLessThan(1.71);
    expect(stG.scale.max).toBeGreaterThan(1.74);

    // La leyenda de drawdown sigue en bar aunque la pista esté en lb/gal
    const data: ViewerData = {
      wellId: 'tp',
      depth: e.well.depth.values,
      zones: [],
      selectedZoneId: null,
      qc: null,
      well: e.well,
      interpretation: e.interpretation,
      computed: [],
      overlaySettings: settings,
    };
    const mdtMain = mdtOverlays.find((o) => o.id === MDT_OVERLAY_ID)!;
    const legend = mdtMain.track!.colorLegend!(data, stLb.unit)!;
    expect(legend.title).toBe('Drawdown (bar)');
    expect(drawdownScale(data, 'bar')!.legend.title).toBe('Drawdown (bar)');
  });

  it('exportación de figura SVG refleja Exceso de presión y EMW igual que la pista', () => {
    const p = makeTpWellProject();
    const e = getWellEntry(p, 'tp');
    const measure = (_f: string, t: string) => t.length * 6;
    for (const [modeSettings, expectedTitle, expectedUnit] of [
      [{ mdt: { axisMode: 'excess', excessRhoRef: 1.07, unit: 'psi' } }, 'Exceso P (1,07)', 'psi'],
      [{ mdt: { axisMode: 'emw', emwUnit: 'g/cm3' } }, 'EMW (z = 0)', 'g/cm³'],
    ] as const) {
      const trackLayout = withOverlayTracks(
        [{ id: 'depth', title: 'Prof.', kind: 'depth' }],
        mdtOverlays,
        'petrophysics',
        { well: e.well, interpretation: e.interpretation, settings: modeSettings },
      );
      const tracks = resolveTracks(trackLayout, { depth: e.well.depth.values, curves: [...e.well.curves], computed: [], catalog: defaultRoleCatalog });
      const data: ViewerData = {
        wellId: 'tp',
        depth: e.well.depth.values,
        zones: e.interpretation.zones.map((z) => ({ id: z.id, name: z.name, top: z.top, base: z.base, color: z.color })),
        selectedZoneId: null,
        qc: null,
        well: e.well,
        interpretation: e.interpretation,
        computed: [],
        overlaySettings: modeSettings,
      };
      const template = templateById('profile-full');
      const input = buildViewerFigure(
        {
          template,
          range: { kind: 'zone', zoneId: 'D' },
          verticalScale: 1000,
          widthCm: template.widthCm,
          marginCm: template.marginCm,
          trackIds: null,
        },
        {
          well: e.well,
          tracks,
          depth: e.well.depth.values,
          data,
          overlays: mdtOverlays,
          zones: data.zones,
          summary: null,
          stackHints: {},
          date: new Date('2026-11-25T12:00:00Z'),
          measure,
        },
      );
      const figLayout = layoutViewerFigure(input);
      const svg = new SvgContext2D({ width: figLayout.width, height: figLayout.height, measure, title: input.title });
      withSvgPath2D(() => drawViewerFigure(svg.asCanvas(), input, figLayout));
      const xml = svg.toSvg('#ffffff');
      expect(xml).toContain(expectedTitle);
      expect(xml).toContain(expectedUnit);
    }
  });
});

describe('mdt: borde con profundidades ≤ 0 en EMW', () => {
  it('no falla ni oculta la pista si todos los puntos tienen z ≤ 0', () => {
    const s = createPointSet({
      id: 'z0',
      kind: 'pressure',
      name: 'Superficie',
      depth: Float64Array.of(0, -5),
      pointIds: ['A', 'B'],
      columns: { pressure: { label: 'P', unit: 'psi', values: Float64Array.of(15, 20) } },
    });
    const st = mdtTrackState([s], emptyInterpretation(), { axisMode: 'emw', emwUnit: 'lb/gal' })!;
    expect(st.title).toBe('EMW (z = 0)');
    expect(st.scale.min).toBe(0);
    expect(st.scale.max).toBe(20);
    // Ejemplo sintético sigue generando sus 21 puntos sin alterar originales
    const ex = examplePressureSet('e');
    expect(ex.pointIds).toHaveLength(21);
  });

  it('regresión revisión: conjuntos en bar/kPa alinean rombo y tooltip de contacto con las rectas en Presión, Exceso y EMW', () => {
    const baseProj = makeExampleProject();
    const baseEntry = getWellEntry(baseProj, 'w');
    const anPsi = mdtAnalysis(baseEntry.well, baseEntry.interpretation);
    const fwlPsi = anPsi.contacts.find((c) => c.kind === 'OWC')!;
    const cases: readonly Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>[] = [
      { mdt: { axisMode: 'pressure', unit: 'psi' } },
      { mdt: { axisMode: 'excess', excessRhoSource: 'water', unit: 'psi' } },
      { mdt: { axisMode: 'emw', emwUnit: 'lb/gal' } },
    ];
    for (const pUnit of ['bar', 'kPa'] as const) {
      const base = examplePressureSet('ej');
      const psiVals = base.columns['pressure']!.values as Float64Array;
      const converted = Float64Array.from(psiVals, (v) => convert(v, 'psi', pUnit));
      const setUnit = createPointSet({
        id: 'ej',
        kind: 'pressure',
        name: `MDT (${pUnit})`,
        depth: base.depth,
        pointIds: base.pointIds,
        columns: { ...base.columns, pressure: { label: 'Presión', unit: pUnit, values: converted } },
      });
      const well = createWell({ id: 'w', name: 'W', depth: baseEntry.well.depth.values, curves: [...baseEntry.well.curves], pointSets: [setUnit] });
      const an = mdtAnalysis(well, baseEntry.interpretation);
      const fwl = an.contacts.find((c) => c.kind === 'OWC')!;
      expect(fwl.pressureUnit).toBe(pUnit);
      expect(contactPressurePsi(fwl)).toBeCloseTo(fwlPsi.pressure!, 8);

      for (const settings of cases) {
        const trackLayout = withOverlayTracks([{ id: 'depth', title: 'Prof.', kind: 'depth' }], mdtOverlays, 'petrophysics', { well, interpretation: baseEntry.interpretation, settings });
        const tracks = resolveTracks(trackLayout, { depth: well.depth.values, curves: [...well.curves], computed: [], catalog: defaultRoleCatalog });
        const boxes = layoutTracks(tracks, 420).boxes;
        const ovTracks = overlayTracks(tracks, boxes);
        const mdtTrack = ovTracks.find((t) => t.overlayId === MDT_OVERLAY_ID)!;
        const data: ViewerData = { wellId: 'w', depth: well.depth.values, zones: [], selectedZoneId: null, qc: null, well, interpretation: baseEntry.interpretation, computed: [], overlaySettings: settings };
        const waterSeries = mdtSeriesProvider.resolve({ well, interpretation: baseEntry.interpretation, computed: [], catalog: defaultRoleCatalog }, 'ej:water')!;
        const tf = waterSeries.displayTransform?.(data, mdtTrack);
        const waterCoeffs = an.gradients.find((g) => g.fluid === 'water')!.result!.coeffs!;
        const axis = parseMdtAxisSettings(settings['mdt']);
        const exRef = resolveExcessRef([setUnit], baseEntry.interpretation.pointSets, axis, activeWaterDensity(well, baseEntry.interpretation)).ref;
        const diamondX = mdtTrack.xOf(null, mdtAxisValue(contactPressurePsi(fwl), fwl.depth!, axis, exRef))!;
        const lineVal = evalTrend(waterCoeffs, fwl.depth!);
        const lineTrackVal = tf ? tf.toTrack(lineVal, fwl.depth!) : convert(lineVal, pUnit, axis.unit);
        const lineX = mdtTrack.xOf(null, lineTrackVal)!;
        expect(Math.abs(diamondX - lineX), `${pUnit}/${axis.axisMode}`).toBeLessThan(1e-6);

        // Tooltip de contacto muestra presión real (~11.955 psi) y EMW (~8,66 lb/gal)
        const mainOv = mdtOverlays.find((o) => o.id === MDT_OVERLAY_ID)!;
        const lim = viewportLimits(well.depth.values, 400, 0.5);
        const vp = showRange(lim, 400, 7960, 8240) as Viewport;
        const ovVp = overlayViewport(vp);
        const hit = mainOv.hit!(
          { theme: THEMES.light, viewport: ovVp, tracks: ovTracks, data, invalidate: () => {}, active: null },
          { x: mdtTrack.x + 10, y: ovVp.yOf(fwl.depth!), depth: fwl.depth!, track: mdtTrack },
        )!;
        expect(hit.label).toMatch(/11\.9\d\d/);
        if (axis.axisMode === 'emw') expect(hit.label).toMatch(/8,6\d lb\/gal/);
      }
    }
  });

  it('regresión revisión: unidad de presión no convertible ("unitless") no lanza excepción en mdtSeries', () => {
    const s = createPointSet({
      id: 'u',
      kind: 'pressure',
      name: 'Sin unidad',
      depth: Float64Array.of(2000, 2050, 2100),
      pointIds: ['A', 'B', 'C'],
      columns: { pressure: { label: 'P', unit: 'unitless', values: Float64Array.of(2900, 2970, 3040) } },
    });
    expect(() => mdtSeries(s, emptyInterpretation(), null)).not.toThrow();
    const series = mdtSeries(s, emptyInterpretation(), null)!;
    expect(series.x.length).toBe(3);
  });

  it('regresión revisión: z0 personalizado con anchor="first" proyecta P0 para mantener P_ex(z0Auto) = 0, y n ≥ 3 a igual profundidad deja densidad NaN', () => {
    const p = makeTpWellProject();
    const e = getWellEntry(p, 'tp');
    const axis = parseMdtAxisSettings({ axisMode: 'excess', excessZ0: 0, excessAnchor: 'first' });
    const res = resolveExcessRef(e.well.pointSets, e.interpretation.pointSets, axis, null);
    expect(res.z0Auto).not.toBeNull();
    expect(res.p0First).not.toBeNull();
    expect(mdtAxisValue(res.p0First!, res.z0Auto!, axis, res.ref)).toBeCloseTo(0, 9);

    // n ≥ 3 pruebas a la misma profundidad → sin ajuste (apparentDensityGCm3 NaN)
    const flat = createPointSet({
      id: 'flat',
      kind: 'pressure',
      name: 'Misma cota',
      depth: Float64Array.of(2500, 2500, 2500),
      pointIds: ['P1', 'P2', 'P3'],
      columns: { pressure: { label: 'P', unit: 'psi', values: Float64Array.of(3500, 3505, 3510) } },
    });
    const rep = summarizeMdtZones(flat, undefined, []);
    expect(rep.zones).toHaveLength(1);
    expect(rep.zones[0]!.n).toBe(3);
    expect(rep.zones[0]!.apparentDensityGCm3).toBeNaN();
    expect(rep.zones[0]!.compartmentAlert).toBe(false);
    expect(rep.zones[0]!.invertedAlert).toBe(false);
  });
});
