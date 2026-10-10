/**
 * Capas del gráfico x–y (puntos, líneas, tendencias, guías). Tipos puros: los comparten el componente `XYPlot`, el
 * dibujo (`draw.ts`) y la exportación de figuras (`figure.ts`). Sin React.
 */
import type { TrendCoefficients } from '../../petro/regression';
import type { PointVariant } from './draw';

export interface XYPointLayer {
  id: string;
  /** Nombre en la leyenda de las figuras exportadas («Plugs de corona»). Sin nombre, la capa no figura. */
  name?: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Color de todos los puntos o de cada uno (color por capa, por una tercera curva…). */
  color: string | ((i: number) => string);
  /** Variante de cada punto (por defecto 'filled'). */
  variant?: (i: number) => PointVariant;
  radius?: number;
  /** Nube tenue (miles de puntos de un perfil): puntos chicos, translúcidos y no interactivos. */
  cloud?: boolean;
  /** Responde al puntero y al teclado (tooltip, clic). */
  interactive?: boolean;
  /** Texto del tooltip y nombre accesible. */
  label?: (i: number) => string;
}

export interface XYLineLayer {
  id: string;
  name?: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  width?: number;
  dash?: number[];
}

export interface XYTrendLayer {
  id: string;
  name?: string;
  coeffs: TrendCoefficients;
  /** Tramo de x ajustado (sólido). */
  span: [number, number];
  color: string;
  /** Extensión punteada hasta los bordes. */
  extend?: boolean;
  /** Etiqueta de dos líneas (ecuación; R² …). */
  label?: readonly [string, string];
  emphasis?: boolean;
}

/** Línea de referencia vertical (axis 'x') u horizontal (axis 'y'), con rótulo opcional. */
export interface XYGuide {
  axis: 'x' | 'y';
  value: number;
  color: string;
  label?: string;
  dash?: number[];
  width?: number;
}
