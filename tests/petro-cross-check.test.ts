import { describe, expect, it } from 'vitest';
import {
  CROSS_CHECK_THRESHOLDS,
  evaluateCrossCheck,
  medianOf,
  quantileOf,
  scalPdKgCm2ToLabPsi,
  worstCrossCheckStatus,
  type CrossCheckInput,
} from '../src/petro/crossCheck';
import { entryHeightM, SYSTEM_GAS_WATER, SYSTEM_HG_AIR, SYSTEM_OIL_WATER } from '../src/petro/micp';
import { KGF_CM2_TO_PSI } from '../src/petro/rockTyping';

function makeDepth(n: number, start = 1000, step = 1): Float64Array {
  return Float64Array.from({ length: n }, (_, i) => start + i * step);
}

function filled(n: number, value: number): Float64Array {
  return new Float64Array(n).fill(value);
}

describe('petro/crossCheck: utilidades y casos base', () => {
  it('calcula mediana y cuantiles ignorando NaN e infinitos y sin mutar la entrada', () => {
    const raw = [5, NaN, 1, Infinity, 3, 2, -Infinity, 4];
    const copy = [...raw];
    expect(medianOf(raw)).toBe(3);
    expect(quantileOf(raw, 0.9)).toBeCloseTo(4.6, 12);
    expect(medianOf([2, 4])).toBe(3);
    expect(Number.isNaN(medianOf([NaN, Infinity]))).toBe(true);
    expect(raw).toEqual(copy);
  });

  it('ordena severidad de estados y nunca oculta chequeos sin soporte', () => {
    expect(worstCrossCheckStatus(['unsupported', 'ok'])).toBe('ok');
    expect(worstCrossCheckStatus(['ok', 'warn', 'unsupported'])).toBe('warn');
    expect(worstCrossCheckStatus(['warn', 'tension', 'ok'])).toBe('tension');
    expect(worstCrossCheckStatus(['unsupported'])).toBe('unsupported');

    const report = evaluateCrossCheck({
      depth: makeDepth(20, 1000, 1),
      zones: [{ id: 'z1', name: 'A', top: 1000, base: 1019 }],
      curves: {},
    });
    expect(report.zones).toHaveLength(1);
    for (const item of Object.values(report.zones[0]!.checks)) {
      expect(item.status).toBe('unsupported');
    }
    expect(report.seal.status).toBe('unsupported');
    expect(report.overallStatus).toBe('unsupported');
    expect(report.counts.unsupported).toBe(7);
  });
});

describe('petro/crossCheck: escenario sintético de acuerdo integral', () => {
  it('marca acuerdo en todos los chequeos cuando las herramientas son físicamente consistentes', () => {
    const n = 40;
    const depth = makeDepth(n, 2000, 1); // 2000..2039 m; contacto OWC en 2025 m
    const netRes = filled(n, 1);
    const netPay = Float64Array.from({ length: n }, (_, i) => (depth[i]! < 2024 ? 1 : 0));
    const sw = Float64Array.from({ length: n }, (_, i) => (depth[i]! < 2024 ? 0.3 : 0.95));
    const swi = filled(n, 0.28);
    const phie = filled(n, 0.2);
    const phieNmr = filled(n, 0.195);
    const bvw = Float64Array.from({ length: n }, (_, i) => phie[i]! * sw[i]!); // 0.06 en pay, 0.19 abajo -> mediana en z1 (2000..2020) = 0.06
    const bviNmr = filled(n, 0.058); // ~ phie * swi = 0.056
    const indWashout = filled(n, 0);
    const indNmrDeficit = filled(n, 0);
    const uGrFrac = filled(n, 0.08);
    const mos = Float64Array.from({ length: n }, (_, i) => (depth[i]! < 2024 ? 0.35 : 0)); // MOS/Sh = 0.35/0.70 = 50 %
    const mhi = Float64Array.from({ length: n }, (_, i) => (depth[i]! < 2024 ? 0.46 : 1));

    const sealCtx = { lab: SYSTEM_HG_AIR, reservoir: SYSTEM_OIL_WATER, deltaRhoGcc: 0.25 };
    const pdSeal = 400; // psi Hg -> h_max ~ 79.8 m > 1.2 * 25 m
    const report = evaluateCrossCheck({
      depth,
      zones: [
        { id: 'res', name: 'Arena 1', top: 2000, base: 2023, kind: 'reservoir' },
        { id: 'water', name: 'Acuífero', top: 2026, base: 2039, kind: 'reservoir' },
      ],
      curves: { sw, swi, bvw, bviNmr, phie, phieNmr, netRes, netPay, indWashout, indNmrDeficit, uGrFrac, mos, mhi },
      corePlugs: [
        { depthM: 2005, phiCore: 0.198, phiLog: 0.201 },
        { depthM: 2012, phiCore: 0.205, phiLog: 0.2 },
      ],
      waterContacts: [{ kind: 'OWC', depthM: 2025, spanTopM: 2000, spanBaseM: 2039 }],
      sealSamples: [{ id: 's1', label: 'Sello-1', depthM: 1995, pdLabPsi: pdSeal, source: 'micp', isSeal: true, zoneName: 'Sello' }],
      sealAssumptions: { systemLabel: 'Petróleo–agua', heightContext: sealCtx, rhoWaterGcc: 1.05, rhoHcGcc: 0.8 },
      observedColumnM: 25,
      columnBasis: 'tope de pay a OWC',
    });

    const zRes = report.zones[0]!;
    expect(zRes.checks['sw-vs-swi'].status).toBe('ok');
    expect(zRes.checks['bound-water'].status).toBe('ok');
    expect(zRes.checks.porosity.status).toBe('ok');
    expect(zRes.checks['mdt-vs-sw'].status).toBe('ok');
    expect(zRes.checks['uranium-gr'].status).toBe('ok');
    expect(zRes.checks['hc-movability'].status).toBe('ok');
    expect(report.seal.status).toBe('ok');
    expect(report.seal.metrics.hMaxM).toBeCloseTo(entryHeightM(pdSeal, sealCtx), 8);
    expect(report.overallStatus).toBe('ok');
  });
});

describe('petro/crossCheck: tensión Archie Sw < Swi', () => {
  it('clasifica < 5 % verde, 5–20 % amarillo y > 20 % rojo y apunta al tramo crítico', () => {
    const n = 20;
    const depth = makeDepth(n, 3000, 1);
    const run = (nBelow: number) => {
      const sw = Float64Array.from({ length: n }, (_, i) => (i < nBelow ? 0.15 : 0.35));
      const swi = filled(n, 0.3);
      return evaluateCrossCheck({
        depth,
        zones: [{ id: 'z', name: 'B', top: 3000, base: 3019 }],
        curves: { sw, swi, netPay: filled(n, 1) },
      }).zones[0]!.checks['sw-vs-swi'];
    };

    expect(run(0).status).toBe('ok'); // 0 %
    expect(run(2).status).toBe('warn'); // 10 %
    expect(run(4).status).toBe('warn'); // 20 % exacto -> warn
    const red = run(5); // 25 % -> tension
    expect(red.status).toBe('tension');
    expect(red.metrics.pctBelow).toBeCloseTo(25, 8);
    expect(red.focusRange).not.toBeNull();
    expect(red.focusRange![0]).toBeLessThanOrEqual(3000);
    expect(red.action).toEqual({ kind: 'dock', panelId: 'scal', label: 'Abrir SCAL' });
  });

  it('respeta la tolerancia por zona y marca sin soporte en zonas sin pay', () => {
    const depth = makeDepth(10, 1000, 1);
    const report = evaluateCrossCheck({
      depth,
      zones: [
        { id: 'seal', name: 'A', top: 1000, base: 1004, kind: 'seal' },
        { id: 'pay', name: 'B', top: 1005, base: 1009, kind: 'reservoir' },
      ],
      curves: {
        sw: filled(10, 0.25),
        swi: filled(10, 0.3), // diferencia 0.05
        netPay: Float64Array.from([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]),
      },
      swiToleranceByZone: new Map([['pay', 0.06]]), // 0.25 < 0.30 - 0.06 (0.24) es falso
    });
    expect(report.zones[0]!.checks['sw-vs-swi'].status).toBe('unsupported');
    expect(report.zones[1]!.checks['sw-vs-swi'].status).toBe('ok');
  });
});

describe('petro/crossCheck: divergencia de agua ligada CMR vs. SCAL y Archie', () => {
  it('detecta y explica la sobreestimación sistemática del CMR (corte fijo de 33 ms)', () => {
    const n = 20;
    const depth = makeDepth(n, 7800, 0.5);
    const phie = filled(n, 0.2);
    const swi = filled(n, 0.25); // BVI_SCAL = 0.05
    const bvw = filled(n, 0.055);
    const bviNmr = filled(n, 0.14); // 2.8x SCAL y +0.085 sobre BVW -> tensión fuerte
    const check = evaluateCrossCheck({
      depth,
      zones: [{ id: 'b', name: 'B', top: 7800, base: 7810 }],
      curves: { bvw, bviNmr, phie, swi, netRes: filled(n, 1) },
      hasMicp: true,
      micpCmrRatioRange: [1.9, 3.8],
    }).zones[0]!.checks['bound-water'];

    expect(check.status).toBe('tension');
    expect(check.detail).toMatch(/33 ms/);
    expect(check.detail).toMatch(/MICP confirma/);
    expect(check.metrics.nmrOverScal).toBeCloseTo(2.8, 6);
    expect(check.action).toEqual({ kind: 'dock', panelId: 'micp', label: 'Abrir MICP (CMR)' });
  });

  it('advierte agua libre cuando BVW supera claramente al agua ligada SCAL en zona con pay y la acepta en acuífero puro', () => {
    const n = 10;
    const base = {
      depth: makeDepth(n, 4000, 1),
      zones: [{ id: 'w', name: 'Transición', top: 4000, base: 4009 }],
      curves: {
        phie: filled(n, 0.2),
        swi: filled(n, 0.2), // 0.04
        bvw: filled(n, 0.18), // agua libre
        bviNmr: filled(n, 0.045),
        netRes: filled(n, 1),
      },
    };
    const withPay = evaluateCrossCheck({ ...base, curves: { ...base.curves, netPay: filled(n, 1) } }).zones[0]!.checks['bound-water'];
    expect(withPay.status).toBe('warn');
    expect(withPay.detail).toMatch(/agua libre\/móvil/i);

    const aquifer = evaluateCrossCheck({ ...base, curves: { ...base.curves, netPay: filled(n, 0) } }).zones[0]!.checks['bound-water'];
    expect(aquifer.status).toBe('ok');
    expect(aquifer.detail).toMatch(/esperado en zona sin pay/i);
  });
});

describe('petro/crossCheck: porosidad distinguiendo derrumbe, gas/RMN y matriz', () => {
  it('atribuye derrumbe cuando IND_WASHOUT supera el umbral', () => {
    const n = 20;
    const check = evaluateCrossCheck({
      depth: makeDepth(n, 5000, 1),
      zones: [{ id: 'z', name: 'C', top: 5000, base: 5019 }],
      curves: {
        phie: filled(n, 0.25),
        phieNmr: filled(n, 0.18),
        indWashout: filled(n, 1),
        indNmrDeficit: filled(n, 0),
      },
    }).zones[0]!.checks.porosity;

    expect(check.status).toBe('tension');
    expect(check.detail).toMatch(/IND_WASHOUT/);
  });

  it('atribuye efecto de gas/fluido ante déficit RMN sin derrumbe', () => {
    const n = 20;
    const check = evaluateCrossCheck({
      depth: makeDepth(n, 5100, 1),
      zones: [{ id: 'z', name: 'D', top: 5100, base: 5119 }],
      curves: {
        phie: filled(n, 0.22),
        phieNmr: filled(n, 0.17),
        indWashout: filled(n, 0),
        indNmrDeficit: filled(n, 1),
      },
    }).zones[0]!.checks.porosity;

    expect(check.status).toBe('tension');
    expect(check.detail).toMatch(/gas\/fluido liviano/i);
    expect(check.detail).not.toMatch(/IND_WASHOUT/);
  });

  it('atribuye desajuste de matriz frente a plugs de corona sin déficit de RMN', () => {
    const n = 20;
    const check = evaluateCrossCheck({
      depth: makeDepth(n, 5200, 1),
      zones: [{ id: 'z', name: 'E', top: 5200, base: 5219 }],
      curves: { phie: filled(n, 0.22), indWashout: filled(n, 0) },
      corePlugs: [
        { depthM: 5204, phiCore: 0.16, phiLog: 0.22 },
        { depthM: 5210, phiCore: 0.17, phiLog: 0.22 },
      ],
    }).zones[0]!.checks.porosity;

    expect(check.status).toBe('tension');
    expect(check.detail).toMatch(/desajuste de matriz/i);
    expect(check.action).toEqual({ kind: 'dock', panelId: 'core-calibration', label: 'Abrir Calibración' });
  });
});

describe('petro/crossCheck: incoherencia de contacto MDT vs. Sw', () => {
  it('marca tensión cuando hay pay neto por debajo del OWC más el margen operativo', () => {
    const n = 30;
    const depth = makeDepth(n, 6000, 1); // OWC en 6012 m, pay hasta 6020 m (6 m debajo de 6014 m)
    const netPay = Float64Array.from({ length: n }, (_, i) => (depth[i]! <= 6020 ? 1 : 0));
    const sw = Float64Array.from({ length: n }, (_, i) => (depth[i]! <= 6020 ? 0.25 : 0.95));

    const check = evaluateCrossCheck({
      depth,
      zones: [{ id: 'z', name: 'B', top: 6000, base: 6029 }],
      curves: { sw, netPay, netRes: filled(n, 1) },
      waterContacts: [{ kind: 'OWC', depthM: 6012, spanTopM: 6000, spanBaseM: 6029 }],
    }).zones[0]!.checks['mdt-vs-sw'];

    expect(check.status).toBe('tension');
    expect(Number(check.metrics.payBelowThkM)).toBeGreaterThan(CROSS_CHECK_THRESHOLDS.mdtVsSw.payBelowTensionM);
    expect(check.detail).toMatch(/pay neto por debajo/i);
    expect(check.focusRange).not.toBeNull();
  });

  it('marca tensión por arena limpia acuífera arriba del contacto y no extrapola a otro compartimiento', () => {
    const n = 60;
    const depth = makeDepth(n, 7000, 1);
    const sw = filled(n, 0.92); // toda la zona superior limpia con Sw > 0.80 arriba de OWC 7025
    const report = evaluateCrossCheck({
      depth,
      zones: [
        { id: 'z1', name: 'Sup', top: 7000, base: 7029 },
        { id: 'z2', name: 'Prof', top: 7040, base: 7059 },
      ],
      curves: { sw, netRes: filled(n, 1), netPay: filled(n, 0) },
      waterContacts: [{ kind: 'OWC', depthM: 7025, spanTopM: 7000, spanBaseM: 7029 }],
    });

    expect(report.zones[0]!.checks['mdt-vs-sw'].status).toBe('tension');
    expect(report.zones[0]!.checks['mdt-vs-sw'].detail).toMatch(/arena limpia con Sw > 0,80/i);
    expect(report.zones[1]!.checks['mdt-vs-sw'].status).toBe('unsupported');
  });
});

describe('petro/crossCheck: capacidad de sello MICP/SCAL, uranio y movilidad', () => {
  it('distingue dato medido de sello vs. muestras solo en reservorio y declara supuestos MICP', () => {
    const ctxGas = { lab: SYSTEM_HG_AIR, reservoir: SYSTEM_GAS_WATER, deltaRhoGcc: 0.8 };
    const baseInput: CrossCheckInput = {
      depth: makeDepth(20, 8000, 1),
      zones: [
        { id: 's', name: 'A', top: 8000, base: 8005, kind: 'seal' },
        { id: 'r', name: 'B', top: 8006, base: 8019, kind: 'reservoir' },
      ],
      curves: {},
      sealAssumptions: { systemLabel: 'Gas–agua', heightContext: ctxGas, rhoWaterGcc: 1.05, rhoHcGcc: 0.25 },
      observedColumnM: 40,
      columnBasis: 'espesor de pay',
    };

    // Solo muestras de reservorio -> warn explícito "sin soporte directo de roca sello"
    const resOnly = evaluateCrossCheck({
      ...baseInput,
      sealSamples: [{ id: 'm1', label: '2-6L', depthM: 8010, pdLabPsi: 100, source: 'micp', isSeal: false, zoneName: 'B' }],
    });
    expect(resOnly.seal.status).toBe('warn');
    expect(resOnly.seal.metrics.hasSealSupport).toBe(false);
    expect(resOnly.seal.detail).toMatch(/Sin soporte directo de roca sello/i);
    expect(resOnly.seal.detail).toMatch(/Gas–agua/);
    expect(resOnly.seal.metrics.hMaxM).toBeCloseTo(entryHeightM(100, ctxGas), 8);

    // Muestra medida de sello con Pd insuficiente para la columna -> tension
    const sealFail = evaluateCrossCheck({
      ...baseInput,
      sealSamples: [{ id: 's1', label: 'Sello-A', depthM: 8002, pdLabPsi: 150, source: 'micp', isSeal: true, zoneName: 'A' }],
    });
    expect(sealFail.seal.metrics.hMaxM).toBeLessThan(40);
    expect(sealFail.seal.status).toBe('tension');

    // Conversión de tabla SCAL Pd (kg/cm² → psi Hg) y muestra de sello holgada -> ok
    const pdPsiFromScal = scalPdKgCm2ToLabPsi(30);
    expect(pdPsiFromScal).toBeCloseTo(30 * KGF_CM2_TO_PSI, 10);
    expect(Number.isNaN(scalPdKgCm2ToLabPsi(0))).toBe(true);
    const sealOk = evaluateCrossCheck({
      ...baseInput,
      sealSamples: [{ id: 's2', label: 'SCAL-Sello', depthM: 8002, pdLabPsi: pdPsiFromScal, source: 'scal', isSeal: true, zoneName: 'A' }],
    });
    expect(sealOk.seal.status).toBe('ok');
    expect(sealOk.seal.metrics.hasSealSupport).toBe(true);
  });

  it('audita uranio (mitigado cuando IGR usa CGR) y movilidad en pay con invasión resuelta', () => {
    const n = 20;
    const depth = makeDepth(n, 8100, 1);
    const common: CrossCheckInput = {
      depth,
      zones: [{ id: 'd', name: 'D', top: 8100, base: 8119 }],
      curves: {
        netRes: filled(n, 1),
        netPay: filled(n, 1),
        phie: filled(n, 0.2),
        sw: filled(n, 0.3),
        uGrFrac: filled(n, 0.42), // 42 % uranio > 30 %
        mos: filled(n, 0.03), // MOS/Sh = 0.03 / 0.70 = 4.3 % < 10 % -> tension
        mhi: filled(n, 0.91),
      },
      igrUsesCgr: false,
    };

    const r1 = evaluateCrossCheck(common).zones[0]!;
    expect(r1.checks['uranium-gr'].status).toBe('tension');
    expect(r1.checks['hc-movability'].status).toBe('tension');
    expect(r1.checks['hc-movability'].metrics.movableHcFrac).toBeCloseTo(0.03 / 0.7, 6);

    const r2 = evaluateCrossCheck({ ...common, igrUsesCgr: true }).zones[0]!;
    expect(r2.checks['uranium-gr'].status).toBe('warn');
    expect(r2.checks['uranium-gr'].detail).toMatch(/mitigado/i);
  });
});

describe('petro/crossCheck: regresión de bordes de revisión independiente', () => {
  it('maneja NaN en extremos de profundidad, zonas sin datos válidos con contacto MDT y frontera exacta 0,02 v/v', () => {
    // 1. Extremos NaN con zones = [] no vacían la evaluación ni propagan NaN en espesores
    const depth = Float64Array.from([NaN, 1000, 1001, 1002, 1003, 1004, NaN]);
    const rNoZones = evaluateCrossCheck({
      depth,
      zones: [],
      curves: { sw: Float64Array.from([NaN, 0.25, 0.25, 0.25, 0.25, 0.25, NaN]), netPay: Float64Array.from([NaN, 1, 1, 1, 1, 1, NaN]) },
      waterContacts: [{ kind: 'OWC', depthM: 1000.5, spanTopM: NaN, spanBaseM: NaN }],
    });
    expect(rNoZones.zones).toHaveLength(1);
    expect(rNoZones.zones[0]!.checks['mdt-vs-sw'].status).toBe('tension');
    expect(Number.isFinite(Number(rNoZones.zones[0]!.checks['mdt-vs-sw'].metrics.payBelowThkM))).toBe(true);
    expect(rNoZones.zones[0]!.checks['mdt-vs-sw'].detail).not.toContain('n/d m');

    // 2. Contacto MDT con curvas todo-NaN en la zona debe devolver unsupported (nunca falso ok)
    const rAllNan = evaluateCrossCheck({
      depth: makeDepth(10, 2000, 1),
      zones: [{ id: 'z', name: 'Vacía', top: 2000, base: 2009 }],
      curves: { sw: filled(10, NaN), netPay: filled(10, NaN) },
      waterContacts: [{ kind: 'OWC', depthM: 2005, spanTopM: 2000, spanBaseM: 2009 }],
    });
    expect(rAllNan.zones[0]!.checks['mdt-vs-sw'].status).toBe('unsupported');

    // 3. Frontera exacta 0,02 v/v en punto flotante (0,18 - 0,20) permanece en ok
    const rBoundary = evaluateCrossCheck({
      depth: makeDepth(10, 3000, 1),
      zones: [{ id: 'z', name: 'Borde', top: 3000, base: 3009 }],
      curves: { phie: filled(10, 0.2), phieNmr: filled(10, 0.18) },
    });
    expect(rBoundary.zones[0]!.checks.porosity.status).toBe('ok');

    // 4. BVI_SCAL = 0 con BVI_NMR alto (sin BVW) detecta tensión y zonas ok no heredan nota MICP de pozo
    const rZeroScal = evaluateCrossCheck({
      depth: makeDepth(10, 4000, 1),
      zones: [{ id: 'z', name: 'ZeroScal', top: 4000, base: 4009 }],
      curves: { phie: filled(10, 0.2), swi: filled(10, 0), bviNmr: filled(10, 0.08), netRes: filled(10, 1) },
    });
    expect(rZeroScal.zones[0]!.checks['bound-water'].status).toBe('tension');

    const rOkNoMicpNote = evaluateCrossCheck({
      depth: makeDepth(10, 4100, 1),
      zones: [{ id: 'z', name: 'Ok', top: 4100, base: 4109 }],
      curves: { phie: filled(10, 0.2), swi: filled(10, 0.25), bvw: filled(10, 0.052), bviNmr: filled(10, 0.05), netRes: filled(10, 1) },
      micpCmrRatioRange: [2.0, 3.6],
    });
    expect(rOkNoMicpNote.zones[0]!.checks['bound-water'].status).toBe('ok');
    expect(rOkNoMicpNote.zones[0]!.checks['bound-water'].detail).not.toMatch(/MICP confirma/);
  });
});
