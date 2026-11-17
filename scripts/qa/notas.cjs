/** F05: recorrido offline con TP, notas por punto/tramo, teclado, arrastre, deshacer y recuperación. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const assert = require('assert/strict');
(async()=>{
 const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'notas-')), {executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', viewport:{width:1366,height:768},reducedMotion:'reduce',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=context.pages()[0]; page.setDefaultTimeout(60000); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
 if (!process.env.QA_URL) await context.setOffline(true);
 try {
 await page.goto(process.env.QA_URL || 'file://'+path.resolve('dist/index.html'));
 await context.setOffline(true);
 await page.getByTestId('home-load').press('Enter');
 await page.getByRole('button',{name:'Cargar datos del TP'}).press('Enter');
 await page.getByRole('button',{name:/Siguiente: control de calidad/}).press('Enter');
 await page.getByRole('button',{name:'Cargar',exact:true}).press('Enter');
 await page.getByTestId('home-enter').press('Enter'); await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
 const viewer=page.locator('.shell-viewer .wv-body');
 const open=async()=>{await viewer.focus(); await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'Notas de profundidad…'}).press('Enter');};
 console.log("Abrir notas"); await open();
 await page.getByLabel('Texto',{exact:true}).fill('Arena limpia — revisar corona');
 await page.getByLabel('Profundidad / tope').fill('7900');
 await page.getByRole('button',{name:'Guardar nota',exact:true}).press('Enter');
 await page.getByLabel('Texto',{exact:true}).fill('Intervalo con derrumbe\nComparar densidad y neutrón');
 await page.getByLabel('Profundidad / tope').fill('7950');await page.getByLabel('Base opcional').fill('7975');
 await page.getByRole('button',{name:'Guardar nota',exact:true}).press('Enter');
 assert.equal(await page.locator('.depth-notes__row').count(),2);
 await page.getByRole('button',{name:'Cerrar',exact:true}).last().press('Enter');
 console.log("Mover con teclado"); const note=page.locator('.wv-target').filter({hasText:'Arena limpia'});
 await note.focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
 assert.ok(!(await note.getAttribute('aria-label')).includes('7900.00'));
 await viewer.focus();await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
 assert.ok((await note.getAttribute('aria-label')).includes('7900.00'));
 console.log("Arrastrar nota");
 const box=await viewer.boundingBox();
 const range=await page.getByTestId('viewer-visible').evaluate(el=>({top:Number(el.dataset.top),base:Number(el.dataset.base)}));
 const y=box.y+(7900-range.top)/(range.base-range.top)*box.height+6;
 await page.mouse.move(box.x+22,y);await page.mouse.down();await page.mouse.move(box.x+22,y+24,{steps:8});await page.mouse.up();await page.waitForTimeout(300);
 assert.ok(!(await note.getAttribute('aria-label')).includes('7900.00'),'arrastre cambia la profundidad');
 await viewer.focus();await page.keyboard.press('Control+z');await page.waitForTimeout(200);
 assert.ok((await note.getAttribute('aria-label')).includes('7900.00'));
 console.log("Editar y borrar");
 // Edición y borrado reversibles.
 console.log("Abrir notas"); await open(); await page.locator('.depth-notes__row > button').filter({hasText:'Arena limpia'}).press('Enter');
 await page.getByLabel('Texto',{exact:true}).fill('Arena limpia — nota revisada');await page.getByRole('button',{name:'Guardar nota',exact:true}).press('Enter');
 await page.locator('.depth-notes__row').filter({hasText:'nota revisada'}).getByRole('button',{name:'Borrar'}).press('Enter');
 await page.getByRole('button',{name:'Cerrar',exact:true}).last().press('Enter'); await viewer.focus();await page.keyboard.press('Control+z');
 console.log("Recargar"); await page.waitForTimeout(4000);if(process.env.QA_URL) await context.setOffline(false);await page.reload();await context.setOffline(true);await page.waitForTimeout(1000);
 console.log("Recuperar"); const resume=page.getByRole('button',{name:/Seguir donde quedaste/});await resume.press('Enter');await page.getByTestId('home-enter').press('Enter');await page.keyboard.press('Escape');await page.waitForTimeout(1500);
 console.log("Abrir notas"); await open();assert.equal(await page.locator('.depth-notes__row').count(),2);assert.ok(await page.getByText('Arena limpia — nota revisada',{exact:true}).count());await page.getByRole('button',{name:'Cerrar',exact:true}).last().press('Enter');
 fs.mkdirSync('docs/capturas/notas',{recursive:true});
 for(const theme of ['light','dark']) { await page.keyboard.press('Control+k');await page.locator('.ui-cmd input[role=combobox]').fill(theme === 'light' ? 'Usar el tema claro' : 'Usar el tema oscuro');await page.locator(`[data-testid="cmd-theme:${theme}"]`).press('Enter');await page.waitForTimeout(300);await page.screenshot({path:`docs/capturas/notas/${theme}.png`}); }
 assert.deepEqual(errors,[]);console.log('OK: TP offline después de carga; crear punto/tramo, mover por teclado y arrastre, deshacer, editar, borrar, recuperar y capturas 1366×768.');
 } catch(e) { console.log(await page.locator('[role=dialog]').allTextContents());await page.screenshot({path:'/workspace/scratch/f05-failure.png'});throw e; } finally {await context.close();}
})().catch(e=>{console.error(e);process.exit(1)});
