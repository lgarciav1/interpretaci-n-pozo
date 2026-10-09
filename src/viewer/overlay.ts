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
 * Sin React: solo canvas 2D.
 */
import type { QcReport } from '../io/qc';
import type { ThemeTokens } from '../ui/tokens';
import type { ResolvedCurve, ResolvedTrack } from './resolve';

/** Zona tal como la ve el visor. */
export interface ViewerZone {
  id: string;
  name: string;
  top: number;
  base: number;
  color: string;
}

/** Datos comunes que el visor pasa a todas las superposiciones. */
export interface ViewerData {
  wellId: string;
  depth: Float64Array;
  zones: readonly ViewerZone[];
  selectedZoneId: string | null;
  qc: QcReport | null;
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
  /** Caja de la pista en px CSS (x desde el borde izquierdo del canvas). */
  x: number;
  width: number;
  curves: readonly ResolvedCurve[];
  hasRole(role: string): boolean;
  /**
   * x relativa a la pista (0…width) de un valor con la escala de la curva de ese rol (o clave de curva) en esta
   * pista; null si la pista no tiene esa curva. Puede quedar fuera de [0, width] (fuera de escala).
   */
  xOf(roleOrKey: string, value: number): number | null;
}

export interface OverlayFrame {
  ctx: CanvasRenderingContext2D;
  theme: ThemeTokens;
  viewport: OverlayViewport;
  tracks: readonly OverlayTrack[];
  data: ViewerData;
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

export interface OverlayHit {
  /** Texto del tooltip. */
  label: string;
  cursor?: 'pointer' | 'default';
  /** Clic (sin arrastre) sobre el elemento. */
  activate?(): void;
  /** Doble clic: el visor muestra este tramo. */
  range?: { top: number; base: number };
  /**
   * Doble clic, además de `range`. El primer clic de un doble clic ya llamó a `activate`: si `activate` alterna
   * (seleccionar/deseleccionar), acá conviene dejar el estado definitivo (p. ej. seleccionado).
   */
  doubleClick?(): void;
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
  draw(frame: OverlayFrame): void;
  /** Elemento bajo el puntero (tooltip, clic, doble clic). */
  hit?(frame: OverlayHitFrame, p: OverlayPointer): OverlayHit | null;
  /** Si la superposición lee estado propio (un store), avisa acá cuándo redibujar. Devuelve la desuscripción. */
  subscribe?(invalidate: () => void): () => void;
}
