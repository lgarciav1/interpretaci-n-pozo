/** Escritor LAS 2.0 (WRAP=NO, una fila por muestra). Lo lee `parseLas` sin pérdida. */
import { LAS_NULL, numText, oneLine, prepareExport, sanitizeMnemonic, unitText } from './prepare';
import type { ExportInput } from './types';

const RESERVED = new Set(['STRT', 'STOP', 'STEP', 'NULL', 'WELL']);

function line(mnemonic: string, unit: string, value: string, description: string): string {
  return `${`${mnemonic}.${unit}`.padEnd(16)} ${value} : ${description}`.trimEnd();
}

/** El texto de un valor del encabezado no puede traer ':' (separa la descripción) ni saltos de línea. */
const safeValue = (v: string | number) => oneLine(String(v)).replace(/:/g, '-');

export function writeLas(input: ExportInput): string {
  const p = prepareExport(input, 'DEPT');
  const nul = p.nullValue ?? LAS_NULL;
  const u = p.depthUnit;
  const out: string[] = [
    '~VERSION INFORMATION',
    line('VERS', '', '2.0', 'CWLS LOG ASCII STANDARD - VERSION 2.0'),
    line('WRAP', '', 'NO', 'ONE LINE PER DEPTH STEP'),
    '~WELL INFORMATION',
    line('STRT', u, numText(p.top), 'START DEPTH'),
    line('STOP', u, numText(p.base), 'STOP DEPTH'),
    line('STEP', u, numText(p.step ?? 0), p.step === null ? 'IRREGULAR SAMPLING' : 'STEP'),
    line('NULL', '', numText(nul), 'NULL VALUE'),
    line('WELL', '', safeValue(p.wellName || 'SIN NOMBRE'), 'WELL'),
  ];
  const seen = new Set(RESERVED);
  for (const [key, e] of Object.entries(p.header)) {
    const m = sanitizeMnemonic(key).toUpperCase();
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(line(m, e.unit ? unitText(e.unit) : '', safeValue(e.value), oneLine(e.description ?? '')));
  }
  out.push('~CURVE INFORMATION', line('DEPT', u, '', 'DEPTH'));
  for (const c of p.columns) out.push(line(c.name, c.unit, '', c.description || (c.origin === 'computed' ? 'CALCULATED' : '')));
  out.push('~A  ' + ['DEPT', ...p.columns.map((c) => c.name)].map((s) => s.padStart(10)).join(' '));

  const n = p.depth.length;
  for (let i = 0; i < n; i++) {
    let row = numText(p.depth[i]!).padStart(10);
    for (const c of p.columns) {
      const v = c.values[i]!;
      row += ' ' + (Number.isNaN(v) ? numText(nul) : numText(v)).padStart(10);
    }
    out.push(row);
  }
  return out.join('\n') + '\n';
}
