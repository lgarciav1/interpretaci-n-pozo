/**
 * Estilos de dibujo del visor (docs/decisiones/0067-perfil-clasico.md). Puro.
 *
 * Un estilo («look») decide CÓMO se dibujan las mismas pistas: zonas como líneas o como bandas, paleta de curvas y
 * rellenos, trazo de las curvas según la densidad de muestras, banda mínimo–máximo en la vista de pozo completo,
 * tramas litológicas, encabezados y columnas de profundidad. Qué pistas hay lo deciden las plantillas
 * (`templates.ts`); cada estilo trae su plantilla de fábrica.
 *
 * - `classic` (de fábrica): perfil clásico, sobrio, con las convenciones de lectura de la industria.
 * - `modern`: el estilo anterior (zonas teñidas, rellenos de color, líneas gruesas), a elección del usuario.
 */
import { DEFAULT_VIEWER_LOOK, type ViewerLookSetting } from '../core/display';
import type { LineStyle, PaletteVariant } from '../ui/curves';
import { MIN_TRACK_WIDTH } from './layout';

export type ViewerLookId = ViewerLookSetting;

/** Estilo de fábrica de la app. Un proyecto sin `display.look` se ve así. */
export const DEFAULT_LOOK: ViewerLookId = DEFAULT_VIEWER_LOOK;

export interface ViewerLook {
  id: ViewerLookId;
  /** Nombre en la interfaz. */
  label: string;
  description: string;
  /** Zonas: línea fina por tope + franja junto a la profundidad ('lines'), o banda teñida en cada pista ('bands'). */
  zones: 'lines' | 'bands';
  /** Variante de la paleta de curvas y rellenos (`src/ui/curves.ts`). */
  palette: PaletteVariant;
  /** Trazo según la densidad de muestras: patrón solo con pocas por píxel, sólida o banda mín–máx con muchas. */
  densityAware: boolean;
  /** Tramas litológicas en las pilas (arena con puntos, caliza con ladrillos…). */
  lithology: boolean;
  /** Encabezados: «mínimo · MNEMÓNICO unidad · máximo» y muestra del trazo ('classic'), o la fila compacta ('modern'). */
  headers: 'classic' | 'modern';
  /** Columna TVDSS junto a la MD cuando el pozo tiene con qué calcularla. */
  tvdss: boolean;
  /** Calidad del pozo: franja en el borde de la pista ('edge') o rayado sobre toda la pista ('hatch'). */
  qc: 'edge' | 'hatch';
  /** Grilla log con la línea de década marcada y las subdivisiones 2–9 tenues. */
  decades: boolean;
  /** Fondo blanco en todas las pistas, también en la de profundidad (como un perfil impreso). */
  paper: boolean;
  /**
   * Ancho mínimo de una pista flexible (px de Compacto). El clásico usa encabezados en monoespaciada de 10 px que caben
   * en menos ancho: con 92 px, las once pistas de Petrofísica entran a 1366 px sin desplazamiento horizontal.
   */
  minTrackWidth: number;
}

export const VIEWER_LOOKS: Readonly<Record<ViewerLookId, ViewerLook>> = {
  classic: {
    id: 'classic',
    label: 'Perfil clásico',
    description: 'Fondo blanco, líneas finas por convención de curva, topes como líneas y rellenos apagados',
    zones: 'lines',
    palette: 'classic',
    densityAware: true,
    lithology: true,
    headers: 'classic',
    tvdss: true,
    qc: 'edge',
    decades: true,
    paper: true,
    minTrackWidth: 92,
  },
  modern: {
    id: 'modern',
    label: 'Moderno',
    description: 'El estilo anterior: zonas teñidas, rellenos de color y líneas más gruesas',
    zones: 'bands',
    palette: 'modern',
    densityAware: false,
    lithology: false,
    headers: 'modern',
    tvdss: false,
    qc: 'hatch',
    decades: false,
    paper: false,
    minTrackWidth: MIN_TRACK_WIDTH,
  },
};

/** Estilo de un id guardado (lo desconocido o ausente es el de fábrica). */
export function lookOf(id: string | null | undefined): ViewerLook {
  return id === 'modern' || id === 'classic' ? VIEWER_LOOKS[id] : VIEWER_LOOKS[DEFAULT_LOOK];
}

// ── trazo según la densidad de muestras ──────────────────────────────────────────────────────────────────────

/**
 * Máximo de muestras por píxel (en profundidad) para dibujar una curva rayada o punteada con su patrón.
 *
 * Un patrón de trazo se gasta a lo largo del CAMINO de la línea (6 px de raya + 4 de hueco a 1 px de grosor; 1,2 + 2,6
 * el punteado). Con a lo sumo una muestra por fila de píxel, la polilínea avanza al menos 1 px hacia abajo por vértice
 * y la raya acompaña a la curva. Con más de una por fila, la reducción M4 dibuja primera → mín → máx → última dentro de
 * la misma fila: el camino va y vuelve en horizontal, el patrón se gasta en esos zigzags y se ve «confeti». Por eso:
 * patrón hasta 1 muestra por píxel (el pozo del TP, con 0,1524 m de paso, lo muestra desde 1:580 hacia el detalle) y
 * sólida por encima; el color distingue las curvas de una misma pista.
 */
export const DASH_MAX_SAMPLES_PER_PX = 1;

/**
 * Muestras por píxel desde las que una curva se dibuja como banda clara de mínimo a máximo con la media encima.
 *
 * Con tres o más muestras por fila, el zigzag M4 de cada fila cubre todo su rango y la línea se vuelve una mancha
 * horizontal del ancho de la variación local. La banda muestra lo mismo (ningún pico se pierde: es el mín y el máx de
 * la fila) y la media fina deja leer la tendencia. Entre 1 y 3 muestras por fila la línea M4 todavía se lee como línea.
 * En el pozo del TP: banda a partir de ≈ 1:1700 (pozo completo, 1:2000), línea a 1:1000.
 */
export const ENVELOPE_MIN_SAMPLES_PER_PX = 3;

export type StrokeMode = 'pattern' | 'solid' | 'envelope';

/**
 * Cómo se dibuja una curva con `samplesPerPx` muestras por fila de píxel. Las sólidas no cambian hasta la banda.
 * Sin `densityAware` (estilo Moderno), siempre con su patrón y sin banda.
 */
export function strokeMode(samplesPerPx: number, line: LineStyle, look: Pick<ViewerLook, 'densityAware'>): StrokeMode {
  if (!look.densityAware) return 'pattern';
  if (samplesPerPx >= ENVELOPE_MIN_SAMPLES_PER_PX) return 'envelope';
  if (line === 'solid') return 'pattern';
  return samplesPerPx <= DASH_MAX_SAMPLES_PER_PX ? 'pattern' : 'solid';
}

/** Opacidad de la banda mínimo–máximo (sobre el color de la curva). Tenue: la media es la que se lee. */
export const ENVELOPE_ALPHA = 0.28;
