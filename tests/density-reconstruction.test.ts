import { describe, it, expect } from 'vitest';
import { reconstructDensity, densityCalibrationHalfWidth, densityRegressionMetrics, type DensityReconstructionInput } from '../src/ml/densityReconstruction.ts';

function synthetic(): DensityReconstructionInput {
  const n = 2000;
  const depth = Float64Array.from({length:n}, (_,i) => i*.2);
  const gr = Float64Array.from(depth, z => 80 + 50*Math.sin(z*.7));
  const sonic = Float64Array.from(depth, z => 90 + 30*Math.cos(z*.47));
  const density = Float64Array.from(depth, (z,i) => 2.2 + .003*gr[i]! + .001*sonic[i]! + .006*Math.sin(z*11));
  const washoutMask = Uint8Array.from(depth, z => z>=190 && z<200 ? 1:0);
  const goodMask = Uint8Array.from(washoutMask, v => 1-v);
  for (let i=0;i<n;i++) if(washoutMask[i]) density[i]=NaN;
  return {depth,density,goodMask,washoutMask,predictors:[{id:'GR',role:'gr',values:gr,trusted:true},{id:'DT',role:'sonic',values:sonic,trusted:true}]};
}
describe('F20 reconstrucción por bloques', () => {
  it('métricas contra cálculo manual: SSE=2, SST=2, RMSE=sqrt(2/3), R²=0', () => {
    expect(densityRegressionMetrics([1,2,3],[2,2,2])).toEqual({rmse:Math.sqrt(2/3),r2:0});
    expect(densityRegressionMetrics([2,2],[2,2]).r2).toBeNull();
  });
  it('banda usa orden ceil((n+1)*.9), nunca dispersión de árboles', () => {
    expect(densityCalibrationHalfWidth(Array.from({length:20},(_,i)=>i+1))).toBe(19);
    expect(densityCalibrationHalfWidth([1])).toBeNull();
  });
  it('recupera bloque oculto y no muta originales, con banda calibrada', () => {
    const input=synthetic(), original=Float64Array.from(input.density);
    const r=reconstructDensity(input);
    expect(r.report.accepted).toBe(true);
    expect(r.report.estimatedCount).toBe(50);
    let sse=0,count=0;
    for(let i=0;i<input.depth.length;i++) {
      if(input.washoutMask[i]) {
        const truth=2.2+.003*input.predictors[0]!.values[i]!+.001*input.predictors[1]!.values[i]!+.006*Math.sin(input.depth[i]!*11);
        sse+=(truth-r.data[i]!)**2; count++;
        expect(r.status[i]).toBe(1);
        expect(r.lower[i]).toBeLessThan(r.upper[i]!);
      } else expect(r.data[i]).toBe(original[i]);
    }
    expect(Math.sqrt(sse/count)).toBeLessThan(.08);
    expect(Float64Array.from(input.density)).toEqual(original);
  });
  it('el objetivo oculto no afecta ajuste, banda ni soporte', () => {
    const a=synthetic(), b=synthetic();
    for(let i=0;i<b.depth.length;i++) if(b.washoutMask[i]) (b.density as Float64Array)[i]=9999;
    const ra=reconstructDensity(a), rb=reconstructDensity(b);
    expect(ra.data).toEqual(rb.data);
    expect(ra.lower).toEqual(rb.lower);
    expect(ra.report.rmse).toBe(rb.report.rmse);
  });
  it('descarta faltantes y extrapolación dentro del derrumbe', () => {
    const input=synthetic();
    (input.predictors[0]!.values as Float64Array)[950]=NaN;
    (input.predictors[0]!.values as Float64Array)[951]=490;
    const r=reconstructDensity(input);
    expect(r.report.accepted).toBe(true);
    expect(r.status[950]).toBe(2); expect(r.status[951]).toBe(3);
    expect(r.data[950]).toBeNaN(); expect(r.data[951]).toBeNaN();
  });
  it('rechaza soporte insuficiente y confianza implícita', () => {
    const input=synthetic();
    (input.goodMask as Uint8Array).fill(0,500);
    const r=reconstructDensity(input);
    expect(r.report.accepted).toBe(false);
    expect(r.report.estimatedCount).toBe(0);
    const neutron=synthetic();
    neutron.predictors[1]!.role='neutron';
    (neutron.predictors[1]!.values as Float64Array).fill(.2);
    expect(reconstructDensity(neutron).report.accepted).toBe(false);
  });
  it('rechaza modelo sin capacidad predictiva sin tocar valores originales', () => {
    const input=synthetic();
    for(let i=0;i<input.depth.length;i++) if(input.goodMask[i]) (input.density as Float64Array)[i]=2.4+.25*Math.sin(i*1.77);
    const r=reconstructDensity(input);
    expect(r.report.accepted).toBe(false); expect(r.report.estimatedCount).toBe(0);
    expect(r.report.reasons.some(s=>s.includes('RMSE'))).toBe(true);
  });
  it('cobertura incluye huecos de predictores en buen pozo y máscaras ambiguas se rechazan', () => {
    const input=synthetic();
    (input.predictors[0]!.values as Float64Array).fill(NaN,0,1200);
    const r=reconstructDensity(input);
    expect(r.report.accepted).toBe(false); expect(r.report.validationCoverage).toBeLessThan(.6);
    (input.goodMask as Uint8Array)[950]=1;
    expect(()=>reconstructDensity(input)).toThrow(/solaparse/);
  });
});
