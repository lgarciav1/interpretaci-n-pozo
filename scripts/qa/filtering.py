"""Filtro físico por UI/Worker: datos, QC, ciclo de vida, composición y zonas."""
from pathlib import Path
exec(Path(__file__).with_name('archive_v7.py').read_text().split('with sync_playwright() as p:')[0])

def parse_las(path):
 names=[];rows=[];section=''
 for line in Path(path).read_text().splitlines():
  if line.startswith('~'):section=line.upper();continue
  if not line.strip() or line.startswith('#'):continue
  if section.startswith('~CURVE'):names.append(line.split('.',1)[0].strip().upper())
  if section.startswith('~A'):rows.append([float(v) for v in line.split()])
 return names,rows

def editor(page,radius='0.16',count=5):
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.get_by_role('combobox',name='Curva original',exact=True).select_option(meta['grCurve'])
 for label,value in [('Tope (m MD)',str(meta['depth'][meta['top']])),('Base (m MD)',str(meta['depth'][meta['base']])),('Radio de mediana (m MD)',radius),('Separación máxima para filtrar (m MD)','0.2')]:dialog.get_by_role('textbox',name=label,exact=True).fill(value)
 dialog.get_by_role('button',name='Previsualizar filtro',exact=True).click()
 expect(dialog.get_by_text(re.compile('^'+str(count)+' muestras filtradas con mediana'))).to_be_visible(timeout=60000)
 return dialog

def validate(path,baseline,pipeline=False):
 names,rows=parse_las(path);oldnames,oldrows=parse_las(baseline)
 gi=names.index('GR');pi=names.index('GR_PREPARADA');qi=names.index('GR_PREPARADA_QC');oi=oldnames.index('GR')
 assert len(rows)==len(oldrows)==5810
 for i,(row,old) in enumerate(zip(rows,oldrows)):
  assert row[0]==old[0] and row[gi]==old[oi]
  if i in meta['filteredIndices']:
   assert abs(row[pi]-(meta['pipelineExpected'] if pipeline else meta['expected'])[i-meta['top']])<1e-7
   assert row[qi]==(25 if pipeline and i==999 else 24 if pipeline and i==1000 else 16)
  else:
   assert row[pi]==row[gi];assert row[qi]==(1 if row[gi]==-999.25 else 0)
 return rows

instrument="""(()=>{const Native=Worker;window.__qaMainRuns=0;window.Worker=class extends Native{constructor(url,options){super(url,options);this.main=options?.name==='motor';}postMessage(m,t){if(this.main&&m.type==='run')window.__qaMainRuns++;return super.postMessage(m,t);}};})();"""
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 ctx,page=page_for(browser,config.candidate,instrument);open_file(page,config.seed/'legacy-baseline.pozo.json');preset(page)
 original=save(page,'baseline.pozo.json');base_las=export(page,'baseline.las');before=page.evaluate('__qaMainRuns')
 dialog=editor(page,'0.05',0);apply=dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True);expect(apply).to_be_disabled()
 dialog.get_by_role('textbox',name='Radio de mediana (m MD)',exact=True).fill('0.16');dialog.get_by_role('button',name='Previsualizar filtro',exact=True).click();expect(apply).to_be_enabled(timeout=60000)
 assert page.evaluate('__qaMainRuns')==before
 dialog.get_by_role('cell',name='Filtrada',exact=True).first.scroll_into_view_if_needed();dialog.screenshot(path=str(out/'preview-light.png'))
 page.emulate_media(color_scheme='dark');dialog.screenshot(path=str(out/'preview-dark.png'));page.emulate_media(color_scheme='light')
 dialog.get_by_role('textbox',name='Radio de mediana (m MD)',exact=True).fill('0.2');expect(apply).to_be_disabled()
 dialog.get_by_role('button',name='Cerrar',exact=True).last.click();assert save(page,'cancelled.pozo.json')['project']==original['project']
 dialog=editor(page);dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True).click();settle(page)
 prepared_las=export(page,'prepared.las');validate(out/'prepared.las',out/'baseline.las')
 prepared=save(page,'prepared.pozo.json');node=prepared['project']['wells'][0]['interpretation']['preparation']['nodes'][0]
 assert prepared['version']==7 and prepared['project']['wells'][0]['interpretation']['preparation']['schemaVersion']==3 and node['kind']=='median-filter'
 page.keyboard.press('Control+z');settle(page);assert export(page,'undo.las')==base_las
 page.keyboard.press('Control+Shift+z');settle(page);assert export(page,'redo.las')==prepared_las
 page.get_by_title('Snapshots',exact=True).click();snap=page.get_by_role('dialog',name='Snapshots',exact=True)
 snap.get_by_role('textbox',name='Nombre del snapshot',exact=True).fill('Filtro aceptado');snap.get_by_role('button',name='Guardar snapshot',exact=True).click();page.keyboard.press('Escape');prepared=save(page,'with-snapshot.pozo.json');ctx.close()
 ctx,page=page_for(browser,config.candidate);open_file(page,out/'with-snapshot.pozo.json');preset(page);assert export(page,'reopened.las')==prepared_las
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.get_by_role('button',name='Quitar filtro',exact=True).click();dialog.get_by_role('button',name='Cerrar',exact=True).last.click();settle(page);assert export(page,'restored.las')==base_las
 page.get_by_title('Snapshots',exact=True).click();snap=page.get_by_role('dialog',name='Snapshots',exact=True);snap.get_by_role('button',name='Restaurar',exact=True).first.click();page.keyboard.press('Escape');settle(page);assert export(page,'snapshot-restored.las')==prepared_las
 bad=json.loads(json.dumps(prepared));bad['project']['wells'][0]['interpretation']['preparation']['schemaVersion']=4;path=out/'future.pozo.json';path.write_text(json.dumps(bad));before=save(page,'before-future.pozo.json')
 page.locator('.shell-topbar input[type=file]').set_input_files(str(path));expect(page.get_by_text('No se pudo abrir el proyecto',exact=True)).to_be_visible(timeout=60000);assert save(page,'after-future.pozo.json')['project']==before['project'];ctx.close()
 # Una interpolación aceptada forma parte de la entrada fija del filtro; su influencia se propaga.
 ctx,page=page_for(browser,config.candidate);open_file(page,config.seed/'interpolated.pozo.json');export(page,'pipeline-before.las')
 # Exportar originales del mismo archivo permite verificar que el NaN no se sobrescribió.
 dialog=editor(page);dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True).click();settle(page);export(page,'pipeline.las');validate(out/'pipeline.las',out/'pipeline-before.las',True)
 pipeline=save(page,'pipeline.pozo.json');assert pipeline['project']['wells'][0]['interpretation']['preparation']['nodes'][0]['gapFill']
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog=page.get_by_role('dialog',name='Preparar datos',exact=True);dialog.get_by_role('button',name='Quitar interpolación',exact=True).click();dialog.get_by_role('button',name='Cerrar',exact=True).last.click();settle(page)
 remaining=save(page,'filter-without-interpolation.pozo.json');node=remaining['project']['wells'][0]['interpretation']['preparation']['nodes'][0];assert node['kind']=='median-filter' and 'gapFill' not in node;ctx.close()
 ctx,page=page_for(browser,config.candidate);open_file(page,config.seed/'zone-barrier.pozo.json');dialog=editor(page,count=1);dialog.get_by_role('button',name='Cerrar',exact=True).last.click();ctx.close()
 ctx,page=page_for(browser,config.candidate,"Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});");ctx.set_offline(True);open_file(page,out/'with-snapshot.pozo.json');export(page,'fallback.las');validate(out/'fallback.las',out/'baseline.las');ctx.close();browser.close();assert not errors,errors
 evidence={'filteredIndices':meta['filteredIndices'],'expected':meta['expected'],'pipelineExpected':meta['pipelineExpected'],'originalsAnd5810RowsPreserved':True,'qc16And24And25Validated':True,'fixedInputNoFeedback':True,'previewDoesNotRunMain':True,'zeroSupportBlocksApply':True,'cancelUnchanged':True,'undoRedo':True,'reopenedAndSnapshotRestored':True,'removeFilterRestoresOriginal':True,'removeInterpolationPreservesFilter':True,'zoneBoundaryReducesSupport':True,'futureSchemaRejectedAtomically':True,'offlineWithoutWorkerOrSubtleCrypto':True,'baselineLas':base_las,'preparedLas':prepared_las,'pageErrors':errors}
 (out/'evidence.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
