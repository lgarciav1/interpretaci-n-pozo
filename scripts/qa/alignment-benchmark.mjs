/** Evaluación de alineación sintética, con referencias directas y sin Worker/UI. */
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const output=process.argv[2];if(!output)throw new Error('Uso: node scripts/qa/alignment-benchmark.mjs /tmp/alignment-metric.json');
const server=await createServer({root:process.cwd(),configFile:false,server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
try{
 const [wells,state,revisions,preparation,engine,evaluation,registries,plans]=await Promise.all(['/src/core/well.ts','/src/core/state/project.ts','/src/core/state/inputRevisions.ts','/src/core/state/preparation.ts','/src/core/engine/engine.ts','/src/core/preparation/evaluate.ts','/src/core/registry.ts','/src/core/preparation/plan.ts'].map(p=>server.ssrLoadModule(p)));
 const n=100000,values=Float64Array.from({length:n},(_,k)=>((k*48271)%100003)%100),depth=Float64Array.from({length:n},(_,k)=>k);
 let project=revisions.enableProjectInputRevisions(state.addWell(state.createProject(),wells.createWell({id:'benchmark',name:'Sintético',depth,curves:[{id:'GR',role:'GR',mnemonic:'GR',unit:'gAPI',origin:{kind:'measured'},data:values}]})));
 const original=project.wells[0].well,hashInput=()=>createHash('sha256').update(new Uint8Array(original.curves[0].data.buffer)).update(new Uint8Array(original.depth.values.buffer)).digest('hex'),before=hashInput();
 const registry=registries.createRegistry([]),evaluator=new evaluation.MaskEvaluator(),samples=[];let warmup,last;
 const run=async offsetM=>{
  const start=performance.now();project=preparation.setDepthShift(project,'benchmark','GR',{offsetM,maxGapM:1,referenceId:'benchmark',depthKind:'MD',datum:'MD local declarado'},'shift');
  const entry=project.wells[0],plan=preparation.entryPreparationPlan(project,entry,registry),artifacts=await evaluator.evaluate(engine.toEngineWell(entry.well),plan);plans.validatePreparedPayloads(plan,artifacts,n);return{payload:artifacts[0],elapsed:performance.now()-start};
 };
 for(let k=-1;k<7;k++){
  const offset=k+2,result=await run(offset);last=result.payload;if(k<0)warmup=result.elapsed;else samples.push(result.elapsed);
  for(let i=0;i<n;i++){const expected=i<offset?NaN:values[i-offset],q=i<offset?160:32;if(!(Number.isNaN(expected)&&Number.isNaN(last.data[i]))&&last.data[i]!==expected||last.quality[i]!==q)throw new Error('Referencia exacta no coincide en '+i);}
 }
 const fractional=await run(0.5);
 for(let i=0;i<n;i++){const expected=i===0?NaN:(values[i-1]+values[i])/2,q=i===0?160:40;if(!(Number.isNaN(expected)&&Number.isNaN(fractional.payload.data[i]))&&fractional.payload.data[i]!==expected||fractional.payload.quality[i]!==q)throw new Error('Referencia fraccional no coincide en '+i);}
 if(hashInput()!==before)throw new Error('Se modificaron originales.');
 await writeFile(output,JSON.stringify({schemaVersion:1,measuredAt:new Date().toISOString(),scope:'Node/Vite SSR: decisión/plan/evaluación/validación; 100000 muestras, sin petrofísica, Worker ni UI. Desplazamientos distintos sin hit de caché.',samples:n,elapsedMs:{warmup,samples,median:[...samples].sort((a,b)=>a-b)[3]},fractionalElapsedMs:fractional.elapsed,retainedArrayBytes:evaluator.retainedBytes,resultAndSharedScratchBytesPerArtifact:n*20,exactAndFractionalReferencesMatch:true,originalBytesAndBuffersIntact:true,exactScientificSHA256:createHash('sha256').update(new Uint8Array(last.data.buffer)).update(new Uint8Array(last.quality.buffer)).digest('hex'),fractionalScientificSHA256:createHash('sha256').update(new Uint8Array(fractional.payload.data.buffer)).update(new Uint8Array(fractional.payload.quality.buffer)).digest('hex')},null,2)+'\n');
}finally{await server.close();}
