/** Línea base de persistencia/cálculo en Node. No mide UI, worker, navegador ni latencia de disco. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const output = process.argv[2];
if (!output) throw new Error('Uso: node scripts/qa/project_baseline.mjs /tmp/pozo-project-baseline.json');
const root = process.cwd();
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
try {
  const [{ deserializeProject, serializeProject }, { addWell, createProject }, { readWellFile }, { computeOnce, toEngineWell }, { registry }] = await Promise.all([
    server.ssrLoadModule('/src/core/state/serialize.ts'), server.ssrLoadModule('/src/core/state/project.ts'),
    server.ssrLoadModule('/src/io/index.ts'), server.ssrLoadModule('/src/core/engine/engine.ts'), server.ssrLoadModule('/src/modules/index.ts'),
  ]);
  const csv = await readFile(resolve(root, 'datos/pozo_tp_perfiles.csv'), 'utf8');
  const imported = readWellFile(csv, 'pozo_tp_perfiles.csv');
  const project = addWell(createProject('Base de rendimiento TP'), imported.well, imported.zones);
  const savedAt = '2026-10-01T00:00:00.000Z';
  const text = await serializeProject(project, { codec: 'auto', savedAt });
  const samples = { serializeMs: [], deserializeMs: [], computeMs: [] };
  const memory = [];
  // Una vuelta de calentamiento y cinco medidas; sin umbrales dependientes del equipo dentro de tests.
  for (let iteration = -1; iteration < 5; iteration++) {
    let t = performance.now();
    const saved = await serializeProject(project, { codec: 'auto', savedAt });
    const serializeMs = performance.now() - t;
    t = performance.now();
    const opened = await deserializeProject(saved);
    const deserializeMs = performance.now() - t;
    t = performance.now();
    const run = computeOnce(registry, toEngineWell(opened.wells[0].well), opened.wells[0].interpretation);
    const computeMs = performance.now() - t;
    if (run.stats.samples !== imported.well.depth.values.length) throw new Error('Corrida incompleta');
    if (iteration >= 0) {
      samples.serializeMs.push(serializeMs); samples.deserializeMs.push(deserializeMs); samples.computeMs.push(computeMs);
      memory.push(process.memoryUsage());
    }
  }
  const summarize = (values) => { const sorted = [...values].sort((a, b) => a - b); return { median: sorted[2], maximum: sorted[4], samples: values }; };
  const hashes = {};
  for (const path of ['src/core/state/serialize.ts', 'src/core/state/snapshots.ts', 'src/core/state/project.ts', 'datos/pozo_tp_perfiles.csv']) {
    hashes[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
  }
  const report = {
    schemaVersion: 1, measuredAt: new Date().toISOString(), scope: 'Node/Vite SSR, TP, codec auto, 1 warmup + 5 samples; no browser or worker',
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length, hostMemoryBytes: totalmem() },
    dataset: { samples: imported.well.depth.values.length, curves: imported.well.curves.length, zones: imported.zones.length, savedBytes: Buffer.byteLength(text), savedSHA256: createHash('sha256').update(text).digest('hex') },
    timings: Object.fromEntries(Object.entries(samples).map(([key, value]) => [key, summarize(value)])),
    sampledProcessMemory: { maximumRssBytes: Math.max(...memory.map((m) => m.rss)), maximumArrayBuffersBytes: Math.max(...memory.map((m) => m.arrayBuffers)), samples: memory, caveat: 'Muestras de todo el proceso con Vite/modelos cargados; no pico real ni memoria atribuible solo al proyecto. Sin GC forzado.' },
    hashes,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, dataset: report.dataset, timings: report.timings }, null, 2));
} finally { await server.close(); }
