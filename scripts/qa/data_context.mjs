/** Mismo ensayo en padre y candidato: proyección + motor/MessageChannel reales sobre TP completo. */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const output = process.argv[2];
if (!output) throw new Error('Uso: node /ruta/scripts/qa/data_context.mjs /tmp/medicion.json');
const server = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
let client;
try {
  const [clients, io, state, engine, context, modules] = await Promise.all(['engine/client', 'io', 'state/project', 'engine/engine', 'engine/context', 'modules'].map(p =>
    server.ssrLoadModule(p === 'io' || p === 'modules' ? `/src/${p}/index.ts` : `/src/core/${p}.ts`)));
  const projection = existsSync(resolve('src/core/preparation/projection.ts')) ? await server.ssrLoadModule('/src/core/preparation/projection.ts') : null;
  const imported = io.readWellFile(await readFile(resolve('datos/pozo_tp_perfiles.csv'), 'utf8'), 'TP.csv');
  const entry = state.addWell(state.createProject(), imported.well, imported.zones).wells[0];
  const dataOf = i => projection ? projection.resolveDataContext(entry.well, i, modules.registry) : {
    engineWell: engine.toEngineWell(entry.well), context: context.engineContext(engine.toEngineWell(entry.well), i),
  };
  client = clients.createInProcessClient(modules.registry);
  const initial = dataOf(entry.interpretation); client.syncWell(initial.engineWell, initial.context);
  const samples = []; let last;
  for (let k = -1; k < 7; k++) {
    const i = { ...entry.interpretation, params: { global: { ...entry.interpretation.params.global, grClean: 25 + k }, zones: entry.interpretation.params.zones } };
    const done = new Promise((resolve, reject) => { const off = client.subscribe(e => { if (e.type === 'result' || e.type === 'error') { off(); if (e.type === 'result') resolve(e.result); else reject(new Error(e.message)); } }); });
    const start = performance.now(), data = dataOf(i); client.run(i, data.context); last = await done;
    if (k >= 0) samples.push(performance.now() - start);
  }
  const hash = createHash('sha256');
  for (const o of last.outputs) { hash.update(JSON.stringify([o.key, o.kind, o.unit ?? null, o.active])); hash.update(o.value instanceof Float64Array ? new Uint8Array(o.value.buffer, o.value.byteOffset, o.value.byteLength) : JSON.stringify(o.value)); }
  hash.update(JSON.stringify([last.sources, last.candidates, last.diagnostics]));
  const sorted = [...samples].sort((a, b) => a - b);
  const result = { schemaVersion: 1, measuredAt: new Date().toISOString(), scope: 'Node/Vite SSR: proyección de identidad + motor completo/MessageChannel; 1 warmup + 7 cambios de GR limpio, no navegador ni Worker',
    samples: entry.well.depth.values.length, curves: entry.well.curves.length, elapsedMs: { samples, median: sorted[3] },
    scientificSHA256: hash.digest('hex'), inputBuffersIntact: entry.well.depth.values.byteLength === 5810 * 8 && entry.well.curves.every(c => c.data.byteLength === 5810 * 8) };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} finally { client?.dispose(); await server.close(); }
