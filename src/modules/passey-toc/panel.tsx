/** Parámetros de madurez y selección explícita del intervalo base desde el perfil. */
import { ParamControl } from '../../app/components/ParamControl';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { useViewer } from '../../app/store/viewer';
import { paramStorageKey } from '../../core/params';
import { setParam as writeParam, clearParam } from '../../core/state/project';
import type { TableValue } from '../../core/module';
import { Button, Callout, EmptyState, Section, SegmentedControl, formatNumber } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { PASSEY_BASELINES, PASSEY_ZONES } from './index';
import './panel.css';

function PasseyPanel({module,interpretation,zoneId,setParam,result}:ModulePanelProps) {
  const entry=useProject(selectActiveEntry), visible=useViewer(s=>s.visible);
  const values=Object.fromEntries(Object.entries(module.params).map(([key,spec])=>{
    const storage=paramStorageKey(module.id,key,spec);
    return [key,(zoneId && spec.scope==='zone' ? interpretation.params.zones[zoneId]?.[storage] : undefined) ?? interpretation.params.global[storage] ?? spec.default];
  }));
  const rows=(result?.outputs.find(o=>o.moduleId===module.id && o.port===PASSEY_ZONES)?.value as TableValue|undefined)?.rows ?? [];
  const baselines=(result?.outputs.find(o=>o.moduleId===module.id && o.port===PASSEY_BASELINES)?.value as TableValue|undefined)?.rows ?? [];
  const fmt=(v:unknown,digits=2)=>typeof v==='number' ? formatNumber(v,{digits}) : '—';
  const zone=interpretation.zones.find(z=>z.id===zoneId);
  return <div className="passey-panel">
    <Callout tone="warn" title="Estimación orientativa">Confirmá TOC y madurez con geoquímica. Elegí una línea base en roca arcillosa sin enriquecimiento orgánico de la misma formación; gas y reservorios con hidrocarburos pueden generar separación.</Callout>
    <Section title="Línea base y madurez" meta={zone?`zona ${zone.name}`:'todo el pozo'}>
      <SegmentedControl aria-label="Editar parámetros de Passey" size="sm" wrap block value={zoneId??'@global'} onChange={v=>useUi.getState().set({editingZoneId:v==='@global'?null:v})} options={[{value:'@global',label:'Global'},...interpretation.zones.map(z=>({value:z.id,label:z.name}))]} />
      <div className="module-panel__params">{Object.entries(module.params).filter(([key])=>values.baselineMode==='interval' ? !['resistanceBase','sonicBase'].includes(key) : !['baselineTop','baselineBase'].includes(key)).map(([key,spec])=>{
        const storage=paramStorageKey(module.id,key,spec), scope=spec.scope==='zone'?zoneId:null;
        const overridden=!!scope && interpretation.params.zones[scope]?.[storage]!==undefined;
        const canReset=overridden || (!scope && storage in interpretation.params.global);
        return <ParamControl key={key} name={storage} spec={spec} value={values[key]!} editable overridden={overridden} onChange={v=>setParam(key,v)} {...(canReset && entry ? {onReset:()=>useProject.getState().commit(`Restablecer ${spec.label}`,p=>clearParam(p,entry.well.id,storage,scope)),resetLabel:scope?'usar global':'por defecto'}:{})} />;
      })}</div>
      <Button size="sm" variant="secondary" disabled={!entry || !visible} onClick={()=>{
        if(!entry || !visible) return;
        useProject.getState().commit('Usar intervalo visible como línea base de Passey',p=>writeParam(writeParam(writeParam(p,entry.well.id,'passey-toc.baselineTop',Math.max(entry.well.depth.values[0]!,visible.top),null),entry.well.id,'passey-toc.baselineBase',Math.min(entry.well.depth.values[entry.well.depth.values.length-1]!,visible.base),null),entry.well.id,'passey-toc.baselineMode','interval',null));
      }}>Usar intervalo visible del perfil</Button>
      <p className="passey-panel__note">Acercá el visor al tramo no generador antes de usar su intervalo. También podés editar tope y base. Las medianas no identifican automáticamente una roca sin materia orgánica.</p>
    </Section>
    {baselines.length>0 && <p className="passey-panel__note">Línea base aplicada: {baselines.filter((r,i,list)=>list.findIndex(b=>b.zone===r.zone)===i).map(r=>`${r.zone}: Rt ${fmt(r.resistance)} ohm·m · DT ${fmt(r.sonic,1)} µs/ft${Number(r.samples)>0?` · ${r.samples} pares`:''}`).join(' / ')}</p>}
    <Section title="TOC por zona">
      {!rows.length?<EmptyState size="sm" title="Sin resultados por zona" description="Cargá resistividad profunda y sónico, definí zonas y revisá la línea base." />:<div className="passey-panel__table"><table><thead><tr><th>Zona</th><th>Muestras</th><th>TOC medio</th><th>Rango TOC</th><th>Bandera</th></tr></thead><tbody>{rows.map(r=><tr key={String(r.zoneId)}><td>{r.zone}</td><td>{r.samples}</td><td>{fmt(r.mean)} % peso</td><td>{fmt(r.minimum)}–{fmt(r.maximum)} % peso</td><td>{fmt(r.source,1)} %<small>{fmt(r.negative,1)} % separación negativa</small></td></tr>)}</tbody></table></div>}
    </Section>
    <p className="passey-panel__note">Rojo: resistividad. Azul: sónico con orientación opuesta; 50 µs/ft por ciclo. El relleno rosa marca separación positiva. Los valores fuera de escala pueden consultarse en el tooltip. La bandera combina separación y GR, sin confirmar roca generadora.</p>
  </div>;
}
export const panel:ModulePanel={moduleId:'passey-toc',component:PasseyPanel,mode:'replace'};
