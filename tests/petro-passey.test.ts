import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { pairedMedianBaseline, passeySample, SONIC_PER_CYCLE, type PasseyParams } from '../src/petro/passey';
import passeyModule from '../src/modules/passey-toc';

const params:PasseyParams={resistanceBase:1,sonicBase:100,lom:10,separationThreshold:.3,grThreshold:75};
const sample={resistance:1,sonic:100,gr:100};
describe('Passey: valores conocidos y restricciones físicas',()=>{
  it('coincidencia exacta con línea base da separación y TOC nulos',()=>{
    expect(passeySample(sample,params)).toMatchObject({deltaLogR:0,toc:0,sourceFlag:0,resistanceOverlay:0,sonicOverlay:0});
  });
  it('doblar resistividad da log10(2), independiente de la madurez',()=>{
    const r=passeySample({...sample,resistance:2},params);
    expect(r.deltaLogR).toBeCloseTo(.3010299956639812,12);
    // Caso resuelto a mano, no dato experimental de Passey: LOM10 → factor 10^.609.
    expect(r.toc).toBeCloseTo(.3010299956639812*4.064433291647371,10);
    expect(r.sourceFlag).toBe(1);
  });
  it('50 µs/ft equivalen a un ciclo y el sónico tiene orientación opuesta',()=>{
    expect(SONIC_PER_CYCLE).toBe(50);
    expect(passeySample({...sample,sonic:150},params)).toMatchObject({deltaLogR:1,sonicOverlay:-1});
    expect(passeySample({...sample,resistance:.1,sonic:150},params).deltaLogR).toBeCloseTo(0,12);
  });
  it('conserva separación negativa y limita solo TOC a cero',()=>{
    expect(passeySample({...sample,resistance:.1},params)).toMatchObject({deltaLogR:-1,toc:0,sourceFlag:0});
  });
  it('madurez mayor reduce TOC y nunca modifica la separación',()=>{
    const a=passeySample({...sample,resistance:10},params),b=passeySample({...sample,resistance:10},{...params,lom:12});
    expect(a.deltaLogR).toBe(b.deltaLogR);expect(a.toc).toBeGreaterThan(b.toc);
    // Caso analítico de una década: la ec. (3) a LOM12 da 10^.2714.
    expect(b.toc).toBeCloseTo(Math.pow(10,.2714),12);
  });
  it('bandera exige GR alto y umbral de separación estricto',()=>{
    expect(passeySample({...sample,resistance:10,gr:74.99},params).sourceFlag).toBe(0);
    expect(passeySample({...sample,resistance:10,gr:75},params).sourceFlag).toBe(1);
    expect(passeySample({...sample,resistance:10},{...params,separationThreshold:1}).sourceFlag).toBe(0);
    const absentGr=passeySample({...sample,resistance:10,gr:NaN},params);
    expect(absentGr.toc).toBeGreaterThan(0);expect(absentGr.sourceFlag).toBeNaN();
  });
  it.each([{resistance:0},{resistance:-1},{resistance:NaN},{sonic:0},{sonic:NaN}])('medida inválida %j queda sin dato',patch=>{
    expect(passeySample({...sample,...patch},params).deltaLogR).toBeNaN();
  });
  it('línea base/madurez inválidas no fabrican un resultado',()=>{
    for(const patch of [{resistanceBase:0},{sonicBase:NaN},{lom:NaN},{lom:-1}])expect(passeySample(sample,{...params,...patch}).toc).toBeNaN();
  });
});

describe('Selección de línea base del perfil',()=>{
  it('usa las mismas muestras válidas para las dos medianas',()=>{
    const r=pairedMedianBaseline([100,101,102,103],[1,2,4,100],[100,NaN,120,140],100,103);
    expect(r).toEqual({resistance:4,sonic:120,samples:3});
  });
  it('medianas pares, sin mutar los arrays de entrada',()=>{
    const r=[4,1],dt=[120,100];
    expect(pairedMedianBaseline([100,101],r,dt,100,101)).toEqual({resistance:2.5,sonic:110,samples:2});
    expect(r).toEqual([4,1]);expect(dt).toEqual([120,100]);
  });
  it('intervalos exteriores, invertidos, sin muestras o sin pares quedan inválidos',()=>{
    for(const [top,base] of [[99,101],[100,102],[101,100],[100.2,100.8],[0,0]])expect(pairedMedianBaseline([100,101],[1,2],[100,120],top!,base!)).toBeNull();
    expect(pairedMedianBaseline([100,101],[0,2],[100,NaN],100,101)).toBeNull();
  });
});

it('TP: TOC válido exactamente donde existen pares de RT y DT, sin NaN espurios',()=>{
  const {well}=readWellFile(csvText,'tp.csv');
  const rt=well.curves.find(c=>c.role==='RT')!.data,dt=well.curves.find(c=>c.role==='DT')!.data,gr=well.curves.find(c=>c.role==='GR')!.data;
  let valid=0,missing=0;
  for(let i=0;i<rt.length;i++){
    const r=passeySample({resistance:rt[i]!,sonic:dt[i]!,gr:gr[i]},params);
    if(Number.isFinite(rt[i]) && rt[i]!>0 && Number.isFinite(dt[i]) && dt[i]!>0){expect(Number.isFinite(r.toc)).toBe(true);expect(r.toc).toBeGreaterThanOrEqual(0);valid++;}
    else {expect(r.toc).toBeNaN();missing++;}
  }
  expect(valid).toBe(5740);expect(missing).toBe(70);
});

it('módulo no reemplaza un intervalo inválido por valores manuales',()=>{
  const p=Object.fromEntries(Object.entries(passeyModule.params).map(([k,s])=>[k,s.default])) as Parameters<typeof passeyModule.compute>[0]['params'];
  const interval={...p,baselineMode:'interval' as const,baselineTop:0,baselineBase:0};
  const warnings:string[]=[];
  const result=passeyModule.compute({n:2,depth:new Float64Array([100,101]),thickness:new Float64Array([1,1]),inputs:{resistance:new Float64Array([1,10]),sonic:new Float64Array([100,120]),gr:new Float64Array([100,100])},params:interval,segments:[{start:0,end:2,zoneId:null,params:interval}],zones:[],paramsFor:()=>interval,warn:m=>warnings.push(m)});
  expect([...result.toc].every(Number.isNaN)).toBe(true);expect(warnings.some(m=>m.includes('Intervalo base inválido'))).toBe(true);
});
