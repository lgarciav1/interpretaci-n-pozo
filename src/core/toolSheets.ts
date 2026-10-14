/**
 * Fichas técnicas de las herramientas de perfilaje (docs/decisiones/0032-sarta-de-perfilaje.md, D1).
 *
 * Son DATOS DE BIBLIOGRAFÍA, separados del modelo (`tools.ts`) a propósito: la vista de la sarta los muestra al
 * hacer clic en una herramienta y el dibujo 3D usa longitud, diámetro y montaje. Todo es opcional: la vista tiene que
 * funcionar con la ficha vacía (dibuja con medidas por defecto y dice «sin datos de ficha»).
 *
 * PENDIENTE: volcar acá los valores de `docs/investigacion/herramientas-de-perfilaje.md` (fase 11b, con fuentes).
 * NO completar números sin una fuente en `sources`; un valor sin fuente es peor que un hueco. Correspondencia de ids
 * de esa investigación con los de la app: gr-spectral → spectral-gr, dll → laterolog, induction-array → induction,
 * msfl → microresistivity, caliper-pad y caliper-multiarm → caliper; `doiIn` → `investigation`, `shells` →
 * `investigationByRole`, `odIn` → `diameter`, `lengthM` → `length`, `eccentralized`/`contact` → `eccentralized`/`pad`
 * (`none` = sin montaje). La cabeza de cable y los centralizadores no registran curvas: son piezas del dibujo (11c),
 * no herramientas del catálogo.
 *
 * Puro: sin React ni stores.
 */
import type { RoleId } from './roles';
import type { UnitId } from './units';

/** Magnitud con rango: `typical` es el valor a mostrar; `min`/`max` el rango de la bibliografía. */
export interface SheetQuantity {
  typical?: number;
  min?: number;
  max?: number;
  /** Unidad de longitud ('in', 'cm', 'm', 'ft', 'mm'). */
  unit: UnitId;
  /** Aclaración corta («depende del contraste Rxo/Rt», «modo de alta resolución»). */
  note?: string;
}

/**
 * Cómo va la herramienta en el pozo: apoyada con un patín contra la pared, centrada o excentrada (recostada contra
 * una pared sin patín).
 */
export type ToolMounting = 'pad' | 'centralized' | 'eccentralized';

export const TOOL_MOUNTING_LABEL: Readonly<Record<ToolMounting, string>> = {
  pad: 'Con patín contra la pared',
  centralized: 'Centralizada',
  eccentralized: 'Excentralizada',
};

export interface ToolSheet {
  /** Qué mide, en detalle (la línea corta está en `ToolDef.description`). */
  measures?: string;
  /** Principio físico, sin ecuaciones (las ecuaciones van solo en el módulo Ecuaciones). */
  principle?: string;
  /** Profundidad de investigación radial desde la pared del pozo (la de la herramienta, o la más profunda). */
  investigation?: SheetQuantity;
  /**
   * Profundidad de investigación por curva, cuando difiere (inducción de arreglo: 10, 20, 30, 60 y 90 in; laterolog
   * somero y profundo). La vista 3D dibuja una cáscara por curva.
   */
  investigationByRole?: Readonly<Partial<Record<RoleId, SheetQuantity>>>;
  /** Resolución vertical. */
  verticalResolution?: SheetQuantity;
  /** Longitud típica de la herramienta (para el dibujo de la sarta). */
  length?: SheetQuantity;
  /** Diámetro externo típico (para el dibujo de la sarta). */
  diameter?: SheetQuantity;
  mounting?: ToolMounting;
  /** Limitaciones y condiciones de pozo que la afectan (lodo, rugosidad, invasión…). */
  limitations?: readonly string[];
  /** Referencias bibliográficas de los valores de la ficha. */
  sources?: readonly string[];
  /** Campos aproximados o de una sola fuente (la ficha los marca «aprox.»). */
  unverified?: readonly (keyof ToolSheet)[];
}

/**
 * Fichas de las herramientas incorporadas, por id de `BUILTIN_TOOLS`. Vacías hasta la fase 11b (ver arriba).
 * `tests/tool-string.test.ts` exige una entrada por herramienta incorporada y ninguna de más.
 */
export const TOOL_SHEETS: Readonly<Record<string, ToolSheet>> = {
  gr: {},
  'spectral-gr': {},
  sp: {},
  caliper: {},
  temperature: {},
  induction: {},
  laterolog: {},
  microresistivity: {},
  density: {},
  neutron: {},
  sonic: {},
  nmr: {},
};

const LENGTH_UNITS = new Set<UnitId>(['m', 'cm', 'mm', 'in', 'ft']);

/** Valida una ficha: rangos coherentes, unidades de longitud, valores con fuente. Devuelve los problemas. */
export function validateToolSheet(id: string, s: ToolSheet): string[] {
  const problems: string[] = [];
  const q = (name: string, v: SheetQuantity | undefined) => {
    if (!v) return;
    if (!LENGTH_UNITS.has(v.unit)) problems.push(`Ficha '${id}', ${name}: la unidad '${v.unit}' no es de longitud.`);
    for (const k of ['typical', 'min', 'max'] as const) {
      const x = v[k];
      if (x !== undefined && !(Number.isFinite(x) && x > 0)) problems.push(`Ficha '${id}', ${name}: ${k} debe ser un número positivo.`);
    }
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) problems.push(`Ficha '${id}', ${name}: el mínimo supera al máximo.`);
    if (v.typical !== undefined && ((v.min !== undefined && v.typical < v.min) || (v.max !== undefined && v.typical > v.max))) {
      problems.push(`Ficha '${id}', ${name}: el valor típico está fuera del rango.`);
    }
  };
  q('profundidad de investigación', s.investigation);
  for (const [role, v] of Object.entries(s.investigationByRole ?? {})) q(`profundidad de investigación de ${role}`, v);
  q('resolución vertical', s.verticalResolution);
  q('longitud', s.length);
  q('diámetro', s.diameter);
  const hasValues = !!(s.investigation || s.investigationByRole || s.verticalResolution || s.length || s.diameter);
  if (hasValues && !s.sources?.length) problems.push(`Ficha '${id}': tiene valores numéricos pero ninguna fuente.`);
  return problems;
}
