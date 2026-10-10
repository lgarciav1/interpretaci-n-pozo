/**
 * Tabla de datos: cabecera fija (con `maxHeight`), números alineados a la derecha con cifras tabulares, filas
 * seleccionables por clic o teclado y mensaje si no hay filas.
 */
import type { CSSProperties, ReactNode } from 'react';
import './table.css';
import { scaledCss } from '../uiScale';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Valor de la celda. Por defecto `row[key]`. */
  render?: (row: T, index: number) => ReactNode;
  /** 'num' alinea a la derecha con cifras tabulares. */
  align?: 'left' | 'right' | 'center' | 'num';
  width?: CSSProperties['width'];
  /** Título accesible de la columna si `header` no es texto. */
  title?: string;
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  /** Alto máximo: la cabecera queda fija al hacer scroll. */
  maxHeight?: CSSProperties['maxHeight'];
  dense?: boolean;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  empty?: ReactNode;
  caption?: string;
  className?: string;
  /** Atributos extra por fila (data-*). */
  rowProps?: (row: T) => Record<string, string | undefined>;
  'data-testid'?: string;
}

export function DataTable<T>({ columns, rows, rowKey, maxHeight, dense, onRowClick, selectedKey, empty, caption, className, rowProps, ...rest }: DataTableProps<T>) {
  const alignClass = (c: Column<T>) => (c.align === 'num' ? 'is-num' : c.align === 'right' ? 'is-right' : c.align === 'center' ? 'is-center' : undefined);
  return (
    <div className={['ui-table-wrap', className].filter(Boolean).join(' ')} style={maxHeight !== undefined ? { maxHeight: scaledCss(maxHeight) } : undefined}>
      <table className={`ui-table${dense ? ' ui-table--dense' : ''}${onRowClick ? ' ui-table--interactive' : ''}`} data-testid={rest['data-testid']}>
        {caption && <caption className="ui-visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={alignClass(c)} style={c.width !== undefined ? { width: c.width } : undefined} title={c.title}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="ui-table__empty">
                {empty ?? 'Sin datos.'}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => {
              const key = rowKey(r, i);
              const selected = selectedKey !== undefined && selectedKey === key;
              return (
                <tr
                  key={key}
                  aria-selected={onRowClick ? selected : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(r);
                          }
                        }
                      : undefined
                  }
                  {...rowProps?.(r)}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={alignClass(c)}>
                      {c.render ? c.render(r, i) : String((r as Record<string, unknown>)[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
