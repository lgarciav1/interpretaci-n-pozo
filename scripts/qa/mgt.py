"""MGT: modelo específico, preview aislado, nulos/dominio, referencias, exportación y reversibilidad."""
import argparse, json, re, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
p = argparse.ArgumentParser(); p.add_argument('--url', default='http://127.0.0.1:4178/'); p.add_argument('--seed', type=Path, default=Path('/tmp/mgt-seed')); p.add_argument('--output', type=Path, default=Path('/tmp/mgt-browser')); args = p.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
errors = []
instrument = """(()=>{const Native=Worker;window.__qaMainRuns=0;window.Worker=class extends Native{constructor(url,options){super(url,options);this.main=options?.name==='motor';}postMessage(m,t){if(this.main&&m.type==='run')window.__qaMainRuns++;return super.postMessage(m,t);}};})();"""
values = {'Profundidad ambiente máxima bajo nivel del mar (m)': '400', 'Temperatura ambiente MGT (°C)': '30,0', 'Presión ambiente MGT (psi)': '600', 'Referencia de agua de mar, posición, datum y condiciones MGT': 'QA sintético: agua de mar, posición conocida, MD Seafloor y condiciones de adquisición documentadas.', 'Referencia de GR calibrado sin corrección de pozo previa': 'QA sintético: GR calibrado MGT en gAPI, sin corrección de pozo previa según informe de procesado.'}
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    def fresh(fallback=False):
        page = browser.new_page(viewport={'width': 1366, 'height': 900}); page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script("Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});" if fallback else instrument)
        page.goto(args.url)
        if fallback: page.context.set_offline(True)
        return page
    page = fresh()
    def settle(): expect(page.get_by_test_id('engine-status')).to_contain_text('Listo', timeout=60000)
    def open_file(path):
        page.locator('.shell-topbar input[type=file]').set_input_files(str(path)); expect(page.get_by_text('Proyecto abierto', exact=True).last).to_be_visible(timeout=60000); settle()
    def save(name):
        page.get_by_role('button', name='Proyecto', exact=True).click()
        with page.expect_download(timeout=60000) as d: page.get_by_role('menuitem', name=re.compile('^Guardar proyecto')).click()
        path = args.output/name; d.value.save_as(path); return json.loads(path.read_text())
    def editor():
        page.get_by_role('button', name='Preparar datos', exact=True).click(); d = page.get_by_role('dialog', name='Preparar datos', exact=True)
        d.locator('summary', has_text='Correcciones ambientales · catálogo y adquisición').click(); d.locator('summary', has_text='MGT · corrección GR específica con preview').click(); return d
    def configure(d, position='centered'):
        d.get_by_role('combobox', name='Caliper original para MGT', exact=True).select_option('cal'); d.get_by_role('combobox', name='Posición de herramienta MGT', exact=True).select_option(position)
        for label, value in values.items(): d.get_by_role('textbox', name=label, exact=True).fill(value)
        d.get_by_role('checkbox', name=re.compile('^Confirmo MGT,')).check()
    def propose(d):
        d.get_by_role('button', name='Previsualizar corrección MGT', exact=True).click(); button = d.get_by_role('button', name='Aplicar corrección MGT', exact=True); expect(button).to_be_enabled(timeout=60000); return button
    def close(d): d.get_by_role('button', name='Cerrar', exact=True).last.click()
    for kind, message in [('unknown', 'Solo LDEO MGT confirmado'), ('prior', 'Procesado previo desconocido')]:
        open_file(args.seed/(kind+'.pozo.json')); d=editor(); configure(d); d.get_by_role('button', name='Previsualizar corrección MGT', exact=True).click(); expect(d.get_by_text(message, exact=False)).to_be_visible(); expect(d.get_by_role('button', name='Aplicar corrección MGT', exact=True)).to_have_count(0); close(d)
    open_file(args.seed/'setup.pozo.json'); d=editor(); d.locator('summary',has_text='Declarar adquisición de corrida MGT-QA').click()
    d.get_by_role('combobox',name='Herramienta declarada de corrida',exact=True).select_option('gr'); d.get_by_role('textbox',name='Fabricante confirmado',exact=True).fill('LDEO'); d.get_by_role('textbox',name='Modelo confirmado',exact=True).fill('MGT'); d.get_by_role('combobox',name='Estado del procesado adquirido',exact=True).select_option('declared'); d.get_by_role('textbox',name='Datum MD del pozo (todas las corridas)',exact=True).fill('Seafloor'); d.get_by_role('checkbox',name='Confirmo estas declaraciones de adquisición para todas las curvas de la corrida',exact=True).check(); expect(d.get_by_role('button',name='Guardar declaración de adquisición',exact=True)).to_be_disabled(); d.get_by_role('checkbox',name='Confirmo el datum MD para todas las curvas y corridas del pozo',exact=True).check(); d.get_by_role('button',name='Guardar declaración de adquisición',exact=True).click(); settle(); configure(d); propose(d); close(d); registered=save('setup-registered.pozo.json'); rev=registered['project']['inputRevisions'][registered['project']['wells'][0]['inputRevisionId']]; assert rev['acquisition']['depth']['datum']=='Seafloor'; assert rev['acquisition']['runs'][0]['tool']['model']=='MGT'
    open_file(args.seed/'known.pozo.json'); before=save('before.pozo.json'); d=editor(); expect(d.get_by_role('button', name='Previsualizar corrección MGT', exact=True)).to_be_disabled(); configure(d)
    main_runs=page.evaluate('__qaMainRuns'); propose(d); assert page.evaluate('__qaMainRuns') == main_runs
    expect(d.get_by_text('46 muestras corregidas; 4 fuera de dominio', exact=False)).to_be_visible()
    table=d.get_by_role('table', name='MGT · original, corregida y diferencia', exact=False); expect(table).to_contain_text('Faltante original'); expect(table).to_contain_text('Fuera de dominio'); expect(page.get_by_text('Proyecto abierto', exact=True).last).not_to_be_visible(timeout=10000); table.screenshot(path=str(args.output/'muestras.png'))
    impact=d.get_by_role('table', name='Impacto MGT', exact=False); cells=impact.get_by_role('row').filter(has_text='VSH').get_by_role('cell').all_text_contents(); assert cells[1] != cells[2]; expect(impact.get_by_role('row').filter(has_text='PHIE')).to_contain_text('0.2000'); expect(impact.get_by_role('row').filter(has_text='SW')).to_contain_text('0.3000'); nets=impact.get_by_role('row').filter(has_text='Reservorio neto').get_by_role('cell').all_text_contents(); assert nets[1] != 'Sin dato' and nets[2] != 'Sin dato' and nets[1] != nets[2]; impact.screenshot(path=str(args.output/'impacto.png'))
    d.get_by_role('combobox', name='Posición de herramienta MGT', exact=True).select_option('eccentered'); expect(d.get_by_role('button', name='Aplicar corrección MGT', exact=True)).to_have_count(0); close(d)
    assert save('preview-unchanged.pozo.json')['project'] == before['project']
    d=editor(); configure(d); propose(d).click(); settle(); close(d); after=save('applied.pozo.json')
    original=before['project']['wells'][0]['interpretation']; accepted=after['project']['wells'][0]['interpretation']; node=accepted['preparation']['nodes'][0]
    assert accepted['preparation']['schemaVersion']==5 and node['kind']=='mgt-borehole' and node['mgt']['position']=='centered'; assert node['mgt']['conditionsReference']==values['Referencia de agua de mar, posición, datum y condiciones MGT']
    assert accepted['params']==original['params']; assert after['project']['blobs']==before['project']['blobs'] and after['project']['inputRevisions']==before['project']['inputRevisions']
    page.keyboard.press('Control+z'); settle(); assert save('undo.pozo.json')['project']==before['project']; page.keyboard.press('Control+Shift+z'); settle(); assert save('redo.pozo.json')['project']==after['project']
    page.get_by_test_id('export-open').click(); ex=page.get_by_role('dialog', name='Exportar', exact=True); expect(ex).to_contain_text('manifiesto'); ex.get_by_role('checkbox', name=re.compile('^Incluir el sumario por zona')).uncheck()
    with page.expect_download(timeout=60000) as download: ex.get_by_role('button', name='Exportar', exact=True).click()
    path=args.output/'export.zip'; download.value.save_as(path)
    with zipfile.ZipFile(path) as z:
        manifest=json.loads(z.read('preparacion-ambiental.json')); assert manifest['methods'][0]['ledger'][0]['method']=='odp-mgt-seawater-gr'; assert manifest['methods'][0]['ledger'][0]['conditions']==node['mgt']; assert any(n.endswith('.las') for n in z.namelist())
    d=editor(); d.get_by_role('button', name='Desactivar MGT', exact=True).click(); settle(); close(d); disabled=save('disabled.pozo.json'); assert disabled['project']['wells'][0]['interpretation']['sources']['GR']=={'kind':'curve','curveId':'gr'}
    d=editor(); d.get_by_role('button', name='Activar MGT', exact=True).click(); settle(); close(d); active=save('reactivated.pozo.json'); assert active['project']['wells'][0]['interpretation']==accepted
    page.get_by_title('Snapshots', exact=True).click(); snap=page.get_by_role('dialog', name='Snapshots', exact=True); snap.get_by_role('textbox', name='Nombre del snapshot', exact=True).fill('MGT centrado QA'); snap.get_by_role('button', name='Guardar snapshot', exact=True).click(); page.keyboard.press('Escape'); save('snapshot.pozo.json'); page.close()
    page=fresh(); open_file(args.output/'snapshot.pozo.json'); d=editor(); expect(d.get_by_role('region', name='Corrección MGT aceptada', exact=True)).to_contain_text(values['Referencia de GR calibrado sin corrección de pozo previa']); configure(d, 'eccentered'); propose(d).click(); settle(); close(d); modified=save('eccentered.pozo.json'); assert modified['project']['wells'][0]['interpretation']['preparation']['nodes'][0]['mgt']['position']=='eccentered'
    page.get_by_title('Snapshots', exact=True).click(); page.get_by_role('dialog', name='Snapshots', exact=True).get_by_role('button', name='Restaurar', exact=True).first.click(); page.keyboard.press('Escape'); settle(); assert save('restored.pozo.json')['project']['wells'][0]['interpretation']==accepted
    d=editor(); d.get_by_role('button', name='Retirar MGT y volver a original', exact=True).click(); settle(); close(d); removed=save('removed.pozo.json'); assert 'preparation' not in removed['project']['wells'][0]['interpretation']; page.close()
    page=fresh(True); open_file(args.seed/'known.pozo.json'); d=editor(); configure(d); propose(d).click(); settle(); close(d); offline=save('offline.pozo.json'); offline_i=offline['project']['wells'][0]['interpretation']; assert offline_i['preparation']['nodes'][0]['mgt']==node['mgt']; assert offline_i['params']==accepted['params']; assert offline['project']['blobs']==before['project']['blobs']
    assert not errors, errors
    (args.output/'result.json').write_text(json.dumps({'errors':errors,'correctedSamples':46,'unsupportedSamples':4,'originalMissing':1,'checks':['model unknown blocked','already corrected blocked','explicit conditions','comma input','isolated preview no main run','original corrected difference table','Vsh impact','controls invalidate','preview Project unchanged','one acceptance undo redo','parameters cutoffs originals unchanged','manifest LAS and QC','deactivate reactivate once only','new browser references','changed recipe snapshot restore','remove original source','offline without Worker/SubtleCrypto']},indent=2)); browser.close()
