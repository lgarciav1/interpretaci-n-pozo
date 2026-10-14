/**
 * Sarta de perfilaje (docs/decisiones/0032), revisión de la fase 11a: la disponibilidad de módulos (`moduleAvailability`)
 * tiene que decir exactamente lo mismo que el motor. Para el pozo de demo y el del TP, con varias sartas, fuentes
 * elegidas a mano y módulos desactivados, se corre el motor con TODOS los módulos (en «comparar», así corren aunque no
 * alimenten la cadena) y se compara módulo por módulo:
 *   motor 'ok' ⇔ 'available'; motor 'missing-input' | 'blocked' | 'cycle' ⇔ 'unavailable' | 'needs-data';
 *   desactivado ⇔ 'disabled' (el motor no lo planifica).
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { Engine, toEngineWell, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation, type SourceRef } from '../src/core/interpretation';
import { defineModule, input, output, type AnyModule } from '../src/core/module';
import { createRegistry, type Registry } from '../src/core/registry';
import { availabilityReason, moduleAvailability, offToolsFor, resolveToolString, type AvailabilityReport, type ToolStringState } from '../src/core/toolString';
import type { Curve, Well, Zone } from '../src/core/well';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';

const state = (partial: Partial<ToolStringState>): ToolStringState => ({ mode: 'data', off: [], order: [], plan: [], planOff: [], ...partial });

const demo = syntheticWell();
const tp = readWellFile(csvText, 'pozo_tp_perfiles.csv');

interface Case {
  name: string;
  toolString?: ToolStringState;
  sources?: Record<string, SourceRef>;
  disabled?: string[];
}

const CASES: Case[] = [
  { name: 'sin estado' },
  { name: 'GR apagado', toolString: state({ off: ['gr'] }) },
  { name: 'densidad, neutrón y sónico apagados', toolString: state({ off: ['density', 'neutron', 'sonic'] }) },
  { name: 'resistividades apagadas', toolString: state({ off: ['induction', 'laterolog', 'microresistivity'] }) },
  { name: 'temperatura apagada (la da el gradiente)', toolString: state({ off: ['temperature'] }) },
  { name: 'planificación vacía', toolString: state({ mode: 'planning' }) },
  { name: 'planificación GR + RMN', toolString: state({ mode: 'planning', plan: ['gr', 'nmr'] }) },
  {
    name: 'planificación con densidad apagada en el plan',
    toolString: state({ mode: 'planning', plan: ['gr', 'density', 'neutron', 'induction'], planOff: ['density'] }),
  },
  { name: 'módulos desactivados', disabled: ['igr', 'phi-sonic-wyllie'] },
  { name: 'Rw elegido desde el SP con el SP apagado', toolString: state({ off: ['sp'] }), sources: { RW: { kind: 'module', moduleId: 'rw-sp' } } },
  {
    name: 'curva elegida a mano de una herramienta apagada',
    toolString: state({ off: ['induction'] }),
    sources: { RT: { kind: 'curve', curveId: 'AT90' } },
  },
];

function compareWithEngine(well: Well, zones: Zone[], c: Case, mods: Registry = registry): { report: AvailabilityReport; run: EngineRunResult; mismatches: string[] } {
  const engine = new Engine(mods);
  engine.setWell(toEngineWell(well));
  const interp: Interpretation = {
    ...emptyInterpretation(zones),
    compare: mods.modules.map((m) => m.id),
    disabled: c.disabled ?? [],
    sources: c.sources ?? {},
    ...(c.toolString ? { toolString: c.toolString } : {}),
  };
  const run = engine.run(interp);
  const resolved = resolveToolString(well.curves, c.toolString, mods.tools);
  const report = moduleAvailability(mods, well.curves, resolved, { disabled: interp.disabled, sources: interp.sources });
  const mismatches: string[] = [];
  const byId = new Map(run.nodes.map((n) => [n.moduleId, n.status]));
  for (const m of mods.modules) {
    const engineStatus = byId.get(m.id) ?? 'not-planned';
    const st = report.modules.get(m.id)!.status;
    const ok =
      engineStatus === 'ok'
        ? st === 'available'
        : engineStatus === 'not-planned'
          ? st === 'disabled'
          : engineStatus === 'error'
            ? false // un error de cálculo no es un problema de disponibilidad: no debería pasar con estos pozos
            : st === 'unavailable' || st === 'needs-data';
    if (!ok) mismatches.push(`${m.id}: motor=${engineStatus} disponibilidad=${st}`);
  }
  return { report, run, mismatches };
}

describe('la disponibilidad coincide con el motor, módulo por módulo', () => {
  const wells: [string, Well, Zone[]][] = [
    ['demo', demo.well, demo.zones],
    ['TP', tp.well, tp.zones],
  ];
  for (const [wellName, well, zones] of wells) {
    for (const c of CASES) {
      it(`${wellName}: ${c.name}`, () => {
        expect(compareWithEngine(well, zones, c).mismatches).toEqual([]);
      }, 60_000);
    }
  }
});

describe('fuentes elegidas a mano', () => {
  it('un módulo elegido para un puerto que no puede correr bloquea a sus consumidores, y el motivo dice qué prender', () => {
    const c = CASES.find((x) => x.name.startsWith('Rw elegido'))!;
    const { report } = compareWithEngine(demo.well, demo.zones, c);
    const sw = report.modules.get('sw-archie')!;
    expect(sw.status).toBe('unavailable');
    expect(sw.missingInputs).toEqual(['RW']);
    expect(sw.needs).toEqual([{ port: 'SP', tools: ['sp'] }]);
    const resolved = resolveToolString(demo.well.curves, c.toolString, registry.tools);
    expect(availabilityReason(sw, { tools: registry.tools, roles: registry.roles, resolved })).toBe(
      'Falta SP (potencial espontáneo): prendé Potencial espontáneo en la sarta.',
    );
    // sin la elección, Rw sale del método manual y Sw está disponible
    expect(compareWithEngine(demo.well, demo.zones, { ...c, sources: {} }).report.modules.get('sw-archie')!.status).toBe('available');
  }, 60_000);

  it('una curva sin rol elegida a mano como RT cubre el puerto, como en el motor', () => {
    const curves: Curve[] = demo.well.curves.map((x) => (x.role === 'RT' ? { ...x, role: null } : x));
    const well: Well = { ...demo.well, curves };
    const c: Case = { name: 'RT a mano', sources: { RT: { kind: 'curve', curveId: 'AT90' } } };
    const { report, mismatches } = compareWithEngine(well, demo.zones, c);
    expect(mismatches).toEqual([]);
    expect(report.modules.get('sw-archie')!.status).toBe('available');
    expect(compareWithEngine(well, demo.zones, { ...c, sources: {} }).report.modules.get('sw-archie')!.status).toBe('unavailable');
  }, 60_000);

  it('un ciclo armado con fuentes elegidas no se justifica a sí mismo (y el motor lo informa como ciclo)', () => {
    const base = { category: 'other', workspace: 'petrophysics', params: {}, docs: { summary: 's', equations: [], references: [] } } as const;
    const mods: AnyModule[] = [
      defineModule({ ...base, id: 'a', name: 'A', inputs: { x: input.curve('PHIT') }, outputs: { y: output.curve('PHIE') }, compute: ({ n }) => ({ y: new Float64Array(n) }) }),
      // C antes que B: la fuente por defecto de PHIT es la primera viable en orden de registro.
      defineModule({ ...base, id: 'c', name: 'C', inputs: { g: input.curve('GR') }, outputs: { x: output.curve('PHIT') }, compute: ({ n }) => ({ x: new Float64Array(n) }) }),
      defineModule({ ...base, id: 'b', name: 'B', inputs: { y: input.curve('PHIE') }, outputs: { x: output.curve('PHIT') }, compute: ({ n }) => ({ x: new Float64Array(n) }) }),
    ];
    const r = createRegistry(mods);
    const free = compareWithEngine(demo.well, demo.zones, { name: 'libre' }, r);
    expect(free.mismatches).toEqual([]);
    expect([...free.report.modules.values()].map((m) => m.status)).toEqual(['available', 'available', 'available']);
    const cyc = compareWithEngine(demo.well, demo.zones, { name: 'ciclo', sources: { PHIT: { kind: 'module', moduleId: 'b' } } }, r);
    expect(cyc.mismatches).toEqual([]);
    expect(cyc.run.nodes.find((n) => n.moduleId === 'a')!.status).toBe('cycle');
    const a = cyc.report.modules.get('a')!;
    expect(a.status).toBe('unavailable');
    const resolved = resolveToolString(demo.well.curves, undefined, r.tools);
    expect(availabilityReason(a, { tools: r.tools, roles: r.roles, resolved })).toBe(
      'Falta PHIT (porosidad total): «B», elegido a mano, no se puede calcular con ninguna sarta (p. ej. sus entradas forman un ciclo); elegí otra fuente.',
    );
  }, 60_000);
});

// ── entradas «al menos N de» (inputGroups) ──────────────────────────────────────────────────────────────────────

describe('grupos de entradas «al menos N de»', () => {
  const base = { category: 'other', workspace: 'petrophysics', params: {}, docs: { summary: 's', equations: [], references: [] } } as const;
  const ctxOf = (s: ToolStringState | undefined, curves = demo.well.curves) => ({
    tools: registry.tools,
    roles: registry.roles,
    resolved: resolveToolString(curves, s, registry.tools),
  });
  const avOf = (s: ToolStringState | undefined, id: string, curves = demo.well.curves) =>
    moduleAvailability(registry, curves, resolveToolString(curves, s, registry.tools)).modules.get(id)!;

  it('el registro valida los grupos: entradas existentes y opcionales, sin repetir, mínimo alcanzable', () => {
    const mk = (inputGroups: unknown) =>
      defineModule({
        ...base,
        id: 'g',
        name: 'G',
        inputs: { a: input.optionalCurve('GR'), b: input.optionalCurve('RHOB'), c: input.curve('NPHI') },
        outputs: { y: output.curve('PHIT') },
        compute: ({ n }) => ({ y: new Float64Array(n) }),
        inputGroups: inputGroups as never,
      });
    expect(() => createRegistry([mk([{ inputs: ['a', 'b'] }])])).not.toThrow();
    expect(() => createRegistry([mk([{ inputs: ['a', 'zz'] }])])).toThrow(/nombra la entrada 'zz', que no existe/);
    expect(() => createRegistry([mk([{ inputs: ['a', 'c'] }])])).toThrow(/incluye 'c', que es obligatoria/);
    expect(() => createRegistry([mk([{ inputs: ['a', 'a'] }])])).toThrow(/repite entradas/);
    expect(() => createRegistry([mk([{ inputs: ['a', 'b'], min: 3 }])])).toThrow(/mínimo inválido/);
    expect(() => createRegistry([mk([{ inputs: [] }])])).toThrow(/no tiene entradas/);
  });

  it('PHIT sin ninguna porosidad: el motor no lo corre y la sarta dice «densidad, neutrón o sónico»', () => {
    const s = state({ off: ['density', 'neutron', 'sonic'] });
    const engine = new Engine(registry);
    engine.setWell(toEngineWell(demo.well));
    const run = engine.run({ ...emptyInterpretation(demo.zones), compare: ['phit'], toolString: s });
    expect(run.nodes.find((n) => n.moduleId === 'phit')?.status).toBe('missing-input');
    expect(run.outputs.some((o) => o.port === 'PHIT')).toBe(false);
    const phitMsgs = run.diagnostics.filter((d) => d.moduleId === 'phit').map((d) => d.message);
    expect(phitMsgs).toEqual([expect.stringMatching(/necesita al menos una de estas entradas: PHID, PHIN o PHIS/)]);

    const phit = avOf(s, 'phit');
    expect(phit.status).toBe('unavailable');
    expect(phit.missingGroups).toEqual([
      {
        ports: ['PHID', 'PHIN', 'PHIS'],
        min: 1,
        have: 0,
        label: 'una porosidad de densidad, neutrón o sónico',
        needs: [
          { port: 'RHOB', tools: ['density'] },
          { port: 'NPHI', tools: ['neutron'] },
          { port: 'DT', tools: ['sonic'] },
        ],
      },
    ]);
    expect(availabilityReason(phit, ctxOf(s))).toBe('Falta una porosidad de densidad, neutrón o sónico: prendé Densidad, Neutrón o Sónico en la sarta.');
    expect(offToolsFor(phit, ctxOf(s).resolved).map((t) => t.id)).toEqual(['density', 'neutron', 'sonic']);
    // aguas abajo, el camino más corto pasa por el grupo
    const sw = avOf(s, 'sw-archie');
    expect(sw.status).toBe('unavailable');
    expect(sw.needs).toEqual([{ port: 'RHOB', tools: ['density'] }]);
    // con una sola porosidad alcanza
    expect(avOf(state({ off: ['density', 'sonic'] }), 'phit').status).toBe('available');
  }, 60_000);

  it('en planificación: vacía pide agregar; con densidad planificada en un pozo sin densidad, «sin datos»', () => {
    const empty = state({ mode: 'planning' });
    expect(availabilityReason(avOf(empty, 'phit'), ctxOf(empty))).toBe('Falta una porosidad de densidad, neutrón o sónico: agregá Densidad, Neutrón o Sónico a la sarta.');
    const curves = demo.well.curves.filter((c) => !['RHOB', 'PEF', 'DRHO'].includes(c.role ?? ''));
    const plan = state({ mode: 'planning', plan: ['gr', 'density'] });
    const phit = avOf(plan, 'phit', curves);
    expect(phit.status).toBe('needs-data');
    expect(phit.toolsWithoutData).toEqual(['density']);
    expect(availabilityReason(phit, ctxOf(plan, curves))).toBe('Correría con la sarta planificada, pero el pozo no tiene RHOB (densidad volumétrica) de Densidad.');
  });

  it('«al menos dos de» (litología sugerida): con una sola curva no está disponible y lo dice', () => {
    const s = state({ mode: 'planning', plan: ['gr'] });
    const lf = avOf(s, 'lithology-facies');
    expect(lf.status).toBe('unavailable');
    expect(lf.missingGroups[0]).toMatchObject({ min: 2, have: 1 });
    expect(availabilityReason(lf, ctxOf(s))).toBe(
      'Faltan al menos dos curvas entre rayos gamma, densidad, neutrón, factor fotoeléctrico, sónico y resistividad profunda (hay 1): ' +
        'agregá Densidad, Neutrón, Sónico, Inducción o Laterolog a la sarta.',
    );
    expect(avOf(state({ mode: 'planning', plan: ['gr', 'density'] }), 'lithology-facies').status).toBe('available');
  });

  it('si las fuentes que cumplían el grupo no corren, queda bloqueado (en el plan y en tiempo de cálculo), igual que en la disponibilidad', () => {
    const grp = defineModule({
      ...base,
      id: 'grp',
      name: 'Grupo',
      inputs: { d: input.optionalCurve('PHID'), s: input.optionalCurve('PHIS') },
      inputGroups: [{ inputs: ['d', 's'] }],
      outputs: { y: output.curve('PHIT') },
      compute: ({ n }) => ({ y: new Float64Array(n) }),
    });
    // Plan: PHIS sale de 'q', que necesita VSH elegido a mano desde 's-nphi' (sin NPHI no corre).
    const q = defineModule({ ...base, id: 'q', name: 'Q', inputs: { v: input.curve('VSH') }, outputs: { y: output.curve('PHIS') }, compute: ({ n }) => ({ y: new Float64Array(n) }) });
    const sN = defineModule({ ...base, id: 's-nphi', name: 'S', inputs: { x: input.curve('NPHI') }, outputs: { v: output.curve('VSH') }, compute: ({ n }) => ({ v: new Float64Array(n) }) });
    const tG = defineModule({ ...base, id: 't-gr', name: 'T', inputs: { g: input.curve('GR') }, outputs: { v: output.curve('VSH') }, compute: ({ n }) => ({ v: new Float64Array(n) }) });
    const r1 = createRegistry([grp, q, tG, sN]);
    const noNphi = { ...demo.well, curves: demo.well.curves.filter((c) => c.role !== 'NPHI' && c.role !== 'RHOB') };
    const planned = compareWithEngine(noNphi, demo.zones, { name: 'plan', sources: { VSH: { kind: 'module', moduleId: 's-nphi' } } }, r1);
    expect(planned.mismatches).toEqual([]);
    expect(planned.run.nodes.find((n) => n.moduleId === 'grp')?.status).toBe('blocked');
    expect(compareWithEngine(noNphi, demo.zones, { name: 'libre' }, r1).run.nodes.find((n) => n.moduleId === 'grp')?.status).toBe('ok');

    // Cálculo: la única fuente del grupo falla al calcular → bloqueado, sin llamar a compute.
    let called = false;
    const boom = defineModule({
      ...base,
      id: 'boom',
      name: 'Boom',
      inputs: { g: input.curve('GR') },
      outputs: { y: output.curve('PHIS') },
      compute: () => {
        throw new Error('falla');
      },
    });
    const grp2 = { ...grp, compute: (ctx: Parameters<typeof grp.compute>[0]) => ((called = true), grp.compute(ctx)) };
    const r2 = createRegistry([grp2, boom]);
    const engine = new Engine(r2);
    engine.setWell(toEngineWell(noNphi));
    const run = engine.run({ ...emptyInterpretation(demo.zones), compare: ['grp'] });
    expect(run.nodes.find((n) => n.moduleId === 'boom')?.status).toBe('error');
    expect(run.nodes.find((n) => n.moduleId === 'grp')?.status).toBe('blocked');
    expect(called).toBe(false);
  });
});
