/** Ejecuta el lector real de P5a contra recibos v1/v2, sin modificar su contrato. */
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
const out=process.argv[2]??'/tmp/p5b-browser';const path='src/core/preparation/__qa_legacy_gr_p5a.ts';if(existsSync(path))throw new Error('El archivo temporal ya existe; no se sobrescribe.');
const source=execFileSync('git',['show','2e487cb:src/core/preparation/xrdCalibration.ts'],{encoding:'utf8'});let server;
try{
 await writeFile(path,source);server=await createServer({root:process.cwd(),configFile:false,server:{middlewareMode:true,watch:null,ws:false},appType:'custom'});
 const old=await server.ssrLoadModule('/'+path),legacy=JSON.parse(await readFile('tests/fixtures/xrd-gr-calibration-v1.json','utf8'));
 if(old.readGrCalibration(JSON.stringify(legacy)).version!==1)throw new Error('El lector original no reconoce su recibo v1.');
 const project=JSON.parse(await readFile(out+'/linear-clean/applied.pozo.json','utf8'));const record=project.project.wells[0].interpretation.pointSets.lab.settings['xrd:gr-calibration:z'];let rejected=false;
 try{old.readGrCalibration(record);}catch(e){if(!String(e.message).includes('Versión de calibración GR desconocida'))throw e;rejected=true;}
 if(!rejected)throw new Error('P5a no debe interpretar silenciosamente la evidencia restringida v2.');
 await writeFile(out+'/compatibility.json',JSON.stringify({originalReader:'2e487cb',legacyV1Accepted:true,newV2RejectedExplicitly:true,projectContainer:7},null,2));
}finally{await server?.close();if(existsSync(path))await unlink(path);}
