/** F22: HTML único, TP real, worker offline, aplicar/snapshot/deshacer, 1366×768. */
const { chromium }=require('playwright');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
async function palette(page,text){await page.keyboard.press('Control+k');await page.locator('.ui-cmd input[role=combobox]').fill(text);await page.keyboard.press('Enter');}
(async()=>{
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'f22-')),{executablePath:'/usr/bin/chromium',viewport:{width:1366,height:768},reducedMotion:'reduce',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=context.pages()[0];page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try {
 await page.goto(process.env.QA_URL||'file://'+path.resolve('dist/index.html'));
 await context.setOffline(true);
 console.log('Paso',new Date().toISOString()); await page.getByTestId('home-load').press('Enter');
 console.log('Paso',new Date().toISOString()); await page.getByRole('button',{name:'Cargar datos del TP',exact:true}).press('Enter');
 console.log('Paso',new Date().toISOString()); await page.getByRole('button',{name:/Siguiente: control de calidad/}).press('Enter');
 console.log('Paso',new Date().toISOString()); await page.getByRole('button',{name:'Cargar',exact:true}).press('Enter');
 console.log('Paso',new Date().toISOString()); await page.getByTestId('home-enter').press('Enter');await page.keyboard.press('Escape');
 console.log('Abriendo torneo');await palette(page,'Abrir la pestaña Torneo');
 const panel=page.getByTestId('model-tournament');
 await panel.getByRole('button',{name:'Revisar corona',exact:true}).press('Enter');
 console.log('Paso',new Date().toISOString()); await page.getByRole('button',{name:'Cargar corona del TP',exact:true}).press('Enter');
 console.log('Abriendo torneo');await palette(page,'Abrir la pestaña Torneo');
 await page.getByTestId('panel-expand').press('Enter');
 const start=Date.now();await panel.getByRole('button',{name:'Calcular combinaciones',exact:true}).press('Enter');
 await panel.getByTestId('tournament-table').waitFor({timeout:90000});console.log('Torneo ms',Date.now()-start);
 await panel.locator('tbody tr').first().click();
 console.log(await panel.innerText());
 assert.ok(await panel.getByRole('button',{name:'Aplicar combinación y guardar snapshot',exact:true}).isEnabled());
 fs.mkdirSync('docs/capturas/torneo',{recursive:true});
 for(const close of await page.getByRole('button',{name:'Cerrar aviso',exact:true}).all()) await close.click();
 for(const theme of ['light','dark']){
 await palette(page,theme==='light'?'Usar el tema claro':'Usar el tema oscuro');
 await page.screenshot({path:`docs/capturas/torneo/tp-${theme}.png`});
 await panel.getByRole('button',{name:'Aplicar combinación y guardar snapshot',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`docs/capturas/torneo/limites-${theme}.png`});
 await panel.getByRole('heading',{name:'Combinación seleccionada',exact:true}).scrollIntoViewIfNeeded();
 }
 await panel.getByRole('button',{name:'Aplicar combinación y guardar snapshot',exact:true}).press('Enter');
 await panel.getByText('El contexto cambió. Volvé a calcular antes de aplicar.').waitFor();
 await page.locator('.shell-viewer .wv-body').focus();await page.keyboard.press('Control+z');
 assert.ok(await panel.getByRole('button',{name:'Aplicar combinación y guardar snapshot',exact:true}).isEnabled());
 console.log('Aplicar, snapshot y deshacer sin red: OK');
 assert.deepEqual(errors,[]);
 }catch(e){await page.screenshot({path:'/workspace/scratch/f22-failure.png'});console.log((await page.locator('body').innerText()).slice(-16000));throw e;}finally{await context.close();}
})().catch(e=>{console.error(e);process.exit(1)});
