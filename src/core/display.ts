/**
 * Configuración de visualización que se GUARDA en el proyecto (docs/decisiones/0005-visor-multipista.md, D3):
 * pistas propias por espacio de trabajo y overrides de escala/color por rol o por curva.
 *
 * Es JSON puro (sin typed arrays) y vive fuera de `Interpretation`: cambiarla no recalcula el motor ni entra en
 * los snapshots. Las plantillas de fábrica están en `src/viewer/templates.ts` (el núcleo no importa del visor).
 */
import { sanitizePlots, type WellPlots } from './plots';
import type { RoleId } from './roles';
import type { DimensionId } from './units';

export type ScaleKind = 'linear' | 'log';
export type LineStyleId = 'solid' | 'dashed' | 'dotted' | 'dashdot';

/** Cambios de dibujo de una curva. Todo opcional; rango en la unidad canónica del rol. */
export interface CurveDisplayOverride {
  scale?: ScaleKind;
  min?: number;
  max?: number;
  reversed?: boolean;
  /** Color CSS hex (#rrggbb). Si falta, el de la paleta del tema. */
  color?: string;
  line?: LineStyleId;
  width?: number;
  /** Curva de respaldo: lo que excede el máximo vuelve a entrar corrido un ancho de escala. */
  wrap?: boolean;
  /** Ocultar la curva en el visor. */
  hidden?: boolean;
}

/** Qué curvas toma una entrada de pista. */
export type CurveSelector =
  /** Curvas medidas con ese rol + la salida activa del módulo que produce ese puerto. */
  | { role: RoleId }
  /** Una curva puntual del pozo. */
  | { curveId: string }
  /** Curvas medidas sin rol de esa magnitud (p. ej. AT10/AT30 en ohm·m). */
  | { unassigned: DimensionId };

export interface TrackCurveSpec {
  select: CurveSelector;
  /** Opciones de la plantilla (por debajo de los overrides del usuario). */
  style?: CurveDisplayOverride;
}

/** Ids de relleno de la paleta (`FILL_PALETTE` de src/ui/curves.ts). Se guardan como texto. */
export type FillRef = string;

export type FillSpec =
  /** Entre el borde de la pista (`side`) y la curva. */
  | { kind: 'edge'; curve: RoleId; side: 'left' | 'right'; fill: FillRef; opacity?: number }
  /**
   * Entre dos curvas. `compare` decide qué lado es cuál:
   * - 'screen' (por defecto): posición EN PANTALLA. `aLeft` donde `a` queda a la izquierda de `b`, `bLeft` donde
   *   queda `b`. Es la convención del cruce densidad–neutrón (a = RHOB, b = NPHI → aLeft = gas, bLeft = arcilla), que
   *   solo tiene sentido en escalas compatibles.
   * - 'value': valores. `aLeft` donde a < b, `bLeft` donde b < a. Sigue siendo correcto si el usuario cambia la
   *   escala de una de las dos (caliper vs. trépano: a = BS, b = CALI, aLeft = derrumbe).
   */
  | { kind: 'between'; a: RoleId; b: RoleId; aLeft?: FillRef; bLeft?: FillRef; compare?: 'screen' | 'value'; opacity?: number }
  /** Entre la curva y un valor fijo (línea base): `left` donde la curva queda a la izquierda del valor. */
  | { kind: 'baseline'; curve: RoleId; value: number; left?: FillRef; right?: FillRef; opacity?: number };

/**
 * 'overlay': pista propia de una superposición (presiones MDT…), sin curvas; la dibuja `overlayId`.
 * 'stack': columna apilada de componentes que cierra a 1 (pista volumétrica, mineralogía), ver `StackSpec`.
 */
export type TrackKind = 'depth' | 'curves' | 'flags' | 'overlay' | 'stack';

/** Factor de un componente apilado: el valor de un rol, recortado a [0, 1], o su complemento (1 − valor). */
export interface StackFactor {
  role: RoleId;
  complement?: boolean;
}

/**
 * Componente de una pila. Su fracción (del total, o del padre si es hijo) es el producto de sus `factors`; un
 * componente `rest` es lo que falta para cerrar a 1 (a lo sumo uno por nivel). `children` parte al componente
 * (agua e hidrocarburo dentro de la porosidad). El orden de la lista es el orden de izquierda a derecha.
 */
export interface StackComponentSpec {
  id: string;
  label: string;
  /** Rótulo corto para encabezados angostos («Hidroc.»). */
  short?: string;
  fill: FillRef;
  factors?: StackFactor[];
  rest?: boolean;
  /** Resto cuando falta algún hermano (no se puede partir): etiqueta y relleno propios («Resto sin partir»). */
  partialLabel?: string;
  partialShort?: string;
  partialFill?: FillRef;
  children?: StackComponentSpec[];
}

/** Pila genérica por rol: la pista volumétrica de Petrofísica o una de mineralogía en Geología. */
export interface StackSpec {
  components: StackComponentSpec[];
}

export interface TrackSpec {
  id: string;
  title: string;
  kind: TrackKind;
  /** Ancho relativo (las de profundidad tienen ancho fijo). */
  width?: number;
  curves?: TrackCurveSpec[];
  fills?: FillSpec[];
  /** Escala de la grilla y de las curvas sin escala propia (curvas sin rol); en 'overlay', la escala de la pista. */
  scale?: { kind: ScaleKind; min: number; max: number; reversed?: boolean };
  /** Pistas 'overlay': id de la superposición que la dibuja. */
  overlayId?: string;
  /** Pistas 'overlay': unidad de la escala (texto para el encabezado). */
  unit?: string;
  /** Pistas 'stack': componentes de la columna. */
  stack?: StackSpec;
  /** Toma las curvas calculadas (o banderas) que ninguna otra pista ubicó. */
  collect?: 'computed' | 'flags';
  /** No se muestra si no tiene curvas. */
  hideWhenEmpty?: boolean;
  /** Texto del estado vacío (qué falta para que aparezcan curvas). */
  emptyHint?: string;
  /**
   * Pista quitada por el usuario que no se borra de la lista: las pistas propias de superposiciones (MDT) se
   * volverían a agregar solas si se borraran (docs/decisiones/0016, D3). No se dibuja ni entra en las figuras.
   */
  hidden?: boolean;
}

/** Plantilla de pistas guardada por el usuario (docs/decisiones/0016, D5). */
export interface TrackTemplate {
  id: string;
  name: string;
  /** Espacio de trabajo para el que se armó (el selector lista las del espacio activo). */
  workspace: string;
  tracks: TrackSpec[];
  /** ISO 8601 del último guardado. */
  savedAt?: string;
}

export interface DisplaySettings {
  /** Pistas propias por espacio de trabajo (ausente = plantilla de fábrica). */
  layouts: Record<string, TrackSpec[]>;
  /** Overrides por rol, para todo el proyecto. */
  roles: Record<RoleId, CurveDisplayOverride>;
  /** Overrides por curva: pozo → id de curva → override. */
  curves: Record<string, Record<string, CurveDisplayOverride>>;
  /**
   * Ajustes de las pistas propias de superposiciones, por id de superposición (p. ej. `{ mdt: { unit: 'bar' } }`).
   * Cada superposición interpreta sus claves (`OverlayTrackDecl.resolve`). Ausente = ninguno.
   */
  overlays?: Record<string, Record<string, string | number | boolean>>;
  /**
   * Configuración del histograma y del crossplot libre del dock, por pozo (docs/decisiones/0014). Ausente = valores
   * por defecto (proyectos guardados antes de la fase 7a).
   */
  plots?: Record<string, WellPlots>;
  /**
   * Plantillas de pistas propias con nombre (docs/decisiones/0016). Ausente = ninguna (proyectos anteriores a la
   * fase 7b). Aplicar una copia sus pistas a `layouts[espacio]`.
   */
  trackTemplates?: TrackTemplate[];
}

/**
 * Rango del ancho relativo de una pista (docs/decisiones/0016). Se acota al editar y al abrir un proyecto: un ancho
 * enorme (1e6) armaría un lienzo de millones de px y dejaría el visor en blanco.
 */
export const TRACK_WIDTH_RANGE = { min: 0.4, max: 4 } as const;
/** Paso de «más ancha / más angosta» (factor), igual en el menú, Alt+Mayús+flechas y el borde con el teclado. */
export const TRACK_WIDTH_STEP = 1.25;

/** Ancho relativo acotado a `TRACK_WIDTH_RANGE` y redondeado a centésimos. */
export const clampTrackWidth = (w: number): number => Math.round(Math.min(TRACK_WIDTH_RANGE.max, Math.max(TRACK_WIDTH_RANGE.min, w)) * 100) / 100;

export function emptyDisplay(): DisplaySettings {
  return { layouts: {}, roles: {}, curves: {} };
}

/** true si el override no cambia nada (para borrarlo en vez de guardarlo vacío). */
export function isEmptyOverride(o: CurveDisplayOverride | null | undefined): boolean {
  return !o || Object.values(o).every((v) => v === undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Validación al abrir un proyecto: lo inválido se descarta con un aviso (un archivo editado a mano o de una versión
// con errores no debe tirar abajo el visor).

const TRACK_KINDS = new Set<TrackKind>(['depth', 'curves', 'flags', 'overlay', 'stack']);
const FILL_KINDS = new Set(['edge', 'between', 'baseline']);
const LINES = new Set<LineStyleId>(['solid', 'dashed', 'dotted', 'dashdot']);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Override con solo los campos del tipo correcto (los demás se descartan). */
export function sanitizeOverride(raw: unknown): CurveDisplayOverride | null {
  if (!isObj(raw)) return null;
  const o: CurveDisplayOverride = {};
  if (raw['scale'] === 'linear' || raw['scale'] === 'log') o.scale = raw['scale'];
  if (isNum(raw['min'])) o.min = raw['min'];
  if (isNum(raw['max'])) o.max = raw['max'];
  if (typeof raw['reversed'] === 'boolean') o.reversed = raw['reversed'];
  if (typeof raw['color'] === 'string' && /^#[0-9a-f]{6}$/i.test(raw['color'])) o.color = raw['color'];
  if (LINES.has(raw['line'] as LineStyleId)) o.line = raw['line'] as LineStyleId;
  if (isNum(raw['width']) && raw['width'] > 0 && raw['width'] <= 8) o.width = raw['width'];
  if (typeof raw['wrap'] === 'boolean') o.wrap = raw['wrap'];
  if (typeof raw['hidden'] === 'boolean') o.hidden = raw['hidden'];
  return o;
}

function sanitizeSelector(raw: unknown): CurveSelector | null {
  if (!isObj(raw)) return null;
  if (isStr(raw['role'])) return { role: raw['role'] };
  if (isStr(raw['curveId'])) return { curveId: raw['curveId'] };
  if (isStr(raw['unassigned'])) return { unassigned: raw['unassigned'] as DimensionId };
  return null;
}

function sanitizeFill(raw: unknown): FillSpec | null {
  if (!isObj(raw) || !FILL_KINDS.has(raw['kind'] as string)) return null;
  const opacity = isNum(raw['opacity']) ? { opacity: raw['opacity'] } : {};
  const ref = (k: string) => (isStr(raw[k]) ? { [k]: raw[k] as string } : {});
  if (raw['kind'] === 'edge') {
    if (!isStr(raw['curve']) || (raw['side'] !== 'left' && raw['side'] !== 'right') || !isStr(raw['fill'])) return null;
    return { kind: 'edge', curve: raw['curve'], side: raw['side'], fill: raw['fill'], ...opacity };
  }
  if (raw['kind'] === 'between') {
    if (!isStr(raw['a']) || !isStr(raw['b'])) return null;
    const c = raw['compare'];
    const compare: { compare?: 'value' | 'screen' } = c === 'value' || c === 'screen' ? { compare: c } : {};
    return { kind: 'between', a: raw['a'], b: raw['b'], ...ref('aLeft'), ...ref('bLeft'), ...compare, ...opacity };
  }
  if (!isStr(raw['curve']) || !isNum(raw['value'])) return null;
  return { kind: 'baseline', curve: raw['curve'], value: raw['value'], ...ref('left'), ...ref('right'), ...opacity };
}

function sanitizeStackComponent(raw: unknown, depth = 0): StackComponentSpec | null {
  if (!isObj(raw) || !isStr(raw['id']) || typeof raw['label'] !== 'string' || !isStr(raw['fill']) || depth > 3) return null;
  const c: StackComponentSpec = { id: raw['id'], label: raw['label'], fill: raw['fill'] };
  if (Array.isArray(raw['factors'])) {
    const factors = raw['factors'].filter((f): f is Record<string, unknown> => isObj(f) && isStr(f['role']));
    c.factors = factors.map((f) => ({ role: f['role'] as string, ...(f['complement'] === true ? { complement: true } : {}) }));
  }
  if (typeof raw['short'] === 'string' && raw['short']) c.short = raw['short'];
  if (raw['rest'] === true) c.rest = true;
  if (typeof raw['partialLabel'] === 'string') c.partialLabel = raw['partialLabel'];
  if (typeof raw['partialShort'] === 'string' && raw['partialShort']) c.partialShort = raw['partialShort'];
  if (isStr(raw['partialFill'])) c.partialFill = raw['partialFill'];
  if (!c.rest && !c.factors?.length) return null; // sin factores ni resto no se puede calcular
  if (Array.isArray(raw['children'])) {
    const children = raw['children'].map((k) => sanitizeStackComponent(k, depth + 1)).filter((k): k is StackComponentSpec => !!k);
    if (children.length) c.children = children;
  }
  return c;
}

function sanitizeStack(raw: unknown): StackSpec | null {
  if (!isObj(raw) || !Array.isArray(raw['components'])) return null;
  const components = raw['components'].map((c) => sanitizeStackComponent(c)).filter((c): c is StackComponentSpec => !!c);
  return components.length ? { components } : null;
}

function sanitizeTrack(raw: unknown, where: string, warn: (m: string) => void): TrackSpec | null {
  if (!isObj(raw) || !isStr(raw['id']) || typeof raw['title'] !== 'string' || !TRACK_KINDS.has(raw['kind'] as TrackKind)) {
    warn(`${where}: pista inválida (falta id, título o tipo); se descarta.`);
    return null;
  }
  const kind = raw['kind'] as TrackKind;
  if (kind === 'overlay' && !isStr(raw['overlayId'])) {
    warn(`${where}: la pista '${raw['id']}' es de superposición pero no dice cuál; se descarta.`);
    return null;
  }
  const stack = kind === 'stack' ? sanitizeStack(raw['stack']) : null;
  if (kind === 'stack' && !stack) {
    warn(`${where}: la pista '${raw['id']}' es volumétrica pero sus componentes son inválidos; se descarta.`);
    return null;
  }
  const t: TrackSpec = { id: raw['id'], title: raw['title'], kind, ...(stack ? { stack } : {}) };
  if (isNum(raw['width']) && raw['width'] > 0) {
    t.width = clampTrackWidth(raw['width']);
    if (t.width !== raw['width']) warn(`${where}: la pista '${t.id}' tiene un ancho fuera de rango (${raw['width']}); se usa ${t.width}.`);
  }
  if (Array.isArray(raw['curves'])) {
    t.curves = [];
    raw['curves'].forEach((c, i) => {
      const select = isObj(c) ? sanitizeSelector(c['select']) : null;
      if (!select) {
        warn(`${where}, pista '${t.id}': la curva ${i + 1} no dice qué curva tomar; se descarta.`);
        return;
      }
      const style = isObj(c) ? sanitizeOverride(c['style']) : null;
      t.curves!.push({ select, ...(style && !isEmptyOverride(style) ? { style } : {}) });
    });
  }
  if (Array.isArray(raw['fills'])) {
    t.fills = [];
    raw['fills'].forEach((f, i) => {
      const fill = sanitizeFill(f);
      if (fill) t.fills!.push(fill);
      else warn(`${where}, pista '${t.id}': el relleno ${i + 1} es inválido; se descarta.`);
    });
  }
  const sc = raw['scale'];
  if (isObj(sc) && (sc['kind'] === 'linear' || sc['kind'] === 'log') && isNum(sc['min']) && isNum(sc['max'])) {
    t.scale = { kind: sc['kind'], min: sc['min'], max: sc['max'], ...(typeof sc['reversed'] === 'boolean' ? { reversed: sc['reversed'] } : {}) };
  }
  if (isStr(raw['overlayId'])) t.overlayId = raw['overlayId'];
  if (typeof raw['unit'] === 'string') t.unit = raw['unit'];
  if (raw['collect'] === 'computed' || raw['collect'] === 'flags') t.collect = raw['collect'];
  if (typeof raw['hideWhenEmpty'] === 'boolean') t.hideWhenEmpty = raw['hideWhenEmpty'];
  if (typeof raw['emptyHint'] === 'string') t.emptyHint = raw['emptyHint'];
  if (raw['hidden'] === true) t.hidden = true;
  return t;
}

/** Lista de pistas validada: descarta las inválidas y las de id repetido (con aviso). */
function sanitizeTrackList(tracks: unknown[], where: string, warn: (m: string) => void): TrackSpec[] {
  const list = tracks.map((t, i) => sanitizeTrack(t, `${where}, pista ${i + 1}`, warn)).filter((t): t is TrackSpec => !!t);
  const ids = new Set<string>();
  return list.filter((t) => {
    if (ids.has(t.id)) {
      warn(`${where}: la pista '${t.id}' está repetida; se descarta la segunda.`);
      return false;
    }
    ids.add(t.id);
    return true;
  });
}

/** Plantillas propias validadas: sin nombre, sin espacio o sin pistas válidas se descartan (con aviso). */
function sanitizeTemplates(raw: unknown, warn: (m: string) => void): TrackTemplate[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    warn('Las plantillas de pistas del proyecto no son una lista; se descartan.');
    return null;
  }
  const out: TrackTemplate[] = [];
  const ids = new Set<string>();
  raw.forEach((t, i) => {
    if (!isObj(t) || !isStr(t['id']) || typeof t['name'] !== 'string' || !t['name'].trim() || !isStr(t['workspace']) || !Array.isArray(t['tracks'])) {
      warn(`Plantilla de pistas ${i + 1}: le falta el id, el nombre, el espacio de trabajo o las pistas; se descarta.`);
      return;
    }
    if (ids.has(t['id'])) {
      warn(`Plantilla de pistas '${t['name']}': el id está repetido; se descarta la segunda.`);
      return;
    }
    const tracks = sanitizeTrackList(t['tracks'], `Plantilla '${t['name']}'`, warn);
    if (!tracks.length) {
      warn(`Plantilla de pistas '${t['name']}': no tiene pistas válidas; se descarta.`);
      return;
    }
    ids.add(t['id']);
    out.push({ id: t['id'], name: t['name'].trim(), workspace: t['workspace'], tracks, ...(typeof t['savedAt'] === 'string' ? { savedAt: t['savedAt'] } : {}) });
  });
  return out.length ? out : null;
}

/** Valida `display` leído de un archivo: devuelve solo lo válido y avisa lo que descartó. */
export function sanitizeDisplay(raw: unknown, warn: (message: string) => void = () => {}): DisplaySettings {
  const out = emptyDisplay();
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) {
    warn('La configuración del visor del proyecto es inválida; se usan las pistas de fábrica.');
    return out;
  }
  if (isObj(raw['layouts'])) {
    for (const [ws, tracks] of Object.entries(raw['layouts'])) {
      if (!Array.isArray(tracks)) {
        warn(`Pistas de '${ws}': no es una lista; se usan las de fábrica.`);
        continue;
      }
      out.layouts[ws] = sanitizeTrackList(tracks, `Pistas de '${ws}'`, warn);
    }
  }
  const overrides = (v: unknown, where: string): Record<string, CurveDisplayOverride> => {
    const r: Record<string, CurveDisplayOverride> = {};
    if (!isObj(v)) return r;
    for (const [k, o] of Object.entries(v)) {
      const clean = sanitizeOverride(o);
      if (clean && !isEmptyOverride(clean)) r[k] = clean;
      else warn(`${where} '${k}': override inválido; se descarta.`);
    }
    return r;
  };
  out.roles = overrides(raw['roles'], 'Estilo del rol');
  if (isObj(raw['curves'])) {
    for (const [wellId, v] of Object.entries(raw['curves'])) {
      const r = overrides(v, `Estilo de la curva del pozo '${wellId}'`);
      if (Object.keys(r).length) out.curves[wellId] = r;
    }
  }
  if (isObj(raw['overlays'])) {
    const overlays: Record<string, Record<string, string | number | boolean>> = {};
    for (const [id, v] of Object.entries(raw['overlays'])) {
      if (!isObj(v)) {
        warn(`Ajustes de la pista '${id}': no son un objeto; se descartan.`);
        continue;
      }
      const clean: Record<string, string | number | boolean> = {};
      for (const [k, x] of Object.entries(v)) if (typeof x === 'string' || typeof x === 'boolean' || isNum(x)) clean[k] = x;
      if (Object.keys(clean).length) overlays[id] = clean;
    }
    if (Object.keys(overlays).length) out.overlays = overlays;
  }
  const plots = sanitizePlots(raw['plots'], warn);
  if (plots) out.plots = plots;
  const templates = sanitizeTemplates(raw['trackTemplates'], warn);
  if (templates) out.trackTemplates = templates;
  return out;
}
