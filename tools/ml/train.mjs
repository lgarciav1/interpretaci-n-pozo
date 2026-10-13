// Entrenamiento OFFLINE del random forest de litología con FORCE 2020.
//
// Uso (Node ≥ 22.18, sin dependencias nuevas; importa los .ts de src/ml directamente):
//   node tools/ml/train.mjs --csv /ruta/a/train.csv [opciones]
//
// El CSV (train.csv, separador «;») se pasa por ruta: NO está en el repo. El entrenamiento no corre en `npm test`
// ni en `npm run build`. Ver src/ml/README.md y docs/decisiones/0030-modelos-de-facies.md.
//
// Modos:
//   --final            entrena los dos modelos finales y escribe src/ml/model/lithologyModels.ts
//   --cv blocks|lowo|random|all   validación cruzada (tramos de profundidad por pozo / leave-one-well-out / al azar)
//   --report <ruta>    escribe el reporte de métricas en markdown (por defecto docs/decisiones/0030-modelos-de-facies-metricas.md)
// Hiperparámetros: --trees --depth --min-leaf --sample --bins --mtry --leaf-top --class-power --conf-weights a,b,c --seed
// Validación: --folds 5 --block 200 --gap 30 --lowo-group 1 --cv-trees --cv-sample
// Variantes: --variants withPe,noPe (por defecto ambas)
// Evaluación externa: --eval-csv <hidden_test.csv> puntúa los modelos finales con la métrica oficial de la competencia
//   (los 10 pozos del test oculto de FORCE 2020, que no están en train.csv).
import { createReadStream, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const ml = p => import(resolve(root, 'src/ml', p));
const { buildFeatureMatrix } = await ml('features.ts');
const { LITHOLOGY_CLASSES, lithologyIndexOfCode } = await ml('lithology.ts');
const { trainRandomForest, predictForest, argmaxRows, leafCount } = await ml('forest.ts');
const { depthBlockFolds, leaveOneWellOutFolds, crossValidate, forestFitPredict, evaluatePredictions } = await ml('validation.ts');
const { encodeModelText, decodeModelText, serializeModel } = await ml('serialize.ts');
const { permutationImportance } = await ml('importance.ts');
const { mulberry32, shuffleInPlace } = await ml('rng.ts');

// ---------- argumentos ----------
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = name => args.includes(`--${name}`);
const csvPath = opt('csv');
if (!csvPath) {
  console.error('Falta --csv <ruta a train.csv>');
  process.exit(1);
}
const hp = {
  nTrees: Number(opt('trees', 48)),
  maxDepth: Number(opt('depth', 16)),
  minSamplesLeaf: Number(opt('min-leaf', 60)),
  sampleSize: Number(opt('sample', 120000)),
  maxBins: Number(opt('bins', 64)),
  mtry: opt('mtry') ? Number(opt('mtry')) : undefined,
  leafTop: Number(opt('leaf-top', 6)),
  seed: Number(opt('seed', 20201)),
};
const classPower = Number(opt('class-power', 0.25));
const confWeights = opt('conf-weights', '1,0.5,0.25').split(',').map(Number);
const variantsWanted = opt('variants', 'withPe,noPe').split(',');
const FEATURE_SETS = {
  withPe: (opt('features-with-pe', 'GR,RHOB,NPHI,PEF,DTC,LOG_RDEP')).split(','),
  noPe: (opt('features-no-pe', 'GR,RHOB,NPHI,DTC,LOG_RDEP')).split(','),
};
const cvMode = opt('cv', '');
const evalCsv = opt('eval-csv');
// Por defecto la validación usa la MISMA configuración que el modelo final (si no, la métrica no describe al modelo).
const cvHp = { ...hp, nTrees: Number(opt('cv-trees', hp.nTrees)), sampleSize: Number(opt('cv-sample', hp.sampleSize)) };
const folds = Number(opt('folds', 5));
const blockLength = Number(opt('block', 200));
const gap = Number(opt('gap', 30));
const lowoGroup = Number(opt('lowo-group', 1));
const reportPath = resolve(opt('report', resolve(root, 'docs/decisiones/0030-modelos-de-facies-metricas.md')));
const outDir = resolve(opt('out-dir', resolve(root, 'src/ml/model')));

// ---------- lectura del CSV ----------
const t0 = Date.now();
const K = LITHOLOGY_CLASSES.length;
const wantCols = ['WELL', 'DEPTH_MD', 'CALI', 'RDEP', 'RHOB', 'GR', 'NPHI', 'PEF', 'DTC', 'FORCE_2020_LITHOFACIES_LITHOLOGY', 'FORCE_2020_LITHOFACIES_CONFIDENCE'];

/** Lee un CSV de FORCE 2020 (separador «;») y devuelve las columnas que usa el modelo. */
async function loadCsv(path) {
  const size = statSync(path).size;
  const cols = {};
  const wellNames = [];
  const wellIndex = new Map();
  const rows = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (!header) {
      header = line.split(';');
      wantCols.forEach(c => {
        const i = header.indexOf(c);
        if (i < 0) throw new Error(`Falta la columna ${c}`);
        cols[c] = i;
      });
      continue;
    }
    if (!line) continue;
    const f = line.split(';');
    const well = f[cols.WELL];
    let wi = wellIndex.get(well);
    if (wi === undefined) {
      wi = wellNames.length;
      wellIndex.set(well, wi);
      wellNames.push(well);
    }
    const num = c => {
      const s = f[cols[c]];
      return s === '' || s === undefined ? NaN : Number(s);
    };
    rows.push([wi, num('DEPTH_MD'), num('CALI'), num('RDEP'), num('RHOB'), num('GR'), num('NPHI'), num('PEF'), num('DTC'), num('FORCE_2020_LITHOFACIES_LITHOLOGY'), num('FORCE_2020_LITHOFACIES_CONFIDENCE')]);
  }
  const n = rows.length;
  const wellIds = new Int32Array(n);
  const depth = new Float64Array(n);
  const raw = { CALI: new Float64Array(n), RDEP: new Float64Array(n), RHOB: new Float64Array(n), GR: new Float64Array(n), NPHI: new Float64Array(n), PEF: new Float64Array(n), DTC: new Float64Array(n) };
  const y = new Int16Array(n);
  const conf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    wellIds[i] = r[0];
    depth[i] = r[1];
    raw.CALI[i] = r[2];
    raw.RDEP[i] = r[3];
    raw.RHOB[i] = r[4];
    raw.GR[i] = r[5];
    raw.NPHI[i] = r[6];
    raw.PEF[i] = r[7];
    raw.DTC[i] = r[8];
    y[i] = lithologyIndexOfCode(r[9]);
    conf[i] = Number.isFinite(r[10]) ? r[10] : 1;
  }
  if (y.some(v => v < 0)) throw new Error('Hay códigos de litología desconocidos en el CSV.');
  console.log(`CSV ${path}: ${(size / 1e6).toFixed(0)} MB, ${n} filas, ${wellNames.length} pozos, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { n, wellIds, depth, raw, y, conf, wellNames };
}
const { n, wellIds, depth, raw, y, conf, wellNames } = await loadCsv(csvPath);

// Pesos de muestreo: peso de confianza × (frecuencia de la clase mayoritaria / frecuencia de la clase)^classPower.
// Las frecuencias se cuentan SOLO sobre las filas de entrenamiento (en la validación, las del fold: sin fuga).
function sampleWeights(rows) {
  const counts = new Float64Array(K);
  const list = rows ?? Int32Array.from({ length: n }, (_, i) => i);
  for (let q = 0; q < list.length; q++) counts[y[list[q]]]++;
  const maxC = Math.max(...counts);
  const cw = Array.from(counts, c => (c > 0 ? Math.pow(maxC / c, classPower) : 0));
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = (confWeights[Math.min(2, Math.max(0, conf[i] - 1))] ?? 1) * cw[y[i]];
  return { w, counts };
}
const classCounts = sampleWeights(null).counts;

const baseMeta = {
  source: 'FORCE 2020 lithofacies competition, train.csv (Zenodo 10.5281/zenodo.4351156)',
  nRows: n,
  nWells: wellNames.length,
  classPower,
  confWeights,
  classCounts: Array.from(classCounts),
};

function matrixFor(featureNames) {
  return buildFeatureMatrix(raw, featureNames, { nphiUnit: 'fraction' });
}
const dataFor = (fm, extra = {}) => ({ X: fm.X, n: fm.n, d: fm.d, featureNames: fm.featureNames, y, classCodes: LITHOLOGY_CLASSES.map(c => c.code), rowWeight: sampleWeights(extra.rows ?? null).w, ...extra });

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : 'NaN');
const reportLines = [];
const say = s => {
  console.log(s);
  reportLines.push(s);
};

// ---------- validación cruzada ----------
async function runCv(kind, variant) {
  const fm = matrixFor(FEATURE_SETS[variant]);
  const data = dataFor(fm);
  let foldList;
  if (kind === 'blocks') foldList = depthBlockFolds({ wellIds, depth, nFolds: folds, blockLength, gap, seed: hp.seed });
  else if (kind === 'lowo') foldList = leaveOneWellOutFolds(wellIds, { wellsPerFold: lowoGroup, labels: new Map(wellNames.map((w, i) => [i, w])) });
  else {
    const order = Int32Array.from({ length: n }, (_, i) => i);
    shuffleInPlace(order, mulberry32(7));
    foldList = Array.from({ length: folds }, (_, f) => {
      const test = order.filter((_, q) => q % folds === f).sort();
      const inTest = new Uint8Array(n);
      test.forEach(i => (inTest[i] = 1));
      return { test, train: Int32Array.from({ length: n - test.length }, (_, i) => i).filter(i => !inTest[i]), label: `azar ${f + 1}` };
    });
  }
  const predAll = new Int16Array(n).fill(-1);
  // Cada fold entrena con pesos de clase calculados solo con sus filas de entrenamiento.
  const fit = fold => forestFitPredict({ ...data, rowWeight: sampleWeights(fold.train).w }, cvHp)(fold);
  const tStart = Date.now();
  const res = crossValidate({
    folds: foldList,
    truth: y,
    nClasses: K,
    fitPredict: fold => {
      const p = fit(fold);
      for (let i = 0; i < p.length; i++) predAll[fold.test[i]] = p[i];
      return p;
    },
    onFold: (r, fi) => {
      if (kind !== 'lowo' || fi % 10 === 0) console.log(`  [${kind}/${variant}] ${r.label}: acc ${fmt(r.accuracy)} F1 ${fmt(r.f1Macro)} pen ${fmt(r.penalty)} (${((Date.now() - tStart) / 1000).toFixed(0)} s)`);
    },
  });
  const high = [];
  const hp1 = [];
  for (let i = 0; i < n; i++) if (predAll[i] >= 0 && conf[i] === 1) (high.push(y[i]), hp1.push(predAll[i]));
  const mHigh = evaluatePredictions(high, hp1, K);
  return { kind, variant, res, mHigh, seconds: (Date.now() - tStart) / 1000, nFolds: foldList.length };
}

function cvSection(r) {
  const p = r.res.pooled;
  say(`\n#### ${r.kind} · ${r.variant} (${r.nFolds} folds, ${r.seconds.toFixed(0)} s)\n`);
  say('| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |');
  say('|---|---|---|---|');
  say(`| Exactitud | ${fmt(p.accuracy)} | ${fmt(r.res.mean.accuracy)} ± ${fmt(r.res.std.accuracy)} | ${fmt(r.mHigh.accuracy)} |`);
  say(`| F1 macro | ${fmt(p.f1Macro)} | ${fmt(r.res.mean.f1Macro)} ± ${fmt(r.res.std.f1Macro)} | ${fmt(r.mHigh.f1Macro)} |`);
  say(`| Penalización FORCE (menor es mejor; puntuación = −penalización) | ${fmt(p.penalty)} | ${fmt(r.res.mean.penalty)} ± ${fmt(r.res.std.penalty)} | ${fmt(r.mHigh.penalty)} |`);
  say('\n| Clase | Soporte | Precisión | Recall | F1 |');
  say('|---|---|---|---|---|');
  p.perClass.forEach((c, i) => say(`| ${LITHOLOGY_CLASSES[i].label} | ${c.support} | ${fmt(c.precision)} | ${fmt(c.recall)} | ${fmt(c.f1)} |`));
  say('\nMatriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):\n');
  say('```');
  for (let t = 0; t < K; t++) say(Array.from({ length: K }, (_, q) => String(p.confusion[t * K + q]).padStart(7)).join(''));
  say('```');
}

if (cvMode) {
  const kinds = cvMode === 'all' ? ['random', 'blocks', 'lowo'] : cvMode.split(',');
  say(`### Validación cruzada (árboles ${cvHp.nTrees}, muestra/árbol ${cvHp.sampleSize}, profundidad ${cvHp.maxDepth}, hoja mínima ${cvHp.minSamplesLeaf}, class-power ${classPower})`);
  say(`Bloques de ${blockLength} m, buffer ${gap} m, ${folds} folds; leave-one-well-out con ${lowoGroup} pozo(s) por fold.`);
  for (const kind of kinds) for (const v of variantsWanted) cvSection(await runCv(kind, v));
}

// ---------- modelos finales ----------
if (flag('final')) {
  mkdirSync(outDir, { recursive: true });
  const texts = {};
  const info = {};
  const models = {};
  say(`\n### Modelos finales (árboles ${hp.nTrees}, muestra/árbol ${hp.sampleSize}, profundidad ${hp.maxDepth}, hoja mínima ${hp.minSamplesLeaf}, bins ${hp.maxBins}, semilla ${hp.seed})\n`);
  for (const v of variantsWanted) {
    const fm = matrixFor(FEATURE_SETS[v]);
    const t1 = Date.now();
    const model = trainRandomForest(dataFor(fm), { ...hp, meta: { ...baseMeta, variant: v, features: FEATURE_SETS[v] } });
    models[v] = model;
    const trainSec = (Date.now() - t1) / 1000;
    const text = encodeModelText(model);
    texts[v] = text;
    const raw64 = serializeModel(model);
    // Tiempo de inferencia y resubstitución sobre una muestra de entrenamiento.
    const sub = 5810;
    const Xs = new Float32Array(sub * fm.d);
    const ys = new Int16Array(sub);
    for (let i = 0; i < sub; i++) {
      const r = Math.floor((i * n) / sub);
      for (let j = 0; j < fm.d; j++) Xs[i * fm.d + j] = fm.X[r * fm.d + j];
      ys[i] = y[r];
    }
    const t2 = performance.now();
    const pr = predictForest(model, Xs, sub);
    const infMs = performance.now() - t2;
    // Autoverificación: se decodifica el texto que se va a escribir y debe predecir bit a bit igual que el modelo en memoria.
    const decoded = predictForest(decodeModelText(text), Xs, sub);
    for (let i = 0; i < pr.probabilities.length; i++) {
      if (decoded.probabilities[i] !== pr.probabilities[i]) throw new Error(`El modelo decodificado (${v}) no reproduce las predicciones del original.`);
    }
    const acc = evaluatePredictions(ys, argmaxRows(pr.probabilities, sub, K).classIndex, K);
    info[v] = { trainSec, rawBytes: raw64.length, textBytes: text.length, leaves: leafCount(model), nodes: model.nodeFeature.length, infMs, resubAcc: acc.accuracy };
    say(`- **${v}** (${FEATURE_SETS[v].join(', ')}): entrenamiento ${trainSec.toFixed(0)} s; binario ${(raw64.length / 1024).toFixed(0)} KB; texto embebido (zlib+base64) ${(text.length / 1024).toFixed(0)} KB; ${model.nodeFeature.length} nodos, ${leafCount(model)} hojas; inferencia de ${sub} muestras ${infMs.toFixed(0)} ms.`);
    say(`  Importancia MDI: ${model.featureNames.map((f, j) => `${f} ${fmt(model.importance[j])}`).join(', ')}.`);

    // Importancia por permutación HONESTA: un modelo con la misma configuración, entrenado sin 1 de cada 7 pozos,
    // se evalúa sobre esos pozos (barajando dentro de cada pozo). Submuestra de prueba cada 4 filas.
    const holdoutWell = new Uint8Array(wellNames.length);
    for (let w = 0; w < wellNames.length; w += 7) holdoutWell[w] = 1;
    const trainRows = [];
    const testRows = [];
    for (let i = 0; i < n; i++) (holdoutWell[wellIds[i]] ? (i % 4 === 0 ? testRows.push(i) : 0) : trainRows.push(i));
    const heldModel = trainRandomForest(dataFor(fm, { rows: Int32Array.from(trainRows) }), hp);
    const m = testRows.length;
    const Xh = new Float32Array(m * fm.d);
    const yh = new Int16Array(m);
    const gh = new Int32Array(m);
    testRows.forEach((r, i) => {
      for (let j = 0; j < fm.d; j++) Xh[i * fm.d + j] = fm.X[r * fm.d + j];
      yh[i] = y[r];
      gh[i] = wellIds[r];
    });
    for (const metric of ['f1Macro', 'penalty']) {
      const perm = permutationImportance({
        X: Xh, n: m, d: fm.d, truth: yh, nClasses: K, featureNames: fm.featureNames, repeats: 5, seed: 3, metric, groups: gh,
        predict: (X, mm) => argmaxRows(predictForest(heldModel, X, mm).probabilities, mm, K).classIndex,
      });
      say(`  Importancia por permutación en ${Math.ceil(wellNames.length / 7)} pozos retenidos (${m} muestras; métrica ${metric}, línea base ${fmt(perm.baseline)}; positivo = la curva ayuda; ${metric === 'penalty' ? 'caída = aumento de la penalización' : 'caída de F1 macro'}): ${perm.featureNames.map((f, j) => `${f} ${fmt(perm.importance[j])} ± ${fmt(perm.std[j])}`).join(', ')}.`);
    }
  }
  if (evalCsv) {
    const ev = await loadCsv(evalCsv);
    say(`\n### Evaluación externa: test oculto de FORCE 2020 (${ev.n} muestras, ${ev.wellNames.length} pozos que no están en train.csv)\n`);
    say('| Variante | Exactitud | F1 macro | Penalización FORCE (puntuación = −penalización) | Exactitud (confianza 1) | Penalización (confianza 1) |');
    say('|---|---|---|---|---|---|');
    for (const v of variantsWanted) {
      const fm = buildFeatureMatrix(ev.raw, FEATURE_SETS[v], { nphiUnit: 'fraction' });
      const pr = predictForest(models[v], fm.X, fm.n);
      const pred = argmaxRows(pr.probabilities, fm.n, K).classIndex;
      const all = evaluatePredictions(ev.y, pred, K);
      const ht = [];
      const hp1 = [];
      for (let i = 0; i < ev.n; i++) if (ev.conf[i] === 1) (ht.push(ev.y[i]), hp1.push(pred[i]));
      const hi = evaluatePredictions(ht, hp1, K);
      say(`| ${v} | ${fmt(all.accuracy)} | ${fmt(all.f1Macro)} | ${fmt(all.penalty)} | ${fmt(hi.accuracy)} | ${fmt(hi.penalty)} |`);
    }
  }
  const body = Object.entries(texts).map(([v, t]) => `  ${v}: '${t}',`).join('\n');
  writeFileSync(
    resolve(outDir, 'lithologyModels.ts'),
    `// GENERADO por tools/ml/train.mjs: no editar a mano. Reentrenar: ver src/ml/README.md.\n` +
      `// Random forest de litología entrenado con FORCE 2020 (${n} muestras, ${wellNames.length} pozos).\n` +
      `// Cada valor es un modelo serializado (src/ml/serialize.ts): zlib + base64.\n` +
      `export const EMBEDDED_LITHOLOGY_MODELS: Record<string, string> = {\n${body}\n};\n`,
  );
  console.log('Modelos escritos en', outDir);
}

if (cvMode || flag('final')) {
  writeFileSync(reportPath, `# Métricas de entrenamiento y validación (generado por tools/ml/train.mjs)\n\n${reportLines.join('\n')}\n`);
  console.log('Reporte en', reportPath);
}
console.log(`Total ${((Date.now() - t0) / 1000).toFixed(0)} s`);
