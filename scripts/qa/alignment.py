"""Alineación por UI/Worker: signo, cobertura, referencias, laboratorio y persistencia."""
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

def editor(page,offset=None,datum='KB declarado',run=True):
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog=page.get_by_role('dialog',name='Preparar datos',exact=True)
 dialog.get_by_role('combobox',name='Curva original',exact=True).select_option(meta['grCurve'])
 for label,value in [('Tope (m MD)',str(meta['depth'][997])),('Base (m MD)',str(meta['depth'][1005])),('Desplazamiento constante (m)',str(meta['offsetM'] if offset is None else offset)),('Hueco máximo de remuestreo (m MD)','0.2'),('Datum declarado de origen y destino',datum)]:dialog.get_by_role('textbox',name=label,exact=True).fill(value)
 preview=dialog.get_by_role('button',name='Previsualizar alineación',exact=True);expect(preview).to_be_disabled()
 dialog.get_by_role('checkbox',name=re.compile('^Declaro que la curva y el índice')).check()
 if run:
  preview.click();expect(dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True)).to_be_enabled(timeout=60000)
 return dialog

def validate(path,baseline,shift_samples):
 names,rows=parse_las(path);oldnames,oldrows=parse_las(baseline)
 gi=names.index('GR');pi=names.index('GR_PREPARADA');qi=names.index('GR_PREPARADA_QC');oi=oldnames.index('GR');peer=names.index(meta['peerMnemonic']);oldpeer=oldnames.index(meta['peerMnemonic'])
 assert len(rows)==len(oldrows)==5810
 for i,(row,old) in enumerate(zip(rows,oldrows)):
  assert row[0]==old[0] and row[gi]==old[oi] and row[peer]==old[oldpeer]
  source=i-shift_samples
  if source<0 or source>=len(rows):assert row[pi]==-999.25 and row[qi]==160
  else:assert row[pi]==oldrows[source][oi] and row[qi]==(33 if oldrows[source][oi]==-999.25 else 32)
 if shift_samples==2:assert rows[meta['eventTarget']][pi]==oldrows[meta['eventSource']][oi]==100
 return names,rows

instrument="""(()=>{const Native=Worker;window.__qaMainRuns=0;window.Worker=class extends Native{constructor(url,options){super(url,options);this.main=options?.name==='motor';}postMessage(m,t){if(this.main&&m.type==='run')window.__qaMainRuns++;return super.postMessage(m,t);}};})();"""
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 ctx,page=page_for(browser,config.candidate,instrument);open_file(page,config.seed/'legacy-baseline.pozo.json');preset(page)
 original=save(page,'baseline.pozo.json');base_las=export(page,'baseline.las');before=page.evaluate('__qaMainRuns')
 dialog=editor(page);apply=dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True)
 assert page.evaluate('__qaMainRuns')==before
 dialog.get_by_role('cell',name='Alineada · dato de origen',exact=True).first.scroll_into_view_if_needed();dialog.screenshot(path=str(out/'preview-light.png'))
 page.emulate_media(color_scheme='dark');dialog.screenshot(path=str(out/'preview-dark.png'));page.emulate_media(color_scheme='light')
 dialog.get_by_role('textbox',name='Desplazamiento constante (m)',exact=True).fill('0.5');expect(apply).to_be_disabled()
 dialog.get_by_role('button',name='Cerrar',exact=True).last.click();assert save(page,'cancelled.pozo.json')['project']==original['project']
 dialog=editor(page);dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True).click();settle(page)
 positive_las=export(page,'positive.las');names,rows=validate(out/'positive.las',out/'baseline.las',2)
 prepared=save(page,'positive.pozo.json');entry=prepared['project']['wells'][0];node=entry['interpretation']['preparation']['nodes'][0]
 assert prepared['version']==7 and entry['interpretation']['preparation']['schemaVersion']==4 and node['kind']=='constant-shift'
 assert node['shift']['referenceId']==meta['wellId'] and node['shift']['datum']=='KB declarado'
 revision=prepared['project']['inputRevisions'][entry['inputRevisionId']];assert revision['acquisition']['depth']['datum'] is None
 assert values(prepared,revision['well']['pointSets'][0]['depth'])[0]==meta['labDepth']
 page.keyboard.press('Control+z');settle(page);assert export(page,'undo.las')==base_las
 page.keyboard.press('Control+Shift+z');settle(page);assert export(page,'redo.las')==positive_las
 page.get_by_title('Snapshots',exact=True).click();snap=page.get_by_role('dialog',name='Snapshots',exact=True)
 snap.get_by_role('textbox',name='Nombre del snapshot',exact=True).fill('Alineación positiva');snap.get_by_role('button',name='Guardar snapshot',exact=True).click();page.keyboard.press('Escape');prepared=save(page,'with-snapshot.pozo.json');ctx.close()
 ctx,page=page_for(browser,config.candidate);open_file(page,out/'with-snapshot.pozo.json');preset(page);assert export(page,'reopened.las')==positive_las
 # Reemplazar el desplazamiento, sin acumularlo sobre una salida alineada.
 dialog=editor(page,offset=-meta['offsetM']);dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True).click();settle(page);export(page,'negative.las');validate(out/'negative.las',out/'baseline.las',-2)
 page.get_by_role('button',name='Preparar datos',exact=True).click();dialog=page.get_by_role('dialog',name='Preparar datos',exact=True);dialog.get_by_role('button',name='Quitar alineación',exact=True).click();dialog.get_by_role('button',name='Cerrar',exact=True).last.click();settle(page);assert export(page,'restored.las')==base_las
 page.get_by_title('Snapshots',exact=True).click();snap=page.get_by_role('dialog',name='Snapshots',exact=True);snap.get_by_role('button',name='Restaurar',exact=True).first.click();page.keyboard.press('Escape');settle(page);assert export(page,'snapshot-restored.las')==positive_las
 bad=json.loads(json.dumps(prepared));bad['project']['wells'][0]['interpretation']['preparation']['schemaVersion']=5;path=out/'future.pozo.json';path.write_text(json.dumps(bad));before=save(page,'before-future.pozo.json')
 page.locator('.shell-topbar input[type=file]').set_input_files(str(path));expect(page.get_by_text('No se pudo abrir el proyecto',exact=True)).to_be_visible(timeout=60000);assert save(page,'after-future.pozo.json')['project']==before['project'];ctx.close()
 ctx,page=page_for(browser,config.candidate);open_file(page,config.seed/'known-datum.pozo.json');known=save(page,'known-before.pozo.json')
 dialog=editor(page,datum='RT',run=False);dialog.get_by_role('button',name='Previsualizar alineación',exact=True).click();expect(dialog.get_by_text(re.compile('^La alineación debe conservar la referencia MD'))).to_be_visible();expect(dialog.get_by_role('button',name='Aplicar y usar para GR',exact=True)).to_be_disabled();dialog.get_by_role('button',name='Cerrar',exact=True).last.click();assert save(page,'known-after.pozo.json')['project']==known['project'];ctx.close()
 ctx,page=page_for(browser,config.candidate,"Object.defineProperty(window,'Worker',{value:undefined});Object.defineProperty(crypto,'subtle',{value:undefined});");ctx.set_offline(True);open_file(page,out/'with-snapshot.pozo.json');export(page,'fallback.las');validate(out/'fallback.las',out/'baseline.las',2);ctx.close();browser.close();assert not errors,errors
 evidence={'samples':5810,'shiftM':meta['offsetM'],'positiveEventMovesFrom':meta['eventSource'],'positiveEventMovesTo':meta['eventTarget'],'originalsAndPeerAndMasterIndexPreserved':True,'laboratoryNotShifted':True,'qc32And160CheckedEveryRow':True,'positiveAndNegativeSigns':True,'offsetReplacesRatherThanAccumulates':True,'previewDoesNotRunMain':True,'cancelUnchanged':True,'undoRedo':True,'reopenedAndSnapshotRestored':True,'removeAlignmentRestoresOriginal':True,'knownDatumMismatchRejectedAtomically':True,'unknownDatumRemainsUnknownInAcquisition':True,'futureSchemaRejectedAtomically':True,'offlineWithoutWorkerOrSubtleCrypto':True,'baselineLas':base_las,'positiveLas':positive_las,'pageErrors':errors}
 (out/'evidence.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
