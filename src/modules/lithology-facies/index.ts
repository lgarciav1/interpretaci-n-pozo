/**
 * Litología sugerida por random forest (fase 10c; docs/decisiones/0030-modelos-de-facies.md). Definición PURA: la
 * ejecuta el Web Worker del motor.
 *
 * Aplica el modelo FORCE 2020 embebido (`src/ml/`) muestra a muestra y publica la clase ganadora con su probabilidad,
 * y las dos siguientes (para el tooltip de la pista), más un resumen por clase. Con el PE sospechoso de baritina
 * (decisión 0029) el modo automático usa el modelo sin PE y lo avisa. El modelo pesado se importa desde
 * `predict.worker-only.ts`, que el build reemplaza en el hilo principal (ver ese archivo).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { lithologyIndexOfCode } from '../../ml/lithology';
import { FEATURES, type CurveKey, type FeatureName, type ModelCurves } from '../../ml/features';
import { CLASS_COUNT, classLabel, DEFAULT_MIN_CONFIDENCE, LITHOLOGY_FACIES_ID, LOW_SKILL_CLASSES, IMPORTANCE_TABLE, PORT, SUMMARY_TABLE, TRANSFER_WARNING, type PeUsage } from './model';
import { faciesImportance, predictFacies } from './predict.worker-only';

const CURVE_LABEL: Readonly<Record<CurveKey, string>> = {
  GR: 'rayos gamma', RHOB: 'densidad', NPHI: 'neutrón', PEF: 'PE', DTC: 'sónico', RDEP: 'resistividad profunda', CALI: 'caliper',
};

/** Rótulos cortos para el panel de importancia. */
const SHORT_LABEL: Readonly<Record<FeatureName, string>> = {
  GR: 'Rayos gamma', RHOB: 'Densidad', NPHI: 'Neutrón', PEF: 'PE', DTC: 'Sónico', LOG_RDEP: 'Resistividad (log)', CALI: 'Caliper',
};

const role = (id: string, label: string, color: string, max: number, family: 'lithology' | 'other') =>
  ({ id, label, unit: 'unitless', family, origin: 'computed', display: { color, scale: 'linear', min: 0, max } }) as const;

const pct = (x: number) => `${(x * 100).toFixed(0)} %`;

export default defineModule({
  id: LITHOLOGY_FACIES_ID,
  name: 'Litología sugerida (random forest)',
  description:
    'Sugiere la litología de cada muestra con un random forest entrenado en pozos del Mar del Norte (FORCE 2020), con la probabilidad de la clase. Es una sugerencia, no una litología medida.',
  // Paso «Litología y mineralogía» del flujo de Geología.
  category: 'lithology',
  workspace: 'geology',
  roles: [
    role(PORT.cls, 'Litología sugerida (ML)', '#8a7a52', CLASS_COUNT - 1, 'lithology'),
    role(PORT.conf, 'Probabilidad de la litología sugerida', '#5a636e', 1, 'other'),
    role(PORT.cls2, 'Segunda litología más probable', '#8a7a52', CLASS_COUNT - 1, 'other'),
    role(PORT.conf2, 'Probabilidad de la segunda litología', '#5a636e', 1, 'other'),
    role(PORT.cls3, 'Tercera litología más probable', '#8a7a52', CLASS_COUNT - 1, 'other'),
    role(PORT.conf3, 'Probabilidad de la tercera litología', '#5a636e', 1, 'other'),
  ],
  inputs: {
    gr: input.optionalCurve('GR'),
    rhob: input.optionalCurve('RHOB'),
    nphi: input.optionalCurve('NPHI'),
    pe: input.optionalCurve('PEF'),
    dt: input.optionalCurve('DT'),
    rt: input.optionalCurve('RT', { label: 'Resistividad profunda' }),
    // Sin caliper: ninguna de las dos variantes del modelo lo usa (decisión 0030); como entrada solo forzaría recálculos.
  },
  // El modelo necesita al menos dos curvas (0032): con menos, el motor no lo corre y la sarta lo marca.
  inputGroups: [
    {
      inputs: ['gr', 'rhob', 'nphi', 'pe', 'dt', 'rt'],
      min: 2,
      label: 'al menos dos curvas entre rayos gamma, densidad, neutrón, factor fotoeléctrico, sónico y resistividad profunda',
    },
  ],
  params: {
    peUsage: param.enum({
      label: 'Uso del PE',
      tooltip: 'Automático: si el PE es alto con densidad baja en buena parte del pozo (baritina en el lodo) se usa el modelo entrenado sin PE.',
      options: [
        { value: 'auto', label: 'Automático (ignorar si es sospechoso)' },
        { value: 'use', label: 'Usar siempre' },
        { value: 'ignore', label: 'Ignorar' },
      ],
      default: 'auto',
      group: 'Modelo',
    }),
    minConfidence: param.number({
      label: 'Probabilidad mínima',
      tooltip: 'Por debajo de esta probabilidad la clase ganadora se dibuja atenuada y se cuenta como incierta en el resumen.',
      default: DEFAULT_MIN_CONFIDENCE,
      min: 0.2,
      max: 0.9,
      step: 0.05,
      unit: 'v/v',
      group: 'Lectura',
    }),
  },
  outputs: {
    cls: output.curve(PORT.cls),
    conf: output.curve(PORT.conf),
    cls2: output.curve(PORT.cls2),
    conf2: output.curve(PORT.conf2),
    cls3: output.curve(PORT.cls3),
    conf3: output.curve(PORT.conf3),
    summary: output.table(SUMMARY_TABLE, {
      label: 'Litología sugerida en el pozo',
      columns: [
        { key: 'lithology', label: 'Litología sugerida', kind: 'text' },
        { key: 'thickness', label: 'Espesor', unit: 'm' },
        { key: 'percent', label: 'Proporción', unit: '%' },
        { key: 'meanP', label: 'Probabilidad media', unit: 'v/v' },
        { key: 'uncertain', label: 'Inciertas', unit: '%' },
      ],
    }),
    importance: output.table(IMPORTANCE_TABLE, {
      label: 'Importancia de las curvas en el modelo',
      hidden: true,
      columns: [
        { key: 'feature', label: 'Característica', kind: 'text' },
        { key: 'label', label: 'Curva', kind: 'text' },
        { key: 'importance', label: 'Importancia (MDI)' },
        { key: 'variant', label: 'Variante del modelo', kind: 'text' },
        { key: 'reason', label: 'Motivo de la variante', kind: 'text' },
      ],
    }),
  },
  compute({ n, inputs, params, thickness, warn }) {
    const out = {
      cls: new Float64Array(n).fill(NaN),
      conf: new Float64Array(n).fill(NaN),
      cls2: new Float64Array(n).fill(NaN),
      conf2: new Float64Array(n).fill(NaN),
      cls3: new Float64Array(n).fill(NaN),
      conf3: new Float64Array(n).fill(NaN),
      summary: { rows: [] as Record<string, TableCell>[] },
      importance: { rows: [] as Record<string, TableCell>[] },
    };
    const curves: ModelCurves = {};
    if (inputs.gr) curves.GR = inputs.gr;
    if (inputs.rhob) curves.RHOB = inputs.rhob;
    if (inputs.nphi) curves.NPHI = inputs.nphi;
    if (inputs.pe) curves.PEF = inputs.pe;
    if (inputs.dt) curves.DTC = inputs.dt;
    if (inputs.rt) curves.RDEP = inputs.rt;
    if (Object.keys(curves).length < 2) {
      warn('Faltan curvas para sugerir litología: el modelo necesita al menos dos entre rayos gamma, densidad, neutrón, sónico y resistividad profunda.');
      return out;
    }

    const pred = predictFacies(curves, params.peUsage as PeUsage);
    if (!pred) {
      warn('La litología sugerida se calcula en el motor en segundo plano, que no está disponible: recargá la página.');
      return out;
    }
    warn(pred.variantReason);
    for (const f of faciesImportance(pred.variant) ?? []) {
      const label = SHORT_LABEL[f.feature as FeatureName] ?? FEATURES[f.feature as FeatureName]?.label ?? f.feature;
      out.importance.rows.push({ feature: f.feature, label, importance: f.importance, variant: pred.variant, reason: pred.variantReason });
    }
    warn(TRANSFER_WARNING);
    if (pred.missingCurves.length) {
      warn(`El modelo usa también ${pred.missingCurves.map((c) => CURVE_LABEL[c]).join(', ')}; sin esa información la sugerencia pierde precisión.`);
    }

    // Índice FORCE canónico de cada columna del modelo (los colores y rótulos se resuelven por ese índice).
    const K = pred.nClasses;
    const canon = pred.classes.map((c) => lithologyIndexOfCode(c.code));
    const p = pred.probabilities;
    const minP = params.minConfidence;
    const h = new Float64Array(CLASS_COUNT);
    const sumP = new Float64Array(CLASS_COUNT);
    const low = new Float64Array(CLASS_COUNT);
    let validCount = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (!pred.valid[i]) continue;
      validCount++;
      // Las tres clases más probables de la fila.
      let a = -1, b = -1, c = -1;
      for (let k = 0; k < K; k++) {
        const v = p[i * K + k]!;
        if (a < 0 || v > p[i * K + a]!) { c = b; b = a; a = k; }
        else if (b < 0 || v > p[i * K + b]!) { c = b; b = k; }
        else if (c < 0 || v > p[i * K + c]!) c = k;
      }
      const ca = canon[a]!;
      if (ca < 0) continue;
      out.cls[i] = ca;
      out.conf[i] = p[i * K + a]!;
      if (b >= 0 && canon[b]! >= 0) { out.cls2[i] = canon[b]!; out.conf2[i] = p[i * K + b]!; }
      if (c >= 0 && canon[c]! >= 0) { out.cls3[i] = canon[c]!; out.conf3[i] = p[i * K + c]!; }
      const dz = Number.isFinite(thickness[i]!) ? thickness[i]! : 0;
      h[ca]! += dz;
      sumP[ca]! += out.conf[i]! * dz;
      if (out.conf[i]! < minP) low[ca]! += dz;
      total += dz;
    }
    if (validCount === 0) {
      warn('Ninguna muestra tiene datos suficientes para sugerir litología.');
      return out;
    }
    if (validCount < 0.8 * n) warn(`El ${pct(1 - validCount / n)} de las muestras no tiene datos suficientes: quedan sin litología sugerida.`);

    for (let k = 0; k < CLASS_COUNT; k++) {
      if (!(h[k]! > 0)) continue;
      out.summary.rows.push({
        lithology: LOW_SKILL_CLASSES.has(k) ? `${classLabel(k)} (poco distinguible)` : classLabel(k),
        thickness: h[k]!,
        percent: total > 0 ? (100 * h[k]!) / total : null,
        meanP: sumP[k]! / h[k]!,
        uncertain: (100 * low[k]!) / h[k]!,
      });
    }
    out.summary.rows.sort((x, y) => (y.thickness as number) - (x.thickness as number));
    return out;
  },
  docs: {
    summary:
      'Clasificación supervisada de litología por random forest (bosque de árboles de decisión con muestreo bootstrap y subconjuntos aleatorios de características). Características: GR, densidad, neutrón, PE (solo en la variante con PE), sónico compresional y logaritmo de la resistividad profunda. Cada árbol vota con las proporciones de clase de su hoja; la probabilidad de una clase es el promedio de esos votos y la confianza es la probabilidad de la clase ganadora. Entrenado offline con 98 pozos del Mar del Norte del concurso FORCE 2020 (12 clases); se valida por bloques de profundidad y dejando un pozo afuera. Con PE sospechoso de baritina se usa la variante sin PE.',
    equations: [
      { latex: 'P(c\\mid x) = \\frac{1}{T}\\sum_{t=1}^{T} p_t(c\\mid x)', description: 'Probabilidad de la clase c: promedio de las proporciones de clase de la hoja de cada uno de los T árboles.' },
      { latex: '\\hat c = \\arg\\max_c P(c\\mid x), \\qquad \\text{confianza} = P(\\hat c\\mid x)', description: 'Clase sugerida y su probabilidad.' },
    ],
    references: [
      'Breiman, L. (2001). Random Forests. Machine Learning 45(1), 5–32. DOI 10.1023/A:1010933404324.',
      'Bormann, P., Aursand, P., Dilib, F., Manral, S. y Dischington, P. (2020). FORCE 2020 Well well log and lithofacies dataset for machine learning competition. Zenodo. DOI 10.5281/zenodo.4351156.',
    ],
    notes:
      'Las probabilidades no están calibradas: miden acuerdo entre árboles, no frecuencia real. El modelo se entrenó en otra cuenca; la transferencia al pozo del TP no está medida (decisión 0030). Arenisca/Lutita, Marga, Dolomía, Creta, Toba y Basamento tienen F1 < 0,25 en la validación dejando un pozo afuera: se muestran atenuadas.',
  },
});
