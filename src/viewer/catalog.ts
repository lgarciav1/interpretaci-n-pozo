/**
 * Catálogo de herramientas, curvas y pistas especiales para armar pistas (docs/decisiones/0016-pistas-armables.md,
 * D2). Puro: sin React ni stores; el tema y los colores los pone quien lo muestra (`curveStyle`).
 *
 * - Grupos por herramienta o familia, con la herramienta completa (la pista de fábrica con sus rellenos) y sus curvas.
 * - Una curva lleva su selector, el estilo de plantilla y los rellenos que le son propios: suelta en una pista nueva
 *   se ve como en la de fábrica.
 * - Medidas que el pozo no tiene: deshabilitadas. Calculadas: habilitadas si algún módulo produce ese puerto.
 * - Roles de módulos nuevos: caen en su familia o en «Otras» (el catálogo crece sin tocarlo).
 */
import type { CurveDisplayOverride, CurveSelector, FillSpec, TrackSpec } from '../core/display';
import type { RoleCatalog, RoleDef } from '../core/roles';
import { getUnit } from '../core/units';
import type { Curve } from '../core/well';
import { SW_MODELS_TRACK } from './swModels';
import { BUILTIN_LAYOUTS, VOLUMETRIC_STACK } from './templates';

/** Pista sin id (la receta le pone uno único al crearla). */
export type TrackDraft = Omit<TrackSpec, 'id'> & { id?: string };

export interface CatalogCurve {
  type: 'curve';
  /** Clave del selector ('r:GR', 'c:AT10'). */
  id: string;
  select: CurveSelector;
  /** Nombre corto (mnemónico del pozo o id del rol). */
  name: string;
  /** Descripción (nombre del rol en español). */
  label: string;
  role: string | null;
  /** Curvas del pozo que toma (mnemónicos). */
  mnemonics: string[];
  origin: 'measured' | 'computed';
  /** 'present' (medida en el pozo), 'missing' (medida que no está), 'computed' (calculada con resultado), 'computable'. */
  status: 'present' | 'missing' | 'computed' | 'computable';
  available: boolean;
  /** Bandera (va en la pista de banderas). */
  flag: boolean;
  style?: CurveDisplayOverride;
  fills?: FillSpec[];
  /** Escala de la pista nueva si la curva no tiene escala propia (resistividades sin rol). */
  trackScale?: TrackSpec['scale'];
}

export interface CatalogTrack {
  type: 'track';
  id: string;
  name: string;
  description: string;
  track: TrackDraft;
  available: boolean;
  /** Por qué no está disponible. */
  reason?: string;
  /** Pista de superposición: id de la superposición. */
  overlayId?: string;
}

export interface CatalogGroup {
  id: string;
  label: string;
  /** Herramientas completas (pistas armadas) del grupo. */
  tools: CatalogTrack[];
  curves: CatalogCurve[];
}

/** Pista propia de una superposición disponible para el catálogo. */
export interface CatalogOverlayTrack {
  overlayId: string;
  title: string;
  description: string;
  track: TrackDraft;
  available: boolean;
  reason?: string;
}

export interface CatalogInput {
  roles: RoleCatalog;
  /** Curvas medidas del pozo activo. */
  curves: readonly Curve[];
  /** Puertos de curva que algún módulo produce. */
  producible: ReadonlySet<string>;
  /** Puertos con resultado calculado ahora. */
  computed: ReadonlySet<string>;
  overlayTracks?: readonly CatalogOverlayTrack[];
}

// ── grupos ────────────────────────────────────────────────────────────────────────────────────────────────────

const GROUPS: readonly { id: string; label: string }[] = [
  { id: 'special', label: 'Pistas especiales' },
  { id: 'gr-sp', label: 'Rayos gamma · SP' },
  { id: 'caliper', label: 'Caliper · trépano' },
  { id: 'resistivity', label: 'Resistividad' },
  { id: 'density-neutron', label: 'Densidad · neutrón' },
  { id: 'sonic', label: 'Sónico' },
  { id: 'spectral', label: 'GR espectral' },
  { id: 'nmr', label: 'Resonancia magnética' },
  { id: 'computed', label: 'Curvas calculadas' },
  { id: 'flags', label: 'Banderas' },
  { id: 'other', label: 'Otras curvas del pozo' },
];

/** Grupo de los roles incorporados (orden = orden en el grupo). */
const ROLE_GROUP: Readonly<Record<string, string>> = {
  GR: 'gr-sp',
  SP: 'gr-sp',
  CALI: 'caliper',
  BS: 'caliper',
  RT: 'resistivity',
  RM: 'resistivity',
  RS: 'resistivity',
  RXO: 'resistivity',
  RHOB: 'density-neutron',
  NPHI: 'density-neutron',
  PEF: 'density-neutron',
  DRHO: 'density-neutron',
  DT: 'sonic',
  DTS: 'sonic',
  POTA: 'spectral',
  THOR: 'spectral',
  URAN: 'spectral',
  CGR: 'spectral',
  PHIT_NMR: 'nmr',
  PHIE_NMR: 'nmr',
  BVI_NMR: 'nmr',
};

const FAMILY_GROUP: Readonly<Record<string, string>> = { resistivity: 'resistivity', spectral: 'spectral', nmr: 'nmr', flag: 'flags' };

function groupOf(def: RoleDef): string {
  const g = ROLE_GROUP[def.id];
  if (g) return g;
  if (def.family === 'flag') return 'flags';
  if (def.origin === 'computed') return 'computed';
  return FAMILY_GROUP[def.family] ?? 'other';
}

// ── estilo y rellenos propios de cada curva (las convenciones de las pistas de fábrica) ──────────────────────────

export const OWN_STYLE: Readonly<Record<string, CurveDisplayOverride>> = {
  GR: { wrap: true },
  PEF: { width: 1 },
  DRHO: { width: 1 },
  IGR: { line: 'solid' },
};

const CROSSOVER: FillSpec = { kind: 'between', a: 'RHOB', b: 'NPHI', aLeft: 'gasCrossover', bLeft: 'shaleCrossover', opacity: 1 };
const WASHOUT: FillSpec = { kind: 'between', a: 'BS', b: 'CALI', aLeft: 'washout', compare: 'value', opacity: 1 };

export const OWN_FILLS: Readonly<Record<string, FillSpec[]>> = {
  GR: [
    { kind: 'edge', curve: 'GR', side: 'left', fill: 'shale', opacity: 0.32 },
    { kind: 'edge', curve: 'GR', side: 'right', fill: 'sand', opacity: 0.45 },
  ],
  CALI: [WASHOUT],
  BS: [WASHOUT],
  RHOB: [CROSSOVER],
  NPHI: [CROSSOVER],
  IGR: [{ kind: 'edge', curve: 'IGR', side: 'left', fill: 'shale', opacity: 0.35 }],
  VSH: [{ kind: 'edge', curve: 'VSH', side: 'left', fill: 'shale', opacity: 0.6 }],
  SW: [{ kind: 'edge', curve: 'SW', side: 'left', fill: 'hydrocarbon', opacity: 0.6 }],
  BVI_NMR: [{ kind: 'edge', curve: 'BVI_NMR', side: 'left', fill: 'boundWater', opacity: 0.8 }],
};

const RESISTIVITY_SCALE = { kind: 'log', min: 0.2, max: 2000 } as const;

// ── herramientas (pistas de fábrica) ─────────────────────────────────────────────────────────────────────────

const factory = (ws: 'petrophysics' | 'geology', id: string): TrackSpec => {
  const t = BUILTIN_LAYOUTS[ws].find((x) => x.id === id);
  if (!t) throw new Error(`Falta la pista de fábrica '${id}'.`);
  return t;
};

/** Herramienta = pista de fábrica sin su id (cada vez que se agrega recibe uno único). */
function tool(id: string, name: string, description: string, spec: TrackSpec, roles: readonly string[]): { id: string; name: string; description: string; track: TrackDraft; roles: readonly string[] } {
  const { id: _id, ...track } = spec;
  return { id, name, description, track, roles };
}

const TOOLS: Readonly<Record<string, ReturnType<typeof tool>[]>> = {
  'gr-sp': [tool('tool:correlation', 'Correlación', 'GR con arcilla y arena, SP y caliper con derrumbe', factory('petrophysics', 'correlation'), ['GR', 'SP', 'CALI', 'BS'])],
  caliper: [
    tool(
      'tool:caliper',
      'Caliper vs. trépano',
      'Derrumbe donde el caliper supera al trépano',
      { id: 'caliper', title: 'Caliper', kind: 'curves', width: 0.8, curves: [{ select: { role: 'BS' } }, { select: { role: 'CALI' } }], fills: [WASHOUT], emptyHint: 'Sin caliper en este pozo.' },
      ['CALI', 'BS'],
    ),
  ],
  resistivity: [tool('tool:resistivity', 'Resistividades', 'Escala logarítmica 0,2–2000 ohm·m, profunda encima', factory('petrophysics', 'resistivity'), ['RT', 'RM', 'RS', 'RXO'])],
  'density-neutron': [tool('tool:density-neutron', 'Densidad · neutrón', 'Escalas compatibles con cruce de gas y separación de arcilla', factory('petrophysics', 'porosity'), ['RHOB', 'NPHI', 'PEF', 'DRHO'])],
  sonic: [tool('tool:sonic', 'Sónico', 'Compresional y de corte', factory('petrophysics', 'sonic'), ['DT', 'DTS'])],
  spectral: [tool('tool:spectral', 'GR espectral', 'K, Th, U, CGR y GR', factory('geology', 'spectral'), ['POTA', 'THOR', 'URAN', 'CGR', 'GR'])],
  nmr: [tool('tool:nmr', 'Resonancia magnética', 'Porosidades RMN con fluido irreducible', factory('geology', 'nmr'), ['PHIT_NMR', 'PHIE_NMR', 'BVI_NMR'])],
  computed: [
    tool('tool:computed', 'Interpretación', 'Junta las calculadas que ninguna otra pista muestra', factory('petrophysics', 'computed'), []),
    tool('tool:saturation', 'Porosidad · Sw', 'PHIE, SW y BVW con hidrocarburo', factory('petrophysics', 'saturation'), ['PHIE', 'SW', 'BVW']),
    tool('tool:sw-models', 'Modelos de Sw', 'Archie, Simandoux e Indonesia lado a lado, con la banda donde difieren', SW_MODELS_TRACK, ['SW']),
    tool('tool:permeability', 'Permeabilidad', 'Escala logarítmica 0,01–10 000 mD', factory('petrophysics', 'permeability'), ['PERM']),
  ],
  flags: [
    tool('tool:flags', 'Banderas', 'Reservorio y pay netos como franjas', factory('petrophysics', 'flags'), []),
    tool('tool:indicators', 'Indicadores', 'Gas, arcilla, carbón y derrumbe como franjas', factory('petrophysics', 'indicators'), ['IND_GAS', 'IND_SHALE', 'IND_COAL', 'IND_WASHOUT']),
  ],
};

const SPECIALS: readonly { id: string; name: string; description: string; track: TrackDraft }[] = [
  { id: 'special:depth', name: 'Profundidad y zonas', description: 'Escala de profundidad con la franja de zonas', track: { title: 'Prof.', kind: 'depth' } },
  {
    id: 'special:volumetric',
    name: 'Columna volumétrica',
    description: 'Arcilla, matriz, agua e hidrocarburo (litología)',
    track: { title: 'Litología', kind: 'stack', width: 0.85, stack: VOLUMETRIC_STACK },
  },
];

// ── armado ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Arma el catálogo para el pozo activo. */
export function buildTrackCatalog(input: CatalogInput): CatalogGroup[] {
  const { roles, curves, producible, computed } = input;
  const byRole = new Map<string, Curve[]>();
  for (const c of curves) if (c.role) byRole.set(c.role, [...(byRole.get(c.role) ?? []), c]);
  const groups = new Map<string, CatalogGroup>(GROUPS.map((g) => [g.id, { id: g.id, label: g.label, tools: [], curves: [] }]));

  // Roles: los incorporados agrupados (aunque falten en el pozo) y los de módulos que el pozo tiene o se calculan.
  const order = (r: RoleDef) => {
    const keys = Object.keys(ROLE_GROUP);
    const i = keys.indexOf(r.id);
    return i < 0 ? keys.length : i;
  };
  const defs = roles.all().slice().sort((a, b) => order(a) - order(b));
  for (const def of defs) {
    const present = byRole.get(def.id) ?? [];
    const isComputed = def.origin === 'computed';
    const canCompute = producible.has(def.id);
    if (!present.length && !ROLE_GROUP[def.id] && !(isComputed && canCompute) && !(def.origin === 'any' && canCompute)) continue;
    const status: CatalogCurve['status'] = present.length ? 'present' : computed.has(def.id) ? 'computed' : canCompute ? 'computable' : 'missing';
    const style = OWN_STYLE[def.id];
    const fills = OWN_FILLS[def.id];
    groups.get(groupOf(def))!.curves.push({
      type: 'curve',
      id: `r:${def.id}`,
      select: { role: def.id },
      name: def.id,
      label: def.label,
      role: def.id,
      mnemonics: present.map((c) => c.mnemonic),
      origin: present.length || !isComputed ? 'measured' : 'computed',
      status,
      available: status !== 'missing',
      flag: def.family === 'flag',
      ...(style ? { style } : {}),
      ...(fills ? { fills } : {}),
    });
  }

  // Curvas medidas sin rol (o con un rol que el catálogo no conoce): por mnemónico.
  for (const c of curves) {
    if (c.role && roles.has(c.role)) continue;
    const resistivity = getUnit(c.unit)?.dimension === 'resistivity';
    groups.get(resistivity ? 'resistivity' : 'other')!.curves.push({
      type: 'curve',
      id: `c:${c.id}`,
      select: { curveId: c.id },
      name: c.mnemonic,
      label: c.description || (resistivity ? 'Resistividad sin rol' : 'Curva sin rol'),
      role: null,
      mnemonics: [c.mnemonic],
      origin: 'measured',
      status: 'present',
      available: true,
      flag: false,
      ...(resistivity ? { trackScale: RESISTIVITY_SCALE } : {}),
    });
  }

  // Herramientas: disponibles si el pozo tiene (o puede calcular) alguna de sus curvas; los recolectores siempre.
  const hasRole = (r: string) => !!byRole.get(r)?.length || producible.has(r) || computed.has(r);
  for (const [gid, list] of Object.entries(TOOLS)) {
    const g = groups.get(gid)!;
    for (const t of list) {
      const available = t.roles.length === 0 || t.roles.some(hasRole) || (gid === 'resistivity' && g.curves.some((c) => c.available));
      g.tools.push({ type: 'track', id: t.id, name: t.name, description: t.description, track: t.track, available, ...(available ? {} : { reason: 'El pozo no tiene estas curvas.' }) });
    }
  }
  const special = groups.get('special')!;
  for (const s of SPECIALS) special.tools.push({ type: 'track', id: s.id, name: s.name, description: s.description, track: s.track, available: true });
  for (const o of input.overlayTracks ?? []) {
    special.tools.push({
      type: 'track',
      id: `overlay:${o.overlayId}`,
      name: o.title,
      description: o.description,
      track: o.track,
      available: o.available,
      overlayId: o.overlayId,
      ...(o.reason ? { reason: o.reason } : {}),
    });
  }

  return [...groups.values()].filter((g) => g.tools.length || g.curves.length);
}

/** Texto sin acentos ni mayúsculas (búsqueda). */
export const searchKey = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Filtra el catálogo: un grupo cuyo nombre coincide se muestra entero; si no, solo lo que coincide. */
export function filterCatalog(groups: readonly CatalogGroup[], query: string): CatalogGroup[] {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...groups];
  const match = (...texts: (string | undefined)[]) => {
    const hay = searchKey(texts.filter(Boolean).join(' '));
    return words.every((w) => hay.includes(w));
  };
  const out: CatalogGroup[] = [];
  for (const g of groups) {
    if (match(g.label)) {
      out.push(g);
      continue;
    }
    const tools = g.tools.filter((t) => match(t.name, t.description));
    const curves = g.curves.filter((c) => match(c.name, c.label, c.role ?? undefined, ...c.mnemonics));
    if (tools.length || curves.length) out.push({ ...g, tools, curves });
  }
  return out;
}

/**
 * Entrada de convención de un rol (estilo de plantilla y rellenos propios), la misma que usa el catálogo. Para una
 * curva que se mueve sin entrada propia (la tomó un recolector).
 */
export function conventionEntry(role: string): { select: CurveSelector; style?: CurveDisplayOverride; fills?: FillSpec[] } {
  const style = OWN_STYLE[role];
  const fills = OWN_FILLS[role];
  return { select: { role }, ...(style ? { style } : {}), ...(fills ? { fills } : {}) };
}

/** Lo que se suelta al arrastrar una curva del catálogo (selector, estilo y rellenos propios). */
export function curveEntryOf(c: CatalogCurve): { select: CurveSelector; style?: CurveDisplayOverride; fills?: FillSpec[] } {
  return { select: c.select, ...(c.style ? { style: c.style } : {}), ...(c.fills ? { fills: c.fills } : {}) };
}

/** Pista nueva para una curva suelta en un espacio entre pistas. */
export function trackForCurve(c: CatalogCurve, title: string): TrackDraft {
  return c.flag
    ? { title, kind: 'flags', curves: [{ select: c.select }] }
    : {
        title,
        kind: 'curves',
        curves: [{ select: c.select, ...(c.style ? { style: c.style } : {}) }],
        // Los de dos curvas quedan latentes hasta que llegue la otra (caliper sin trépano todavía).
        ...(c.fills?.length ? { fills: c.fills } : {}),
        ...(c.trackScale ? { scale: c.trackScale } : {}),
        emptyHint: 'Arrastrá curvas a esta pista desde el catálogo.',
      };
}
