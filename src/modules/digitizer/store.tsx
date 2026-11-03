/**
 * Estado de la mesa de digitalización (zustand). NO es parte del proyecto: vive mientras la app está abierta (cerrar
 * la mesa no lo pierde) y se guarda aparte como archivo de sesión (docs/decisiones/0063).
 *
 * `work` (amarres y curvas, con sus trazas) tiene deshacer/rehacer PROPIO de la mesa: Ctrl+Z dentro de la mesa no
 * toca el proyecto. Un gesto (arrastrar un punto, pintar la traza) es un solo paso: `beginGesture` guarda el estado
 * de antes y los cambios del gesto se aplican con `record: false`.
 */
import { create } from 'zustand';
import type { ColorSuggestions, GeometryStep, Homography, PixelPoint, RasterImage, TraceMask } from '../../digitizer';
import { emptyWork, type WorkState } from './model/form';
import type { ImportChoice } from './model/outputs';
import type { StepId } from './model/steps';

export type Tool =
  | 'pan'
  | 'tilt'
  | 'quad'
  | 'tie'
  | 'edge-left'
  | 'edge-right'
  | 'eyedropper'
  | 'region'
  | 'guide'
  | 'paint'
  | 'erase'
  | 'add';

export type ViewMode = 'original' | 'corrected' | 'mask';

export interface LoadedImage {
  name: string;
  mime: string;
  /** Bytes del archivo tal como se cargó (se incrustan en la sesión). */
  bytes: Uint8Array;
  original: RasterImage;
  fingerprint: string;
}

export interface Job {
  label: string;
  /** 0–1, o null si no se conoce. */
  progress: number | null;
  cancellable: boolean;
}

/** Curvas que la mesa acaba de agregar al pozo activo (para ofrecer verlas en el visor). */
export interface AddedCurves {
  wellId: string;
  /** `scale`: la escala impresa de la pista del registro (bordes izquierdo y derecho), para la pista del visor. */
  curves: { curveId: string; mnemonic: string; scale: { kind: 'linear' | 'log'; min: number; max: number; reversed: boolean } }[];
  /** Ya se creó la pista en el visor. */
  shown: boolean;
}

const HISTORY_LIMIT = 100;

export interface DigitizerState {
  open: boolean;
  step: StepId;
  image: LoadedImage | null;
  /** Imagen corregida (= original si no hay geometría). */
  corrected: RasterImage | null;
  forward: Homography | null;
  geometry: GeometryStep[];
  geometrySkipped: boolean;
  /** Puntos marcados sobre la imagen ORIGINAL para la inclinación (2) y la perspectiva (4). */
  picks: { tilt: PixelPoint[]; quad: PixelPoint[] };
  work: WorkState;
  past: WorkState[];
  future: WorkState[];
  selectedCurveId: string | null;
  /** Amarre recién marcado (su campo de profundidad toma el foco). */
  focusTieId: string | null;
  tool: Tool;
  view: ViewMode;
  mask: { curveId: string; mask: TraceMask } | null;
  suggestions: Record<string, ColorSuggestions>;
  job: Job | null;
  reviewed: boolean;
  delivered: boolean;
  /** Última entrega al pozo activo (ausente si se creó un pozo nuevo o se exportó). */
  lastAdded: AddedCurves | null;
  importChoices: Record<string, ImportChoice>;
  target: 'active' | 'new';
  newWell: { name: string; step: number; unit: 'm' | 'ft' };
  exportStep: { step: number; unit: 'm' | 'ft' };
  /** Pedido de encuadre del lienzo (cambia el número = encuadrar). */
  fitSeq: number;
}

export interface DigitizerActions {
  set(patch: Partial<DigitizerState>): void;
  /** Cambia el estado de trabajo y lo registra en el deshacer de la mesa (salvo `record: false`). */
  updateWork(fn: (w: WorkState) => WorkState, opts?: { record?: boolean }): void;
  /** Guarda el estado actual como paso de deshacer (al empezar un gesto). */
  beginGesture(): void;
  undo(): boolean;
  redo(): boolean;
  /** Vuelve todo al estado inicial (otra imagen). */
  reset(keepOpen?: boolean): void;
}

export const initialDigitizerState = (): DigitizerState => ({
  open: false,
  step: 'image',
  image: null,
  corrected: null,
  forward: null,
  geometry: [],
  geometrySkipped: false,
  picks: { tilt: [], quad: [] },
  work: emptyWork(),
  past: [],
  future: [],
  selectedCurveId: null,
  focusTieId: null,
  tool: 'pan',
  view: 'corrected',
  mask: null,
  suggestions: {},
  job: null,
  reviewed: false,
  delivered: false,
  lastAdded: null,
  importChoices: {},
  target: 'active',
  newWell: { name: 'Pozo digitalizado', step: 0.1524, unit: 'm' },
  exportStep: { step: 0.1524, unit: 'm' },
  fitSeq: 0,
});

export const useDigitizer = create<DigitizerState & DigitizerActions>()((set, get) => ({
  ...initialDigitizerState(),
  set: (patch) => set(patch),
  updateWork(fn, opts) {
    const prev = get().work;
    const next = fn(prev);
    if (next === prev) return;
    if (opts?.record === false) set({ work: next });
    else set({ work: next, past: [...get().past, prev].slice(-HISTORY_LIMIT), future: [] });
  },
  beginGesture() {
    set({ past: [...get().past, get().work].slice(-HISTORY_LIMIT), future: [] });
  },
  undo() {
    const { past, work, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return false;
    set({ work: prev, past: past.slice(0, -1), future: [work, ...future] });
    return true;
  },
  redo() {
    const { past, work, future } = get();
    const next = future[0];
    if (!next) return false;
    set({ work: next, past: [...past, work], future: future.slice(1) });
    return true;
  },
  reset(keepOpen = true) {
    set({ ...initialDigitizerState(), open: keepOpen && get().open });
  },
}));

/** Clave de la imagen sobre la que se calibra y se traza, en el cliente del worker. */
export const workImageKey = (s: Pick<DigitizerState, 'geometry'>): string => (s.geometry.length ? 'corrected' : 'original');

export function openDigitizerDesk(): void {
  useDigitizer.setState({ open: true });
}
