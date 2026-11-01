"""Recorrido de corrida atómica y diagnóstico DRX sobre TP sintético. HTTP local."""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--touch',action='store_true');parser.add_argument('--url',default='http://127.0.0.1:4178/');parser.add_argument('--seed',type=Path,default=Path('/tmp/p3p4-seed'));parser.add_argument('--output',type=Path,default=Path('/tmp/p3p4-browser'));args=parser.parse_args();args.output.mkdir(exist_ok=True,parents=True)
meta=json.loads((args.seed/'evidence.json').read_text())['seed'];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1366,'height':768},has_touch=args.touch);page.on('pageerror',lambda e:errors.append(str(e)));page.goto(args.url)
 page.locator('.shell-topbar input[type=file]').set_input_files(str(args.seed/'legacy-baseline.pozo.json'))
 expect(page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000)
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.locator('summary',has_text='Gestionar corridas').click()
 dialog.get_by_role('textbox',name='Identificador de corrida',exact=True).fill('R-TP')
 # Mnemónicos elegidos según roles originales conocidos.
 original=json.loads((args.seed/'legacy-baseline.pozo.json').read_text());curves=original['project']['wells'][0]['well']['curves'];gr=next(c for c in curves if c['role']=='GR');rt=next(c for c in curves if c['role']=='RT')
 for c in [gr,rt]:dialog.get_by_role('checkbox',name=c['mnemonic'],exact=True).check()
 dialog.get_by_role('button',name='Registrar corrida',exact=True).click()
 dialog.get_by_role('combobox',name='Alcance de alineación',exact=True).select_option('R-TP')
 for label,value in [('Desplazamiento constante (m)','0.3048'),('Hueco máximo de remuestreo (m MD)','0.2'),('Datum declarado de origen y destino','KB declarado')]:dialog.get_by_role('textbox',name=label,exact=True).fill(value)
 dialog.get_by_role('checkbox',name='Declaro que la curva y el índice del pozo comparten referencia MD y el datum indicado',exact=True).check()
 dialog.get_by_role('button',name='Previsualizar alineación',exact=True).click()
 apply=dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True);expect(apply).to_be_enabled(timeout=60000)
 expect(dialog.get_by_role('table',name='Cobertura del lote completo')).to_be_visible()
 dialog.get_by_role('table',name='Cobertura del lote completo').screenshot(path=str(args.output/'run-preview.png'))
 if args.touch: apply.tap()
 else: apply.focus();page.keyboard.press('Enter')
 expect(page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000)
 def save(name):
  page.get_by_role('button',name='Proyecto',exact=True).click()
  with page.expect_download() as d:page.get_by_role('menuitem',name=re.compile('^Guardar proyecto')).click()
  dest=args.output/name;d.value.save_as(dest);return json.loads(dest.read_text())
 q=save('run.pozo.json');e=q['project']['wells'][0];assert len(e['interpretation']['preparation']['nodes'])==2
 assert {n['shift']['offsetM'] for n in e['interpretation']['preparation']['nodes']}=={.3048}
 page.keyboard.press('Control+z');expect(page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000)
 u=save('undo.pozo.json');assert 'preparation' not in u['project']['wells'][0]['interpretation']
 page.keyboard.press('Control+Shift+z');expect(page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000)
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.locator('summary',has_text='DRX').click()
 lab=args.output/'lab.csv';lab.write_text('MD;Q;C\n7800;60;40\n7800;ND;BLD\n7810;50;50\n')
 dialog.get_by_label('Archivo DRX CSV o Excel',exact=True).set_input_files(str(lab))
 dialog.get_by_label('DRX depth',exact=True).select_option('0')
 dialog.get_by_role('textbox',name='Referencia del informe DRX',exact=True).fill('Ensayo sintético QA')
 for mineral in ['Q','C']:dialog.get_by_role('checkbox',name=f'Mineral: {mineral}',exact=True).check()
 dialog.get_by_role('checkbox',name='C es mineral arcilloso',exact=True).check()
 dialog.get_by_role('textbox',name='Datum MD de laboratorio y perfiles',exact=True).fill('KB declarado')
 dialog.get_by_role('checkbox',name='Confirmo referencia MD del mismo pozo y datum compartido para DRX',exact=True).check()
 dialog.get_by_role('button',name='Revisar DRX',exact=True).click()
 expect(dialog.get_by_text('3 muestras. Se conservan duplicados',exact=False)).to_be_visible()
 dialog.get_by_role('button',name='Importar muestras revisadas',exact=True).click()
 expect(page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000)
 dialog.get_by_role('combobox',name='Curva para comparar con DRX',exact=True).select_option(e['interpretation']['sources']['GR']['curveId'])
 dialog.get_by_role('textbox',name='Máximo entre anclajes DRX (m)',exact=True).fill('.2')
 dialog.get_by_role('button',name='Comparar con soporte declarado',exact=True).click()
 table=dialog.get_by_role('table',name='Pares DRX',exact=False);expect(table).to_be_visible(timeout=60000)
 expect(table).to_contain_text('0.4000');expect(table).to_contain_text('censurada')
 table.screenshot(path=str(args.output/'xrd-pairs.png'))
 dialog.get_by_role('button',name='Cerrar',exact=True).last.click();labfile=save('xrd.pozo.json')
 w=labfile['project']['inputRevisions'][labfile['project']['wells'][0]['inputRevisionId']]['well'];x=next(s for s in w['pointSets'] if s['kind']=='xrd');assert x['columns']['status:m1']['values'][1]=='not-detected';assert x['columns']['status:m2']['values'][1]=='below-detection'
 assert not errors,errors
 (args.output/'result.json').write_text(json.dumps({'errors':errors,'runCurves':2,'xrdRows':3,'checks':['preview','atomic apply','undo','redo','import states','prepared pairs','v7 save']},indent=2))
 browser.close()
