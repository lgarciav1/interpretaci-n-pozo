/**
 * Dibujo de la lupa del visor (F17, docs/decisiones/0085-lupa-del-visor.md). Canvas 2D, sin React.
 *
 * No dibuja nada propio: arma un `FrameInput` con el viewport de detalle y las pistas que entran en el recuadro
 * (profundidad fija a la izquierda + ventana alrededor del puntero) y llama al MISMO `ViewerRenderer` del visor
 * (`drawBase` y, encima, `drawCursor`). Así la lupa hereda escalas (log en resistividad), rellenos, pilas, banderas, estilo
 * clásico/moderno, cortina y todas las superposiciones (zonas, tendencias, notas, MDT, corona…).
 *
 * Por cuadro: el viewport y el `FrameInput` se reescriben en el lugar y las columnas solo se rearman cuando el puntero
 * cruza a otra pista, cambian las pistas del visor o el ancho del recuadro. El tramo visible se recorta por búsqueda
 * binaria dentro del renderer (a 1:200, unas 120 muestras por curva con el pozo del TP).
 */
import { loupeColumns, loupeStart, setLoupeViewport, type LoupeColumns } from './loupe';
import type { TrackBox } from './layout';
import { ViewerRenderer, type FrameInput } from './render';
import type { ResolvedTrack } from './resolve';
import type { Viewport } from './viewport';

export class LoupePainter {
  private renderer = new ViewerRenderer();
  readonly viewport: Viewport = { top: 0, pxPerM: 1, height: 1 };
  /** Columnas vigentes (null hasta el primer `update`). */
  columns: LoupeColumns | null = null;
  private tracks: ResolvedTrack[] = [];
  private before: (ResolvedTrack | null)[] = [];
  private curtain = { x: 0, before: this.before as readonly (ResolvedTrack | null)[] };
  private frame: FrameInput | null = null;
  private keyBoxes: readonly TrackBox[] | null = null;
  private keyTracks: readonly ResolvedTrack[] | null = null;
  private keyBefore: readonly (ResolvedTrack | null)[] | null = null;
  private keyStart = -2;
  private keyWidth = -1;

  /** Olvida los buffers (pozo nuevo). */
  reset(): void {
    this.renderer.reset();
    this.keyTracks = null;
  }

  /**
   * Elige las pistas de la ventana para el puntero en `pointerX` (px del visor) y un recuadro de `width` px. Devuelve
   * true si cambiaron (hay que reescribir el encabezado de la lupa).
   */
  update(main: FrameInput, pointerX: number, width: number): boolean {
    let depthIndex = -1;
    for (let i = 0; i < main.tracks.length; i++) {
      if (main.tracks[i]!.kind === 'depth') {
        depthIndex = i;
        break;
      }
    }
    const dw = depthIndex >= 0 ? main.boxes[depthIndex]!.width : 0;
    const start = loupeStart(main.boxes, depthIndex, pointerX, width - dw);
    const before = main.curtain?.before ?? null;
    if (this.columns && start === this.keyStart && width === this.keyWidth && main.boxes === this.keyBoxes && main.tracks === this.keyTracks && before === this.keyBefore) return false;
    this.keyStart = start;
    this.keyWidth = width;
    this.keyBoxes = main.boxes;
    this.keyTracks = main.tracks;
    this.keyBefore = before;
    const cols = loupeColumns(main.boxes, depthIndex, start, width);
    this.columns = cols;
    this.tracks.length = 0;
    this.before.length = 0;
    if (depthIndex >= 0) {
      this.tracks.push(main.tracks[depthIndex]!);
      this.before.push(null);
    }
    for (const i of cols.indices) {
      this.tracks.push(main.tracks[i]!);
      this.before.push(before?.[i] ?? null);
    }
    return true;
  }

  /**
   * Dibuja la lupa centrada en `center` (m) a 1:`scale` en un canvas de `width` × `height` px CSS: el cuadro base y,
   * encima, el cursor (un solo canvas: menos superficies que rasterizar y componer en cada cuadro). Devuelve ms.
   */
  paint(ctx: CanvasRenderingContext2D, main: FrameInput, center: number, scale: number, width: number, height: number): number {
    const t0 = performance.now();
    const cols = this.columns;
    if (!cols) return 0;
    const vp = setLoupeViewport(this.viewport, center, scale, height);
    const f = (this.frame ??= { tracks: this.tracks, boxes: cols.boxes, viewport: vp, theme: main.theme, depth: main.depth, width, overlays: main.overlays, data: main.data });
    f.purpose = 'interactive';
    f.tracks = this.tracks;
    f.boxes = cols.boxes;
    f.viewport = vp;
    f.theme = main.theme;
    f.depth = main.depth;
    f.width = width;
    f.overlays = main.overlays;
    f.data = main.data;
    f.invalidate = main.invalidate;
    f.active = main.active ?? null;
    f.stackHints = main.stackHints;
    f.uiScale = main.uiScale;
    f.look = main.look;
    if (main.curtain) {
      // La cortina en coordenadas de la lupa: misma posición relativa a las pistas que en el visor.
      const dw = cols.depthIndex >= 0 ? cols.boxes[0]!.width : 0;
      this.curtain.x = main.curtain.x - cols.from + dw;
      this.curtain.before = this.before;
      f.curtain = this.curtain;
    } else f.curtain = undefined;
    this.renderer.drawBase(ctx, f);
    this.renderer.drawCursor(ctx, f, center, false);
    return performance.now() - t0;
  }
}
