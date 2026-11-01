/** Semilla revisada y medición Node de v7. No mide UI ni worker; no escribe datos de producción. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
const output=process.argv[2]; if(!output) throw new Error('Uso: node scripts/qa/archive_v7.mjs /tmp/pozo-v7');
await mkdir(output,{recursive:true});
const server=await createServer({root:process.cwd(),configFile:false,server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
try {
 const [ser,state,rev,snaps,points,io,engine,modules]=await Promise.all([
  server.ssrLoadModule('/src/core/state/serialize.ts'),server.ssrLoadModule('/src/core/state/project.ts'),server.ssrLoadModule('/src/core/state/inputRevisions.ts'),server.ssrLoadModule('/src/core/state/snapshots.ts'),server.ssrLoadModule('/src/core/pointSets.ts'),server.ssrLoadModule('/src/io/index.ts'),server.ssrLoadModule('/src/core/engine/engine.ts'),server.ssrLoadModule('/src/modules/index.ts')]);
 const imported=io.readWellFile(await readFile(resolve('datos/pozo_tp_perfiles.csv'),'utf8'),'pozo_tp_perfiles.csv');
 const well=imported.well;
 well.pointSets=[points.createPointSet({id:'core-v7',kind:'core',name:'Corona de validación',depth:Float64Array.of(well.depth.values[100]),pointIds:['plug-1'],columns:{phi:{label:'Porosidad',unit:'v/v',values:Float64Array.of(0.2)},quality:{label:'Calidad',values:['aceptada']}}})];
 let legacy=state.addWell(state.createProject('Validación TP v7'),well,imported.zones);
 legacy=state.setParam(legacy,well.id,'grClean',25);
 let project=rev.enableProjectInputRevisions(legacy);
 const baseline=project;
 project=snaps.createSnapshot(project,well.id,'Entradas originales',{id:'original-inputs',createdAt:'2026-10-29T00:00:00.000Z'}).project;
 const root=state.getWellEntry(project,well.id).inputRevisionId;
 project=state.updateWell(project,well.id,d=>{const gr=d.curves.find(c=>c.role==='GR');for(let i=0;i<gr.data.length;i++)if(Number.isFinite(gr.data[i]))gr.data[i]+=20;d.pointSets[0].columns.phi.values[0]=0.4;return d;});
 project=state.setParam(project,well.id,'grClean',50);
 const options={codec:'auto',savedAt:'2026-10-29T00:00:00.000Z'};
 const text=await ser.serializeProject(project,options);
 await writeFile(resolve(output,'legacy-baseline.pozo.json'),await ser.serializeProject(legacy,options));
 await writeFile(resolve(output,'tp-v7.pozo.json'),text);
 const back=await ser.deserializeProject(text);
 const restored=snaps.restoreSnapshot(back,'original-inputs');
 // structuredClone normaliza solo los prototipos de diccionarios; conserva typed arrays y sus bytes.
 assert.deepEqual(structuredClone(state.getWellEntry(restored,well.id).well),structuredClone(state.getWellEntry(baseline,well.id).well));
 const strip=r=>({sources:r.sources,candidates:r.candidates,diagnostics:r.diagnostics,outputs:r.outputs.map(({key,kind,port,active,value})=>({key,kind,port,active,value}))});
 assert.deepEqual(strip(engine.computeOnce(modules.registry,engine.toEngineWell(well),state.getWellEntry(legacy,well.id).interpretation)),strip(engine.computeOnce(modules.registry,engine.toEngineWell(state.getWellEntry(restored,well.id).well),state.getWellEntry(restored,well.id).interpretation)));
 const data={legacy:{save:[],open:[]},v7:{save:[],open:[]}};
 for(let iteration=-1;iteration<5;iteration++)for(const [key,p] of [['legacy',legacy],['v7',baseline]]) {
   let t=performance.now();const saved=await ser.serializeProject(p,options);const save=performance.now()-t;
   t=performance.now();await ser.deserializeProject(saved);const open=performance.now()-t;
   if(iteration>=0){data[key].save.push(save);data[key].open.push(open);}
 }
 const median=v=>[...v].sort((a,b)=>a-b)[2];
 const baseRaw=JSON.parse(await ser.serializeProject(baseline,options));
 const acq=structuredClone(baseline.inputRevisions[root].acquisition);acq.depth.datum='KB';
 const same=JSON.parse(await ser.serializeProject(rev.reviseProjectInputs(baseline,well.id,{acquisition:acq}),options));
 assert.deepEqual(baseRaw.project.blobs,same.project.blobs);
 const report={scope:'Node/Vite SSR; 1 warmup + 5 alternated legacy/v7 measurements; no browser/worker timing',parentRemoteCommit:'9df898ef2050f44e9219fc609e7daecc35b89cce',dataset:{samples:well.depth.values.length,curves:well.curves.length,pointSets:well.pointSets.length},seed:{file:'tp-v7.pozo.json',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),wellId:well.id,rootRevision:root,activeRevision:state.getWellEntry(project,well.id).inputRevisionId,grCurve:well.curves.find(c=>c.role==='GR').id,originalGrFirst:well.curves.find(c=>c.role==='GR').data[0],originalLabPhi:0.2,currentLabPhi:0.4},timings:data,medians:Object.fromEntries(Object.entries(data).map(([k,d])=>[k,{save:median(d.save),open:median(d.open)}])),unchangedAcquisition:{beforeBlobs:Object.keys(baseRaw.project.blobs).length,afterBlobs:Object.keys(same.project.blobs).length,beforeBytes:Object.values(baseRaw.project.blobs).reduce((s,b)=>s+b.byteLength,0),afterBytes:Object.values(same.project.blobs).reduce((s,b)=>s+b.byteLength,0)},scientificOutputsEqualAfterRestore:true};
 report.ratios={save:report.medians.v7.save/report.medians.legacy.save,open:report.medians.v7.open/report.medians.legacy.open};
 await writeFile(resolve(output,'evidence.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await server.close();}
