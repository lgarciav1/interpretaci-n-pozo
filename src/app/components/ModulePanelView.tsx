/**
 * Panel del módulo activo: estado, método elegido por puerto, "calcular para comparar", zona en edición y
 * controles generados desde el esquema (o el panel a medida del módulo).
 */
import { useMemo } from 'react';
import { portOf, type AnyModule } from '../../core/module';
import { paramScope, paramStorageKey, type ParamValue } from '../../core/params';
import { clearParam, setCompare, setParam, setSource } from '../../core/state/project';
import { setToolOn } from '../../core/state/toolString';
import { offToolsFor } from '../../core/toolString';
import { registry } from '../../modules';
import { Badge, Button, Callout, Field, IconButton, SegmentedControl, Section, Select, StatusDot, Switch, Tooltip, formatNumber } from '../../ui';
import { openEquations } from '../ecuaciones/open';
import { collectPanels } from '../modulePanels';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { useToolStringView } from '../toolString/select';
import { ParamControl } from './ParamControl';

const panels = collectPanels(registry);
const GLOBAL = '@global';

type SourceLike = { kind: string; curveId?: string; moduleId?: string };
const keyOf = (s: SourceLike) => (s.kind === 'curve' ? `curve:${s.curveId}` : `module:${s.moduleId}`);

export function ModulePanelView({ module }: { module: AnyModule }) {
  const entry = useProject(selectActiveEntry);
  const commit = useProject((s) => s.commit);
  const result = useResults((s) => s.result);
  const zoneId = useUi((s) => s.editingZoneId);
  const setUi = useUi((s) => s.set);
  const custom = panels.get(module.id);
  const toolString = useToolStringView();

  const curvePorts = useMemo(() => Object.values(module.outputs).map(portOf), [module]);
  if (!entry) return null;
  const { interpretation, well } = entry;
  const wellId = well.id;
  const zone = zoneId ? (interpretation.zones.find((z) => z.id === zoneId) ?? null) : null;

  const status = result?.nodes.find((n) => n.moduleId === module.id);
  const setLocal = (key: string, value: ParamValue) => {
    const spec = module.params[key]!;
    const storage = paramStorageKey(module.id, key, spec);
    commit(`Cambiar ${spec.label}`, (p) => setParam(p, wellId, storage, value, zone && paramScope(spec) === 'zone' ? zone.id : null));
  };
  const alternatives = curvePorts.filter((port) => (result?.candidates[port]?.length ?? 0) > 1);
  const comparing = interpretation.compare.includes(module.id);
  const hasZoned = Object.values(module.params).some((s) => paramScope(s) === 'zone');

  const statusView = status ? (
    status.status === 'ok' ? (
      <>
        <StatusDot tone="ok" label="Calculado" />
        {status.computed ? `Calculado en ${status.ms < 0.1 ? 'menos de 0,1' : formatNumber(status.ms, { digits: 1 })} ms` : 'Sin cambios (caché)'}
      </>
    ) : (
      <>
        <StatusDot tone={status.status === 'missing-input' ? 'warn' : 'error'} label={status.status} />
        {status.status === 'missing-input' ? 'Faltan curvas de entrada' : status.status === 'error' ? 'Error en el cálculo' : 'No se pudo calcular'}
      </>
    )
  ) : (
    <>
      <StatusDot tone="neutral" label="No corre" />
      No corre
    </>
  );

  // Sarta (docs/decisiones/0032): por qué el módulo no está disponible y, si alcanza con prender herramientas, el botón.
  const sarta = toolString?.status(module.id);
  const sartaAv = sarta?.availability;
  const toTurnOn = sartaAv && toolString && sartaAv.status === 'unavailable' ? offToolsFor(sartaAv, toolString.resolved) : [];
  const sartaNotice =
    sartaAv && sartaAv.status !== 'available' && sartaAv.status !== 'disabled' ? (
      <Callout
        tone="neutral"
        icon="info"
        title={sartaAv.status === 'needs-data' ? 'Disponible con la sarta planificada' : 'No disponible con la sarta actual'}
        {...(toTurnOn.length
          ? {
              actions: toTurnOn.map((t) => (
                <Button key={t.id} size="sm" icon="check" onClick={() => commit(`Prender ${t.name}`, (p) => setToolOn(p, wellId, t.id, true))}>
                  Prender {t.name}
                </Button>
              )),
            }
          : {})}
      >
        <span data-testid="module-availability">{sarta.reason}</span>
      </Callout>
    ) : null;

  return (
    <div className="module-panel">
      {sartaNotice}
      <header className="module-panel__head">
        <div className="module-panel__titles">
          <h3 className="module-panel__name">{module.name}</h3>
          {module.description && <p className="module-panel__desc">{module.description}</p>}
          <div className="module-panel__status num" data-testid="module-status">
            {statusView}
          </div>
        </div>
        {alternatives.length > 0 && (
          <Tooltip content="Calcula este método aunque no sea el elegido, para compararlo con el que alimenta la cadena.">
            <span>
              <Switch checked={comparing} onChange={(on) => commit(on ? `Comparar métodos de ${module.name}` : `Dejar de comparar ${module.name}`, (p) => setCompare(p, wellId, module.id, on))} label="Comparar" />
            </span>
          </Tooltip>
        )}
        <IconButton icon="sigma" size="sm" label={`Ver las ecuaciones de ${module.name}`} onClick={() => openEquations(module.id)} data-testid="module-equations" />
      </header>

      {alternatives.length > 0 && (
        <Section title="Método">
          <div className="module-panel__methods">
            {alternatives.map((port) => {
              const candidates = result?.candidates[port] ?? [];
              const chosen = result?.sources[port];
              return (
                <Field key={port} label={<span className="mono">{port}</span>} tooltip={`Qué fuente alimenta ${port} aguas abajo.`}>
                  <Select
                    block
                    value={chosen ? keyOf(chosen) : ''}
                    onChange={(v) => {
                      const [kind, id] = v.split(/:(.*)/) as [string, string];
                      commit(`Elegir fuente de ${port}`, (p) => setSource(p, wellId, port, kind === 'curve' ? { kind: 'curve', curveId: id } : { kind: 'module', moduleId: id }));
                    }}
                    options={candidates.map((c) => ({
                      value: keyOf(c),
                      label: c.kind === 'curve' ? `Curva medida ${c.curveId}` : (registry.get(c.moduleId)?.name ?? c.moduleId),
                    }))}
                  />
                </Field>
              );
            })}
          </div>
        </Section>
      )}

      {Object.keys(module.params).length > 0 && custom?.mode !== 'replace' && (
        <Section title="Parámetros" meta={zone ? `zona ${zone.name}` : 'todo el pozo'}>
          {hasZoned && interpretation.zones.length > 0 && (
            <div className="module-panel__zones">
              {interpretation.zones.length <= 6 ? (
                <SegmentedControl
                  aria-label="Editar parámetros de"
                  size="sm"
                  block
                  wrap
                  value={zoneId ?? GLOBAL}
                  onChange={(v) => setUi({ editingZoneId: v === GLOBAL ? null : v })}
                  options={[{ value: GLOBAL, label: 'Global' }, ...interpretation.zones.map((z) => ({ value: z.id, label: z.name }))]}
                />
              ) : (
                <Select
                  aria-label="Editar parámetros de"
                  block
                  size="sm"
                  value={zoneId ?? GLOBAL}
                  onChange={(v) => setUi({ editingZoneId: v === GLOBAL ? null : v })}
                  options={[{ value: GLOBAL, label: 'Global (todo el pozo)' }, ...interpretation.zones.map((z) => ({ value: z.id, label: `Zona ${z.name}` }))]}
                />
              )}
            </div>
          )}
          <div className="module-panel__params">
            {Object.entries(module.params).map(([key, spec]) => {
              const storage = paramStorageKey(module.id, key, spec);
              const zoned = paramScope(spec) === 'zone';
              const globalValue = interpretation.params.global[storage] ?? spec.default;
              const zoneValue = zone && zoned ? interpretation.params.zones[zone.id]?.[storage] : undefined;
              const editable = !zone || zoned;
              const sharedWith = spec.shared ? (registry.paramSpecs.get(storage)?.moduleIds ?? []).map((id) => registry.get(id)?.name ?? id) : undefined;
              return (
                <ParamControl
                  key={key}
                  name={storage}
                  spec={spec}
                  value={zoneValue ?? globalValue}
                  overridden={zoneValue !== undefined}
                  editable={editable}
                  onChange={(v) => setLocal(key, v)}
                  {...(sharedWith ? { sharedWith } : {})}
                  {...(zone && zoneValue !== undefined
                    ? { onReset: () => commit(`Usar ${spec.label} global en ${zone.name}`, (p) => clearParam(p, wellId, storage, zone.id)), resetLabel: 'usar global' }
                    : !zone && storage in interpretation.params.global
                      ? { onReset: () => commit(`Restablecer ${spec.label}`, (p) => clearParam(p, wellId, storage)), resetLabel: 'por defecto' }
                      : {})}
                />
              );
            })}
          </div>
        </Section>
      )}

      {custom && (
        <Section title="Herramientas">
          <custom.component module={module} interpretation={interpretation} zoneId={zoneId} setParam={setLocal} result={result} />
        </Section>
      )}

      {comparing && (
        <div className="module-panel__note">
          <Badge tone="info">comparando</Badge> Sus salidas se calculan pero no alimentan la cadena.
        </div>
      )}
    </div>
  );
}
