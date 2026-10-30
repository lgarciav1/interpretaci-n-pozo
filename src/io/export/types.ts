/**
 * Tipos comunes de los escritores (LAS, CSV, xlsx). Puro: sin React ni DOM, corre en Node, navegador y worker.
 * Decisiones: docs/decisiones/0011-exportacion-de-datos.md.
 */
import type { HeaderEntry } from '../../core/well';

/** Columna a exportar: una curva medida del pozo o una calculada por el motor. */
export interface ExportColumn {
  /** Único dentro de la exportación (selección); el nombre de la columna en el archivo sale de `mnemonic`. */
  id: string;
  mnemonic: string;
  /** Unidad de `data` (id de `src/core/units.ts`, p. ej. `ohm.m`, `g/cm3`); '' o `unitless` = sin unidad. */
  unit: string;
  description?: string;
  /** Alineada con la profundidad de la exportación. NaN = sin dato. */
  data: Float64Array;
  origin: 'measured' | 'prepared' | 'computed';
}

export interface ExportZone {
  name: string;
  /** m */
  top: number;
  base: number;
  kind?: string;
}

export interface SummaryColumn {
  key: string;
  label: string;
  unit?: string;
  kind?: 'number' | 'text';
}

/** Tabla del sumario por zona tal como la publica el módulo `zone-summary` (valores en las unidades del módulo). */
export interface ExportSummary {
  columns: readonly SummaryColumn[];
  rows: readonly Readonly<Record<string, number | string | null>>[];
}

export type DepthUnit = 'm' | 'ft';

export interface ExportInput {
  wellName: string;
  /** Metadatos del pozo (UWI, compañía...); van al encabezado ~W de LAS y a la hoja Encabezado. */
  header?: Readonly<Record<string, HeaderEntry>>;
  /** Profundidad en metros, estrictamente creciente. */
  depth: Float64Array;
  columns: readonly ExportColumn[];
  zones?: readonly ExportZone[];
  summary?: ExportSummary;
  /** Ids de `columns` a exportar (por defecto todas), en el orden de `columns`. */
  selection?: readonly string[];
  /** Tramo en metros, inclusivo. Por defecto todo el pozo. */
  range?: { top: number; base: number };
  /** Unidad de la profundidad del archivo (por defecto m). Las curvas no se convierten. */
  depthUnit?: DepthUnit;
  /**
   * Valor que reemplaza a los NaN. `null` = celda vacía (CSV, xlsx); LAS no admite vacío y usa -999.25.
   * Por defecto: vacío en CSV y xlsx, -999.25 en LAS.
   */
  nullValue?: number | null;
  /** Fecha de generación (para tests deterministas). */
  generatedAt?: Date;
}

export interface PreparedColumn {
  /** Nombre único y válido para LAS (sin espacios, puntos ni dos puntos). */
  name: string;
  unit: string;
  description: string;
  origin: 'measured' | 'prepared' | 'computed';
  values: Float64Array;
}

export interface PreparedExport {
  wellName: string;
  header: Readonly<Record<string, HeaderEntry>>;
  depthUnit: DepthUnit;
  /** En `depthUnit`. */
  depth: Float64Array;
  /** Paso en `depthUnit` si el muestreo es regular, si no null. */
  step: number | null;
  columns: PreparedColumn[];
  zones: ExportZone[];
  summary: ExportSummary | null;
  nullValue: number | null;
  /** Tramo realmente exportado, en `depthUnit`. */
  top: number;
  base: number;
  generatedAt: Date;
}

