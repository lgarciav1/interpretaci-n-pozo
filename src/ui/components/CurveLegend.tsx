/**
 * Leyenda de curva al estilo del encabezado de un perfil: muestra del trazo (color y tipo de línea del tema),
 * nombre, rango de escala y unidad. La usan el visor (encabezados HTML de pista), gráficos y listas de curvas.
 */
import type { ReactNode } from 'react';
import type { RoleCatalog } from '../../core/roles';
import { curveStyle, type CurveStyle } from '../curves';
import { formatNumber } from '../format';
import { useResolvedTheme, type ThemeName } from '../theme';
import './curves.css';

/** Muestra corta del trazo (SVG). */
export function CurveSwatch({ style, width = 28 }: { style: Pick<CurveStyle, 'color' | 'dash' | 'width' | 'kind'>; width?: number }) {
  if (style.kind === 'band') {
    return <span className="ui-curve-swatch ui-curve-swatch--band" style={{ width, background: style.color }} aria-hidden="true" />;
  }
  return (
    <svg className="ui-curve-swatch" width={width} height={8} viewBox={`0 0 ${width} 8`} aria-hidden="true">
      <line x1={1} y1={4} x2={width - 1} y2={4} stroke={style.color} strokeWidth={style.width + 0.25} strokeDasharray={style.dash.join(' ') || undefined} strokeLinecap="butt" />
    </svg>
  );
}

const range = (v: number | undefined) => (v === undefined ? '' : formatNumber(v, { significant: 3, grouping: false }));

export interface CurveLegendProps {
  /** Rol de la curva (null si no tiene). */
  role: string | null;
  /** Nombre a mostrar (mnemónico). */
  name: string;
  unit?: string;
  catalog?: RoleCatalog;
  /** Si es true muestra el rango y la escala (encabezado de pista). */
  scale?: boolean;
  /** Tema fijo (por defecto, el resuelto de la app). */
  theme?: ThemeName;
  /** Estilo ya resuelto (con overrides del usuario); si falta, `curveStyle(role, tema, catálogo)`. */
  curveStyle?: CurveStyle;
  /** Valor a la derecha del nombre, antes de la unidad (lectura del cursor en el visor). */
  value?: ReactNode;
  /** Texto del tooltip nativo (por defecto, la etiqueta del rol). */
  title?: string;
  /** Mostrar la etiqueta «log» (por defecto sí; el visor la omite porque la grilla ya lo dice). */
  scaleTag?: boolean;
  /** Etiqueta extra junto al nombre («alternativa» para un método en comparación). */
  tag?: string;
  /**
   * 'stacked' (por defecto): nombre arriba, escala abajo. 'inline': una sola fila baja al estilo de un encabezado de
   * perfil — extremo izquierdo, nombre y valor sobre el trazo de la curva, extremo derecho; la unidad va al tooltip.
   * 'classic': encabezado de perfil clásico (docs/decisiones/0067) — «mínimo · MNEMÓNICO unidad · máximo» en
   * monoespaciada y, debajo, la muestra del trazo (color y patrón) a todo el ancho, con la lectura encima. Si no entra,
   * el nombre y la unidad pasan a dos líneas (nunca se cortan).
   */
  layout?: 'stacked' | 'inline' | 'classic';
}

export function CurveLegend({ role, name, unit, catalog, scale = true, theme: fixed, curveStyle: resolved, value, title, scaleTag = true, tag, layout = 'stacked' }: CurveLegendProps) {
  const current = useResolvedTheme();
  const theme = fixed ?? current;
  const s = resolved ?? curveStyle(role, theme, catalog, name);
  const lo = s.reversed ? s.max : s.min;
  const hi = s.reversed ? s.min : s.max;
  if (layout === 'classic') {
    const tip = `${title ?? s.label}${unit ? ` (${unit})` : ''}`;
    return (
      <div className={`ui-curve-legend ui-curve-legend--classic${scale ? '' : ' ui-curve-legend--noscale'}`} title={tip}>
        <div className="ui-curve-legend__row">
          {scale && <span className="ui-curve-legend__lo">{lo !== undefined ? range(lo) : ''}</span>}
          <span className="ui-curve-legend__label">
            <span className="ui-curve-legend__name" style={{ color: s.color }}>
              {name}
            </span>
            {unit && <span className="ui-curve-legend__unit">{unit}</span>}
          </span>
          {scale && <span className="ui-curve-legend__hi">{hi !== undefined ? range(hi) : ''}</span>}
        </div>
        <span className="ui-curve-legend__sample">
          {s.kind === 'band' ? (
            <CurveSwatch style={s} width={12} />
          ) : (
            <svg className="ui-curve-legend__line" height={6} aria-hidden="true">
              <line x1="0" y1="3" x2="100%" y2="3" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash.join(' ') || undefined} />
            </svg>
          )}
          {tag && <span className="ui-curve-legend__tag ui-curve-legend__tag--alt">{tag}</span>}
          {value !== undefined && <span className="ui-curve-legend__value num">{value}</span>}
        </span>
      </div>
    );
  }
  if (layout === 'inline') {
    const label = (
      <span className="ui-curve-legend__label">
        <span className="ui-curve-legend__name" style={{ color: s.color }}>
          {name}
        </span>
        {scaleTag && s.scale === 'log' && <span className="ui-curve-legend__tag">log</span>}
        {tag && <span className="ui-curve-legend__tag ui-curve-legend__tag--alt">{tag}</span>}
        {value !== undefined && <span className="ui-curve-legend__value num">{value}</span>}
      </span>
    );
    // En una fila no hay lugar para la unidad: va en el tooltip (y en la lectura accesible del visor).
    const tip = `${title ?? s.label}${unit ? ` (${unit})` : ''}`;
    return (
      <div className={`ui-curve-legend ui-curve-legend--inline${scale ? '' : ' ui-curve-legend--noscale'}`} title={tip}>
        {scale && <span className="ui-curve-legend__lo num">{lo !== undefined ? range(lo) : ''}</span>}
        <span className="ui-curve-legend__mid">
          {s.kind === 'band' ? (
            <CurveSwatch style={s} width={12} />
          ) : (
            <svg className="ui-curve-legend__line" height={8} aria-hidden="true">
              <line x1="0" y1="4" x2="100%" y2="4" stroke={s.color} strokeWidth={s.width + 0.25} strokeDasharray={s.dash.join(' ') || undefined} />
            </svg>
          )}
          {label}
        </span>
        {scale && <span className="ui-curve-legend__hi num">{hi !== undefined ? range(hi) : ''}</span>}
      </div>
    );
  }
  return (
    <div className="ui-curve-legend" title={title ?? s.label}>
      <div className="ui-curve-legend__top">
        <span className="ui-curve-legend__name" style={{ color: s.color }}>
          {name}
        </span>
        {scaleTag && s.scale === 'log' && <span className="ui-curve-legend__tag">log</span>}
        {tag && <span className="ui-curve-legend__tag ui-curve-legend__tag--alt">{tag}</span>}
        {value !== undefined && <span className="ui-curve-legend__value num">{value}</span>}
        {unit && <span className="ui-curve-legend__unit">{unit}</span>}
      </div>
      <div className="ui-curve-legend__scale num">
        {scale && lo !== undefined && <span>{range(lo)}</span>}
        <CurveSwatch style={s} width={40} />
        {scale && hi !== undefined && <span>{range(hi)}</span>}
      </div>
    </div>
  );
}
