/**
 * PANEL AVISOS — avisos del último cálculo agrupados por paso del flujo y por módulo, con filtro por gravedad, salto
 * al módulo y a la zona, y marcas «visto» por pozo (docs/decisiones/0072). La lógica pura está en `grouping.ts`.
 */
import { useMemo } from 'react';
import type { Diagnostic } from '../../core/engine/graph';
import { moduleWorkspaces } from '../../core/module';
import { setDiagnosticSeen } from '../../core/state/project';
import { WORKSPACES, type WorkspaceId } from '../../core/workspaces';
import type { Zone } from '../../core/well';
import { registry } from '../../modules';
import { Callout, Chip, EmptyState, IconButton, Section, StatusDot, Switch, type Tone } from '../../ui';
import { FLOWS } from '../flow/flow';
import { toFlowModule } from '../flow/useFlow';
import { FREE_MODULE_VIEW } from '../shell/freeModuleView';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { useTrendsUi } from '../trends/store';
import {
  DIAGNOSTIC_LEVELS,
  LEVEL_LABEL,
  LEVEL_LABEL_PLURAL,
  countByLevel,
  countUnseen,
  defaultCollapsed,
  diagnosticFingerprint,
  filterGroups,
  groupDiagnostics,
  type DiagnosticGroup,
  type DiagnosticItem,
  type DiagnosticLevel,
  type GroupingFlow,
  type GroupingModule,
  type ModuleTarget,
} from './grouping';
import { useDiagnosticsUi } from './store';
import './diagnostics.css';

export const LEVEL_TONE: Record<DiagnosticLevel, Tone> = { error: 'error', warning: 'warn', info: 'info' };

const EMPTY: readonly Diagnostic[] = [];

/** Módulos del registro con lo que necesita el agrupado. */
const GROUPING_MODULES: GroupingModule[] = registry.modules.map((m) => ({ ...toFlowModule(m), name: m.name, workspaces: moduleWorkspaces(m) }));

/** Flujos con el espacio de trabajo activo primero (un módulo de los dos espacios se abre en el que se está). */
function flowsFor(workspace: WorkspaceId): GroupingFlow[] {
  return [workspace, ...WORKSPACES.map((w) => w.id).filter((w) => w !== workspace)].map((w) => ({ workspace: w, steps: FLOWS[w] }));
}

/** Avisos del último cálculo, solo si son del pozo activo (al cambiar de pozo, hasta el nuevo cálculo, ninguno). */
function useActiveDiagnostics(): readonly Diagnostic[] {
  const result = useResults((s) => s.result);
  const wellId = useProject((s) => s.project.activeWellId);
  return result && result.wellId === wellId ? result.diagnostics : EMPTY;
}

/** Insignia del panel: avisos no vistos. */
export function useUnseenDiagnosticsBadge(): number | null {
  const diags = useActiveDiagnostics();
  const seen = useProject((s) => selectActiveEntry(s)?.seenDiagnostics);
  return useMemo(() => countUnseen(diags, seen), [diags, seen]) || null;
}

/** Abre el paso del módulo (mismo efecto que elegirlo en el Inspector), cambiando de espacio de trabajo si hace falta. */
function openModule(target: ModuleTarget): void {
  const ui = useUi.getState();
  const workspace = target.workspace && target.workspace !== ui.workspace ? { workspace: target.workspace } : {};
  ui.set({ ...workspace, activeModuleId: target.moduleId, activeStepId: target.step?.id ?? FREE_MODULE_VIEW });
}

/**
 * Clic en la zona (o profundidad) de un aviso: lleva el visor a la zona (o a ±5 m de la profundidad). No abre el
 * módulo (eso lo hace su nombre): con los paneles al costado, abrir el paso taparía esta lista.
 */
function showInViewer(d: Diagnostic, zone: Zone | undefined): void {
  if (zone) useTrendsUi.getState().requestRange(zone.top, zone.base);
  else if (d.depth !== undefined) useTrendsUi.getState().requestRange(d.depth - 5, d.depth + 5);
}

function markSeen(fingerprint: string, seen: boolean, all: readonly Diagnostic[]): void {
  const { project, commit } = useProject.getState();
  const wellId = project.activeWellId;
  if (!wellId) return;
  const existing = all.map(diagnosticFingerprint);
  commit(seen ? 'Marcar aviso como visto' : 'Marcar aviso como no visto', (p) => setDiagnosticSeen(p, wellId, fingerprint, seen, existing));
}

const fmtDepth = (m: number) => `${m.toLocaleString('es-AR', { maximumFractionDigits: 1 })} m`;

function LevelDots({ counts }: { counts: Record<DiagnosticLevel, number> }) {
  return (
    <span className="diag-dots" aria-hidden="true">
      {DIAGNOSTIC_LEVELS.filter((l) => counts[l] > 0).map((l) => (
        <StatusDot key={l} tone={LEVEL_TONE[l]} label={LEVEL_LABEL_PLURAL[l]} nativeTitle={false} />
      ))}
    </span>
  );
}

function groupMeta(g: DiagnosticGroup): string {
  const parts = DIAGNOSTIC_LEVELS.filter((l) => g.counts[l] > 0).map((l) => `${g.counts[l]} ${LEVEL_LABEL_PLURAL[l].toLocaleLowerCase('es')}`);
  const unseen = g.unseen.error + g.unseen.warning + g.unseen.info;
  return `${parts.join(', ')}${unseen < g.total ? ` (${g.total - unseen} vistos)` : ''}`;
}

function Item({ item, zones, all }: { item: DiagnosticItem; zones: readonly Zone[]; all: readonly Diagnostic[] }) {
  const d = item.diagnostic;
  const zone = d.zoneId ? zones.find((z) => z.id === d.zoneId) : undefined;
  return (
    <li className={`diag-item${item.seen ? ' is-seen' : ''}`} data-testid="diag-item" data-seen={item.seen || undefined}>
      <StatusDot tone={LEVEL_TONE[d.level]} label={LEVEL_LABEL[d.level]} />
      <div className="diag-item__body">
        <span className="diag-item__text">{item.text}</span>
        {(zone || d.depth !== undefined) && (
          <span className="diag-item__where" data-testid="diag-zone">
            {zone ? (
              <Chip color={zone.color} onClick={() => showInViewer(d, zone)} title={`Ver la zona ${zone.name} en el visor`}>
                Zona {zone.name}
              </Chip>
            ) : (
              <Chip onClick={() => showInViewer(d, undefined)} title="Ver esta profundidad en el visor">
                {fmtDepth(d.depth!)}
              </Chip>
            )}
          </span>
        )}
      </div>
      <span className="diag-item__seen" data-testid="diag-seen">
        <IconButton
          icon="check"
          size="sm"
          variant="ghost"
          pressed={item.seen}
          label={item.seen ? 'Marcar como no visto' : 'Marcar como visto'}
          onClick={() => markSeen(item.fingerprint, !item.seen, all)}
        />
      </span>
    </li>
  );
}

export function DiagnosticsPanel() {
  const error = useResults((s) => s.error);
  const diags = useActiveDiagnostics();
  const entry = useProject(selectActiveEntry);
  const workspace = useUi((s) => s.workspace);
  const { hiddenLevels, hideSeen, openGroups, toggleLevel, setHideSeen, setGroupOpen } = useDiagnosticsUi();
  const seenList = entry?.seenDiagnostics;
  const zones = entry?.interpretation.zones ?? [];

  const groups = useMemo(() => groupDiagnostics(diags, GROUPING_MODULES, flowsFor(workspace), new Set(seenList)), [diags, workspace, seenList]);
  const collapsed = useMemo(() => defaultCollapsed(groups), [groups]);
  const visible = useMemo(() => filterGroups(groups, { hiddenLevels, hideSeen }), [groups, hiddenLevels, hideSeen]);
  const counts = useMemo(() => countByLevel(diags), [diags]);
  const seenCount = groups.reduce((n, g) => n + g.total - g.unseen.error - g.unseen.warning - g.unseen.info, 0);

  if (diags.length === 0 && !error) return <EmptyState size="sm" icon="check-circle" title="Sin avisos" description="Los módulos no reportaron problemas en el último cálculo." />;

  return (
    <div className="diag-panel">
      <div className="diag-toolbar" role="toolbar" aria-label="Filtrar avisos">
        <div className="diag-toolbar__levels">
          {DIAGNOSTIC_LEVELS.map((l) => (
            <span key={l} data-testid={`diag-filter-${l}`} className={counts[l] === 0 ? 'diag-filter is-empty' : 'diag-filter'}>
              <Chip selected={!hiddenLevels.includes(l)} onClick={() => toggleLevel(l)} title={hiddenLevels.includes(l) ? `Mostrar ${LEVEL_LABEL_PLURAL[l].toLocaleLowerCase('es')}` : `Ocultar ${LEVEL_LABEL_PLURAL[l].toLocaleLowerCase('es')}`}>
                <StatusDot tone={LEVEL_TONE[l]} label={LEVEL_LABEL_PLURAL[l]} nativeTitle={false} />
                <span className="diag-filter__label">{LEVEL_LABEL_PLURAL[l]}</span>
                <span className="diag-filter__count num">{counts[l]}</span>
              </Chip>
            </span>
          ))}
        </div>
        <span className="diag-toolbar__seen" data-testid="diag-hide-seen">
          <Switch checked={hideSeen} onChange={setHideSeen} label={seenCount > 0 ? `Ocultar vistos (${seenCount})` : 'Ocultar vistos'} />
        </span>
      </div>

      {error && (
        <Callout tone="error" title="El cálculo falló" className="diag-error">
          {error}
        </Callout>
      )}

      {visible.length === 0 && diags.length > 0 && (
        <EmptyState
          size="sm"
          icon="filter"
          title="Ningún aviso con este filtro"
          description={hideSeen && seenCount > 0 ? 'Los avisos que quedan ya están vistos. Apagá «Ocultar vistos» para verlos.' : 'Activá alguna gravedad arriba para ver sus avisos.'}
        />
      )}

      {visible.map((g) => {
        const open = openGroups[g.id] ?? !collapsed.has(g.id);
        return (
          <Section
            key={g.id}
            data-testid={`diag-group-${g.id}`}
            className="diag-group"
            collapsible
            open={open}
            onOpenChange={(o) => setGroupOpen(g.id, o)}
            title={g.title}
            meta={
              <span className="diag-group__meta" title={groupMeta(g)}>
                <span className="num" aria-label={groupMeta(g)}>
                  {g.total}
                </span>
                <LevelDots counts={g.unseen} />
              </span>
            }
          >
            {g.modules.map((s) => (
              <div key={s.moduleId ?? '@general'} className="diag-module">
                {s.name && (
                  <div className="diag-module__head">
                    {s.target ? (
                      <button type="button" className="diag-module__name" onClick={() => openModule(s.target!)} title={s.target.step ? `Abrir en el paso ${s.target.step.label}` : 'Abrir el módulo'}>
                        {s.name}
                      </button>
                    ) : (
                      <span className="diag-module__name is-static">{s.name}</span>
                    )}
                    {g.modules.length > 1 || s.items.length > 1 ? <span className="diag-module__count num">{s.items.length}</span> : null}
                  </div>
                )}
                <ul className="diag-list">
                  {s.items.map((it, i) => (
                    <Item key={`${it.fingerprint}#${i}`} item={it} zones={zones} all={diags} />
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        );
      })}
    </div>
  );
}
