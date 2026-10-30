/**
 * Catálogo de herramientas de perfilaje (sarta, docs/decisiones/0032-sarta-de-perfilaje.md, D1).
 *
 * Una herramienta es el instrumento físico que se baja al pozo: dice qué roles de curva registra. Es la ÚNICA tabla
 * rol medido → herramienta de la app: la usan la sarta (derivarla de las curvas, filtrar, disponibilidad de módulos)
 * y el catálogo de pistas del visor (`src/viewer/catalog.ts`, que agrupa sus curvas por herramienta).
 *
 * Los módulos pueden declarar herramientas nuevas (`tools` en el contrato, como `roles`) sin tocar este archivo.
 * La ficha técnica (profundidad de investigación, resolución, medidas para el dibujo 3D…) va aparte, en
 * `toolSheets.ts`: son datos de bibliografía que se completan sin tocar el modelo.
 *
 * Puro: sin React ni stores.
 */
import type { CurveProvenance } from './engine/context';
import type { RoleId } from './roles';
import { TOOL_SHEETS, type ToolSheet } from './toolSheets';

/** Familia física de la herramienta (agrupa en la vista de la sarta y da el color de su cuerpo). */
export type ToolFamily = 'borehole' | 'gamma' | 'nuclear' | 'resistivity' | 'acoustic' | 'nmr' | 'other';

export const TOOL_FAMILY_LABEL: Readonly<Record<ToolFamily, string>> = {
  borehole: 'Condiciones del pozo',
  gamma: 'Rayos gamma',
  nuclear: 'Nucleares',
  resistivity: 'Eléctricas y de resistividad',
  acoustic: 'Acústicas',
  nmr: 'Resonancia magnética',
  other: 'Otras',
};

export interface ToolDef {
  /** kebab-case, único. Es lo que se guarda en el proyecto. */
  id: string;
  /** Nombre en español («Densidad»). */
  name: string;
  /** Rótulo corto para el esquema de la sarta («DEN»). */
  short: string;
  family: ToolFamily;
  /** Qué mide, en una línea y sin ecuaciones (la ficha amplía). */
  description: string;
  /**
   * Roles de curva que registra, en orden de presentación. Un rol puede estar en varias herramientas (RT en inducción
   * y en laterolog, GR en la de rayos gamma y en la espectral): para atribuir una curva del pozo manda `mnemonics` y,
   * si ninguna coincide, la primera del catálogo que lo registra (`ToolCatalog.ownerOf`).
   */
  roles: readonly RoleId[];
  /**
   * Prefijos de mnemónico (en mayúsculas) propios de esta herramienta, para atribuir una curva cuyo rol registran
   * varias (LLD → laterolog y no inducción; SGR → espectral y no rayos gamma).
   */
  mnemonics?: readonly string[];
  /**
   * Posición típica en la sarta, de arriba (menor) hacia abajo. Orden aproximado de una triple combo (gamma, densidad
   * con su calibre, neutrón, resistividad abajo; docs/investigacion/herramientas-de-perfilaje.md); varía por empresa.
   */
  typicalOrder: number;
  /** Ficha técnica (opcional; las incorporadas están en `TOOL_SHEETS`). */
  sheet?: ToolSheet;
}

/**
 * Herramientas incorporadas. El orden del array es el de presentación (catálogo de pistas, listas); el de la sarta
 * es `typicalOrder`. Las curvas sin herramienta (BS, que sale del encabezado, o curvas ya interpretadas de un archivo)
 * no se filtran nunca.
 */
export const BUILTIN_TOOLS: readonly ToolDef[] = [
  { id: 'gr', name: 'Rayos gamma', short: 'GR', family: 'gamma', description: 'Radiactividad natural total de la formación.', roles: ['GR'], typicalOrder: 10 },
  {
    id: 'spectral-gr',
    name: 'Rayos gamma espectral',
    short: 'SGR',
    family: 'gamma',
    description: 'Radiactividad natural separada en potasio, torio y uranio.',
    roles: ['POTA', 'THOR', 'URAN', 'CGR', 'GR'],
    mnemonics: ['SGR', 'HSGR', 'ECGR', 'HCGR'],
    typicalOrder: 20,
  },
  { id: 'sp', name: 'Potencial espontáneo', short: 'SP', family: 'resistivity', description: 'Diferencia de potencial natural entre el lodo y la formación.', roles: ['SP'], typicalOrder: 110 },
  { id: 'caliper', name: 'Calibre', short: 'CAL', family: 'borehole', description: 'Diámetro del pozo.', roles: ['CALI'], typicalOrder: 35 },
  { id: 'temperature', name: 'Temperatura', short: 'TEMP', family: 'borehole', description: 'Temperatura del lodo en el pozo.', roles: ['TEMP'], typicalOrder: 0 },
  {
    id: 'induction',
    name: 'Inducción',
    short: 'IND',
    family: 'resistivity',
    description: 'Resistividad de la formación a varias profundidades de investigación, por inducción electromagnética.',
    roles: ['RT', 'RM', 'RS', 'RA10', 'RA20', 'RA30'],
    mnemonics: ['AT', 'AHT', 'AF', 'AO', 'M2R', 'IL', 'RIL', 'SFL', 'RSFL'],
    typicalOrder: 100,
  },
  {
    id: 'laterolog',
    name: 'Laterolog',
    short: 'LL',
    family: 'resistivity',
    description: 'Resistividad de la formación con corriente enfocada, para lodos salados.',
    roles: ['RT', 'RM', 'RS'],
    mnemonics: ['LL', 'RLL', 'RLA', 'HLL', 'HRLA'],
    typicalOrder: 105,
  },
  {
    id: 'microresistivity',
    name: 'Microrresistividad',
    short: 'MSFL',
    family: 'resistivity',
    description: 'Resistividad de la zona lavada junto a la pared del pozo.',
    roles: ['RXO'],
    typicalOrder: 60,
  },
  {
    id: 'density',
    name: 'Densidad',
    short: 'DEN',
    family: 'nuclear',
    description: 'Densidad volumétrica y factor fotoeléctrico de la formación, con su corrección.',
    roles: ['RHOB', 'PEF', 'DRHO'],
    typicalOrder: 30,
  },
  { id: 'neutron', name: 'Neutrón', short: 'NEU', family: 'nuclear', description: 'Índice de hidrógeno de la formación expresado como porosidad.', roles: ['NPHI'], typicalOrder: 40 },
  { id: 'sonic', name: 'Sónico', short: 'SON', family: 'acoustic', description: 'Lentitud de las ondas compresional y de corte.', roles: ['DT', 'DTS'], typicalOrder: 80 },
  {
    id: 'nmr',
    name: 'Resonancia magnética',
    short: 'RMN',
    family: 'nmr',
    description: 'Porosidad total y efectiva, y volumen de fluido irreducible, independientes de la matriz.',
    roles: ['PHIT_NMR', 'PHIE_NMR', 'BVI_NMR'],
    typicalOrder: 90,
  },
];

/** Lo mínimo que hace falta saber de una curva del pozo para atribuirla a una herramienta. */
export interface ToolCurveRef {
  provenance?: CurveProvenance;
  id: string;
  mnemonic: string;
  role: RoleId | null;
}

/** Catálogo inmutable de herramientas. Se arma una vez en el registro (con las que declaren los módulos). */
export class ToolCatalog {
  private readonly list: readonly ToolDef[];
  private readonly byId: ReadonlyMap<string, ToolDef>;
  private readonly byRole: ReadonlyMap<RoleId, readonly ToolDef[]>;

  constructor(tools: readonly ToolDef[]) {
    this.list = tools;
    this.byId = new Map(tools.map((t) => [t.id, t]));
    const byRole = new Map<RoleId, ToolDef[]>();
    for (const t of tools) for (const r of t.roles) byRole.set(r, [...(byRole.get(r) ?? []), t]);
    this.byRole = byRole;
  }

  /** Todas, en orden de presentación. */
  all(): readonly ToolDef[] {
    return this.list;
  }

  get(id: string): ToolDef | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Herramientas que registran un rol (orden del catálogo). Vacío = el rol no lo mide ninguna herramienta. */
  toolsForRole(role: RoleId): readonly ToolDef[] {
    return this.byRole.get(role) ?? [];
  }

  /**
   * Herramienta que registró una curva del pozo: entre las que registran su rol, la primera cuyo prefijo de
   * mnemónico coincide; si ninguna, la primera del catálogo. undefined si la curva no tiene rol o ninguna
   * herramienta lo registra (BS, curvas interpretadas): esas curvas no dependen de la sarta.
   */
  ownerOf(curve: { mnemonic: string; role: RoleId | null }): ToolDef | undefined {
    if (!curve.role) return undefined;
    const tools = this.byRole.get(curve.role);
    if (!tools?.length) return undefined;
    if (tools.length === 1) return tools[0];
    const m = curve.mnemonic.trim().toUpperCase();
    return tools.find((t) => t.mnemonics?.some((p) => m.startsWith(p))) ?? tools[0];
  }
}

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const FAMILIES = new Set<ToolFamily>(Object.keys(TOOL_FAMILY_LABEL) as ToolFamily[]);

/** Valida una herramienta contra los roles conocidos; devuelve los problemas (vacío si está bien). */
export function validateToolDef(t: ToolDef, hasRole: (id: RoleId) => boolean): string[] {
  const problems: string[] = [];
  if (typeof t.id !== 'string' || !TOOL_ID_PATTERN.test(t.id)) problems.push(`El id de herramienta '${t.id}' debe estar en kebab-case.`);
  if (!t.name?.trim()) problems.push(`La herramienta '${t.id}' no tiene nombre.`);
  if (!t.short?.trim()) problems.push(`La herramienta '${t.id}' no tiene rótulo corto.`);
  if (!FAMILIES.has(t.family)) problems.push(`La herramienta '${t.id}' tiene una familia desconocida '${t.family}'.`);
  if (!Array.isArray(t.roles) || t.roles.length === 0) problems.push(`La herramienta '${t.id}' no registra ningún rol.`);
  else for (const r of t.roles) if (!hasRole(r)) problems.push(`La herramienta '${t.id}' registra el rol desconocido '${r}'.`);
  if (!Number.isFinite(t.typicalOrder)) problems.push(`La herramienta '${t.id}' no tiene posición típica en la sarta.`);
  return problems;
}

/** Ficha técnica de una herramienta: la propia (módulos) o la de `TOOL_SHEETS`; vacía si no hay. */
export function sheetOf(tool: ToolDef): ToolSheet {
  return tool.sheet ?? TOOL_SHEETS[tool.id] ?? {};
}

export const defaultToolCatalog = new ToolCatalog(BUILTIN_TOOLS);


/** La ascendencia preparada manda sobre el mnemónico/rol de la salida. */
export function ancestorToolIds(curve: ToolCurveRef, tools: ToolCatalog): readonly string[] {
  if (curve.provenance?.origin === 'prepared') return curve.provenance.ancestorToolIds;
  const owner = tools.ownerOf(curve);
  return owner ? [owner.id] : [];
}
