/** TP con señal y hueco sintéticos para validar la mediana física por UI. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
const output = process.argv[2]; if (!output) throw new Error('Uso: node scripts/qa/filtering.mjs /tmp/filter-seed');
await mkdir(output, { recursive: true });
const server = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
try {
 const [io, state, preparation, serializer] = await Promise.all(['/src/io/index.ts','/src/core/state/project.ts','/src/core/state/preparation.ts','/src/core/state/serialize.ts'].map(p => server.ssrLoadModule(p)));
 const imported = io.readWellFile(await readFile('datos/pozo_tp_perfiles.csv','utf8'), 'TP.csv'), well = imported.well, gr = well.curves.find(c => c.role === 'GR');
 const signal = [0,10,20,100,30,40,50,60,70]; gr.data.set(signal,997);
 const project = state.addWell(state.createProject('TP con señal sintética para filtro'), well, imported.zones);
 await writeFile(output+'/legacy-baseline.pozo.json', await serializer.serializeProject(project));
 const gapped = { ...well, curves: well.curves.map(c => c.id === gr.id ? { ...c, data: c.data.slice() } : c) }; gapped.curves.find(c => c.id === gr.id).data[999] = NaN;
 const depth = [...well.depth.values];
 const pipeline = preparation.setGapFill(state.addWell(state.createProject('TP interpolado para filtrar'), gapped, imported.zones),well.id,gr.id,{top:depth[997],base:depth[1005],maxGapM:1},'fill');
 await writeFile(output+'/interpolated.pozo.json',await serializer.serializeProject(pipeline));
 const barrier = state.updateInterpretation(project,well.id,i=>({...i,zones:[...i.zones,{id:'barrier',name:'Frontera sintética',top:depth[1001],base:depth[1010],color:'#336699',kind:'formation'}]}));
 await writeFile(output+'/zone-barrier.pozo.json',await serializer.serializeProject(barrier));
 await writeFile(output+'/evidence.json',JSON.stringify({seed:{wellId:well.id,grCurve:gr.id,depth,signal,top:997,base:1005,filteredIndices:[999,1000,1001,1002,1003],expected:[0,10,20,30,40,40,50,60,70],pipelineExpected:[0,10,55,55,40,40,50,60,70]}},null,2));
} finally { await server.close(); }
