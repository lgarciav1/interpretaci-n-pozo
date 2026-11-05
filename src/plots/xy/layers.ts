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
  /** Nube densa dibujada como anillos (solo contorno): marca puntos de otra capa sin tapar su color (fase 8b). */
  ring?: boolean;
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
  /** Vista previa de una acción (la recta que dejaría un ajuste): se ve en pantalla, no sale en la figura exportada. */
  preview?: boolean;
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
  /**
   * Histograma apilado (resumen por zona, docs/decisiones/0068): base de cada clase (n). La barra va de `base` a
   * `base + values`; sin contorno propio (el contorno del total va en otra capa con `outlineOnly`).
   */
  base?: ArrayLike<number>;
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
  /** false: Supr no la quita (líneas de parámetros como GR limpio, que siempre están). Por defecto, sí. */
  removable?: boolean;
}

/**
 * Manija arrastrable en dos dimensiones (fase 7b, docs/decisiones/0015): el punto de matriz del densidad–neutrón, las
 * manijas de la recta de agua del Pickett. Es un elemento del DOM sobre el gráfico (Tab, flechas, `role="slider"`)
 * con un rótulo visible; no sale en las figuras exportadas (las líneas que mueve sí, como capas `lines`).
 *
 * El dueño decide qué parámetro cambia: `XYPlot` le pasa la posición nueva en datos (`onHandleChange`) o la flecha
 * apretada (`onHandleNudge`), y la manija se dibuja donde el dueño la vuelva a poner (redondeada al paso).
 */
export interface XYHandle {
  id: string;
  x: number;
  y: number;
  color: string;
  /** Forma: círculo (por defecto), rombo (punto de matriz) o cuadrado (manija de rotar). */
  shape?: 'circle' | 'diamond' | 'square';
  /** Rótulo visible, primer renglón: valor y alcance («Rw global · 0,045 ohm·m a 24 °C»). */
  label: string;
  /** Segundo renglón (opcional). */
  detail?: string;
  /** Nombre accesible (qué es y cómo se mueve). */
  ariaLabel: string;
  /** Valor para lectores de pantalla (`aria-valuetext`). */
  valueText: string;
  /**
   * Polilínea (en datos) por la que también se agarra: arrastrar la recta mueve la manija con el mismo desplazamiento
   * en px (trasladar la recta de agua o la línea de la matriz).
   */
  grabPath?: { x: ArrayLike<number>; y: ArrayLike<number> };
  /** Visible pero quieta (p. ej. el módulo que usa el parámetro no alimenta la cadena). */
  disabled?: boolean;
  /** Cursor sobre la manija (por defecto 'move'). */
  cursor?: string;
  /**
   * Lado preferido del rótulo (por defecto arriba a la derecha): conviene el lado sin datos (en el Pickett, abajo a
   * la izquierda de la recta de agua). Cerca de un borde del gráfico se da vuelta.
   */
  labelAt?: { x?: 'left' | 'right'; y?: 'above' | 'below' };
  /**
   * El rótulo solo se ve con el puntero encima, durante el arrastre o con el foco del teclado (fase 8b): muchas manijas
   * juntas (una recta de agua por zona) no tapan el gráfico con rótulos. El nombre accesible no cambia.
   */
  labelOnActive?: boolean;
}


/** Región mineral en coordenadas de datos; se dibuja detrás de líneas y muestras. */
export interface XYPolygonLayer {
  id: string;
  name?: string;
  vertices: readonly (readonly [number, number])[];
  color: string;
  fillAlpha?: number;
  width?: number;
  /** Rótulo en el centro geométrico aproximado, o en una posición explícita. */
  label?: string;
  labelPosition?: readonly [number, number];
}
