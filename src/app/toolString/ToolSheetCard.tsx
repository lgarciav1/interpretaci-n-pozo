/**
 * Ficha de una herramienta de la sarta (docs/decisiones/0033, D7): qué mide, curvas, profundidad de investigación,
 * resolución, montaje, medidas, limitaciones, fuentes y qué módulos habilita. Los valores sin verificar llevan la marca
 * «aproximado», las medidas genéricas del dibujo «esquemático» y lo que la ficha no tiene «sin dato». Sin ecuaciones.
 */
import { useMemo, type ReactNode } from 'react';
import type { Interpretation } from '../../core/interpretation';
import { modulesEnabledBy, type ToolStringEntry } from '../../core/toolString';
import { sheetOf, TOOL_FAMILY_LABEL, type ToolDef } from '../../core/tools';
import { INVESTIGATION_REFERENCE_LABEL, investigationReference, TOOL_MOUNTING_LABEL, type SheetQuantity, type ToolSheet } from '../../core/toolSheets';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import { Badge, Button, curveStyle, formatNumber, IconButton, useResolvedTheme } from '../../ui';
import { AVAILABILITY_LABEL, type ToolStringView } from './select';
import { CM_PER_IN, quantityIn, type ToolLayout } from './scene';

const f = (v: number) => formatNumber(v, { significant: 3, grouping: false });

/** «4 in (10 cm)», «25–98 in», «2,6 m». */
export function quantityText(q: SheetQuantity | undefined): string | null {
  if (!q || (q.typical === undefined && q.min === undefined && q.max === undefined)) return null;
  const isIn = q.unit === 'in';
  const cm = (v: number | undefined) => (isIn && v !== undefined ? (quantityIn({ ...q, typical: v }, 'typical', 'cm') ?? 0) : 0);
  const main = q.typical !== undefined ? `${f(q.typical)} ${q.unit}` : '';
  const range =
    q.min !== undefined && q.max !== undefined
      ? `${f(q.min)}–${f(q.max)} ${q.unit}`
      : q.max !== undefined
        ? `hasta ${f(q.max)} ${q.unit}`
        : q.min !== undefined
          ? `desde ${f(q.min)} ${q.unit}`
          : '';
  const metric = isIn && q.typical !== undefined ? ` (${f(cm(q.typical))} cm)` : '';
  if (main && range) return `${main}${metric} · rango ${range}`;
  return main ? `${main}${metric}` : range;
}

function Mark({ kind }: { kind: 'approx' | 'schematic' }) {
  return kind === 'approx' ? (
    <Badge tone="warn" title="Valor de una sola fuente o de memoria en la investigación: no verificado">
      aproximado
    </Badge>
  ) : (
    <Badge tone="neutral" title="La ficha no tiene este valor: el dibujo usa una medida genérica">
      esquemático
    </Badge>
  );
}

function Row({ label, children, mark, note }: { label: string; children: ReactNode; mark?: 'approx' | 'schematic' | null; note?: string | undefined }) {
  return (
    <div className="ts-sheet__row">
      <dt>{label}</dt>
      <dd>
        {children}
        {mark && <Mark kind={mark} />}
        {note && <span className="ts-sheet__note">{note}</span>}
      </dd>
    </div>
  );
}

const unverified = (s: ToolSheet, k: keyof ToolSheet) => !!s.unverified?.includes(k);
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export interface ToolSheetCardProps {
  tool: ToolDef;
  entry: ToolStringEntry | undefined;
  layout: ToolLayout | undefined;
  view: ToolStringView;
  well: Well;
  interpretation: Interpretation;
  onClose(): void;
  onFocus?: () => void;
}

export function ToolSheetCard({ tool, entry, layout, view, well, interpretation, onClose, onFocus }: ToolSheetCardProps) {
  const theme = useResolvedTheme();
  const sheet = sheetOf(tool);
  const { toolString, disabled, sources } = interpretation;
  const enabled = useMemo(() => modulesEnabledBy(registry, well.curves, toolString, tool.id, { disabled, sources }), [well.curves, toolString, tool.id, disabled, sources]);
  const planning = view.resolved.mode === 'planning';
  const mnemonic = new Map(well.curves.map((c) => [c.id, c]));
  const curveOf = (role: string) => entry?.curveIds.map((id) => mnemonic.get(id)).find((c) => c?.role === role);

  const state = !entry ? null : !entry.on ? { tone: 'neutral' as const, text: 'Apagada' } : !entry.hasData ? { tone: 'info' as const, text: planning ? 'Planificada · sin datos en este pozo' : 'Sin datos' } : { tone: 'ok' as const, text: 'Prendida' };
  const doiApprox = unverified(sheet, 'investigation') || unverified(sheet, 'investigationByRole');
  // Referencia de la medida (0033 D9 a): la ficha la declara; la pared si no dice nada.
  const hasDoi = sheet.investigation?.typical !== undefined || Object.keys(sheet.investigationByRole ?? {}).length > 0;
  const refText = hasDoi ? `Medida ${INVESTIGATION_REFERENCE_LABEL[investigationReference(sheet)]}.` : undefined;
  const doiNote = [refText, quantityText(sheet.investigation) ? sheet.investigation?.note : undefined].filter(Boolean).join(' ') || undefined;
  const host = layout?.hostId ? registry.tools.get(layout.hostId)?.name : undefined;
  const empty = Object.keys(sheet).length === 0;

  return (
    <aside className="ts-sheet" aria-label={`Ficha de ${tool.name}`}>
      <header className="ts-sheet__head">
        <div className="ts-sheet__titles">
          <span className="ts-sheet__overline">{`${TOOL_FAMILY_LABEL[tool.family]} · ${tool.short}`}</span>
          <h3 className="ts-sheet__title">{tool.name}</h3>
          {state && (
            <span className="ts-sheet__chips">
              <Badge tone={state.tone}>{state.text}</Badge>
              {host && <Badge tone="neutral">{tool.id === 'sp' ? `Electrodo sobre ${host}` : `Brazo de ${host}`}</Badge>}
            </span>
          )}
        </div>
        <IconButton icon="x" size="sm" label="Cerrar la ficha" onClick={onClose} />
      </header>
      <div className="ts-sheet__body">
        <p className="ts-sheet__lead">{sheet.measures ?? tool.description}</p>
        {sheet.principle && <p className="ts-sheet__text">{sheet.principle}</p>}
        {empty && <p className="ts-sheet__muted">Sin datos de ficha todavía: el dibujo usa medidas esquemáticas.</p>}

        <h4 className="ts-sheet__h">Curvas que entrega</h4>
        <ul className="ts-sheet__curves">
          {tool.roles.map((role) => {
            const c = curveOf(role);
            const q = sheet.investigationByRole?.[role];
            const doi = q?.typical !== undefined ? `${f(q.typical)} ${q.unit}` : null;
            const label = registry.roles.get(role)?.label ?? role;
            return (
              <li key={role}>
                <span className="ts-sheet__swatch" style={{ background: curveStyle(role, theme, registry.roles).color }} aria-hidden="true" />
                <span className="ts-sheet__role">{role}</span>
                <span className="ts-sheet__role-label">{label}</span>
                <span className={`ts-sheet__doi num${doi ? '' : ' is-none'}`} title="Profundidad de investigación de esta curva">
                  {doi ?? '—'}
                </span>
                <span className={`ts-sheet__has${c ? '' : ' is-missing'}`}>{c ? c.mnemonic : 'no está'}</span>
              </li>
            );
          })}
        </ul>

        <dl className="ts-sheet__facts">
          <Row
            label="Prof. de investigación"
            mark={sheet.investigation?.typical !== undefined && doiApprox ? 'approx' : null}
            note={doiNote}
          >
            {quantityText(sheet.investigation) ?? sheet.investigation?.note ?? <span className="ts-sheet__muted">sin dato</span>}
          </Row>
          <Row label="Resolución vertical" mark={sheet.verticalResolution && unverified(sheet, 'verticalResolution') ? 'approx' : null} note={sheet.verticalResolution?.note}>
            {quantityText(sheet.verticalResolution) ?? <span className="ts-sheet__muted">sin dato</span>}
          </Row>
          <Row label="Montaje" mark={sheet.mounting && unverified(sheet, 'mounting') ? 'approx' : null}>
            {sheet.mounting ? TOOL_MOUNTING_LABEL[sheet.mounting] : <span className="ts-sheet__muted">sin dato</span>}
          </Row>
          <Row label="Largo" mark={sheet.length ? (unverified(sheet, 'length') ? 'approx' : null) : layout && !layout.hostId ? 'schematic' : null} note={sheet.length?.note}>
            {sheet.length ? quantityText(sheet.length) : layout && !layout.hostId ? `${f(layout.lengthM)} m en el dibujo` : <span className="ts-sheet__muted">sin dato</span>}
          </Row>
          <Row
            label="Diámetro"
            mark={sheet.diameter ? (unverified(sheet, 'diameter') ? 'approx' : null) : layout && !layout.hostId ? 'schematic' : null}
            note={sheet.diameter?.note}
          >
            {sheet.diameter ? quantityText(sheet.diameter) : layout && !layout.hostId ? `${f(layout.diameterIn)} in (${f(layout.diameterIn * CM_PER_IN)} cm) en el dibujo` : <span className="ts-sheet__muted">sin dato</span>}
          </Row>
        </dl>

        {!!sheet.limitations?.length && (
          <>
            <h4 className="ts-sheet__h">Limitaciones</h4>
            <ul className="ts-sheet__list">
              {sheet.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </>
        )}

        <h4 className="ts-sheet__h">Módulos que habilita</h4>
        {enabled.length ? (
          <ul className="ts-sheet__modules">
            {enabled.map((id) => {
              const m = registry.get(id);
              const { availability, reason } = view.status(id);
              const st = availability?.status ?? 'available';
              return (
                <li key={id} title={reason || undefined}>
                  <span className="ts-sheet__module">{m?.name ?? id}</span>
                  <Badge tone={st === 'available' ? 'ok' : st === 'needs-data' ? 'info' : 'neutral'}>{AVAILABILITY_LABEL[st]}</Badge>
                  {reason && <span className="ts-sheet__reason">{reason}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ts-sheet__muted">
            {entry && !entry.on
              ? 'Ningún módulo depende solo de esta herramienta: lo que calcula con ella también sale de otras de la sarta.'
              : 'Ningún módulo depende solo de esta herramienta en esta sarta (otra entrega los mismos datos, o ningún módulo los usa).'}
          </p>
        )}

        {!!sheet.sources?.length && (
          <>
            <h4 className="ts-sheet__h">Fuentes</h4>
            <ul className="ts-sheet__sources">
              {sheet.sources.map((s) => (
                <li key={s}>
                  <a href={s} target="_blank" rel="noreferrer noopener" title={s}>
                    {hostOf(s)}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {onFocus && layout && (
        <footer className="ts-sheet__foot">
          <Button size="sm" variant="ghost" icon="zoom-in" onClick={onFocus}>
            Centrar en la vista
          </Button>
        </footer>
      )}
    </aside>
  );
}
