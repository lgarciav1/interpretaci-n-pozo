/**
 * Encabezado de pozo moderno (fase 4b): una franja de una línea bajo la barra del visor con los datos que importan
 * al leer el perfil (yacimiento, compañía, KB…), el intervalo, el paso, la cantidad de curvas y las zonas. Se
 * despliega para ver todos los campos de `Well.header`. Con un LAS sin metadatos muestra lo que sí se sabe.
 */
import { useId, useMemo, useState } from 'react';
import type { Well } from '../core/well';
import { formatNumber, Icon } from '../ui';
import type { ViewerZone } from './overlay';
import { wellHeaderFields } from './wellHeader';

export interface WellHeaderProps {
  well: Well;
  zones: readonly ViewerZone[];
  /** Cantidad de curvas calculadas (se suman a las medidas). */
  computedCount?: number;
  /** Clic en una zona: mostrarla. */
  onZone?(zone: ViewerZone): void;
}

const num = (v: number, digits: number) => formatNumber(v, { digits, grouping: false });

export function WellHeader({ well, zones, computedCount = 0, onZone }: WellHeaderProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { primary, others } = useMemo(() => wellHeaderFields(well), [well]);
  const d = well.depth.values;
  const top = d[0] ?? 0;
  const base = d[d.length - 1] ?? 0;
  const sorted = [...zones].sort((a, b) => a.top - b.top);
  const all = [...primary, ...others];
  return (
    <div className="wv-header">
      <div className="wv-header__row">
        <dl className="wv-header__facts">
          {primary.length === 0 ? (
            <div className="wv-header__fact wv-header__fact--empty" title="El archivo no trae yacimiento, compañía ni elevaciones">
              <dt>Encabezado</dt>
              <dd>sin metadatos</dd>
            </div>
          ) : (
            primary.slice(0, 4).map((f) => (
              <div key={f.key} className="wv-header__fact" title={`${f.label}: ${f.value}`}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))
          )}
        </dl>
        <dl className="wv-header__facts wv-header__facts--end">
          <div className="wv-header__fact">
            <dt>Intervalo</dt>
            <dd className="num">
              {num(top, 1)} – {num(base, 1)} m
            </dd>
          </div>
          <div className="wv-header__fact">
            <dt>Paso</dt>
            <dd className="num">{well.depth.step ? `${num(well.depth.step, 4)} m` : 'irregular'}</dd>
          </div>
          <div className="wv-header__fact" title={`${well.curves.length} medidas${computedCount ? ` y ${computedCount} calculadas` : ''}`}>
            <dt>Curvas</dt>
            <dd className="num">
              {well.curves.length}
              {computedCount > 0 && <span className="wv-header__sub"> + {computedCount}</span>}
            </dd>
          </div>
          <div className="wv-header__fact">
            <dt>Zonas</dt>
            <dd>
              {sorted.length === 0 ? (
                <span className="wv-header__sub">ninguna</span>
              ) : (
                <span className="wv-header__zones">
                  {sorted.slice(0, 8).map((z) => (
                    <button
                      key={z.id}
                      type="button"
                      className="wv-header__zone"
                      title={`Zona ${z.name}: ${num(z.top, 1)}–${num(z.base, 1)} m. Clic para verla entera.`}
                      aria-label={`Ver la zona ${z.name}`}
                      onClick={() => onZone?.(z)}
                    >
                      <span className="wv-header__zone-dot" style={{ background: z.color }} aria-hidden="true" />
                      {z.name}
                    </button>
                  ))}
                  {sorted.length > 8 && <span className="wv-header__sub">+{sorted.length - 8}</span>}
                </span>
              )}
            </dd>
          </div>
        </dl>
        {all.length > 0 && (
          <button type="button" className="wv-header__more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
            {open ? 'Menos' : `Encabezado${all.length > 4 ? ` (${all.length})` : ''}`}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} />
          </button>
        )}
      </div>
      {open && all.length > 0 && (
        <dl id={id} className="wv-header__all">
          {all.map((f) => (
            <div key={f.key} className="wv-header__item">
              <dt title={f.key}>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
