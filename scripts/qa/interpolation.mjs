/** TP con huecos sintéticos explícitos para validar interpolación por UI/Worker. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const output = process.argv[2];
if (!output) throw new Error('Uso: node scripts/qa/interpolation.mjs /tmp/interpolation-seed');
await mkdir(output, { recursive: true });
const server = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
try {
  const [io, state, serializer] = await Promise.all(['/src/io/index.ts', '/src/core/state/project.ts', '/src/core/state/serialize.ts'].map(p => server.ssrLoadModule(p)));
  const imported = io.readWellFile(await readFile(resolve('datos/pozo_tp_perfiles.csv'), 'utf8'), 'TP.csv');
  const well = imported.well, gr = well.curves.find(c => c.role === 'GR');
  // No se alteran los datos del repositorio: sólo el fixture de ensayo.
  gr.data[999] = 10; gr.data[1000] = NaN; gr.data[1001] = NaN; gr.data[1002] = 22;
  gr.data.fill(NaN, 1100, 1111); gr.data[0] = NaN; gr.data[gr.data.length - 1] = NaN;
  const project = state.addWell(state.createProject('TP con huecos sintéticos'), well, imported.zones);
  await writeFile(resolve(output, 'legacy-baseline.pozo.json'), await serializer.serializeProject(project));
  const barrier = state.updateInterpretation(project, well.id, i => ({ ...i, zones: [...i.zones, { id: 'synthetic-zone', name: 'Frontera sintética', top: well.depth.values[1001], base: well.depth.values[1010], color: '#336699', kind: 'formation' }] }));
  await writeFile(resolve(output, 'zone-barrier.pozo.json'), await serializer.serializeProject(barrier));
  const depth = [...well.depth.values], meta = { wellId: well.id, grCurve: gr.id, depth, shortGap: [1000, 1001], left: 999, right: 1002, longGap: [1100, 1110], expected: [14, 18] };
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ seed: meta }, null, 2));
} finally { await server.close(); }
