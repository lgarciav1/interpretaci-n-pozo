import { describe, it, expect } from 'vitest';
import { createWell } from '../src/core/well';
import { createRegistry } from '../src/core/registry';
import { addWell, createProject, updateWell } from '../src/core/state/project';
import { setDensityReconstruction, activateDensityReconstruction, restoreMaskInterval, entryPreparationPlan } from '../src/core/state/preparation';
import { type DensityReconstructionConfig, validateDensityConfig } from '../src/core/preparation/density';
import { validatePreparation } from '../src/core/preparation/state';
import { MaskEvaluator } from '../src/core/preparation/evaluate';
import { validatePreparedPayloads, materializePreparation } from '../src/core/preparation/plan';
import { toEngineWell } from '../src/core/engine/engine';
import { serializeProject, deserializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { curve, linearModule } from './helpers';
const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
function fixture() {
 const depth=Float64Array.from({length:2000},(_,i)=>i*.2), gr=Array.from(depth,z=>80+50*Math.sin(z*.7)), sonic=Array.from(depth,z=>90+30*Math.cos(z*.47));
 const density=Array.from(depth,(z,i)=>z>=190&&z<=199.8?NaN:2.2+.003*gr[i]!+.001*sonic[i]!+.006*Math.sin(z*11));
 const curves=[curve('D','RHOB',density),curve('G','GR',gr),curve('S','DT',sonic)].map(c=>({...c,origin:{kind:'measured' as const}}));
 return addWell(createProject(), createWell({id:'w',name:'W',depth,curves}));
}
const config:DensityReconstructionConfig={goodIntervals:[{top:0,base:189.8},{top:200,base:399.8}],washoutIntervals:[{top:190,base:199.8}],predictors:[{curveId:'G',role:'gr',trusted:true,reliableIntervals:[{top:0,base:399.8}]},{curveId:'S',role:'sonic',trusted:true,reliableIntervals:[{top:0,base:399.8}]}]};
const recipe=()=>setDensityReconstruction(fixture(),'w','D',config,'density');
async function evaluate(p:ReturnType<typeof fixture>) { const e=p.wells[0]!,plan=entryPreparationPlan(p,e,registry), artifacts=await new MaskEvaluator().evaluate(toEngineWell(e.well),plan,()=>false,async()=>{}); validatePreparedPayloads(plan,artifacts,e.well.depth.values.length); return {e,plan,artifacts}; }
describe('F20 contratos de preparación',()=>{
 it('acepta sólo decisiones JSON, conserva fuente/original, activa y retira explícitamente',async()=>{
  const p=recipe(), before=p.wells[0]!.interpretation.sources.RHOB;
  expect(before).not.toEqual({kind:'curve',curveId:'prep:density:masked'});
  expect(p.wells[0]!.interpretation.preparation!.schemaVersion).toBe(7);
  const r=await evaluate(p); expect(r.artifacts[0]!.density!.report.accepted).toBe(true);
  const d=materializePreparation(r.e.well,{plan:r.plan,artifacts:r.artifacts},r.plan.context,registry);
  expect(d.well.curves[0]!.data).toBe(r.e.well.curves[0]!.data);
  expect(r.artifacts[0]!.quality[950]).toBe(513);
  const active=activateDensityReconstruction(p,'w','density');
  expect(active.wells[0]!.interpretation.sources.RHOB).toEqual({kind:'curve',curveId:'prep:density:masked'});
  expect(restoreMaskInterval(active,'w','density').wells[0]!.interpretation.sources.RHOB).toEqual({kind:'curve',curveId:'D'});
 });
 it('rechaza bandas, calidad y reportes alterados antes de publicar',async()=>{
  const r=await evaluate(recipe()), p=r.artifacts[0]!;
  const altered=()=>({...p,density:{...p.density!,lower:p.density!.lower.slice()},quality:p.quality.slice()});
  const band=altered();band.density.lower[950]=3;expect(()=>validatePreparedPayloads(r.plan,[band],2000)).toThrow();
  const flags=altered();flags.quality[950]=0;expect(()=>validatePreparedPayloads(r.plan,[flags],2000)).toThrow();
  const report=altered();report.density.report={...report.density.report,rmse:1};expect(()=>validatePreparedPayloads(r.plan,[report],2000)).toThrow();
 });
 it('bloquea predictores modificados, conserva persistencia y reproduce snapshot',async()=>{
  const p=recipe(), changed=updateWell(p,'w',w=>({...w,curves:w.curves.map(c=>c.id==='G'?{...c,data:Float64Array.from(c.data,x=>x+1)}:c)}));
  expect(entryPreparationPlan(changed,changed.wells[0]!,registry).artifacts).toHaveLength(0);
  const snap=createSnapshot(p,'w','F20',{id:'f20'}).project;
  const text=await serializeProject(snap), raw=JSON.parse(text);
  expect(raw.version).toBe(7);expect(text).not.toContain('halfWidth');expect(text).not.toContain('lower');
  const reopened=await deserializeProject(text);const r=await evaluate(reopened);
  expect(r.artifacts[0]!.density!.report.accepted).toBe(true);
  const restored=restoreSnapshot(reopened,'f20');expect(restored.wells[0]!.interpretation.preparation).toEqual(p.wells[0]!.interpretation.preparation);
 });
 it('rechazo de validación permite auditar preview, pero bloquea fuente activa incluso con caché',async()=>{
  const base=fixture(), bad=updateWell(base,'w',w=>({...w,curves:w.curves.map(c=>c.id==='D'?{...c,data:Float64Array.from(c.data,(x,k)=>Number.isNaN(x)?x:2.4+.25*Math.sin(k*1.77))}:c)}));
  const p=setDensityReconstruction(bad,'w','D',config,'density'),e=p.wells[0]!, evaluator=new MaskEvaluator();
  const plan=entryPreparationPlan(p,e,registry), preview=await evaluator.evaluate(toEngineWell(e.well),plan,()=>false,async()=>{});
  expect(preview[0]!.density!.report.accepted).toBe(false);expect(preview[0]!.data[950]).toBeNaN();
  const active=activateDensityReconstruction(p,'w','density'), a=active.wells[0]!;
  await expect(evaluator.evaluate(toEngineWell(a.well),entryPreparationPlan(active,a,registry),()=>false,async()=>{})).rejects.toThrow(/bloqueada/);
 });
 it('rechaza mezcla buen pozo/derrumbe, versión incorrecta y confianza implícita',()=>{
  expect(()=>validateDensityConfig({...config,goodIntervals:config.washoutIntervals})).toThrow();
  expect(()=>validateDensityConfig({...config,predictors:config.predictors.map(p=>({...p,trusted:false}))})).toThrow();
  const s=recipe().wells[0]!.interpretation.preparation!;expect(()=>validatePreparation({...s,schemaVersion:6})).toThrow();
 });
});
