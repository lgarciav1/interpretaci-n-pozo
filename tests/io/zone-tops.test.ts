/**
 * Pegar topes (F09): lectura de la planilla (tabulado, CSV con ; o coma, decimal coma o punto, encabezado opcional,
 * con o sin base) y cada validación con su mensaje.
 */
import { describe, expect, it } from 'vitest';
import { parseDepthCell, parseZoneTopsText, readZoneTopsFile } from '../../src/io';
import type { Zone } from '../../src/core/well';
import { depthRange } from '../helpers';
import { makeXlsx } from './xlsxFixture';

// 1000–1050 m cada 0,5 m (101 muestras).
const depth = depthRange(101, 1000, 0.5);
const parse = (text: string, keep: Zone[] = []) => parseZoneTopsText(text, { depth, keep });
const messages = (text: string, keep: Zone[] = []) => parse(text, keep).problems.map((p) => `${p.severity}: ${p.message}`);
const errorsOf = (text: string, keep: Zone[] = []) => parse(text, keep).problems.filter((p) => p.severity === 'error').map((p) => p.message);
const zone = (id: string, top: number, base: number): Zone => ({ id, name: id.toUpperCase(), top, base, color: '#888888', kind: 'formation' });

describe('números', () => {
  it('lee decimal coma, punto, miles y unidad', () => {
    expect(parseDepthCell('1010,5')).toEqual({ kind: 'ok', value: 1010.5 });
    expect(parseDepthCell('1010.5')).toEqual({ kind: 'ok', value: 1010.5 });
    expect(parseDepthCell('7.633,5')).toEqual({ kind: 'ok', value: 7633.5 });
    expect(parseDepthCell('7,633.5')).toEqual({ kind: 'ok', value: 7633.5 });
    expect(parseDepthCell('1010 m')).toEqual({ kind: 'ok', value: 1010 });
    expect(parseDepthCell(' ')).toEqual({ kind: 'empty' });
    expect(parseDepthCell('abc').kind).toBe('bad');
    expect(parseDepthCell('1,2,x').kind).toBe('bad');
  });
});

describe('parseo', () => {
  it('texto tabulado con encabezado y sin base: cada zona llega a la muestra anterior a la siguiente y la última al fondo', () => {
    const r = parse('Nombre\tTope (m)\nA\t1000\nB\t1010\nC\t1030');
    expect(r.errors).toBe(0);
    expect(r.hasHeader).toBe(true);
    expect(r.drafts.map((d) => [d.name, d.top, d.base])).toEqual([
      ['A', 1000, 1009.5],
      ['B', 1010, 1029.5],
      ['C', 1030, 1050],
    ]);
  });

  it('CSV con «;» y decimal coma, con base explícita; ajusta a la muestra más cercana', () => {
    const r = parse('Formación;Tope;Base\nA;1000,2;1010,1\nB;1020;1030,0');
    expect(r.errors).toBe(0);
    expect(r.drafts.map((d) => [d.top, d.base])).toEqual([[1000, 1010], [1020, 1030]]);
    expect(r.rows.map((x) => x.explicitBase)).toEqual([true, true]);
  });

  it('CSV con coma y punto decimal; encabezado en inglés', () => {
    const r = parse('zone,top,bottom\nA,1000.5,1010\nB,1011,1020.5');
    expect(r.errors).toBe(0);
    expect(r.drafts.map((d) => [d.name, d.top, d.base])).toEqual([['A', 1000.5, 1010], ['B', 1011, 1020.5]]);
  });

  it('sin encabezado: el texto es el nombre y los números son tope y base, en ese orden', () => {
    const r = parse('A\t1000\t1010\nB\t1010,5\t1020');
    expect(r.hasHeader).toBe(false);
    expect(r.errors).toBe(0);
    expect(r.drafts).toHaveLength(2);
    expect(r.drafts[1]).toMatchObject({ name: 'B', top: 1010.5, base: 1020 });
  });

  it('el encabezado manda sobre el orden de las columnas', () => {
    const r = parse('Base;Tope;Zona\n1010;1000;A\n1020;1011;B');
    expect(r.errors).toBe(0);
    expect(r.drafts.map((d) => [d.name, d.top, d.base])).toEqual([['A', 1000, 1010], ['B', 1011, 1020]]);
  });

  it('una base igual al tope de la siguiente es un contacto compartido, no un solape', () => {
    const r = parse('Zona\tTope\tBase\nA\t1000\t1010\nB\t1010\t1050');
    expect(r.problems).toEqual([]);
    expect(r.drafts.map((d) => [d.top, d.base])).toEqual([[1000, 1009.5], [1010, 1050]]);
  });

  it('acepta las zonas desordenadas y salta filas vacías, conservando el número de fila', () => {
    const r = parse('Zona\tTope\nB\t1020\n\nA\t1000');
    expect(r.drafts.map((d) => d.name)).toEqual(['A', 'B']);
    expect(r.rows.map((x) => x.row)).toEqual([2, 4]);
  });

  it('con zonas que se conservan, la última llega hasta la próxima zona que existe', () => {
    const r = parse('Zona\tTope\nN\t1010', [zone('k', 1030, 1040)]);
    expect(r.errors).toBe(0);
    expect(r.drafts[0]).toMatchObject({ name: 'N', top: 1010, base: 1029.5 });
  });

  it('un .csv se lee como texto y un .xlsx pasa por el lector de libros', () => {
    expect(parse(readZoneTopsFile('Zona;Tope\nA;1000', 'topes.csv')).drafts).toHaveLength(1);
    const xlsx = makeXlsx([{ name: 'Hoja1', rows: [['Zona', 'Tope'], ['A', 1000], ['B', 1010.5]] }]);
    const r = parse(readZoneTopsFile(xlsx, 'topes.xlsx'));
    expect(r.errors).toBe(0);
    expect(r.drafts.map((d) => [d.name, d.top])).toEqual([['A', 1000], ['B', 1010.5]]);
  });
});

describe('validaciones', () => {
  it('tope fuera del pozo: dice el rango', () => {
    expect(errorsOf('Zona\tTope\nA\t990\nB\t1010')).toEqual(['Fila 2: el tope de «A» (990 m) está fuera del pozo, que va de 1000–1050 m.']);
    expect(errorsOf('Zona\tTope\nA\t1000\nB\t1080,5')[0]).toBe('Fila 3: el tope de «B» (1080,5 m) está fuera del pozo, que va de 1000–1050 m.');
  });

  it('base fuera del pozo', () => {
    expect(errorsOf('Zona\tTope\tBase\nA\t1000\t1100')).toEqual(['Fila 2: la base de «A» (1100 m) está fuera del pozo, que va de 1000–1050 m.']);
  });

  it('solape entre zonas: nombra las dos', () => {
    const e = errorsOf('Zona\tTope\tBase\nA\t1000\t1020\nB\t1015\t1030');
    expect(e).toEqual(['Fila 3: «B» (fila 3, 1015–1030 m) se solapa con «A» (fila 2, 1000–1020 m).']);
  });

  it('solape con una zona que ya existe (agregar)', () => {
    const e = errorsOf('Zona\tTope\tBase\nN\t1015\t1025', [zone('a', 1000, 1020)]);
    expect(e).toEqual(['Fila 2: «N» (fila 2, 1015–1025 m) se solapa con «A» (ya existe, 1000–1020 m).']);
  });

  it('base ≤ tope', () => {
    expect(errorsOf('Zona\tTope\tBase\nA\t1020\t1010')).toEqual(['Fila 2: la base de «A» (1010 m) no está por debajo de su tope (1020 m).']);
    expect(errorsOf('Zona\tTope\tBase\nA\t1020\t1020')[0]).toContain('no está por debajo');
  });

  it('nombres repetidos y vacíos', () => {
    expect(errorsOf('Zona\tTope\nA\t1000\na\t1010')).toEqual(['Filas 2 y 3: el nombre «a» está repetido.']);
    expect(errorsOf('Zona\tTope\nA\t1000\n\t1010')).toEqual(['Fila 3: falta el nombre de la zona.']);
    expect(errorsOf('Zona\tTope\nA\t1000', [zone('a', 1020, 1030)])).toEqual(['Fila 2: ya hay una zona «A» en el pozo; cambiá el nombre o reemplazá las zonas actuales.']);
  });

  it('números ilegibles y topes que faltan', () => {
    expect(errorsOf('Zona\tTope\tBase\nA\tmil\t1010')).toEqual(['Fila 2: el tope de «A» («mil») no es un número.']);
    expect(errorsOf('Zona\tTope\tBase\nA\t1000\tx')).toEqual(['Fila 2: la base de «A» («x») no es un número.']);
    expect(errorsOf('Zona\tTope\nA\t')).toEqual(['Fila 2: falta el tope de «A».']);
  });

  it('dos zonas con el mismo tope', () => {
    expect(errorsOf('Zona\tTope\nA\t1010\nB\t1010')).toEqual(['Filas 2 y 3: «A» y «B» empiezan en el mismo tope (1010 m).']);
  });

  it('un hueco o muestras sin zona son avisos y no bloquean', () => {
    const r = parse('Zona\tTope\tBase\nA\t1005\t1010\nB\t1020\t1030');
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(3);
    expect(messages('Zona\tTope\tBase\nA\t1005\t1010\nB\t1020\t1030')).toContain('warning: Hay un hueco entre «A» y «B» (1010–1020 m): esas muestras quedan sin zona.');
    expect(r.drafts).toHaveLength(2);
  });

  it('tabla vacía o solo encabezado', () => {
    expect(errorsOf('')).toEqual(['No hay nada para leer: pegá una tabla con el nombre y el tope de cada zona.']);
    expect(errorsOf('Zona\tTope')).toEqual(['La tabla solo tiene el encabezado: faltan las filas con las zonas.']);
  });

  it('las filas con error no entran en las zonas a crear', () => {
    const r = parse('Zona\tTope\nA\t1000\nB\t990');
    expect(r.errors).toBe(1);
    expect(r.drafts.map((d) => d.name)).toEqual(['A']);
    expect(r.rows[1]!.problems).toHaveLength(1);
  });
});
