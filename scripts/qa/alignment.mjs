/** TP con evento/laboratorio sintéticos, para validar signo, cobertura y referencia MD. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
const output=process.argv[2];if(!output)throw new Error('Uso: node scripts/qa/alignment.mjs /tmp/alignment-seed');
await mkdir(output,{recursive:true});
const server=await createServer({root:process.cwd(),configFile:false,server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
try{
 const [io,state,ser,points,inputs]=await Promise.all(['/src/io/index.ts','/src/core/state/project.ts','/src/core/state/serialize.ts','/src/core/pointSets.ts','/src/core/state/inputRevisions.ts'].map(p=>server.ssrLoadModule(p)));
 const imported=io.readWellFile(await readFile('datos/pozo_tp_perfiles.csv','utf8'),'TP.csv'),well=imported.well,gr=well.curves.find(c=>c.role==='GR'),peer=well.curves.find(c=>c.role==='RT');
 gr.data.set([10,10,10,100,10,10,10,10,10],997);
 well.pointSets=[points.createPointSet({id:'lab',kind:'core',name:'Corona sintética',depth:Float64Array.of(well.depth.values[1000]),pointIds:['plug'],columns:{phi:{label:'Porosidad',unit:'v/v',values:Float64Array.of(0.2)}}})];
 const project=state.addWell(state.createProject('TP con evento sintético para alineación'),well,imported.zones);
 await writeFile(output+'/legacy-baseline.pozo.json',await ser.serializeProject(project));
 const versioned=inputs.enableProjectInputRevisions(project),entry=versioned.wells[0],revision=versioned.inputRevisions[entry.inputRevisionId];
 const known=inputs.reviseProjectInputs(versioned,well.id,{acquisition:{...revision.acquisition,depth:{kind:'MD',datum:'KB'}}});
 await writeFile(output+'/known-datum.pozo.json',await ser.serializeProject(known));
 await writeFile(output+'/evidence.json',JSON.stringify({seed:{wellId:well.id,grCurve:gr.id,peerMnemonic:peer.mnemonic.toUpperCase(),depth:[...well.depth.values],offsetM:0.3048,shiftSamples:2,eventSource:1000,eventTarget:1002,labDepth:well.depth.values[1000]}},null,2));
}finally{await server.close();}
