/** Medición del cliente real sobre MessageChannel. Ejecutar el mismo script desde base y candidato. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
const output=process.argv[2];if(!output)throw new Error('Uso: node /ruta/scripts/qa/engine_context.mjs /tmp/protocolo.json');
const server=await createServer({root:process.cwd(),configFile:false,server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
let client;
try{
 const [clients,io,state,engine,modules]=await Promise.all([server.ssrLoadModule('/src/core/engine/client.ts'),server.ssrLoadModule('/src/io/index.ts'),server.ssrLoadModule('/src/core/state/project.ts'),server.ssrLoadModule('/src/core/engine/engine.ts'),server.ssrLoadModule('/src/modules/index.ts')]);
 const imported=io.readWellFile(await readFile(resolve('datos/pozo_tp_perfiles.csv'),'utf8'),'pozo_tp_perfiles.csv');
 const entry=state.addWell(state.createProject('Protocolo'),imported.well,imported.zones).wells[0];
 client=clients.createInProcessClient(modules.registry);client.syncWell(engine.toEngineWell(entry.well));
 const samples=[];let last;
 for(let i=-1;i<5;i++){
  const interpretation={...entry.interpretation,params:{global:{...entry.interpretation.params.global,grClean:25+i},zones:entry.interpretation.params.zones}};
  const done=new Promise((resolve,reject)=>{const off=client.subscribe(e=>{if(e.type==='result'){off();resolve(e.result);}else if(e.type==='error'){off();reject(new Error(e.message));}});});
  client.run(interpretation);last=await done;
  if(i>=0)samples.push(last.roundTripMs);
 }
 const hash=createHash('sha256');
 for(const o of last.outputs){hash.update(JSON.stringify([o.key,o.kind,o.unit??null,o.active]));if(o.value instanceof Float64Array)hash.update(new Uint8Array(o.value.buffer,o.value.byteOffset,o.value.byteLength));else hash.update(JSON.stringify(o.value));}
 hash.update(JSON.stringify([last.sources,last.candidates,last.diagnostics]));
 const sorted=[...samples].sort((a,b)=>a-b);
 const report={schemaVersion:1,measuredAt:new Date().toISOString(),scope:'Node/Vite SSR, motor completo, MessageChannel real: 1 warmup + 5 cambios secuenciales de GR limpio; no navegador ni Worker',samples:entry.well.depth.values.length,curves:entry.well.curves.length,roundTripMs:{samples,median:sorted[2],maximum:sorted[4]},scientificSHA256:hash.digest('hex'),inputBuffersIntact:entry.well.depth.values.byteLength===5810*8&&entry.well.curves.every(c=>c.data.byteLength===5810*8)};
 await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{client?.dispose();await server.close();}
