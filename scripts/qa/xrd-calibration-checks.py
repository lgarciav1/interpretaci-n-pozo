"""Extensiones P5: restaurar estado cambiado y calibrar offline sin Worker/SubtleCrypto.
Requiere artefactos de xrd-calibration.py en --artifacts.
"""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--artifacts',type=Path,default=Path('/tmp/p5-browser-final'));p.add_argument('--url',default='http://127.0.0.1:4178/');args=p.parse_args();out=args.artifacts;errors=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 def save(page,name):
  page.get_by_role('button',name='Proyecto',exact=True).click()
  with page.expect_download() as d:page.get_by_role('menuitem',name='Guardar proyecto',exact=False).click()
  path=out/name;d.value.save_as(path);return json.loads(path.read_text())
 def open_file(page,path):
  page.locator('.shell-topbar input[type=file]').set_input_files(str(path));expect(page.get_by_text('Proyecto abierto',exact=True)).to_be_visible(timeout=60000);expect(page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000)
 saved=json.loads((out/'snapshot.pozo.json').read_text());expected=saved['project']['wells'][0]['interpretation'];labid=next(k for k,v in expected['pointSets'].items() if any(key.startswith('xrd:gr-calibration:') for key in v.get('settings',{})));key='xrd:gr-calibration:z'
 modified=json.loads(json.dumps(saved));modified['project']['wells'][0]['interpretation']['params']['zones']['z']['grClean']=40;del modified['project']['wells'][0]['interpretation']['pointSets'][labid]['settings'][key];path=out/'modified-with-snapshot.pozo.json';path.write_text(json.dumps(modified))
 page=browser.new_page(viewport={'width':1366,'height':768});page.on('pageerror',lambda e:errors.append(str(e)));page.goto(args.url);open_file(page,path)
 page.get_by_title('Snapshots',exact=True).click();snap=page.get_by_role('dialog',name='Snapshots',exact=True);snap.get_by_role('button',name='Restaurar',exact=True).first.click();page.keyboard.press('Escape');expect(page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000);restored=save(page,'changed-state-restored.pozo.json');assert restored['project']['wells'][0]['interpretation']==expected;page.close()
 page=browser.new_page(viewport={'width':1366,'height':768});page.add_init_script("Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});");page.on('pageerror',lambda e:errors.append(str(e)));page.goto(args.url);page.context.set_offline(True);open_file(page,out/'before.pozo.json')
 page.get_by_role('button',name='Preparar datos',exact=True).click();d=page.get_by_role('dialog',name='Preparar datos',exact=True);d.locator('summary',has_text='DRX · carga').click();d.get_by_role('combobox',name='Conjunto DRX',exact=True).select_option(labid);d.get_by_role('combobox',name='Curva para comparar con DRX',exact=True).select_option('gr');d.get_by_role('textbox',name='Máximo entre anclajes DRX (m)',exact=True).fill('1');d.get_by_role('button',name='Comparar con soporte declarado',exact=True).click();expect(d.get_by_role('table',name='Pares DRX',exact=False)).to_be_visible(timeout=60000)
 for label,value in [('Arcillas del extremo limpio (fracción de sólidos)','0'),('Arcillas del extremo lutítico (fracción de sólidos)','1'),('Relación constitutiva y alcance del proxy de Vsh','Proxy sintético conocido de Vsh a partir de minerales de sólidos, solo para Zona QA.'),('Referencia de laboratorio independiente del GR','Laboratorio sintético independiente: fixture Python con valores conocidos de GR.')]:d.get_by_role('textbox',name=label,exact=True).fill(value)
 d.get_by_role('combobox',name='Zona de calibración GR',exact=True).select_option('z');d.get_by_role('checkbox',name='Confirmo que el objetivo procede de laboratorio independiente, no de Vsh calculado con el mismo GR',exact=True).check();d.get_by_role('button',name='Proponer y previsualizar calibración GR',exact=True).click();apply=d.get_by_role('button',name='Aplicar calibración GR a esta zona',exact=True);expect(apply).to_be_enabled(timeout=60000);apply.click();d.get_by_role('button',name='Cerrar',exact=True).last.click();fallback=save(page,'fallback-calibrated.pozo.json');assert fallback['project']['wells'][0]['interpretation']['params']['zones']['z']['grClean']==25;assert fallback['project']['wells'][0]['interpretation']['params']['zones']['z']['grShale']==135
 assert not errors,errors
 (out/'supplemental.json').write_text(json.dumps({'errors':errors,'checks':['snapshot restores changed parameters and deleted evidence','offline compare fit preview and apply without Worker/SubtleCrypto'],'knownGR':[25,135]},indent=2));browser.close()
