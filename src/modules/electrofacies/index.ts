/**
 * Electrofacies (fase 10c-2; docs/decisiones/0031-modulo-de-facies.md). Definición PURA (worker).
 *
 * Agrupa las muestras sin etiquetas (mezcla gaussiana o k-means de `src/ml`) por su respuesta de perfiles. No son
 * litologías: son grupos de respuesta parecida, numerados de menor a mayor GR medio. k = «auto» toma el sugerido por
 * el módulo `electrofacies-scan` (codo del BIC o de la inercia).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { clusterElectrofacies } from '../../ml/electrofacies';
import type { FeatureName, ModelCurves } from '../../ml/features';
import { EF_CLUSTERS_TABLE, EF_PORT, EF_SCAN_TABLE, EF_SEED, efLabel, ELECTROFACIES_ID, K_MAX, K_MIN, K_VALUES, METHOD_LABEL, suggestedKFromScan, type EfMethod } from './model';

const CENTER_COLUMN: Partial<Record<FeatureName, string>> = { GR: 'gr', RHOB: 'rhob', NPHI: 'nphi', DTC: 'dt', LOG_RDEP: 'rt' };
const cell = (x: number): TableCell => (Number.isFinite(x) ? x : null);

export default defineModule({
  id: ELECTROFACIES_ID,
  name: 'Electrofacies',
  description: 'Agrupa las muestras por su respuesta de perfiles, sin etiquetas (mezcla gaussiana o k-means). Son grupos de respuesta parecida, no litologías.',
  category: 'lithology',
  workspace: 'geology',
  roles: [
    { id: EF_PORT.cls, label: 'Electrofacies', unit: 'unitless', family: 'lithology', origin: 'computed', display: { color: '#475569', scale: 'linear', min: 0, max: K_MAX - 1 } },
    { id: EF_PORT.conf, label: 'Probabilidad de la electrofacies', unit: 'unitless', family: 'other', origin: 'computed', display: { color: '#5a636e', scale: 'linear', min: 0, max: 1 } },
  ],
  inputs: {
    gr: input.optionalCurve('GR'),
    rhob: input.optionalCurve('RHOB'),
    nphi: input.optionalCurve('NPHI'),
    dt: input.optionalCurve('DT'),
    rt: input.optionalCurve('RT', { label: 'Resistividad profunda' }),
    scan: input.optionalTable(EF_SCAN_TABLE, { label: 'Elección de k' }),
  },
  // El agrupamiento necesita al menos dos curvas (0032): con menos, el motor no lo corre y la sarta lo marca.
  inputGroups: [{ inputs: ['gr', 'rhob', 'nphi', 'dt', 'rt'], min: 2, label: 'al menos dos curvas entre rayos gamma, densidad, neutrón, sónico y resistividad profunda' }],
  params: {
    method: param.enum({
      label: 'Método',
      tooltip: 'Mezcla gaussiana: grupos elípticos con probabilidad de pertenencia. k-means: grupos por distancia al centro, más rápido.',
      options: [
        { value: 'gmm', label: METHOD_LABEL.gmm },
        { value: 'kmeans', label: METHOD_LABEL.kmeans },
      ],
      default: 'gmm',
      group: 'Electrofacies',
    }),
    k: param.enum({
      label: 'Cantidad de electrofacies',
      tooltip: 'Automático usa el k sugerido por la curva de BIC (o de inercia con k-means) del panel.',
      options: [{ value: 'auto', label: 'Automático (sugerido)' }, ...K_VALUES.map((k) => ({ value: String(k), label: String(k) }))],
      default: 'auto',
      group: 'Electrofacies',
    }),
  },
  outputs: {
    cls: output.curve(EF_PORT.cls),
    conf: output.curve(EF_PORT.conf),
    clusters: output.table(EF_CLUSTERS_TABLE, {
      label: 'Electrofacies en el pozo',
      columns: [
        { key: 'facies', label: 'Electrofacies', kind: 'text' },
        { key: 'thickness', label: 'Espesor', unit: 'm' },
        { key: 'percent', label: 'Proporción', unit: '%' },
        { key: 'meanP', label: 'Probabilidad media', unit: 'v/v' },
        { key: 'gr', label: 'GR del centro', unit: 'gAPI' },
        { key: 'rhob', label: 'Densidad del centro', unit: 'g/cm3' },
        { key: 'nphi', label: 'Neutrón del centro', unit: 'v/v' },
        { key: 'dt', label: 'Sónico del centro', unit: 'us/ft' },
        { key: 'rt', label: 'Resistividad del centro', unit: 'ohm.m' },
      ],
    }),
  },
  compute({ n, inputs, params, thickness, warn }) {
    const out = { cls: new Float64Array(n).fill(NaN), conf: new Float64Array(n).fill(NaN), clusters: { rows: [] as Record<string, TableCell>[] } };
    const curves: ModelCurves = {};
    if (inputs.gr) curves.GR = inputs.gr;
    if (inputs.rhob) curves.RHOB = inputs.rhob;
    if (inputs.nphi) curves.NPHI = inputs.nphi;
    if (inputs.dt) curves.DTC = inputs.dt;
    if (inputs.rt) curves.RDEP = inputs.rt;
    if (Object.keys(curves).length < 2) {
      warn('Faltan curvas para agrupar electrofacies: hacen falta al menos dos entre rayos gamma, densidad, neutrón, sónico y resistividad profunda.');
      return out;
    }
    const method = params.method as EfMethod;
    let k = Number(params.k);
    if (params.k === 'auto') {
      const s = suggestedKFromScan(inputs.scan, method);
      k = s ?? 4;
      if (s === null) warn('No se pudo sugerir k (falta la curva de elección de k): se usan 4 electrofacies.');
    }
    k = Math.max(K_MIN, Math.min(K_MAX, Math.round(k)));
    const r = clusterElectrofacies(curves, { k, method, seed: EF_SEED, featureOptions: { nphiUnit: 'fraction' } });
    const h = new Float64Array(k);
    const sp = new Float64Array(k);
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (!r.valid[i]) continue;
      const c = r.labels[i]!;
      out.cls[i] = c;
      out.conf[i] = r.confidence[i]!;
      const dz = Number.isFinite(thickness[i]!) ? thickness[i]! : 0;
      h[c]! += dz;
      sp[c]! += dz * r.confidence[i]!;
      total += dz;
    }
    const d = r.featureNames.length;
    for (let c = 0; c < k; c++) {
      const row: Record<string, TableCell> = {
        facies: efLabel(c),
        thickness: h[c]!,
        percent: total > 0 ? (100 * h[c]!) / total : null,
        meanP: h[c]! > 0 ? sp[c]! / h[c]! : null,
        gr: null, rhob: null, nphi: null, dt: null, rt: null,
      };
      r.featureNames.forEach((f, j) => {
        const col = CENTER_COLUMN[f];
        if (!col) return;
        const v = r.centers[c * d + j]!;
        row[col] = cell(f === 'LOG_RDEP' ? 10 ** v : v);
      });
      out.clusters.rows.push(row);
    }
    if (r.counts.some((x) => x === 0)) warn('Alguna electrofacies quedó sin muestras: probá con menos grupos.');
    return out;
  },
  docs: {
    summary:
      'Agrupamiento sin etiquetas de las muestras por GR, densidad, neutrón, sónico y log10 de la resistividad profunda, estandarizados de forma robusta (mediana y semirrango p16–p84). Mezcla gaussiana con covarianza diagonal ajustada por EM e inicializada con k-means++, o k-means. Los grupos se numeran por el centro estandarizado (primero GR, de menor a mayor). Semilla fija: el resultado es reproducible. Son electrofacies, no litologías.',
    equations: [
      { latex: 'p(z) = \\sum_{c=1}^{k} \\pi_c\\, \\mathcal{N}(z \\mid \\mu_c, \\Sigma_c)', description: 'Mezcla gaussiana; la probabilidad de pertenencia es la responsabilidad de cada componente.' },
      { latex: 'z_j = (x_j - \\mathrm{mediana}_j) / \\tfrac{1}{2}(P_{84} - P_{16})_j', description: 'Estandarización robusta por característica.' },
    ],
    references: [
      'Dempster, A. P., Laird, N. M. y Rubin, D. B. (1977). Maximum likelihood from incomplete data via the EM algorithm. JRSS B 39(1), 1–38.',
      'Arthur, D. y Vassilvitskii, S. (2007). k-means++: the advantages of careful seeding. SODA, 1027–1035.',
      'Serra, O. y Abbott, H. T. (1982). The contribution of logging data to sedimentology and stratigraphy. SPE Journal 22(1), 117–131 (concepto de electrofacies).',
    ],
  },
});
