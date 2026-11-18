import { createPointSet } from '../../core/pointSets';
import { parseUnit, sameDimension } from '../../core/units';
import { nonempty } from './scenario';

export const HEIGHT_LAB_KIND = 'saturation-height-capillary';

interface LabRow {
  sample: string;
  mdM: number;
  pc: number;
  sw: number;
}
interface LabTable {
  version: 1;
  reference: string;
  pressureUnit: string;
  saturationUnit: string;
  rows: LabRow[];
}

/** Importa valores de ensayo con MD original declarada del plug. Las condiciones se revisan al asignar la clase. */
export function readHeightLab(text: string, filename: string, id: string) {
  const table = JSON.parse(text) as Partial<LabTable> | null;
  if (table?.version !== 1 || !nonempty(table.reference) || !nonempty(table.pressureUnit) ||
    !nonempty(table.saturationUnit) || !Array.isArray(table.rows) || !table.rows.length) {
    throw new Error('El archivo requiere version 1, reference, pressureUnit, saturationUnit y rows.');
  }
  const pUnit = parseUnit(table.pressureUnit), swUnit = parseUnit(table.saturationUnit);
  if (!pUnit || !swUnit || !sameDimension(pUnit, 'kPa') || !sameDimension(swUnit, 'v/v')) {
    throw new Error('Unidades incompatibles. Declarar presión y saturación volumétrica.');
  }
  const mdBySample = new Map<string, number>();
  for (const row of table.rows) {
    if (!row || !nonempty(row.sample) || ![row.mdM, row.pc, row.sw].every(Number.isFinite)) {
      throw new Error('Cada fila requiere sample, MD original en m, Pc y Sw finitas.');
    }
    if (mdBySample.has(row.sample) && mdBySample.get(row.sample) !== row.mdM) throw new Error('Una misma muestra declara varias MD.');
    mdBySample.set(row.sample, row.mdM);
  }
  return createPointSet({
    id, name: filename, kind: HEIGHT_LAB_KIND, source: table.reference,
    depth: Float64Array.from(table.rows, row => row.mdM),
    pointIds: table.rows.map((_, index) => `fila-${index + 1}`),
    columns: {
      sample: { label: 'Muestra', values: table.rows.map(row => row.sample) },
      pc: { label: 'Presión capilar', unit: pUnit, values: Float64Array.from(table.rows, row => row.pc) },
      sw: { label: 'Saturación mojante de ensayo', unit: swUnit, values: Float64Array.from(table.rows, row => row.sw) },
    },
  });
}
