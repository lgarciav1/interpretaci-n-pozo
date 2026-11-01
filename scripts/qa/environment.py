"""P6a: catálogo no ejecutable, declaraciones, revisión, historial, snapshot y offline."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

p = argparse.ArgumentParser()
p.add_argument('--url', default='http://127.0.0.1:4178/')
p.add_argument('--seed', type=Path, default=Path('/tmp/p6a-seed'))
p.add_argument('--output', type=Path, default=Path('/tmp/p6a-browser'))
args = p.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1366, 'height': 900})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)

    def settle():
        expect(page.get_by_test_id('engine-status')).to_contain_text('Listo', timeout=60000)

    def open_file(path):
        page.locator('.shell-topbar input[type=file]').set_input_files(str(path))
        expect(page.get_by_text('Proyecto abierto', exact=True).last).to_be_visible(timeout=60000)
        settle()

    def save(name):
        page.get_by_role('button', name='Proyecto', exact=True).click()
        with page.expect_download(timeout=60000) as download:
            page.get_by_role('menuitem', name=re.compile('^Guardar proyecto')).click()
        path = args.output / name
        download.value.save_as(path)
        return json.loads(path.read_text())

    def editor(curve='rho'):
        page.get_by_role('button', name='Preparar datos', exact=True).click()
        d = page.get_by_role('dialog', name='Preparar datos', exact=True)
        d.get_by_role('combobox', name='Curva original', exact=True).select_option(curve)
        d.locator('summary', has_text='Correcciones ambientales · catálogo y adquisición').click()
        return d

    def close(d):
        d.get_by_role('button', name='Cerrar', exact=True).last.click()

    def declare(d):
        d.locator('summary', has_text='Declarar adquisición de corrida DENS-QA').click()
        d.get_by_role('combobox', name='Herramienta declarada de corrida', exact=True).select_option('density')
        d.get_by_role('textbox', name='Fabricante confirmado', exact=True).fill('Proveedor QA sintético')
        d.get_by_role('textbox', name='Modelo confirmado', exact=True).fill('Modelo QA sin admisión numérica')
        d.get_by_role('combobox', name='Estado del procesado adquirido', exact=True).select_option('declared')
        d.get_by_role('button', name='Añadir efecto aplicado', exact=True).click()
        d.get_by_role('combobox', name='Efecto aplicado 1', exact=True).select_option('borehole')
        d.get_by_role('textbox', name='Método aplicado 1', exact=True).fill('Compensación del proveedor QA')
        d.get_by_role('textbox', name='Versión aplicada (opcional) 1', exact=True).fill('QA-1')
        d.get_by_role('textbox', name='Referencia del procesado 1', exact=True).fill('Informe sintético de procesado QA, página 1; no evidencia de campo')

    confirm = 'Confirmo estas declaraciones de adquisición para todas las curvas de la corrida'
    open_file(args.seed / 'unknown.pozo.json')
    before = save('before.pozo.json')
    d = editor('gr')
    expect(d.get_by_text('Corrida declarada: desconocida.', exact=False)).to_be_visible()
    expect(d.get_by_text('No se inventa una corrida', exact=False)).to_be_visible()
    close(d)
    d = editor()
    card = d.get_by_role('region', name='Densidad/PE · compensación del proveedor', exact=True)
    expect(card).to_contain_text('no ejecutable')
    expect(card).to_contain_text('sin curva disponible')
    expect(card).to_contain_text('no autoriza sumarla a RHOB')
    expect(page.get_by_text('Proyecto abierto', exact=True).last).not_to_be_visible(timeout=10000)
    card.screenshot(path=str(args.output / 'catalogo.png'))
    declare(d)
    apply = d.get_by_role('button', name='Guardar declaración de adquisición', exact=True)
    expect(apply).to_be_disabled()
    d.get_by_role('checkbox', name=confirm, exact=True).check()
    expect(apply).to_be_enabled()
    d.get_by_role('textbox', name='Modelo confirmado', exact=True).fill('Modelo QA cambiado')
    expect(apply).to_be_disabled()
    close(d)
    assert save('draft-unchanged.pozo.json')['project'] == before['project']
    d = editor()
    declare(d)
    d.get_by_role('checkbox', name=confirm, exact=True).check()
    d.get_by_role('button', name='Guardar declaración de adquisición', exact=True).click()
    settle()
    card = d.get_by_role('region', name='Densidad/PE · compensación del proveedor', exact=True)
    expect(card).to_contain_text('ya declarado como aplicado')
    expect(card).to_contain_text('no ejecutable')
    card.screenshot(path=str(args.output / 'efecto-registrado.png'))
    close(d)
    after = save('declared.pozo.json')
    old_id = before['project']['wells'][0]['inputRevisionId']
    new_id = after['project']['wells'][0]['inputRevisionId']
    assert old_id != new_id
    old_rev = before['project']['inputRevisions'][old_id]
    new_rev = after['project']['inputRevisions'][new_id]
    assert new_rev['parentRevisionId'] == old_id
    assert len(after['project']['inputRevisions']) == len(before['project']['inputRevisions']) + 1
    assert new_rev['well'] == old_rev['well']
    assert after['project']['blobs'] == before['project']['blobs']
    assert after['project']['wells'][0]['interpretation'] == before['project']['wells'][0]['interpretation']
    assert new_rev['acquisition']['runs'][1] == old_rev['acquisition']['runs'][1]
    run = new_rev['acquisition']['runs'][0]
    assert run['tool'] == {'catalogId': 'density', 'vendor': 'Proveedor QA sintético', 'model': 'Modelo QA sin admisión numérica'}
    assert run['corrections']['effects'][0]['reference'].startswith('Informe sintético')
    page.keyboard.press('Control+z')
    settle()
    assert save('undo.pozo.json')['project'] == before['project']
    page.keyboard.press('Control+Shift+z')
    settle()
    assert save('redo.pozo.json')['project'] == after['project']
    page.get_by_title('Snapshots', exact=True).click()
    snap = page.get_by_role('dialog', name='Snapshots', exact=True)
    snap.get_by_role('textbox', name='Nombre del snapshot', exact=True).fill('Declaración de adquisición QA')
    snap.get_by_role('button', name='Guardar snapshot', exact=True).click()
    page.keyboard.press('Escape')
    withsnap = save('snapshot.pozo.json')
    # Otra revisión válida, con la declaración borrada, preserva el snapshot fijado.
    page.close()
    page = browser.new_page(viewport={'width': 1366, 'height': 900})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)
    open_file(args.output / 'snapshot.pozo.json')
    d = editor()
    d.locator('summary', has_text='Declarar adquisición de corrida DENS-QA').click()
    expect(d.get_by_role('textbox', name='Referencia del procesado 1', exact=True)).to_have_value(run['corrections']['effects'][0]['reference'])
    d.get_by_role('button', name='Quitar declaración de efecto 1', exact=True).click()
    d.get_by_role('combobox', name='Estado del procesado adquirido', exact=True).select_option('unknown')
    d.get_by_role('textbox', name='Modelo confirmado', exact=True).fill('Modelo cambiado después del snapshot')
    d.get_by_role('checkbox', name=confirm, exact=True).check()
    d.get_by_role('button', name='Guardar declaración de adquisición', exact=True).click()
    settle()
    close(d)
    changed = save('changed-after-snapshot.pozo.json')
    assert changed['project']['wells'][0]['inputRevisionId'] != new_id
    page.get_by_title('Snapshots', exact=True).click()
    page.get_by_role('dialog', name='Snapshots', exact=True).get_by_role('button', name='Restaurar', exact=True).first.click()
    page.keyboard.press('Escape')
    settle()
    restored = save('restored.pozo.json')
    assert restored['project']['wells'][0]['inputRevisionId'] == new_id
    assert restored['project']['inputRevisions'][new_id] == new_rev
    page.close()
    # Mismo formulario sin red/Worker/SubtleCrypto. Solo declara, nunca corrige curvas.
    page = browser.new_page(viewport={'width': 1366, 'height': 900})
    page.add_init_script("Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});")
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)
    page.context.set_offline(True)
    open_file(args.seed / 'unknown.pozo.json')
    d = editor()
    declare(d)
    d.get_by_role('checkbox', name=confirm, exact=True).check()
    d.get_by_role('button', name='Guardar declaración de adquisición', exact=True).click()
    settle()
    expect(d.get_by_role('region', name='Densidad/PE · compensación del proveedor', exact=True)).to_contain_text('no ejecutable')
    close(d)
    offline = save('offline-declared.pozo.json')
    rev = offline['project']['inputRevisions'][offline['project']['wells'][0]['inputRevisionId']]
    assert rev['acquisition']['runs'][0]['corrections'] == run['corrections']
    assert offline['project']['blobs'] == before['project']['blobs']
    assert not errors, errors
    (args.output / 'result.json').write_text(json.dumps({'errors': errors, 'admittedMethods': 0, 'checks': ['unknown run stays unknown', 'catalogue never executable', 'DRHO absence and no implicit addition', 'confirmation resets on edit', 'draft leaves Project unchanged', 'new acquisition revision only', 'original blobs and interpretation unchanged', 'other run preserved', 'one undo redo', 'new browser reopens references', 'changed snapshot restores acquisition', 'offline without Worker/SubtleCrypto']}, indent=2))
    browser.close()
