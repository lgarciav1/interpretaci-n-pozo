/**
 * Módulo «Distribución de la arcilla · Thomas–Stieber» (docs/decisiones/0061): curva de código y tabla por zona con el
 * motor puro, y corrida completa sobre los perfiles del TP.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import clayDistribution, { CLAY_DIST_ROLE, CLAY_DIST_TABLE } from '../src/modules/clay-distribution';
import type { TableValue } from '../src/core/module';

type Ctx = Parameters<typeof clayDistribution.compute>[0];

/** Contexto mínimo: dos zonas (A: muestras 0–4, B: 5–9), parámetros por zona. */
function ctxOf(vsh: number[], phit: number[], pA = { phiSand: 0.3, phiShale: 0.1, bandTolerance: 0.02 }, pB = pA): { ctx: Ctx; warnings: string[] } {
  const n = vsh.length;
  const warnings: string[] = [];
  const zones = [
    { id: 'a', name: 'A', start: 0, end: 5, kind: 'formation' },
    { id: 'b', name: 'B', start: 5, end: n, kind: 'formation' },
  ];
  const ctx = {
    n,
    depth: Float64Array.from({ length: n }, (_, i) => 1000 + i),
    thickness: new Float64Array(n).fill(1),
    inputs: { vsh: Float64Array.from(vsh), phit: Float64Array.from(phit) },
    params: pA,
    segments: [
      { start: 0, end: 5, zoneId: 'a', params: pA },
      { start: 5, end: n, zoneId: 'b', params: pB },
    ],
    zones,
    paramsFor: (id: string | null) => (id === 'b' ? pB : pA),
    warn: (m: string) => warnings.push(m),
  } as unknown as Ctx;
  return { ctx, warnings };
}

describe('cálculo con el motor', () => {
  // Zona A: laminar, dispersa, estructural, arena limpia, sin dato. Zona B: tres dispersas, una laminar, una fuera.
  const vsh = [0.5, 0.5, 0.5, 0.05, NaN, 0.5, 0.4, 0.6, 0.5, 0.5];
  const phit = [0.2, 0.1, 0.3, 0.3, 0.2, 0.1, 0.08, 0.1, 0.2, 0.45];

  it('curva de código por muestra', () => {
    const { ctx } = ctxOf(vsh, phit);
    const out = clayDistribution.compute(ctx);
    expect(Array.from(out.dist)).toEqual([1, 2, 3, 0, NaN, 2, 2, 2, 1, 0]);
  });

  it('tabla por zona con porcentajes sobre las muestras con dato', () => {
    const { ctx } = ctxOf(vsh, phit);
    const rows = (clayDistribution.compute(ctx).byZone as TableValue).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ zone: 'A', samples: 4, laminated: 25, dispersed: 25, structural: 25, unclassified: 25 });
    expect(rows[1]).toMatchObject({ zone: 'B', samples: 5, laminated: 20, dispersed: 60, structural: 0, unclassified: 20, dominant: 'Dispersa' });
  });

  it('los parámetros son por zona', () => {
    // En B, φsand 0,40: la muestra (0,5; 0,2) queda bajo la nueva diagonal (0,25) → dispersa.
    const { ctx } = ctxOf(vsh, phit, undefined, { phiSand: 0.4, phiShale: 0.1, bandTolerance: 0.02 });
    expect(clayDistribution.compute(ctx).dist[8]).toBe(2);
  });

  it('extremos inválidos: sin dato y aviso, sin excepción', () => {
    const { ctx, warnings } = ctxOf(vsh, phit, undefined, { phiSand: 0.1, phiShale: 0.2, bandTolerance: 0.02 });
    const out = clayDistribution.compute(ctx);
    expect(Array.from(out.dist.slice(5)).every(Number.isNaN)).toBe(true);
    expect(warnings.join(' ')).toMatch(/zona|B/);
    expect((out.byZone as TableValue).rows[1]).toMatchObject({ samples: 0, dominant: 'Sin dato', laminated: null });
  });
});

describe('registro y contrato', () => {
  it('está registrado con su rol, categoría y espacios', () => {
    const m = registry.get('clay-distribution')!;
    expect(m).toBeDefined();
    expect(m.category).toBe('shale');
    expect(registry.roles.get(CLAY_DIST_ROLE)?.unit).toBe('unitless');
    expect(Object.keys(m.params)).toEqual(['phiSand', 'phiShale', 'bandTolerance']);
    for (const p of Object.values(m.params)) expect((p as { tooltip?: string }).tooltip?.length).toBeGreaterThan(30);
    expect(m.docs.equations).toHaveLength(7);
    expect(m.docs.references.some((r) => r.includes('Thomas, E.C. y Stieber, S.J. (1975)'))).toBe(true);
  });
});

describe('con los perfiles del TP', () => {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(well));
  const result = engine.run(emptyInterpretation(zones));
  const out = (port: string) => result.outputs.find((o) => o.port === port && o.moduleId === 'clay-distribution')?.value;

  it('publica la curva y una fila por zona, sin errores', () => {
    const c = out(CLAY_DIST_ROLE) as Float64Array;
    expect(c).toBeInstanceOf(Float64Array);
    expect(Array.from(c).filter(Number.isFinite).length).toBeGreaterThan(well.depth.values.length / 2);
    for (const v of c) if (Number.isFinite(v)) expect([0, 1, 2, 3]).toContain(v);
    const t = out(CLAY_DIST_TABLE) as TableValue;
    expect(t.rows.map((r) => r['zone'])).toEqual(zones.map((z) => z.name));
    expect(result.diagnostics.filter((d) => d.moduleId === 'clay-distribution' && d.level === 'error')).toEqual([]);
  });
});
