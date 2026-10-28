"""Recorrido de lectura amplia contra el build anterior, sin APIs internas de la app."""
from pathlib import Path
import argparse, hashlib, json, re, shutil, tempfile
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/')
parser.add_argument('--parent', default='parent.html')
parser.add_argument('--candidate', default='candidate.html')
parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir())/'pozo-reading-review')
parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chromium-browser'))
config = parser.parse_args()
out = config.output
out.mkdir(parents=True, exist_ok=True)
errors = []

def settle(page):
    expect(page.get_by_test_id('engine-status')).to_contain_text('Listo', timeout=60000)
    page.mouse.move(5, 5)
    page.wait_for_timeout(500)

def load(page, filename):
    page.goto(urljoin(config.url.rstrip('/')+'/', filename))
    page.get_by_role('button', name='Cargar pozo', exact=True).first.click()
    page.get_by_role('button', name='Cargar datos del TP', exact=True).click()
    page.get_by_role('button', name='Siguiente: control de calidad', exact=True).click()
    page.get_by_role('button', name='Cargar', exact=True).click()
    settle(page)
    choose(page, 'Petrofísica esencial')

def choose(page, name):
    page.locator('.tb-template-btn').click()
    page.get_by_role('menuitem', name=re.compile('^'+re.escape(name))).click()
    fit(page)

def fit(page):
    page.get_by_role('button', name='Ver todo el pozo', exact=True).click()
    page.mouse.move(5, 5)
    page.wait_for_timeout(500)

def capture(page, name):
    close = page.get_by_role('button', name='Cerrar aviso', exact=True)
    while close.count() and close.first.is_visible():
        close.first.click()
    page.mouse.move(5, 5)
    page.screenshot(path=str(out/name))

def measure(page):
    return page.evaluate('''()=>({
      range:document.querySelector('.wv-toolbar__range').textContent,
      body:document.querySelector('.wv-body').getBoundingClientRect().toJSON(),
      headerHeight:document.querySelector('.wv-heads').getBoundingClientRect().height,
      heads:[...document.querySelectorAll('.wv-head')].map(e=>({title:e.querySelector('.wv-head__title').textContent,width:e.getBoundingClientRect().width})),
      layout:localStorage.getItem('pozo.ui.layout')
    })''')

def project(page, name):
    page.get_by_role('button', name='Proyecto', exact=True).click()
    with page.expect_download() as d:
        page.get_by_role('menuitem', name=re.compile('^Guardar proyecto')).click()
    target = out/name
    d.value.save_as(target)
    return json.loads(target.read_text())

def exported(page, name, figure=False):
    page.get_by_test_id('export-open').click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_role('radio', name='Figuras' if figure else 'Datos del pozo', exact=True).click()
    if figure:
        dialog.get_by_role('radio', name='SVG', exact=True).click()
        dialog.get_by_role('combobox', name='Tramo de la figura', exact=True).select_option('well')
    else:
        dialog.get_by_role('checkbox', name=re.compile('^Incluir el sumario por zona')).uncheck()
    with page.expect_download(timeout=60000) as d:
        dialog.get_by_role('button', name='Exportar', exact=True).click()
    target = out/name
    d.value.save_as(target)
    return hashlib.sha256(target.read_bytes()).hexdigest()

def toggle(page, on):
    page.get_by_test_id('reading-mode-toggle').click()
    expect(page.get_by_test_id('reading-mode-toggle')).to_have_attribute('aria-pressed', str(on).lower())
    fit(page)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=config.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    old = browser.new_context(viewport={'width':1366,'height':768}, color_scheme='light')
    parent = old.new_page()
    parent.on('pageerror', lambda e: errors.append('parent: '+str(e)))
    load(parent, config.parent)
    evidence = {'parentNormal':measure(parent), 'parentLas':exported(parent,'parent.las')}
    old.close()

    ctx = browser.new_context(viewport={'width':1366,'height':768}, color_scheme='light')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('candidate: '+str(e)))
    load(page, config.candidate)
    evidence['candidateNormal'] = measure(page)
    assert evidence['candidateNormal'] == evidence['parentNormal'], 'Cambió la vista normal: '+json.dumps(evidence,ensure_ascii=False)
    before = project(page, 'before.pozo.json')
    normal_svg = exported(page,'normal.svg',figure=True)
    capture(page,'01-normal-1366.png')

    # El botón funciona por teclado y mantiene el foco para volver.
    page.get_by_test_id('reading-mode-toggle').focus()
    page.keyboard.press('Enter')
    expect(page.get_by_test_id('reading-mode-toggle')).to_have_attribute('aria-pressed','true')
    fit(page)
    expect(page.locator('.shell-flowbar')).to_have_count(0)
    expect(page.locator('.shell-side')).to_have_count(0)
    expect(page.locator('.wv-header')).to_have_count(0)
    evidence['reading1366'] = measure(page)
    assert evidence['reading1366']['body']['height'] > 2*evidence['candidateNormal']['body']['height']
    assert evidence['reading1366']['headerHeight'] < evidence['candidateNormal']['headerHeight']
    assert evidence['reading1366']['range'] == evidence['candidateNormal']['range']
    assert evidence['reading1366']['layout'] == evidence['candidateNormal']['layout']
    title=page.locator('.wv-head[data-track-id="indicators"] .wv-head__title')
    assert title.evaluate('(e)=>e.clientHeight<=1.4*parseFloat(getComputedStyle(e).fontSize)'), 'El título Indicadores se parte innecesariamente'
    capture(page,'02-lectura-1366.png')
    evidence['readingLas'] = exported(page,'reading.las')
    evidence['readingSvg'] = exported(page,'reading.svg',figure=True)
    assert evidence['readingLas'] == evidence['parentLas'], 'Cambió la exportación LAS'
    assert evidence['readingSvg'] == normal_svg, 'La lectura cambió la figura SVG'
    after = project(page,'reading.pozo.json')
    assert before['project'] == after['project'], 'La lectura alteró el proyecto'
    assert before['version'] == after['version'] == 6

    toggle(page,False)
    assert measure(page) == evidence['candidateNormal'], 'No recuperó la disposición anterior'
    toggle(page,True)
    page.get_by_role('button',name='Mostrar paneles',exact=True).click()
    expect(page.get_by_test_id('reading-mode-toggle')).to_have_attribute('aria-pressed','false')
    expect(page.locator('.shell-dock')).not_to_have_class(re.compile('is-collapsed'))
    toggle(page,True)
    page.get_by_role('button',name='Pistas',exact=True).click()
    expect(page.get_by_test_id('reading-mode-toggle')).to_have_attribute('aria-pressed','false')
    expect(page.get_by_test_id('reading-mode-toggle')).to_be_disabled()
    page.get_by_role('button',name='Pistas',exact=True).click()

    toggle(page,True)
    page.emulate_media(color_scheme='dark')
    page.wait_for_timeout(500)
    capture(page,'03-lectura-oscura-1366.png')
    page.emulate_media(color_scheme='light')
    page.set_viewport_size({'width':1920,'height':1080})
    fit(page)
    capture(page,'04-lectura-1920.png')
    page.set_viewport_size({'width':1366,'height':768})

    # La fábrica y su lista completa siguen accesibles en lectura; Escape cierra la lista.
    choose(page,'De fábrica')
    page.locator('.wv-head[data-track-id="computed"] .wv-head__overflow').click()
    expect(page.locator('.wv-overflow')).to_be_visible()
    assert page.locator('.wv-overflow .wv-legend').count() == 47
    page.keyboard.press('Escape')
    expect(page.get_by_test_id('reading-mode-toggle')).to_have_attribute('aria-pressed','true')
    choose(page,'Petrofísica esencial')
    page.get_by_role('radio',name='Geología',exact=True).click()
    expect(page.get_by_test_id('reading-mode-toggle')).to_have_attribute('aria-pressed','true')
    fit(page)
    evidence['geologyReading'] = measure(page)
    capture(page,'05-geologia-lectura.png')

    # Recargar nunca convierte la disposición temporal en una preferencia persistida.
    custom={'leftWidth':263,'rightWidth':347,'dockHeight':201,'leftAuto':False,'rightAuto':False,'dockAuto':False,'leftCollapsed':False,'rightCollapsed':True,'dockCollapsed':False,'wellHeader':False}
    page.evaluate('(v)=>localStorage.setItem("pozo.ui.layout",JSON.stringify(v))', custom)
    page.reload()
    expect(page.get_by_test_id('reading-mode-toggle')).to_have_attribute('aria-pressed','false')
    page.locator('.shell-topbar input[type=file]').set_input_files(str(out/'reading.pozo.json'))
    settle(page)
    toggle(page,True)
    page.wait_for_timeout(300)
    assert page.evaluate('JSON.parse(localStorage.getItem("pozo.ui.layout"))') == custom
    toggle(page,False)
    assert page.evaluate('JSON.parse(localStorage.getItem("pozo.ui.layout"))') == custom
    expect(page.locator('.shell-side--left')).to_be_visible()
    expect(page.locator('.shell-side--right')).to_have_count(0)
    expect(page.locator('.wv-header')).to_have_count(0)
    toggle(page,True)
    page.reload()
    expect(page.get_by_test_id('reading-mode-toggle')).to_have_attribute('aria-pressed','false')
    evidence['customLayoutRestored'] = True
    ctx.close()

    retina=browser.new_context(viewport={'width':1366,'height':768},device_scale_factor=2,color_scheme='light')
    r=retina.new_page()
    r.on('pageerror',lambda e:errors.append('dpr2: '+str(e)))
    load(r,config.candidate)
    toggle(r,True)
    capture(r,'06-lectura-dpr2.png')
    evidence['dpr2']=measure(r)
    retina.close()
    browser.close()
    evidence['pageErrors']=errors
    assert not errors,errors
    (out/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
    print(json.dumps(evidence,ensure_ascii=False))
