import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { parseTable, readWellFile } from '../../src/io';

const r2 = (x: number): number => Math.round(x * 100) / 100;

describe('CSV del TP (datos/pozo_tp_perfiles.csv)', () => {
  const { well, zones, columns, warnings } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const curve = (id: string) => well.curves.find((c) => c.id === id)!;

  it('profundidad: 5810 muestras en metros, de 7633,2588 a 8518,55 cada 0,1524', () => {
    expect(well.depth.values).toHaveLength(5810);
    expect(well.depth.values[0]).toBeCloseTo(7633.2588, 4);
    expect(r2(well.depth.values[5809]!)).toBe(8518.55);
    expect(well.depth.step).not.toBeNull();
    expect(well.depth.step!).toBeCloseTo(0.1524, 6);
    expect(well.depth.sourceUnit).toBe('m');
  });

  it('18 curvas (20 columnas menos profundidad y zona); ZONA no es una curva', () => {
    expect(well.curves).toHaveLength(18);
    expect(well.curves.map((c) => c.id)).not.toContain('ZONA');
    expect(well.curves.map((c) => c.id)).not.toContain('DEPTH');
    expect(well.name).toBe('pozo_tp_perfiles');
  });

  it('5 zonas A-E con los límites de datos/README.md', () => {
    expect(zones.map((z) => z.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
    const expected = [
      [7633.26, 7724.39],
      [7724.55, 7906.05],
      [7906.21, 7969.91],
      [7970.06, 8246.97],
      [8247.13, 8518.55],
    ];
    zones.forEach((z, i) => {
      expect([r2(z.top), r2(z.base)]).toEqual(expected[i]);
      expect(z.top).toBeLessThan(z.base);
    });
    // colores del demo
    expect(zones.map((z) => z.color)).toEqual(['#e8c872', '#9ec5e8', '#f2a65a', '#b8d98b', '#c9a3d9']);
  });

  it('SP con 12 valores finitos y DT con 70 NaN', () => {
    expect(curve('SP').data.filter(Number.isFinite)).toHaveLength(12);
    expect(curve('DT').data.filter(Number.isNaN)).toHaveLength(70);
  });

  it('valores puntuales de la primera fila', () => {
    expect(curve('ZDEN').data[0]).toBe(2.404);
    expect(curve('PE').data[0]).toBe(16.951);
    expect(curve('AT90').data[1]).toBe(0.62);
    expect(curve('BS').data.every((v) => v === 8.5)).toBe(true);
  });

  it('roles y unidades sugeridos', () => {
    const roles = Object.fromEntries(well.curves.map((c) => [c.id, c.role]));
    expect(roles).toMatchObject({
      BS: 'BS', CAL: 'CALI', GR: 'GR', SP: 'SP', ZDEN: 'RHOB', PE: 'PEF', DT: 'DT', NPHI: 'NPHI',
      AT60: 'RM', AT90: 'RT', URAN: 'URAN', THOR: 'THOR', POTA: 'POTA',
      PHI_BVI: 'BVI_NMR', PHIE_CMR: 'PHIE_NMR', PHIT_CMR: 'PHIT_NMR',
    });
    expect(roles['AT10']).toBe('RA10');
    expect(roles['AT30']).toBe('RA30');
    const units = Object.fromEntries(well.curves.map((c) => [c.id, c.unit]));
    expect(units).toMatchObject({ ZDEN: 'g/cm3', DT: 'us/ft', AT90: 'ohm.m', POTA: 'wt%', NPHI: 'v/v', CAL: 'in' });
  });

  it('el asistente de columnas recibe una entrada por columna del archivo', () => {
    expect(columns).toHaveLength(20);
    expect(columns[0]).toMatchObject({ name: 'DEPTH', kind: 'depth' });
    expect(columns[1]).toMatchObject({ name: 'ZONA', kind: 'zone' });
    expect(columns[2]).toMatchObject({ name: 'BS', kind: 'curve', role: 'BS' });
    expect(warnings.filter((w) => /descart/.test(w))).toEqual([]);
  });

  it('parseTable entrega la tabla cruda sin interpretar roles', () => {
    const t = parseTable(csvText, 'pozo_tp_perfiles.csv');
    expect(t.format).toBe('csv');
    expect(t.rowCount).toBe(5810);
    expect(t.columns[1]).toMatchObject({ name: 'ZONA', kind: 'text' });
    expect(t.sourceRows[0]).toBe(2);
  });
});

describe('CSV: variantes de formato', () => {
  it('punto y coma con decimal coma, nulos típicos y fila de unidades', () => {
    const txt = 'DEPTH;GR;RHOB;ILD\nft;gAPI;g/cc;ohmm\n1000,5;45,5;2,31;10\n1001;-999,25;-999;NULL\n1001,5;60;2,4;NaN\n';
    const { well } = readWellFile(txt, 'a.csv');
    expect(Array.from(well.depth.values)).toEqual([1000.5 * 0.3048, 1001 * 0.3048, 1001.5 * 0.3048]);
    expect(well.depth.sourceUnit).toBe('ft');
    const gr = well.curves.find((c) => c.id === 'GR')!;
    expect(Array.from(gr.data)).toEqual([45.5, NaN, 60]);
    expect(well.curves.find((c) => c.id === 'RHOB')!.unit).toBe('g/cm3');
    expect(well.curves.find((c) => c.id === 'RHOB')!.data[1]).toBeNaN();
    expect(Array.from(well.curves.find((c) => c.id === 'ILD')!.data)).toEqual([10, NaN, NaN]);
    expect(well.curves.find((c) => c.id === 'ILD')!.role).toBe('RT');
  });

  it('tabulación, BOM, comillas y unidad entre paréntesis en el encabezado', () => {
    const txt = '﻿DEPT (m)\t"GR (gAPI)"\tNPHI (PU)\r\n10\t50\t20\r\n10.5\t55\t25\r\n';
    const { well } = readWellFile(txt, 'b.txt');
    expect(Array.from(well.depth.values)).toEqual([10, 10.5]);
    expect(well.curves.map((c) => [c.id, c.unit])).toEqual([['GR', 'gAPI'], ['NPHI', '%']]);
  });

  it('columnas de texto que no son zona se descartan con aviso', () => {
    const txt = 'DEPTH,GR,COMENTARIO\n1,10,ok\n2,20,bien\n3,30,mal\n';
    const { well, warnings } = readWellFile(txt, 'c.csv');
    expect(well.curves.map((c) => c.id)).toEqual(['GR']);
    expect(warnings.some((w) => w.includes("'COMENTARIO'") && w.includes('descart'))).toBe(true);
  });

  it('profundidad decreciente de punta a punta se invierte (con las zonas)', () => {
    const txt = 'DEPTH,ZONA,GR\n4,B,40\n3,B,30\n2,A,20\n1,A,10\n';
    const { well, zones, warnings } = readWellFile(txt, 'd.csv');
    expect(Array.from(well.depth.values)).toEqual([1, 2, 3, 4]);
    expect(Array.from(well.curves[0]!.data)).toEqual([10, 20, 30, 40]);
    expect(zones.map((z) => [z.name, z.top, z.base])).toEqual([['A', 1, 2], ['B', 3, 4]]);
    expect(warnings.some((w) => w.includes('invirtió'))).toBe(true);
  });
});

describe('CSV: errores en español', () => {
  it('archivo vacío', () => {
    expect(() => readWellFile('', 'x.csv')).toThrow('vacío');
    expect(() => readWellFile('  \n \n', 'x.csv')).toThrow('vacío');
    expect(() => readWellFile(new Uint8Array(0), 'x.csv')).toThrow('vacío');
  });

  it('sin profundidad numérica', () => {
    expect(() => readWellFile('FORMACION,GR\nArenisca,10\nLutita,20\n', 'x.csv')).toThrow(/profundidad/);
    expect(() => readWellFile('solo texto\nmas texto\n', 'x.csv')).toThrow(/encabezado/);
  });

  it('profundidad no creciente: indica la fila', () => {
    expect(() => readWellFile('DEPTH,GR\n1,10\n2,20\n1.5,30\n4,40\n', 'x.csv')).toThrow(/no creciente en la fila 4/);
  });

  it('profundidad duplicada: indica la fila', () => {
    expect(() => readWellFile('DEPTH,GR\n1,10\n2,20\n2,30\n', 'x.csv')).toThrow(/duplicada en la fila 4/);
  });
});
