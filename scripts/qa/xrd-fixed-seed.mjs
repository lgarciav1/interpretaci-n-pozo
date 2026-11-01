/** Ensayos sintéticos con un extremo ausente. Referencia Python independiente, no DRX real. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
const out=process.argv[2];if(!out)throw new Error('Uso: node scripts/qa/xrd-fixed-seed.mjs /tmp/p5b-seed');await mkdir(out,{recursive:true});
const server=await createServer({root:process.cwd(),configFile:false,server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
try{
 const [w,state,input,ser,xrd]=await Promise.all(['/src/core/well.ts','/src/core/state/project.ts','/src/core/state/inputRevisions.ts','/src/core/state/serialize.ts','/src/core/preparation/xrd.ts'].map(p=>server.ssrLoadModule(p)));
 const golden=JSON.parse(await readFile('tests/fixtures/xrd-gr-fixed-known.json','utf8'));
 for(const [method,end] of [['linear','clean'],['linear','shale'],['clavier','clean']]){
  const g=golden.methods[method][end],depth=Float64Array.from({length:401},(_,i)=>i),gr=Float64Array.from(depth,z=>25+110*((z%60)/60)),samples=[];
  for(let i=0;i<18;i++){const d=10+10*i,c=g.targets[i%6];gr[d]=25+110*(g.gr[i%6]-30)/90;samples.push({id:'S'+i,top:d,values:{q:{value:1-c,status:'measured'},c:{value:c,status:'measured',uncertainty:.01,detectionLimit:.002}}});}
  samples.push({...samples[0],id:'S0-rep'});samples.push({id:'CENSURADA',top:185,values:{q:{value:1,status:'measured'},c:{value:NaN,status:'below-detection',detectionLimit:.002}}});
  const set=xrd.createXrdSet('lab','DRX sintético parcial '+method+' '+end,'Fixture Python independiente',{version:1,basis:'volume',scope:'whole-rock',scale:'fraction',closureTolerance:.01,report:'QA sintético con extremo ausente, no laboratorio real',referenceId:'w',datum:'KB declarado',uncertaintyNote:'Incertidumbre absoluta sintética, sin propagación estadística.',minerals:[{id:'q',name:'Q',clay:false},{id:'c',name:'C',clay:true}]},samples);
  let project=state.addWell(state.createProject('QA P5b sintético '+method+' '+end),w.createWell({id:'w',name:'Pozo sintético QA P5b',depth,curves:[{id:'gr',mnemonic:'GR',role:'GR',unit:'gAPI',origin:{kind:'measured',source:'Perfil sintético independiente'},data:gr}],pointSets:[set]}),[{id:'z',name:'Zona QA',top:0,base:200,color:'#009688',kind:'formation'},{id:'other',name:'Otra zona',top:210,base:400,color:'#f57c00',kind:'formation'}]);
  project=state.updateInterpretation(project,'w',i=>({...i,params:{global:{vshCutoff:.5,phiCutoff:.1,swCutoff:.6},zones:{z:{grClean:50,grShale:160,'vsh.method':'linear',vshCutoff:.37},other:{grClean:60,grShale:170,'vsh.method':'steiber'}}}}));project=input.enableProjectInputRevisions(project);
  await writeFile(`${out}/${method}-${end}.pozo.json`,await ser.serializeProject(project));
 }
}finally{await server.close();}
