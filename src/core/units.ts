/**
 * Unidades y conversiones.
 *
 * Cada unidad pertenece a una dimensión y se convierte a la unidad base de esa dimensión con una
 * transformación afín: base = valor * factor + offset. El motor trabaja siempre en las unidades canónicas
 * de cada rol (ver roles.ts); los datos medidos se convierten al entrar al motor.
 */

export type DimensionId =
  | 'length'
  | 'density'
  | 'slowness'
  | 'fraction'
  | 'temperature'
  | 'resistivity'
  | 'gammaRay'
  | 'potential'
  | 'photoelectric'
  | 'concentration'
  | 'permeability'
  | 'pressure'
  | 'area'
  | 'volume'
  | 'volumeRatio'
  | 'temperatureGradient'
  | 'dimensionless';

export type KnownUnitId =
  | 'm'
  | 'ft'
  | 'in'
  | 'cm'
  | 'mm'
  | 'g/cm3'
  | 'kg/m3'
  | 'us/ft'
  | 'us/m'
  | 'v/v'
  | '%'
  | 'degC'
  | 'degF'
  | 'K'
  | 'ohm.m'
  | 'gAPI'
  | 'mV'
  | 'b/e'
  | 'ppm'
  | 'wt%'
  | 'mD'
  | 'D'
  | 'kPa'
  | 'MPa'
  | 'psi'
  | 'bar'
  | 'm2'
  | 'km2'
  | 'ha'
  | 'acre'
  | 'm3'
  | 'bbl'
  | 'ft3'
  | 'Mm3'
  | 'MMm3'
  | 'Mbbl'
  | 'MMbbl'
  | 'MMscf'
  | 'Bcf'
  | 'm3/m3'
  | 'degC/100m'
  | 'degF/100ft'
  | 'unitless';

/** Identificador de unidad. Admite unidades registradas en tiempo de ejecución (`registerUnit`). */
export type UnitId = KnownUnitId | (string & {});

export interface UnitDef {
  id: UnitId;
  /** Texto para mostrar en la interfaz. */
  label: string;
  dimension: DimensionId;
  /** base = valor * factor + offset */
  factor: number;
  offset?: number;
}

const BUILTIN_UNITS: UnitDef[] = [
  // Longitud (base: m)
  { id: 'm', label: 'm', dimension: 'length', factor: 1 },
  { id: 'ft', label: 'ft', dimension: 'length', factor: 0.3048 },
  { id: 'in', label: 'in', dimension: 'length', factor: 0.0254 },
  { id: 'cm', label: 'cm', dimension: 'length', factor: 0.01 },
  { id: 'mm', label: 'mm', dimension: 'length', factor: 0.001 },
  // Densidad (base: g/cm³)
  { id: 'g/cm3', label: 'g/cm³', dimension: 'density', factor: 1 },
  { id: 'kg/m3', label: 'kg/m³', dimension: 'density', factor: 0.001 },
  // Lentitud (base: µs/ft)
  { id: 'us/ft', label: 'µs/ft', dimension: 'slowness', factor: 1 },
  { id: 'us/m', label: 'µs/m', dimension: 'slowness', factor: 0.3048 },
  // Fracción volumétrica (base: v/v)
  { id: 'v/v', label: 'v/v', dimension: 'fraction', factor: 1 },
  { id: '%', label: '%', dimension: 'fraction', factor: 0.01 },
  // Temperatura (base: °C)
  { id: 'degC', label: '°C', dimension: 'temperature', factor: 1 },
  { id: 'degF', label: '°F', dimension: 'temperature', factor: 5 / 9, offset: -160 / 9 },
  { id: 'K', label: 'K', dimension: 'temperature', factor: 1, offset: -273.15 },
  // Resistividad (base: ohm·m)
  { id: 'ohm.m', label: 'ohm·m', dimension: 'resistivity', factor: 1 },
  // Rayos gamma, potencial, factor fotoeléctrico
  { id: 'gAPI', label: 'gAPI', dimension: 'gammaRay', factor: 1 },
  { id: 'mV', label: 'mV', dimension: 'potential', factor: 1 },
  { id: 'b/e', label: 'b/e', dimension: 'photoelectric', factor: 1 },
  // Concentración en peso (base: ppm)
  { id: 'ppm', label: 'ppm', dimension: 'concentration', factor: 1 },
  { id: 'wt%', label: '% peso', dimension: 'concentration', factor: 10000 },
  // Permeabilidad (base: mD)
  { id: 'mD', label: 'mD', dimension: 'permeability', factor: 1 },
  { id: 'D', label: 'D', dimension: 'permeability', factor: 1000 },
  // Presión (base: kPa)
  { id: 'kPa', label: 'kPa', dimension: 'pressure', factor: 1 },
  { id: 'MPa', label: 'MPa', dimension: 'pressure', factor: 1000 },
  { id: 'psi', label: 'psi', dimension: 'pressure', factor: 6.894757293168361 },
  { id: 'bar', label: 'bar', dimension: 'pressure', factor: 100 },
  // Área (base: m²)
  { id: 'm2', label: 'm²', dimension: 'area', factor: 1 },
  { id: 'km2', label: 'km²', dimension: 'area', factor: 1e6 },
  { id: 'ha', label: 'ha', dimension: 'area', factor: 1e4 },
  { id: 'acre', label: 'acre', dimension: 'area', factor: 4046.8564224 },
  // Volumen (base: m³)
  { id: 'm3', label: 'm³', dimension: 'volume', factor: 1 },
  { id: 'bbl', label: 'bbl', dimension: 'volume', factor: 0.158987294928 },
  { id: 'ft3', label: 'ft³', dimension: 'volume', factor: 0.028316846592 },
  // Múltiplos para volúmenes in situ (fase 6a): miles y millones de m³, bbl y ft³ (scf = ft³ estándar)
  { id: 'Mm3', label: 'Mm³', dimension: 'volume', factor: 1e3 },
  { id: 'MMm3', label: 'MMm³', dimension: 'volume', factor: 1e6 },
  { id: 'Mbbl', label: 'Mbbl', dimension: 'volume', factor: 158.987294928 },
  { id: 'MMbbl', label: 'MMbbl', dimension: 'volume', factor: 158987.294928 },
  { id: 'MMscf', label: 'MMscf', dimension: 'volume', factor: 28316.846592 },
  { id: 'Bcf', label: 'Bcf', dimension: 'volume', factor: 28316846.592 },
  // Razón de volúmenes (factores de volumen Bo, Bg: volumen en reservorio / volumen en superficie)
  { id: 'm3/m3', label: 'm³/m³', dimension: 'volumeRatio', factor: 1 },
  // Gradiente de temperatura (base: °C/100 m). Es una diferencia de temperatura: sin offset.
  { id: 'degC/100m', label: '°C/100 m', dimension: 'temperatureGradient', factor: 1 },
  { id: 'degF/100ft', label: '°F/100 ft', dimension: 'temperatureGradient', factor: 5 / 9 / 0.3048 },
  // Adimensional
  { id: 'unitless', label: '—', dimension: 'dimensionless', factor: 1 },
];

/**
 * Alias habituales en archivos LAS/Excel → unidad. Se comparan en mayúsculas y sin espacios.
 * La fase 2 (io) puede ampliarlos con `registerUnitAlias`.
 */
const BUILTIN_ALIASES: Record<string, UnitId> = {
  M: 'm', METER: 'm', METERS: 'm', METRES: 'm',
  FT: 'ft', F: 'ft', FEET: 'ft',
  IN: 'in', INCH: 'in', INCHES: 'in', '"': 'in',
  CM: 'cm', MM: 'mm',
  'G/CM3': 'g/cm3', 'G/CC': 'g/cm3', 'G/C3': 'g/cm3', 'GR/CC': 'g/cm3', 'GM/CC': 'g/cm3', 'G/CM³': 'g/cm3',
  'KG/M3': 'kg/m3', 'K/M3': 'kg/m3', 'KG/M³': 'kg/m3',
  'US/FT': 'us/ft', 'US/F': 'us/ft', 'USEC/FT': 'us/ft', 'µS/FT': 'us/ft', 'MICROS/FT': 'us/ft',
  'US/M': 'us/m', 'USEC/M': 'us/m', 'µS/M': 'us/m',
  'V/V': 'v/v', DEC: 'v/v', FRAC: 'v/v', FRACTION: 'v/v', 'M3/M3': 'v/v', CFCF: 'v/v',
  '%': '%', PU: '%', PCT: '%', PERCENT: '%',
  DEGC: 'degC', '°C': 'degC', C: 'degC',
  DEGF: 'degF', '°F': 'degF',
  K: 'K', KELVIN: 'K',
  OHMM: 'ohm.m', 'OHM.M': 'ohm.m', 'OHM-M': 'ohm.m', 'OHM·M': 'ohm.m', OHM_M: 'ohm.m',
  GAPI: 'gAPI', API: 'gAPI', 'GAPI UNITS': 'gAPI',
  MV: 'mV',
  'B/E': 'b/e', 'B/ELEC': 'b/e', BARNS: 'b/e',
  PPM: 'ppm',
  'WT%': 'wt%',
  MD: 'mD', D: 'D',
  KPA: 'kPa', MPA: 'MPa', PSI: 'psi', BAR: 'bar',
  M2: 'm2', KM2: 'km2', HA: 'ha', ACRE: 'acre', ACRES: 'acre',
  M3: 'm3', BBL: 'bbl', FT3: 'ft3',
  '': 'unitless', '-': 'unitless', UNITLESS: 'unitless', NONE: 'unitless',
};

const units = new Map<string, UnitDef>(BUILTIN_UNITS.map((u) => [u.id, u]));
const aliases = new Map<string, UnitId>(Object.entries(BUILTIN_ALIASES).map(([k, v]) => [normalizeAlias(k), v]));

/** Registra una unidad nueva (p. ej. desde un módulo). Falla si el id ya existe con otra definición. */
export function registerUnit(def: UnitDef): void {
  const prev = units.get(def.id);
  if (prev && (prev.dimension !== def.dimension || prev.factor !== def.factor || (prev.offset ?? 0) !== (def.offset ?? 0))) {
    throw new Error(`La unidad '${def.id}' ya existe con otra definición.`);
  }
  units.set(def.id, def);
}

export function registerUnitAlias(alias: string, unit: UnitId): void {
  if (!units.has(unit)) throw new Error(`No se puede crear el alias '${alias}': la unidad '${unit}' no existe.`);
  aliases.set(normalizeAlias(alias), unit);
}

export function getUnit(id: UnitId): UnitDef | undefined {
  return units.get(id);
}

/** Unidades registradas (todas o las de una dimensión), p. ej. para los selectores del asistente de columnas. */
export function listUnits(dimension?: DimensionId): UnitDef[] {
  return [...units.values()].filter((u) => dimension === undefined || u.dimension === dimension);
}

export function isKnownUnit(id: string): id is UnitId {
  return units.has(id);
}

export function unitLabel(id: UnitId): string {
  return units.get(id)?.label ?? id;
}

function normalizeAlias(text: string): string {
  // µ (U+00B5) y μ (U+03BC) se unifican: ambos se usan para "micro" en los archivos.
  return text.trim().replace(/\u00b5/g, '\u03bc').toUpperCase().replace(/\s+/g, ' ');
}

/** Interpreta un texto de unidad tal como aparece en un archivo. Devuelve null si no se reconoce. */
export function parseUnit(text: string): UnitId | null {
  if (units.has(text)) return text;
  return aliases.get(normalizeAlias(text)) ?? null;
}

function requireUnit(id: UnitId): UnitDef {
  const u = units.get(id);
  if (!u) throw new Error(`Unidad desconocida: '${id}'.`);
  return u;
}

export function sameDimension(a: UnitId, b: UnitId): boolean {
  const ua = units.get(a);
  const ub = units.get(b);
  return !!ua && !!ub && ua.dimension === ub.dimension;
}

/** Devuelve [escala, desplazamiento] tal que destino = origen * escala + desplazamiento. */
export function conversionCoefficients(from: UnitId, to: UnitId): [number, number] {
  const uf = requireUnit(from);
  const ut = requireUnit(to);
  if (uf.dimension !== ut.dimension) {
    throw new Error(`No se puede convertir de '${uf.label}' (${uf.dimension}) a '${ut.label}' (${ut.dimension}).`);
  }
  const scale = uf.factor / ut.factor;
  const shift = ((uf.offset ?? 0) - (ut.offset ?? 0)) / ut.factor;
  return [scale, shift];
}

export function convert(value: number, from: UnitId, to: UnitId): number {
  if (from === to) return value;
  const [scale, shift] = conversionCoefficients(from, to);
  return value * scale + shift;
}

/** Convierte un array completo. NaN se mantiene NaN. Si `out` no se da, crea uno nuevo. */
export function convertArray(
  values: ArrayLike<number>,
  from: UnitId,
  to: UnitId,
  out: Float64Array = new Float64Array(values.length),
): Float64Array {
  if (from === to) {
    for (let i = 0; i < values.length; i++) out[i] = values[i]!;
    return out;
  }
  const [scale, shift] = conversionCoefficients(from, to);
  for (let i = 0; i < values.length; i++) out[i] = values[i]! * scale + shift;
  return out;
}
