/**
 * Controles compartidos de los gráficos del dock (histograma y crossplot libre; docs/decisiones/0014). Presentación
 * pura con componentes del sistema de diseño: no conocen los stores (los conecta `src/modules/<id>/dock.tsx`).
 */
import type { ReactNode } from 'react';
import type { AxisScaleChoice } from '../core/plots';
import type { Zone } from '../core/well';
import { Chip, SegmentedControl, Select } from '../ui';
import type { CurveOption } from './data';
import './plots.css';

/** Selector de curva con las medidas y las calculadas agrupadas. */
export function CurveSelect({ value, options, onChange, label, placeholder, extra }: { value: string | null; options: readonly CurveOption[]; onChange(v: string): void; label: string; placeholder?: string; extra?: readonly { value: string; label: string }[] }) {
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
      options={[...(extra ?? []), ...(known ? [] : [{ value: value!, label: `${value} (sin datos)`, disabled: true }])]}
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
