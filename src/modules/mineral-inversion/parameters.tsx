/** Formulario con controles generados, filtrado a la arcilla elegida y con alcance global/por zona. */
import type { ModulePanelProps } from '../../ui/modulePanel';
import { Section, SegmentedControl } from '../../ui';
import { paramStorageKey } from '../../core/params';
import { clearParam } from '../../core/state/project';
import { ParamControl } from '../../app/components/ParamControl';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { CLAY_IDS, clayParamKeys, selectedClay } from './calibration';

export function MineralParameters({ module, interpretation, zoneId, setParam }: ModulePanelProps) {
  const entry = useProject(selectActiveEntry);
  const values = Object.fromEntries(Object.entries(module.params).map(([key, spec]) => {
    const storage = paramStorageKey(module.id, key, spec);
    return [key, (zoneId ? interpretation.params.zones[zoneId]?.[storage] : undefined) ?? interpretation.params.global[storage] ?? spec.default];
  }));
  const clay = selectedClay(values);
  const selected = new Set(Object.values(clayParamKeys(clay)));
  const allClay = new Set(CLAY_IDS.flatMap(id => Object.values(clayParamKeys(id))));
  const zone = interpretation.zones.find(z => z.id === zoneId);
  return <Section title="Parámetros" meta={zone ? `zona ${zone.name}` : 'todo el pozo'}>
    <SegmentedControl aria-label="Editar parámetros de" size="sm" wrap block value={zoneId ?? '@global'}
      onChange={v => useUi.getState().set({ editingZoneId: v === '@global' ? null : v })}
      options={[{ value: '@global', label: 'Global' }, ...interpretation.zones.map(z => ({ value: z.id, label: z.name }))]} />
    <div className="module-panel__params">
      {Object.entries(module.params).filter(([key]) => !allClay.has(key) || selected.has(key)).map(([key, spec]) => {
        const storage = paramStorageKey(module.id, key, spec);
        const overridden = !!zoneId && interpretation.params.zones[zoneId]?.[storage] !== undefined;
        const canReset = overridden || (!zoneId && storage in interpretation.params.global);
        return <ParamControl key={key} name={storage} spec={spec} value={values[key]!} editable overridden={overridden}
          onChange={(v, opts) => setParam(key, v, opts)} {...(canReset && entry ? { onReset: () => useProject.getState().commit(`Restablecer ${spec.label}`, p => clearParam(p, entry.well.id, storage, zoneId)), resetLabel: zoneId ? 'usar global' : 'por defecto' } : {})} />;
      })}
    </div>
  </Section>;
}
