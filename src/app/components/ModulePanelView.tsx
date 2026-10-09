/** Panel del módulo activo: método elegido, zona en edición y controles generados desde el esquema. */
import { useMemo } from 'react';
import { portOf, type AnyModule } from '../../core/module';
import { paramScope, paramStorageKey, type ParamValue } from '../../core/params';
import { clearParam, setCompare, setParam, setSource } from '../../core/state/project';
import { registry } from '../../modules';
import { collectPanels } from '../modulePanels';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { ParamControl } from './ParamControl';

const panels = collectPanels(registry);

export function ModulePanelView({ module }: { module: AnyModule }) {
  const entry = useProject(selectActiveEntry);
  const commit = useProject((s) => s.commit);
  const result = useResults((s) => s.result);
  const zoneId = useUi((s) => s.editingZoneId);
  const setUi = useUi((s) => s.set);
  const custom = panels.get(module.id);

  const curvePorts = useMemo(() => Object.values(module.outputs).map(portOf), [module]);
  if (!entry) return null;
  const { interpretation, well } = entry;
  const wellId = well.id;
  const zone = zoneId ? interpretation.zones.find((z) => z.id === zoneId) ?? null : null;

  const status = result?.nodes.find((n) => n.moduleId === module.id);
  const setLocal = (key: string, value: ParamValue) => {
    const spec = module.params[key]!;
    const storage = paramStorageKey(module.id, key, spec);
    commit(`Parámetro ${spec.label}`, (p) => setParam(p, wellId, storage, value, zone && paramScope(spec) === 'zone' ? zone.id : null));
  };

  return (
    <div>
      <div className="section">
        <h2>{module.name}</h2>
        {module.description && <p className="muted" style={{ margin: 0 }}>{module.description}</p>}
        <p style={{ margin: '6px 0 0' }}>
          Estado:{' '}
          {status ? (
            <span className={status.status === 'ok' ? 'status-ok' : 'status-bad'}>
              {status.status === 'ok' ? (status.computed ? `calculado en ${status.ms < 0.1 ? 'menos de 0,1' : status.ms.toFixed(1)} ms` : 'sin cambios (caché)') : status.status}
            </span>
          ) : (
            <span className="muted">no corre</span>
          )}
        </p>
      </div>

      {curvePorts.map((port) => {
        const candidates = result?.candidates[port] ?? [];
        if (candidates.length < 2) return null;
        const chosen = result?.sources[port];
        const keyOf = (s: { kind: string; curveId?: string; moduleId?: string }) => (s.kind === 'curve' ? `curve:${s.curveId}` : `module:${s.moduleId}`);
        return (
          <div className="section" key={port}>
            <h2>Método para {port}</h2>
            <select
              value={chosen ? keyOf(chosen) : ''}
              onChange={(e) => {
                const [kind, id] = e.currentTarget.value.split(/:(.*)/) as [string, string];
                commit(`Método de ${port}`, (p) => setSource(p, wellId, port, kind === 'curve' ? { kind: 'curve', curveId: id } : { kind: 'module', moduleId: id }));
              }}
            >
              {candidates.map((c) => (
                <option key={keyOf(c)} value={keyOf(c)}>
                  {c.kind === 'curve' ? `Curva medida ${c.curveId}` : registry.get(c.moduleId)?.name ?? c.moduleId}
                </option>
              ))}
            </select>
            <label style={{ marginLeft: 8 }}>
              <input
                type="checkbox"
                checked={interpretation.compare.includes(module.id)}
                onChange={(e) => commit('Comparar método', (p) => setCompare(p, wellId, module.id, e.currentTarget.checked))}
              />{' '}
              calcular para comparar
            </label>
          </div>
        );
      })}

      {Object.keys(module.params).length > 0 && custom?.mode !== 'replace' && (
        <div className="section">
          <h2>Parámetros</h2>
          <div className="tabs" style={{ marginBottom: 12, flexWrap: 'wrap' }} role="group" aria-label="Editar parámetros de">
            <button type="button" aria-pressed={zoneId === null} onClick={() => setUi({ editingZoneId: null })}>
              Global
            </button>
            {interpretation.zones.map((z) => (
              <button type="button" key={z.id} aria-pressed={zoneId === z.id} onClick={() => setUi({ editingZoneId: z.id })}>
                {z.name}
              </button>
            ))}
          </div>
          {Object.entries(module.params).map(([key, spec]) => {
            const storage = paramStorageKey(module.id, key, spec);
            const zoned = paramScope(spec) === 'zone';
            const globalValue = interpretation.params.global[storage] ?? spec.default;
            const zoneValue = zone && zoned ? interpretation.params.zones[zone.id]?.[storage] : undefined;
            const editable = !zone || zoned;
            return (
              <ParamControl
                key={key}
                name={storage}
                spec={spec}
                value={zoneValue ?? globalValue}
                overridden={zoneValue !== undefined}
                editable={editable}
                onChange={(v) => setLocal(key, v)}
                {...(zone && zoneValue !== undefined
                  ? { onReset: () => commit('Quitar valor de zona', (p) => clearParam(p, wellId, storage, zone.id)), resetLabel: 'usar global' }
                  : !zone && storage in interpretation.params.global
                    ? { onReset: () => commit('Restablecer parámetro', (p) => clearParam(p, wellId, storage)), resetLabel: 'por defecto' }
                    : {})}
              />
            );
          })}
        </div>
      )}

      {custom && (
        <div className="section">
          <custom.component module={module} interpretation={interpretation} zoneId={zoneId} setParam={setLocal} result={result} />
        </div>
      )}
    </div>
  );
}
