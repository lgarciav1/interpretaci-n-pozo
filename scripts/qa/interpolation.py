"""Interpolación: UI/Worker, huecos cortos/largos, QC, recetas, snapshots y fallback offline."""
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

def editor(page,maximum='1'):
 page.get_by_role('button',name='Preparar datos',exact=True).click()
 dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.get_by_role('combobox',name='Curva original',exact=True).select_option(meta['grCurve'])
 dialog.get_by_role('textbox',name='Tope (m MD)',exact=True).fill(str(meta['depth'][995]))
 dialog.get_by_role('textbox',name='Base (m MD)',exact=True).fill(str(meta['depth'][1115]))
 dialog.get_by_role('textbox',name='Distancia máxima entre anclajes (m MD)',exact=True).fill(maximum)
 dialog.get_by_role('button',name='Previsualizar interpolación',exact=True).click()
 expect(dialog.get_by_text(re.compile('^'+('0' if maximum=='0.3' else '2')+' muestras estimadas por interpolación'))).to_be_visible(timeout=60000)
 return dialog

instrument="""(()=>{const Native=Worker;window.__qaMainRuns=0;window.Worker=class extends Native{constructor(url,options){super(url,options);this.main=options?.name==='motor';}postMessage(m,t){if(this.main&&m.type==='run')window.__qaMainRuns++;return super.postMessage(m,t);}};})();"""
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 ctx,page=page_for(browser,config.candidate,instrument)
 open_file(page,config.seed/'legacy-baseline.pozo.json');preset(page)
 baseline=save(page,'baseline.pozo.json');baseline_las=export(page,'baseline.las');before_runs=page.evaluate('__qaMainRuns')
 dialog=editor(page,'0.3');apply=dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True)
 expect(apply).to_be_disabled()
 dialog.get_by_role('textbox',name='Distancia máxima entre anclajes (m MD)',exact=True).fill('1')
 dialog.get_by_role('button',name='Previsualizar interpolación',exact=True).click()
 expect(apply).to_be_enabled(timeout=60000)
 assert page.evaluate('__qaMainRuns')==before_runs
 estimated=dialog.get_by_role('cell',name='Estimada · interpolada',exact=True).first
 expect(estimated).to_be_visible();estimated.scroll_into_view_if_needed()
 dialog.screenshot(path=str(out/'preview-light.png'));page.emulate_media(color_scheme='dark');dialog.screenshot(path=str(out/'preview-dark.png'));page.emulate_media(color_scheme='light')
 dialog.get_by_role('textbox',name='Distancia máxima entre anclajes (m MD)',exact=True).fill('2');expect(apply).to_be_disabled()
 dialog.get_by_role('button',name='Cerrar',exact=True).last.click()
 cancelled=save(page,'cancelled.pozo.json');assert cancelled['project']==baseline['project']
 dialog=editor(page);dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True).click();settle(page)
 prepared_las=export(page,'prepared.las');names,rows=parse_las(out/'prepared.las');old_names,old_rows=parse_las(out/'baseline.las')
 gi=names.index('GR');pi=names.index('GR_PREPARADA');qi=names.index('GR_PREPARADA_QC');oi=old_names.index('GR')
 assert len(rows)==len(old_rows)==5810
 filled=[]
 for i,(row,old) in enumerate(zip(rows,old_rows)):
  assert row[0]==old[0] and row[gi]==old[oi]
  if i in meta['shortGap']:
   assert abs(row[pi]-meta['expected'][meta['shortGap'].index(i)])<1e-7
   assert row[qi]==9;filled.append(i)
  else:
   assert row[pi]==row[gi]
   assert row[qi]==(1 if old[oi]==-999.25 else 0)
 assert filled==meta['shortGap']
 prepared=save(page,'prepared.pozo.json');node=prepared['project']['wells'][0]['interpretation']['preparation']['nodes'][0]
 assert prepared['project']['wells'][0]['interpretation']['preparation']['schemaVersion']==2 and node['kind']=='linear-interpolation' and not node['intervals']
 assert node['gapFill']['maxGapM']==1
 page.keyboard.press('Control+z');settle(page);assert export(page,'undo.las')==baseline_las
 page.keyboard.press('Control+Shift+z');settle(page);assert export(page,'redo.las')==prepared_las
 page.get_by_title('Snapshots',exact=True).click();snap=page.get_by_role('dialog',name='Snapshots',exact=True)
 snap.get_by_role('textbox',name='Nombre del snapshot',exact=True).fill('Interpolación aceptada');snap.get_by_role('button',name='Guardar snapshot',exact=True).click();page.keyboard.press('Escape')
 prepared=save(page,'with-snapshot.pozo.json');ctx.close()
 ctx,page=page_for(browser,config.candidate);open_file(page,out/'with-snapshot.pozo.json');preset(page)
 assert export(page,'reopened.las')==prepared_las
 # Una exclusión sobre un faltante original bloquea el hueco entero.
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.get_by_role('textbox',name='Tope (m MD)',exact=True).fill(str(meta['depth'][1000]));dialog.get_by_role('textbox',name='Base (m MD)',exact=True).fill(str(meta['depth'][1000]))
 dialog.get_by_role('button',name='Previsualizar exclusión',exact=True).click();expect(dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True)).to_be_enabled(timeout=60000)
 expect(dialog.get_by_text(re.compile('^0 muestras estimadas por interpolación'))).to_be_visible()
 dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True).click();settle(page)
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog.get_by_role('button',name='Quitar interpolación',exact=True).click();dialog.get_by_role('button',name='Cerrar',exact=True).last.click();settle(page)
 masked=save(page,'without-interpolation.pozo.json');recipe=masked['project']['wells'][0]['interpretation']['preparation']
 assert recipe['schemaVersion']==1 and recipe['nodes'][0]['kind']=='mask' and len(recipe['nodes'][0]['intervals'])==1
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog.get_by_role('button',name='Restaurar original de GR',exact=True).click();dialog.get_by_role('button',name='Cerrar',exact=True).last.click();settle(page)
 assert export(page,'restored.las')==baseline_las
 page.get_by_title('Snapshots',exact=True).click();snap=page.get_by_role('dialog',name='Snapshots',exact=True);snap.get_by_role('button',name='Restaurar',exact=True).first.click();page.keyboard.press('Escape');settle(page)
 assert export(page,'snapshot-restored.las')==prepared_las
 malformed=json.loads(json.dumps(prepared));malformed['project']['wells'][0]['interpretation']['preparation']['schemaVersion']=3
 bad=out/'future.pozo.json';bad.write_text(json.dumps(malformed));before=save(page,'before-bad.pozo.json')
 page.locator('.shell-topbar input[type=file]').set_input_files(str(bad));expect(page.get_by_text('No se pudo abrir el proyecto',exact=True)).to_be_visible(timeout=60000)
 assert save(page,'after-bad.pozo.json')['project']==before['project'];ctx.close()
 ctx,page=page_for(browser,config.candidate,"Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});");ctx.set_offline(True)
 open_file(page,out/'with-snapshot.pozo.json');export(page,'fallback.las');fallback_names,fallback=parse_las(out/'fallback.las')
 for name in ['GR','GR_PREPARADA','GR_PREPARADA_QC']:assert [r[fallback_names.index(name)] for r in fallback]==[r[names.index(name)] for r in rows]
 ctx.close()
 ctx,page=page_for(browser,config.candidate);open_file(page,config.seed/'zone-barrier.pozo.json')
 dialog=editor(page,'0.3')
 dialog.get_by_role('textbox',name='Distancia máxima entre anclajes (m MD)',exact=True).fill('1')
 dialog.get_by_role('button',name='Previsualizar interpolación',exact=True).click()
 expect(dialog.get_by_text(re.compile('^0 muestras estimadas por interpolación'))).to_be_visible(timeout=60000)
 expect(dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True)).to_be_disabled()
 ctx.close();browser.close();assert not errors,errors
 evidence={'filledSamples':filled,'expectedValues':meta['expected'],'originalsAnd5810RowsPreserved':True,'qc9OnlyEstimated':True,'longAndEdgeGapsRemainMissing':True,'previewDoesNotRunMain':True,'cancelUnchanged':True,'zeroEligibleBlocksApply':True,'undoRedo':True,'reopenedAndSnapshotRestored':True,'exclusionBlocksGap':True,'zoneBoundaryBlocksGap':True,'removeInterpolationPreservesMaskV1':True,'futureSchemaRejectedAtomically':True,'offlineWithoutWorkerOrSubtleCrypto':True,'baselineLas':baseline_las,'preparedLas':prepared_las,'pageErrors':errors}
 (out/'evidence.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
