/**
 * Estado de trabajo de la mesa (lo que la persona marca) y su traducción a los tipos del motor (docs/decisiones/0063).
 * Puro: sin DOM ni React. Todo lo que se deshace dentro de la mesa vive en `WorkState`.
 */
import {
  axisFromEdgeValues,
  buildDepthCalibration,
  checkDepthSpec,
  checkValueFrame,
  depthAtRow,
  metersToDepthUnit,
  rgbToLab,
  type CurveColorSpec,
  type DepthCalibration,
  type DepthCalibrationSpec,
  type DepthMethod,
  type DigitizerCurveSpec,
  type ImageDepthUnit,
  type PixelPoint,
  type RasterImage,
  type Region,
  type TracedCurve,
  type ValueFrame,
} from '../../../digitizer';
import type { RoleCatalog, RoleId } from '../../../core/roles';
import type { UnitId } from '../../../core/units';
import { suggestRole } from '../../../io/mnemonics';

export interface TieDraft {
  id: string;
  /** Fila de la imagen corregida (px, subpíxel). */
  y: number;
  /** Profundidad impresa en la unidad elegida; null mientras la persona no la escribe. */
  depth: number | null;
}

export type ScaleKind = 'linear' | 'log';

export interface CurveDraft {
  id: string;
  mnemonic: string;
  unit: UnitId;
  role: RoleId | null;
  description: string;
  /** Columnas de los bordes de la pista (imagen corregida). */
  leftPx: number | null;
  rightPx: number | null;
  leftValue: number;
  rightValue: number;
  scaleKind: ScaleKind;
  color: CurveColorSpec | null;
  /** Región de búsqueda; null = entre los bordes (con un margen) y en todo el alto calibrado. */
  region: Region | null;
  mode: 'auto' | 'guided';
  guide: PixelPoint[];
  corridor: number;
  /** Mediana móvil (ventana impar, 1 = apagada) y quitar picos: apagados por defecto. */
  median: number;
  despike: boolean;
  /** Trazo calculado y editado (filas de la imagen corregida). */
  trace: TracedCurve | null;
  /** Avisos del último trazado automático. */
  warnings: string[];
  /** Incluir en importar/exportar. */
  include: boolean;
}

export interface WorkState {
  depthUnit: ImageDepthUnit;
  method: DepthMethod;
  ties: TieDraft[];
  curves: CurveDraft[];
}

export const emptyWork = (): WorkState => ({ depthUnit: 'm', method: 'piecewise', ties: [], curves: [] });

let counter = 0;
export const draftId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(++counter).toString(36)}`;

// ---------------------------------------------------------------------------------------------------------------
// Profundidad

export function depthSpecOf(work: Pick<WorkState, 'depthUnit' | 'method' | 'ties'>): DepthCalibrationSpec {
  return {
    unit: work.depthUnit,
    method: work.method,
    ties: work.ties.filter((t) => t.depth !== null && Number.isFinite(t.depth)).map((t) => ({ y: t.y, depth: t.depth! })),
  };
}

export interface CalibrationState {
  calibration: DepthCalibration | null;
  /** Problemas que impiden calibrar (en español). */
  problems: string[];
  /** Amarres sin profundidad escrita. */
  pending: number;
}

export function calibrationOf(work: Pick<WorkState, 'depthUnit' | 'method' | 'ties'>): CalibrationState {
  const spec = depthSpecOf(work);
  const pending = work.ties.length - spec.ties.length;
  const problems = checkDepthSpec(spec);
  if (problems.length > 0) return { calibration: null, problems, pending };
  try {
    return { calibration: buildDepthCalibration(spec), problems: [], pending };
  } catch (e) {
    return { calibration: null, problems: [e instanceof Error ? e.message : String(e)], pending };
  }
}

/** Fila → profundidad en la UNIDAD de la imagen (para mostrar en vivo). NaN sin calibración. */
export function depthInImageUnit(cal: DepthCalibration | null, y: number): number {
  if (!cal) return NaN;
  return metersToDepthUnit(depthAtRow(cal, y), cal.unit);
}

// ---------------------------------------------------------------------------------------------------------------
// Curvas

export interface FrameState {
  frame: ValueFrame | null;
  problems: string[];
}

export function frameOf(c: Pick<CurveDraft, 'leftPx' | 'rightPx' | 'leftValue' | 'rightValue' | 'scaleKind'>): FrameState {
  if (c.leftPx === null || c.rightPx === null) return { frame: null, problems: ['Marcá los bordes izquierdo y derecho de la pista.'] };
  let scale;
  try {
    scale = axisFromEdgeValues(c.leftValue, c.rightValue, c.scaleKind);
  } catch (e) {
    return { frame: null, problems: [e instanceof Error ? e.message : String(e)] };
  }
  const frame: ValueFrame = { leftPx: c.leftPx, rightPx: c.rightPx, scale };
  const problems = checkValueFrame(frame);
  return problems.length ? { frame: null, problems } : { frame, problems: [] };
}

/** Región por defecto: entre los bordes con un margen de 3 px (el borde negro de la pista no es trazo) y todo el alto. */
export function regionOf(c: Pick<CurveDraft, 'leftPx' | 'rightPx' | 'region'>, image: { width: number; height: number }): Region | null {
  const clampR = (r: Region): Region => ({
    x0: Math.max(0, Math.floor(r.x0)),
    y0: Math.max(0, Math.floor(r.y0)),
    x1: Math.min(image.width, Math.ceil(r.x1)),
    y1: Math.min(image.height, Math.ceil(r.y1)),
  });
  if (c.region) return clampR(c.region);
  if (c.leftPx === null || c.rightPx === null) return null;
  const a = Math.min(c.leftPx, c.rightPx);
  const b = Math.max(c.leftPx, c.rightPx);
  return clampR({ x0: a + 3, y0: 0, x1: b - 2, y1: image.height });
}

export interface SpecState {
  spec: DigitizerCurveSpec | null;
  problems: string[];
}

/** Formulario → `DigitizerCurveSpec` del motor (o la lista de lo que falta, en español). */
export function specOf(c: CurveDraft, image: { width: number; height: number }): SpecState {
  const problems: string[] = [];
  const { frame, problems: fp } = frameOf(c);
  problems.push(...fp);
  if (!c.color) problems.push('Elegí el color del trazo (cuentagotas o colores sugeridos).');
  const region = regionOf(c, image);
  if (region && (region.x1 - region.x0 < 3 || region.y1 - region.y0 < 3)) problems.push('La región de búsqueda es demasiado chica.');
  if (c.mode === 'guided' && c.guide.length < 2) problems.push('Dibujá la guía: al menos 2 puntos sobre la curva.');
  if (problems.length || !frame || !region || !c.color) return { spec: null, problems };
  const spec: DigitizerCurveSpec = {
    id: c.id,
    mnemonic: c.mnemonic || c.id,
    unit: c.unit,
    ...(c.role ? { role: c.role } : {}),
    ...(c.description ? { description: c.description } : {}),
    frame,
    color: c.color,
    region,
    mode: c.mode,
    ...(c.mode === 'guided' ? { guide: { points: c.guide, corridor: c.corridor } } : {}),
  };
  return { spec, problems: [] };
}

/** Escala sugerida para un rol (rango típico del catálogo): valores de los bordes izquierdo y derecho y tipo. */
export function scaleForRole(role: RoleId | null, catalog: RoleCatalog): { leftValue: number; rightValue: number; scaleKind: ScaleKind } | null {
  const d = role ? catalog.get(role)?.display : undefined;
  if (!d || d.min === undefined || d.max === undefined) return null;
  return d.reversed ? { leftValue: d.max, rightValue: d.min, scaleKind: d.scale } : { leftValue: d.min, rightValue: d.max, scaleKind: d.scale };
}

/** Curva nueva con valores razonables (mnemónico → rol y unidad sugeridos, escala típica del rol). */
export function newCurveDraft(mnemonic: string, catalog: RoleCatalog, index = 0): CurveDraft {
  const sug = suggestRole(mnemonic);
  const role = sug.role;
  const unit: UnitId = sug.unit ?? (role ? catalog.get(role)?.unit ?? 'unitless' : 'unitless');
  const scale = scaleForRole(role, catalog) ?? { leftValue: 0, rightValue: 150, scaleKind: 'linear' as const };
  return {
    id: draftId('c'),
    mnemonic: mnemonic || `CURVA${index + 1}`,
    unit,
    role,
    description: '',
    leftPx: null,
    rightPx: null,
    ...scale,
    color: null,
    region: null,
    mode: 'auto',
    guide: [],
    corridor: 12,
    median: 1,
    despike: false,
    trace: null,
    warnings: [],
    include: true,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Color

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
export const rgbHex = (rgb: readonly [number, number, number]): string => `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;

/**
 * Cuentagotas: toma una ventana de (2r+1)² píxeles alrededor del clic y se queda con los más alejados del papel (al
 * menos el 60 % del contraste máximo, a lo sumo un cuarto de la ventana): el núcleo del trazo, no el anti-aliasing. Negro/gris oscuro (L* < 45 y croma < 25) → modo oscuro.
 * Devuelve null si en la ventana solo hay papel o grilla clara.
 */
export function pickColorAt(image: RasterImage, x: number, y: number, r = 3): { spec: CurveColorSpec; rgb: [number, number, number] } | null {
  const px: { rgb: [number, number, number]; d: number; L: number; C: number }[] = [];
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let j = cy - r; j <= cy + r; j++) {
    if (j < 0 || j >= image.height) continue;
    for (let i = cx - r; i <= cx + r; i++) {
      if (i < 0 || i >= image.width) continue;
      const k = (j * image.width + i) * 4;
      const rgb: [number, number, number] = [image.data[k]!, image.data[k + 1]!, image.data[k + 2]!];
      const [L, a, b] = rgbToLab(rgb[0], rgb[1], rgb[2]);
      const C = Math.hypot(a, b);
      px.push({ rgb, L, C, d: Math.hypot(100 - L, a, b) });
    }
  }
  if (px.length === 0) return null;
  px.sort((p, q) => q.d - p.d);
  // Papel o grilla gris clara (contraste < 20 respecto del blanco): no es un trazo.
  if (px[0]!.d < 20) return null;
  // Núcleo del trazo: los píxeles con al menos el 60 % del contraste máximo (a lo sumo un cuarto de la ventana).
  const core = px.filter((p) => p.d >= px[0]!.d * 0.6);
  const top = core.slice(0, Math.max(1, Math.ceil(px.length / 4)));
  const avg = (k: 0 | 1 | 2) => top.reduce((s, p) => s + p.rgb[k], 0) / top.length;
  const rgb: [number, number, number] = [Math.round(avg(0)), Math.round(avg(1)), Math.round(avg(2))];
  const L = top.reduce((s, p) => s + p.L, 0) / top.length;
  const C = top.reduce((s, p) => s + p.C, 0) / top.length;
  if (L < 45 && C < 25) return { spec: { mode: 'dark' }, rgb };
  return { spec: { mode: 'color', rgb }, rgb };
}

/** Color con que se pinta la curva en la interfaz: el de su tinta (oscuro → null: usar el color de texto del tema). */
export function inkColor(c: Pick<CurveDraft, 'color'>): string | null {
  return c.color?.mode === 'color' ? rgbHex(c.color.rgb) : null;
}

/**
 * Color de la traza dibujada ENCIMA de la imagen: el complementario saturado de la tinta (verde → magenta), para
 * distinguir la traza del trazo escaneado. Tinta oscura → naranja.
 */
export function overlayColor(c: Pick<CurveDraft, 'color'>): string {
  if (c.color?.mode !== 'color') return '#ff6a00';
  const [r, g, b] = c.color.rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  const hue = (h + 180 + 360) % 360;
  return `hsl(${hue.toFixed(0)} 95% 48%)`;
}

// ---------------------------------------------------------------------------------------------------------------
// Utilidades de la lista de curvas

export function updateCurve(work: WorkState, id: string, patch: Partial<CurveDraft>): WorkState {
  return { ...work, curves: work.curves.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Cambiar algo que define el trazado (bordes, color, región, guía, modo) invalida la traza calculada. */
export const TRACE_INPUTS: readonly (keyof CurveDraft)[] = ['leftPx', 'rightPx', 'color', 'region', 'mode', 'guide', 'corridor'];

/** Cambiar solo la escala NO invalida la traza (está en píxeles); cambia la serie que sale de ella. */
export function invalidatesTrace(patch: Partial<CurveDraft>): boolean {
  return TRACE_INPUTS.some((k) => k in patch && k !== 'leftPx' && k !== 'rightPx') || ('region' in patch);
}
