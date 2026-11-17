/** F20: HTML único, sin red tras cargar; sintético oculto/TP, recetas, fuentes, snapshots y capturas. */
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const synthetic=process.argv.includes('--synthetic');
async function palette(page,text){await page.keyboard.press('Control+k');await page.locator('.ui-cmd input[role=combobox]').fill(text);await page.keyboard.press('Enter');}
(async()=>{
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'f20-')),{executablePath:'/usr/bin/chromium',viewport:{width:1366,height:768},reducedMotion:'reduce',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=context.pages()[0];page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
 console.log('Abrir HTML');await page.goto(process.env.QA_URL||'file://'+path.resolve('dist/index.html'));
 await context.setOffline(true);
 await page.getByTestId('home-load').press('Enter');
 if(synthetic){
  const rows=['DEPTH,GR,DT,ZDEN'];for(let i=0;i<2000;i++){const z=i*.2,gr=80+50*Math.sin(z*.7),dt=90+30*Math.cos(z*.47),rho=z>=190&&z<200?'':2.2+.003*gr+.001*dt+.006*Math.sin(z*11);rows.push([z,gr,dt,rho].join(','));}
  const file=path.join(os.tmpdir(),'f20-sintetico.csv');fs.writeFileSync(file,rows.join('\n'));
  await page.getByTestId('well-file-input').setInputFiles(file);
 }else await page.getByRole('button',{name:'Cargar datos del TP'}).press('Enter');
 await page.getByRole('button',{name:/Siguiente: control de calidad/}).press('Enter');await page.getByRole('button',{name:'Cargar',exact:true}).press('Enter');await page.getByTestId('home-enter').press('Enter');await page.keyboard.press('Escape');
 await palette(page,'Abrir Preparar datos');await page.getByRole('tab',{name:/^Densidad/}).press('Enter');

 const panel=page.getByRole('region',{name:'Reconstrucción de densidad'});
 console.log('Panel Densidad abierto');const add=async(label,a,b)=>{await panel.getByLabel(`Tope ${label} (m MD)`).fill(String(a));await panel.getByLabel(`Tope ${label} (m MD)`).press('Enter');await panel.getByLabel(`Base ${label} (m MD)`).fill(String(b));await panel.getByLabel(`Base ${label} (m MD)`).press('Enter');await panel.getByRole('button',{name:label==='de buen pozo'?'Agregar buen pozo':'Agregar derrumbe',exact:true}).press('Enter');};
 if(synthetic){await add('de buen pozo',0,189.8);await add('de buen pozo',200,399.8);await add('del derrumbe',190,199.8);}else{await add('de buen pozo',7709.0016,8017.764);await add('del derrumbe',7681.722,7685.532);}
 await panel.getByLabel('GR confiable en todo el pozo, incluidos derrumbes',{exact:true}).check();await panel.getByLabel('DT confiable en todo el pozo, incluidos derrumbes',{exact:true}).check();await panel.getByLabel('Confirmo la fiabilidad de los predictores seleccionados').check();
 console.log('Intervalos',await panel.locator('li').allTextContents());console.log('Entrenar y validar');await panel.getByRole('button',{name:'Entrenar y validar',exact:true}).press('Enter');
 const report=panel.getByRole('region',{name:'Validación de densidad'});await report.waitFor();console.log(await report.innerText());
 if(!synthetic)assert.ok(await panel.getByRole('button',{name:'Guardar densidad preparada',exact:true}).isDisabled(),'TP acotado: R² insuficiente impide guardar');
 if(synthetic){
  assert.ok(await panel.getByRole('button',{name:'Guardar densidad preparada',exact:true}).isEnabled());
  await panel.getByRole('button',{name:'Guardar densidad preparada',exact:true}).press('Enter');
  await panel.getByRole('button',{name:'Guardar snapshot antes',exact:true}).press('Enter');
  await panel.getByRole('button',{name:'Usar densidad preparada',exact:true}).press('Enter');
  await panel.getByRole('button',{name:'Usar densidad original',exact:true}).waitFor({state:'visible'});
  await panel.getByRole('button',{name:'Comparar porosidad con cortina',exact:true}).press('Enter');
  await page.waitForTimeout(1500);
 }
 const out='docs/capturas/densidad';fs.mkdirSync(out,{recursive:true});
 for(const theme of ['light','dark']){await palette(page,theme==='light'?'Usar el tema claro':'Usar el tema oscuro');await report.scrollIntoViewIfNeeded();await page.waitForTimeout(300);await page.screenshot({path:`${out}/${synthetic?'sintetico':'tp'}-${theme}.png`});
  if(synthetic){await page.getByTestId('panel-expand').press('Enter');const curtain=page.getByTestId('viewer-curtain');await curtain.waitFor();await curtain.focus();await page.keyboard.press('ArrowRight');await page.screenshot({path:`${out}/cortina-${theme}.png`});await page.getByTestId('panel-expand').press('Enter');}
 }

 if(synthetic){
  await panel.getByRole('button',{name:'Usar densidad original',exact:true}).press('Enter');
  assert.ok(await panel.getByRole('button',{name:'Usar densidad original',exact:true}).isDisabled());
  await page.locator('.shell-viewer .wv-body').focus();await page.keyboard.press('Control+z');
  await panel.getByRole('button',{name:'Usar densidad original',exact:true}).press('Enter');
  await page.waitForTimeout(4000);if(process.env.QA_URL)await context.setOffline(false);await page.reload();await context.setOffline(true);
  await page.getByRole('button',{name:/Seguir donde quedaste/}).press('Enter');await page.getByTestId('home-enter').press('Enter');await page.keyboard.press('Escape');
  await palette(page,'Abrir Preparar datos');await page.getByRole('tab',{name:/^Densidad/}).press('Enter');
  await panel.getByRole('button',{name:'Usar densidad preparada',exact:true}).waitFor();
  console.log('Persistencia, restaurar original y deshacer: OK');
 }
 assert.deepEqual(errors,[]);console.log('OK F20',synthetic?'sintético':'TP');
 }catch(e){await page.screenshot({path:'/workspace/scratch/f20-failure.png'});console.log((await page.locator('body').innerText()).slice(-9000));throw e;}finally{await context.close();}
})().catch(e=>{console.error(e);process.exit(1)});
