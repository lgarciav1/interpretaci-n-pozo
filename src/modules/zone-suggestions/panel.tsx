/**
 * Panel de «Zonas sugeridas» (función L): lista de límites propuestos ordenados por fuerza, con el salto de GR, la
 * fuerza relativa y el aviso si ya hay un tope existente a ≤ 2 m; filtro por fuerza mínima; aceptar uno, aceptar
 * todos los visibles, descartar y editar la profundidad antes de aceptar. Aceptar es UNA receta del proyecto (se
 * deshace con Ctrl+Z). Mientras el panel está abierto, las propuestas se dibujan sobre el visor (overlay.ts).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTrendsUi } from '../../app/trends/store';
import { selectActiveEntry, useProject } from '../../app/store/project';
import type { TableValue } from '../../core/module';
import { makeId } from '../../core/state/project';
import type { Zone } from '../../core/well';
import { Badge, Button, EmptyState, IconButton, NumberField, Slider, Switch, formatNumber, toast, zoneColor } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { acceptBoundaries, suggestionsFrom, visibleSuggestions, type NewZoneFactory, type ShownSuggestion } from './model';
import { ZONE_SUGGESTIONS_TABLE } from './index';
import { clearLines, dismissSuggestions, editSuggestion, getSuggestionUi, publishLines, restoreDismissed, selectSuggestion, subscribeSuggestionUi, switchWell } from './store';
import './panel.css';

const FACTORY: NewZoneFactory = { id: () => makeId('zona'), color: (zones: readonly Zone[]) => zoneColor(zones.length) };

const fmt = (v: number, digits = 1) => formatNumber(v, { digits });
const fmtM = (v: number) => `${fmt(v, 2)} m`;
const signed = (v: number, digits = 0) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v), digits)}` : '—');

/** Texto corto del salto de GR (y de las curvas sumadas), para tooltip y lector de pantalla. */
function jumpText(s: ShownSuggestion): string {
  const parts = [`GR ${fmt(s.valueAbove, 0)} → ${fmt(s.valueBelow, 0)} gAPI (${signed(s.contrast)})`];
  if (Number.isFinite(s.contrastRhob)) parts.push(`densidad ${signed(s.contrastRhob, 2)} g/cm³`);
  if (Number.isFinite(s.contrastLogRt)) parts.push(`Rt ×${fmt(10 ** s.contrastLogRt, 1)}`);
  return parts.join(' · ');
}

const goTo = (d: number) => useTrendsUi.getState().requestRange(d - 15, d + 15);

function ZoneSuggestionsPanel({ module, result }: ModulePanelProps) {
  const entry = useProject(selectActiveEntry);
  const commit = useProject((s) => s.commit);
  const ui = useSyncExternalStore(subscribeSuggestionUi, getSuggestionUi);
  const [minStrength, setMinStrength] = useState(0);
  const [hideNear, setHideNear] = useState(false);

  const wellId = entry?.well.id ?? null;
  const zones = entry?.interpretation.zones ?? [];
  const rows = (result?.outputs.find((o) => o.moduleId === module.id && o.port === ZONE_SUGGESTIONS_TABLE)?.value as TableValue | undefined)?.rows;
  const all = useMemo(() => suggestionsFrom(rows ?? []), [rows]);
  const sameWell = ui.wellId === wellId;
  const dismissed = sameWell ? ui.dismissed : new Set<string>();
  const edits = sameWell ? ui.edits : new Map<string, number>();
  const shown = useMemo(() => visibleSuggestions(all, zones, { minStrength, dismissed, edits, hideNear }), [all, zones, minStrength, dismissed, edits, hideNear]);
  const maxStrength = useMemo(() => all.reduce((m, s) => (Number.isFinite(s.strengthRel) ? Math.max(m, s.strengthRel) : m), 0), [all]);
  const nearCount = shown.filter((s) => s.near).length;
  const acceptable = shown.filter((s) => !s.near);

  // Las propuestas visibles se dibujan sobre el visor mientras el panel está abierto.
  useEffect(() => {
    switchWell(wellId);
  }, [wellId]);
  useEffect(() => {
    if (!wellId) return;
    publishLines(
      wellId,
      shown.map((s) => ({ key: s.key, depth: s.effectiveDepth, rank: s.rank, strengthRel: s.strengthRel, label: jumpText(s), near: s.near !== null })),
    );
  }, [wellId, shown]);
  useEffect(() => clearLines, []);

  if (!result || !entry) return null;

  const accept = (list: readonly ShownSuggestion[]) => {
    if (!list.length) return;
    const depths = list.map((s) => s.effectiveDepth);
    const label = list.length === 1 ? `Aceptar límite sugerido a ${fmtM(depths[0]!)}` : `Aceptar ${list.length} límites sugeridos`;
    let outcome: ReturnType<typeof acceptBoundaries> | null = null;
    commit(label, (p) => {
      outcome = acceptBoundaries(p, entry.well.id, depths, FACTORY);
      return outcome.project;
    });
    const r = outcome as ReturnType<typeof acceptBoundaries> | null;
    if (!r) return;
    if (r.accepted.length) {
      const done = new Set(r.accepted);
      dismissSuggestions(list.filter((s) => done.has(s.effectiveDepth)).map((s) => s.key));
    }
    if (r.skipped.length && !r.accepted.length) {
      toast({ tone: 'warn', title: 'No se aceptó el límite', description: r.skipped[0]!.reason });
    } else if (r.accepted.length) {
      const names = r.created.map((z) => z.name).join(', ');
      toast({
        tone: 'ok',
        title: r.accepted.length === 1 ? 'Límite aceptado' : `${r.accepted.length} límites aceptados`,
        description: `${names ? `Zonas nuevas: ${names}. ` : ''}${r.skipped.length ? `${r.skipped.length} no se aceptaron (pegados a un tope existente). ` : ''}Ctrl+Z para deshacer.`,
      });
    }
  };

  if (!all.length) {
    return (
      <EmptyState
        size="sm"
        icon="layers"
        title="Sin límites sugeridos"
        description="Con estos parámetros no aparece ningún cambio de nivel claro. Bajá la «Penalización por límite» o el «Salto mínimo de GR», o sumá la densidad y la resistividad."
      />
    );
  }

  return (
    <div className="zsg">
      <div className="zsg-filters">
        <div className="zsg-filter">
          <span className="zsg-filter__label" id="zsg-min">
            Fuerza mínima
          </span>
          <Slider aria-labelledby="zsg-min" value={minStrength} min={0} max={Math.max(0.05, Math.ceil(maxStrength * 20) / 20)} step={0.01} onChange={setMinStrength} formatValue={(v) => `${Math.round(v * 100)} %`} />
          <span className="zsg-filter__value num">{Math.round(minStrength * 100)} %</span>
        </div>
        {zones.length > 0 && <Switch checked={hideNear} onChange={setHideNear} label="Ocultar las que ya tienen un tope cerca" />}
      </div>

      <div className="zsg-bar">
        <span className="zsg-count">
          <strong className="num">{shown.length}</strong> de {all.length} límites
          {nearCount > 0 && !hideNear && <span className="zsg-count__near"> · {nearCount} cerca de un tope</span>}
        </span>
        <Button size="sm" variant="primary" icon="check" disabled={!acceptable.length} onClick={() => accept(acceptable)} title="Acepta de una vez los límites visibles que no tienen un tope existente cerca (un solo Ctrl+Z los deshace)">
          Aceptar visibles ({acceptable.length})
        </Button>
      </div>

      {shown.length === 0 ? (
        <p className="zsg-note">Ningún límite con este filtro.</p>
      ) : (
        <ol className="zsg-list">
          {shown.map((s) => (
            <SuggestionRow
              key={s.key}
              s={s}
              max={maxStrength}
              selected={sameWell && ui.selectedKey === s.key}
              onAccept={() => accept([s])}
              onDismiss={() => dismissSuggestions([s.key])}
            />
          ))}
        </ol>
      )}

      <div className="zsg-foot">
        <p className="zsg-note">Clic en un límite para verlo en el visor. También se puede arrastrar la línea discontinua para ajustar su profundidad antes de aceptarlo.</p>
        {dismissed.size > 0 && (
          <Button size="sm" variant="ghost" icon="undo" onClick={restoreDismissed}>
            Mostrar descartados ({dismissed.size})
          </Button>
        )}
      </div>
    </div>
  );
}

function SuggestionRow({ s, max, selected, onAccept, onDismiss }: { s: ShownSuggestion; max: number; selected: boolean; onAccept(): void; onDismiss(): void }) {
  const pct = max > 0 && Number.isFinite(s.strengthRel) ? Math.max(4, Math.min(100, (s.strengthRel / max) * 100)) : 0;
  const up = s.contrast > 0;
  const pick = () => {
    selectSuggestion(s.key);
    goTo(s.effectiveDepth);
  };
  return (
    <li className={`zsg-row${selected ? ' is-selected' : ''}${s.near ? ' is-near' : ''}`}>
      <button type="button" className="zsg-row__main" onClick={pick} aria-label={`Límite ${s.rank} a ${fmtM(s.effectiveDepth)}: ${jumpText(s)}. Ver en el visor.`}>
        <span className="zsg-rank num">L{s.rank}</span>
        <span className="zsg-row__body">
          <span className="zsg-jump">
            <span className="num">{fmt(s.valueAbove, 0)}</span>
            <span className={`zsg-jump__arrow${up ? ' is-up' : ' is-down'}`} aria-hidden="true">
              →
            </span>
            <span className="num">{fmt(s.valueBelow, 0)}</span>
            <span className="zsg-unit">gAPI</span>
            <span className={`zsg-delta num${up ? ' is-up' : ' is-down'}`}>{signed(s.contrast)}</span>
          </span>
          <span className="zsg-strength" title={`Fuerza relativa: ${Math.round(s.strengthRel * 100)} % del rango típico de la curva`}>
            <span className="zsg-strength__fill" style={{ width: `${pct}%` }} />
          </span>
          {(Number.isFinite(s.contrastRhob) || Number.isFinite(s.contrastLogRt)) && (
            <span className="zsg-extra">
              {Number.isFinite(s.contrastRhob) && <span>ρ {signed(s.contrastRhob, 2)} g/cm³</span>}
              {Number.isFinite(s.contrastLogRt) && <span>Rt ×{fmt(10 ** s.contrastLogRt, 1)}</span>}
            </span>
          )}
          {s.near && (
            <Badge tone="warn" variant="soft" className="zsg-near" icon="warning">
              {s.near.edge === 'top' ? 'Tope' : 'Base'} de {s.near.zoneName} a {fmt(s.near.distance)} m
            </Badge>
          )}
        </span>
      </button>
      <div className="zsg-row__actions">
        <NumberField
          size="sm"
          width={84}
          aria-label="Profundidad del límite"
          value={s.effectiveDepth}
          min={s.depth - 50}
          max={s.depth + 50}
          step={0.01}
          unit="m"
          format={(v) => fmt(v, 2)}
          onChange={(v) => editSuggestion(s.key, Math.abs(v - s.depth) < 1e-6 ? null : v)}
        />
        {s.edited && <IconButton size="sm" icon="refresh" label={`Volver a ${fmtM(s.depth)}`} onClick={() => editSuggestion(s.key, null)} />}
        <IconButton size="sm" icon="x" label="Descartar" onClick={onDismiss} />
        <Button size="sm" variant={selected ? 'primary' : 'secondary'} icon="check" onClick={onAccept}>
          Aceptar
        </Button>
      </div>
    </li>
  );
}

export const panel: ModulePanel = { moduleId: 'zone-suggestions', component: ZoneSuggestionsPanel };
