/**
 * Contratos del Log Digitizer (fase 1: motor puro). Docs: docs/decisiones/0062-log-digitizer-motor.md.
 *
 * CONVENCIONES (las heredan todas las funciones del motor):
 * - Coordenadas de imagen: x = columna, y = fila, y crece hacia abajo. El CENTRO del píxel (i, j) está en (i, j):
 *   el área de la imagen es [-0.5, ancho-0.5] × [-0.5, alto-0.5]. Las posiciones son números reales (subpíxel).
 * - La imagen debe estar derecha (cabeza arriba) y la profundidad crece hacia abajo (convención de los registros).
 *   La imagen que se calibra y se traza es la YA CORREGIDA (rotación/perspectiva aplicadas, ver geometry.ts).
 * - Profundidad física siempre en METROS (como `DepthIndex` de src/core/well.ts); faltantes = NaN.
 * - Los modelos de entrada/sesión son JSON puro (números, strings, booleanos, arrays y objetos simples). Los resultados
 *   pesados (TracedCurve, DigitizedSeries) usan Float64Array y son transferibles a/desde un Web Worker.
 */
import type { AxisScale } from '../viewer/scale';

/** Imagen en bruto: igual que `ImageData` (RGBA, 4 bytes por píxel, fila por fila). El motor nunca la modifica. */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PixelPoint {
  x: number;
  y: number;
}

/** Rectángulo en píxeles: x0,y0 inclusivos; x1,y1 EXCLUSIVOS. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Unidad de profundidad impresa en el registro escaneado. */
export type ImageDepthUnit = 'm' | 'ft';

/** Amarre de profundidad: la fila `y` (px) de la imagen corresponde a `depth` (en la unidad de la imagen). */
export interface DepthTie {
  y: number;
  depth: number;
}

/**
 * Cómo se interpolan las profundidades entre amarres:
 * - 'piecewise': lineal por tramos que pasa por todos los amarres (corrige escaneos con estiramiento no uniforme).
 * - 'linear': recta única de mínimos cuadrados (promedia el error de pick; el residuo RMS delata un escaneo estirado).
 */
export type DepthMethod = 'piecewise' | 'linear';

/** Entrada del usuario para calibrar la profundidad (JSON puro). */
export interface DepthCalibrationSpec {
  unit: ImageDepthUnit;
  ties: DepthTie[];
  method: DepthMethod;
}

/**
 * Calibración de profundidad ya resuelta (JSON puro). Se obtiene con `buildDepthCalibration`; no se arma a mano.
 * Todos los tramos están en METROS.
 */
export interface DepthCalibration {
  unit: ImageDepthUnit;
  method: DepthMethod;
  /** Amarres ordenados por fila, con la profundidad ya en metros. */
  ties: DepthTie[];
  /** Ajuste lineal global profundidad(m) = interceptM + slopeMPerPx · y (siempre se calcula). */
  slopeMPerPx: number;
  interceptM: number;
  /** Residuo RMS del ajuste lineal global contra los amarres: en metros y en píxeles (= m / |pendiente|). */
  rmsResidualM: number;
  rmsResidualPx: number;
  maxResidualPx: number;
  /** Avisos no bloqueantes (amarres muy juntos, escaneo posiblemente estirado...). */
  warnings: string[];
}

/**
 * Marco de valor de una curva: dos columnas de la imagen corregida con valor conocido. Normalmente son los bordes de la
 * pista, pero sirve cualquier par de columnas (p. ej. dos líneas de grilla rotuladas): `leftPx` ↔ borde izquierdo de
 * `scale`, `rightPx` ↔ borde derecho. `scale` es la `AxisScale` del visor (lineal o log, normal o invertida).
 */
export interface ValueFrame {
  leftPx: number;
  rightPx: number;
  scale: AxisScale;
}

/** Cómo se aísla el trazo de la curva en la imagen. */
export type CurveColorSpec =
  | {
      mode: 'color';
      /** Color del trazo (RGB 0–255), típicamente elegido con `suggestCurveColors`. */
      rgb: [number, number, number];
      /** Tolerancia en ΔE*ab (CIE76). Por defecto 28. */
      tolerance?: number;
    }
  | {
      mode: 'dark';
      /** L* (0–100) por debajo del cual el píxel es trazo pleno. Por defecto 40. */
      lightMax?: number;
      /** L* a partir del cual el píxel es fondo. Por defecto 75. */
      lightMin?: number;
      /** Croma máximo para considerar "negro/gris" (excluye azules oscuros, etc.). Por defecto 30. */
      chromaMax?: number;
    };

/** Máscara de intensidad del trazo (0 = fondo, 255 = trazo pleno) sobre un rectángulo de la imagen. */
export interface TraceMask {
  /** Esquina superior izquierda del rectángulo en coordenadas de la imagen. */
  x0: number;
  y0: number;
  width: number;
  height: number;
  /** width · height bytes, fila por fila. */
  data: Uint8Array;
}

/**
 * Ajustes del trazado (todos con valor por defecto en `DEFAULT_TRACE_SETTINGS`; documentados en la decisión 0062).
 * Unidades: píxeles de la imagen corregida y filas.
 */
export interface TraceSettings {
  /** Intensidad mínima de máscara (0–255) para que un píxel sea "activo". */
  threshold: number;
  /** Huecos de hasta este nº de píxeles inactivos dentro de un tramo horizontal se puentean. */
  bridge: number;
  /** Máx. de candidatos por fila (los de mayor masa). */
  maxCandidates: number;
  /** Huecos de hasta N filas sin trazo (punteado, cruces, texto) se atraviesan; más largos dejan NaN. */
  maxGapRows: number;
  /** Escala (px) del costo cuadrático de salto horizontal entre filas: (salto / (sigma·√d))². */
  sigma: number;
  /** Salto horizontal máximo por fila (px) entre tramos consecutivos; más allá solo cabe reiniciar. */
  maxJump: number;
  /** Recompensa por fila explicada (el "valor" de cubrir una fila con trazo). */
  coverageReward: number;
  /** Costo de empezar una cadena nueva (descarta tramos cortos de ruido: < restartCost/coverageReward filas). */
  restartCost: number;
  /** Un tramo más ancho que esto (px) se considera barrido casi horizontal: se refina y baja su confianza. */
  wideRun: number;
  /** Descarta tramos de ≤ 2 px sin apoyo en las filas vecinas (sal y pimienta). */
  despeckle: boolean;
}

export interface TracePrior {
  /** Columna (px) donde se espera la curva cerca de la fila `y`. */
  x: number;
  /** Fila de referencia (por defecto la primera de la máscara). */
  y?: number;
  /** Penalización cuadrática: ((x - prior.x) / sigma)². Por defecto 30 px. */
  sigma?: number;
  /** Filas alrededor de `y` en las que actúa. Por defecto 40. */
  rows?: number;
}

/** Guía del modo GUIADO: polilínea aproximada del usuario (se ordena por y) y corredor de ± `corridor` px. */
export interface TraceGuide {
  points: PixelPoint[];
  /** Semiancho del corredor (px). Por defecto 12. */
  corridor?: number;
}

/**
 * Resultado del trazado: x(y) por fila. La fila de la muestra i es `y0 + i`. Posiciones en coordenadas de la imagen.
 * Arrays transferibles. `x[i]` = NaN si en esa fila no hay dato (hueco más largo que `maxGapRows` o fuera del tramo).
 */
export interface TracedCurve {
  y0: number;
  /** Centro del trazo (px, subpíxel). NaN = sin dato. */
  x: Float64Array;
  /** Ancho del tramo horizontal elegido (px); 0 donde se interpoló, NaN donde no hay dato. */
  width: Float64Array;
  /** Confianza 0–1 por punto (heurística, no una probabilidad). 0 donde no hay dato. */
  confidence: Float64Array;
  /** 1 = observado en el trazo; 0 = interpolado dentro de un hueco tolerado o sin dato. */
  observed: Uint8Array;
  warnings: string[];
}

/** Serie digitalizada en unidades físicas, ordenada por profundidad creciente, sin NaN (los huecos simplemente faltan). */
export interface DigitizedSeries {
  /** Profundidad en metros, estrictamente creciente. */
  depthM: Float64Array;
  values: Float64Array;
  /** Confianza 0–1 por punto (promediada si se fusionaron puntos). */
  confidence: Float64Array;
  /** Escala del valor: define cómo se interpola (log → en log10) y cómo se mide un pico. */
  scale: AxisScale;
}

/** Serie remuestreada a una grilla de profundidad (m). `values[i]` = NaN donde no hay dato. */
export interface ResampledSeries {
  depthM: Float64Array;
  values: Float64Array;
  /** Paso de la grilla en metros (NaN si la grilla no es uniforme). */
  stepM: number;
}

/** Curva dentro de una sesión: qué se digitaliza y con qué ajustes (JSON puro). */
export interface DigitizerCurveSpec {
  id: string;
  mnemonic: string;
  /** Unidad del valor (id de src/core/units.ts: gAPI, ohm.m, g/cm3...). */
  unit: string;
  /** Rol de la app (GR, RT...), si se sabe. */
  role?: string;
  description?: string;
  frame: ValueFrame;
  color: CurveColorSpec;
  /** Rectángulo (imagen corregida) donde buscar el trazo: típicamente la pista. */
  region: Region;
  mode: 'auto' | 'guided';
  guide?: TraceGuide;
  prior?: TracePrior;
  settings?: Partial<TraceSettings>;
}

/** Paso de corrección geométrica registrado en la sesión, en el orden en que se aplicó a la imagen original. */
export type GeometryStep =
  | { kind: 'rotate'; angleRad: number; expand: boolean }
  | {
      kind: 'perspective';
      /** Cuadrilátero en la imagen de entrada del paso: sup-izq, sup-der, inf-der, inf-izq. */
      quad: [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
      outWidth: number;
      outHeight: number;
    };

/** Trazo guardado dentro de la sesión (JSON: NaN → null). */
export interface SerializedTrace {
  y0: number;
  x: (number | null)[];
  width: (number | null)[];
  confidence: number[];
  observed: number[];
}

/**
 * Sesión del digitalizador: imagen + calibración + curvas. SE GUARDA APARTE DEL PROYECTO (la fase 2 la persiste).
 * La imagen NO va dentro: solo sus metadatos y una huella para comprobar que es la misma al reabrir.
 * JSON puro: `JSON.parse(JSON.stringify(s))` la reproduce exactamente (ver session.ts).
 */
export interface DigitizerSession {
  version: 1;
  name: string;
  image: { name: string; width: number; height: number; fingerprint: string };
  /** Correcciones aplicadas a la imagen original para obtener la imagen sobre la que se calibra y se traza. */
  geometry: GeometryStep[];
  depth: DepthCalibrationSpec | null;
  curves: DigitizerCurveSpec[];
  /** Trazos ya calculados, por id de curva (opcional: se pueden recalcular). */
  traces: Record<string, SerializedTrace>;
}
