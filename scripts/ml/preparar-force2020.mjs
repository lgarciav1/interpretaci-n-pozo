#!/usr/bin/env node
/**
 * Preparación del dataset FORCE 2020 para el clasificador de litologías (fase 10).
 *
 * Uso:  node scripts/ml/preparar-force2020.mjs <train.csv | train.zip> <directorio-de-salida>
 *
 * Lee el CSV crudo por streaming (un pozo en memoria por vez), mapea mnemónicos a los nombres canónicos del repo,
 * descarta filas incompletas, fuera de rango físico o con derrumbe, agrupa las litologías, submuestrea de forma
 * determinista y escribe `force2020.csv.gz` + `manifest.json`. Ver `datos/force2020-preparado/LEEME.md` y
 * `docs/decisiones/0030-datos-force2020.md`.
 *
 * Las funciones puras se exportan para los tests; el programa principal solo corre si el archivo se ejecuta directo.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SCRIPT_VERSION = '1.0.0';
export const SEED = 2020;

// ---------------------------------------------------------------------------------------------------------------
// Configuración editable
// ---------------------------------------------------------------------------------------------------------------

/**
 * Mnemónico FORCE -> nombre canónico del repo (roles de src/core/roles.ts, tabla de src/io/mnemonics.ts).
 * En el pozo del TP: GR=GR, ZDEN->RHOB, PE->PEF, DT->DT, AT90->RT, AT30->RM (alternativa AT60), NPHI=NPHI.
 */
export const CURVE_MAP = {
  GR: 'GR',
  RHOB: 'RHOB',
  NPHI: 'NPHI',
  PEF: 'PEF',
  DTC: 'DT',
  RDEP: 'RT',
  RMED: 'RM',
};
/** Curvas que una fila debe tener para conservarse (canónicas). */
export const REQUIRED_CURVES = ['GR', 'RHOB', 'NPHI', 'DT', 'RT', 'RM'];
/** Curvas que se conservan si están, pero no se exigen (vacías si falta o está fuera de rango). */
export const OPTIONAL_CURVES = ['PEF'];
/** Orden de las columnas de datos de salida. */
export const OUTPUT_CURVES = ['GR', 'RHOB', 'NPHI', 'PEF', 'DT', 'RT', 'RM'];

/** Rango físico plausible por curva canónica [mín, máx] (se descarta el valor fuera de él). */
export const VALID_RANGE = {
  GR: [0, 500],
  RHOB: [1.0, 3.2],
  NPHI: [-0.15, 1.0],
  PEF: [0.5, 100],
  DT: [30, 300],
  RT: [0.01, 10000],
  RM: [0.01, 10000],
};

/** Decimales con que se escribe cada curva (RT y RM usan 4 cifras significativas). */
export const DECIMALS = { DEPTH_MD: 3, GR: 2, RHOB: 3, NPHI: 4, PEF: 2, DT: 2 };
export const SIGNIFICANT = { RT: 4, RM: 4 };

/** Criterio de derrumbe con el caliper (pulgadas). */
export const CALIPER = {
  /** CALI - diámetro de trépano mayor que esto = derrumbe. */
  washoutMargin: 2,
  /** CALI - diámetro de trépano menor que -esto = lectura inválida (herramienta mal calibrada o atascada). */
  undergaugeMargin: 2,
  /** Sin BS en todo el pozo: el calibre de referencia es el percentil `blockPercentile` del CALI en bloques de esta cantidad de muestras. */
  blockSize: 500,
  blockPercentile: 10,
};

/** Submuestreo: las clases con más filas que `capPerClass` se adelgazan con un paso fijo en profundidad. */
export const SAMPLING = { capPerClass: 60000 };

/**
 * Tabla de litologías del concurso (código -> nombre), verificada con el diccionario del notebook
 * `lithology_competition/code/DapoA/litho_pred-final.ipynb` (rama force2020) y con los recuentos del train.csv.
 */
export const LITHOLOGY_CODES = [
  { code: 30000, name: 'Sandstone', es: 'Arenisca' },
  { code: 65030, name: 'Sandstone/Shale', es: 'Arenisca/Arcilita' },
  { code: 65000, name: 'Shale', es: 'Arcilita' },
  { code: 80000, name: 'Marl', es: 'Marga' },
  { code: 74000, name: 'Dolomite', es: 'Dolomía' },
  { code: 70000, name: 'Limestone', es: 'Caliza' },
  { code: 70032, name: 'Chalk', es: 'Creta' },
  { code: 88000, name: 'Halite', es: 'Halita' },
  { code: 86000, name: 'Anhydrite', es: 'Anhidrita' },
  { code: 99000, name: 'Tuff', es: 'Toba' },
  { code: 90000, name: 'Coal', es: 'Carbón' },
  { code: 93000, name: 'Basement', es: 'Basamento' },
];

/**
 * AGRUPACIÓN EN CLASES (tabla editable). `id` es el valor que se escribe en la columna LITHO; el orden define el
 * índice. Cambiar `codes` y volver a correr el guion basta para regenerar el dataset con otra agrupación.
 */
export const CLASS_GROUPS = [
  { id: 0, name: 'SANDSTONE', es: 'Arenisca', codes: [30000] },
  { id: 1, name: 'SANDSTONE_SHALE', es: 'Arenisca/Arcilita', codes: [65030] },
  { id: 2, name: 'SHALE', es: 'Arcilita', codes: [65000] },
  { id: 3, name: 'MARL', es: 'Marga', codes: [80000] },
  { id: 4, name: 'CARBONATE', es: 'Carbonato (caliza, creta, dolomía)', codes: [70000, 70032, 74000] },
  { id: 5, name: 'EVAPORITE', es: 'Evaporita (halita, anhidrita)', codes: [88000, 86000] },
  { id: 6, name: 'COAL', es: 'Carbón', codes: [90000] },
  { id: 7, name: 'TUFF', es: 'Toba', codes: [99000] },
  { id: 8, name: 'BASEMENT', es: 'Basamento', codes: [93000] },
];

export const DEFAULT_CONFIG = {
  curveMap: CURVE_MAP,
  required: REQUIRED_CURVES,
  optional: OPTIONAL_CURVES,
  output: OUTPUT_CURVES,
  validRange: VALID_RANGE,
  caliper: CALIPER,
  sampling: SAMPLING,
  groups: CLASS_GROUPS,
  seed: SEED,
};

// ---------------------------------------------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------------------------------------------

/** Código de litología -> id de clase (o undefined si el código no está en la tabla). */
export function buildClassLookup(groups = CLASS_GROUPS) {
  const m = new Map();
  for (const g of groups) for (const c of g.codes) {
    if (m.has(c)) throw new Error(`Código de litología repetido en la agrupación: ${c}`);
    m.set(c, g.id);
  }
  return m;
}

/** Hash de 32 bits (FNV-1a) de un texto; base de los desplazamientos deterministas del submuestreo. */
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Valor numérico de una celda o NaN si está vacía o no es número. */
export function toNumber(text) {
  if (text === undefined || text === '') return NaN;
  const v = Number(text);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * Marca por muestra: 0 = sin observación, 1 = bien, 2 = derrumbe (CALI muy por encima del trépano), 3 = lectura
 * inválida (CALI muy por debajo). El calibre de referencia es el BS de la fila; si falta, el BS válido más cercano
 * del mismo pozo; si el pozo no tiene BS, el percentil bajo del CALI en bloques de muestras.
 * `cali` y `bs` son arreglos del pozo (NaN = sin dato). Una muestra sin CALI queda en 0 y NO se descarta.
 */
export function caliperFlags(cali, bs, cfg = CALIPER) {
  const n = cali.length;
  const flags = new Uint8Array(n);
  const bsIdx = [];
  for (let i = 0; i < n; i++) if (isNum(bs[i])) bsIdx.push(i);
  for (let i = 0; i < n; i++) {
    const c = cali[i];
    if (!isNum(c)) continue;
    let gauge;
    if (isNum(bs[i])) gauge = bs[i];
    else if (bsIdx.length > 0) {
      let lo = 0;
      let hi = bsIdx.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bsIdx[mid] < i) lo = mid + 1;
        else hi = mid;
      }
      const after = bsIdx[lo];
      const before = bsIdx[Math.max(0, lo - 1)];
      gauge = bs[Math.abs(after - i) < Math.abs(before - i) ? after : before];
    } else {
      const b0 = Math.floor(i / cfg.blockSize) * cfg.blockSize;
      const block = [];
      for (let j = b0; j < Math.min(n, b0 + cfg.blockSize); j++) if (isNum(cali[j])) block.push(cali[j]);
      block.sort((a, b) => a - b);
      gauge = block[Math.floor((cfg.blockPercentile / 100) * (block.length - 1))];
    }
    const d = c - gauge;
    flags[i] = d > cfg.washoutMargin ? 2 : d < -cfg.undergaugeMargin ? 3 : 1;
  }
  return flags;
}

/**
 * Procesa un pozo (filas con claves FORCE: DEPTH_MD, CALI, BS, GR, ..., code, conf) y devuelve las filas
 * conservadas (arreglos de números) con el embudo de descartes. Orden del embudo: falta una curva exigida,
 * fuera de rango físico, derrumbe/CALI inválido, litología fuera de la tabla.
 */
export function cleanWell(rows, cfg = DEFAULT_CONFIG, classLookup = buildClassLookup(cfg.groups)) {
  const inv = Object.fromEntries(Object.entries(cfg.curveMap).map(([force, canon]) => [canon, force]));
  const flags = caliperFlags(rows.map((r) => r.CALI), rows.map((r) => r.BS), cfg.caliper);
  const funnel = { rows: rows.length, missingRequired: 0, outOfRange: 0, washout: 0, invalidCaliper: 0, unknownLithology: 0, kept: 0, optionalDropped: 0 };
  const kept = [];
  const grValues = [];
  const inRange = (canon, v) => v >= cfg.validRange[canon][0] && v <= cfg.validRange[canon][1];
  rows.forEach((r, i) => {
    // GR válido en pozo con CALI aceptable: base de los percentiles por pozo (normalización opcional del GR).
    if (isNum(r.GR) && inRange('GR', r.GR) && flags[i] !== 2 && flags[i] !== 3) grValues.push(r.GR);
    const vals = {};
    for (const canon of cfg.required) vals[canon] = r[inv[canon]];
    if (!cfg.required.every((c) => isNum(vals[c]))) return void funnel.missingRequired++;
    if (!cfg.required.every((c) => inRange(c, vals[c]))) return void funnel.outOfRange++;
    if (flags[i] === 2) return void funnel.washout++;
    if (flags[i] === 3) return void funnel.invalidCaliper++;
    const cls = classLookup.get(r.code);
    if (cls === undefined) return void funnel.unknownLithology++;
    for (const canon of cfg.optional) {
      const v = r[inv[canon]];
      if (isNum(v) && inRange(canon, v)) vals[canon] = v;
      else {
        if (isNum(v)) funnel.optionalDropped++;
        vals[canon] = NaN;
      }
    }
    funnel.kept++;
    kept.push({ depth: r.DEPTH_MD, vals, cls, code: r.code, conf: r.conf });
  });
  return { kept, funnel, grValues };
}

/** Percentil (0–100) por interpolación del vecino inferior sobre un arreglo ordenado. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  return sorted[Math.floor((p / 100) * (sorted.length - 1))];
}

/** Paso de adelgazamiento de una clase: 1 si cabe en el tope, ceil(n / tope) si no. */
export function strideFor(count, cap) {
  return count <= cap ? 1 : Math.ceil(count / cap);
}

/**
 * Decide qué filas de un pozo se conservan. Dentro del pozo, cada clase con paso k conserva 1 de cada k de sus filas
 * (por posición en la secuencia del pozo), con un desplazamiento fijado por hash(semilla, pozo, clase). Las clases
 * raras (paso 1) se conservan enteras. Determinista y sin estado global.
 */
export function selectRows(wellName, classIds, strides, seed = SEED) {
  const counters = new Map();
  const keep = new Array(classIds.length);
  for (let i = 0; i < classIds.length; i++) {
    const cls = classIds[i];
    const k = strides.get(cls) ?? 1;
    const pos = counters.get(cls) ?? 0;
    counters.set(cls, pos + 1);
    keep[i] = k === 1 || (pos + (hash32(`${seed}|${wellName}|${cls}`) % k)) % k === 0;
  }
  return keep;
}

function fmt(value, decimals, significant) {
  if (!isNum(value)) return '';
  const v = significant ? Number(value.toPrecision(significant)) : Number(value.toFixed(decimals));
  return String(v);
}

/** Línea CSV de una fila conservada. */
export function formatRow(well, row, output = OUTPUT_CURVES) {
  const cells = [well, fmt(row.depth, DECIMALS.DEPTH_MD)];
  for (const c of output) cells.push(fmt(row.vals[c], DECIMALS[c], SIGNIFICANT[c]));
  cells.push(String(row.cls), fmt(row.conf, 0)); // CONFIDENCE vacía si el crudo no la trae
  return cells.join(',');
}

export const csvHeader = (output = OUTPUT_CURVES) => ['WELL', 'DEPTH_MD', ...output, 'LITHO', 'CONFIDENCE'].join(',');

/**
 * Núcleo del proceso, independiente de la fuente. `openWells` devuelve un iterable (síncrono o asíncrono) de
 * `{ name, rows }` y se llama dos veces (pasada 1: recuentos; pasada 2: selección). Devuelve el CSV (texto),
 * el manifest y los recuentos.
 */
export async function prepare(openWells, userConfig = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...userConfig };
  const lookup = buildClassLookup(cfg.groups);

  // Pasada 1: embudo, recuentos por clase y percentiles de GR por pozo.
  const funnelTotal = { rows: 0, missingRequired: 0, outOfRange: 0, washout: 0, invalidCaliper: 0, unknownLithology: 0, kept: 0, optionalDropped: 0 };
  const perWell = {};
  const poolCount = new Map(cfg.groups.map((g) => [g.id, 0]));
  const rawCountByCode = {};
  const grStats = {};
  for await (const { name, rows } of openWells()) {
    for (const r of rows) rawCountByCode[r.code] = (rawCountByCode[r.code] ?? 0) + 1;
    const { kept, funnel, grValues } = cleanWell(rows, cfg, lookup);
    for (const k of Object.keys(funnelTotal)) funnelTotal[k] += funnel[k];
    perWell[name] = { rows: funnel.rows, complete: funnel.kept, kept: 0 };
    for (const r of kept) poolCount.set(r.cls, poolCount.get(r.cls) + 1);
    if (grValues.length > 0) {
      const sorted = grValues.slice().sort((a, b) => a - b);
      grStats[name] = { n: sorted.length, p5: percentile(sorted, 5), p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
    }
  }
  const strides = new Map([...poolCount].map(([id, n]) => [id, strideFor(n, cfg.sampling.capPerClass)]));

  // Pasada 2: selección y escritura.
  const lines = [csvHeader(cfg.output)];
  const outCount = new Map(cfg.groups.map((g) => [g.id, 0]));
  const confCount = { 1: 0, 2: 0, 3: 0, sinDato: 0 };
  const values = Object.fromEntries(cfg.output.map((c) => [c, []]));
  for await (const { name, rows } of openWells()) {
    const { kept } = cleanWell(rows, cfg, lookup);
    const keep = selectRows(name, kept.map((r) => r.cls), strides, cfg.seed);
    kept.forEach((r, i) => {
      if (!keep[i]) return;
      lines.push(formatRow(name, r, cfg.output));
      outCount.set(r.cls, outCount.get(r.cls) + 1);
      const confKey = isNum(r.conf) ? r.conf : 'sinDato';
      confCount[confKey] = (confCount[confKey] ?? 0) + 1;
      perWell[name].kept++;
      for (const c of cfg.output) if (isNum(r.vals[c])) values[c].push(r.vals[c]);
    });
  }
  const csv = lines.join('\n') + '\n';
  const curveStats = {};
  for (const c of cfg.output) {
    const sorted = Float64Array.from(values[c]).sort();
    curveStats[c] = { n: sorted.length, min: sorted[0], p1: percentile(sorted, 1), p50: percentile(sorted, 50), p99: percentile(sorted, 99), max: sorted[sorted.length - 1] };
  }
  const classTable = cfg.groups.map((g) => ({
    id: g.id,
    name: g.name,
    es: g.es,
    codes: g.codes,
    stride: strides.get(g.id),
    completeRows: poolCount.get(g.id),
    keptRows: outCount.get(g.id),
    wellsWithClass: 0,
  }));
  const manifest = {
    version: SCRIPT_VERSION,
    seed: cfg.seed,
    dataFile: 'force2020.csv.gz',
    format: 'CSV separado por comas, gzip, una fila de encabezado; celda vacía = sin dato',
    columns: ['WELL', 'DEPTH_MD', ...cfg.output, 'LITHO', 'CONFIDENCE'],
    curveMap: { FORCE_to_canonical: cfg.curveMap, TP_to_canonical: { GR: 'GR', ZDEN: 'RHOB', PE: 'PEF', DT: 'DT', NPHI: 'NPHI', AT90: 'RT', AT30: 'RM' }, TP_alternative_for_RM: 'AT60' },
    units: { DEPTH_MD: 'm', GR: 'gAPI', RHOB: 'g/cm3', NPHI: 'v/v', PEF: 'b/e', DT: 'us/ft', RT: 'ohm.m', RM: 'ohm.m' },
    requiredCurves: cfg.required,
    optionalCurves: cfg.optional,
    validRange: cfg.validRange,
    caliper: cfg.caliper,
    transformations: [
      'Sin transformar: los valores son los crudos de FORCE (resistividades en escala lineal, GR sin normalizar).',
      'Redondeo: ' + cfg.output.map((c) => (SIGNIFICANT[c] ? `${c} ${SIGNIFICANT[c]} cifras significativas` : `${c} ${DECIMALS[c]} decimales`)).join(', ') + `; DEPTH_MD ${DECIMALS.DEPTH_MD} decimales.`,
      'Valores fuera de rango físico en curvas exigidas: se descarta la fila; en curvas opcionales: se deja la celda vacía.',
      'Filas con derrumbe (CALI > calibre + ' + cfg.caliper.washoutMargin + ' in) o CALI inválido (< calibre - ' + cfg.caliper.undergaugeMargin + ' in): se descartan. Filas sin CALI: se conservan.',
    ],
    sampling: {
      method: 'Por clase, si las filas completas superan el tope se conserva 1 de cada k (k = ceil(n / tope)) siguiendo la secuencia de profundidad de cada pozo, con desplazamiento fijado por hash(semilla, pozo, clase). Las clases por debajo del tope se conservan enteras.',
      capPerClass: cfg.sampling.capPerClass,
    },
    classes: classTable,
    rawCountByCode,
    funnel: funnelTotal,
    counts: {
      wells: Object.keys(perWell).length,
      completeRows: funnelTotal.kept,
      keptRows: lines.length - 1,
      confidence: confCount,
    },
    perWell,
    curveStatsOutput: curveStats,
    grPercentilesPerWell: grStats,
    dataSha256: crypto.createHash('sha256').update(csv).digest('hex'),
  };
  // Pozos que aportan filas a cada clase en la salida (para saber si la validación por pozos es posible).
  const wellsPerClass = new Map(cfg.groups.map((g) => [g.id, new Set()]));
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    wellsPerClass.get(Number(f[f.length - 2])).add(f[0]);
  }
  for (const c of manifest.classes) c.wellsWithClass = wellsPerClass.get(c.id).size;
  return { csv, manifest };
}

// ---------------------------------------------------------------------------------------------------------------
// Lectura por streaming (CSV o ZIP)
// ---------------------------------------------------------------------------------------------------------------

const FORCE_COLUMNS = ['WELL', 'DEPTH_MD', 'CALI', 'BS', 'GR', 'RHOB', 'NPHI', 'PEF', 'DTC', 'RDEP', 'RMED', 'FORCE_2020_LITHOFACIES_LITHOLOGY', 'FORCE_2020_LITHOFACIES_CONFIDENCE'];

/** Acumula líneas de texto y emite un pozo cada vez que cambia la columna WELL. */
export function createWellSplitter(onWell, separator = ';') {
  let header = null;
  let index = null;
  let current = null;
  let tail = '';
  const handleLine = (line) => {
    if (line === '') return;
    const f = line.split(separator);
    if (header === null) {
      header = f.map((x) => x.trim());
      index = {};
      for (const c of FORCE_COLUMNS) {
        const i = header.indexOf(c);
        if (i < 0) throw new Error(`Falta la columna ${c} en el CSV de FORCE`);
        index[c] = i;
      }
      return;
    }
    const name = f[index.WELL];
    if (current === null || current.name !== name) {
      if (current !== null) onWell(current);
      current = { name, rows: [] };
    }
    current.rows.push({
      DEPTH_MD: toNumber(f[index.DEPTH_MD]),
      CALI: toNumber(f[index.CALI]),
      BS: toNumber(f[index.BS]),
      GR: toNumber(f[index.GR]),
      RHOB: toNumber(f[index.RHOB]),
      NPHI: toNumber(f[index.NPHI]),
      PEF: toNumber(f[index.PEF]),
      DTC: toNumber(f[index.DTC]),
      RDEP: toNumber(f[index.RDEP]),
      RMED: toNumber(f[index.RMED]),
      code: toNumber(f[index.FORCE_2020_LITHOFACIES_LITHOLOGY]),
      conf: toNumber(f[index.FORCE_2020_LITHOFACIES_CONFIDENCE]),
    });
  };
  return {
    push(text) {
      const parts = (tail + text).split('\n');
      tail = parts.pop();
      for (const p of parts) handleLine(p.endsWith('\r') ? p.slice(0, -1) : p);
    },
    end() {
      if (tail !== '') handleLine(tail.endsWith('\r') ? tail.slice(0, -1) : tail);
      tail = '';
      if (current !== null) onWell(current);
      current = null;
    },
  };
}

/** Itera los pozos de un train.csv o un train.zip (que contenga un único CSV) sin cargar el archivo entero. */
export async function* streamWells(file) {
  const queue = [];
  const splitter = createWellSplitter((w) => queue.push(w));
  const decoder = new TextDecoder('utf-8');
  if (file.toLowerCase().endsWith('.zip')) {
    const { Unzip, UnzipInflate } = await import('fflate');
    let started = false;
    const unzip = new Unzip((entry) => {
      if (started || !entry.name.toLowerCase().endsWith('.csv')) return;
      started = true;
      entry.ondata = (err, chunk, final) => {
        if (err) throw err;
        splitter.push(decoder.decode(chunk, { stream: !final }));
        if (final) splitter.end();
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
      unzip.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length));
      while (queue.length) yield queue.shift();
    }
    unzip.push(new Uint8Array(0), true);
    if (!started) throw new Error('El .zip no contiene ningún .csv');
  } else {
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
      splitter.push(decoder.decode(chunk, { stream: true }));
      while (queue.length) yield queue.shift();
    }
    splitter.end();
  }
  while (queue.length) yield queue.shift();
}

// ---------------------------------------------------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------------------------------------------------

async function main(argv) {
  if (argv.length < 2) {
    console.error('Uso: node scripts/ml/preparar-force2020.mjs <train.csv|train.zip> <directorio-de-salida>');
    process.exit(2);
  }
  const [input, outDir] = argv;
  const { csv, manifest } = await prepare(() => streamWells(input));
  fs.mkdirSync(outDir, { recursive: true });
  const gz = zlib.gzipSync(Buffer.from(csv, 'utf8'), { level: 9 });
  fs.writeFileSync(path.join(outDir, manifest.dataFile), gz);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`Filas crudas: ${manifest.funnel.rows}; completas y limpias: ${manifest.counts.completeRows}; conservadas: ${manifest.counts.keptRows}`);
  console.log('Clase               completas  conservadas  paso  pozos');
  for (const c of manifest.classes) console.log(`${c.name.padEnd(18)} ${String(c.completeRows).padStart(10)} ${String(c.keptRows).padStart(12)} ${String(c.stride).padStart(5)} ${String(c.wellsWithClass).padStart(6)}`);
  console.log(`Escrito ${path.join(outDir, manifest.dataFile)} (${gz.length} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
