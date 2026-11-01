"""Guardar/abrir v7 por UI: historial de curvas/laboratorio, worker, corrupción y offline."""
import argparse,base64,hashlib,json,re,shutil,struct,tempfile,zlib
from pathlib import Path
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url',default='http://127.0.0.1:4178/')
parser.add_argument('--parent',default='parent.html')
parser.add_argument('--candidate',default='candidate.html')
parser.add_argument('--seed',type=Path,required=True,help='Directorio generado por archive_v7.mjs')
parser.add_argument('--output',type=Path,default=Path(tempfile.gettempdir())/'pozo-v7-browser')
parser.add_argument('--chromium',default=shutil.which('chromium'))
config=parser.parse_args();out=config.output;out.mkdir(parents=True,exist_ok=True)
meta=json.loads((config.seed/'evidence.json').read_text())['seed'];errors=[]

def settle(page):
 expect(page.get_by_test_id('engine-status')).to_contain_text('Listo',timeout=60000)
 page.mouse.move(5,5);page.wait_for_timeout(500)
def open_file(page,path):
 page.locator('.shell-topbar input[type=file]').set_input_files(str(path))
 expect(page.get_by_text('Proyecto abierto',exact=True)).to_be_visible(timeout=60000);settle(page)
def save(page,name):
 page.get_by_role('button',name='Proyecto',exact=True).click()
 with page.expect_download(timeout=60000) as d:page.get_by_role('menuitem',name=re.compile('^Guardar proyecto')).click()
 path=out/name;d.value.save_as(path);return json.loads(path.read_text())
def export(page,name,figure=False):
 page.get_by_test_id('export-open').click();dialog=page.get_by_role('dialog')
 dialog.get_by_role('radio',name='Figuras' if figure else 'Datos del pozo',exact=True).click()
 if figure:
  dialog.get_by_role('radio',name='SVG',exact=True).click();dialog.get_by_role('combobox',name='Tramo de la figura',exact=True).select_option('well')
 else:dialog.get_by_role('checkbox',name=re.compile('^Incluir el sumario por zona')).uncheck()
 with page.expect_download(timeout=60000) as d:dialog.get_by_role('button',name='Exportar',exact=True).click()
 path=out/name;d.value.save_as(path);return hashlib.sha256(path.read_bytes()).hexdigest()
def preset(page):
 page.locator('.tb-template-btn').click();page.get_by_role('menuitem',name=re.compile('^Petrofísica esencial')).click()
 page.get_by_role('button',name='Ver todo el pozo',exact=True).click();page.wait_for_timeout(500)
def blob(file,ref):
 b=file['project']['blobs'][ref['blobId']];raw=base64.b64decode(b['data'],validate=True)
 if b['codec']!='f64le-b64':raw=zlib.decompress(raw)
 if b['codec']=='f64le-shuffle-deflate-b64':
  n=b['length'];raw=bytes(raw[k*n+i] for i in range(n) for k in range(8))
 assert len(raw)==b['byteLength']==b['length']*8
 assert b['sha256']==hashlib.sha256(raw).hexdigest()
 assert ref['blobId']=='sha256:'+b['sha256']
 return raw
def values(file,ref):
 raw=blob(file,ref);return struct.unpack('<'+'d'*(len(raw)//8),raw)
def verify(file,revision):
 assert file['version']==7
 p=file['project'];entry=next(e for e in p['wells'] if e['wellId']==meta['wellId'])
 assert entry['inputRevisionId']==revision and 'well' not in entry
 w=p['inputRevisions'][revision]['well'];gr=next(c for c in w['curves'] if c['id']==meta['grCurve'])
 expected=meta['originalGrFirst']+(20 if revision==meta['activeRevision'] else 0)
 assert values(file,gr['data'])[0]==expected
 assert values(file,w['pointSets'][0]['columns']['phi']['values'])[0]==(0.4 if revision==meta['activeRevision'] else 0.2)
 for bid in p['blobs']:blob(file,{'blobId':bid})
 assert meta['rootRevision'] in p['inputRevisions'] and meta['activeRevision'] in p['inputRevisions']

def page_for(browser,filename,setup=None):
 ctx=browser.new_context(viewport={'width':1366,'height':768},color_scheme='light')
 if setup:ctx.add_init_script(setup)
 page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(urljoin(config.url,filename));return ctx,page

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 evidence={}
 ctx,page=page_for(browser,config.parent)
 open_file(page,config.seed/'legacy-baseline.pozo.json');preset(page)
 evidence['parentLas']=export(page,'parent.las');evidence['parentSvg']=export(page,'parent.svg',True);ctx.close()
 setup='''(()=>{const NativeWorker=window.Worker;window.__qaFiles={created:0,terminated:0,active:0,maxActive:0};window.Worker=class extends NativeWorker{constructor(url,opts){super(url,opts);this.file=opts?.name==='archivos-proyecto';if(this.file){const q=window.__qaFiles;q.created++;q.active++;q.maxActive=Math.max(q.maxActive,q.active);}}terminate(){if(this.file){this.file=false;window.__qaFiles.terminated++;window.__qaFiles.active--;}return super.terminate();}}})();'''
 ctx,page=page_for(browser,config.candidate,setup)
 open_file(page,config.seed/'tp-v7.pozo.json');preset(page)
 first=save(page,'v7-saved.pozo.json');verify(first,meta['activeRevision'])
 assert first['project']['snapshots'][0]['inputRevisionId']==meta['rootRevision']
 page.get_by_title('Snapshots',exact=True).click()
 expect(page.get_by_test_id('snap-compare-table')).to_be_visible(timeout=60000)
 expect(page.get_by_test_id('snap-diff')).to_contain_text('versiones diferentes de los datos')
 page.screenshot(path=str(out/'01-comparar-revisiones.png'))
 page.keyboard.press('Escape')
 evidence['firstWorkers']=page.evaluate('window.__qaFiles');ctx.close()
 # Abrir en contexto nuevo: ningún proyecto, buffer o caché anterior puede resolver el historial.
 ctx,page=page_for(browser,config.candidate,setup)
 open_file(page,out/'v7-saved.pozo.json')
 page.get_by_title('Snapshots',exact=True).click();dialog=page.get_by_role('dialog',name='Snapshots',exact=True)
 dialog.get_by_role('button',name='Restaurar',exact=True).click();page.keyboard.press('Escape');settle(page)
 restored=save(page,'v7-restored.pozo.json');verify(restored,meta['rootRevision'])
 page.keyboard.press('Control+z');settle(page);verify(save(page,'v7-undo.pozo.json'),meta['activeRevision'])
 page.keyboard.press('Control+Shift+z');settle(page);verify(save(page,'v7-redo.pozo.json'),meta['rootRevision'])
 evidence['restoredLas']=export(page,'restored.las');evidence['restoredSvg']=export(page,'restored.svg',True)
 assert evidence['restoredLas']==evidence['parentLas']
 assert evidence['restoredSvg']==evidence['parentSvg']
 page.get_by_title('Snapshots',exact=True).click();page.get_by_role('dialog',name='Snapshots',exact=True).get_by_role('button',name='Cortina',exact=True).click()
 expect(page.locator('.wv-curtain')).to_be_visible(timeout=60000);page.keyboard.press('Escape');expect(page.locator('.wv-curtain')).to_have_count(0)
 # La apertura estricta no publica ninguna parte de un archivo corrupto.
 corrupt=json.loads(json.dumps(restored));b=next(iter(corrupt['project']['blobs'].values()));b['sha256']='0'*64
 path=out/'corrupt.pozo.json';path.write_text(json.dumps(corrupt));page.locator('.shell-topbar input[type=file]').set_input_files(str(path))
 expect(page.get_by_text('No se pudo abrir el proyecto',exact=True)).to_be_visible(timeout=60000)
 after=save(page,'after-error.pozo.json');assert after['project']==restored['project'];verify(after,meta['rootRevision'])
 # El límite de snapshots migrados queda visible al compararlos.
 migrated=json.loads(json.dumps(restored));migrated['project']['snapshots'][0]['inputBinding']='legacy-current-inputs';migrated['project']['inputRevisions'][meta['rootRevision']]['reason']='legacy-migration'
 path=out/'migrated.pozo.json';path.write_text(json.dumps(migrated));open_file(page,path)
 expect(page.get_by_text('Avisos al abrir el proyecto',exact=True)).to_be_visible(timeout=60000)
 page.get_by_title('Snapshots',exact=True).click();expect(page.get_by_text('Datos históricos limitados',exact=True)).to_be_visible(timeout=60000)
 page.screenshot(path=str(out/'02-limite-historico.png'));page.keyboard.press('Escape')
 evidence['workers']=page.evaluate('window.__qaFiles');assert evidence['workers']['maxActive']==1 and evidence['workers']['created']==evidence['workers']['terminated']
 evidence['restoredRevision']=meta['rootRevision'];evidence['activeRevision']=meta['activeRevision'];evidence['strictErrorPreservedProject']=True;ctx.close()
 # Sin Worker/SubtleCrypto y sin red después de cargar el HTML: fallback y blobs comprimidos.
 ctx,page=page_for(browser,config.candidate,"Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});")
 ctx.set_offline(True);open_file(page,config.seed/'tp-v7.pozo.json');fallback=save(page,'offline.pozo.json');verify(fallback,meta['activeRevision'])
 evidence['offlineWithoutWorkerOrSubtleCrypto']=True;ctx.close();browser.close()
 assert not errors,errors;evidence['pageErrors']=errors
 (out/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n');print(json.dumps(evidence,ensure_ascii=False))
