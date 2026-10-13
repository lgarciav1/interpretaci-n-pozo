/**
 * Preparación del dataset FORCE 2020 (scripts/ml/preparar-force2020.mjs, docs/decisiones/0030): mapeo de litologías,
 * filtrado de filas incompletas / fuera de rango / con derrumbe, determinismo del submuestreo y consistencia del
 * manifest. Usa pozos sintéticos diminutos; no lee el dataset real (ni hace falta tenerlo).
 */
import { describe, expect, it } from 'vitest';

// El guion es .mjs sin tipos: se importa por URL y se tipa lo mínimo que usa el test.
interface Row { DEPTH_MD: number; CALI: number; BS: number; GR: number; RHOB: number; NPHI: number; PEF: number; DTC: number; RDEP: number; RMED: number; code: number; conf: number }
interface Well { name: string; rows: Row[] }
interface Manifest {
  columns: string[];
  seed: number;
  classes: { id: number; name: string; codes: number[]; stride: number; completeRows: number; keptRows: number; wellsWithClass: number }[];
  counts: { wells: number; completeRows: number; keptRows: number; confidence: Record<string, number> };
  perWell: Record<string, { rows: number; complete: number; kept: number }>;
  funnel: Record<string, number>;
  dataSha256: string;
  grPercentilesPerWell: Record<string, { p5: number; p95: number }>;
}
interface Mod {
  CLASS_GROUPS: { id: number; name: string; codes: number[] }[];
  LITHOLOGY_CODES: { code: number }[];
  buildClassLookup: (groups?: unknown) => Map<number, number>;
  caliperFlags: (cali: number[], bs: number[]) => Uint8Array;
  cleanWell: (rows: Row[]) => { kept: { depth: number; vals: Record<string, number>; cls: number }[]; funnel: Record<string, number> };
  strideFor: (count: number, cap: number) => number;
  selectRows: (well: string, classIds: number[], strides: Map<number, number>, seed?: number) => boolean[];
  prepare: (open: () => Well[], cfg?: Record<string, unknown>) => Promise<{ csv: string; manifest: Manifest }>;
  createWellSplitter: (onWell: (w: Well) => void) => { push: (t: string) => void; end: () => void };
}

const mod = (await import(/* @vite-ignore */ new URL('../scripts/ml/preparar-force2020.mjs', import.meta.url).href)) as Mod;

function row(over: Partial<Row> = {}): Row {
  return { DEPTH_MD: 1000, CALI: 8.6, BS: 8.5, GR: 70, RHOB: 2.4, NPHI: 0.25, PEF: 4, DTC: 95, RDEP: 2, RMED: 2.1, code: 65000, conf: 1, ...over };
}

/** Pozo sintético: n filas cada 0,5 m con una litología por tramo. */
function makeWell(name: string, n: number, codeAt: (i: number) => number): Well {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) rows.push(row({ DEPTH_MD: 1000 + i * 0.5, GR: 40 + (i % 50), code: codeAt(i), conf: 1 + (i % 3) }));
  return { name, rows };
}

const wells = (): Well[] => [
  makeWell('A/1-1', 300, (i) => (i < 20 ? 90000 : i < 200 ? 65000 : 30000)),
  makeWell('B/2-2', 250, (i) => (i < 10 ? 93000 : i % 2 ? 65000 : 70000)),
];

describe('mapeo de litologías', () => {
  it('los 12 códigos de FORCE están en la tabla y cada uno cae en una sola clase', () => {
    expect(mod.LITHOLOGY_CODES.map((c) => c.code).sort()).toEqual([30000, 65000, 65030, 70000, 70032, 74000, 80000, 86000, 88000, 90000, 93000, 99000]);
    const lookup = mod.buildClassLookup();
    for (const { code } of mod.LITHOLOGY_CODES) expect(lookup.has(code)).toBe(true);
    expect(lookup.size).toBe(12);
  });

  it('agrupa caliza, creta y dolomía en una clase y halita con anhidrita en otra; un código desconocido no se mapea', () => {
    const lookup = mod.buildClassLookup();
    expect(lookup.get(70000)).toBe(lookup.get(70032));
    expect(lookup.get(70000)).toBe(lookup.get(74000));
    expect(lookup.get(88000)).toBe(lookup.get(86000));
    expect(lookup.get(30000)).not.toBe(lookup.get(65030));
    expect(lookup.get(12345)).toBeUndefined();
  });

  it('rechaza una agrupación con un código repetido', () => {
    expect(() => mod.buildClassLookup([{ id: 0, name: 'A', codes: [30000] }, { id: 1, name: 'B', codes: [30000] }])).toThrow(/repetido/);
  });
});

describe('filtrado de filas', () => {
  it('descarta filas sin una curva exigida y conserva las que solo carecen de PEF', () => {
    const { kept, funnel } = mod.cleanWell([row(), row({ NPHI: NaN }), row({ RMED: NaN }), row({ PEF: NaN })]);
    expect(kept).toHaveLength(2);
    expect(funnel.missingRequired).toBe(2);
    expect(Number.isNaN(kept[1]!.vals.PEF)).toBe(true);
  });

  it('descarta valores fuera de rango físico y blanquea el PEF imposible sin descartar la fila', () => {
    const { kept, funnel } = mod.cleanWell([row({ NPHI: 3.3 }), row({ RHOB: 0.7 }), row({ RDEP: 0 }), row({ PEF: 379 })]);
    expect(funnel.outOfRange).toBe(3);
    expect(kept).toHaveLength(1);
    expect(Number.isNaN(kept[0]!.vals.PEF)).toBe(true);
    expect(funnel.optionalDropped).toBe(1);
  });

  it('descarta derrumbe (CALI muy sobre el trépano) y CALI inválido (muy debajo); sin CALI se conserva', () => {
    const { kept, funnel } = mod.cleanWell([row({ CALI: 8.6 }), row({ CALI: 11 }), row({ CALI: 1.1 }), row({ CALI: NaN })]);
    expect(kept).toHaveLength(2);
    expect(funnel.washout).toBe(1);
    expect(funnel.invalidCaliper).toBe(1);
  });

  it('sin BS usa el BS más cercano del pozo; sin BS en todo el pozo, el percentil bajo del CALI', () => {
    expect(Array.from(mod.caliperFlags([8.6, 8.6, 12], [8.5, NaN, NaN]))).toEqual([1, 1, 2]);
    const cali = Array.from({ length: 100 }, (_, i) => (i < 90 ? 12.3 : 16));
    const flags = Array.from(mod.caliperFlags(cali, cali.map(() => NaN)));
    expect(flags.slice(0, 90).every((f) => f === 1)).toBe(true);
    expect(flags.slice(90).every((f) => f === 2)).toBe(true);
  });

  it('descarta las filas con un código de litología fuera de la tabla', () => {
    const { kept, funnel } = mod.cleanWell([row({ code: 65000 }), row({ code: 11111 })]);
    expect(kept).toHaveLength(1);
    expect(funnel.unknownLithology).toBe(1);
  });
});

describe('submuestreo determinista', () => {
  it('el paso es 1 bajo el tope y ceil(n / tope) sobre el tope', () => {
    expect(mod.strideFor(100, 100)).toBe(1);
    expect(mod.strideFor(101, 100)).toBe(2);
    expect(mod.strideFor(1000, 100)).toBe(10);
  });

  it('conserva 1 de cada k por clase, deja entera la clase rara y no depende del estado global', () => {
    const classes = [...Array(40).fill(2), ...Array(5).fill(8)];
    const strides = new Map([[2, 4], [8, 1]]);
    const a = mod.selectRows('X', classes, strides);
    const b = mod.selectRows('X', classes, strides);
    expect(a).toEqual(b);
    expect(a.slice(0, 40).filter(Boolean)).toHaveLength(10);
    expect(a.slice(40).every(Boolean)).toBe(true);
    // El desplazamiento depende de (semilla, pozo, clase): con varias semillas aparece al menos un patrón distinto.
    const others = [1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(mod.selectRows('X', classes, strides, seed)));
    expect(new Set([...others, JSON.stringify(a)]).size).toBeGreaterThan(1);
  });

  it('prepare() da el mismo CSV y el mismo manifest en dos corridas, respeta el tope y conserva el orden por profundidad', async () => {
    const cfg = { sampling: { capPerClass: 60 } };
    const r1 = await mod.prepare(wells, cfg);
    const r2 = await mod.prepare(wells, cfg);
    expect(r1.csv).toBe(r2.csv);
    expect(r1.manifest).toEqual(r2.manifest);
    const shale = r1.manifest.classes.find((c) => c.name === 'SHALE')!;
    expect(shale.stride).toBeGreaterThan(1);
    expect(shale.keptRows).toBeLessThanOrEqual(60 + 2 * 2); // tope + un redondeo por pozo
    const rare = r1.manifest.classes.find((c) => c.name === 'COAL')!;
    expect(rare.keptRows).toBe(rare.completeRows);
    const lines = r1.csv.trim().split('\n').slice(1).map((l) => l.split(','));
    for (const w of ['A/1-1', 'B/2-2']) {
      const depths = lines.filter((f) => f[0] === w).map((f) => Number(f[1]));
      expect(depths).toEqual([...depths].sort((x, y) => x - y));
    }
  });
});

describe('consistencia del manifest', () => {
  it('los recuentos, las columnas, el hash y los percentiles de GR coinciden con los datos', async () => {
    const { csv, manifest } = await mod.prepare(wells, { sampling: { capPerClass: 60 } });
    const lines = csv.trim().split('\n');
    const header = lines[0]!.split(',');
    expect(header).toEqual(manifest.columns);
    expect(header.slice(0, 2)).toEqual(['WELL', 'DEPTH_MD']);
    expect(header.slice(-2)).toEqual(['LITHO', 'CONFIDENCE']);
    expect(lines.length - 1).toBe(manifest.counts.keptRows);
    expect(manifest.classes.reduce((s, c) => s + c.keptRows, 0)).toBe(manifest.counts.keptRows);
    expect(manifest.classes.reduce((s, c) => s + c.completeRows, 0)).toBe(manifest.counts.completeRows);
    expect(Object.values(manifest.perWell).reduce((s, w) => s + w.kept, 0)).toBe(manifest.counts.keptRows);
    expect(Object.values(manifest.perWell).reduce((s, w) => s + w.rows, 0)).toBe(manifest.funnel.rows);
    expect(Object.values(manifest.counts.confidence).reduce((s, n) => s + n, 0)).toBe(manifest.counts.keptRows);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csv));
    expect(manifest.dataSha256).toBe(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''));
    // Las clases del CSV son las del manifest y cada fila tiene tantas celdas como columnas.
    const ids = new Set(manifest.classes.map((c) => String(c.id)));
    for (const l of lines.slice(1)) {
      const f = l.split(',');
      expect(f).toHaveLength(header.length);
      expect(ids.has(f[header.indexOf('LITHO')]!)).toBe(true);
    }
    expect(manifest.grPercentilesPerWell['A/1-1']!.p95).toBeGreaterThan(manifest.grPercentilesPerWell['A/1-1']!.p5);
  });
});

describe('lectura por streaming', () => {
  it('parte el CSV por pozo aunque los bloques de texto corten una línea, con CRLF', () => {
    const head = 'WELL;DEPTH_MD;X_LOC;CALI;BS;GR;RHOB;NPHI;PEF;DTC;RDEP;RMED;FORCE_2020_LITHOFACIES_LITHOLOGY;FORCE_2020_LITHOFACIES_CONFIDENCE';
    const text = [head, 'W1;100;0;8.6;8.5;60;2.4;0.2;;95;2;2;65000;1', 'W1;100.5;0;8.6;8.5;61;2.4;0.2;4;95;2;2;30000;2', 'W2;50;0;;;70;2.3;0.3;;90;1;1;65030;3'].join('\r\n') + '\r\n';
    const got: Well[] = [];
    const s = mod.createWellSplitter((w) => got.push(w));
    for (let i = 0; i < text.length; i += 17) s.push(text.slice(i, i + 17));
    s.end();
    expect(got.map((w) => [w.name, w.rows.length])).toEqual([['W1', 2], ['W2', 1]]);
    expect(got[0]!.rows[0]!.PEF).toBeNaN();
    expect(got[0]!.rows[1]!.code).toBe(30000);
    expect(got[1]!.rows[0]!.CALI).toBeNaN();
  });
});
