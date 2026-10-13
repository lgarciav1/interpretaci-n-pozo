/** Geo-4: carbono orgánico orientativo por Passey; definición pura para el Worker. */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { pairedMedianBaseline, passeySample, PASSEY_REFERENCE } from '../../petro/passey';

export const PASSEY_ZONES = 'PASSEY_ZONES';
export const PASSEY_BASELINES = 'PASSEY_BASELINES';
const cell = (x: number): TableCell => Number.isFinite(x) ? x : null;

export default defineModule({
  id: 'passey-toc', name: 'Carbono orgánico · Passey', category: 'geology', workspace: 'geology',
  description: 'Alinea sónico y resistividad en roca sin enriquecimiento orgánico y estima TOC con madurez elegida.',
  roles: [
    { id: 'DELTA_LOG_R', label: 'Separación Passey', unit: 'unitless', family: 'other', origin: 'computed', display: { color: '#b65ca5', scale: 'linear', min: -1, max: 2 } },
    { id: 'TOC', label: 'Carbono orgánico total', unit: 'wt%', family: 'other', origin: 'computed', display: { color: '#6c934e', scale: 'linear', min: 0, max: 20 } },
    { id: 'IND_SOURCE_ROCK', label: 'Bandera de posible roca generadora', unit: 'unitless', family: 'flag', origin: 'computed', display: { color: '#bd6fa7', scale: 'linear', min: 0, max: 1 } },
    { id: 'PASSEY_RT_OVERLAY', label: 'Resistividad alineada · Passey', unit: 'unitless', family: 'other', origin: 'computed', display: { color: '#c81e3a', scale: 'linear', min: -2, max: 2 } },
    { id: 'PASSEY_DT_OVERLAY', label: 'Sónico alineado · Passey', unit: 'unitless', family: 'other', origin: 'computed', display: { color: '#1f5fd1', scale: 'linear', min: -2, max: 2 } },
  ],
  inputs: { resistance: input.curve('RT'), sonic: input.curve('DT'), gr: input.optionalCurve('GR') },
  params: {
    baselineMode: param.enum({ label: 'Línea base', default: 'manual', options: [{value:'manual',label:'Valores manuales'}, {value:'interval',label:'Medianas de un intervalo'}], tooltip: 'Elegí roca arcillosa sin materia orgánica de la misma formación. Un intervalo inválido queda sin resultado; no usa valores manuales de respaldo.' }),
    // Passey et al. (1990), fig. 2, p. 1780: Rbase=1 ohm·m y DTbase=100 µs/ft.
    // Se usan como valores iniciales del ejemplo; no caracterizan el TP sin calibración.
    resistanceBase: param.number({ label: 'Resistividad base', default: 1, min: .01, max: 100, step: .01, scale: 'log', unit: 'ohm.m', scope: 'zone' }),
    sonicBase: param.number({ label: 'Sónico base', default: 100, min: 20, max: 250, step: 1, unit: 'us/ft', scope: 'zone' }),
    baselineTop: param.number({ label: 'Tope del intervalo base', default: 0, min: 0, max: 15000, step: .1, unit: 'm', tooltip: 'Cero es el valor inicial sin intervalo seleccionado; elegí tope y base dentro del pozo.' }),
    baselineBase: param.number({ label: 'Base del intervalo base', default: 0, min: 0, max: 15000, step: .1, unit: 'm' }),
    // SIN VERIFICAR: LOM 10 es una elección inicial práctica; requiere geoquímica para calibrar madurez.
    lom: param.number({ label: 'Madurez LOM', default: 10, min: 6, max: 12, step: .1, scope: 'zone', tooltip: 'Madurez orgánica independiente, no reflectancia de vitrinita. Confirmala con geoquímica.' }),
    // SIN VERIFICAR: umbrales operativos ajustables de indicación, no diagnósticos bibliográficos.
    separationThreshold: param.number({ label: 'Separación mínima para bandera', default: .3, min: 0, max: 2, step: .01, scope: 'zone' }),
    grThreshold: param.number({ label: 'GR mínimo para bandera', default: 75, min: 0, max: 300, step: 1, unit: 'gAPI', scope: 'zone' }),
  },
  outputs: {
    delta: output.curve('DELTA_LOG_R'), toc: output.curve('TOC'), flag: output.curve('IND_SOURCE_ROCK'), resistanceOverlay: output.curve('PASSEY_RT_OVERLAY'), sonicOverlay: output.curve('PASSEY_DT_OVERLAY'),
    baselines: output.table(PASSEY_BASELINES, {label:'Líneas base aplicadas', hidden:true, columns:[{key:'zone',label:'Zona',kind:'text'},{key:'resistance',label:'Rt base',unit:'ohm.m'},{key:'sonic',label:'DT base',unit:'us/ft'},{key:'samples',label:'Muestras del intervalo'}]}),
    zones: output.table(PASSEY_ZONES, {label:'Carbono orgánico por zona', hidden:true, columns:[{key:'zone',label:'Zona',kind:'text'},{key:'samples',label:'Muestras válidas'},{key:'minimum',label:'TOC mínimo',unit:'wt%'},{key:'maximum',label:'TOC máximo',unit:'wt%'},{key:'mean',label:'TOC medio',unit:'wt%'},{key:'negative',label:'Separación negativa (%)'},{key:'source',label:'Bandera generadora (%)'}]}),
  },
  compute({n,depth,inputs,params,segments,zones,warn}) {
    const delta=new Float64Array(n).fill(NaN), toc=new Float64Array(n).fill(NaN), flag=new Float64Array(n).fill(NaN);
    const resistanceOverlay=new Float64Array(n).fill(NaN), sonicOverlay=new Float64Array(n).fill(NaN);
    const baseline = params.baselineMode === 'interval' ? pairedMedianBaseline(depth,inputs.resistance,inputs.sonic,params.baselineTop,params.baselineBase) : null;
    if (params.baselineMode === 'interval' && !baseline) warn('Intervalo base inválido, fuera del pozo o sin pares válidos de resistividad y sónico. Elegí otro intervalo; la estimación queda sin dato.');
    if (!inputs.gr) warn('Sin GR: se estima TOC, pero la bandera de posible roca generadora queda sin dato.');
    const baselineRows:Record<string,TableCell>[]=[];
    for (const s of segments) {
      const p=s.params, zoneName=zones.find(z=>z.id===s.zoneId)?.name ?? 'Fuera de zonas';
      if (p.lom < 7 || p.lom > 12) warn(`Madurez LOM fuera de 7–12 en ${zoneName}: el modelo de Passey requiere revisar su aplicabilidad antes de interpretar TOC.`);
      if (p.baselineMode === 'interval' && !baseline) continue;
      const resistanceBase=baseline?.resistance ?? p.resistanceBase, sonicBase=baseline?.sonic ?? p.sonicBase;
      if (![resistanceBase,sonicBase].every(v=>Number.isFinite(v)&&v>0)) warn(`Línea base manual inválida en ${zoneName}: resistividad y sónico deben ser positivos.`);
      baselineRows.push({zoneId:s.zoneId,zone:zoneName,resistance:cell(resistanceBase),sonic:cell(sonicBase),samples:baseline?.samples ?? 0});
      for (let i=s.start;i<s.end;i++) {
        const r=passeySample({resistance:inputs.resistance[i],sonic:inputs.sonic[i],gr:inputs.gr?.[i]}, {...p,resistanceBase,sonicBase});
        delta[i]=r.deltaLogR; toc[i]=r.toc; flag[i]=r.sourceFlag; resistanceOverlay[i]=r.resistanceOverlay; sonicOverlay[i]=r.sonicOverlay;
      }
    }
    const rows=zones.map(z=>{
      let count=0,sum=0,min=Infinity,max=-Infinity,negative=0,flagCount=0,flags=0;
      for(let i=z.start;i<z.end;i++) {
        if(Number.isFinite(toc[i])) {count++;sum+=toc[i];min=Math.min(min,toc[i]);max=Math.max(max,toc[i]);negative+=Number(delta[i]<0);}
        if(Number.isFinite(flag[i])) {flagCount++;flags+=flag[i];}
      }
      return {zoneId:z.id,zone:z.name,samples:count,minimum:cell(count?min:NaN),maximum:cell(count?max:NaN),mean:cell(count?sum/count:NaN),negative:cell(count?100*negative/count:NaN),source:cell(flagCount?100*flags/flagCount:NaN)};
    });
    warn('Passey es orientativo: elegí línea base en roca no generadora y calibrá madurez LOM y TOC con geoquímica. El gas, los reservorios con hidrocarburos y la litología pueden producir falsos positivos.');
    return {delta,toc,flag,resistanceOverlay,sonicOverlay,baselines:{rows:baselineRows},zones:{rows}};
  },
  docs: {
    summary:'Superpone sónico y resistividad profunda con 50 µs/ft por ciclo logarítmico de resistividad. La línea base se define manualmente o mediante medianas de pares válidos en un intervalo del intérprete. Conserva separaciones negativas; TOC se limita a cero. La bandera exige separación positiva sobre umbral y GR alto; sin GR queda sin dato. No diagnostica roca generadora.',
    equations:[{latex:'\\Delta\\log R=\\log_{10}(R/R_b)+0.02(DT-DT_b)',description:'Passey (1990), ec. (1); DT en µs/ft.'},{latex:'TOC_{wt\\%}=\\max(0,\\Delta\\log R)10^{2.297-0.1688LOM}',description:'Passey (1990), ec. (3), con restricción física a cero.'}],
    references:[PASSEY_REFERENCE], notes:'Ec. (1) y valores del ejemplo fig. 2: p. 1780. Página puntual/numeración de la relación TOC SIN VERIFICAR. LOM por defecto, umbrales de bandera y estimador de medianas son decisiones operativas SIN VERIFICAR como criterios bibliográficos. No se extrapola un intervalo fuera del pozo ni se reemplaza por una línea manual si falla.',
  },
});
