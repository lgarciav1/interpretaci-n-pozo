/**
 * Catálogo de roles de curva.
 *
 * Un rol es el significado petrofísico de una curva, independiente de su mnemónico (ZDEN, RHOB y RHOZ son todas
 * `RHOB`). Los módulos piden y producen curvas por rol, y cada rol tiene una unidad canónica: el motor convierte
 * las curvas medidas a esa unidad antes de pasarlas a un módulo.
 *
 * La tabla mnemónico → rol vive en `src/io/` (fase 2). Los módulos pueden declarar roles nuevos (`roles` en el
 * contrato) sin tocar este archivo.
 */
import { getUnit, type DimensionId, type UnitId } from './units';

export type RoleId = string;

export type RoleFamily =
  | 'borehole'
  | 'lithology'
  | 'porosity'
  | 'resistivity'
  | 'spectral'
  | 'nmr'
  | 'shale'
  | 'saturation'
  | 'permeability'
  | 'flag'
  | 'other';

export interface RoleDisplay {
  /** Color convencional de la curva en el visor. */
  color: string;
  scale: 'linear' | 'log';
  /** Rango típico de la pista (en la unidad canónica). */
  min?: number;
  max?: number;
  /** Si la escala se dibuja invertida (p. ej. NPHI). */
  reversed?: boolean;
}

export interface RoleDef {
  id: RoleId;
  /** Nombre en español para la interfaz. */
  label: string;
  /** Unidad canónica: el motor trabaja en esta unidad. */
  unit: UnitId;
  family: RoleFamily;
  /** Pista para la interfaz: si normalmente es un perfil medido o una curva calculada. */
  origin: 'measured' | 'computed' | 'any';
  display?: RoleDisplay;
  description?: string;
}

/** Roles incorporados. Ids en mayúsculas, como los mnemónicos genéricos de la industria. */
export const BUILTIN_ROLES: readonly RoleDef[] = [
  // Pozo
  { id: 'CALI', label: 'Caliper', unit: 'in', family: 'borehole', origin: 'measured', display: { color: '#7a7a7a', scale: 'linear', min: 6, max: 16 } },
  { id: 'BS', label: 'Diámetro de trépano', unit: 'in', family: 'borehole', origin: 'measured', display: { color: '#444444', scale: 'linear', min: 6, max: 16 } },
  { id: 'TEMP', label: 'Temperatura', unit: 'degC', family: 'borehole', origin: 'any', display: { color: '#c0392b', scale: 'linear' } },
  // Litología / arcillosidad medida
  { id: 'GR', label: 'Rayos gamma', unit: 'gAPI', family: 'lithology', origin: 'measured', display: { color: '#2e8b57', scale: 'linear', min: 0, max: 150 } },
  { id: 'SP', label: 'Potencial espontáneo', unit: 'mV', family: 'lithology', origin: 'measured', display: { color: '#1f5fa8', scale: 'linear' } },
  { id: 'PEF', label: 'Factor fotoeléctrico', unit: 'b/e', family: 'lithology', origin: 'measured', display: { color: '#8e44ad', scale: 'linear', min: 0, max: 10 } },
  // Porosidad medida
  { id: 'RHOB', label: 'Densidad volumétrica', unit: 'g/cm3', family: 'porosity', origin: 'measured', display: { color: '#d62728', scale: 'linear', min: 1.95, max: 2.95 } },
  { id: 'DRHO', label: 'Corrección de densidad', unit: 'g/cm3', family: 'porosity', origin: 'measured', display: { color: '#e377c2', scale: 'linear', min: -0.25, max: 0.25 } },
  { id: 'NPHI', label: 'Porosidad neutrónica', unit: 'v/v', family: 'porosity', origin: 'measured', display: { color: '#1f77b4', scale: 'linear', min: -0.15, max: 0.45, reversed: true } },
  { id: 'DT', label: 'Sónico compresional', unit: 'us/ft', family: 'porosity', origin: 'measured', display: { color: '#9467bd', scale: 'linear', min: 40, max: 140, reversed: true } },
  { id: 'DTS', label: 'Sónico de corte', unit: 'us/ft', family: 'porosity', origin: 'measured', display: { color: '#8c564b', scale: 'linear', min: 80, max: 340, reversed: true } },
  // Resistividad
  { id: 'RT', label: 'Resistividad profunda (Rt)', unit: 'ohm.m', family: 'resistivity', origin: 'measured', display: { color: '#d62728', scale: 'log', min: 0.2, max: 2000 } },
  { id: 'RM', label: 'Resistividad media', unit: 'ohm.m', family: 'resistivity', origin: 'measured', display: { color: '#ff7f0e', scale: 'log', min: 0.2, max: 2000 } },
  { id: 'RS', label: 'Resistividad somera', unit: 'ohm.m', family: 'resistivity', origin: 'measured', display: { color: '#2ca02c', scale: 'log', min: 0.2, max: 2000 } },
  { id: 'RXO', label: 'Resistividad de zona lavada (Rxo)', unit: 'ohm.m', family: 'resistivity', origin: 'measured', display: { color: '#17becf', scale: 'log', min: 0.2, max: 2000 } },
  // Rayos gamma espectral
  { id: 'URAN', label: 'Uranio', unit: 'ppm', family: 'spectral', origin: 'measured', display: { color: '#bcbd22', scale: 'linear', min: 0, max: 20 } },
  { id: 'THOR', label: 'Torio', unit: 'ppm', family: 'spectral', origin: 'measured', display: { color: '#7f7f7f', scale: 'linear', min: 0, max: 30 } },
  { id: 'POTA', label: 'Potasio', unit: 'wt%', family: 'spectral', origin: 'measured', display: { color: '#e377c2', scale: 'linear', min: 0, max: 5 } },
  { id: 'CGR', label: 'Rayos gamma sin uranio', unit: 'gAPI', family: 'spectral', origin: 'measured', display: { color: '#556b2f', scale: 'linear', min: 0, max: 150 } },
  // Resonancia magnética
  { id: 'PHIT_NMR', label: 'Porosidad total RMN', unit: 'v/v', family: 'nmr', origin: 'measured', display: { color: '#4b0082', scale: 'linear', min: 0, max: 0.4 } },
  { id: 'PHIE_NMR', label: 'Porosidad efectiva RMN', unit: 'v/v', family: 'nmr', origin: 'measured', display: { color: '#6a5acd', scale: 'linear', min: 0, max: 0.4 } },
  { id: 'BVI_NMR', label: 'Volumen de fluido irreducible RMN', unit: 'v/v', family: 'nmr', origin: 'measured', display: { color: '#87cefa', scale: 'linear', min: 0, max: 0.4 } },
  // Calculadas
  { id: 'IGR', label: 'Índice de rayos gamma', unit: 'v/v', family: 'shale', origin: 'computed', display: { color: '#2e8b57', scale: 'linear', min: 0, max: 1 } },
  { id: 'VSH', label: 'Volumen de arcilla', unit: 'v/v', family: 'shale', origin: 'computed', display: { color: '#8b5a2b', scale: 'linear', min: 0, max: 1 } },
  { id: 'PHID', label: 'Porosidad por densidad', unit: 'v/v', family: 'porosity', origin: 'computed', display: { color: '#d62728', scale: 'linear', min: -0.15, max: 0.45, reversed: true } },
  { id: 'PHIN', label: 'Porosidad neutrónica corregida', unit: 'v/v', family: 'porosity', origin: 'computed', display: { color: '#1f77b4', scale: 'linear', min: -0.15, max: 0.45, reversed: true } },
  { id: 'PHIS', label: 'Porosidad sónica', unit: 'v/v', family: 'porosity', origin: 'computed', display: { color: '#9467bd', scale: 'linear', min: -0.15, max: 0.45, reversed: true } },
  { id: 'PHIT', label: 'Porosidad total', unit: 'v/v', family: 'porosity', origin: 'computed', display: { color: '#000000', scale: 'linear', min: 0, max: 0.4, reversed: true } },
  { id: 'PHIE', label: 'Porosidad efectiva', unit: 'v/v', family: 'porosity', origin: 'computed', display: { color: '#1f3fbf', scale: 'linear', min: 0, max: 0.4, reversed: true } },
  { id: 'SW', label: 'Saturación de agua', unit: 'v/v', family: 'saturation', origin: 'computed', display: { color: '#1f77b4', scale: 'linear', min: 0, max: 1, reversed: true } },
  { id: 'SXO', label: 'Saturación de agua en zona lavada', unit: 'v/v', family: 'saturation', origin: 'computed', display: { color: '#17becf', scale: 'linear', min: 0, max: 1, reversed: true } },
  { id: 'BVW', label: 'Volumen de agua', unit: 'v/v', family: 'saturation', origin: 'computed', display: { color: '#4682b4', scale: 'linear', min: 0, max: 0.4, reversed: true } },
  { id: 'SH', label: 'Saturación de hidrocarburos', unit: 'v/v', family: 'saturation', origin: 'computed', display: { color: '#b03a2e', scale: 'linear', min: 0, max: 1 } },
  // Agua de formación (fase 6a): Rw a temperatura de formación, por muestra, y Rw aparente
  { id: 'RW', label: 'Resistividad del agua (Rw)', unit: 'ohm.m', family: 'resistivity', origin: 'computed', display: { color: '#0b5394', scale: 'log', min: 0.01, max: 10 } },
  { id: 'RWA', label: 'Resistividad aparente del agua (Rwa)', unit: 'ohm.m', family: 'resistivity', origin: 'computed', display: { color: '#3d85c6', scale: 'log', min: 0.01, max: 10 } },
  { id: 'PERM', label: 'Permeabilidad', unit: 'mD', family: 'permeability', origin: 'computed', display: { color: '#ff7f0e', scale: 'log', min: 0.01, max: 10000 } },
  { id: 'NET_RES', label: 'Bandera de reservorio neto', unit: 'unitless', family: 'flag', origin: 'computed', display: { color: '#f1c40f', scale: 'linear', min: 0, max: 1 } },
  { id: 'NET_PAY', label: 'Bandera de pay neto', unit: 'unitless', family: 'flag', origin: 'computed', display: { color: '#e74c3c', scale: 'linear', min: 0, max: 1 } },
  { id: 'LITHO', label: 'Clase litológica', unit: 'unitless', family: 'lithology', origin: 'computed', display: { color: '#555555', scale: 'linear' } },
];

const ROLE_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** Catálogo inmutable de roles. Se arma una vez (con los roles declarados por módulos) en el registro. */
export class RoleCatalog {
  private readonly byId: ReadonlyMap<RoleId, RoleDef>;

  constructor(roles: readonly RoleDef[]) {
    const map = new Map<RoleId, RoleDef>();
    for (const r of roles) map.set(r.id, r);
    this.byId = map;
  }

  get(id: RoleId): RoleDef | undefined {
    return this.byId.get(id);
  }

  has(id: RoleId): boolean {
    return this.byId.has(id);
  }

  all(): RoleDef[] {
    return [...this.byId.values()];
  }

  /** Unidad canónica de un rol; lanza un error claro si el rol no existe. */
  unitOf(id: RoleId): UnitId {
    const r = this.byId.get(id);
    if (!r) throw new Error(`Rol de curva desconocido: '${id}'.`);
    return r.unit;
  }

  dimensionOf(id: RoleId): DimensionId | undefined {
    const r = this.byId.get(id);
    return r ? getUnit(r.unit)?.dimension : undefined;
  }
}

/** Valida una definición de rol; devuelve una lista de problemas (vacía si está bien). */
export function validateRoleDef(r: RoleDef): string[] {
  const problems: string[] = [];
  if (!ROLE_ID_PATTERN.test(r.id)) problems.push(`El id de rol '${r.id}' debe estar en MAYÚSCULAS (letras, números y _).`);
  if (!r.label?.trim()) problems.push(`El rol '${r.id}' no tiene etiqueta.`);
  if (!getUnit(r.unit)) problems.push(`El rol '${r.id}' usa la unidad desconocida '${r.unit}'.`);
  return problems;
}

export const defaultRoleCatalog = new RoleCatalog(BUILTIN_ROLES);
