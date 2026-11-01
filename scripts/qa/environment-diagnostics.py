"""Diagnóstico ambiental del CSV real: observación, soportes, hipótesis radial y Project intacto."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:4178/')
parser.add_argument('--seed', type=Path, default=Path('/tmp/environment-seed'))
parser.add_argument('--output', type=Path, default=Path('/tmp/environment-browser'))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox', '--disable-dev-shm-usage'])

    def fresh(offline=False):
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        if offline:
            page.add_init_script("Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});")
        page.goto(args.url)
        if offline:
            page.context.set_offline(True)
        return page

    page = fresh()

    def open_project(kind):
        page.locator('.shell-topbar input[type=file]').set_input_files(str(args.seed/f'{kind}.pozo.json'))
        expect(page.get_by_text('Proyecto abierto', exact=True).last).to_be_visible(timeout=60000)
        expect(page.get_by_test_id('engine-status')).to_contain_text('Listo', timeout=60000)

    def save_project(name):
        page.get_by_role('button', name='Proyecto', exact=True).click()
        with page.expect_download() as download:
            page.get_by_role('menuitem', name=re.compile('^Guardar proyecto')).click()
        path = args.output/name
        download.value.save_as(path)
        return json.loads(path.read_text())['project']

    def open_diagnostic():
        page.get_by_role('button', name='Preparar datos', exact=True).click()
        dialog = page.get_by_role('dialog', name='Preparar datos', exact=True)
        dialog.locator('summary', has_text='Diagnóstico ambiental con datos disponibles').click()
        return dialog, dialog.get_by_role('region', name='Revisión ambiental de originales', exact=True)

    def export(panel, name):
        with page.expect_download() as download:
            panel.get_by_role('button', name='Exportar diagnóstico ambiental', exact=True).click()
        path = args.output/name
        download.value.save_as(path)
        return json.loads(path.read_text())

    def criteria(panel):
        panel.locator('summary', has_text='Curvas y criterios del diagnóstico').click()

    open_project('tp')
    before = save_project('before.pozo.json')
    dialog, panel = open_diagnostic()
    full = export(panel, 'tp-full.json')
    assert full['total']['samples'] == 5810 and full['total']['invalidCaliper'] == 189
    assert full['acquisition']['runs'] == [] and full['acquisition']['depth']['datum'] is None
    assert full['basis'] == 'original-measured-curves' and full['radialHypothesis'] is None
    assert len(full['inputs']) == 8
    for key in ['samples', 'invalidCaliper', 'geometryPairs', 'washout', 'belowBit', 'pePairs', 'suspectPe', 'resistivityTriples', 'separated']:
        assert sum(zone['counts'][key] for zone in full['zones']) == full['total'][key]
    panel.locator('summary', has_text='Procesado declarado y compatibilidad').click()
    expect(panel.get_by_role('table', name='Estado de las curvas seleccionadas')).to_contain_text('Desconocido')
    panel.locator('summary', has_text='Procesado declarado y compatibilidad').click()
    expect(page.get_by_text('Proyecto abierto', exact=True).last).not_to_be_visible(timeout=10000)
    panel.get_by_role('table', name='Alertas por zona · originales').screenshot(path=str(args.output/'zonas.png'))
    panel.get_by_role('textbox', name='Profundidad del diagnóstico (m MD)', exact=True).fill('7785,66')
    panel.get_by_role('checkbox', name=re.compile('^Explorar hipótesis de inducción de arreglo')).check()
    expect(panel.get_by_role('region', name='Hipótesis radial sobre originales')).to_be_visible()
    radial = export(panel, 'tp-radial.json')
    assert len(radial['radialHypothesis']['readings']) == 4
    assert radial['radialHypothesis']['bitFrom'] == 'curve'
    assert radial['radialHypothesis']['basis'] == 'approximate-array-induction-on-originals'
    panel.get_by_role('region', name='Hipótesis radial sobre originales').screenshot(path=str(args.output/'radial.png'))
    criteria(panel)
    panel.get_by_role('textbox', name='Caliper mínimo operativo (in)', exact=True).fill('1')
    changed = export(panel, 'tp-minimum-1.json')
    assert changed['total']['invalidCaliper'] == 0 and changed['criteria']['minCaliperIn'] == 1
    panel.get_by_role('textbox', name='Caliper mínimo operativo (in)', exact=True).fill('error')
    expect(panel.get_by_role('button', name='Exportar diagnóstico ambiental')).to_have_count(0)
    panel.get_by_role('textbox', name='Caliper mínimo operativo (in)', exact=True).fill('5')
    criteria(panel)
    dialog.get_by_role('textbox', name='Tope (m MD)', exact=True).fill('7785.66')
    dialog.get_by_role('textbox', name='Base (m MD)', exact=True).fill('7786')
    part = export(panel, 'tp-range.json')
    assert 0 < part['total']['samples'] < 5810 and part['rangeM'] == {'top': 7785.66, 'base': 7786}
    dialog.get_by_role('textbox', name='Tope (m MD)', exact=True).fill('20000')
    dialog.get_by_role('textbox', name='Base (m MD)', exact=True).fill('20001')
    panel.get_by_role('textbox', name='Profundidad del diagnóstico (m MD)', exact=True).fill('20000.5')
    empty = export(panel, 'tp-empty.json')
    assert empty['total']['samples'] == 0 and empty['inspectedSample'] is None and empty['radialHypothesis'] is None
    dialog.get_by_role('button', name='Cerrar', exact=True).last.click()
    assert save_project('after.pozo.json') == before
    open_project('ambiguous')
    dialog, panel = open_diagnostic()
    ambiguous = export(panel, 'ambiguous.json')
    assert ambiguous['total']['geometryPairs'] == 0 and any('varias curvas' in s for s in ambiguous['issues'])
    criteria(panel)
    # Los ids de cada importación son nuevos: se elige por mnemónico/unidad visible.
    option = panel.get_by_role('combobox', name='Original CALI para diagnóstico').locator('option').filter(has_text=re.compile(r'^CAL ·'))
    panel.get_by_role('combobox', name='Original CALI para diagnóstico').select_option(option.get_attribute('value'))
    assert export(panel, 'ambiguous-selected.json')['total']['invalidCaliper'] == 189
    panel.get_by_role('combobox', name='Original RT para diagnóstico').select_option('')
    panel.get_by_role('combobox', name='Original RM para diagnóstico').select_option('')
    assert export(panel, 'two-resistivities.json')['total']['resistivityTriples'] == 0
    page.close()
    page = fresh(True)
    open_project('tp')
    dialog, panel = open_diagnostic()
    offline = export(panel, 'offline.json')
    assert offline['total'] == full['total']
    panel.get_by_role('checkbox', name=re.compile('^Explorar hipótesis de inducción de arreglo')).check()
    assert len(export(panel, 'offline-radial.json')['radialHypothesis']['readings']) == 4
    assert not errors, errors
    (args.output/'result.json').write_text(json.dumps({'errors': errors, 'tpTotals': full['total'], 'checks': [
        'real TP with unknown acquisition', 'zone denominators and aggregation', 'read-only compatibility table',
        'explicit radial hypothesis with observations/model/residual', 'criteria sensitivity and invalid input',
        'inclusive range and empty range without stale inspection', 'Project unchanged',
        'ambiguous caliper requires selection', 'two resistivities have no valid triple',
        'JSON includes provenance and assumptions', 'offline without Worker/SubtleCrypto'
    ]}, indent=2))
    browser.close()
