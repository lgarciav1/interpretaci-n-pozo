"""Propuestas P3b: selección explícita, preview aislado y guardado reversible sobre TP."""
from pathlib import Path
exec(Path(__file__).with_name('archive_v7.py').read_text().split('with sync_playwright() as p:')[0])

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 ctx,page=page_for(browser,config.candidate,"""(()=>{const Native=Worker;window.__qaMainRuns=0;window.Worker=class extends Native{constructor(url,options){super(url,options);this.main=options?.name==='motor';}postMessage(m,t){if(this.main&&m.type==='run')window.__qaMainRuns++;return super.postMessage(m,t);}};})();""")
 open_file(page,config.seed/'legacy-baseline.pozo.json')
 baseline=save(page,'baseline.pozo.json');main_before=page.evaluate('__qaMainRuns')
 page.get_by_role('button',name='Preparar datos',exact=True).click()
 dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.get_by_role('textbox',name='Tope (m MD)',exact=True).fill('7800')
 dialog.get_by_role('textbox',name='Base (m MD)',exact=True).fill('7900')
 dialog.get_by_role('textbox',name='Desviación mínima',exact=True).fill('1')
 dialog.get_by_role('textbox',name='Separación máxima entre muestras',exact=True).fill('0.2')
 dialog.get_by_role('button',name='Buscar candidatos',exact=True).click()
 checkboxes=dialog.get_by_role('checkbox',name=re.compile('^Excluir muestra a '))
 expect(checkboxes.first).to_be_visible(timeout=60000)
 count=checkboxes.count();assert 0<count<256
 assert not checkboxes.first.is_checked()
 batch=dialog.get_by_role('button',name=re.compile('^Previsualizar exclusión de '))
 expect(batch).to_be_disabled()
 checkboxes.first.check();expect(batch).to_be_enabled();batch.click()
 apply=dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True)
 expect(apply).to_be_enabled(timeout=60000)
 # A different selection invalidates the ready preview.
 checkboxes.first.uncheck();expect(apply).to_be_disabled()
 checkboxes.first.check();batch.click();expect(apply).to_be_enabled(timeout=60000)
 assert page.evaluate('__qaMainRuns')==main_before
 dialog.screenshot(path=str(out/'suspects-preview.png'))
 dialog.get_by_role('textbox',name='Desviación mínima',exact=True).fill('2')
 expect(apply).to_be_disabled();expect(checkboxes).to_have_count(0)
 dialog.get_by_role('button',name='Cerrar',exact=True).last.click()
 cancelled=save(page,'cancelled.pozo.json');assert baseline['project']==cancelled['project']
 # Reopen and accept one reviewed sample.
 page.get_by_role('button',name='Preparar datos',exact=True).click()
 for label,value in [('Tope (m MD)','7800'),('Base (m MD)','7900'),('Desviación mínima','1'),('Separación máxima entre muestras','0.2')]:dialog.get_by_role('textbox',name=label,exact=True).fill(value)
 dialog.get_by_role('button',name='Buscar candidatos',exact=True).click()
 expect(checkboxes.first).to_be_visible();checkboxes.first.check();batch.click();expect(apply).to_be_enabled(timeout=60000);apply.click();settle(page)
 accepted=save(page,'accepted.pozo.json');assert accepted['version']==7
 node=accepted['project']['wells'][0]['interpretation']['preparation']['nodes'][0]
 assert len(node['intervals'])==1 and node['intervals'][0]['top']==node['intervals'][0]['base']
 page.keyboard.press('Control+z');settle(page)
 undone=save(page,'undo.pozo.json');assert baseline['project']==undone['project']
 page.keyboard.press('Control+Shift+z');settle(page)
 redone=save(page,'redo.pozo.json');assert accepted['project']==redone['project']
 ctx.close()
 ctx,page=page_for(browser,config.candidate);open_file(page,out/'accepted.pozo.json')
 reopened=save(page,'reopened.pozo.json');assert accepted['project']==reopened['project']
 page.get_by_role('button',name='Preparar datos',exact=True).click()
 dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.get_by_role('button',name=re.compile('^Restaurar exclusión ')).click()
 dialog.get_by_role('button',name='Cerrar',exact=True).last.click();settle(page)
 restored=save(page,'restored.pozo.json');assert 'preparation' not in restored['project']['wells'][0]['interpretation']
 assert not errors,errors
 (out/'evidence.json').write_text(json.dumps({'candidates':count,'interval':node['intervals'][0],'cancelUnchanged':True,'previewDoesNotRunMain':True,'undoRedo':True,'reopened':True,'restored':True,'pageErrors':errors},indent=2))
 browser.close()
