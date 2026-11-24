import { ParamControl } from '../../app/components/ParamControl';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { isPowerPermModel } from '../../petro/permeability';
import { Button } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { clearKPhiModel, CORE_DOCK_ID, storeKPhiModel } from '../core/model';
import { effectivePermCoreModel, PERM_CORE_ID, PERM_CORE_KEYS, permCoreModelSchema } from './params';

function PermCorePanel({ interpretation, zoneId }: ModulePanelProps) {
  const wellId = useProject(selectActiveEntry)?.well.id;
  const commit = useProject((s) => s.commit);
  const zone = zoneId && interpretation.zones.some((z) => z.id === zoneId) ? zoneId : null;
  const { model, origin } = effectivePermCoreModel(interpretation.params, zone);
  const power = isPowerPermModel(model);
  const coefficients = [
    { coefficient: 'a', key: power ? 'powerLogA' : 'kphiA', storage: power ? PERM_CORE_KEYS.powerLogA : PERM_CORE_KEYS.a },
    { coefficient: 'b', key: power ? 'powerB' : 'kphiB', storage: power ? PERM_CORE_KEYS.powerB : PERM_CORE_KEYS.b },
  ] as const;
  const stored = zone === null ? interpretation.params.global : interpretation.params.zones[zone] ?? {};
  const hasModel = Object.values(PERM_CORE_KEYS).some((key) => stored[key] !== undefined);
  return (
    <div className="module-panel__params">
      <p className="module-panel__note">
        {power ? 'Potencial' : 'Exponencial'} · {origin === 'local' ? 'modelo local' : origin === 'global' ? 'modelo global' : 'predeterminado'}
      </p>
      {coefficients.map(({ coefficient, key, storage }) => (
        <ParamControl
          key={key}
          name={storage}
          spec={permCoreModelSchema[key]}
          value={model[coefficient]}
          overridden={origin === 'local'}
          editable={wellId !== undefined}
          onChange={(value, opts) => {
            if (!wellId || typeof value !== 'number') return;
            commit(`Cambiar ${permCoreModelSchema[key].label}`, (p) => storeKPhiModel(p, wellId, { ...model, [coefficient]: value }, zone), opts);
          }}
        />
      ))}
      {hasModel && (
        <Button size="sm" variant="secondary" onClick={() => {
          if (wellId) commit('Restablecer el modelo k–φ', (p) => clearKPhiModel(p, wellId, zone));
        }}>{zone ? 'Usar el modelo global' : 'Restablecer el modelo'}</Button>
      )}
      <Button size="sm" variant="secondary" icon="layers" onClick={() => useUi.getState().set({ dockTab: CORE_DOCK_ID })}>Ajustar desde Corona</Button>
    </div>
  );
}

export const panel: ModulePanel = {
  moduleId: PERM_CORE_ID,
  component: PermCorePanel,
  customParams: Object.keys(permCoreModelSchema),
};
