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
}

export function CurveLegend({ role, name, unit, catalog, scale = true, theme: fixed, curveStyle: resolved, value, title, scaleTag = true }: CurveLegendProps) {
  const current = useResolvedTheme();
  const theme = fixed ?? current;
  const s = resolved ?? curveStyle(role, theme, catalog, name);
  const lo = s.reversed ? s.max : s.min;
  const hi = s.reversed ? s.min : s.max;
  return (
    <div className="ui-curve-legend" title={title ?? s.label}>
      <div className="ui-curve-legend__top">
        <span className="ui-curve-legend__name" style={{ color: s.color }}>
          {name}
        </span>
        {scaleTag && s.scale === 'log' && <span className="ui-curve-legend__tag">log</span>}
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
