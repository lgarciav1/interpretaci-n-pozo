/**
 * Lector de plugs de corona (src/io/core.ts, docs/decisiones/0010 D2): reconocimiento de columnas por nombre y por
 * unidad, conversión a las unidades del conjunto (m, v/v, mD, g/cm³), ids de plug y filas con problemas.
 * Los fixtures son CSV chicos escritos en el test.
 */
import { describe, expect, it } from 'vitest';
import { pointNumbers, pointTexts } from '../../src/core/pointSets';
import { buildCoreSet, parseTable, suggestCoreMapping, type CoreField } from '../../src/io';

const read = (csv: string, name = 'plugs.csv') => parseTable(csv, name, { requireDepth: false });
const fieldsOf = (csv: string) => Object.fromEntries(suggestCoreMapping(read(csv)).map((m) => [m.name, m.field]));
const num = (csv: string, key: string) => {
  const t = read(csv);
  return [...pointNumbers(buildCoreSet(t, suggestCoreMapping(t), { id: 'c' }).set, key)!];
};

describe('io/core: reconocimiento de columnas', () => {
  it('nombres en inglés: DEPTH, PHI, K, GD, CORONA, PLUG', () => {
    const f = fieldsOf('DEPTH,PHI,K,GD,CORONA,PLUG\n2500.5,0.125,10.2,2.65,1,A\n');
    expect(f).toEqual({ DEPTH: 'depth', PHI: 'phi', K: 'k', GD: 'rhog', CORONA: 'run', PLUG: 'plug' });
  });

  it('nombres en español con unidad entre paréntesis: PROF, POR, KAIR, RHOG, CORE', () => {
    const f = fieldsOf('PROF (m);POR (%);KAIR (mD);RHOG (g/cc);CORE\n2500,5;12,5;10,2;2,65;1\n');
    expect(f).toEqual({ PROF: 'depth', POR: 'phi', KAIR: 'k', RHOG: 'rhog', CORE: 'run' });
  });

  it('otros alias de porosidad y permeabilidad: CPOR, PERM, Porosidad, Permeabilidad', () => {
    expect(fieldsOf('MD;CPOR;PERM\n2500;0.1;5\n')).toMatchObject({ CPOR: 'phi', PERM: 'k' });
    expect(fieldsOf('Profundidad;Porosidad;Permeabilidad;Descripción\n2500;0.1;5;arenisca\n')).toEqual({
      Profundidad: 'depth',
      Porosidad: 'phi',
      Permeabilidad: 'k',
      Descripción: 'description',
    });
  });

  it('permeabilidad Klinkenberg gana a la de aire; la vertical se ignora', () => {
    const f = fieldsOf('MD;KLINK;KAIR;POR;KV\n2500;1;2;0.1;9\n2501;2;3;0.12;8\n');
    expect(f).toEqual({ MD: 'depth', KLINK: 'k', KAIR: 'ignore', POR: 'phi', KV: 'ignore' });
  });

  it('con una sola k al aire, se usa (confianza media)', () => {
    const m = suggestCoreMapping(read('MD;KAIR;POR\n2500;1;0.1\n'));
    expect(m.find((x) => x.name === 'KAIR')).toMatchObject({ field: 'k', confidence: 'medium' });
  });

  it('cada campo va a una sola columna (la primera si empatan)', () => {
    const f = fieldsOf('DEPTH,PHI,POR,K\n2500,0.1,0.11,5\n');
    expect(f['PHI']).toBe('phi');
    expect(f['POR']).toBe('ignore');
  });

  it('una columna numérica con unidad de permeabilidad y nombre desconocido se toma como k', () => {
    const f = fieldsOf('DEPTH,PHI,Medida (mD)\n2500,0.1,5\n');
    expect(f['Medida']).toBe('k');
  });

  it('sin columna de profundidad por nombre, propone la primera numérica libre', () => {
    const f = fieldsOf('Cota,PHI,K\n2500,0.1,5\n');
    expect(f['Cota']).toBe('depth');
  });

  it('una columna de texto no se toma como porosidad', () => {
    const f = fieldsOf('DEPTH,PHI,K\n2500,alta,5\n2501,baja,6\n');
    expect(f['PHI']).toBe('ignore');
  });
});

describe('io/core: construcción del conjunto', () => {
  const csv = 'DEPTH,PHI,K,GD,CORONA,PLUG,DESC\n2500.5,0.125,10.2,2.65,1,A,Arenisca media\n2501.5,0.08,0.5,2.66,1,B,Arenisca fina\n2503,0.2,300,2.7,2,A,Arenisca fisurada\n';

  it('columnas, unidades canónicas, texto y metadatos del conjunto', () => {
    const t = read(csv, 'plugs_c1.csv');
    const r = buildCoreSet(t, suggestCoreMapping(t), { id: 'c1' });
    const s = r.set;
    expect(s.kind).toBe('core');
    expect(s.id).toBe('c1');
    expect(s.name).toBe('plugs_c1'); // nombre del archivo sin extensión
    expect(s.source).toBe('plugs_c1.csv');
    expect(r.dropped).toBe(0);
    expect(r.warnings).toEqual([]);
    expect([...s.depth]).toEqual([2500.5, 2501.5, 2503]);
    expect([...pointNumbers(s, 'phi')!]).toEqual([0.125, 0.08, 0.2]);
    expect([...pointNumbers(s, 'k')!]).toEqual([10.2, 0.5, 300]);
    expect([...pointNumbers(s, 'rhog')!]).toEqual([2.65, 2.66, 2.7]);
    expect(s.columns['phi']).toMatchObject({ unit: 'v/v' });
    expect(s.columns['k']).toMatchObject({ unit: 'mD' });
    expect(s.columns['rhog']).toMatchObject({ unit: 'g/cm3' });
    expect(pointTexts(s, 'run')).toEqual(['1', '1', '2']);
    expect(pointTexts(s, 'description')).toEqual(['Arenisca media', 'Arenisca fina', 'Arenisca fisurada']);
  });

  it('el plug «A» se repite entre coronas: se antepone la corona (C1-A, C2-A); el único queda igual', () => {
    const t = read(csv);
    expect(buildCoreSet(t, suggestCoreMapping(t), { id: 'c' }).set.pointIds).toEqual(['C1-A', 'B', 'C2-A']);
  });

  it('sin columna de plug: P01, P02… en el orden del archivo', () => {
    const t = read('DEPTH,PHI\n2500,0.1\n2501,0.12\n');
    expect(buildCoreSet(t, suggestCoreMapping(t), { id: 'c' }).set.pointIds).toEqual(['P01', 'P02']);
  });

  it('ids repetidos dentro de la misma corona: se numeran y se avisa', () => {
    const t = read('DEPTH,PHI,PLUG\n2500,0.1,7\n2501,0.12,7\n2502,0.13,7\n');
    const r = buildCoreSet(t, suggestCoreMapping(t), { id: 'c' });
    expect(r.set.pointIds).toEqual(['7', '7 (2)', '7 (3)']);
    expect(r.warnings.some((w) => /2 plugs repiten el id de otro/.test(w))).toBe(true);
  });

  it('ordena por profundidad arrastrando todas las columnas', () => {
    const t = read('DEPTH,PHI,K\n2502,0.3,300\n2500,0.1,1\n2501,0.2,30\n');
    const s = buildCoreSet(t, suggestCoreMapping(t), { id: 'c' }).set;
    expect([...s.depth]).toEqual([2500, 2501, 2502]);
    expect([...pointNumbers(s, 'phi')!]).toEqual([0.1, 0.2, 0.3]);
    expect([...pointNumbers(s, 'k')!]).toEqual([1, 30, 300]);
  });

  it('nombre propio del conjunto', () => {
    const t = read(csv);
    expect(buildCoreSet(t, suggestCoreMapping(t), { id: 'c', name: '  Corona 1 y 2 ' }).set.name).toBe('Corona 1 y 2');
  });
});

describe('io/core: unidades', () => {
  it('porosidad en % declarada: 12,5 % → 0,125 v/v', () => {
    const m = suggestCoreMapping(read('DEPTH (m),POR (%),K (mD)\n2500,12.5,10\n2501,8,1\n'));
    expect(m.find((x) => x.name === 'POR')!.unit).toBe('%');
    expect(num('DEPTH (m),POR (%),K (mD)\n2500,12.5,10\n2501,8,1\n', 'phi')).toEqual([0.125, 0.08]);
  });

  it('porosidad sin unidad cuyo máximo pasa de 1,5: se toma como %', () => {
    expect(num('DEPTH,CPOR\n2500,12\n2501,15\n', 'phi')).toEqual([0.12, 0.15]);
  });

  it('porosidad sin unidad en fracción (máx. ≤ 1,5): queda en v/v', () => {
    expect(num('DEPTH,CPOR\n2500,0.12\n2501,0.15\n', 'phi')).toEqual([0.12, 0.15]);
  });

  it('porosidad en v/v declarada pero con valores > 1: avisa «¿la columna está en %?»', () => {
    const t = read('DEPTH,PHI (v/v)\n2500,12\n2501,0.1\n');
    const r = buildCoreSet(t, suggestCoreMapping(t), { id: 'c' });
    expect(r.warnings.some((w) => /1 plug tiene porosidad mayor que 1 v\/v/.test(w))).toBe(true);
  });

  it('profundidad en pies: 8000 ft → 2438,4 m', () => {
    const d = (csv: string) => {
      const t = read(csv);
      return [...buildCoreSet(t, suggestCoreMapping(t), { id: 'c' }).set.depth];
    };
    const z = d('DEPTH (ft),PHI\n8000,0.1\n8001,0.1\n');
    expect(z[0]).toBeCloseTo(2438.4, 9);
    expect(z[1]).toBeCloseTo(2438.7048, 9);
  });

  it('permeabilidad en darcy: 0,5 D → 500 mD', () => {
    expect(num('DEPTH,PHI,K (D)\n2500,0.1,0.5\n2501,0.1,2\n', 'k')).toEqual([500, 2000]);
  });

  it('densidad de grano en kg/m³: 2650 → 2,65 g/cm³', () => {
    const v = num('DEPTH,PHI,RHOG (kg/m3)\n2500,0.1,2650\n', 'rhog');
    expect(v[0]).toBeCloseTo(2.65, 9);
  });
});

describe('io/core: filas y archivos con problemas', () => {
  it('fila sin profundidad: se descarta con aviso y las demás siguen', () => {
    const t = read('DEPTH,PHI,K\n2500,0.1,5\n,0.2,50\n2502,0.3,500\n');
    const r = buildCoreSet(t, suggestCoreMapping(t), { id: 'c' });
    expect(r.dropped).toBe(1);
    expect(r.warnings).toEqual(['1 fila no tiene profundidad: se descarta.']);
    expect([...r.set.depth]).toEqual([2500, 2502]);
    expect([...pointNumbers(r.set, 'k')!]).toEqual([5, 500]);
  });

  it('varias filas sin profundidad: aviso en plural', () => {
    const t = read('DEPTH,PHI\n2500,0.1\n,0.2\n,0.3\n');
    expect(buildCoreSet(t, suggestCoreMapping(t), { id: 'c' }).warnings).toEqual(['2 filas no tienen profundidad: se descartan.']);
  });

  it('valor ilegible o vacío en φ o k: NaN en ese plug, el plug se conserva', () => {
    const t = read('DEPTH,PHI,K\n2500,0.1,\n2501,,50\n2502,0.3,500\n');
    const s = buildCoreSet(t, suggestCoreMapping(t), { id: 'c' }).set;
    expect(s.depth).toHaveLength(3);
    expect(pointNumbers(s, 'k')![0]).toBeNaN();
    expect(pointNumbers(s, 'phi')![1]).toBeNaN();
  });

  it('sin φ ni k: error en español', () => {
    const t = read('DEPTH,RHOG\n2500,2.65\n');
    expect(() => buildCoreSet(t, suggestCoreMapping(t), { id: 'c' })).toThrow(/al menos la porosidad o la permeabilidad/);
  });

  it('sin profundidad marcada: error en español', () => {
    const t = read('DEPTH,PHI\n2500,0.1\n');
    const m = suggestCoreMapping(t).map((x) => (x.field === 'depth' ? { ...x, field: 'ignore' as CoreField } : x));
    expect(() => buildCoreSet(t, m, { id: 'c' })).toThrow(/columna de profundidad/);
  });

  it('ninguna fila con profundidad: error en español', () => {
    const t = read('DEPTH,PHI\n,0.1\n,0.2\n');
    expect(() => buildCoreSet(t, suggestCoreMapping(t), { id: 'c' })).toThrow(/Ninguna fila tiene profundidad/);
  });

  it('dos columnas marcadas con el mismo campo: se usa la primera y se avisa', () => {
    const t = read('DEPTH,A,B\n2500,0.1,0.2\n2501,0.15,0.25\n');
    const m = suggestCoreMapping(t).map((x) => (x.name === 'A' || x.name === 'B' ? { ...x, field: 'phi' as CoreField, unit: 'v/v' as const } : x));
    const r = buildCoreSet(t, m, { id: 'c' });
    expect(r.warnings.some((w) => /dos columnas marcadas como «Porosidad»/.test(w))).toBe(true);
    expect([...pointNumbers(r.set, 'phi')!]).toEqual([0.1, 0.15]);
  });

  it('una unidad de otra magnitud para el campo: error en español', () => {
    const t = read('DEPTH,PHI,K\n2500,0.1,5\n');
    const m = suggestCoreMapping(t).map((x) => (x.field === 'k' ? { ...x, unit: 'm' as const } : x));
    expect(() => buildCoreSet(t, m, { id: 'c' })).toThrow(/no sirve para permeabilidad/);
  });
});

describe('io/core: unidad pegada al nombre (sin paréntesis)', () => {
  const colsOf = (csv: string) => Object.fromEntries(suggestCoreMapping(read(csv)).map((m) => [m.name, m]));

  it('«Depth ft» → profundidad en pies (no en metros) y conversión a m', () => {
    expect(colsOf('Depth ft,PHI\n8000,0.1\n8001,0.1\n')['Depth ft']).toMatchObject({ field: 'depth', unit: 'ft' });
    const t = read('Depth ft,PHI\n8000,0.1\n8001,0.1\n');
    expect(buildCoreSet(t, suggestCoreMapping(t), { id: 'c' }).set.depth[0]).toBeCloseTo(2438.4, 9);
  });

  it('«DEPTH_FT» con guion bajo: misma lectura', () => {
    expect(colsOf('DEPTH_FT,PHI\n8000,0.1\n')['DEPTH_FT']).toMatchObject({ field: 'depth', unit: 'ft' });
  });

  it('«Perm mD»: el token MD no le gana a PERM; la columna es k en mD', () => {
    expect(colsOf('DEPTH,PHI,Perm mD\n2500,0.1,5\n')['Perm mD']).toMatchObject({ field: 'k', unit: 'mD' });
  });

  it('«PHI %»: unidad % y conversión a v/v (1,2 % → 0,012)', () => {
    // Valores ≤ 1,5: sin la unidad, la heurística los dejaría en v/v; con «%» deben pasar a fracción.
    const c = colsOf('DEPTH,PHI %\n2500,1.2\n2501,0.8\n');
    expect(c['PHI %']).toMatchObject({ field: 'phi', unit: '%' });
    const v = num('DEPTH,PHI %\n2500,1.2\n2501,0.8\n', 'phi');
    expect(v[0]).toBeCloseTo(0.012, 9);
    expect(v[1]).toBeCloseTo(0.008, 9);
  });

  it('«K/mD»: k en mD; el MD de la unidad no es profundidad', () => {
    expect(colsOf('DEPTH,K/mD,PHI\n2500,5,0.1\n')['K/mD']).toMatchObject({ field: 'k', unit: 'mD' });
  });

  it('«MD» sola sigue siendo profundidad medida', () => {
    expect(colsOf('MD,PHI,K\n2500,0.1,5\n')['MD']).toMatchObject({ field: 'depth', unit: 'm' });
  });
});
