/** Mismo medidor desde padre/candidato; modo mask compara además con NaN puestos independientemente. */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
const [output, mode = 'identity'] = process.argv.slice(2);
if (!output || !['identity', 'mask'].includes(mode)) throw new Error('Uso: node /ruta/scripts/qa/preparation.mjs /tmp/medicion.json [identity|mask]');
const server = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
let client;
const fingerprint = (result, sources = false) => {
  const hash = createHash('sha256');
  for (const o of result.outputs) { hash.update(JSON.stringify([o.key, o.kind, o.unit ?? null, o.active])); hash.update(o.value instanceof Float64Array ? new Uint8Array(o.value.buffer, o.value.byteOffset, o.value.byteLength) : JSON.stringify(o.value)); }
  if (sources) hash.update(JSON.stringify([result.sources, result.candidates, result.diagnostics]));
  return hash.digest('hex');
};
try {
  const [clients, io, state, engine, projection, modules] = await Promise.all(['/src/core/engine/client.ts', '/src/io/index.ts', '/src/core/state/project.ts', '/src/core/engine/engine.ts', '/src/core/preparation/projection.ts', '/src/modules/index.ts'].map(p => server.ssrLoadModule(p)));
  const preparation = existsSync(resolve('src/core/state/preparation.ts')) ? await server.ssrLoadModule('/src/core/state/preparation.ts') : null;
  const materialize = preparation ? (await server.ssrLoadModule('/src/core/preparation/plan.ts')).materializePreparation : null;
  const imported = io.readWellFile(await readFile(resolve('datos/pozo_tp_perfiles.csv'), 'utf8'), 'TP.csv');
  let project = state.addWell(state.createProject(), imported.well, imported.zones);
  const gr = imported.well.curves.find(c => c.role === 'GR');
  if (mode === 'mask') {
    if (!preparation) throw new Error('El padre no implementa P3.');
    project = preparation.addMaskInterval(project, imported.well.id, gr.id, { id: 'range', top: 7800, base: 7810 }, 'mask');
  }
  const entry = project.wells[0];
  const bytesHash = () => { const h = createHash('sha256'); for (const c of entry.well.curves) h.update(new Uint8Array(c.data.buffer, c.data.byteOffset, c.data.byteLength)); return h.digest('hex'); };
  const originalHash = bytesHash();
  const frame = i => {
    if (!preparation) return projection.resolveDataContext(entry.well, i, modules.registry);
    const e = { ...entry, interpretation: i }, plan = preparation.entryPreparationPlan(project, e, modules.registry);
    return { engineWell: engine.toEngineWell(e.well), context: plan.context, preparation: i.preparation?.nodes.length ? plan : undefined };
  };
  client = clients.createInProcessClient(modules.registry);
  const initial = frame(entry.interpretation); client.syncWell(initial.engineWell, initial.context);
  const samples = []; let last, lastInterpretation, warmup;
  for (let k = -1; k < 7; k++) {
    const i = { ...entry.interpretation, params: { global: { ...entry.interpretation.params.global, grClean: 25 + k }, zones: entry.interpretation.params.zones } };
    const ready = new Promise((resolve, reject) => { const off = client.subscribe(e => { if (e.type === 'result' || e.type === 'error') { off(); if (e.type === 'result') resolve(e.result); else reject(new Error(e.message)); } }); });
    const start = performance.now(), data = frame(i); client.run(i, data.context, data.preparation); last = await ready;
    if (last.preparation) materialize(entry.well, last.preparation, last.context, modules.registry);
    const elapsed = performance.now() - start; if (k >= 0) samples.push(elapsed); else warmup = elapsed;
    lastInterpretation = i;
  }
  let referenceSHA256;
  if (mode === 'mask') {
    const raw = { ...entry.well, curves: entry.well.curves.map(c => c.id !== gr.id ? c : { ...c, data: Float64Array.from(c.data, (v, k) => entry.well.depth.values[k] >= 7800 && entry.well.depth.values[k] <= 7810 ? NaN : v) }) };
    const { preparation: _recipe, ...interpretation } = lastInterpretation;
    const reference = new engine.Engine(modules.registry); reference.setWell(engine.toEngineWell(raw));
    referenceSHA256 = fingerprint(reference.run({ ...interpretation, sources: { ...interpretation.sources, GR: { kind: 'curve', curveId: gr.id } } }));
    if (referenceSHA256 !== fingerprint(last)) throw new Error('El resultado no coincide con la curva enmascarada de referencia.');
  }
  const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), mode, scope: 'Node/Vite SSR, TP completo: plan/proyección + motor/MessageChannel + reconstrucción de preparación; 1 warmup + 7 cambios de GR limpio. No navegador ni Worker.',
    samples: entry.well.depth.values.length, curves: entry.well.curves.length, elapsedMs: { warmup, samples, median: [...samples].sort((a,b) => a-b)[3] },
    scientificSHA256: fingerprint(last, mode === 'identity'), ...(referenceSHA256 ? { referenceSHA256, maskedOutputSHA256: fingerprint(last) } : {}), originalBytesUnchanged: originalHash === bytesHash(), inputBuffersIntact: entry.well.depth.values.byteLength === 5810 * 8 && entry.well.curves.every(c => c.data.byteLength === 5810 * 8) };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally { client?.dispose(); await server.close(); }
