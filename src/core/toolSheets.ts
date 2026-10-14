/**
 * Fichas técnicas de las herramientas de perfilaje (docs/decisiones/0032-sarta-de-perfilaje.md, D1).
 *
 * Son DATOS DE BIBLIOGRAFÍA, separados del modelo (`tools.ts`) a propósito: la vista de la sarta los muestra al
 * hacer clic en una herramienta y el dibujo 3D usa longitud, diámetro y montaje. Todo es opcional: la vista tiene que
 * funcionar con la ficha vacía (dibuja con medidas por defecto y dice «sin datos de ficha»).
 *
 * Los valores salen de `docs/investigacion/herramientas-de-perfilaje.md` (fase 11b, con fuentes; volcados en la 11c).
 * NO completar números sin una fuente en `sources`; un valor sin fuente es peor que un hueco. Correspondencia de ids
 * de esa investigación con los de la app: gr-spectral → spectral-gr, dll → laterolog, induction-array → induction,
 * msfl → microresistivity, caliper-pad y caliper-multiarm → caliper; `doiIn` → `investigation`, `shells` →
 * `investigationByRole`, `odIn` → `diameter`, `lengthM` → `length`, `eccentralized`/`contact` → `eccentralized`/`pad`
 * (`none` = sin montaje). La cabeza de cable y los centralizadores no registran curvas: son piezas del dibujo (11c),
 * no herramientas del catálogo. El calibre multibrazo (de pozo entubado) no se vuelca: el calibre de la app es el de
 * patín, el brazo de la densidad.
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
 * Fichas de las herramientas incorporadas, por id de `BUILTIN_TOOLS`, volcadas del bloque JSON de
 * `docs/investigacion/herramientas-de-perfilaje.md` (fase 11b; fase 11c el volcado). Reglas del volcado:
 * - `null` en la investigación queda AUSENTE (nunca se completa de memoria); la vista lo dice «sin dato».
 * - Los campos de `unverified` se marcan «aproximado» en la ficha; si la profundidad de investigación de la herramienta
 *   está sin verificar, también la de cada curva (`investigationByRole`, que la investigación deriva de esa).
 * - Una profundidad 0 (contacto con la pared, calibre) no es un número positivo: queda como nota sin valor.
 * - La temperatura no está en la investigación: su ficha queda vacía.
 * `tests/tool-sheets.test.ts` compara cada número con el JSON de la investigación.
 */
const IN = 'in' as const;
export const TOOL_SHEETS: Readonly<Record<string, ToolSheet>> = {
  gr: {
    measures: 'Mide la radiactividad natural total de la roca; las arcillas suelen ser más radiactivas que arenas y carbonatos limpios.',
    investigation: { typical: 4, unit: IN, note: 'Herramienta promedio en un pozo promedio; depende de la densidad del lodo y de la formación.' },
    investigationByRole: { GR: { typical: 4, unit: IN } },
    verticalResolution: { typical: 16, unit: IN },
    diameter: { typical: 3.6, unit: IN },
    mounting: 'eccentralized',
    limitations: ['Atenuado por lodo pesado y pozo grande.'],
    sources: ['https://www.wgcg.co.uk/wp-content/uploads/2025/02/03-Integration-of-core-data-with-borehole-geophysical-logs.pdf'],
    unverified: ['investigation', 'investigationByRole', 'verticalResolution', 'diameter', 'mounting'],
  },
  'spectral-gr': {
    measures: 'Separa la radiactividad natural en potasio, torio y uranio según la energía de los rayos gamma.',
    investigation: { typical: 24, unit: IN, note: 'HNGS.' },
    investigationByRole: { URAN: { typical: 24, unit: IN }, THOR: { typical: 24, unit: IN }, POTA: { typical: 24, unit: IN } },
    verticalResolution: { typical: 12, unit: IN, note: 'HNGS; la NGT, unas 18 in.' },
    length: { typical: 2.6, unit: 'm', note: 'HNGS (8,5 ft); la fuente muestra una conversión inconsistente.' },
    diameter: { typical: 3.75, unit: IN, note: 'HNGS.' },
    mounting: 'eccentralized',
    limitations: ['Pocos conteos a velocidad alta; el lodo con KCl falsea el potasio.'],
    sources: ['https://web.iodp.tamu.edu/tools/logging/MULT/hngs.html', 'https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/natural-gamma-ray-spectrometry-tool-ngt'],
    unverified: ['length'],
  },
  sp: {
    measures:
      'Tensión natural entre un electrodo en el pozo y otro en superficie, por la diferencia de salinidad entre filtrado y agua de formación; marca capas permeables. No es una herramienta propia: es un electrodo montado en otra herramienta (típicamente la de resistividad).',
    limitations: ['Requiere lodo conductivo y contraste de salinidad; no sirve con lodo base aceite.'],
    sources: ['https://uio.no/studier/emner/matnat/geofag/GEO4250/v08/undervisningsmateriale/Lectures/BWLA%20-%20Spontaneous%20Potential%20-%20Gamma%20Ray.pdf'],
  },
  caliper: {
    measures: 'Mide el diámetro del pozo con el brazo que empuja el patín de densidad.',
    investigation: { unit: IN, note: 'Contacto con la pared: no investiga la formación.' },
    mounting: 'pad',
    limitations: ['Mide un solo diámetro; puede caer en una ranura de llave.'],
    sources: ['https://glossary.slb.com/en/terms/c/compensated_neutron_log'],
  },
  temperature: {},
  induction: {
    measures: 'Una bobina induce corrientes en la formación y arreglos de receptores dan cinco curvas con distinta profundidad, de la zona invadida a la virgen.',
    investigation: { typical: 90, min: 10, max: 90, unit: IN, note: 'Profundidades nominales; la real varía con la conductividad de la formación.' },
    investigationByRole: {
      RA10: { typical: 10, unit: IN },
      RA20: { typical: 20, unit: IN },
      RA30: { typical: 30, unit: IN },
      RM: { typical: 60, unit: IN },
      RT: { typical: 90, unit: IN },
    },
    verticalResolution: { typical: 24, unit: IN, note: '1, 2 o 4 ft según el procesamiento.' },
    mounting: 'centralized',
    limitations: ['Menos precisa en resistividades altas; la profundidad real varía con la conductividad.'],
    sources: ['https://www.osti.gov/biblio/207288', 'https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/slimxtreme-array-induction-imager-tool-qait'],
    unverified: ['mounting'],
  },
  laterolog: {
    measures: 'Fuerza una corriente enfocada hacia la formación y mide la tensión; da una resistividad profunda y otra somera en lodos salados.',
    investigation: { typical: 80, min: 25, max: 98, unit: IN, note: 'Depende de la resistividad de la roca y del contraste entre la zona invadida y la virgen.' },
    investigationByRole: { RS: { typical: 25, unit: IN }, RT: { typical: 80, unit: IN } },
    verticalResolution: { typical: 24, unit: IN },
    length: { typical: 7.35, unit: 'm', note: 'Laterolog de arreglo HRLA.' },
    diameter: { typical: 3.625, unit: IN, note: 'Laterolog de arreglo HRLA.' },
    mounting: 'centralized',
    limitations: ['Necesita lodo conductivo; sensible a capas finas y contrastes altos.'],
    sources: ['https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/dual-laterolog-dll', 'https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/hrla'],
    unverified: ['investigation', 'investigationByRole', 'mounting'],
  },
  microresistivity: {
    measures: 'Un patín con electrodos pequeños pegado a la pared mide la resistividad de la zona lavada por el filtrado (Rxo).',
    investigation: { typical: 2, min: 1, unit: IN },
    investigationByRole: { RXO: { typical: 2, unit: IN } },
    verticalResolution: { typical: 2, unit: IN },
    mounting: 'pad',
    limitations: ['Necesita lodo conductivo; el revoque y la separación del patín afectan la lectura.'],
    sources: ['https://petrowiki.spe.org/Microresistivity_logs', 'https://patents.google.com/patent/US7046010'],
    unverified: ['investigation', 'investigationByRole', 'verticalResolution'],
  },
  density: {
    measures: 'Una fuente de cesio-137 emite rayos gamma; los que llegan a los detectores indican la densidad de la roca y, con el PEF, ayudan a identificar la litología.',
    investigation: { typical: 4, max: 24, unit: IN, note: 'Muy somera: depende de la densidad de la roca.' },
    investigationByRole: { RHOB: { typical: 4, unit: IN } },
    verticalResolution: { typical: 16, unit: IN },
    diameter: { typical: 4.5, unit: IN },
    mounting: 'pad',
    limitations: ['Muy sensible a rugosidad y revoque; la barita falsea el PEF.'],
    sources: ['https://iodp.tamu.edu/tools/logging/TRIPLE/hlds.html', 'https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/hostile-environment-lithodensity-tool-hldt'],
    unverified: ['diameter', 'investigation', 'investigationByRole'],
  },
  neutron: {
    measures: 'Una fuente emite neutrones que pierden energía sobre todo al chocar con hidrógeno; los detectores dan el índice de hidrógeno, que se lee como porosidad.',
    investigation: { typical: 10, min: 8, max: 12, unit: IN, note: 'Las fuentes discrepan; mayor en baja porosidad.' },
    investigationByRole: { NPHI: { typical: 10, unit: IN } },
    verticalResolution: { typical: 24, unit: IN },
    diameter: { typical: 3.6, unit: IN },
    mounting: 'eccentralized',
    limitations: ['Afectado por diámetro del pozo, salinidad, matriz, gas y arcilla.'],
    sources: ['https://glossary.slb.com/en/terms/c/compensated_neutron_log', 'https://lecture-notes.tiu.edu.iq/wp-content/uploads/2022/12/Lecture-7-Neutron-Log.pdf'],
    unverified: ['diameter', 'investigation', 'investigationByRole'],
  },
  sonic: {
    measures: 'Mide el tiempo que tarda una onda acústica en recorrer un pie de formación; el dipolar entrega también la onda de corte.',
    investigation: { typical: 8, min: 5, max: 39, unit: IN, note: 'Depende de la velocidad y la frecuencia.' },
    investigationByRole: { DT: { typical: 8, unit: IN }, DTS: { typical: 8, unit: IN } },
    verticalResolution: { typical: 24, unit: IN },
    diameter: { typical: 3.6, unit: IN },
    mounting: 'centralized',
    limitations: ['Salto de ciclo en gas y fracturas; el dipolar necesita buen pozo.'],
    sources: ['https://mlp.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/dipole-sonic-imager-tool-dsi-2'],
    unverified: ['investigation', 'investigationByRole', 'verticalResolution', 'diameter', 'mounting'],
  },
  nmr: {
    measures: 'Polariza los protones de los fluidos de los poros y mide el decaimiento de su eco (T2) para estimar el volumen de fluido libre y ligado, sin depender de la matriz.',
    investigation: { typical: 3, min: 2.1, max: 4, unit: IN },
    investigationByRole: { PHIT_NMR: { typical: 3, unit: IN } },
    verticalResolution: { typical: 24, unit: IN },
    length: { typical: 16, unit: 'm', note: 'MRIL-Prime; el CMR es mucho más corto.' },
    diameter: { typical: 6, unit: IN, note: 'MRIL-Prime.' },
    mounting: 'eccentralized',
    limitations: ['Zona medida somera; se degrada con velocidad alta y pozo rugoso; longitud y diámetro corresponden al MRIL-Prime, el CMR es mucho más corto.'],
    sources: ['https://dam.bakerhughes.com/m/6fa387fd752509ff/original/MR-eXplorer-magnetic-resonance-logging-service-bro-pdf.pdf', 'https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6541969'],
    unverified: ['mounting'],
  },
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
