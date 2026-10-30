import { describe, expect, it } from 'vitest';
import { createPointSet } from '../src/core/pointSets';
import { curve, linearModule } from './helpers';
import { createWell } from '../src/core/well';
import { createRegistry } from '../src/core/registry';
import { addWell, createProject, updateInterpretation, updateWell } from '../src/core/state/project';
import { enableProjectInputRevisions, reviseProjectInputs } from '../src/core/state/inputRevisions';
import { addMaskInterval, entryPreparationPlan, removeDepthShift, removeGapFill, removeMedianFilter, setDepthShift, setGapFill, setMedianFilter } from '../src/core/state/preparation';
import { MaskEvaluator, PreparationCancelled } from '../src/core/preparation/evaluate';
import { toEngineWell } from '../src/core/engine/engine';
import { materializePreparation, validatePreparedPayloads } from '../src/core/preparation/plan';
import { alignmentQualityCounts } from '../src/core/preparation/quality';
import { validatePreparation } from '../src/core/preparation/state';
import { serializeProject, deserializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { useProject } from '../src/app/store/project';
import { createInProcessClient, type ClientResult } from '../src/core/engine/client';
import { exportSources } from '../src/app/export/exportActions';
import { buildReportModel } from '../src/app/report/report';
import { calibrationKey } from '../src/core/preparation/calibrationContext';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
function fixture(data = [0, 0, 100, 0, 0, 0], depth = data.map((_, i) => i)) {
  return addWell(createProject(), createWell({ id: 'w', name: 'W', depth: Float64Array.from(depth), pointSets: [createPointSet({ id:'lab', kind:'core', name:'Laboratorio sintético', depth:Float64Array.of(depth[Math.floor(depth.length/2)]!), pointIds:['p'], columns:{phi:{label:'Porosidad',unit:'v/v',values:Float64Array.of(0.2)}} })], curves: [{ ...curve('GR','GR',data), origin: { kind: 'measured' } }, { ...curve('RT','RT',data.map((_, i) => i + 1)), origin: { kind: 'measured' } }] }));
}
const shifted = (project = fixture(), offsetM = 2, maxGapM = 1, datum = 'KB declarado') => setDepthShift(project,'w','GR',{offsetM,maxGapM,referenceId:'w',depthKind:'MD',datum},'shift');
async function evaluate(project = shifted(), evaluator = new MaskEvaluator()) {
  const entry = project.wells[0]!, plan = entryPreparationPlan(project,entry,registry), artifacts = await evaluator.evaluate(toEngineWell(entry.well),plan);
  return { entry, plan, artifacts, payload: artifacts[0]!, data: materializePreparation(entry.well,{plan,artifacts},plan.context,registry) };
}
describe('alineación constante MD v1', () => {
  it('un desplazamiento positivo coloca el evento más profundo y el negativo más somero, sin extrapolar', async () => {
    const positive = await evaluate(), negative = await evaluate(shifted(fixture(),-2));
    expect(positive.payload.data).toEqual(Float64Array.of(NaN,NaN,0,0,100,0));
    expect(positive.payload.quality).toEqual(Uint16Array.of(160,160,32,32,32,32));
    expect(negative.payload.data).toEqual(Float64Array.of(100,0,0,0,NaN,NaN));
    expect(alignmentQualityCounts(positive.payload.data,positive.payload.quality)).toEqual({finite:4,estimatedSupport:0,unsupported:2,missing:0});
  });
  it('remuestrea por MD real irregular en valores lineales y respeta máximo entre anclajes', async () => {
    const project = fixture([10,12,16,22],[0,1,3,6]);
    const result = await evaluate(shifted(project,0.5,3));
    expect(result.payload.data).toEqual(Float64Array.of(NaN,11,15,21));
    expect(result.payload.quality).toEqual(Uint16Array.of(160,40,40,40));
    expect((await evaluate(shifted(project,0.5,2.99))).payload.quality).toEqual(Uint16Array.of(160,40,40,160));
    // Las coincidencias exactas no necesitan vecinos ni un máximo mayor que su paso.
    expect((await evaluate(shifted(fixture(),1,0.01))).payload.quality).toEqual(Uint16Array.of(160,32,32,32,32,32));
  });
  it('reconoce coincidencias de paso decimal dentro del redondeo, sin clasificar como estimación ni perder bordes', async () => {
    const depth = Array.from({length:20},(_,i)=>7633+i*0.1524), data = depth.map((_,i)=>i);
    const result = await evaluate(shifted(fixture(data,depth),0.3048,0.2));
    expect([...result.payload.data].slice(2)).toEqual(data.slice(0,-2));
    expect([...result.payload.quality].slice(2).every(q=>q===32)).toBe(true);
    expect(Number.isNaN(result.payload.data[0])).toBe(true);
  });
  it('los huecos y exclusiones se trasladan, y no se estiman valores a través de ellos', async () => {
    const original = fixture([10,NaN,30,40]);
    expect((await evaluate(shifted(original,1))).payload.quality).toEqual(Uint16Array.of(160,32,33,32));
    expect((await evaluate(shifted(original,0.5))).payload.quality).toEqual(Uint16Array.of(160,161,161,40));
    const masked = addMaskInterval(fixture([10,20,30,40]),'w','GR',{id:'r',top:1,base:1},'mask');
    expect((await evaluate(shifted(masked,1))).payload.quality).toEqual(Uint16Array.of(160,32,34,32));
    expect((await evaluate(shifted(masked,0.5))).payload.quality).toEqual(Uint16Array.of(160,162,162,40));
    const after = addMaskInterval(shifted(fixture([10,20,30,40]),1),'w','GR',{id:'r',top:1,base:1},'unused');
    expect((await evaluate(after)).payload.quality).toEqual(Uint16Array.of(160,32,34,32));
  });
  it('las fronteras de zona destino bloquean la estimación, conservando coincidencias exactas', async () => {
    const original = updateInterpretation(fixture([10,12,16,22],[0,1,3,6]),'w',i=>({...i,zones:[{id:'z',name:'Z',top:2,base:8,color:'#fff',kind:'formation'}]}));
    const result = await evaluate(shifted(original,0.5,3));
    expect(result.payload.quality).toEqual(Uint16Array.of(160,40,160,40));
    const exact = updateInterpretation(fixture(),'w',i=>({...i,zones:[{id:'z',name:'Z',top:2,base:8,color:'#fff',kind:'formation'}]}));
    expect((await evaluate(shifted(exact,1))).payload.data[2]).toBe(0);
  });
  it('conserva índice maestro, otras curvas, originales y bytes; no desplaza laboratorio', async () => {
    const project = shifted(), entry = project.wells[0]!, depth = entry.well.depth.values, gr = entry.well.curves[0]!.data, peer = entry.well.curves[1]!.data;
    const bytes = new Uint8Array(gr.buffer).slice(), points = entry.well.pointSets;
    const result = await evaluate(project);
    expect(result.data.well.depth.values).toBe(depth); expect(result.data.well.curves[1]!.data).toBe(peer);
    expect(new Uint8Array(gr.buffer)).toEqual(bytes); expect(result.entry.well.pointSets).toBe(points);
    expect(result.data.lineage.get('prep:shift:masked')!.ancestorToolIds).toEqual(['gr']);
  });
  it('compone después de interpolación/filtro y conserva etapas al retirarlas por separado', async () => {
    const fill = setGapFill(fixture([0,NaN,100,20,30]),'w','GR',{top:0,base:4,maxGapM:2},'fill');
    const filter = setMedianFilter(fill,'w','GR',{top:0,base:4,radiusM:1,maxStepM:1},'unused');
    const project = shifted(filter,1), result = await evaluate(project);
    expect(result.payload.data).toEqual(Float64Array.of(NaN,0,50,50,30));
    expect(result.payload.quality).toEqual(Uint16Array.of(160,32,57,56,48));
    expect(result.payload.sourceCounts).toEqual({interpolated:1,filtered:3});
    expect(removeDepthShift(project,'w','fill').wells[0]!.interpretation).toEqual(filter.wells[0]!.interpretation);
    expect((await evaluate(removeGapFill(project,'w','fill'))).payload.data).toEqual(Float64Array.of(NaN,0,NaN,100,30));
    expect((await evaluate(removeMedianFilter(project,'w','fill'))).payload.data).toEqual(Float64Array.of(NaN,0,50,100,20));
    expect(setMedianFilter(project,'w','GR',{top:0,base:4,radiusM:2,maxStepM:1},'unused').wells[0]!.interpretation.preparation!.nodes[0]!.kind).toBe('constant-shift');
    expect(setGapFill(project,'w','GR',{top:0,base:4,maxGapM:1},'unused').wells[0]!.interpretation.preparation!.nodes[0]!.kind).toBe('constant-shift');
  });
  it('declara referencia/datum sin inventar adquisición y bloquea MD/TVD o datum incompatibles', () => {
    const original = fixture();
    for (const extra of [{offsetM:0},{offsetM:Infinity},{maxGapM:0},{datum:''},{referenceId:'otro'},{depthKind:'TVD'}]) expect(()=>setDepthShift(original,'w','GR',{offsetM:1,maxGapM:1,referenceId:'w',depthKind:'MD',datum:'KB',...extra} as never,'s')).toThrow();
    const declared = shifted(original), e = declared.wells[0]!;
    expect(declared.inputRevisions![e.inputRevisionId!]!.acquisition.depth.datum).toBeNull();
    let known = enableProjectInputRevisions(original), revision = known.inputRevisions![known.wells[0]!.inputRevisionId!]!;
    known = reviseProjectInputs(known,'w',{acquisition:{...revision.acquisition,depth:{kind:'MD',datum:'KB'}}});
    expect(()=>shifted(known,1,1,'otro')).toThrow(/datum/);
    const accepted = shifted(known,1,1,'KB'); revision = accepted.inputRevisions![accepted.wells[0]!.inputRevisionId!]!;
    const mismatch = reviseProjectInputs(accepted,'w',{acquisition:{...revision.acquisition,depth:{kind:'MD',datum:'RT'}}});
    expect(()=>entryPreparationPlan(mismatch,mismatch.wells[0]!,registry)).toThrow(/datum/);
    expect(original.inputRevisions).toBeUndefined();
  });
  it('rechaza inversión/colapso por redondeo y conserva originales cuando no hay cobertura', async () => {
    await expect(evaluate(shifted(fixture(),1e20))).rejects.toThrow(/eje finito/);
    const noCoverage = await evaluate(shifted(fixture(),100));
    expect(noCoverage.payload.data.every(Number.isNaN)).toBe(true);
    expect(noCoverage.payload.quality.every(q=>q===160)).toBe(true);
  });
  it('guardar/reabrir y snapshots reproducen signos, recetas y QC sin blobs derivados', async () => {
    const project = createSnapshot(shifted(),'w','Alineado',{id:'s'}).project, text = await serializeProject(project), raw = JSON.parse(text);
    expect(raw.version).toBe(7); expect(raw.project.wells[0].interpretation.preparation.schemaVersion).toBe(4);
    expect(raw.project.inputRevisions[project.wells[0]!.inputRevisionId!].well.curves).toHaveLength(2);
    const reopened = await deserializeProject(text), restored = restoreSnapshot(removeDepthShift(reopened,'w','shift'),'s');
    expect((await evaluate(restored)).payload.quality).toEqual(Uint16Array.of(160,160,32,32,32,32));
    raw.project.wells[0].interpretation.preparation.nodes[0].shift.referenceId='otro';
    await expect(deserializeProject(JSON.stringify(raw))).rejects.toThrow();
  });
  it('aceptación/retirada son unidades de undo/redo y mismo desplazamiento es no-op, no se acumula', async () => {
    const store = useProject.getState(), original = fixture();store.replace(original);
    store.commit('Alinear',p=>shifted(p),{group:'shift'});const accepted=useProject.getState().project;
    expect(shifted(accepted)).toBe(accepted);store.undo();expect(useProject.getState().project).toBe(original);store.redo();expect(useProject.getState().project).toBe(accepted);
    expect((await evaluate(shifted(accepted,1))).payload.data).toEqual(Float64Array.of(NaN,0,0,100,0,0));
    store.commit('Quitar',p=>removeDepthShift(p,'w','shift'),{group:'remove'});expect(useProject.getState().project.wells[0]!.interpretation.sources.GR).toEqual({kind:'curve',curveId:'GR'});store.undo();expect(useProject.getState().project).toBe(accepted);store.replace(createProject());
  });
  it('presupuesto comparte un solo scratch para filtro y desplazamiento; cancelación no cachea parciales', async () => {
    const filter = setMedianFilter(fixture([0,10,100,20,30]),'w','GR',{top:0,base:4,radiusM:1,maxStepM:1},'filter'), project=shifted(filter,1);
    const ev=new MaskEvaluator(100);await evaluate(project,ev);expect(ev.retainedBytes).toBe(50);
    await expect(evaluate(project,new MaskEvaluator(99))).rejects.toThrow(/presupuesto/);
    const n=10000,big=shifted(fixture(Array<number>(n).fill(1)),1),entry=big.wells[0]!,plan=entryPreparationPlan(big,entry,registry),evaluator=new MaskEvaluator();let count=0;
    await expect(evaluator.evaluate(toEngineWell(entry.well),plan,()=>count>=3,async()=>{count++;})).rejects.toBeInstanceOf(PreparationCancelled);
    expect(evaluator.retainedBytes).toBe(0);expect(entry.well.curves[0]!.data.every(v=>v===1)).toBe(true);
  });
  it('contexto/evidencia cambian con desplazamiento, máximo y zonas; no acepta versiones/calidades mezcladas', async () => {
    const initial=shifted(),first=await evaluate(initial),other=await evaluate(shifted(initial,1));
    const otherMax=await evaluate(shifted(initial,2,0.5));expect(otherMax.plan.context.preparationKey).not.toBe(first.plan.context.preparationKey);
    const zoned=updateInterpretation(initial,'w',i=>({...i,zones:[{id:'z',name:'Z',top:2.5,base:5,color:'#fff',kind:'formation'}]}));
    expect((await evaluate(zoned)).plan.context.preparationKey).not.toBe(first.plan.context.preparationKey);
    expect(()=>materializePreparation(first.entry.well,{plan:other.plan,artifacts:first.artifacts},other.plan.context,registry)).toThrow();
    const key=(r:typeof first)=>calibrationKey(r.data,r.entry.interpretation,{pointSetIds:['lab'],methodVersion:'test@1',pairing:{datum:'MD',top:0,base:5,windowM:1,aggregation:'mean'},configuration:{}});
    expect(key(first)).not.toBe(key(other));
    for(const q of [0,8,64,96])expect(()=>validatePreparedPayloads(first.plan,[{...first.payload,quality:Uint16Array.of(q,160,32,32,32,32)}],6)).toThrow();
    expect(()=>validatePreparedPayloads(first.plan,[{...first.payload,data:Float64Array.of(1,NaN,0,0,100,0)}],6)).toThrow();
    expect(()=>validatePreparedPayloads(first.plan,[{...first.payload,sourceCounts:{interpolated:999,filtered:0}}],6)).toThrow();
    const state=first.entry.interpretation.preparation!;expect(()=>validatePreparation({...state,schemaVersion:5})).toThrow();
    const invalid=updateWell(shifted(),'w',w=>({...w,curves:w.curves.map(c=>c.id==='GR'?{...c,data:Float64Array.of(1,2,3,4,5,6)}:c)}));
    expect(entryPreparationPlan(invalid,invalid.wells[0]!,registry).diagnostics[0]!.status).toBe('needs-input');
  });
  it('canal real publica motor/alineación/QC/informe juntos y rechaza un desplazamiento alterado', async () => {
    const project=shifted(),entry=project.wells[0]!,plan=entryPreparationPlan(project,entry,registry),client=createInProcessClient(registry);
    const run=(bad=false)=>new Promise<ClientResult>((resolve,reject)=>{const off=client.subscribe(event=>{if(event.type==='result'){off();resolve(event.result);}else if(event.type==='error'){off();reject(new Error(event.message));}});client.syncWell(toEngineWell(entry.well),plan.context);client.run(entry.interpretation,plan.context,bad?{...plan,artifacts:plan.artifacts.map(a=>({...a,shift:{...a.shift!,offsetM:-2}}))}:plan);});
    try{const result=await run();expect(result.outputs[0]!.value).toEqual(Float64Array.of(NaN,NaN,0,0,100,0));expect(exportSources(entry.well,result,false,plan.context).columns.find(c=>c.id.startsWith('q:'))!.data).toEqual(Float64Array.of(160,160,32,32,32,32));expect(buildReportModel(entry.well,entry.interpretation,result,new Date(0),registry).warnings.some(w=>w.includes('Alineación manual constante'))).toBe(true);await expect(run(true)).rejects.toThrow(/plan.*no corresponde/i);}finally{client.dispose();}
  });
  it('el informe conserva parámetros de las etapas de origen y la exportación declara desplazamiento y datum', async () => {
    const fill=setGapFill(fixture([0,NaN,100,20,30]),'w','GR',{top:0,base:4,maxGapM:2},'fill');
    const project=shifted(setMedianFilter(fill,'w','GR',{top:0,base:4,radiusM:1,maxStepM:1},'unused'),1),entry=project.wells[0]!,plan=entryPreparationPlan(project,entry,registry),client=createInProcessClient(registry);
    try {
      const response=new Promise<ClientResult>((resolve,reject)=>{const off=client.subscribe(event=>{if(event.type==='result'){off();resolve(event.result);}else if(event.type==='error'){off();reject(new Error(event.message));}});});
      client.syncWell(toEngineWell(entry.well),plan.context);client.run(entry.interpretation,plan.context,plan);const result=await response;
      const warnings=buildReportModel(entry.well,entry.interpretation,result,new Date(0),registry).warnings.join('\n');
      expect(warnings).toContain('Antes de alinear · interpolación lineal');expect(warnings).toContain('Antes de alinear · mediana física');
      const qc=exportSources(entry.well,result,false,plan.context).columns.find(c=>c.id.startsWith('q:'))!;
      expect(qc.data).toEqual(Float64Array.of(160,32,57,56,48));expect(qc.description).toContain('Alineación MD 1 m');expect(qc.description).toContain('KB declarado');
    } finally { client.dispose(); }
  });
});
