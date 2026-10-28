from pathlib import Path
import argparse,hashlib,json,re,shutil,tempfile
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser(description='Verifica el preset esencial contra un build anterior del mismo repo.')
parser.add_argument('--url',default='http://127.0.0.1:4173/')
parser.add_argument('--baseline',default='baseline.html')
parser.add_argument('--candidate',default='candidate.html')
parser.add_argument('--output',type=Path,default=Path(tempfile.gettempdir())/'pozo-essential-review')
parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chromium-browser'))
config=parser.parse_args()
out=config.output
out.mkdir(parents=True,exist_ok=True)
errors=[]
def measure(page):
    return page.evaluate('''()=>({
      range:document.querySelector('.wv-toolbar__range')?.textContent,
      heads:[...document.querySelectorAll('.wv-head')].map(e=>({title:e.querySelector('.wv-head__title')?.textContent,extra:e.querySelector('.wv-head__overflow-count')?.textContent,width:e.getBoundingClientRect().width})),
      body:document.querySelector('.wv-body')?.getBoundingClientRect().toJSON()
    })''')

def ready(page):
    expect(page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000)
    page.mouse.move(5,5)
    page.wait_for_timeout(500)

def load_tp(page,filename):
    page.goto(urljoin(config.url.rstrip('/')+'/',filename))
    page.get_by_role('button',name='Cargar pozo',exact=True).first.click()
    page.get_by_role('button',name='Cargar datos del TP',exact=True).click()
    page.get_by_role('button',name='Siguiente: control de calidad',exact=True).click()
    page.get_by_role('button',name='Cargar',exact=True).click()
    ready(page)

def download_project(page,name):
    page.get_by_role('button',name='Proyecto',exact=True).click()
    with page.expect_download() as d:
        page.get_by_role('menuitem',name=re.compile('^Guardar proyecto')).click()
    path=out/name
    d.value.save_as(path)
    return json.loads(path.read_text())

def export_las(page,name):
    page.get_by_test_id('export-open').click()
    dialog=page.get_by_role('dialog')
    # Se mantiene LAS y se desmarca el ZIP de sumario para comparar el archivo numérico íntegro.
    dialog.get_by_role('checkbox',name=re.compile('^Incluir el sumario por zona')).uncheck()
    with page.expect_download() as d:
        dialog.get_by_role('button',name='Exportar',exact=True).click()
    path=out/name
    d.value.save_as(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()

def choose(page,name):
    page.locator('.tb-template-btn').click()
    page.get_by_role('menuitem',name=re.compile('^'+re.escape(name))).click()
    page.get_by_role('button',name='Ver todo el pozo',exact=True).click()
    page.mouse.move(5,5)
    page.wait_for_timeout(500)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    base_context=browser.new_context(viewport={'width':1366,'height':768},device_scale_factor=1,color_scheme='light')
    base=base_context.new_page()
    base.on('pageerror',lambda e:errors.append('baseline: '+str(e)))
    load_tp(base,config.baseline)
    base.screenshot(path=str(out/'01-clasica-base-1366.png'))
    evidence={'baseline':measure(base),'baselineLas':export_las(base,'base.las')}
    base.get_by_role('button',name='Ocultar columna',exact=True).first.click()
    base.get_by_role('button',name='Ocultar columna',exact=True).first.click()
    base.get_by_role('button',name='Ocultar paneles',exact=True).click()
    base.get_by_role('button',name='Ver todo el pozo',exact=True).click()
    base.mouse.move(5,5)
    base.wait_for_timeout(600)
    evidence['baselineWide1366']=measure(base)
    base.screenshot(path=str(out/'01b-clasica-amplia-1366.png'))
    original=download_project(base,'base.pozo.json')
    base_context.close()

    context=browser.new_context(viewport={'width':1366,'height':768},device_scale_factor=1,color_scheme='light')
    page=context.new_page()
    page.on('pageerror',lambda e:errors.append('candidate: '+str(e)))
    load_tp(page,config.candidate)
    evidence['candidateClassic']=measure(page)
    assert evidence['candidateClassic']==evidence['baseline'],'La vista inicial cambió'
    choose(page,'Petrofísica esencial')
    expect(page.locator('.tb-template-btn')).to_contain_text('Petrofísica esencial')
    evidence['essential1366']=measure(page)
    assert not any(h['title']=='Interpretación' for h in evidence['essential1366']['heads'])
    page.screenshot(path=str(out/'02-esencial-1366.png'))
    evidence['essentialLas']=export_las(page,'esencial.las')
    assert evidence['essentialLas']==evidence['baselineLas'],'Los datos LAS cambiaron'
    saved=download_project(page,'esencial.pozo.json')
    assert saved['version']==original['version']==6
    assert saved['project']['wells']==original['project']['wells'],'Se modificaron mediciones o interpretación'
    assert saved['project']['snapshots']==original['project']['snapshots']
    assert not original['project']['display']['layouts']
    assert 'petrophysics' in saved['project']['display']['layouts']

    page.get_by_test_id('undo').click()
    expect(page.locator('.tb-template-btn')).to_contain_text('De fábrica')
    page.get_by_test_id('redo').click()
    expect(page.locator('.tb-template-btn')).to_contain_text('Petrofísica esencial')
    evidence['undoRedo']=True

    # Exportación real del preset a SVG.
    page.get_by_test_id('export-open').click()
    dialog=page.get_by_role('dialog')
    dialog.get_by_role('radio',name='Figuras',exact=True).click()
    dialog.get_by_role('radio',name='SVG',exact=True).click()
    with page.expect_download(timeout=60000) as d:
        dialog.get_by_role('button',name='Exportar',exact=True).click()
    path=out/'esencial.svg'
    d.value.save_as(path)
    svg=path.read_text()
    assert '<svg' in svg and 'Dens. · neutrón' in svg and not re.search('NaN|undefined|Infinity',svg)
    evidence['svgBytes']=path.stat().st_size

    # Volver a la fábrica y recuperar el proyecto esencial desde su archivo.
    choose(page,'De fábrica')
    page.locator('.shell-topbar input[type=file]').set_input_files(str(out/'esencial.pozo.json'))
    expect(page.locator('.tb-template-btn')).to_contain_text('Petrofísica esencial')
    ready(page)
    evidence['saveOpen']=True

    page.get_by_role('button',name='Ocultar columna',exact=True).first.click()
    page.get_by_role('button',name='Ocultar columna',exact=True).first.click()
    page.get_by_role('button',name='Ocultar paneles',exact=True).click()
    page.get_by_role('button',name='Ver todo el pozo',exact=True).click()
    page.mouse.move(5,5)
    page.wait_for_timeout(600)
    evidence['essentialWide1366']=measure(page)
    page.screenshot(path=str(out/'03-esencial-amplia-1366.png'))
    page.emulate_media(color_scheme='dark')
    page.wait_for_timeout(600)
    page.screenshot(path=str(out/'04-esencial-oscura-1366.png'))
    page.emulate_media(color_scheme='light')
    page.set_viewport_size({'width':1920,'height':1080})
    page.get_by_role('button',name='Ver todo el pozo',exact=True).click()
    page.wait_for_timeout(600)
    page.screenshot(path=str(out/'05-esencial-amplia-1920.png'))

    # Geología conserva su vista y no ofrece el preset de Petrofísica.
    page.get_by_role('radio',name='Geología',exact=True).click()
    expect(page.locator('.tb-template-btn')).to_contain_text('De fábrica')
    page.locator('.tb-template-btn').click()
    expect(page.get_by_role('menuitem',name=re.compile('^Petrofísica esencial'))).to_have_count(0)
    page.keyboard.press('Escape')
    evidence['geologyUnchanged']=True
    context.close()

    retina=browser.new_context(viewport={'width':1366,'height':768},device_scale_factor=2,color_scheme='light')
    r=retina.new_page()
    r.on('pageerror',lambda e:errors.append('dpr2: '+str(e)))
    load_tp(r,config.candidate)
    choose(r,'Petrofísica esencial')
    r.screenshot(path=str(out/'06-esencial-dpr2-1366.png'))
    evidence['dpr2']=measure(r)
    retina.close()
    browser.close()
    evidence['pageErrors']=errors
    assert not errors,errors
    (out/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
    print(json.dumps(evidence,ensure_ascii=False))
