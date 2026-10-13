/**
 * Sismograma acústico 1D, sin UI ni estado mutable.
 * Ricker: Wang (2015), GJI 200, p.112, ec.(3), DOI 10.1093/gji/ggu384.
 * Impedancia, reflexión normal y tiempo doble: Yilmaz (2001), Seismic Data
 * Analysis, 2.ª ed. SEG; página específica SIN VERIFICAR.
 * Conversión exacta (definición SI; página documental SIN VERIFICAR): pie internacional = 0,3048 m; microsegundo = 10⁻⁶ s.
 * Se integra lentitud trapezoidal y se bloquea AI ponderada por tiempo ANTES
 * de calcular Rc. Los bins [time[i],time[i]+dt] representan AI a la derecha
 * de su frontera; Rc[i] y la traza están en esa frontera, sin desfase medio bin.
 * Convolución de impulsos discretos: no se multiplica por dt.
 */
export interface SyntheticOptions {
  sampleMs?: number; frequencyHz?: number; initialTimeMs?: number;
  polarity?: 'normal' | 'inverted'; smoothWindow?: number; despike?: boolean;
  maxGapSamples?: number; checkshot?: { depth: ArrayLike<number>; timeMs: ArrayLike<number> };
}
export const slownessSecondsPerMeter = (dt: number, unit: 'us/ft' | 'us/m' = 'us/ft'): number =>
  Number.isFinite(dt) && dt > 0 ? dt * 1e-6 / (unit === 'us/ft' ? 0.3048 : 1) : NaN;
export const velocityFromSlowness = (dt: number, unit: 'us/ft' | 'us/m' = 'us/ft'): number => 1 / slownessSecondsPerMeter(dt, unit);
/** AI en MRayl, densidad g/cm³ y velocidad m/s. */
export const acousticImpedance = (rho: number, velocity: number): number =>
  Number.isFinite(rho) && rho > 0 && Number.isFinite(velocity) && velocity > 0 ? rho * velocity / 1000 : NaN;
export const reflectionCoefficient = (a: number, b: number): number =>
  Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0 ? (b - a) / (b + a) : NaN;
export function rickerAt(timeSeconds: number, frequencyHz: number): number {
  const q = (Math.PI * frequencyHz * timeSeconds) ** 2;
  return (1 - 2 * q) * Math.exp(-q);
}
export function rickerWavelet(sampleMs: number, frequencyHz: number) {
  // SIN VERIFICAR: soporte operativo ±3/f; la cola omitida es menor que 10⁻³⁶.
  const half = Math.ceil(3000 / frequencyHz / sampleMs);
  const time = Float64Array.from({ length: 2 * half + 1 }, (_, i) => (i - half) * sampleMs);
  return { time, amplitude: Float64Array.from(time, t => rickerAt(t / 1000, frequencyHz)) };
}
const median = (v: number[]) => { v.sort((a,b) => a-b); const k = v.length >> 1; return v.length % 2 ? v[k] : (v[k-1]+v[k])/2; };
function preprocess(source: ArrayLike<number>, depth: ArrayLike<number>, options: SyntheticOptions) {
  const values = Float64Array.from(source, x => Number.isFinite(x) && x > 0 ? x : NaN);
  let filled = 0;
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) {
    const start = i; while (i < values.length && !Number.isFinite(values[i])) i++;
    if (start > 0 && i < values.length && i-start <= (options.maxGapSamples ?? 0)) {
      for (let j = start; j < i; j++) values[j] = values[start-1] + (values[i]-values[start-1]) * (depth[j]-depth[start-1])/(depth[i]-depth[start-1]);
      filled += i-start;
    }
  }
  const original = values.slice();
  const half = Math.floor((options.smoothWindow ?? 1)/2);
  for (let i = 0; i < values.length; i++) if (Number.isFinite(original[i])) {
    let lo=i, hi=i;
    while (lo > Math.max(0,i-Math.max(half, options.despike ? 2 : 0)) && Number.isFinite(original[lo-1])) lo--;
    while (hi < Math.min(values.length-1,i+Math.max(half, options.despike ? 2 : 0)) && Number.isFinite(original[hi+1])) hi++;
    const local = Array.from(original.slice(lo,hi+1));
    if (options.despike && local.length >= 3) {
      const m=median([...local]), mad=median(local.map(x=>Math.abs(x-m)));
      // SIN VERIFICAR: umbral operativo 3 MAD; con MAD=0 sólo reemplaza aislados.
      if (Math.abs(original[i]-m) > 3*mad) values[i]=m;
    }
  }
  const cleaned=values.slice();
  if(half>0) for(let i=0;i<values.length;i++) if(Number.isFinite(cleaned[i])) {
    let lo=i,hi=i;
    while(lo>Math.max(0,i-half) && Number.isFinite(cleaned[lo-1]))lo--;
    while(hi<Math.min(values.length-1,i+half) && Number.isFinite(cleaned[hi+1]))hi++;
    values[i]=median(Array.from(cleaned.slice(lo,hi+1)));
  }
  return { values, filled };
}
function interpolate(x: ArrayLike<number>, y: ArrayLike<number>, at: number): number {
  if (x.length < 2 || at < x[0] || at > x[x.length-1]) return NaN;
  let lo=0, hi=x.length-1;
  while (hi-lo > 1) { const mid=(hi+lo)>>1; if (x[mid] <= at) lo=mid; else hi=mid; }
  if (at === x[lo]) return y[lo]; if (at === x[hi]) return y[hi];
  return Number.isFinite(y[lo]) && Number.isFinite(y[hi]) ? y[lo]+(y[hi]-y[lo])*(at-x[lo])/(x[hi]-x[lo]) : NaN;
}
export function buildSynthetic(depth: ArrayLike<number>, dt: ArrayLike<number>, rho: ArrayLike<number>, options: SyntheticOptions = {}) {
  // SIN VERIFICAR: defaults dt2ms/f30Hz y ausencia de filtros son elecciones operativas.
  const n=depth.length, sampleMs=options.sampleMs ?? 2, frequencyHz=options.frequencyHz ?? 30;
  if (n !== dt.length || n !== rho.length) throw new RangeError('Las curvas deben tener la misma longitud.');
  if (!(sampleMs > 0) || !(frequencyHz > 0) || frequencyHz >= 500/sampleMs || !Number.isFinite(options.initialTimeMs ?? 0)) throw new RangeError('Paso temporal, frecuencia o tiempo inicial inválidos.');
  for (let i=0;i<n;i++) if (!Number.isFinite(depth[i]) || (i>0 && depth[i]<=depth[i-1])) throw new RangeError('La profundidad debe ser finita y estrictamente creciente.');
  const sonic=preprocess(dt,depth,options), density=preprocess(rho,depth,options), warnings:string[]=[];
  if (sonic.filled+density.filled) warnings.push(`Se interpolaron ${sonic.filled+density.filled} datos internos; no se extrapolaron extremos.`);
  const velocity=Float64Array.from(sonic.values,x=>velocityFromSlowness(x));
  const impedance=Float64Array.from(density.values,(x,i)=>acousticImpedance(x,velocity[i]));
  const reflectivity=new Float64Array(n).fill(NaN), twt=new Float64Array(n).fill(NaN);
  if (n && Number.isFinite(velocity[0])) twt[0]=options.initialTimeMs ?? 0;
  for (let i=1;i<n;i++) {
    reflectivity[i]=reflectionCoefficient(impedance[i-1],impedance[i]);
    twt[i]=twt[i-1]+(depth[i]-depth[i-1])*(slownessSecondsPerMeter(sonic.values[i-1])+slownessSecondsPerMeter(sonic.values[i]))*1000;
  }
  if (options.checkshot) {
    const c=options.checkshot;
    if(c.depth.length!==c.timeMs.length || c.depth.length<2) throw new RangeError('Check-shot requiere al menos dos pares.');
    for(let i=0;i<c.depth.length;i++) if(!Number.isFinite(c.depth[i]) || !Number.isFinite(c.timeMs[i]) || (i>0 && (c.depth[i]<=c.depth[i-1] || c.timeMs[i]<=c.timeMs[i-1]))) throw new RangeError('Check-shot debe ser finito y creciente en profundidad y tiempo.');
    for(let i=0;i<n;i++) twt[i]=interpolate(c.depth,c.timeMs,depth[i]);
  }
  const valid=Array.from(twt, (x,i)=>Number.isFinite(x)?i:-1).filter(i=>i>=0);
  const first=valid[0], last=valid[valid.length-1];
  const validTimeSpan=valid.length ? twt[last]-twt[first] : NaN;
  const count=valid.length ? Math.floor(validTimeSpan/sampleMs+1e-9) : 0;
  // SIN VERIFICAR: límite operativo de memoria, no una constante geofísica.
  if(count>200000) throw new RangeError('El remuestreo excede 200.000 muestras; aumentá el paso temporal.');
  const time=Float64Array.from({length:count},(_,i)=>twt[first]+i*sampleMs);
  const timeImpedance=new Float64Array(count).fill(NaN);
  let cursor=first;
  for(let i=0;i<count;i++) {
    const a=time[i], b=a+sampleMs; let sum=0, covered=0, missing=false;
    while(cursor<last && (twt[cursor]+twt[cursor+1])/2<=a) cursor++;
    for(let j=cursor;j<=last;j++) {
      const left=j===first?twt[first]:(twt[j-1]+twt[j])/2;
      const right=j===last?twt[last]:(twt[j]+twt[j+1])/2;
      if(left>=b) break;
      const overlap=Math.max(0,Math.min(b,right)-Math.max(a,left));
      if(overlap) { covered+=overlap; if(Number.isFinite(impedance[j])) sum+=overlap*impedance[j]; else missing=true; }
    }
    if(!missing && Math.abs(covered-sampleMs)<1e-6) timeImpedance[i]=sum/covered;
  }
  const timeReflectivity=new Float64Array(count); if(count) timeReflectivity[0]=Number.isFinite(timeImpedance[0])?0:NaN;
  for(let i=1;i<count;i++) timeReflectivity[i]=reflectionCoefficient(timeImpedance[i-1],timeImpedance[i]);
  const wavelet=rickerWavelet(sampleMs,frequencyHz), half=wavelet.time.length>>1;
  const trace=new Float64Array(count), sign=options.polarity==='inverted'?-1:1;
  for(let i=0;i<count;i++) {
    let value=0;
    for(let j=Math.max(0,i-half);j<=Math.min(count-1,i+half);j++) {
      if(!Number.isFinite(timeReflectivity[j])) { value=NaN; break; }
      value+=timeReflectivity[j]*wavelet.amplitude[i-j+half];
    }
    trace[i]=sign*value;
  }
  const syntheticDepth=Float64Array.from(twt,(t,i)=>Number.isFinite(impedance[i])?interpolate(time,trace,t):NaN);
  const gapCount=Array.from(sonic.values).filter(x=>!Number.isFinite(x)).length;
  if(gapCount) warnings.push(`${gapCount} muestras sin DT: el tiempo integrado y la traza no se extrapolan.`);
  if(Array.from(density.values).some(x=>!Number.isFinite(x))) warnings.push('La densidad faltante invalida impedancia y convolución en su vecindad.');
  return {velocity,impedance,reflectivity,twt,syntheticDepth,time,timeImpedance,timeReflectivity,trace,wavelet,warnings,gapCount,
    totalTime:n && Number.isFinite(twt[0]) && Number.isFinite(twt[n-1]) ? twt[n-1]-twt[0] : NaN,
    validTimeSpan,lastValidDepth:valid.length?depth[last]:NaN};
}
