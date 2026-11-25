/**
 * Controles compartidos de los gráficos del dock (histograma y crossplot libre; docs/decisiones/0014). Presentación
 * pura con componentes del sistema de diseño: no conocen los stores (los conecta `src/modules/<id>/dock.tsx`).
 */
import type { ReactNode } from 'react';
import type { AxisScaleChoice } from '../core/plots';
import type { Zone } from '../core/well';
import { hiddenCurveReason, showToolLabel, type HiddenCurve } from '../core/toolString';
import { isUserFlagRole } from '../core/userFlags';
import { Button, Callout, Chip, EmptyState, SegmentedControl, Select, formatNumber, type IconName } from '../ui';
import { selectionTitle, type PlotSelection } from './link';
import type { CurveOption } from './data';
import './plots.css';

/**
 * Selector de curva con las medidas y las calculadas agrupadas. Si la curva elegida ya no está entre las opciones, se
 * muestra deshabilitada: «(oculta por la sarta)» si la sarta la oculta (`hidden`), si no «(sin datos)».
 */
export function CurveSelect({ value, options, onChange, label, placeholder, extra, hidden }: { value: string | null; options: readonly CurveOption[]; onChange(v: string): void; label: string; placeholder?: string; extra?: readonly { value: string; label: string }[]; hidden?: HiddenCurve | null }) {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const o of options) {
    if (!groups.has(o.group)) groups.set(o.group, []);
    groups.get(o.group)!.push({ value: o.value, label: o.label });
  }
  const known = value === null || options.some((o) => o.value === value) || extra?.some((o) => o.value === value);
  return (
    <Select
      size="sm"
      block
      aria-label={label}
      value={value ?? ''}
      {...(placeholder !== undefined ? { placeholder } : {})}
      options={[
        ...(extra ?? []),
        ...(known
          ? []
          : [
              {
                value: value!,
                label: hidden
                  ? `${hidden.mnemonic} (oculta por la sarta)`
                  : value?.startsWith('r:') && isUserFlagRole(value.slice(2))
                    ? 'Bandera de usuario (sin datos)'
                    : `${value} (sin datos)`,
                disabled: true,
              },
            ]),
      ]}
      groups={[...groups.entries()].map(([g, opts]) => ({ label: g, options: opts }))}
      onChange={onChange}
    />
  );
}

const SCALE_OPTIONS = [
  { value: 'auto' as const, label: 'Auto', title: 'La del rol de la curva: logarítmica para resistividades y permeabilidad' },
  { value: 'linear' as const, label: 'Lin', title: 'Lineal' },
  { value: 'log' as const, label: 'Log', title: 'Logarítmica' },
];

export function ScaleControl({ value, onChange, label }: { value: AxisScaleChoice; onChange(v: AxisScaleChoice): void; label: string }) {
  return <SegmentedControl size="sm" aria-label={label} value={value} onChange={onChange} options={SCALE_OPTIONS} />;
}

/** Filtro por zonas: «Todas» o una o varias zonas (fichas con el color de cada zona). */
export function ZoneFilterChips({ zones, selected, onChange }: { zones: readonly Zone[]; selected: readonly string[]; onChange(ids: string[]): void }) {
  if (zones.length === 0) return <p className="plot-muted">El pozo no tiene zonas.</p>;
  const all = selected.length === 0;
  return (
    <div className="plot-chips" role="group" aria-label="Filtro por zonas">
      <Chip selected={all} onClick={() => onChange([])} title="Todas las muestras del pozo">
        Todas
      </Chip>
      {zones.map((z) => {
        const on = selected.includes(z.id);
        return (
          <Chip
            key={z.id}
            color={z.color}
            selected={on}
            title={on ? `Quitar la zona ${z.name} del filtro` : `Mostrar la zona ${z.name}${all ? ' sola' : ''}`}
            onClick={() => onChange(on ? selected.filter((id) => id !== z.id) : [...selected, z.id])}
          >
            {z.name}
          </Chip>
        );
      })}
    </div>
  );
}

/** Grupo rotulado de la columna de controles. */
export function ControlGroup({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="plot-group">
      <div className="plot-group__head">
        <span className="plot-group__title">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

/**
 * Aviso de que un elemento arrastrable no cambiaría el resultado porque el módulo que usa su parámetro no alimenta la
 * cadena (fase 7b, 0015), con la acción explícita que lo cambia («Usar Rw manual»).
 */
export function DriverCallout({ title, children, action, onAction }: { title: ReactNode; children?: ReactNode; action: string; onAction(): void }) {
  return (
    <Callout
      tone="warn"
      className="plot-driver"
      title={title}
      actions={
        <Button size="sm" variant="secondary" onClick={onAction}>
          {action}
        </Button>
      }
    >
      {children}
    </Callout>
  );
}

/**
 * Resumen de la selección compartida (fase 8b, 0021; acciones G02, 0088) en el panel aparte de un gráfico: de dónde
 * viene («Lazo en el crossplot», «Tramo 7 800,0–7 850,0 m»), cuántas muestras y tramos marca en el visor, acciones
 * explícitas (guardar como bandera o excluir en Preparación) y «Limpiar» (también Escape).
 */
export function SelectionSummary({
  selection,
  onClear,
  onSaveFlag,
  onExcludePreparation,
  extraNote,
  clearLabel = 'Limpiar',
  className,
  testId = 'plot-selection',
}: {
  selection: PlotSelection;
  onClear(): void;
  onSaveFlag?: () => void;
  onExcludePreparation?: () => void;
  extraNote?: string;
  clearLabel?: string;
  className?: string;
  testId?: string;
}) {
  const runs = selection.runs.length;
  return (
    <div className={className ? `plot-selection ${className}` : 'plot-selection'} data-testid={testId}>
      <span className="plot-selection__title">{selectionTitle(selection, (d) => formatNumber(d, { digits: 1 }))}</span>
      <span className="plot-muted num">
        {formatNumber(selection.count, { digits: 0 })} muestras · {runs} {runs === 1 ? 'tramo' : 'tramos'} en el visor
        {extraNote ?? ''}
      </span>
      <Button size="sm" variant="ghost" icon="x" onClick={onClear} title="Limpiar la selección (Esc)">
        {clearLabel}
      </Button>
      {(onSaveFlag || onExcludePreparation) && (
        <div className="plot-selection__actions">
          {onSaveFlag && (
            <Button
              size="sm"
              variant="secondary"
              icon="bookmark"
              onClick={onSaveFlag}
              data-testid="selection-save-flag"
              title="Guardar las muestras seleccionadas como bandera 0/1 (disponible en Filtros y Armar pistas)"
            >
              Guardar como bandera…
            </Button>
          )}
          {onExcludePreparation && (
            <Button
              size="sm"
              variant="secondary"
              icon="eye-off"
              onClick={onExcludePreparation}
              data-testid="selection-exclude-prep"
              title="Enviar los tramos seleccionados como exclusión QC en Preparación (original intacto)"
            >
              Excluir en Preparación…
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Estado vacío de un gráfico cuya curva elegida oculta la sarta de perfilaje (docs/decisiones/0032): dice cuál y por
 * qué, y ofrece prender la herramienta. No es un error: el dato sigue en el pozo y la elección del gráfico se conserva.
 */
export function HiddenCurveState({ hidden, icon, onShowTool }: { hidden: HiddenCurve; icon: IconName; onShowTool?: (h: HiddenCurve) => void }) {
  return (
    <EmptyState
      size="sm"
      icon={icon}
      title={`${hidden.mnemonic} está oculta`}
      description={`${hiddenCurveReason(hidden)} El dato sigue en el pozo: al volver a mostrarla, el gráfico vuelve como estaba.`}
      actions={
        onShowTool ? (
          <Button size="sm" variant="secondary" icon="eye" onClick={() => onShowTool(hidden)}>
            {showToolLabel(hidden)}
          </Button>
        ) : undefined
      }
    />
  );
}

/** Aviso compacto (controles del gráfico) de una curva elegida que oculta la sarta: el color por tercera curva. */
export function HiddenCurveNote({ hidden, what, onShowTool }: { hidden: HiddenCurve; what: string; onShowTool?: (h: HiddenCurve) => void }) {
  return (
    <Callout
      tone="info"
      className="plot-driver"
      title={`${what}: ${hidden.mnemonic} está oculta`}
      {...(onShowTool
        ? {
            actions: (
              <Button size="sm" variant="secondary" icon="eye" onClick={() => onShowTool(hidden)}>
                {showToolLabel(hidden)}
              </Button>
            ),
          }
        : {})}
    >
      {hiddenCurveReason(hidden)}
    </Callout>
  );
}
