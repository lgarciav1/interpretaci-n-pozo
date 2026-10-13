#!/usr/bin/env node
/**
 * Análisis de comparabilidad FORCE 2020 <-> pozo del TP (fase 10a). No genera datos: imprime un informe JSON con los
 * números que cita docs/decisiones/0030-datos-force2020.md.
 *
 * Uso:  node scripts/ml/analizar-force2020.mjs <train.csv|train.zip> [datos/pozo_tp_perfiles.csv]
 *
 * Reutiliza la lectura y la limpieza de `preparar-force2020.mjs` (mismos filtros que el dataset preparado).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_CONFIG, VALID_RANGE, buildClassLookup, cleanWell, percentile, streamWells } from './preparar-force2020.mjs';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const sortedNums = (a) => Float64Array.from(a.filter(isNum)).sort();
const q = (a, p) => percentile(sortedNums(a), p);
const round = (x, d = 4) => (isNum(x) ? Number(x.toPrecision(d)) : x);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));

/** Distancia de Kolmogorov–Smirnov entre dos muestras. */
function ks(a, b) {
  const x = sortedNums(a);
  const y = sortedNums(b);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < x.length && j < y.length) {
    const v = Math.min(x[i], y[j]);
    while (i < x.length && x[i] <= v) i++;
    while (j < y.length && y[j] <= v) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return d;
}

function readTp(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const head = lines[0].split(',');
  const cols = Object.fromEntries(head.map((h) => [h, []]));
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    head.forEach((h, i) => cols[h].push(f[i] === '' || h === 'ZONA' ? NaN : Number(f[i])));
  }
  return cols;
}

const stats = (a) => ({ n: sortedNums(a).length, min: round(q(a, 0)), p1: round(q(a, 1)), p50: round(q(a, 50)), p99: round(q(a, 99)), max: round(q(a, 100)) });

async function main(argv) {
  const [trainFile, tpFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../datos/pozo_tp_perfiles.csv')] = argv;
  if (!trainFile) {
    console.error('Uso: node scripts/ml/analizar-force2020.mjs <train.csv|train.zip> [pozo_tp_perfiles.csv]');
    process.exit(2);
  }
  const cfg = DEFAULT_CONFIG;
  const lookup = buildClassLookup(cfg.groups);
  const canon = ['GR', 'RHOB', 'NPHI', 'PEF', 'DT', 'RT', 'RM'];
  const pool = Object.fromEntries(canon.map((c) => [c, []]));
  const perWell = {};
  const gr = { raw: { SS: [], SH: [] }, norm: { SS: [], SH: [] } };
  const aucRows = { SS: [], SH: [] };
  const medians = { raw: { SS: [], SH: [] }, norm: { SS: [], SH: [] } };
  const logRatio = [];
  const cellCount = new Map();
  const cell = (r, n) => `${Math.floor(r / 0.05)}_${Math.floor(n / 0.02)}`;
  let funnel = null;

  for await (const { name, rows } of streamWells(trainFile)) {
    const { kept, funnel: f, grValues } = cleanWell(rows, cfg, lookup);
    funnel ??= Object.fromEntries(Object.keys(f).map((k) => [k, 0]));
    for (const k of Object.keys(f)) funnel[k] += f[k];
    const withPef = kept.filter((r) => isNum(r.vals.PEF)).length;
    perWell[name] = { rows: f.rows, complete: f.kept, completeWithPef: withPef };
    for (const r of kept) {
      for (const c of canon) pool[c].push(r.vals[c]);
      logRatio.push(Math.log10(r.vals.RT / r.vals.RM));
      const k = cell(r.vals.RHOB, r.vals.NPHI);
      cellCount.set(k, (cellCount.get(k) ?? 0) + 1);
    }
    // Normalización del GR por pozo: (GR - p5) / (p95 - p5) con los percentiles de todas las muestras válidas del pozo.
    if (grValues.length > 500) {
      const sorted = Float64Array.from(grValues).sort();
      const p5 = percentile(sorted, 5);
      const p95 = percentile(sorted, 95);
      const bucket = { 30000: 'SS', 65000: 'SH' };
      const rawBy = { SS: [], SH: [] };
      const normBy = { SS: [], SH: [] };
      for (const r of kept) {
        const b = bucket[r.code];
        if (!b) continue;
        rawBy[b].push(r.vals.GR);
        normBy[b].push((r.vals.GR - p5) / (p95 - p5));
      }
      for (const b of ['SS', 'SH']) {
        if (rawBy[b].length >= 100) {
          medians.raw[b].push(q(rawBy[b], 50));
          medians.norm[b].push(q(normBy[b], 50));
        }
        rawBy[b].forEach((v, i) => {
          if (i % 20 === 0) aucRows[b].push([v, normBy[b][i]]);
        });
      }
    }
  }

  // Pozo del TP con el mismo control de rango físico.
  const tpRaw = readTp(tpFile);
  // RM del TP: AT30 (ver docs/decisiones/0030, la alternativa AT60 se evalúa con KS y con la relación RT/RM).
  const tpMap = { GR: 'GR', RHOB: 'ZDEN', NPHI: 'NPHI', PEF: 'PE', DT: 'DT', RT: 'AT90', RM: 'AT30' };
  const tp = {};
  for (const c of canon) tp[c] = tpRaw[tpMap[c]].map((v) => (isNum(v) && v >= VALID_RANGE[c][0] && v <= VALID_RANGE[c][1] ? v : NaN));
  const tpOutOfRange = Object.fromEntries(canon.map((c) => [c, tpRaw[tpMap[c]].filter((v) => isNum(v) && !(v >= VALID_RANGE[c][0] && v <= VALID_RANGE[c][1])).length]));

  const report = { embudo: funnel };
  report.percentilesFORCE = Object.fromEntries(canon.map((c) => [c, stats(pool[c])]));
  report.percentilesTP = Object.fromEntries(canon.map((c) => [c, stats(tp[c])]));
  report.percentilesTPResistividades = Object.fromEntries(['AT10', 'AT30', 'AT60', 'AT90'].map((c) => [c, stats(tpRaw[c])]));
  report.tpFueraDeRangoFisico = tpOutOfRange;

  // Cobertura del TP en el dominio de entrenamiento.
  const lims = Object.fromEntries(canon.map((c) => [c, [q(pool[c], 1), q(pool[c], 99), q(pool[c], 0), q(pool[c], 100)]]));
  report.cobertura = {};
  for (const c of canon) {
    const v = tp[c].filter(isNum);
    report.cobertura[c] = {
      enP1P99: round((v.filter((x) => x >= lims[c][0] && x <= lims[c][1]).length / v.length) * 100, 3),
      enMinMax: round((v.filter((x) => x >= lims[c][2] && x <= lims[c][3]).length / v.length) * 100, 3),
    };
  }
  // Percentil de FORCE en el que cae el p1/p50/p99 del TP (si el p50 del TP cae en una cola de FORCE, hay desplazamiento de dominio).
  report.rangoPercentilFORCE_deTP = {};
  for (const c of canon) {
    const sorted = sortedNums(pool[c]);
    const rank = (v) => {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
      return round((lo / sorted.length) * 100, 3);
    };
    report.rangoPercentilFORCE_deTP[c] = { p1: rank(q(tp[c], 1)), p50: rank(q(tp[c], 50)), p99: rank(q(tp[c], 99)) };
  }
  const nTp = tp.GR.length;
  for (const [label, curves] of [['sinPEF', ['GR', 'RHOB', 'NPHI', 'DT', 'RT', 'RM']], ['conPEF', canon]]) {
    let ok = 0;
    let total = 0;
    for (let k = 0; k < nTp; k++) {
      if (!curves.every((c) => isNum(tp[c][k]))) continue;
      total++;
      if (curves.every((c) => tp[c][k] >= lims[c][0] && tp[c][k] <= lims[c][1])) ok++;
    }
    report.cobertura[`cajaP1P99_${label}`] = { filasTPValidas: total, dentro: ok, porcentaje: round((ok / total) * 100, 3) };
  }
  let inCell = 0;
  let tot = 0;
  for (let k = 0; k < nTp; k++) {
    if (!isNum(tp.RHOB[k]) || !isNum(tp.NPHI[k])) continue;
    tot++;
    if ((cellCount.get(cell(tp.RHOB[k], tp.NPHI[k])) ?? 0) >= 50) inCell++;
  }
  report.cobertura.celdasRHOBNPHI_con50oMas = { porcentaje: round((inCell / tot) * 100, 3), celda: 'RHOB 0,05 g/cm3 x NPHI 0,02 v/v' };

  // Equivalencia de RMED: AT30 vs AT60.
  const lr = (a, b) => a.map((x, i) => (isNum(x) && isNum(b[i]) && x > 0 && b[i] > 0 ? Math.log10(x / b[i]) : NaN));
  const lg = (a) => a.map((x) => (x > 0 ? Math.log10(x) : NaN));
  report.resistividad = {
    log10_RDEP_sobre_RMED_FORCE: { p5: round(q(logRatio, 5)), p50: round(q(logRatio, 50)), p95: round(q(logRatio, 95)) },
    log10_AT90_sobre: Object.fromEntries(['AT10', 'AT30', 'AT60'].map((b) => { const r = lr(tpRaw.AT90, tpRaw[b]); return [b, { p5: round(q(r, 5)), p50: round(q(r, 50)), p95: round(q(r, 95)) }]; })),
    KS_log10_RMED_contra: Object.fromEntries(['AT10', 'AT30', 'AT60', 'AT90'].map((b) => [b, round(ks(lg(pool.RM), lg(tpRaw[b])))])),
    KS_log10_RDEP_contra: Object.fromEntries(['AT10', 'AT30', 'AT60', 'AT90'].map((b) => [b, round(ks(lg(pool.RT), lg(tpRaw[b])))])),
  };

  // Normalización del GR por pozo.
  const gap = (m) => mean(m.SH) - mean(m.SS);
  const within = (m) => Math.sqrt((sd(m.SS) ** 2 + sd(m.SH) ** 2) / 2);
  const auc = (idx) => {
    const a = aucRows.SS.map((r) => r[idx]).sort((x, y) => x - y);
    let s = 0;
    for (const r of aucRows.SH) {
      let lo = 0;
      let hi = a.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < r[idx]) lo = m + 1; else hi = m; }
      s += lo / a.length;
    }
    return s / aucRows.SH.length;
  };
  report.normalizacionGR = {
    definicion: '(GR - p5) / (p95 - p5) por pozo, percentiles sobre todas las muestras de GR válidas y sin derrumbe del pozo',
    pozosConArenisca_Arcilita: [medians.raw.SS.length, medians.raw.SH.length],
    crudo: { medianaArenisca: round(mean(medians.raw.SS)), medianaArcilita: round(mean(medians.raw.SH)), sdEntrePozos: [round(sd(medians.raw.SS)), round(sd(medians.raw.SH))], brechaSobreSd: round(gap(medians.raw) / within(medians.raw)), AUC: round(auc(0)) },
    normalizado: { medianaArenisca: round(mean(medians.norm.SS)), medianaArcilita: round(mean(medians.norm.SH)), sdEntrePozos: [round(sd(medians.norm.SS)), round(sd(medians.norm.SH))], brechaSobreSd: round(gap(medians.norm) / within(medians.norm)), AUC: round(auc(1)) },
  };

  report.porPozo = perWell;
  report.totales = {
    pozos: Object.keys(perWell).length,
    completasSinPEF: funnel.kept,
    completasConPEF: Object.values(perWell).reduce((s, w) => s + w.completeWithPef, 0),
    pozosConAlMenos500SinPEF: Object.values(perWell).filter((w) => w.complete >= 500).length,
    pozosConAlMenos500ConPEF: Object.values(perWell).filter((w) => w.completeWithPef >= 500).length,
    pozosSinPEFcompleto: Object.values(perWell).filter((w) => w.completeWithPef === 0).length,
  };
  console.log(JSON.stringify(report, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
