import { describe,it,expect } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { buildSynthetic, rickerAt, rickerWavelet, reflectionCoefficient, velocityFromSlowness } from '../src/petro/synthetic';

describe('Sismograma: referencias analíticas independientes',()=>{
  it('Ricker: pico unidad y ceros analíticos, Wang 2015 p112 ec3',()=>{
    expect(rickerAt(0,30)).toBe(1);
    for(const sign of [-1,1])expect(rickerAt(sign/(Math.PI*30*Math.sqrt(2)),30)).toBeCloseTo(0,14);
    const w=rickerWavelet(1,30);expect(Math.max(...w.amplitude)).toBe(1);
    // DFT directa: no depende de una FFT ni de la implementación del motor.
    const energy=(f:number)=>{
      let re=0,im=0;w.time.forEach((t,i)=>{re+=w.amplitude[i]*Math.cos(2*Math.PI*f*t/1000);im-=w.amplitude[i]*Math.sin(2*Math.PI*f*t/1000);});return re*re+im*im;
    };
    const peak=Array.from({length:80},(_,i)=>i+1).sort((a,b)=>energy(b)-energy(a))[0];expect(peak).toBe(30);
  });
  it('conversión explícita de µs/ft y µs/m',()=>{
    expect(velocityFromSlowness(60)).toBeCloseTo(5080,10);
    expect(velocityFromSlowness(60/.3048,'us/m')).toBeCloseTo(5080,10);
  });
  it('escalón y dos capas: Rc único, tiempo correcto y Ricker escalada',()=>{
    // Caso construido a mano: V=2000m/s; muestras cada2m, interfaz199m=>199ms.
    const exact=buildSynthetic(Float64Array.from({length:202},(_,i)=>i*2),new Float64Array(202).fill(152.4),Float64Array.from({length:202},(_,i)=>i<100?2:3),{sampleMs:1});
    expect(reflectionCoefficient(4,6)).toBeCloseTo(.2,14);
    const impulses=Array.from(exact.timeReflectivity).map((v,i)=>({v,i})).filter(x=>Math.abs(x.v)>1e-12);
    expect(impulses).toHaveLength(1);const {i,v}=impulses[0];expect(v).toBeCloseTo(.2,12);expect(exact.time[i]).toBeCloseTo(199,10);
    for(let j=0;j<exact.trace.length;j++)expect(exact.trace[j]).toBeCloseTo(.2*rickerAt((exact.time[j]-199)/1000,30),10);
  });
  it('tiempo doble constante, polaridad y entradas sin mutación',()=>{
    const z=[0,100,200],dt=[100,100,100],rho=[2,2,3];
    const normal=buildSynthetic(z,dt,rho),inv=buildSynthetic(z,dt,rho,{polarity:'inverted'});
    expect(normal.totalTime).toBeCloseTo(2*200*100e-6/.3048*1000,10);
    normal.trace.forEach((x,i)=>expect(inv.trace[i]).toBeCloseTo(-x,12));expect(dt).toEqual([100,100,100]);
  });
  it('hueco interno invalida acumulación; interpolación explícita no extrapola cola',()=>{
    expect([...buildSynthetic([0,1,2,3],[100,NaN,100,100],[2,2,2,2]).twt].slice(1).every(Number.isNaN)).toBe(true);
    const r=buildSynthetic([0,1,2,3],[100,NaN,100,NaN],[2,2,2,2],{maxGapSamples:1});expect(Number.isFinite(r.twt[2])).toBe(true);expect(r.twt[3]).toBeNaN();
  });
  it('despike y suavizado se componen sin reintroducir los picos',()=>{
    const r=buildSynthetic([0,1,2,3,4,5],new Float64Array(6).fill(100),[1,1,100,100,1,1],{despike:true,smoothWindow:3});
    expect([...r.impedance].every(x=>Math.abs(x-3.048)<1e-12)).toBe(true);
  });
  it('check-shot reemplaza integración sólo dentro de sus pares',()=>{
    const r=buildSynthetic([0,100,200,300],[100,100,100,100],[2,2,2,2],{checkshot:{depth:[100,200],timeMs:[250,350]}});
    expect([...r.twt]).toEqual([NaN,250,350,NaN]);expect(r.totalTime).toBeNaN();expect(r.validTimeSpan).toBe(100);
    expect(()=>buildSynthetic([0,1],[100,100],[2,2],{checkshot:{depth:[0,1],timeMs:[2,1]}})).toThrow();
  });
  it('TP: tramo conocido finito y exactamente70 tiempos faltantes en cola',()=>{
    const {well}=readWellFile(csvText,'tp.csv');const dt=well.curves.find(c=>c.role==='DT')!.data,rho=well.curves.find(c=>c.role==='RHOB')!.data;
    const r=buildSynthetic(well.depth.values,dt,rho);expect(r.gapCount).toBe(70);expect(r.twt.filter(Number.isFinite)).toHaveLength(5740);
    expect(r.timeImpedance.every(Number.isFinite)).toBe(true);expect(r.trace.every(Number.isFinite)).toBe(true);expect(r.totalTime).toBeNaN();expect(r.validTimeSpan).toBeGreaterThan(0);
    expect(r.lastValidDepth).toBeCloseTo(8507.8824,4);
  });
});
