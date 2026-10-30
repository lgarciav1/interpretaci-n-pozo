/** Ensayo de evaluación fría (versiones nuevas), sin Worker ni UI; referencia independiente de cinco valores. */
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
const output = process.argv[2]; if (!output) throw new Error('Uso: node scripts/qa/filtering-benchmark.mjs /tmp/filter-metric.json');
const server = await createServer({root:process.cwd(),configFile:false,server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
try {
 const [wells,state,revisions,preparation,plans,engine,evaluation,registries] = await Promise.all(['/src/core/well.ts','/src/core/state/project.ts','/src/core/state/inputRevisions.ts','/src/core/state/preparation.ts','/src/core/preparation/plan.ts','/src/core/engine/engine.ts','/src/core/preparation/evaluate.ts','/src/core/registry.ts'].map(p=>server.ssrLoadModule(p)));
 const n=100000, values=Float64Array.from({length:n},(_,k)=>((k*48271)%100003)%100), depth=Float64Array.from({length:n},(_,k)=>k*0.1524);
 const well=wells.createWell({id:'benchmark',name:'Sintético',depth,curves:[{id:'GR',mnemonic:'GR',role:'GR',unit:'gAPI',origin:{kind:'measured'},data:values}]});
 let project=revisions.enableProjectInputRevisions(state.addWell(state.createProject(),well));
 const original=project.wells[0].well, hashInput=()=>{const h=createHash('sha256');h.update(new Uint8Array(original.depth.values.buffer));h.update(new Uint8Array(original.curves[0].data.buffer));return h.digest('hex');}, before=hashInput();
 const registry=registries.createRegistry([]), evaluator=new evaluation.MaskEvaluator(), samples=[];let last, plan, warmup;
 for(let k=-1;k<7;k++){
  const start=performance.now();
  project=preparation.setMedianFilter(project,'benchmark','GR',{top:0,base:depth.at(-1),radiusM:0.31+(k+1)*0.0001,maxStepM:0.2},'filter');
  const entry=project.wells[0];plan=preparation.entryPreparationPlan(project,entry,registry);
  last=(await evaluator.evaluate(engine.toEngineWell(entry.well),plan))[0];
  plans.validatePreparedPayloads(plan,[last],n);
  const elapsed=performance.now()-start;if(k<0)warmup=elapsed;else samples.push(elapsed);
 }
 // Referencia directa por ordenación de cinco entradas; no reutiliza la ventana deslizante del filtro.
 for(let i=0;i<n;i++){
  let expected=values[i],q=0;
  if(i>=3&&i<n-3){expected=[values[i-2],values[i-1],values[i],values[i+1],values[i+2]].sort((a,b)=>a-b)[2];q=16;}
  if(last.data[i]!==expected||last.quality[i]!==q)throw new Error('No coincide con la referencia independiente en '+i);
 }
 if(hashInput()!==before)throw new Error('Se modificaron entradas.');
 const hash=createHash('sha256').update(new Uint8Array(last.data.buffer)).update(new Uint8Array(last.quality.buffer)).digest('hex');
 await writeFile(output,JSON.stringify({schemaVersion:1,measuredAt:new Date().toISOString(),scope:'Node/Vite SSR: decisión/plan/evaluador/validación de artefactos; 100000 muestras sintéticas, sin motor petrofísico, Worker ni UI. Versiones de radio distintas: no son hits de caché. Ventanas de cinco muestras y referencia directa independiente.',samples:n,filteredSamples:n-6,elapsedMs:{warmup,samples,median:[...samples].sort((a,b)=>a-b)[3]},retainedArrayBytes:evaluator.retainedBytes,resultAndScratchBytesPerArtifact:n*20,scientificSHA256:hash,independentReferenceMatches:true,originalBytesAndBuffersIntact:hashInput()===before},null,2)+'\n');
}finally{await server.close();}
