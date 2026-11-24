/**
 * Controles compartidos de filtros genéricos por curva o bandera para los gráficos del dock (histograma, crossplot y
 * distribuciones por zona). Presentación pura: no conoce los stores; entrega la lista actualizada vía `onChange`.
 */
import { useMemo } from 'react';
import type { PlotFilterOp, PlotFilterRule } from '../core/plots';
import { Button, Checkbox, Chip, IconButton, NumberField, SegmentedControl, Select, formatNumber } from '../ui';
import { ControlGroup, CurveSelect } from './controls';
import {
  availableFilterPresets,
  defaultFilterCurve,
  defaultFilterRule,
  FILTER_OP_LABELS,
  filterCurveOptions,
  newFilterId,
  type EvaluatedPlotFilters,
  type FilterPreset,
} from './filters';
import type { PlotCurve } from './data';
import type { SeriesContext } from './trend/series';
import './plots.css';

export interface PlotFilterControlsProps {
  ctx: SeriesContext;
  rules: readonly PlotFilterRule[] | undefined;
  evaluated: EvaluatedPlotFilters;
  onChange(next: PlotFilterRule[] | undefined, label: string): void;
  /** Mostrar los atajos de un clic (Pay neto, Reservorio neto, Sin derrumbe). Por defecto true. */
  showPresets?: boolean;
  /** Título del grupo de controles. Por defecto «Filtros». */
  title?: string;
}

const OP_OPTIONS: readonly { value: PlotFilterOp; label: string }[] = [
  { value: 'le', label: FILTER_OP_LABELS.le },
  { value: 'lt', label: FILTER_OP_LABELS.lt },
  { value: 'ge', label: FILTER_OP_LABELS.ge },
  { value: 'gt', label: FILTER_OP_LABELS.gt },
  { value: 'between', label: FILTER_OP_LABELS.between },
  { value: 'eq', label: FILTER_OP_LABELS.eq },
  { value: 'neq', label: FILTER_OP_LABELS.neq },
];

const FLAG_OPTIONS = [
  { value: 'yes' as const, label: 'Sí (= 1)', title: 'Incluir solo muestras donde la bandera es 1' },
  { value: 'no' as const, label: 'No (= 0)', title: 'Incluir solo muestras donde la bandera es 0' },
];

const fmtInput = (v: number) => formatNumber(v, { significant: 4 });

/** Escala orientativa (para las flechas ↑/↓ de NumberField; `clampToRange` va en false). */
function fieldRange(curve: PlotCurve | null, value: number): { min: number; max: number; step: number } {
  if (curve?.typical && curve.typical.max > curve.typical.min) {
    const span = curve.typical.max - curve.typical.min;
    const raw = span / 100;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(1e-6, Math.round(raw / mag) * mag);
    return { min: curve.typical.min, max: curve.typical.max, step };
  }
  const mag = Math.abs(value) > 0 ? 10 ** Math.floor(Math.log10(Math.abs(value)) - 1) : 0.01;
  return { min: -1e9, max: 1e9, step: Math.max(1e-4, mag) };
}

function isPresetActive(rules: readonly PlotFilterRule[], preset: FilterPreset): PlotFilterRule | undefined {
  return rules.find((r) => r.enabled && r.curve === preset.curve && r.op === preset.op && r.value === preset.value);
}

export function PlotFilterControls({ ctx, rules, evaluated, onChange, showPresets = true, title = 'Filtros' }: PlotFilterControlsProps) {
  const list = rules ?? [];
  const options = useMemo(() => filterCurveOptions(ctx), [ctx]);
  const presets = useMemo(() => (showPresets ? availableFilterPresets(ctx) : []), [ctx, showPresets]);

  const emit = (next: PlotFilterRule[], label: string) => onChange(next.length ? next : undefined, label);

  const togglePreset = (p: FilterPreset) => {
    const existing = isPresetActive(list, p);
    if (existing) {
      emit(
        list.filter((r) => r.id !== existing.id),
        `Quitar filtro ${p.label}`,
      );
      return;
    }
    const id = newFilterId(list);
    emit([...list, { id, curve: p.curve, op: p.op, value: p.value, enabled: true }], `Filtrar por ${p.label}`);
  };

  const addRule = () => {
    const curveKey = defaultFilterCurve(ctx, list);
    if (!curveKey) return;
    const rule = defaultFilterRule(ctx, curveKey, newFilterId(list));
    emit([...list, rule], 'Agregar filtro al gráfico');
  };

  const updateRule = (id: string, nextRule: PlotFilterRule, label: string) => {
    emit(
      list.map((r) => (r.id === id ? nextRule : r)),
      label,
    );
  };

  const removeRule = (id: string) => {
    emit(
      list.filter((r) => r.id !== id),
      'Quitar filtro del gráfico',
    );
  };

  const pct = evaluated.baseTotal > 0 ? `${formatNumber((evaluated.passed / evaluated.baseTotal) * 100, { digits: 0 })} %` : '0 %';

  return (
    <ControlGroup
      title={title}
      aside={
        list.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined, 'Limpiar filtros del gráfico')}>
            Limpiar
          </Button>
        ) : undefined
      }
    >
      {presets.length > 0 && (
        <div className="plot-chips" role="group" aria-label="Atajos de filtro">
          {presets.map((p) => {
            const on = !!isPresetActive(list, p);
            return (
              <Chip key={p.id} selected={on} title={p.title} onClick={() => togglePreset(p)}>
                {p.label}
              </Chip>
            );
          })}
        </div>
      )}

      {evaluated.rules.length > 0 && (
        <div className="plot-filter-list" data-testid="plot-filter-list">
          {evaluated.rules.map((e) => {
            const { rule, curve, isFlag, status, hidden } = e;
            const range = fieldRange(curve, rule.value);
            const flagChoice = (rule.op === 'eq' && rule.value === 1) || (rule.op === 'neq' && rule.value === 0) ? 'yes' : 'no';
            const unit = curve?.unitText || undefined;
            return (
              <div key={rule.id} className={`plot-filter-rule${rule.enabled ? '' : ' is-off'}`} data-testid="plot-filter-rule">
                <div className="plot-filter-rule__head">
                  <Checkbox
                    checked={rule.enabled}
                    aria-label={rule.enabled ? `Desactivar filtro ${e.summary}` : `Activar filtro ${e.summary}`}
                    onChange={(enabled) => updateRule(rule.id, { ...rule, enabled }, enabled ? 'Activar filtro' : 'Desactivar filtro')}
                  />
                  <CurveSelect
                    label="Curva del filtro"
                    value={rule.curve}
                    options={options}
                    hidden={hidden}
                    onChange={(curveKey) => {
                      const next = defaultFilterRule(ctx, curveKey, rule.id);
                      updateRule(rule.id, { ...next, enabled: rule.enabled }, 'Cambiar curva del filtro');
                    }}
                  />
                  <IconButton size="sm" icon="trash" label={`Quitar filtro ${e.summary}`} onClick={() => removeRule(rule.id)} />
                </div>

                {isFlag ? (
                  <div className="plot-filter-rule__cond">
                    <SegmentedControl
                      size="sm"
                      block
                      aria-label={`Condición de ${curve?.short ?? rule.curve}`}
                      value={flagChoice}
                      options={FLAG_OPTIONS}
                      onChange={(v) => updateRule(rule.id, { id: rule.id, curve: rule.curve, op: 'eq', value: v === 'yes' ? 1 : 0, enabled: rule.enabled }, 'Cambiar condición del filtro')}
                    />
                  </div>
                ) : (
                  <div className={`plot-filter-rule__cond${rule.op === 'between' ? ' is-between' : ''}`}>
                    <Select
                      size="sm"
                      aria-label="Operador del filtro"
                      value={rule.op}
                      options={OP_OPTIONS}
                      className="plot-filter-rule__op"
                      onChange={(v) => {
                        const op = v as PlotFilterOp;
                        if (op === 'between') {
                          const hi = curve?.typical && curve.typical.max > rule.value ? curve.typical.max : rule.value + range.step * 10;
                          updateRule(rule.id, { ...rule, op, max: Number(hi.toPrecision(3)) }, 'Cambiar operador del filtro');
                        } else {
                          const { max: _drop, ...rest } = rule;
                          updateRule(rule.id, { ...rest, op }, 'Cambiar operador del filtro');
                        }
                      }}
                    />
                    <NumberField
                      size="sm"
                      min={range.min}
                      max={range.max}
                      step={range.step}
                      clampToRange={false}
                      value={rule.value}
                      unit={rule.op === 'between' ? undefined : unit}
                      format={fmtInput}
                      aria-label={rule.op === 'between' ? 'Mínimo del filtro' : 'Valor del filtro'}
                      onChange={(v) => updateRule(rule.id, { ...rule, value: v }, 'Cambiar valor del filtro')}
                    />
                    {rule.op === 'between' && (
                      <>
                        <span className="plot-filter-rule__sep" aria-hidden="true">
                          –
                        </span>
                        <NumberField
                          size="sm"
                          min={range.min}
                          max={range.max}
                          step={range.step}
                          clampToRange={false}
                          value={rule.max ?? rule.value}
                          unit={unit}
                          format={fmtInput}
                          aria-label="Máximo del filtro"
                          onChange={(v) => updateRule(rule.id, { ...rule, max: v }, 'Cambiar máximo del filtro')}
                        />
                      </>
                    )}
                  </div>
                )}

                {status === 'hidden' && hidden && (
                  <p className="plot-hint plot-hint--warn">Oculta por la sarta ({hidden.mnemonic}): no se aplica.</p>
                )}
                {status === 'missing' && <p className="plot-hint plot-hint--warn">Sin datos en el pozo: no se aplica.</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className="plot-row">
        <Button size="sm" icon="plus" disabled={options.length === 0} onClick={addRule}>
          Agregar filtro
        </Button>
      </div>

      {evaluated.activeCount > 0 && (
        <p className="plot-hint num" data-testid="plot-filter-count">
          Pasan {formatNumber(evaluated.passed, { digits: 0 })} de {formatNumber(evaluated.baseTotal, { digits: 0 })} muestras ({pct}).
        </p>
      )}
    </ControlGroup>
  );
}

/** Franja compacta sobre el gráfico cuando hay filtros de curva/bandera activos, con botón rápido para limpiarlos. */
export function PlotFilterBar({ evaluated, onClear }: { evaluated: EvaluatedPlotFilters; onClear(): void }) {
  if (evaluated.activeCount === 0) return null;
  return (
    <div className="plot-filter-bar" data-testid="plot-filter-bar" title={evaluated.summary}>
      <span className="plot-filter-bar__text">
        <strong>Filtro:</strong> {evaluated.summary}
      </span>
      <span className="plot-filter-bar__count num">
        {formatNumber(evaluated.passed, { digits: 0 })}/{formatNumber(evaluated.baseTotal, { digits: 0 })}
      </span>
      <IconButton size="sm" icon="x" label="Limpiar filtros" onClick={onClear} />
    </div>
  );
}
