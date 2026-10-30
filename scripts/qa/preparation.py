"""P3 por UI y Worker real: preview aislado, aceptar, undo/redo, archivo y restauración."""
from pathlib import Path
exec(Path(__file__).with_name('archive_v7.py').read_text().split('with sync_playwright() as p:')[0])

instrument=r'''(()=>{
 const Native=Worker;const q=window.__qaPreparation={mainRuns:0,isolatedRuns:0,full:0,corrupt:false,bad:0,prepared:0};
 window.Worker=class extends Native{
  constructor(url,options){super(url,options);this.main=options?.name==='motor';this.isolated=options?.name==='motor-snapshots';this.listeners=new Map();this.events=new WeakMap();}
  postMessage(m,t){if(m.type==='run'){if(this.main){q.mainRuns++;if(m.full)q.full++;}if(this.isolated)q.isolatedRuns++;}return super.postMessage(m,t);}
  addEventListener(type,listener,options){
   if(type!=='message'||!this.main)return super.addEventListener(type,listener,options);
   const wrapped=e=>{let event=this.events.get(e);if(!event){let data=e.data;if(data.type==='result'&&data.prepared?.length){q.prepared++;if(q.corrupt){q.corrupt=false;q.bad++;data={...data,prepared:[]};}}
    event=data===e.data?e:new MessageEvent('message',{data});this.events.set(e,event);}typeof listener==='function'?listener.call(this,event):listener.handleEvent(event);};
   this.listeners.set(listener,wrapped);return super.addEventListener(type,wrapped,options);
  }
  removeEventListener(type,listener,options){return super.removeEventListener(type,this.listeners.get(listener)||listener,options);}
 };
})();'''

def parse_las(path):
 names=[];rows=[];section=''
 for line in Path(path).read_text().splitlines():
  if line.startswith('~'):section=line.upper();continue
  if not line.strip() or line.startswith('#'):continue
  if section.startswith('~CURVE'):names.append(line.split('.',1)[0].strip().upper())
  if section.startswith('~A'):rows.append([float(v) for v in line.split()])
 return names,rows

def prepare(page,top='7800',base='7810'):
 page.get_by_role('button',name='Preparar datos',exact=True).click()
 dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.get_by_role('combobox',name='Curva original',exact=True).select_option(meta['grCurve'])
 dialog.get_by_role('textbox',name='Tope (m MD)',exact=True).fill(top)
 dialog.get_by_role('textbox',name='Base (m MD)',exact=True).fill(base)
 dialog.get_by_role('button',name='Previsualizar exclusión',exact=True).click()
 expect(dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True)).to_be_enabled(timeout=60000)
 return dialog

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 evidence={}
 ctx,page=page_for(browser,config.candidate,instrument)
 open_file(page,config.seed/'legacy-baseline.pozo.json');preset(page)
 baseline=save(page,'baseline.pozo.json');evidence['baselineLas']=export(page,'baseline.las')
 native_before=page.evaluate('__qaPreparation.mainRuns')
 dialog=prepare(page)
 assert page.evaluate('__qaPreparation.mainRuns')==native_before
 dialog.screenshot(path=str(out/'01-preview-light.png'))
 assert dialog.get_by_role('row').count()<=15
 dialog.get_by_role('textbox',name='Base (m MD)',exact=True).fill('7811')
 expect(dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True)).to_be_disabled()
 dialog.get_by_role('button',name='Cerrar',exact=True).last.click()
 cancelled=save(page,'after-preview-cancel.pozo.json')
 assert baseline['project']==cancelled['project']
 evidence['previewDoesNotChangeProjectOrMainRuns']=True
 dialog=prepare(page)
 dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True).click();settle(page)
 evidence['preparedLas']=export(page,'prepared.las');evidence['preparedSvg']=export(page,'prepared.svg',True)
 prepared=save(page,'prepared.pozo.json');assert prepared['version']==7
 e=next(e for e in prepared['project']['wells'] if e['wellId']==meta['wellId']);node=e['interpretation']['preparation']['nodes'][0]
 raw=prepared['project']['inputRevisions'][e['inputRevisionId']]['well']
 assert not any(c['id'].startswith('prep:') for c in raw['curves'])
 assert e['interpretation']['sources']['GR']['curveId']=='prep:'+node['id']+':masked'
 assert node['input']['inputRevisionId'] in prepared['project']['inputRevisions']
 original_names,original_rows=parse_las(out/'baseline.las');names,rows=parse_las(out/'prepared.las')
 gi=names.index('GR');pi=names.index('GR_PREPARADA');qi=names.index('GR_PREPARADA_QC');oi=original_names.index('GR');changed=0
 assert len(rows)==len(original_rows)==5810
 for old,row in zip(original_rows,rows):
  assert old[0]==row[0] and old[oi]==row[gi]
  inside=7800<=row[0]<=7810;missing=row[gi]==-999.25
  assert row[qi]==(1 if missing else 0)+(2 if inside else 0)
  assert row[pi]==(-999.25 if inside else row[gi])
  changed+=inside and not missing
 evidence['changedFiniteSamples']=changed;assert changed>0
 page.keyboard.press('Control+z');settle(page)
 evidence['undoLas']=export(page,'undo.las');assert evidence['undoLas']==evidence['baselineLas']
 page.evaluate('__qaPreparation.corrupt=true')
 page.keyboard.press('Control+Shift+z');settle(page)
 evidence['redoLas']=export(page,'redo.las');assert evidence['redoLas']==evidence['preparedLas']
 transport=page.evaluate('({...__qaPreparation})');assert transport['bad']==1 and transport['full']==1
 evidence['atomicFullRecovery']=transport
 # El diálogo de snapshots compara/restaura la receta guardada, no datos actuales de respaldo.
 page.get_by_title('Snapshots',exact=True).click();snap=page.get_by_role('dialog',name='Snapshots',exact=True)
 snap.get_by_role('textbox',name='Nombre del snapshot',exact=True).fill('P3 preparado')
 snap.get_by_role('button',name='Guardar snapshot',exact=True).click();page.keyboard.press('Escape')
 prepared=save(page,'prepared-with-snapshot.pozo.json');assert prepared['project']['snapshots'][-1]['interpretation']['preparation']['nodes']
 ctx.close()
 ctx,page=page_for(browser,config.candidate)
 open_file(page,out/'prepared-with-snapshot.pozo.json');preset(page)
 evidence['reopenedLas']=export(page,'reopened.las');assert evidence['reopenedLas']==evidence['preparedLas']
 dialog=prepare(page,top='7820',base='7822')
 dialog.get_by_role('checkbox',name=re.compile('^Comparar originales y preparadas en el visor')).check()
 dialog.screenshot(path=str(out/'02-saved-and-preview.png'))
 page.emulate_media(color_scheme='dark');dialog.screenshot(path=str(out/'03-preview-dark.png'));page.emulate_media(color_scheme='light')
 dialog.get_by_role('button',name='Cerrar',exact=True).last.click()
 # Corrupción de receta rechazada sin sustituir el proyecto preparado activo.
 malformed=json.loads(json.dumps(prepared));malformed['project']['wells'][0]['interpretation']['preparation']['nodes'][0]['methodVersion']=99
 before_bad=save(page,'before-unsupported.pozo.json')
 bad=out/'unsupported.pozo.json';bad.write_text(json.dumps(malformed));page.locator('.shell-topbar input[type=file]').set_input_files(str(bad))
 expect(page.get_by_text('No se pudo abrir el proyecto',exact=True)).to_be_visible(timeout=60000)
 unchanged=save(page,'after-unsupported.pozo.json');assert unchanged['project']==before_bad['project']
 evidence['unsupportedRecipePreservesProject']=True
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.get_by_role('button',name='Restaurar original de GR',exact=True).click();dialog.get_by_role('button',name='Cerrar',exact=True).last.click();settle(page)
 evidence['restoredLas']=export(page,'restored.las');assert evidence['restoredLas']==evidence['baselineLas']
 restored=save(page,'restored.pozo.json');assert len(restored['project']['blobs'])==len(prepared['project']['blobs'])
 page.get_by_title('Snapshots',exact=True).click();snap=page.get_by_role('dialog',name='Snapshots',exact=True)
 snap.get_by_role('button',name='Restaurar',exact=True).first.click();page.keyboard.press('Escape');settle(page)
 evidence['snapshotRestoredLas']=export(page,'snapshot-restored.las');assert evidence['snapshotRestoredLas']==evidence['preparedLas']
 evidence['decisionsOnlyNoPreparedBlobs']=True
 ctx.close()
 setup="Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});"
 ctx,page=page_for(browser,config.candidate,setup);ctx.set_offline(True)
 open_file(page,out/'prepared-with-snapshot.pozo.json')
 export(page,'fallback.las');fallback_names,fallback_rows=parse_las(out/'fallback.las')
 for name in ['GR','GR_PREPARADA','GR_PREPARADA_QC']:
  assert [r[fallback_names.index(name)] for r in fallback_rows]==[r[names.index(name)] for r in rows]
 evidence['offlineWithoutWorkerOrSubtleCrypto']=True
 ctx.close();browser.close()
 assert not errors,errors;evidence['pageErrors']=errors
 (out/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n');print(json.dumps(evidence))
