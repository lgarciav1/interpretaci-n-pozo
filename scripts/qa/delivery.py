"""P8: recorrido TP/sintético, preparación, archivos, snapshots, exportación e informe offline."""
import argparse
import csv
import io
import json
import re
import zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:4178/')
parser.add_argument('--seed', type=Path, default=Path('/tmp/p8-seed'))
parser.add_argument('--output', type=Path, default=Path('/tmp/p8-browser'))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
meta = json.loads((args.seed/'meta.json').read_text())
errors = []
formats = {'csv': 'CSV', 'las': 'LAS 2.0', 'xlsx': 'Excel (.xlsx)'}
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox', '--disable-dev-shm-usage'])
    def fresh(fallback=False):
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        if fallback:
            page.add_init_script("Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});")
        page.goto(args.url)
        if fallback:
            page.context.set_offline(True)
        return page
    page = fresh()
    def settle():
        expect(page.get_by_test_id('engine-status')).to_contain_text('Listo', timeout=90000)
    def load(path):
        page.locator('.shell-topbar input[type=file]').set_input_files(str(path))
        expect(page.get_by_text('Proyecto abierto', exact=True).last).to_be_visible(timeout=60000)
        settle()
    def save(name):
        page.get_by_role('button', name='Proyecto', exact=True).click()
        with page.expect_download() as d:
            page.get_by_role('menuitem', name=re.compile('^Guardar proyecto')).click()
        path = args.output/name
        d.value.save_as(path)
        return json.loads(path.read_text())['project']
    def prepare():
        page.get_by_role('button', name='Preparar datos', exact=True).click()
        return page.get_by_role('dialog', name='Preparar datos', exact=True)
    def close(d):
        d.get_by_role('button', name='Cerrar', exact=True).last.click()
    def export_dialog(kind):
        page.get_by_test_id('export-open').click()
        d = page.get_by_role('dialog', name='Exportar', exact=True)
        d.get_by_role('radio', name=kind, exact=True).click()
        return d
    def export_data(format, name):
        d = export_dialog('Datos del pozo')
        d.get_by_role('radio', name=formats[format], exact=True).click()
        with page.expect_download(timeout=90000) as downloaded:
            d.get_by_role('button', name='Exportar', exact=True).click()
        path = args.output/name
        downloaded.value.save_as(path)
        return path
    def csv_rows(path):
        with zipfile.ZipFile(path) as z:
            data = next(n for n in z.namelist() if n.endswith('.csv') and 'sumario' not in n.lower())
            return list(csv.DictReader(io.StringIO(z.read(data).decode('utf-8-sig'))))
    def inspect_export(path):
        rows = csv_rows(path)
        assert len(rows) == 5810
        original = next(k for k in rows[0] if k.startswith('NPHI') and 'preparada' not in k.lower())
        prepared = next(k for k in rows[0] if k.startswith('NPHI') and 'preparada' in k.lower() and 'qc' not in k.lower())
        qc = next(k for k in rows[0] if k.startswith('NPHI') and 'qc' in k.lower())
        row = min(rows, key=lambda r: abs(float(next(v for k,v in r.items() if k.startswith('DEPTH')))-meta['tp']['reviewDepth']))
        assert float(row[original]) == meta['tp']['originalValue'] and row[prepared] == '' and float(row[qc]) == 2
        return rows
    def report(name, figures='none', synthetic=False):
        d = export_dialog('Informe')
        d.get_by_role('combobox', name='Figuras del perfil del informe').select_option(figures)
        with page.expect_download() as downloaded:
            d.get_by_role('button', name='Descargar manual de entrega', exact=True).click()
        downloaded.value.save_as(args.output/'Manual.html')
        d.get_by_role('button', name='Generar informe', exact=True).click()
        expect(d.get_by_role('button', name='Guardar HTML', exact=True)).to_be_enabled(timeout=90000)
        with page.expect_download() as downloaded:
            d.get_by_role('button', name='Guardar HTML', exact=True).click()
        path = args.output/name
        downloaded.value.save_as(path)
        html = path.read_text()
        assert 'Preparación, laboratorio y alcance' in html
        assert not re.search(r'(?:src|href)="https?:', html)
        if synthetic:
            assert 'GR limpio 25; GR lutita 135' in html and '0.4 → 0.5' in html and 'RMSE por bloques' in html
        else:
            assert 'Sin laboratorio DRX importado' in html and 'NPHI preparada' in html
        if figures != 'none':
            assert 'data:image/svg+xml;base64,' in html
        d.get_by_role('button', name='Cancelar', exact=True).click()
        return path

    load(args.seed/'TP-base.pozo.json')
    before = save('tp-before.pozo.json')
    d = prepare()
    d.get_by_role('combobox', name='Curva original', exact=True).select_option(meta['tp']['nphiId'])
    for label in ['Tope (m MD)', 'Base (m MD)']:
        d.get_by_role('textbox', name=label, exact=True).fill(str(meta['tp']['reviewDepth']))
    d.get_by_role('button', name='Previsualizar exclusión', exact=True).click()
    apply = d.get_by_role('button', name='Aplicar y usar para NPHI', exact=True)
    expect(apply).to_be_enabled(timeout=90000)
    expect(d.get_by_role('region', name='Vista previa de exclusión')).to_contain_text('Excluida')
    apply.click(); settle(); expect(d).not_to_be_visible()
    accepted = save('tp-prepared.pozo.json')
    assert accepted['blobs'] == before['blobs'] and accepted['inputRevisions'] == before['inputRevisions']
    i = accepted['wells'][0]['interpretation']
    assert i['params'] == before['wells'][0]['interpretation']['params']
    assert i['sources']['NPHI']['curveId'].startswith('prep:')
    page.keyboard.press('Control+z'); settle()
    assert save('tp-undo.pozo.json') == before
    page.keyboard.press('Control+Shift+z'); settle()
    assert save('tp-redo.pozo.json') == accepted
    page.get_by_title('Snapshots', exact=True).click()
    snap = page.get_by_role('dialog', name='Snapshots', exact=True)
    snap.get_by_role('textbox', name='Nombre del snapshot', exact=True).fill('P8 QA: NPHI revisado, no interpretación final')
    snap.get_by_role('button', name='Guardar snapshot', exact=True).click()
    page.keyboard.press('Escape')
    save('tp-snapshot.pozo.json')
    first_csv = export_data('csv','tp-csv.zip')
    rows = inspect_export(first_csv)
    export_data('las','tp-las.zip')
    export_data('xlsx','tp.xlsx')
    tp_report = report('tp-informe.html',figures='zones')
    # El HTML se abre como documento sin red; file:// se intenta por separado, sin eludir la política del navegador.
    document = browser.new_page()
    document.context.set_offline(True)
    document.set_content(tp_report.read_text(), wait_until='load')
    expect(document.get_by_role('heading', name='Preparación, laboratorio y alcance', exact=True)).to_be_visible()
    document.emulate_media(media='print')
    document.locator('section').filter(has=document.get_by_role('heading', name='Preparación, laboratorio y alcance', exact=True)).screenshot(path=str(args.output/'informe-diagnostico.png'))
    document.pdf(path=str(args.output/'tp-informe.pdf'),print_background=True,prefer_css_page_size=True)
    document.close()
    # Retirar la receta y restaurar el snapshot recupera la aceptación anterior.
    d = prepare()
    d.get_by_role('button', name='Restaurar original de NPHI', exact=True).click(); settle(); close(d)
    page.get_by_title('Snapshots', exact=True).click()
    page.get_by_role('dialog', name='Snapshots', exact=True).get_by_role('button', name='Restaurar', exact=True).first.click()
    page.keyboard.press('Escape'); settle()
    assert save('tp-restored.pozo.json')['wells'][0]['interpretation'] == i
    page.close(); page = fresh()
    load(args.output/'tp-snapshot.pozo.json')
    assert inspect_export(export_data('csv','tp-reopened.zip')) == rows
    report('tp-reopened-informe.html')
    load(args.seed/'Ejemplo-sintetico.pozo.json')
    synthetic_before = save('synthetic-before.pozo.json')
    report('sintetico-informe.html',figures='well',synthetic=True)
    assert save('synthetic-after.pozo.json') == synthetic_before
    page.close(); page = fresh(True)
    load(args.output/'tp-snapshot.pozo.json')
    inspect_export(export_data('csv','tp-offline.zip'))
    report('tp-offline-informe.html')
    # Apertura local ordinaria, sin flags para saltar restricciones administrativas.
    file_page = browser.new_page()
    file_result = {'status': 'not-tested'}
    try:
        file_page.goto((Path.cwd()/'dist/index.html').as_uri())
        expect(file_page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000)
        file_result = {'status': 'passed'}
    except Exception as error:
        message = str(error)
        if 'ERR_BLOCKED_BY_ADMINISTRATOR' not in message:
            raise
        file_result = {'status': 'blocked-by-administrator', 'reason': 'Managed Chromium rejects file:// before loading the HTML; no bypass attempted.'}
    file_page.close()
    assert not errors, errors
    (args.output/'result.json').write_text(json.dumps({'errors': errors,'tpSamples':len(rows),'synthetic':meta['synthetic'],
        'fileProtocol':file_result,'checks':['TP original and prepared values/QC','original blobs revisions parameters preserved',
        'atomic undo redo','snapshot restore after removal','CSV LAS xlsx downloads','CSV equal after reopening in new browser',
        'self-contained report with zonal embedded figures and printable PDF','manual download offline',
        'synthetic GR and cutoff accepted evidence in report','offline without Worker/SubtleCrypto']},indent=2))
    browser.close()
