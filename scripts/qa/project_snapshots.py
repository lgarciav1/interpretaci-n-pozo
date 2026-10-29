"""Regresión de snapshots legados: comparar, restaurar, deshacer y exportar por la UI."""
from pathlib import Path
import argparse, hashlib, json, re, shutil, tempfile
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/')
parser.add_argument('--parent', default='parent.html')
parser.add_argument('--candidate', default='candidate.html')
parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir())/'pozo-project-snapshots')
parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chromium-browser'))
parser.add_argument('--width', type=int, default=1366)
parser.add_argument('--height', type=int, default=768)
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

def active_entry(project):
    return next(e for e in project['wells'] if e['well']['id']==project['activeWellId'])

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    evidence={}
    tables={}
    for name,filename in [('parent',config.parent),('candidate',config.candidate)]:
        ctx=browser.new_context(viewport={'width':config.width,'height':config.height},color_scheme='light')
        page=ctx.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        load(page,filename)
        evidence[name+'Geometry']=measure(page)
        evidence[name+'Las']=exported(page,name+'-before.las')
        evidence[name+'Svg']=exported(page,name+'-before.svg',figure=True)
        page.get_by_title('Snapshots',exact=True).click()
        dialog=page.get_by_role('dialog',name='Snapshots',exact=True)
        dialog.get_by_role('textbox',name='Nombre del snapshot',exact=True).fill('Base de compatibilidad')
        dialog.get_by_role('button',name='Guardar snapshot',exact=True).click()
        dialog.get_by_role('button',name='Comparar',exact=True).click()
        expect(page.get_by_test_id('snap-compare-table')).to_be_visible(timeout=60000)
        expect(page.locator('.snap-diff-none')).to_be_visible()
        tables[name]=page.get_by_test_id('snap-compare-table').inner_text()
        page.screenshot(path=str(out/(name+'-comparacion.png')))
        page.keyboard.press('Escape')
        base=project(page,name+'-snapshot.pozo.json')
        assert base['version']==6
        assert 'inputRevisions' not in base['project']
        assert 'inputRevisionId' not in base['project']['snapshots'][0]
        if name=='parent':
            ctx.close()
            continue

        # Reabrir una copia v6 con parámetros activos distintos conserva el snapshot original.
        changed=json.loads(json.dumps(base))
        active_entry(changed['project'])['interpretation']['params']['global']['grClean']=50
        path=out/'edited.pozo.json'
        path.write_text(json.dumps(changed))
        page.locator('.shell-topbar input[type=file]').set_input_files(str(path))
        expect(page.get_by_text('Proyecto abierto',exact=True)).to_be_visible(timeout=60000)
        settle(page)
        page.get_by_title('Snapshots',exact=True).click()
        dialog=page.get_by_role('dialog',name='Snapshots',exact=True)
        dialog.get_by_role('button',name='Comparar',exact=True).click()
        expect(page.get_by_test_id('snap-compare-table')).to_be_visible(timeout=60000)
        expect(page.get_by_test_id('snap-diff')).to_contain_text('GR de arena limpia')
        page.screenshot(path=str(out/'candidate-cambios.png'))
        dialog.get_by_role('button',name='Restaurar',exact=True).focus()
        page.keyboard.press('Enter')
        expect(page.locator('.snap-diff-none')).to_be_visible(timeout=60000)
        page.keyboard.press('Escape')
        settle(page)
        restored=project(page,'restored.pozo.json')
        expected=base['project']['snapshots'][0]['interpretation']
        assert active_entry(restored['project'])['interpretation']==expected
        page.keyboard.press('Control+z')
        settle(page)
        undone=project(page,'undo.pozo.json')
        assert active_entry(undone['project'])['interpretation']['params']['global']['grClean']==50
        page.keyboard.press('Control+Shift+z')
        settle(page)
        redone=project(page,'redo.pozo.json')
        assert active_entry(redone['project'])['interpretation']==expected
        page.get_by_title('Snapshots',exact=True).click()
        page.get_by_role('dialog',name='Snapshots',exact=True).get_by_role('button',name='Cortina',exact=True).focus()
        page.keyboard.press('Enter')
        expect(page.locator('.wv-curtain')).to_be_visible(timeout=60000)
        page.keyboard.press('Escape')
        expect(page.locator('.wv-curtain')).to_have_count(0)
        evidence['restoredLas']=exported(page,'restored.las')
        evidence['restoredSvg']=exported(page,'restored.svg',figure=True)
        assert evidence['restoredLas']==evidence['candidateLas']
        assert evidence['restoredSvg']==evidence['candidateSvg']
        ctx.close()
    assert evidence['parentGeometry']==evidence['candidateGeometry']
    assert tables['parent']==tables['candidate']
    assert evidence['parentLas']==evidence['candidateLas']
    assert evidence['parentSvg']==evidence['candidateSvg']
    evidence['comparisonTableEqual']=True
    evidence['legacyRestoreUndoRedo']=True
    evidence['pageErrors']=errors
    assert not errors,errors
    browser.close()
    (out/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
    print(json.dumps(evidence,ensure_ascii=False))
