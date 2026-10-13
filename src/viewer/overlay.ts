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
import type { TrackSpec } from '../core/display';
import type { Interpretation } from '../core/interpretation';
import type { ReadonlyTableValue } from '../core/module';
import type { Project } from '../core/state/project';
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
  /** Tablas de la misma corrida que las curvas; evita recalcular resultados en las superposiciones. */
  tables?: readonly ViewerTable[];
  /**
   * La ÚNICA vía de escritura de una superposición de módulo: aplica una receta pura de `src/core/state/` con una
   * etiqueta en español («Descartar punto MDT»), igual que `useProject.getState().commit` (se deshace con Ctrl+Z).
   * Así un `src/modules/<id>/overlay.ts` cambia el proyecto sin importar los stores de la app. Ausente en tests o en un
   * visor de solo lectura.
   */
  commit?(label: string, recipe: (p: Project) => Project): void;
}

export interface ViewerTable {
  moduleId: string;
  port: string;
  active: boolean;
  value: ReadonlyTableValue;
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
  /**
   * Pistas 'overlay': unidad de su escala (id de `src/core/units.ts` si se puede convertir, p. ej. 'psi' o 'bar').
   * Quien dibuja una serie en otra unidad la convierte antes de `xOf` (las tendencias lo hacen solas).
   */
  unit?: string;
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
  /** Distingue interacción de exportación para omitir foco y selecciones transitorias en figuras. */
  purpose?: 'interactive' | 'export';
  theme: ThemeTokens;
  viewport: OverlayViewport;
  tracks: readonly OverlayTrack[];
  data: ViewerData;
  /** Pide redibujar el canvas base en el próximo cuadro (vista previa en vivo de un arrastre). */
  invalidate(): void;
  /**
   * Elemento activo (llegado con Tab o con el último clic/arrastre), si dio una `key`: su dueño lo resalta. Las
   * superposiciones de otro `overlayId` lo ignoran.
   */
  active?: { overlayId: string; key: string } | null;
  /**
   * Factor del tamaño de interfaz (1 = Compacto; docs/decisiones/0013). Multiplicar por él los rótulos, sus cajas y las
   * tolerancias de puntero (`scalePx(BASE_TOKENS.text.xs, frame.uiScale ?? 1)`), nunca posiciones de datos. Ausente o
   * 1 en las figuras exportadas, que no dependen del tamaño elegido.
   */
  uiScale?: number;
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
  /**
   * Mayús apretada en el último evento del puntero (fase 8b, 0021): una superposición puede ofrecer un gesto con
   * modificador (Mayús + arrastre marca un tramo para los gráficos). Ausente en tests y en el teclado.
   */
  shiftKey?: boolean;
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
  /** Texto del tooltip (y nombre accesible si el elemento es un `target`). */
  label: string;
  /** Identidad estable del elemento (la misma en `hit` y en `targets`): el visor la pasa en `frame.active`. */
  key?: string;
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

/**
 * Elemento al que se llega con el TECLADO. El visor crea un botón accesible por cada uno (en orden de
 * profundidad, después del cuerpo del visor): Tab los recorre, al enfocarlo lo trae a la vista y lo deja activo
 * (↑/↓ llaman a `hit.nudge`, Enter a `hit.activate`), y su nombre accesible es `hit.label`.
 */
export interface OverlayTarget {
  /** Profundidad del elemento (m): ordena el recorrido y ubica el foco. */
  depth: number;
  /** Lo mismo que devolvería `hit` sobre el elemento; `hit.key` es obligatoria acá. */
  hit: OverlayHit & { key: string };
}

/** Lo que una pista propia puede leer para elegir su escala: el pozo activo y los ajustes guardados de la pista. */
export interface OverlayTrackContext {
  well: Readonly<Well>;
  /** Ajustes de la pista que eligió el usuario (p. ej. `{ unit: 'bar' }`), guardados en `project.display.overlays[id]`. */
  settings: Readonly<Record<string, string | number | boolean>>;
}

/** Escala, unidad y título de una pista propia resueltos para el pozo activo. */
export interface OverlayTrackState {
  scale: { kind: 'linear' | 'log'; min: number; max: number; reversed?: boolean };
  unit?: string;
  title?: string;
}

/** Pista propia de una superposición (p. ej. presión vs. profundidad). El visor la agrega a las pistas activas. */
export interface OverlayTrackDecl {
  /** Rótulos categóricos, posición relativa al ancho completo de pista. Reemplazan los extremos numéricos. */
  axisLabels?: readonly { position: number; label: string }[];
  headerLabel?: string;
  /** Pista declarativa opcional: usa el renderizador nativo (pila, curvas, banderas) en lugar de dibujo propio. */
  spec?: TrackSpec;
  title: string;
  /** Escala horizontal de la pista (grilla, extremos del encabezado, `xOf(null, v)`). Respaldo de `resolve`. */
  scale: { kind: 'linear' | 'log'; min: number; max: number; reversed?: boolean };
  unit?: string;
  /**
   * Escala automática según los datos del pozo y unidad elegida por el usuario (presiones MDT: rango de las
   * presiones, psi/bar/kPa). null = la pista no se muestra (el pozo no tiene esos datos). Se llama al resolver las
   * pistas (cuando cambian el pozo o la configuración del visor), no en cada cuadro.
   */
  resolve?(ctx: OverlayTrackContext): OverlayTrackState | null;
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
  /** Elementos navegables con el teclado (topes, plugs, puntos de presión). Ver OverlayTarget. */
  targets?(frame: OverlayHitFrame): OverlayTarget[];
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
