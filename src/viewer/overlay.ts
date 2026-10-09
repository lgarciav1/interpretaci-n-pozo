/**
 * CONTRATO DE SUPERPOSICIONES DEL VISOR (docs/decisiones/0005-visor-multipista.md, D7).
 *
 * Una superposición dibuja sobre las pistas sin tocar el núcleo del visor: puntos de presión MDT, plugs de corona,
 * líneas de tendencia, el cutoff del histograma reflejado en el perfil, la selección de un crossplot…
 *
 *     export const overlays: ViewerOverlay[] = [{
 *       id: 'mdt-points', label: 'Presiones MDT', layer: 'over',
 *       draw({ ctx, viewport, tracks, theme }) {
 *         const t = tracks.find((t) => t.hasRole('PRES'));
 *         ...ctx.arc(t.x + t.xOf('PRES', p.value)!, viewport.yOf(p.depth), 3, 0, 2 * Math.PI)...
 *       },
 *     }];
 *
 * Los módulos lo declaran en `src/modules/<id>/overlay.ts` (descubierto solo; el worker no lo importa).
 * Sin React: solo canvas 2D. Una superposición puede:
 * - dibujar (`draw`) en cualquier pista o en una pista propia (`track`: presiones MDT con su escala);
 * - responder al puntero (`hit`): tooltip, clic, doble clic, ARRASTRE (`drag`: plugs, topes, puntos de una
 *   tendencia, elegir un tramo) y mover con ↑/↓ el elemento activo (`nudge`);
 * - pedir redibujo (`frame.invalidate()` durante una vista previa, o `subscribe` si lee un store propio).
 */
import type { Interpretation } from '../core/interpretation';
import type { Well } from '../core/well';
import type { QcReport } from '../io/qc';
import type { ThemeTokens } from '../ui/tokens';
import type { ComputedCurve, ResolvedCurve, ResolvedTrack } from './resolve';
import type { AxisScale } from './scale';

/** Zona tal como la ve el visor. */
export interface ViewerZone {
  id: string;
  name: string;
  top: number;
  base: number;
  color: string;
}

/**
 * Datos comunes que el visor pasa a todas las superposiciones. SOLO LECTURA: una superposición de módulo lee de acá
 * el pozo y la interpretación activos sin importar `src/app/store`; para cambiarlos, la receta va por el store del
 * proyecto (`commit`), nunca escribiendo en estos objetos.
 */
export interface ViewerData {
  wellId: string;
  depth: Float64Array;
  zones: readonly ViewerZone[];
  selectedZoneId: string | null;
  qc: QcReport | null;
  /** Pozo activo (curvas medidas, encabezado). */
  well: Readonly<Well>;
  /** Interpretación activa (zonas, parámetros, fuentes). */
  interpretation: Readonly<Interpretation>;
  /** Curvas calculadas por el motor para este pozo (activas y alternativas). */
  computed: readonly ComputedCurve[];
}

export interface OverlayViewport {
  top: number;
  base: number;
  pxPerM: number;
  /** Alto del área de dibujo (px CSS). */
  height: number;
  yOf(depth: number): number;
  depthOf(y: number): number;
}

export interface OverlayTrack {
  id: string;
  kind: ResolvedTrack['kind'];
  title: string;
  /** Pistas 'overlay': id de la superposición dueña. */
  overlayId?: string;
  /** Caja de la pista en px CSS (x desde el borde izquierdo del canvas). */
  x: number;
  width: number;
  curves: readonly ResolvedCurve[];
  /** Escala de la grilla de la pista (en 'overlay', su escala propia). */
  scale: AxisScale | null;
  hasRole(role: string): boolean;
  /**
   * x relativa a la pista (0…width) de un valor con la escala de la curva de ese rol o clave (la calculada activa
   * gana a la medida), o con la escala de la pista si `roleOrKey` es null. null si no hay esa curva o escala.
   * Puede quedar fuera de [0, width] (fuera de escala).
   */
  xOf(roleOrKey: string | null, value: number): number | null;
  /** Inversa de `xOf`: valor en la x relativa a la pista. */
  valueOf(roleOrKey: string | null, x: number): number | null;
}

export interface OverlayFrame {
  ctx: CanvasRenderingContext2D;
  theme: ThemeTokens;
  viewport: OverlayViewport;
  tracks: readonly OverlayTrack[];
  data: ViewerData;
  /** Pide redibujar el canvas base en el próximo cuadro (vista previa en vivo de un arrastre). */
  invalidate(): void;
}

/** Lo mismo que OverlayFrame, sin contexto de dibujo (para `hit`). */
export type OverlayHitFrame = Omit<OverlayFrame, 'ctx'>;

export interface OverlayPointer {
  /** Posición en px CSS dentro del canvas. */
  x: number;
  y: number;
  depth: number;
  /** Pista bajo el puntero (null si ninguna). */
  track: OverlayTrack | null;
}

export type OverlayCursor = 'pointer' | 'default' | 'grab' | 'grabbing' | 'move' | 'ns-resize' | 'ew-resize' | 'crosshair';

/**
 * Arrastre de un elemento (plug, tope, punto de una tendencia) o selección de un tramo. Si el `hit` bajo el puntero
 * trae `drag`, el visor NO panea: captura el puntero y, pasado el umbral de arrastre, llama a `move` en cada
 * movimiento (también cuando la vista se desplaza sola cerca de los bordes), `end` al soltar y `cancel` con Escape.
 * `start` es el punto donde se apretó. La superposición guarda la vista previa y llama a `frame.invalidate()`.
 */
export interface OverlayDrag {
  /** Cursor mientras se arrastra (por defecto 'grabbing'). */
  cursor?: OverlayCursor;
  move(p: OverlayPointer, start: OverlayPointer): void;
  end(p: OverlayPointer, start: OverlayPointer): void;
  cancel?(): void;
}

export interface OverlayHit {
  /** Texto del tooltip. */
  label: string;
  cursor?: OverlayCursor;
  /** Clic (sin arrastre) sobre el elemento. */
  activate?(): void;
  /** Doble clic: el visor muestra este tramo. */
  range?: { top: number; base: number };
  /**
   * Doble clic, además de `range`. El primer clic de un doble clic ya llamó a `activate`: si `activate` alterna
   * (seleccionar/deseleccionar), acá conviene dejar el estado definitivo (p. ej. seleccionado).
   */
  doubleClick?(): void;
  /** Arrastrable (ver OverlayDrag). Una superposición en modo selección lo devuelve en cualquier punto. */
  drag?: OverlayDrag;
  /**
   * Movimiento desde el teclado. Un clic o un arrastre sobre el elemento lo deja ACTIVO: mientras lo esté, ↑/↓ llaman
   * a `nudge(±paso)` (en m; Mayús ×10) en vez de mover el cursor. Escape o un clic en otro lado lo sueltan.
   */
  nudge?(deltaM: number): void;
}

/** Pista propia de una superposición (p. ej. presión vs. profundidad). El visor la agrega a las pistas activas. */
export interface OverlayTrackDecl {
  title: string;
  /** Escala horizontal de la pista (grilla, extremos del encabezado, `xOf(null, v)`). */
  scale: { kind: 'linear' | 'log'; min: number; max: number; reversed?: boolean };
  unit?: string;
  /** Ancho relativo (por defecto 1). */
  width?: number;
  /** Se ubica después de esta pista (id); si falta o no existe, al final. */
  after?: string;
  /** Espacios de trabajo donde aparece (por defecto, todos). */
  workspaces?: readonly string[];
}

export interface ViewerOverlay {
  /** Único. */
  id: string;
  /** Nombre para la interfaz (futuro selector de capas). */
  label: string;
  /** 'under': después de la grilla y antes de rellenos y curvas; 'over': encima de las curvas. */
  layer: 'under' | 'over';
  /** Orden dentro de la capa (menor primero). */
  order?: number;
  /** Pista propia (kind 'overlay', id `ov:<id>`); se dibuja en su caja con `tracks.find((t) => t.overlayId === id)`. */
  track?: OverlayTrackDecl;
  draw(frame: OverlayFrame): void;
  /** Elemento bajo el puntero (tooltip, clic, doble clic, arrastre, teclado). */
  hit?(frame: OverlayHitFrame, p: OverlayPointer): OverlayHit | null;
  /** Si la superposición lee estado propio (un store), avisa acá cuándo redibujar. Devuelve la desuscripción. */
  subscribe?(invalidate: () => void): () => void;
}

/** Corre una función de una superposición sin que su error tire abajo el visor. */
export function guard<T>(overlayId: string, what: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    console.error(`Superposición '${overlayId}' (${what}):`, err);
    return undefined;
  }
}
