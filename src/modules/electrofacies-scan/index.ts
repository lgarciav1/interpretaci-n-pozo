/**
 * Elección de k de las electrofacies (fase 10c-2). Definición PURA (worker). Ajusta la mezcla gaussiana y k-means para
 * k = 2…8 y publica BIC e inercia; el módulo `electrofacies` toma de acá el k sugerido y el panel dibuja la curva.
 *
 * Va aparte de `electrofacies` para que cambiar k o el método no repita el barrido (el motor cachea por módulo). Para
 * que el barrido no demore el primer cálculo del pozo, ajusta sobre unas 2000 muestras repartidas en todo el pozo. El
 * k sugerido es orientativo: con todas las muestras el codo puede correrse en uno (en el TP, 4 contra 5 con GMM).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { scanClusterCount } from '../../ml/electrofacies';
import type { ModelCurves } from '../../ml/features';
import { EF_SCAN_TABLE, EF_SEED, ELECTROFACIES_SCAN_ID, K_VALUES, suggestK } from '../electrofacies/model';

/** Una muestra de cada `step` (vista nueva, no muta la entrada). */
function decimate(x: ArrayLike<number>, step: number): Float64Array {
  const out = new Float64Array(Math.ceil(x.length / step));
  for (let i = 0, j = 0; i < x.length; i += step, j++) out[j] = x[i]!;
  return out;
}

export default defineModule({
  id: ELECTROFACIES_SCAN_ID,
  name: 'Electrofacies · elección de k',
  description: 'Curva de BIC (mezcla gaussiana) e inercia (k-means) para 2 a 8 electrofacies, con el k sugerido. La usa el módulo Electrofacies.',
  category: 'lithology',
  workspace: 'geology',
  inputs: {
    gr: input.optionalCurve('GR'),
    rhob: input.optionalCurve('RHOB'),
    nphi: input.optionalCurve('NPHI'),
    dt: input.optionalCurve('DT'),
    rt: input.optionalCurve('RT', { label: 'Resistividad profunda' }),
  },
  params: {},
  outputs: {
    scan: output.table(EF_SCAN_TABLE, {
      label: 'Elección de k de electrofacies',
      hidden: true,
      columns: [
        { key: 'k', label: 'k' },
        { key: 'bic', label: 'BIC (mezcla gaussiana)' },
        { key: 'inertia', label: 'Inercia (k-means)' },
        { key: 'suggestedGmm', label: 'Sugerido GMM (1 = sí)' },
        { key: 'suggestedKmeans', label: 'Sugerido k-means (1 = sí)' },
      ],
    }),
  },
  compute({ n, inputs, warn }) {
    const step = Math.max(1, Math.round(n / 2000));
    const curves: ModelCurves = {};
    if (inputs.gr) curves.GR = decimate(inputs.gr, step);
    if (inputs.rhob) curves.RHOB = decimate(inputs.rhob, step);
    if (inputs.nphi) curves.NPHI = decimate(inputs.nphi, step);
    if (inputs.dt) curves.DTC = decimate(inputs.dt, step);
    if (inputs.rt) curves.RDEP = decimate(inputs.rt, step);
    if (Object.keys(curves).length < 2) {
      warn('Faltan curvas para agrupar electrofacies: hacen falta al menos dos entre rayos gamma, densidad, neutrón, sónico y resistividad profunda.');
      return { scan: { rows: [] } };
    }
    const opts = { seed: EF_SEED, featureOptions: { nphiUnit: 'fraction' as const } };
    const gmm = scanClusterCount(curves, K_VALUES, { ...opts, method: 'gmm' });
    const km = scanClusterCount(curves, K_VALUES, { ...opts, method: 'kmeans' });
    const bic = gmm.map((r) => r.bic ?? NaN);
    const inertia = km.map((r) => r.inertia ?? NaN);
    const sg = suggestK(K_VALUES, bic);
    const sk = suggestK(K_VALUES, inertia);
    const rows: Record<string, TableCell>[] = K_VALUES.map((k, i) => ({
      k,
      bic: Number.isFinite(bic[i]!) ? bic[i]! : null,
      inertia: Number.isFinite(inertia[i]!) ? inertia[i]! : null,
      suggestedGmm: k === sg ? 1 : 0,
      suggestedKmeans: k === sk ? 1 : 0,
    }));
    return { scan: { rows } };
  },
  docs: {
    summary:
      'Para cada número de grupos k entre 2 y 8 ajusta la mezcla gaussiana (covarianza diagonal) y k-means sobre GR, densidad, neutrón, sónico y log10 de la resistividad profunda estandarizados de forma robusta. El k sugerido es el mínimo del BIC si es interior; si el BIC baja hasta el último k, el codo de la curva (punto más alejado por debajo de la cuerda entre los extremos, con los ejes normalizados). El barrido usa unas 2000 muestras equiespaciadas del pozo.',
    equations: [
      { latex: '\\mathrm{BIC} = -2\\ln \\hat L + p\\,\\ln n', description: 'Criterio de información bayesiano: log-verosimilitud penalizada por la cantidad de parámetros p.' },
      { latex: 'J = \\sum_i \\lVert z_i - \\mu_{c(i)} \\rVert^2', description: 'Inercia de k-means: suma de distancias al cuadrado al centro del grupo.' },
    ],
    references: [
      'Schwarz, G. (1978). Estimating the dimension of a model. Annals of Statistics 6(2), 461–464.',
      'Satopää, V., Albrecht, J., Irwin, D. y Raghavan, B. (2011). Finding a «kneedle» in a haystack: detecting knee points in system behavior. ICDCS Workshops, 166–171.',
    ],
  },
});
