/** Preparación común a los tres escritores: tramo, unidad de profundidad, selección y nombres únicos. */
import { convert } from '../../core/units';
import { makeDepthIndex } from '../../core/well';
import type { ExportInput, PreparedColumn, PreparedExport } from './types';

export const LAS_NULL = -999.25;

/** Mnemónico válido para LAS y para encabezados CSV/xlsx: sin espacios, puntos, dos puntos, comas ni paréntesis. */
export function sanitizeMnemonic(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_\-+#%&@$]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s === '' ? 'CURVA' : s;
}

/** Nombres únicos (sin distinguir mayúsculas) respetando `reserved`; el repetido recibe `_2`, `_3`... */
export function uniqueNames(wanted: readonly string[], reserved: readonly string[] = []): string[] {
  const used = new Set(reserved.map((r) => r.toUpperCase()));
  return wanted.map((raw) => {
    const base = sanitizeMnemonic(raw);
    let name = base;
    for (let k = 2; used.has(name.toUpperCase()); k++) name = `${base}_${k}`;
    used.add(name.toUpperCase());
    return name;
  });
}

/** Texto de unidad para el archivo: sin unidad -> ''; sin espacios (el lector LAS corta en el primero). */
export function unitText(unit: string): string {
  const u = unit.trim();
  return u === 'unitless' ? '' : u.replace(/\s+/g, '');
}

/** Una línea de texto: sin saltos de línea ni caracteres de control. */
export function oneLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

export function prepareExport(input: ExportInput, depthName: string): PreparedExport {
  const { depth } = input;
  const depthUnit = input.depthUnit ?? 'm';
  if (depth.length === 0) throw new Error('El pozo no tiene muestras para exportar.');
  for (const c of input.columns) {
    if (c.data.length !== depth.length) {
      throw new Error(`La curva '${c.id}' tiene ${c.data.length} muestras y la profundidad ${depth.length}.`);
    }
  }

  // Tramo: contiguo porque la profundidad es creciente.
  let i0 = 0;
  let i1 = depth.length;
  if (input.range) {
    const { top, base } = input.range;
    if (!(Number.isFinite(top) && Number.isFinite(base) && top <= base)) throw new Error('El tramo a exportar es inválido: el tope debe ser menor o igual a la base.');
    i0 = 0;
    while (i0 < depth.length && depth[i0]! < top) i0++;
    i1 = i0;
    while (i1 < depth.length && depth[i1]! <= base) i1++;
    if (i1 <= i0) throw new Error(`El tramo ${top}–${base} m no tiene muestras.`);
  }
  const depthM = depth.subarray(i0, i1);
  const stepM = makeDepthIndex(depthM).step;

  const chosen = input.selection ? input.columns.filter((c) => input.selection!.includes(c.id)) : [...input.columns];
  const names = uniqueNames(
    chosen.map((c) => c.mnemonic || c.id),
    [depthName],
  );
  const columns: PreparedColumn[] = chosen.map((c, k) => ({
    name: names[k]!,
    unit: unitText(c.unit),
    description: oneLine(c.description ?? ''),
    origin: c.origin,
    values: c.data.subarray(i0, i1),
  }));

  // En pies se redondea a 1e-6 (0,3 µm): sin esto salen 25248,999999999996.
  const toUnit = (m: number) => (depthUnit === 'm' ? m : Math.round(convert(m, 'm', depthUnit) * 1e6) / 1e6);
  const depthOut = depthUnit === 'm' ? depthM : Float64Array.from(depthM, toUnit);

  return {
    wellName: oneLine(input.wellName),
    header: input.header ?? {},
    depthUnit,
    depth: depthOut,
    step: stepM === null ? null : depthUnit === 'm' ? stepM : Math.round(convert(stepM, 'm', depthUnit) * 1e9) / 1e9,
    columns,
    zones: (input.zones ?? []).map((z) => ({ ...z, top: toUnit(z.top), base: toUnit(z.base) })),
    summary: input.summary ?? null,
    nullValue: input.nullValue === undefined ? null : input.nullValue,
    top: depthOut[0]!,
    base: depthOut[depthOut.length - 1]!,
    generatedAt: input.generatedAt ?? new Date(),
  };
}

/** Número a texto sin pérdida (ida y vuelta exacta) y con punto decimal. */
export function numText(v: number): string {
  return String(v);
}
