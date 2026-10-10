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
  /**
   * Nube densa (crossplot libre, decenas de miles de muestras): puntos chicos sin halo, dibujados en lotes por color
   * (conviene que `color(i)` devuelva pocos colores distintos: una rampa cuantizada, los colores de zona). Puede ser
   * interactiva: la búsqueda del punto bajo el puntero usa una grilla.
   */
  dense?: boolean;
  /** Opacidad de los puntos de una nube densa (por defecto 0,75). */
  alpha?: number;
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
  /** Se mide contra el eje derecho (`y2`), p. ej. la acumulada de un histograma. */
  y2?: boolean;
  /** Rótulo junto a un extremo visible de la línea («Sw 50 %», «Arenisca»). */
  label?: string;
  /** Extremo donde va el rótulo: el del final de la polilínea (por defecto) o el del comienzo, ya recortado al área. */
  labelAt?: 'start' | 'end';
}

/** Barras de un histograma: clases con bordes en x (`edges`, n + 1) y altura en y (`values`, n). */
export interface XYBarLayer {
  id: string;
  name?: string;
  edges: ArrayLike<number>;
  values: ArrayLike<number>;
  color: string;
  /** Opacidad del relleno (por defecto 0,35); el contorno va opaco. */
  fillAlpha?: number;
  /** Solo el contorno escalonado, sin relleno (superposición de varias series). */
  outlineOnly?: boolean;
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
  /** Rótulo en una etiqueta junto a la línea (arriba en una vertical, a la derecha en una horizontal). */
  label?: string;
  /** Segundo renglón del rótulo («38 % ≤ · 62 % >»). */
  detail?: string;
  dash?: number[];
  width?: number;
  /** Id para arrastrarla (cutoffs): con `draggable`, `XYPlot` la mueve con el mouse y el teclado. */
  id?: string;
  draggable?: boolean;
  /** Paso del teclado en unidades del dato (p. ej. el paso del parámetro); por defecto, 1 % del eje. */
  step?: number;
}
