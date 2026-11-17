/**
 * Avisos agrupados y navegables (docs/decisiones/0072): zona en los avisos del motor, huella, agrupado por paso y
 * módulo, filtros, marcas «visto» por pozo y su serialización.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import fixtureV7 from './fixtures/archive/v7.pozo.json?raw';
import { computeOnce, Engine, toEngineWell } from '../src/core/engine/engine';
import type { Diagnostic } from '../src/core/engine/graph';
import { emptyInterpretation } from '../src/core/interpretation';
import { defineModule, input, moduleWorkspaces, output, portOf } from '../src/core/module';
import { param } from '../src/core/params';
import { createRegistry } from '../src/core/registry';
import { addWell, createProject, getWellEntry, readSeenDiagnostics, setDiagnosticSeen, setParam } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { FLOWS } from '../src/app/flow/flow';
import {
  countUnseen,
  defaultCollapsed,
  diagnosticFingerprint,
  filterGroups,
  groupDiagnostics,
  moduleTarget,
  stripModulePrefix,
  type GroupingFlow,
  type GroupingModule,
} from '../src/app/diagnostics/grouping';
import { curve, interp, well, zone } from './helpers';

// ---------------------------------------------------------------------------------------------------------------
// Motor

const gr = curve('GR1', 'GR', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

const zonal = defineModule({
  id: 'zonal',
  name: 'Zonal',
  category: 'other',
  workspace: 'petrophysics',
  inputs: { x: input.curve('GR') },
  params: { k: param.number({ label: 'K', default: 1, min: 0, max: 100, scope: 'zone' }) },
  outputs: { y: output.curve('IGR') },
  compute: ({ n, segments, zones, warn }) => {
    for (const s of segments) {
      if (!s.zoneId) continue;
      warn('Algo raro en la zona.', { zoneId: s.zoneId });
      warn('Algo raro en la zona.', { zoneId: s.zoneId }); // repetido: se deduplica
    }
    warn('Aviso de pozo entero.');
    warn('Punto puntual.', { depth: 1002 });
    if (zones.length === 0) warn('Sin zonas.');
    return { y: new Float64Array(n) };
  },
  docs: { summary: '', equations: [], references: [] },
});

describe('motor: avisos con zona (0072)', () => {
  const zones = [zone('a', 1000, 1002), zone('b', 1002.5, 1004.5)];

  it('warn(msg, { zoneId }) da un diagnóstico con zoneId; mismo texto en dos zonas = dos avisos', () => {
    const r = computeOnce(createRegistry([zonal]), well([gr]), interp({ zones }));
    const zoned = r.diagnostics.filter((d) => d.message === 'Zonal: Algo raro en la zona.');
    expect(zoned.map((d) => d.zoneId)).toEqual(['a', 'b']);
    expect(zoned.every((d) => d.code === 'module-warning' && d.moduleId === 'zonal' && d.level === 'warning')).toBe(true);
    const whole = r.diagnostics.find((d) => d.message === 'Zonal: Aviso de pozo entero.')!;
    expect('zoneId' in whole).toBe(false);
    expect('depth' in whole).toBe(false);
    expect(r.diagnostics.find((d) => d.message === 'Zonal: Punto puntual.')!.depth).toBe(1002);
  });

  it('el resultado en caché conserva zoneId y depth', () => {
    const engine = new Engine(createRegistry([zonal]));
    engine.setWell(well([gr]));
    const state = interp({ zones });
    const first = engine.run(state);
    const again = engine.run(structuredClone(state));
    expect(again.stats.recomputed).toEqual([]);
    expect(again.diagnostics).toEqual(first.diagnostics);
    expect(again.diagnostics.filter((d) => d.zoneId).map((d) => d.zoneId)).toEqual(['a', 'b']);
  });
});

describe('pozo del TP: los avisos por zona traen su zona', () => {
  const { well: tp, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry);
  engine.setWell(toEngineWell(tp));
  const r = engine.run(emptyInterpretation(zones));
  const ids = new Set(zones.map((z) => z.id));

  it.each(['rw-sp', 'swi-pc', 'invasion-step'])('%s: cada aviso «en la zona X» lleva el id de una zona que existe', (id) => {
    const ws = r.diagnostics.filter((d) => d.moduleId === id && d.code === 'module-warning');
    const zoned = ws.filter((d) => /zona /i.test(d.message.replace(/^[^:]*: /, '')));
    expect(zoned.length, `${id} debería avisar por zona con el TP`).toBeGreaterThan(0);
    for (const d of zoned) {
      expect(d.zoneId, d.message).toBeDefined();
      expect(ids.has(d.zoneId!), d.message).toBe(true);
      const z = zones.find((x) => x.id === d.zoneId)!;
      expect(d.message).toContain(`zona ${z.name}`);
    }
  });

  it('se agrupan por paso: Rw, Saturación… «Otros módulos» al final', () => {
    const groups = groupDiagnostics(r.diagnostics, modulesOf(registry.modules), flows);
    expect(groups.map((g) => g.total).reduce((a, b) => a + b, 0)).toBe(r.diagnostics.length);
    const rw = groups.find((g) => g.id === 'rw')!;
    expect(rw.modules.some((m) => m.moduleId === 'rw-sp')).toBe(true);
    const ids = groups.map((g) => g.id);
    if (ids.includes('other')) expect(ids.at(-1)).toBe('other');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Agrupado y huella (puros)

const flows: GroupingFlow[] = [
  { workspace: 'petrophysics', steps: FLOWS.petrophysics },
  { workspace: 'geology', steps: FLOWS.geology },
];
function modulesOf(list: typeof registry.modules): GroupingModule[] {
  return list.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    outputPorts: Object.values(m.outputs).map(portOf),
    workspaces: moduleWorkspaces(m),
  }));
}

const MODS: GroupingModule[] = [
  { id: 'igr', name: 'Índice de GR', category: 'shale', outputPorts: ['IGR'], workspaces: ['petrophysics'] },
  { id: 'rw-sp', name: 'Rw desde el SP', category: 'water', outputPorts: ['RW'], workspaces: ['petrophysics'] },
  { id: 'sed', name: 'Columna sedimentológica', category: 'geology', outputPorts: [], workspaces: ['geology'] },
  { id: 'misc', name: 'Varios', category: 'other', outputPorts: [], workspaces: ['petrophysics'] },
];
const w = (moduleId: string | undefined, message: string, extra: Partial<Diagnostic> = {}): Diagnostic => ({
  level: 'warning',
  code: moduleId ? 'module-warning' : 'zones',
  message,
  ...(moduleId ? { moduleId } : {}),
  ...extra,
});

describe('huella y texto', () => {
  it('huella = moduleId|code|zoneId|message', () => {
    expect(diagnosticFingerprint(w('rw-sp', 'Rw desde el SP: x', { zoneId: 'c' }))).toBe('rw-sp|module-warning|c|Rw desde el SP: x');
    expect(diagnosticFingerprint(w(undefined, 'Zonas superpuestas'))).toBe('|zones||Zonas superpuestas');
    // Mismo texto en otra zona, o con otro número: otra huella.
    expect(diagnosticFingerprint(w('m', 'm: 3', { zoneId: 'a' }))).not.toBe(diagnosticFingerprint(w('m', 'm: 3', { zoneId: 'b' })));
    expect(diagnosticFingerprint(w('m', 'm: 3 muestras'))).not.toBe(diagnosticFingerprint(w('m', 'm: 30 muestras')));
  });

  it('quita el prefijo del módulo sin tocar símbolos', () => {
    expect(stripModulePrefix('Rw desde el SP: en la zona C, el SP…', 'Rw desde el SP')).toBe('En la zona C, el SP…');
    expect(stripModulePrefix("'Rw desde el SP': falta X", 'Rw desde el SP')).toBe('Falta X');
    expect(stripModulePrefix('Módulo: φ sin dato', 'Módulo')).toBe('φ sin dato');
    expect(stripModulePrefix('Módulo: kH nulo', 'Módulo')).toBe('kH nulo');
    expect(stripModulePrefix('Otro texto', 'Módulo')).toBe('Otro texto');
    expect(stripModulePrefix('Algo', null)).toBe('Algo');
  });
});

describe('agrupado por paso y módulo', () => {
  const diags: Diagnostic[] = [
    w('misc', 'Varios: a'),
    w('rw-sp', 'Rw desde el SP: en la zona B, x', { zoneId: 'b' }),
    w('igr', 'Índice de GR: y'),
    w(undefined, 'Zonas: hueco entre A y B'),
    w('sed', 'Columna sedimentológica: z'),
    w('rw-sp', 'Rw desde el SP: en la zona A, x', { zoneId: 'a' }),
    { level: 'error', code: 'compute-error', moduleId: 'igr', message: "Error al calcular 'Índice de GR': boom" },
    w('desconocido', 'desconocido: q'),
  ];

  it('General primero, pasos en orden del flujo (activo primero), Otros módulos al final', () => {
    const g = groupDiagnostics(diags, MODS, flows);
    expect(g.map((x) => x.id)).toEqual(['general', 'shale', 'rw', 'geology', 'other']);
    expect(g.map((x) => x.title)).toEqual(['General', 'Arcilla', 'Rw', 'Geología', 'Otros módulos']);
    expect(g[0]!.modules[0]!.moduleId).toBeNull();
    expect(g[4]!.modules.map((m) => m.moduleId)).toEqual(['misc', 'desconocido']);
    // Con Geología activa, sus pasos van primero.
    const geo = groupDiagnostics(diags, MODS, [flows[1]!, flows[0]!]);
    expect(geo.map((x) => x.id)).toEqual(['general', 'geology', 'shale', 'rw', 'other']);
  });

  it('cuenta por gravedad y ordena errores primero y vistos al final', () => {
    const seen = new Set([diagnosticFingerprint(diags[5]!)]);
    const g = groupDiagnostics(diags, MODS, flows, seen);
    const shale = g.find((x) => x.id === 'shale')!;
    expect(shale.counts).toEqual({ error: 1, warning: 1, info: 0 });
    expect(shale.modules[0]!.items[0]!.diagnostic.level).toBe('error');
    const rw = g.find((x) => x.id === 'rw')!;
    expect(rw.modules[0]!.items.map((i) => [i.diagnostic.zoneId, i.seen])).toEqual([
      ['b', false],
      ['a', true],
    ]);
    expect(rw.counts.warning).toBe(2);
    expect(rw.unseen.warning).toBe(1);
    expect(rw.modules[0]!.items[0]!.text).toBe('En la zona B, x');
    expect(rw.modules[0]!.target).toEqual({ moduleId: 'rw-sp', workspace: 'petrophysics', step: { id: 'rw', label: 'Rw' } });
  });

  it('destino de un módulo: su paso, en su espacio de trabajo; sin paso, vista libre', () => {
    expect(moduleTarget(MODS[2]!, flows)).toEqual({ moduleId: 'sed', workspace: 'geology', step: { id: 'geology', label: 'Geología' } });
    expect(moduleTarget(MODS[3]!, flows)).toEqual({ moduleId: 'misc', workspace: 'petrophysics', step: null });
  });

  it('filtros por gravedad y «ocultar vistos»; plegado por defecto con más de 10 avisos', () => {
    const seen = new Set([diagnosticFingerprint(diags[5]!), diagnosticFingerprint(diags[1]!)]);
    const g = groupDiagnostics(diags, MODS, flows, seen);
    const noWarnings = filterGroups(g, { hiddenLevels: ['warning'], hideSeen: false });
    expect(noWarnings.map((x) => x.id)).toEqual(['shale']);
    expect(noWarnings[0]!.total).toBe(1);
    const unseen = filterGroups(g, { hiddenLevels: [], hideSeen: true });
    expect(unseen.some((x) => x.id === 'rw')).toBe(false);
    expect(defaultCollapsed(g).size).toBe(0);
    const many = groupDiagnostics([...diags, ...Array.from({ length: 5 }, (_, i) => w('misc', `Varios: n${i}`))], MODS, flows);
    expect([...defaultCollapsed(many)].sort()).toEqual(['general', 'geology', 'other', 'rw']);
  });

  it('insignia: cuenta los no vistos', () => {
    expect(countUnseen(diags, undefined)).toBe(diags.length);
    expect(countUnseen(diags, [diagnosticFingerprint(diags[0]!), 'huella-vieja'])).toBe(diags.length - 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Marcas «visto» en el proyecto

describe('marcas «visto» por pozo', () => {
  const demo = syntheticWell();
  const base = addWell(createProject('TP'), demo.well, demo.zones);
  const id = demo.well.id;

  it('marca, desmarca y poda las huellas que ya no existen', () => {
    let p = setDiagnosticSeen(base, id, 'f1', true, ['f1', 'f2']);
    expect(getWellEntry(p, id).seenDiagnostics).toEqual(['f1']);
    expect(getWellEntry(p, id).interpretation).toBe(getWellEntry(base, id).interpretation);
    p = setDiagnosticSeen(p, id, 'f2', true, ['f1', 'f2']);
    expect(getWellEntry(p, id).seenDiagnostics).toEqual(['f1', 'f2']);
    // f1 ya no existe: se poda al marcar otro.
    p = setDiagnosticSeen(p, id, 'f3', true, ['f2', 'f3']);
    expect(getWellEntry(p, id).seenDiagnostics).toEqual(['f2', 'f3']);
    p = setDiagnosticSeen(p, id, 'f2', false, ['f2', 'f3']);
    expect(getWellEntry(p, id).seenDiagnostics).toEqual(['f3']);
    p = setDiagnosticSeen(p, id, 'f3', false, ['f2', 'f3']);
    expect('seenDiagnostics' in getWellEntry(p, id)).toBe(false);
    // Sin cambios: mismo proyecto.
    expect(setDiagnosticSeen(p, id, 'f3', false, ['f3'])).toBe(p);
  });

  it('lee el campo de un archivo con tolerancia', () => {
    expect(readSeenDiagnostics(undefined)).toBeUndefined();
    expect(readSeenDiagnostics('x')).toBeUndefined();
    expect(readSeenDiagnostics([])).toBeUndefined();
    expect(readSeenDiagnostics(['a', 3, 'a', '', 'b'])).toEqual(['a', 'b']);
  });

  it('serializa ida y vuelta con y sin seenDiagnostics (v6)', async () => {
    const p = setDiagnosticSeen(setParam(base, id, 'grClean', 25), id, 'igr|module-warning|z1|Índice: x', true, ['igr|module-warning|z1|Índice: x']);
    const text = await serializeProject(p, { codec: 'f64le-b64', savedAt: '2026-11-17T00:00:00.000Z' });
    const file = JSON.parse(text);
    expect(file.version).toBe(6);
    expect(file.project.wells[0].seenDiagnostics).toEqual(['igr|module-warning|z1|Índice: x']);
    const back = await deserializeProject(text);
    expect(getWellEntry(back, id).seenDiagnostics).toEqual(['igr|module-warning|z1|Índice: x']);
    // Sin el campo (archivo viejo): abre igual, sin vistos; y no se escribe si no hay marcas.
    const plain = JSON.parse(await serializeProject(base, { codec: 'f64le-b64' }));
    expect('seenDiagnostics' in plain.project.wells[0]).toBe(false);
    const old = await deserializeProject(JSON.stringify(plain));
    expect(getWellEntry(old, id).seenDiagnostics).toBeUndefined();
  });

  it('serializa ida y vuelta en v7 (con revisiones de entradas); un v7 sin el campo abre igual', async () => {
    const p0 = await deserializeProject(fixtureV7);
    const wid = p0.wells[0]!.well.id;
    expect(getWellEntry(p0, wid).seenDiagnostics).toBeUndefined();
    const p = setDiagnosticSeen(p0, wid, 'm|module-warning||m: x', true, ['m|module-warning||m: x']);
    const text = await serializeProject(p);
    expect(JSON.parse(text).version).toBe(7);
    const back = await deserializeProject(text);
    expect(getWellEntry(back, wid).seenDiagnostics).toEqual(['m|module-warning||m: x']);
  });
});
