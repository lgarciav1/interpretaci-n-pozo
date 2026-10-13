/** Archivos del sintético: CSV en tiempo sin fingir un eje de profundidad y LAS nativo en profundidad. */
import type { TableValue } from '../../core/module';
import type { Well } from '../../core/well';
import { buildExportFile, safeFileName, type ExportFile } from '../../io/export';

export function syntheticCsv(name: string, kind: 'time' | 'depth-time', table: TableValue): ExportFile {
  const keys = kind === 'time' ? ['time', 'impedance', 'reflectivity', 'trace'] : ['depth', 'twt'];
  const header = kind === 'time' ? ['TWT_ms', 'AI_MRayl', 'RC', 'SYNTHETIC'] : ['DEPTH_m', 'TWT_ms'];
  const lines = [header.join(','), ...table.rows.map(row => keys.map(key => typeof row[key] === 'number' && Number.isFinite(row[key]) ? String(row[key]) : '').join(','))];
  return { name: `${safeFileName(name)}_${kind === 'time' ? 'sintetico_tiempo' : 'tiempo_profundidad'}.csv`, mime: 'text/csv;charset=utf-8', bytes: new TextEncoder().encode('\ufeff' + lines.join('\r\n') + '\r\n') };
}

export function syntheticLas(well: Well, trace: Float64Array, twt: Float64Array, impedance: Float64Array, reflectivity: Float64Array): ExportFile {
  return buildExportFile('las', `${well.name}_sintetico_profundidad`, {
    wellName: well.name, header: well.header, depth: well.depth.values,
    columns: [
      { id: 'trace', mnemonic: 'SYNTHETIC', unit: 'unitless', description: 'Sismograma acústico sintético remapeado a profundidad', data: trace, origin: 'computed' },
      { id: 'twt', mnemonic: 'TWT', unit: 'ms', description: 'Tiempo doble relativo o con referencia configurada', data: twt, origin: 'computed' },
      { id: 'ai', mnemonic: 'AI', unit: 'MRayl', description: 'Impedancia acústica en MRayl', data: impedance, origin: 'computed' },
      { id: 'rc', mnemonic: 'RC', unit: 'unitless', description: 'Reflectividad acústica a incidencia normal', data: reflectivity, origin: 'computed' },
    ], nullValue: -999.25,
  });
}
