"""P5c: decisión separada de cutoff, impacto exacto, historial y fallback offline.
Fixture sintético explícito; no valida una relación constitutiva de campo.
"""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

p = argparse.ArgumentParser()
p.add_argument('--url', default='http://127.0.0.1:4178/')
p.add_argument('--seed', type=Path, default=Path('/tmp/p5c-seed'))
p.add_argument('--output', type=Path, default=Path('/tmp/p5c-browser'))
args = p.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
errors = []
instrument = """(()=>{const Native=Worker;window.__qaMainRuns=0;window.Worker=class extends Native{constructor(url,options){super(url,options);this.main=options?.name==='motor';}postMessage(m,t){if(this.main&&m.type==='run')window.__qaMainRuns++;return super.postMessage(m,t);}};})();"""
values = {
    'Cutoff Vsh propuesto': '0,5',
    'Arcillas del extremo limpio para cutoff': '0',
    'Arcillas del extremo lutítico para cutoff': '1',
    'Relación física del proxy para cutoff': 'Proxy sintético de sólidos, extremos 0 y 1 aplicables a Zona QA.',
    'Justificación del cutoff y limitaciones': 'Criterio operativo sintético sin k ni facies reales; no demuestra calidad de reservorio.',
    'Referencia de facies, plugs o criterio operativo': 'Fixture sintético de φ/Sw y DRX de clasificación manual; sin campaña real.',
}
declaration = 'Declaro este cutoff como criterio de clasificación, sin inferir calidad de reservorio solo desde DRX'
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1366, 'height': 900})
    page.add_init_script(instrument)
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
        with page.expect_download(timeout=60000) as d:
            page.get_by_role('menuitem', name=re.compile('^Guardar proyecto')).click()
        path = args.output / name
        d.value.save_as(path)
        return json.loads(path.read_text())

    def editor(compare=True):
        page.get_by_role('button', name='Preparar datos', exact=True).click()
        d = page.get_by_role('dialog', name='Preparar datos', exact=True)
        d.locator('summary', has_text='DRX · carga').click()
        d.get_by_role('combobox', name='Conjunto DRX', exact=True).select_option('lab')
        if compare:
            d.get_by_role('combobox', name='Curva para comparar con DRX', exact=True).select_option('gr')
            d.get_by_role('textbox', name='Máximo entre anclajes DRX (m)', exact=True).fill('1')
            d.get_by_role('button', name='Comparar con soporte declarado', exact=True).click()
            expect(d.get_by_role('table', name='Pares DRX', exact=False)).to_be_visible(timeout=60000)
            d.locator('summary', has_text='Evaluar cutoff de Vsh con DRX').click()
        return d

    def configure(d):
        d.get_by_role('combobox', name='Zona del cutoff DRX', exact=True).select_option('z')
        for label, value in values.items():
            d.get_by_role('textbox', name=label, exact=True).fill(value)
        d.get_by_role('checkbox', name=declaration, exact=True).check()

    def evaluate(d):
        d.get_by_role('button', name='Evaluar y previsualizar cutoff', exact=True).click()
        apply = d.get_by_role('button', name='Aplicar cutoff Vsh con evidencia a esta zona', exact=True)
        expect(apply).to_be_enabled(timeout=60000)
        return apply

    def close(d):
        d.get_by_role('button', name='Cerrar', exact=True).last.click()

    open_file(args.seed / 'full.pozo.json')
    before = save('before.pozo.json')
    d = editor()
    expect(d.get_by_role('button', name='Evaluar y previsualizar cutoff', exact=True)).to_be_disabled()
    configure(d)
    d.get_by_role('textbox', name='Cutoff Vsh propuesto', exact=True).fill('.505')
    d.get_by_role('button', name='Evaluar y previsualizar cutoff', exact=True).click()
    expect(d.get_by_text('Error: El cutoff debe respetar', exact=False)).to_be_visible(timeout=60000)
    d.get_by_role('textbox', name='Cutoff Vsh propuesto', exact=True).fill('0,5')
    main_before = page.evaluate('__qaMainRuns')
    evaluate(d)
    assert page.evaluate('__qaMainRuns') == main_before
    expect(d.get_by_text('5 muestras válidas; 5 excluidas.', exact=False)).to_be_visible()
    expect(d.get_by_text('Dentro del corte: 3 en el proxy', exact=False)).to_be_visible()
    impact = d.get_by_role('table', name='Impacto exacto del cutoff', exact=False)
    res = impact.get_by_role('row').filter(has_text='Reservorio neto').get_by_role('cell').all_text_contents()
    pay = impact.get_by_role('row').filter(has_text='Pay neto').get_by_role('cell').all_text_contents()
    assert float(res[2]) - float(res[1]) == 10
    assert float(pay[2]) - float(pay[1]) == 9
    impact.screenshot(path=str(args.output / 'impacto.png'))
    d.get_by_role('table', name='Contraste del cutoff', exact=False).screenshot(path=str(args.output / 'muestras.png'))
    d.get_by_role('textbox', name='Justificación del cutoff y limitaciones', exact=True).fill(values['Justificación del cutoff y limitaciones'] + ' Cambio.')
    expect(d.get_by_role('button', name='Aplicar cutoff Vsh con evidencia a esta zona', exact=True)).to_have_count(0)
    close(d)
    unchanged = save('preview-unchanged.pozo.json')
    assert unchanged['project'] == before['project']
    d = editor()
    configure(d)
    evaluate(d).click()
    settle()
    close(d)
    after = save('applied.pozo.json')
    old = before['project']['wells'][0]['interpretation']
    accepted = after['project']['wells'][0]['interpretation']
    assert accepted['params']['zones']['z'] == {**old['params']['zones']['z'], 'vshCutoff': .5}
    assert accepted['params']['global'] == old['params']['global']
    assert accepted['params']['zones']['other'] == old['params']['zones']['other']
    assert accepted['sources'] == old['sources']
    assert after['project']['blobs'] == before['project']['blobs']
    assert after['project']['inputRevisions'] == before['project']['inputRevisions']
    record = json.loads(accepted['pointSets']['lab']['settings']['xrd:cutoff:z'])
    assert record['impact']['after']['netRes'] - record['impact']['before']['netRes'] == 10
    assert record['impact']['after']['netPay'] - record['impact']['before']['netPay'] == 9
    assert record['config']['justification'] == values['Justificación del cutoff y limitaciones']
    assert not any(k.startswith('xrd:gr-calibration:') for k in accepted['pointSets']['lab']['settings'])
    page.keyboard.press('Control+z')
    settle()
    assert save('undo.pozo.json')['project'] == before['project']
    page.keyboard.press('Control+Shift+z')
    settle()
    assert save('redo.pozo.json')['project'] == after['project']
    page.get_by_title('Snapshots', exact=True).click()
    snap = page.get_by_role('dialog', name='Snapshots', exact=True)
    snap.get_by_role('textbox', name='Nombre del snapshot', exact=True).fill('Cutoff con evidencia')
    snap.get_by_role('button', name='Guardar snapshot', exact=True).click()
    page.keyboard.press('Escape')
    withsnap = save('snapshot.pozo.json')
    page.close()
    page = browser.new_page(viewport={'width': 1366, 'height': 900})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)
    open_file(args.output / 'snapshot.pozo.json')
    d = editor(False)
    d.locator('summary', has_text='Cutoffs DRX aceptados').click()
    expect(d.get_by_text('Zona QA: cutoff 0.4 → 0.5.', exact=False)).to_be_visible()
    close(d)
    modified = json.loads(json.dumps(withsnap))
    i = modified['project']['wells'][0]['interpretation']
    i['params']['zones']['z']['vshCutoff'] = .7
    del i['pointSets']['lab']['settings']['xrd:cutoff:z']
    path = args.output / 'modified-with-snapshot.pozo.json'
    path.write_text(json.dumps(modified))
    open_file(path)
    page.get_by_title('Snapshots', exact=True).click()
    snap = page.get_by_role('dialog', name='Snapshots', exact=True)
    snap.get_by_role('button', name='Restaurar', exact=True).first.click()
    page.keyboard.press('Escape')
    settle()
    assert save('restored.pozo.json')['project']['wells'][0]['interpretation'] == accepted
    future = json.loads(json.dumps(after))
    future_record = {**record, 'version': 999}
    future['project']['wells'][0]['interpretation']['pointSets']['lab']['settings']['xrd:cutoff:z'] = json.dumps(future_record)
    path = args.output / 'future.pozo.json'
    path.write_text(json.dumps(future))
    open_file(path)
    d = editor(False)
    d.locator('summary', has_text='Cutoffs DRX aceptados').click()
    expect(d.get_by_text('Versión de cutoff DRX desconocida', exact=False)).to_be_visible()
    close(d)
    assert json.loads(save('future-preserved.pozo.json')['project']['wells'][0]['interpretation']['pointSets']['lab']['settings']['xrd:cutoff:z']) == future_record
    page.close()
    # Nuevo contexto sin red ni APIs de Worker/crypto; impacto desconocido si faltan PHIE/Sw.
    page = browser.new_page(viewport={'width': 1366, 'height': 900})
    page.add_init_script("Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});")
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)
    page.context.set_offline(True)
    open_file(args.seed / 'missing.pozo.json')
    d = editor()
    configure(d)
    apply = evaluate(d)
    impact = d.get_by_role('table', name='Impacto exacto del cutoff', exact=False)
    expect(impact).to_contain_text('Sin dato')
    expect(impact).not_to_contain_text('0.0000')
    impact.screenshot(path=str(args.output / 'sin-datos-offline.png'))
    apply.click()
    settle()
    close(d)
    missing = save('offline-missing-applied.pozo.json')
    rec = json.loads(missing['project']['wells'][0]['interpretation']['pointSets']['lab']['settings']['xrd:cutoff:z'])
    assert rec['impact'] == {'before': None, 'after': None}
    assert not errors, errors
    (args.output / 'result.json').write_text(json.dumps({'errors': errors, 'validSamples': 5, 'excludedSamples': 5, 'reservoirDeltaM': 10, 'payDeltaM': 9, 'checks': ['explicit manual decision', 'off-step rejected', 'comma decimal', 'inclusive threshold and replicas', 'censoring gaps excluded and crossing zones', 'isolated preview no main run', 'control invalidation', 'preview leaves Project unchanged', 'zonal threshold and evidence one undo redo', 'GR sources other zones originals unchanged', 'new browser history', 'changed snapshot restored', 'future metadata preserved without execution', 'offline without Worker/SubtleCrypto', 'missing PHIE/Sw is unknown impact']}, indent=2))
    browser.close()
