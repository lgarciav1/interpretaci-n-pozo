import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { registry } from '../src/modules';
import { MINERAL_TRACK } from '../src/modules/mineral-inversion/track';
import { stackFillColor } from '../src/viewer/render';
import { THEMES } from '../src/ui/tokens';
import { computeStack } from '../src/viewer/stack';

const { well, zones } = readWellFile(csvText,'pozo_tp_perfiles.csv');
const engine = new Engine(registry,{checkInputs:true});engine.setWell(toEngineWell(well));
const interpretation=emptyInterpretation(zones);
const result=engine.run(interpretation);
const curve=(port:string,r=result)=>r.outputs.find(o=>o.port===port)!.value as Float64Array;
const table=(port:string)=>(result.outputs.find(o=>o.port===port)!.value as TableValue).rows;

describe('Geo-2 y Geo-3 integrados con el motor y el visor',()=>{
 it('publica cinco zonas, clases 1–8 y volúmenes que cierran',()=>{
  expect(table('CLAY_ZONES').map(r=>r.zone)).toEqual(['A','B','C','D','E']);
  expect(table('MINERAL_ZONES')).toHaveLength(5);
  expect(curve('CLAY_TYPE').every(v=>v>=1&&v<=8)).toBe(true);
  const volumes=['V_QUARTZ','V_CALCITE','V_DOLOMITE','V_CLAY','PHI_MINERAL'].map(p=>curve(p));
  for(let i=0;i<well.depth.values.length;i++)expect(volumes.reduce((s,c)=>s+c[i]!,0)).toBeCloseTo(1,10);
  expect(result.diagnostics.filter(d=>d.level==='error')).toEqual([]);
 });
 it('cambiar umbral U solo en A conserva las otras zonas',()=>{
  const r=engine.run({...interpretation,params:{global:{},zones:{'zone-a':{'clay-typing.uraniumThreshold':.1}}}});
  const a=curve('IND_HIGH_U',r),b=curve('IND_HIGH_U');
  const boundary=well.depth.values.findIndex(z=>z>zones[0]!.base);
  expect(a.slice(0,boundary).some((v,i)=>v!==b[i])).toBe(true);
  expect(Array.from(a.slice(boundary))).toEqual(Array.from(b.slice(boundary)));
 });
 it('la columna reutiliza la pila volumétrica con resultados completos',()=>{
  const stack=computeStack(MINERAL_TRACK.stack!,well.depth.values.length,role=>curve(role));
  expect(stack.missing).toEqual([]);expect(stack.layers).toHaveLength(5);
  for(const theme of [THEMES.light,THEMES.dark]) expect(new Set(stack.layers.map(l=>stackFillColor(l.fill,theme))).size).toBe(5);
  expect(stack.layers.at(-1)!.right[200]).toBeCloseTo(1,6);
 });
});
