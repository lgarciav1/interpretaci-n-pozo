"""Fallos reales de protocolo mediante instrumentación de la API Worker; sin acceder a stores de la app."""
# Comparte las acciones públicas de archivo/exportación con la regresión v7.
from pathlib import Path
exec(Path(__file__).with_name('archive_v7.py').read_text().split('with sync_playwright() as p:')[0])

instrument=r'''(()=>{
 const Native=window.Worker;
 const q=window.__qaEngine={mode:'off',created:0,terminated:0,runs:[],ready:[],bad:0,delayed:null,last:null,status:''};
 window.Worker=class extends Native{
  constructor(url,opts){super(url,opts);this.main=opts?.name==='motor';this.map=new Map();this.events=new WeakMap();if(this.main)q.created++;}
  postMessage(msg,transfer){if(this.main&&msg.type==='run')q.runs.push({gen:msg.gen,seq:msg.seq,full:!!msg.full,context:msg.context});return super.postMessage(msg,transfer);}
  addEventListener(type,listener,opts){
   if(!this.main||type!=='message')return super.addEventListener(type,listener,opts);
   const wrap=ev=>{
    let record=this.events.get(ev);
    if(!record){
     let data=ev.data,delay=false;
     if(data.type==='result'){
      if(q.mode==='once'||q.mode==='bad'){
       q.bad++;if(q.mode==='once')q.mode='off';
       data={...data,result:{...data.result,outputs:data.result.outputs.map(o=>{const x={...o};delete x.value;return x;})}};
      }else if(q.mode==='delay'){q.mode='off';delay=true;}
      q.last=data.context;
     }
     record={event:new MessageEvent('message',{data}),delay,callbacks:[]};this.events.set(ev,record);
     if(delay){q.delayed=record;q.delayedContext=data.context;q.delayedGen=data.gen;}
    }
    const call=()=>typeof listener==='function'?listener.call(this,record.event):listener.handleEvent(record.event);
    if(record.delay){record.callbacks.push(call);return;}call();
   };
   this.map.set(listener,wrap);return super.addEventListener(type,wrap,opts);
  }
  removeEventListener(type,listener,opts){const wrap=this.map.get(listener);this.map.delete(listener);return super.removeEventListener(type,wrap||listener,opts);}
  terminate(){if(this.main){this.main=false;q.terminated++;}return super.terminate();}
 };
 q.release=()=>{const r=q.delayed;if(!r)return;r.delay=false;q.delayed=null;r.callbacks.forEach(f=>f());};
 new MutationObserver(()=>{const label=document.querySelector('[data-testid="engine-status"]')?.textContent||'';if(label!==q.status){q.status=label;if(label.includes('Listo ·'))q.ready.push(q.last);}}).observe(document,{subtree:true,childList:true,characterData:true});
})();'''

def dismiss(page):
 close=page.get_by_role('button',name='Cerrar aviso',exact=True)
 while close.count() and close.first.is_visible():close.first.click()

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=config.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 evidence={}
 ctx,page=page_for(browser,config.parent)
 open_file(page,config.seed/'legacy-baseline.pozo.json');preset(page)
 evidence['parentLas']=export(page,'parent.las');evidence['parentSvg']=export(page,'parent.svg',True);ctx.close()
 ctx,page=page_for(browser,config.candidate,instrument);settle(page)
 page.evaluate("()=>{const q=__qaEngine;q.mode='once';q.ready=[];q.runs=[];}")
 open_file(page,config.seed/'tp-v7.pozo.json')
 once=page.evaluate('()=>({bad:__qaEngine.bad,created:__qaEngine.created,full:__qaEngine.runs.filter(x=>x.full).length})')
 assert once['bad']==1 and once['full']==1 and once['created']==1;evidence['fullResync']=once
 dismiss(page)
 page.evaluate("()=>{__qaEngine.mode='delay';__qaEngine.ready=[];}")
 page.locator('.shell-topbar input[type=file]').set_input_files(str(config.seed/'tp-v7.pozo.json'))
 page.wait_for_function('()=>!!__qaEngine.delayed',timeout=60000)
 page.get_by_title('Snapshots',exact=True).click();page.get_by_role('dialog',name='Snapshots',exact=True).get_by_role('button',name='Restaurar',exact=True).click();page.keyboard.press('Escape')
 page.evaluate('__qaEngine.release()');settle(page)
 state=page.evaluate('()=>({old:__qaEngine.delayedContext,oldGen:__qaEngine.delayedGen,last:__qaEngine.runs.at(-1),ready:__qaEngine.ready})')
 assert state['oldGen']==state['last']['gen']
 assert state['old']['wellId']==state['last']['context']['wellId']
 assert state['old']['depthKey']==state['last']['context']['depthKey']
 assert state['old']['inputRevisionId']!=state['last']['context']['inputRevisionId']
 assert state['last']['context']['inputRevisionId']==meta['rootRevision']
 assert state['ready'] and all(c['inputRevisionId']==meta['rootRevision'] for c in state['ready'])
 evidence['lateSameWellAndDepthRejected']=state
 preset(page)
 evidence['restoredLas']=export(page,'restored.las');evidence['restoredSvg']=export(page,'restored.svg',True)
 assert evidence['restoredLas']==evidence['parentLas'] and evidence['restoredSvg']==evidence['parentSvg']
 page.screenshot(path=str(out/'01-restaurado-sin-respuesta-atrasada.png'))
 dismiss(page)
 before=page.evaluate('()=>({created:__qaEngine.created,runs:__qaEngine.runs.length})')
 page.evaluate("__qaEngine.mode='bad'")
 page.locator('.shell-topbar input[type=file]').set_input_files(str(config.seed/'tp-v7.pozo.json'))
 expect(page.get_by_test_id('engine-status')).to_contain_text('Error del motor',timeout=60000)
 bad=page.evaluate('()=>({created:__qaEngine.created,runs:__qaEngine.runs.length,terminated:__qaEngine.terminated})')
 assert bad['created']-before['created']==1 and bad['runs']-before['runs']==4
 evidence['boundedRestartAndVisibleError']=bad
 page.screenshot(path=str(out/'02-error-acotado.png'));dismiss(page)
 page.evaluate("__qaEngine.mode='off'")
 open_file(page,config.seed/'tp-v7.pozo.json');evidence['newRequestRecovers']=True
 # Una revisión que cambia solo el nombre del laboratorio comparte todos los datos del motor.
 source=json.loads((config.seed/'tp-v7.pozo.json').read_text());project=source['project'];rid='input-'+'f'*32
 assert rid not in project['inputRevisions'];old=meta['activeRevision'];new=json.loads(json.dumps(project['inputRevisions'][old]));new.update(id=rid,parentRevisionId=old,reason='edit-input');new['well']['pointSets'][0]['name']='Corona renombrada';project['inputRevisions'][rid]=new;project['wells'][0]['inputRevisionId']=rid
 project['snapshots']=[{'id':'metadata-base','name':'Laboratorio anterior','wellId':meta['wellId'],'createdAt':source['savedAt'],'inputRevisionId':old,'inputBinding':'pinned','interpretation':project['wells'][0]['interpretation']}]
 path=out/'metadata-only.pozo.json';path.write_text(json.dumps(source));dismiss(page);open_file(page,path)
 before=page.evaluate('__qaEngine.runs.length')
 page.get_by_title('Snapshots',exact=True).click();page.get_by_role('dialog',name='Snapshots',exact=True).get_by_role('button',name='Restaurar',exact=True).click();page.keyboard.press('Escape');settle(page)
 assert page.evaluate('__qaEngine.runs.length')==before
 saved=save(page,'metadata-restored.pozo.json');verify(saved,meta['activeRevision']);evidence['labMetadataDidNotRunEngine']=True
 evidence['pageErrors']=errors;assert not errors,errors
 ctx.close();browser.close();(out/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n');print(json.dumps(evidence,ensure_ascii=False))
