/**
 * Descripción PURA de la escena 3D de la sarta (docs/decisiones/0033, D2–D5): sin three.js ni DOM, testeable con
 * Vitest. `buildToolStringScene` recibe la sarta resuelta (0032 D8), el diámetro del pozo, la selección y los colores
 * del tema, y devuelve primitivas que `render3d.ts` traduce a mallas.
 *
 * Escala (D2): una unidad de escena = 1 cm en dirección radial (radios de herramientas, pozo y profundidades de
 * investigación a escala real entre sí); en dirección axial, 1 m de herramienta = `AXIAL_SCENE_PER_M` unidades
 * (compresión uniforme 10:1). El eje del pozo es el eje y (arriba = y mayor); la sarta empieza en y = 0 y baja.
 *
 * Ángulos: los de `CylinderGeometry` de three (θ = 0 apunta a +z, θ = π/2 a +x). El cuarto recortado de la formación es
 * θ ∈ [0, π/2] (mira a la cámara inicial); lo apoyado contra la pared va hacia `LEAN_AZIMUTH`, de perfil para la cámara.
 */
import { sameDimension, convert, type UnitId } from '../../core/units';
import type { RoleId } from '../../core/roles';
import type { ToolStringEntry } from '../../core/toolString';
import { sheetOf, type ToolDef, type ToolFamily } from '../../core/tools';
import type { SheetQuantity, ToolMounting, ToolSheet } from '../../core/toolSheets';
import { formatNumber } from '../../ui/format';
import type { SceneColors } from '../../ui/tokens';

// ---------------------------------------------------------------------------------------------------------------
// Constantes de escala y medidas esquemáticas

export const CM_PER_IN = 2.54;
/** Compresión axial: 1 m de herramienta = 10 unidades (10 cm) de escena. */
export const AXIAL_COMPRESSION = 10;
export const AXIAL_SCENE_PER_M = 100 / AXIAL_COMPRESSION;
/** Largo esquemático de una herramienta sin largo en la ficha (no es un dato: la ficha lo marca «esquemático»). */
export const GENERIC_LENGTH_M = 3;
/** Diámetro esquemático de una herramienta sin diámetro en la ficha. */
export const GENERIC_DIAMETER_IN = 3.625;
/** Largo esquemático de las piezas sin cuerpo propio (electrodo del SP, calibre sin densidad, temperatura). */
export const SUB_LENGTH_M = 1;
/** Pozo esquemático cuando el pozo no tiene trépano ni calibre. */
export const DEFAULT_BOREHOLE_IN = 8.5;
/** Cabeza de cable (pieza fija, esquemática). */
export const HEAD_LENGTH_M = 1.2;
/** Separación entre herramientas (unión articulada), en unidades de escena. */
export const JOINT_GAP = 2;
/** Lado al que se apoyan las herramientas excentralizadas y los patines (de perfil para la cámara inicial). */
export const LEAN_AZIMUTH = (3 * Math.PI) / 4;
/** Cuarto recortado de la formación: [inicio, largo] en θ. */
export const CUT_WEDGE: readonly [number, number] = [0, Math.PI / 2];
/** Herramientas que son una pieza chica sin cuerpo propio en la sarta real. */
const SUB_TOOLS: ReadonlySet<string> = new Set(['sp', 'caliper', 'temperature']);
/** Herramientas de resistividad sobre las que va el electrodo del SP (en este orden de preferencia: la primera de la sarta). */
const SP_HOSTS: ReadonlySet<string> = new Set(['induction', 'laterolog']);

/** Dirección horizontal de un ángulo (convención de three: θ = 0 → +z). */
export function dir(theta: number): [number, number] {
  return [Math.sin(theta), Math.cos(theta)];
}

// ---------------------------------------------------------------------------------------------------------------
// Tipos de la descripción

export type Vec3 = readonly [number, number, number];
/** Qué se selecciona al tocar la pieza: una herramienta, o una pieza fija que solo dice qué es. */
export type Pick = { toolId: string } | { fixed: string };
/**
 * Aspecto de un cuerpo: `metal` (piezas fijas), `on`, `off` (gris translúcido), `ghost` (planificada sin datos: casi
 * transparente con aristas).
 */
export type BodyLook = 'metal' | 'on' | 'off' | 'ghost';
export type Emphasis = 'none' | 'hover' | 'selected';

export interface Style {
  color: string;
  opacity: number;
  look: BodyLook;
  emphasis: Emphasis;
  /** Color de las aristas (solo `ghost` y seleccionadas). */
  edge?: string;
}

interface Base {
  /** Clave estable (el renderizador reutiliza la malla si la geometría no cambia). */
  key: string;
  pick?: Pick;
}

export type ScenePrimitive =
  | (Base & { kind: 'cylinder'; center: readonly [number, number]; y0: number; y1: number; radius: number; style: Style })
  | (Base & { kind: 'pad'; azimuth: number; halfAngle: number; rInner: number; rOuter: number; y0: number; y1: number; style: Style })
  | (Base & { kind: 'rod'; from: Vec3; to: Vec3; radius: number; style: Style })
  | (Base & { kind: 'bow'; center: readonly [number, number]; azimuth: number; rIn: number; rOut: number; y0: number; y1: number; radius: number; style: Style })
  | (Base & { kind: 'ring'; center: readonly [number, number]; y: number; radius: number; height: number; style: Style });

/** Cáscara de profundidad de investigación de una curva: losa en el cuarto recortado, de la pared hasta `radius`. */
export interface ShellPrimitive {
  key: string;
  toolId: string;
  role: RoleId | null;
  /** Profundidad de investigación desde la pared (cm) y el radio resultante desde el eje (cm). */
  doiCm: number;
  radius: number;
  rWall: number;
  y0: number;
  y1: number;
  color: string;
  opacity: number;
  unverified: boolean;
}

/** Rango mínimo–máximo de la ficha como banda difusa: opacidad máxima en `rPeak`, cero en `rMin` y `rMax`. */
export interface BandPrimitive {
  key: string;
  toolId: string;
  rMin: number;
  rPeak: number;
  rMax: number;
  y0: number;
  y1: number;
  color: string;
  opacity: number;
}

export interface EnvironmentDesc {
  rWall: number;
  rOuter: number;
  y0: number;
  y1: number;
  wedge: readonly [number, number];
  colors: Pick2<SceneColors, 'formation' | 'formationAlt' | 'formationCut' | 'wall' | 'mud'>;
  /** Cable desde la cabeza hasta arriba de la formación. */
  cable: { from: Vec3; to: Vec3; radius: number; color: string };
}
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

export interface SceneLabel {
  key: string;
  text: string;
  position: Vec3;
  kind: 'tick' | 'shell' | 'tool';
  color?: string;
}

export interface RulerDesc {
  /** Desde la pared (0) hacia afuera, sobre el borde superior de la cara del corte en θ = π/2 (+x). */
  y: number;
  rWall: number;
  rEnd: number;
  ticks: { r: number; label: string }[];
  color: string;
}

/** Medidas con las que se dibujó cada herramienta (la ficha las muestra con su marca). */
export interface ToolLayout {
  toolId: string;
  y0: number;
  y1: number;
  center: readonly [number, number];
  radius: number;
  lengthM: number;
  diameterIn: number;
  /** El largo / el diámetro no salen de la ficha: valor genérico. */
  schematicLength: boolean;
  schematicDiameter: boolean;
  mounting: ToolMounting | 'sub';
  /** Pieza dibujada sobre otra (SP sobre la resistividad, calibre como brazo de la densidad). */
  hostId?: string;
}

export interface ToolStringScene {
  primitives: ScenePrimitive[];
  shells: ShellPrimitive[];
  bands: BandPrimitive[];
  environment: EnvironmentDesc;
  ruler: RulerDesc;
  labels: SceneLabel[];
  tools: ToolLayout[];
  /** Caja que encierra todo (para la vista inicial). */
  bounds: { min: Vec3; max: Vec3 };
  boreholeDiameterIn: number;
  boreholeSchematic: boolean;
}

export interface SceneInput {
  /** Sarta resuelta, arriba → abajo (`resolveToolString(...).entries`). */
  entries: readonly ToolStringEntry[];
  mode: 'data' | 'planning';
  borehole: { diameterIn: number; schematic: boolean };
  selectedId?: string | null;
  hoverId?: string | null;
  colors: SceneColors;
  /** Color de acento (selección). */
  accent: string;
  /** Color de la curva de un rol en el visor (`curveStyle`). */
  curveColor: (role: RoleId) => string;
  /** Ficha de una herramienta (por defecto `sheetOf`). */
  sheet?: (tool: ToolDef) => ToolSheet;
}

// ---------------------------------------------------------------------------------------------------------------
// Medidas

/** Una magnitud de la ficha en otra unidad de longitud (undefined si no hay valor). */
export function quantityIn(q: SheetQuantity | undefined, key: 'typical' | 'min' | 'max', to: UnitId): number | undefined {
  const v = q?.[key];
  if (v === undefined || !q || !sameDimension(q.unit, to)) return undefined;
  return convert(v, q.unit, to);
}

/** Diámetro del pozo para el dibujo: mediana del trépano (BS); si no, del calibre; si no, 8,5 in esquemático. */
export function boreholeDiameter(curves: readonly { role: RoleId | null; unit: UnitId; data: ArrayLike<number> }[]): { diameterIn: number; schematic: boolean; source: 'BS' | 'CALI' | null } {
  for (const role of ['BS', 'CALI'] as const) {
    const c = curves.find((x) => x.role === role && sameDimension(x.unit, 'in'));
    if (!c) continue;
    const vals: number[] = [];
    for (let i = 0; i < c.data.length; i++) {
      const v = c.data[i]!;
      if (Number.isFinite(v)) vals.push(v);
    }
    if (!vals.length) continue;
    vals.sort((a, b) => a - b);
    const med = convert(vals[Math.floor(vals.length / 2)]!, c.unit, 'in');
    if (med > 2 && med < 40) return { diameterIn: med, schematic: false, source: role };
  }
  return { diameterIn: DEFAULT_BOREHOLE_IN, schematic: true, source: null };
}

const FAMILY_KEY: Record<ToolFamily, keyof SceneColors> = {
  gamma: 'familyGamma',
  nuclear: 'familyNuclear',
  resistivity: 'familyResistivity',
  acoustic: 'familyAcoustic',
  nmr: 'familyNmr',
  borehole: 'familyBorehole',
  other: 'familyOther',
};

/** Profundidades de investigación a dibujar: una por curva si la ficha las tiene, si no la de la herramienta. */
export function shellSpecs(tool: ToolDef, sheet: ToolSheet): { role: RoleId | null; doiIn: number }[] {
  const out: { role: RoleId | null; doiIn: number }[] = [];
  for (const role of tool.roles) {
    const v = quantityIn(sheet.investigationByRole?.[role], 'typical', 'in');
    if (v !== undefined && v > 0) out.push({ role, doiIn: v });
  }
  // Curvas de la ficha que no estén en `tool.roles` (herramientas de módulos): también.
  for (const [role, q] of Object.entries(sheet.investigationByRole ?? {})) {
    if (tool.roles.includes(role)) continue;
    const v = quantityIn(q, 'typical', 'in');
    if (v !== undefined && v > 0) out.push({ role, doiIn: v });
  }
  if (!out.length) {
    const v = quantityIn(sheet.investigation, 'typical', 'in');
    if (v !== undefined && v > 0) out.push({ role: null, doiIn: v });
  }
  return out.sort((a, b) => a.doiIn - b.doiIn);
}

// ---------------------------------------------------------------------------------------------------------------
// Construcción

const PAD_THICKNESS = 1.4;
const PAD_HALF_ANGLE = (26 * Math.PI) / 180;
const SHELL_OPACITY = 0.2;
const GHOST_SHELL_FACTOR = 0.55;
const BAND_OPACITY = 0.22;

export function buildToolStringScene(input: SceneInput): ToolStringScene {
  const { colors } = input;
  const sheetFor = input.sheet ?? sheetOf;
  const rWall = (input.borehole.diameterIn * CM_PER_IN) / 2;
  const primitives: ScenePrimitive[] = [];
  const shells: ShellPrimitive[] = [];
  const bands: BandPrimitive[] = [];
  const labels: SceneLabel[] = [];
  const layouts: ToolLayout[] = [];
  const ids = new Set(input.entries.map((e) => e.tool.id));
  const lean = dir(LEAN_AZIMUTH);

  const emphasisOf = (id: string): Emphasis => (input.selectedId === id ? 'selected' : input.hoverId === id ? 'hover' : 'none');
  const lookOf = (e: ToolStringEntry): BodyLook => (!e.on ? 'off' : input.mode === 'planning' && !e.hasData ? 'ghost' : 'on');
  const styleOf = (e: ToolStringEntry, base: string): Style => {
    const look = lookOf(e);
    const emphasis = emphasisOf(e.tool.id);
    const color = emphasis === 'selected' ? input.accent : look === 'off' ? colors.off : base;
    const opacity = look === 'off' ? 0.38 : look === 'ghost' ? 0.16 : 1;
    const edge = look === 'ghost' ? (emphasis === 'selected' ? input.accent : colors.outline) : emphasis === 'selected' ? input.accent : undefined;
    return { color, opacity, look, emphasis, ...(edge ? { edge } : {}) };
  };
  const metal = (color: string): Style => ({ color, opacity: 1, look: 'metal', emphasis: 'none' });

  // Cabeza de cable (fija).
  const headLen = HEAD_LENGTH_M * AXIAL_SCENE_PER_M;
  const headR = Math.min((GENERIC_DIAMETER_IN * CM_PER_IN) / 2, rWall * 0.85);
  primitives.push({ kind: 'cylinder', key: 'head', pick: { fixed: 'Cabeza de cable y telemetría' }, center: [0, 0], y0: -headLen, y1: 0, radius: headR, style: metal(colors.steel) });
  primitives.push({ kind: 'cylinder', key: 'head-neck', pick: { fixed: 'Cabeza de cable y telemetría' }, center: [0, 0], y0: 0, y1: 3, radius: headR * 0.55, style: metal(colors.steelDark) });
  let cursor = -headLen - JOINT_GAP;
  let prevCenter: [number, number] = [0, 0];
  let prevBottom = -headLen;

  // Pieza anfitriona del SP y del calibre.
  const spHost = input.entries.find((e) => SP_HOSTS.has(e.tool.id))?.tool.id;
  const caliperHost = ids.has('density') ? 'density' : undefined;

  for (const e of input.entries) {
    const tool = e.tool;
    const sheet = sheetFor(tool);
    const isSub = SUB_TOOLS.has(tool.id);
    // Piezas dibujadas sobre otra: se ubican después, cuando la anfitriona tiene lugar.
    if ((tool.id === 'sp' && spHost) || (tool.id === 'caliper' && caliperHost)) continue;

    const lenM = quantityIn(sheet.length, 'typical', 'm');
    const diaIn = quantityIn(sheet.diameter, 'typical', 'in');
    const lengthM = lenM ?? (isSub ? SUB_LENGTH_M : GENERIC_LENGTH_M);
    const diameterIn = diaIn ?? GENERIC_DIAMETER_IN;
    const len = lengthM * AXIAL_SCENE_PER_M;
    // Una herramienta más gruesa que el pozo no entra: se dibuja al 90 % del radio del pozo.
    const radius = Math.min((diameterIn * CM_PER_IN) / 2, rWall * 0.9);
    const mounting: ToolMounting | 'sub' = isSub && !sheet.mounting ? 'sub' : (sheet.mounting ?? 'centralized');
    const y1 = cursor;
    const y0 = cursor - len;
    const offset = mounting === 'eccentralized' ? rWall - radius : mounting === 'pad' ? Math.max(0, rWall - radius - PAD_THICKNESS) : 0;
    const center: [number, number] = offset ? [lean[0] * offset, lean[1] * offset] : [0, 0];
    const pick = { toolId: tool.id };
    const style = styleOf(e, colors[FAMILY_KEY[tool.family] ?? 'familyOther']);

    // Unión con la pieza de arriba.
    primitives.push({ kind: 'rod', key: `joint:${tool.id}`, from: [prevCenter[0], prevBottom, prevCenter[1]], to: [center[0], y1, center[1]], radius: Math.min(radius, headR) * 0.45, style: metal(colors.steelDark) });
    primitives.push({ kind: 'cylinder', key: `body:${tool.id}`, pick, center, y0, y1, radius, style });

    if (mounting === 'pad') addPad(tool.id, center, radius, y0, y1, e, 'arm');
    if (mounting === 'centralized') {
      // Centralizador de flejes arriba de la herramienta (pieza fija).
      const bowLen = Math.min(len * 0.45, 16);
      for (let k = 0; k < 4; k++) {
        const az = Math.PI / 4 + (k * Math.PI) / 2;
        primitives.push({
          kind: 'bow',
          key: `bow:${tool.id}:${k}`,
          pick: { fixed: 'Centralizador de flejes' },
          center,
          azimuth: az,
          rIn: radius,
          rOut: rWall - 0.25,
          y0: y1 - 1.5 - bowLen,
          y1: y1 - 1.5,
          radius: 0.35,
          style: metal(colors.steel),
        });
      }
    }

    // Profundidad de investigación (las apagadas no miden: sin cáscaras).
    if (e.on) addShells(tool, sheet, y0, y1, lookOf(e) === 'ghost');

    layouts.push({ toolId: tool.id, y0, y1, center, radius, lengthM, diameterIn, schematicLength: lenM === undefined, schematicDiameter: diaIn === undefined, mounting });
    prevCenter = center;
    prevBottom = y0;
    cursor = y0 - JOINT_GAP;
  }

  // Electrodo del SP sobre la herramienta de resistividad.
  const sp = input.entries.find((e) => e.tool.id === 'sp');
  if (sp && spHost) {
    const host = layouts.find((l) => l.toolId === spHost)!;
    const y = host.y0 + (host.y1 - host.y0) * 0.78;
    const style = styleOf(sp, colors.familyResistivity);
    primitives.push({ kind: 'ring', key: 'ring:sp', pick: { toolId: 'sp' }, center: host.center, y, radius: host.radius + 0.45, height: 2.2, style: { ...style, opacity: Math.max(style.opacity, 0.55), color: style.emphasis === 'none' && style.look === 'on' ? colors.pad : style.color } });
    layouts.push({ toolId: 'sp', y0: y - 1.1, y1: y + 1.1, center: host.center, radius: host.radius + 0.45, lengthM: 0, diameterIn: (host.radius + 0.45) * 2 / CM_PER_IN, schematicLength: true, schematicDiameter: true, mounting: 'sub', hostId: spHost });
  }
  // Calibre como brazo de la densidad.
  const cal = input.entries.find((e) => e.tool.id === 'caliper');
  if (cal && caliperHost) {
    const host = layouts.find((l) => l.toolId === caliperHost)!;
    addArm('caliper', host.center, host.radius, host.y0, host.y1, cal);
    layouts.push({ toolId: 'caliper', y0: host.y0, y1: host.y1, center: host.center, radius: host.radius, lengthM: 0, diameterIn: 0, schematicLength: true, schematicDiameter: true, mounting: 'pad', hostId: caliperHost });
  }

  const bottom = layouts.length ? Math.min(...layouts.map((l) => l.y0)) : -headLen;
  const maxShell = Math.max(rWall, ...shells.map((s) => s.radius), ...bands.map((b) => b.rMax), ...allShellRadii());
  const rOuter = Math.max(rWall + 45, maxShell + 25);
  const formTop = 22;
  const formBottom = bottom - 18;
  const environment: EnvironmentDesc = {
    rWall,
    rOuter,
    y0: formBottom,
    y1: formTop,
    wedge: CUT_WEDGE,
    colors: { formation: colors.formation, formationAlt: colors.formationAlt, formationCut: colors.formationCut, wall: colors.wall, mud: colors.mud },
    cable: { from: [0, 3, 0], to: [0, formTop + 70, 0], radius: 0.65, color: colors.cable },
  };

  // Regla radial desde la pared, sobre el borde superior de la cara del corte en +x.
  const ruler: RulerDesc = { y: formTop + 0.6, rWall, rEnd: rOuter, ticks: [], color: colors.ruler };
  for (const [cm, label] of [
    [0, 'pared'],
    [10, '10 cm'],
    [50, '50 cm'],
    [100, '1 m'],
    [200, '2 m'],
  ] as const) {
    if (rWall + cm > rOuter - 2) continue;
    ruler.ticks.push({ r: rWall + cm, label });
    labels.push({ key: `tick:${cm}`, text: label, position: [rWall + cm, ruler.y, 0], kind: 'tick' });
  }

  // Rótulo de la seleccionada y de sus cáscaras.
  const sel = input.selectedId ? layouts.find((l) => l.toolId === input.selectedId) : undefined;
  if (sel) {
    const t = input.entries.find((e) => e.tool.id === sel.toolId)!.tool;
    // En el eje de la herramienta: la vista lo corre a la izquierda en pantalla.
    labels.push({ key: `tool:${t.id}`, text: t.name, position: [sel.center[0], (sel.y0 + sel.y1) / 2, sel.center[1]], kind: 'tool' });
    for (const s of shells.filter((x) => x.toolId === sel.toolId)) {
      const [x, z] = dir(Math.PI / 4);
      labels.push({
        key: `shell:${s.key}`,
        text: `${s.role ?? t.short} · ${formatNumber(s.doiCm / CM_PER_IN, { significant: 3, grouping: false })} in`,
        position: [x * s.radius, s.y1, z * s.radius],
        kind: 'shell',
        color: s.color,
      });
    }
  }

  const bounds = { min: [-rOuter, formBottom, -rOuter] as Vec3, max: [rOuter, formTop, rOuter] as Vec3 };
  return { primitives, shells, bands, environment, ruler, labels, tools: layouts, bounds, boreholeDiameterIn: input.borehole.diameterIn, boreholeSchematic: input.borehole.schematic };

  // -------------------------------------------------------------------------------------------------------------

  /** Radios de todas las cáscaras posibles de la sarta (también de las apagadas): la formación no cambia de tamaño al apagar. */
  function allShellRadii(): number[] {
    return input.entries.flatMap((e) => {
      const sh = sheetFor(e.tool);
      const max = quantityIn(sh.investigation, 'max', 'in');
      return [...shellSpecs(e.tool, sh).map((s) => s.doiIn), ...(max ? [max] : [])].map((d) => rWall + d * CM_PER_IN);
    });
  }

  function addPad(toolId: string, center: readonly [number, number], radius: number, y0: number, y1: number, e: ToolStringEntry, armKey: string): void {
    const len = y1 - y0;
    const padY0 = y0 + len * 0.22;
    const padY1 = y1 - len * 0.22;
    const st = styleOf(e, colors.pad);
    primitives.push({
      kind: 'pad',
      key: `pad:${toolId}`,
      pick: { toolId },
      azimuth: LEAN_AZIMUTH,
      halfAngle: PAD_HALF_ANGLE,
      rInner: rWall - PAD_THICKNESS,
      rOuter: rWall - 0.08,
      y0: padY0,
      y1: padY1,
      style: st.emphasis === 'none' && st.look === 'on' ? { ...st, color: colors.pad } : st,
    });
    // Brazos que empujan el patín (cortos, del cuerpo al patín).
    for (const f of [0.3, 0.7]) {
      const y = padY0 + (padY1 - padY0) * f;
      const from: Vec3 = [center[0] + lean[0] * radius * 0.9, y, center[1] + lean[1] * radius * 0.9];
      const to: Vec3 = [lean[0] * (rWall - PAD_THICKNESS), y, lean[1] * (rWall - PAD_THICKNESS)];
      if (Math.hypot(to[0] - from[0], to[2] - from[2]) > 0.2) primitives.push({ kind: 'rod', key: `pad-link:${toolId}:${f}`, pick: { toolId }, from, to, radius: 0.35, style: metal(colors.steelDark) });
    }
    // Brazo de respaldo hasta la pared opuesta (en la densidad es el calibre; se dibuja aparte si el calibre está).
    if (!(toolId === 'density' && ids.has('caliper'))) addArm(toolId, center, radius, y0, y1, e, armKey);
  }

  /** Brazo de respaldo: del cuerpo a la pared opuesta al patín. */
  function addArm(toolId: string, center: readonly [number, number], radius: number, y0: number, y1: number, e: ToolStringEntry, key = 'arm'): void {
    const len = y1 - y0;
    const back = dir(LEAN_AZIMUTH + Math.PI);
    const from: Vec3 = [center[0] + back[0] * radius * 0.8, y0 + len * 0.72, center[1] + back[1] * radius * 0.8];
    const to: Vec3 = [back[0] * (rWall - 0.6), y0 + len * 0.42, back[1] * (rWall - 0.6)];
    const st = styleOf(e, colors.steel);
    primitives.push({ kind: 'rod', key: `${key}:${toolId}`, pick: { toolId }, from, to, radius: 0.55, style: st.emphasis === 'none' && st.look === 'on' ? { ...st, color: colors.steel } : st });
    // Zapata en la pared opuesta.
    primitives.push({
      kind: 'pad',
      key: `${key}-shoe:${toolId}`,
      pick: { toolId },
      azimuth: LEAN_AZIMUTH + Math.PI,
      halfAngle: PAD_HALF_ANGLE * 0.45,
      rInner: rWall - 1,
      rOuter: rWall - 0.08,
      y0: to[1] - len * 0.08,
      y1: to[1] + len * 0.08,
      style: st.emphasis === 'none' && st.look === 'on' ? { ...st, color: colors.steelDark } : st,
    });
  }

  function addShells(tool: ToolDef, sheet: ToolSheet, y0: number, y1: number, ghost: boolean): void {
    const specs = shellSpecs(tool, sheet);
    const unverified = !!sheet.unverified?.some((k) => k === 'investigation' || k === 'investigationByRole');
    const inset = Math.min(1.2, (y1 - y0) * 0.05);
    const k = ghost ? GHOST_SHELL_FACTOR : 1;
    const fallback = tool.roles[0];
    for (const s of specs) {
      const role = s.role ?? fallback ?? null;
      const doiCm = s.doiIn * CM_PER_IN;
      shells.push({
        key: `shell:${tool.id}:${s.role ?? 'tool'}`,
        toolId: tool.id,
        role: s.role,
        doiCm,
        radius: rWall + doiCm,
        rWall,
        y0: y0 + inset,
        y1: y1 - inset,
        color: role ? input.curveColor(role) : colors.outline,
        opacity: SHELL_OPACITY * k,
        unverified,
      });
    }
    // Banda difusa del rango de la ficha, si va más allá de las cáscaras dibujadas.
    const inv = sheet.investigation;
    const typ = quantityIn(inv, 'typical', 'in');
    const min = quantityIn(inv, 'min', 'in');
    const max = quantityIn(inv, 'max', 'in');
    if (typ === undefined || (min === undefined && max === undefined)) return;
    const lo = Math.min(...specs.map((x) => x.doiIn));
    const hi = Math.max(...specs.map((x) => x.doiIn));
    if (!((min !== undefined && min < lo) || (max !== undefined && max > hi))) return;
    const peakRole = specs.length ? (specs[specs.length - 1]!.role ?? fallback) : fallback;
    bands.push({
      key: `band:${tool.id}`,
      toolId: tool.id,
      rMin: rWall + (min ?? typ) * CM_PER_IN,
      rPeak: rWall + typ * CM_PER_IN,
      rMax: rWall + (max ?? typ) * CM_PER_IN,
      y0: y0 + inset,
      y1: y1 - inset,
      color: peakRole ? input.curveColor(peakRole) : colors.outline,
      opacity: BAND_OPACITY * k,
    });
  }
}

/** Opacidad de la banda difusa a un radio (0 en los extremos, 1 en el pico; para el degradé). */
export function bandAlpha(b: Pick2<BandPrimitive, 'rMin' | 'rPeak' | 'rMax'>, r: number): number {
  if (r <= b.rMin || r >= b.rMax) return r === b.rPeak ? 1 : 0;
  if (r <= b.rPeak) return b.rPeak === b.rMin ? 1 : (r - b.rMin) / (b.rPeak - b.rMin);
  return b.rMax === b.rPeak ? 1 : (b.rMax - r) / (b.rMax - b.rPeak);
}

/**
 * Distancia de la cámara para que la caja entre en la vista con un campo vertical `fovDeg` y una relación de aspecto.
 * La cámara inicial mira al cuarto recortado desde arriba (elevación `elevationDeg`).
 */
export function initialCamera(scene: Pick2<ToolStringScene, 'bounds'>, aspect: number, fovDeg = 32, elevationDeg = 24): { position: Vec3; target: Vec3 } {
  const { min, max } = scene.bounds;
  const target: Vec3 = [0, (min[1] + max[1]) / 2, 0];
  const height = max[1] - min[1];
  const width = Math.max(max[0] - min[0], max[2] - min[2]);
  const fov = (fovDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  // Alto aparente: la altura proyectada más lo que asoma el disco de arriba por la elevación.
  const apparentH = height * Math.cos(el) + width * Math.sin(el);
  const needV = apparentH / 2 / Math.tan(fov / 2);
  const needH = width / 2 / (Math.tan(fov / 2) * Math.max(0.2, aspect));
  const d = Math.max(needV, needH) * 1.08 + width / 2;
  const [x, z] = dir(Math.PI / 4);
  return { position: [x * d * Math.cos(el), target[1] + d * Math.sin(el), z * d * Math.cos(el)], target };
}
