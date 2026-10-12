import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { CLAY_REGIONS, classifyClay, electronDensity, forwardMinerals, invertMinerals, MINERALS, mineralMixLine, prepareMineralInversion, regionDistance, thoriumUranium, uraniumFlag, type MineralVolumes } from '../src/petro/mineralogy';

const closeVolumes = (actual: MineralVolumes, expected: MineralVolumes) => actual.forEach((v,i) => expect(v).toBeCloseTo(expected[i]!, 7));

describe('Inversión mineral con cierre exacto', () => {
  it.each([0,1,2,3,4])('extremo puro %i', i => {
    const volumes: MineralVolumes = [0,0,0,0,0]; volumes[i] = 1;
    const result = invertMinerals(forwardMinerals(volumes));
    expect(result.valid).toBe(true); closeVolumes(result.volumes, volumes); expect(result.residual).toBeLessThan(1e-7);
  });
  // Cuentas independientes: rho, neutrón y GR por mezcla lineal; U fotoeléctrico
  // por respuestas de SLB2013 Appendix B279280 y calibración rhoe, nunca PE lineal.
  it.each([
    { name: 'arenisca limpia, 20% de porosidad', volumes: [0.8,0,0,0,0.2] as MineralVolumes, rho: 2.312, nphi: 0.184, gr: 0, u: (0.8*1.8*2.8283+0.2*0.36*1.1883)/1.0704 },
    { name: 'caliza dolomitizada', volumes: [0,0.45,0.45,0,0.1] as MineralVolumes, rho: 2.602, nphi: 0.1045, gr: 0, u: (0.45*5.1*2.8983+0.45*3.1*3.0383+0.1*0.36*1.1883)/1.0704 },
    { name: 'arenisca arcillosa', volumes: [0.6,0,0,0.25,0.15] as MineralVolumes, rho: 2.4265, nphi: 0.213, gr: 68.75, u: (0.6*1.8*2.8283+0.25*2.33*2.9583+0.15*0.36*1.1883)/1.0704 },
  ])('$name resuelta a mano', ({volumes,rho,nphi,gr,u}) => {
    const r = invertMinerals({rho,nphi,gr,pe:u/electronDensity(rho)});
    expect(r.valid).toBe(true); closeVolumes(r.volumes,volumes); expect(r.residual).toBeLessThan(1e-7);
  });
  it('ruido y observaciones fuera de la envolvente conservan cierre y no negatividad', () => {
    for (const pe of [0.1,2,5,17,100]) {
      const r = invertMinerals({rho:2.4,pe,nphi:.2,gr:90});
      expect(r.valid).toBe(true); expect(r.volumes.reduce((s,v)=>s+v,0)).toBeCloseTo(1,12);
      expect(r.volumes.every(v=>Number.isFinite(v)&&v>=0)).toBe(true);
      expect(r.residual).toBeGreaterThanOrEqual(0);
    }
  });
  it('no fabrica una solución cuando falta una herramienta o el ajuste pierde rango', () => {
    const o={rho:2.4,pe:2,nphi:.2,gr:40};
    expect(invertMinerals({...o,pe:NaN}).valid).toBe(false);
    expect(invertMinerals(o,{weights:{rho:1,u:0,nphi:1,gr:1}}).valid).toBe(false);
    expect(invertMinerals(o,{clayGr:0,cleanGr:0}).valid).toBe(false);
    expect(invertMinerals({...o,rho:-1}).valid).toBe(false);
  });
  it.each(['illite','kaolinite','chlorite','smectite'] as const)('endmember %s configurable', clay => {
    const v:MineralVolumes=[.35,.2,.1,.2,.15],opts={clay};
    closeVolumes(invertMinerals(forwardMinerals(v,opts),opts).volumes,v);
  });
  it('pesos relativos cambian el óptimo de una muestra incompatible',()=>{
    const o={rho:2.4,pe:8,nphi:.2,gr:50};
    const a=invertMinerals(o),b=invertMinerals(o,{weights:{rho:4,u:.1,nphi:4,gr:4}});
    expect(Math.abs(b.residuals.rho)).toBeLessThan(Math.abs(a.residuals.rho));
  });
  it('la curva PE de mezcla se calcula en U, no interpolando PE',()=>{
    const quartz=MINERALS[0]!,line=mineralMixLine(quartz);
    expect(line.x[0]).toBeCloseTo(quartz.pe,12);
    expect(line.y.at(-1)).toBeCloseTo(1.984,12);
    expect(line.x.at(-1)).not.toBeCloseTo(.6*quartz.pe+.4*.36,3);
  });
});

describe('GR espectral: regiones orientativas y límites',()=>{
  const points:Record<string,[number,number]>={chlorite:[.1,.05],kaolinite:[.8,28],smectite:[1.2,20], 'mixed-layer':[2,15],illite:[3,8],mica:[.8,.6],glauconite:[3,4], 'k-feldspar':[4,1.8]};
  it.each(CLAY_REGIONS.map(r=>r.id))('punto interior de %s',id=>{
    const [k,th]=points[id]!;
    expect(regionDistance(k,th,CLAY_REGIONS.find(r=>r.id===id)!)).toBe(0);
    expect(classifyClay(k,th)?.candidates).toContain(id);
    expect(classifyClay(k,th)?.id).toBe(id);
  });
  it('superposición mica/glauconita se informa sin ocultarla',()=>{
    const c=classifyClay(3,4)!; expect(c.ambiguous).toBe(true); expect(c.candidates).toContain('mica'); expect(c.candidates).toContain('glauconite');
  });
  it('punto exterior tiene distancia y punto inválido no tiene clasificación',()=>{
    expect(classifyClay(20,100)!.distance).toBeGreaterThan(0);
    expect(classifyClay(NaN,3)).toBeNull(); expect(classifyClay(-1,3)).toBeNull();expect(classifyClay(0,0)).toBeNull();
  });
  it('Th/U respeta límites inclusivos y U ausente',()=>{
    expect(thoriumUranium(1,1).environment).toBe('reducing');
    expect(thoriumUranium(2,1).environment).toBe('transitional');
    expect(thoriumUranium(7,1).environment).toBe('transitional');
    expect(thoriumUranium(8,1).environment).toBe('oxidizing');
    expect(thoriumUranium(8,0).ratio).toBeNaN();
    expect(uraniumFlag(5)).toBe(0);expect(uraniumFlag(5.1)).toBe(1);expect(uraniumFlag(NaN)).toBeNaN();
  });
});

it('corrida completa del TP sin NaN espurios; cierre y residuos por muestra',()=>{
  const {well}=readWellFile(csvText,'tp.csv');
  const data=(id:string)=>well.curves.find(c=>c.id===id)!.data;
  const rho=data('ZDEN'),pe=data('PE'),nphi=data('NPHI'),gr=data('GR'),k=data('POTA'),th=data('THOR');
  let valid=0; const invert=prepareMineralInversion();
  for(let i=0;i<rho.length;i++) {
    const observation={rho:rho[i]!,pe:pe[i]!,nphi:nphi[i]!,gr:gr[i]!};
    const r=invert(observation);
    if(Object.values(observation).every(Number.isFinite)&&rho[i]!>0&&pe[i]!>=0&&gr[i]!>=0) {
      expect(r.valid).toBe(true); valid++; expect(r.volumes.every(Number.isFinite)).toBe(true);
      expect(r.volumes.reduce((s,v)=>s+v,0)).toBeCloseTo(1,10);expect(Number.isFinite(r.residual)).toBe(true);
    }
    if(Number.isFinite(k[i])&&Number.isFinite(th[i])&&k[i]!>=0&&th[i]!>=0&&(k[i]!+th[i]!)>0)expect(Number.isFinite(classifyClay(k[i]!,th[i]!)?.distance)).toBe(true);
  }
  expect(valid).toBeGreaterThan(5500);
},30000);

// Valores verificados en la columna ρlog (no densidad de grano seco), Pe y φCNL
// de SLB Log Interpretation Charts, edición2013, Appendix B, pp.279–280.
describe('Referencias minerales explícitas',()=>{
 it.each([
  ['illite',2.77,2.33,.30,6.45],
  ['kaolinite',2.62,1.48,.37,3.87],
 ] as const)('%s conserva la fila de la tabla2013', (id,rho,pe,nphi,u)=>{
  expect(MINERALS.find(m=>m.id===id)).toMatchObject({rho,pe,nphi,tabulatedU:u});
 });
 it('distingue U tabulado de la aproximación electrónica de montmorillonita',()=>{
  const m=MINERALS.find(m=>m.id==='smectite')!;
  expect(m.tabulatedU).toBe(4);expect(m.pe*m.rhoE).toBeCloseTo(4.31297,4);
 });
 it('antracita conserva PE.16; ortoclasa tiene la precisión publicada de la tabla2013',()=>{
  expect(MINERALS.find(m=>m.id==='coal')).toMatchObject({label:'Carbón (antracita)',pe:.16,tabulatedU:.23});
  expect(MINERALS.find(m=>m.id==='k-feldspar')).toMatchObject({rho:2.52,pe:2.9,nphi:-.03,gr:220,tabulatedU:7.2});
 });
 it('la calibración de cuatro herramientas se propaga al forward e inverse',()=>{
  const opts={clayRho:2.52,clayPe:3.45,clayNphi:.25,clayGr:180};
  const v:MineralVolumes=[.35,.1,.1,.3,.15];
  closeVolumes(invertMinerals(forwardMinerals(v,opts),opts).volumes,v);
  const pure=forwardMinerals([0,0,0,1,0],opts);
  expect(pure).toMatchObject({rho:2.52,pe:3.45,nphi:.25,gr:180});
 });
});
