"""Recorrido de selección de intervalos y panorama/detalle, sin APIs internas de la app."""
from pathlib import Path
import argparse, hashlib, json, re, shutil, tempfile
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/')
parser.add_argument('--parent', default='parent.html')
parser.add_argument('--candidate', default='candidate.html')
parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir())/'pozo-interval-review')
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

def exported(page, name, figure=False, visible_figure=False):
    page.get_by_test_id('export-open').click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_role('radio', name='Figuras' if figure else 'Datos del pozo', exact=True).click()
    if figure:
        dialog.get_by_role('radio', name='SVG', exact=True).click()
        dialog.get_by_role('combobox', name='Tramo de la figura', exact=True).select_option('visible' if visible_figure else 'well')
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

def visible(page):
    text=page.locator('.wv-toolbar__range').text_content()
    return [float(s.strip().replace(',','.')) for s in text.removesuffix(' m').split('–')]

def open_interval(page):
    page.get_by_role('button',name='Elegir intervalo de profundidad',exact=True).click()
    dialog=page.get_by_role('dialog',name='Intervalo de profundidad',exact=True)
    expect(dialog).to_be_visible()
    return dialog

def select_interval(page,top,base):
    d=open_interval(page)
    d.get_by_role('textbox',name='Tope',exact=True).fill(top)
    d.get_by_role('textbox',name='Base',exact=True).fill(base)
    d.get_by_role('button',name='Mostrar tramo',exact=True).click()
    expect(d).to_have_count(0)
    page.wait_for_timeout(300)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    ctx=browser.new_context(viewport={'width':1366,'height':768},color_scheme='light')
    page=ctx.new_page()
    page.on('pageerror',lambda e:errors.append(str(e)))
    load(page,config.candidate)
    toggle(page,True)
    original=visible(page)
    before=project(page,'before.pozo.json')
    normal_svg=exported(page,'before.svg',figure=True)
    las_before=exported(page,'before.las')
    capture(page,'01-panorama.png')

    # El editor abre por teclado y escribir no mueve el viewport.
    trigger=page.get_by_role('button',name='Elegir intervalo de profundidad',exact=True)
    trigger.focus()
    page.keyboard.press('Enter')
    d=page.get_by_role('dialog',name='Intervalo de profundidad',exact=True)
    expect(d.get_by_role('textbox',name='Tope',exact=True)).to_be_focused()
    capture(page,'00-selector-intervalo.png')
    d.get_by_role('textbox',name='Tope',exact=True).fill('7800,5')
    d.get_by_role('textbox',name='Base',exact=True).fill('7850.5')
    assert visible(page)==original
    page.keyboard.press('Enter')
    expect(d).to_have_count(0)
    expect(trigger).to_be_focused()
    page.wait_for_timeout(300)
    assert visible(page)==[7800.5,7850.5],visible(page)
    mini=page.get_by_role('slider',name='Minimapa del pozo: ventana visible',exact=True)
    assert '7801' in mini.get_attribute('aria-valuetext')
    window_ratio=page.locator('.wv-mini__window').evaluate('(e)=>e.getBoundingClientRect().height/e.parentElement.getBoundingClientRect().height')
    assert abs(window_ratio-50/(8518.6-7633.3))<0.002
    capture(page,'02-detalle-50m.png')
    exported(page,'detail.svg',figure=True,visible_figure=True)
    assert '7801–7851 m' in (out/'detail.svg').read_text(), 'La figura no respeta el tramo visible'
    evidence={'panorama':original,'detail':visible(page),'windowRatio':window_ratio}

    for action,expected in [('Tramo siguiente',[7845.5,7895.5]),('Tramo anterior',[7800.5,7850.5])]:
        open_interval(page).get_by_role('button',name=action,exact=True).click()
        page.wait_for_timeout(250)
        assert visible(page)==expected,visible(page)
    open_interval(page).get_by_role('button',name='Ver 100 m',exact=True).click()
    page.wait_for_timeout(250)
    assert visible(page)==[7775.5,7875.5]
    select_interval(page,'7633,3','7683,3')
    open_interval(page).get_by_role('button',name='Tramo anterior',exact=True).click()
    page.wait_for_timeout(250)
    assert abs((visible(page)[1]-visible(page)[0])-50)<0.11
    assert visible(page)[0]>=original[0]

    # Entradas inválidas no se aplican; Escape descarta y restaura foco.
    unchanged=visible(page)
    for top,base in [('', '7800'),('7900','7800'),('7500','7800'),('7800','7800.001')]:
        d=open_interval(page)
        d.get_by_role('textbox',name='Tope',exact=True).fill(top)
        d.get_by_role('textbox',name='Base',exact=True).fill(base)
        d.get_by_role('button',name='Mostrar tramo',exact=True).click()
        expect(d.get_by_role('alert')).to_be_visible()
        assert visible(page)==unchanged
        page.keyboard.press('Escape')
        expect(d).to_have_count(0)
        expect(trigger).to_be_focused()

    select_interval(page,'7800','7850')
    mini.focus()
    page.keyboard.press('ArrowDown')
    page.wait_for_timeout(250)
    assert visible(page)==[7805,7855]
    box=mini.bounding_box()
    page.mouse.click(box['x']+box['width']/2,box['y']+box['height']*0.7)
    page.wait_for_timeout(250)
    moved=visible(page)
    assert abs(moved[1]-moved[0]-50)<0.11
    assert moved[0]>7900
    evidence['minimapNavigation']=moved

    # Ni el proyecto ni exportar todo el pozo dependen de la ventana temporal.
    assert project(page,'after.pozo.json')['project']==before['project']
    assert exported(page,'after.las')==las_before
    assert exported(page,'after.svg',figure=True)==normal_svg
    evidence['lasSHA256']=las_before
    evidence['svgSHA256']=normal_svg
    open_interval(page).get_by_role('button',name='Todo el pozo',exact=True).click()
    page.wait_for_timeout(250)
    assert visible(page)==original
    select_interval(page,'7800','7850')
    page.emulate_media(color_scheme='dark')
    capture(page,'03-detalle-oscuro.png')
    page.emulate_media(color_scheme='light')
    page.set_viewport_size({'width':1920,'height':1080})
    select_interval(page,'7800','7850')
    capture(page,'04-detalle-1920.png')
    toggle(page,False)
    select_interval(page,'7800','7850')
    page.get_by_role('radio',name='Geología',exact=True).click()
    select_interval(page,'7800','7850')
    evidence['geologyDetail']=visible(page)
    page.keyboard.press('Escape')
    ctx.close()

    retina=browser.new_context(viewport={'width':1366,'height':768},device_scale_factor=2)
    r=retina.new_page()
    r.on('pageerror',lambda e:errors.append(str(e)))
    load(r,config.candidate)
    toggle(r,True)
    select_interval(r,'7800','7850')
    capture(r,'05-detalle-dpr2.png')
    retina.close()
    browser.close()
    evidence['pageErrors']=errors
    assert not errors,errors
    (out/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
    print(json.dumps(evidence,ensure_ascii=False))
