/** Perfil y DRX sintéticos explícitos; valores de referencia independientes en fixture Python. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
const out=process.argv[2];if(!out)throw new Error('Uso: node scripts/qa/xrd-calibration-seed.mjs /tmp/p5-seed');await mkdir(out,{recursive:true});
const server=await createServer({root:process.cwd(),configFile:false,server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
try{
 const [well,state,revisions,ser]=await Promise.all(['/src/core/well.ts','/src/core/state/project.ts','/src/core/state/inputRevisions.ts','/src/core/state/serialize.ts'].map(s=>server.ssrLoadModule(s)));
 const known=JSON.parse(await readFile('tests/fixtures/xrd-gr-known.json','utf8'));
 const depth=Float64Array.from({length:401},(_,i)=>i),gr=Float64Array.from(depth,z=>25+110*((z%60)/60));
 const rows=['MD;ID;Q;C;UC;LC'];for(let i=0;i<18;i++){const d=10+10*i,c=known.igr[i%6];gr[d]=25+110*c;rows.push([d,'S'+i,1-c,c,.01,.002].join(';'));}
 rows.push([10,'S0-rep',.95,.05,.01,.002].join(';'));rows.push('185;CENSURADA;1;<0.002;;0.002');
 let project=state.addWell(state.createProject('P5 · perfil/DRX sintéticos de QA'),well.createWell({id:'w',name:'Pozo QA sintético P5',depth,curves:[{id:'gr',mnemonic:'GR',role:'GR',unit:'gAPI',origin:{kind:'measured',source:'QA sintético independiente'},data:gr}]}),[{id:'z',name:'Zona QA',top:0,base:200,color:'#009688',kind:'formation'},{id:'other',name:'Otra zona',top:210,base:400,color:'#f57c00',kind:'formation'}]);
 project=state.updateInterpretation(project,'w',i=>({...i,params:{global:{vshCutoff:.5,phiCutoff:.1,swCutoff:.6},zones:{z:{grClean:50,grShale:160,'vsh.method':'linear',vshCutoff:.37},other:{grClean:60,grShale:170,'vsh.method':'steiber'}}}}));
 project=revisions.enableProjectInputRevisions(project);
 await writeFile(out+'/seed.pozo.json',await ser.serializeProject(project));await writeFile(out+'/lab.csv',rows.join('\n'));await writeFile(out+'/meta.json',JSON.stringify({description:'Datos sintéticos, no DRX real',rows:20,locations:18,known:{clean:25,shale:135}},null,2));
}finally{await server.close();}
