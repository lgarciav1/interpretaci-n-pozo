/**
 * Módulo TEMP — temperatura de formación por gradiente geotérmico. Sin entradas: siempre puede correr. Ver 0007, C9.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, output } from '../../core/module';
import { param } from '../../core/params';
import { formationTemperature } from '../../petro/temperature';

export default defineModule({
  id: 'temp-gradient',
  name: 'Temperatura de formación (gradiente)',
  description: 'Temperatura de formación a cada profundidad a partir de la temperatura de superficie y el gradiente geotérmico.',
  category: 'water',
  workspace: 'petrophysics',
  inputs: {},
  params: {
    tSurface: param.number({
      label: 'Temperatura de superficie',
      tooltip: 'Temperatura media anual en superficie o en el fondo marino.',
      default: 20,
      min: -10,
      max: 60,
      step: 0.5,
      unit: 'degC',
    }),
    gradient: param.number({
      label: 'Gradiente geotérmico',
      tooltip: 'Aumento de temperatura cada 100 m de profundidad. Típico: 2,5–3,5 °C/100 m.',
      default: 3,
      min: 0.5,
      max: 8,
      step: 0.05,
      unit: 'degC/100m',
    }),
    datum: param.number({
      label: 'Profundidad de la temperatura de superficie',
      tooltip: 'Profundidad a la que vale la temperatura de superficie: 0 m en tierra; el fondo marino o la mesa rotary en otros casos.',
      default: 0,
      min: -500,
      max: 5000,
      step: 1,
      unit: 'm',
    }),
  },
  outputs: {
    temp: output.curve('TEMP'),
  },
  compute({ n, depth, params }) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = formationTemperature(depth[i]! - params.datum, params.tSurface, params.gradient / 100);
    return { temp: out };
  },
  docs: {
    summary: 'Temperatura de formación por gradiente geotérmico lineal desde la superficie. Se usa para llevar Rw y Rmf a condiciones de fondo.',
    equations: [{ latex: 'T(z) = T_{sup} + G\\,(z - z_0)', description: 'G en °C por metro (el control está en °C/100 m).' }],
    references: ['Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.'],
  },
});
