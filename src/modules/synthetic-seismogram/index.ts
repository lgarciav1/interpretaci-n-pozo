/** Geo-6: sismograma acústico 1D; definición pura para el motor incremental. */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { buildSynthetic } from '../../petro/synthetic';

export const SYNTHETIC_ID = 'synthetic-seismogram';
export const TIME_DEPTH = 'TIME_DEPTH';
export const SYNTHETIC_TIME = 'SYNTHETIC_TIME';
export const SYNTHETIC_WAVELET = 'SYNTHETIC_WAVELET';
export const SYNTHETIC_SUMMARY = 'SYNTHETIC_SUMMARY';
const cell = (value: number): TableCell => Number.isFinite(value) ? value : null;
const role = (id: string, label: string, color: string, min: number, max: number, unit = 'unitless') => ({ id, label, unit, family: 'other' as const, origin: 'computed' as const, display: { color, scale: 'linear' as const, min, max } });

export default defineModule({
  id: SYNTHETIC_ID, name: 'Sismograma sintético', category: 'geology', workspace: 'geology',
  description: 'Velocidad e impedancia acústica, reflectividad y convolución con una ondícula Ricker; tiempo doble relativo al tope salvo calibración.',
  roles: [
    role('VELOCITY', 'Velocidad compresional', '#7c6acf', 1500, 7000, 'm/s'),
    role('AI', 'Impedancia acústica', '#b86b48', 0, 30, 'MRayl'),
    role('RC', 'Reflectividad acústica', '#639ca2', -0.5, 0.5),
    role('SYNTHETIC', 'Amplitud sintética', '#545a66', -1, 1),
    role('TWT', 'Tiempo doble', '#6a82bf', 0, 1000, 'ms'),
  ],
  inputs: { dt: input.curve('DT'), rho: input.curve('RHOB') },
  params: {
    sampleMs: param.number({ label: 'Paso temporal', unit: 'ms', tooltip: 'Paso de la traza regular en tiempo. La resolución también depende de la ondícula.', default: 2, min: 1, max: 2, step: 0.5, group: 'Traza' }),
    frequencyHz: param.number({ label: 'Frecuencia central (Hz)', tooltip: 'Frecuencia central de la ondícula Ricker de fase cero.', default: 30, min: 5, max: 100, step: 1, group: 'Traza' }),
    polarity: param.enum({ label: 'Polaridad', default: 'normal', options: [{ value: 'normal', label: 'Normal · aumento de impedancia positivo' }, { value: 'inverted', label: 'Invertida' }], group: 'Traza' }),
    initialTimeMs: param.number({ label: 'Tiempo doble en el tope', unit: 'ms', tooltip: '0 produce tiempo relativo al primer registro. Un valor absoluto requiere calibración externa.', default: 0, min: 0, max: 10000, step: 1, group: 'Tiempo–profundidad' }),
    smoothWindow: param.number({ label: 'Ventana de suavizado (muestras)', tooltip: 'Ventana impar sobre los perfiles; 1 conserva los originales. El suavizado puede reducir contrastes finos.', default: 1, min: 1, max: 21, step: 2, group: 'Preprocesado' }),
    despike: param.boolean({ label: 'Quitar picos aislados', tooltip: 'Aplica el criterio robusto documentado en el motor; revisá el perfil antes de usarlo.', default: false, group: 'Preprocesado' }),
    maxGapSamples: param.number({ label: 'Hueco interpolable (muestras)', tooltip: '0 no rellena huecos. Tras un hueco sónico no resuelto, el tiempo acumulado es desconocido.', default: 0, min: 0, max: 20, step: 1, group: 'Preprocesado' }),
  },
  outputs: {
    velocity: output.curve('VELOCITY'), impedance: output.curve('AI'), reflectivity: output.curve('RC'), trace: output.curve('SYNTHETIC'), twt: output.curve('TWT'),
    depthTime: output.table(TIME_DEPTH, { label: 'Tiempo–profundidad', hidden: true, columns: [{ key: 'depth', label: 'Profundidad', unit: 'm' }, { key: 'twt', label: 'Tiempo doble', unit: 'ms' }] }),
    time: output.table(SYNTHETIC_TIME, { label: 'Sismograma en tiempo', hidden: true, columns: [{ key: 'time', label: 'Tiempo doble', unit: 'ms' }, { key: 'impedance', label: 'Impedancia', unit: 'MRayl' }, { key: 'reflectivity', label: 'Reflectividad' }, { key: 'trace', label: 'Amplitud' }] }),
    wavelet: output.table(SYNTHETIC_WAVELET, { label: 'Ondícula Ricker', hidden: true, columns: [{ key: 'time', label: 'Tiempo relativo', unit: 'ms' }, { key: 'amplitude', label: 'Amplitud' }] }),
    summary: output.table(SYNTHETIC_SUMMARY, { label: 'Calidad del sintético', hidden: true, columns: [{ key: 'totalTime', label: 'Tiempo final', unit: 'ms' }, { key: 'gapCount', label: 'Huecos' }, { key: 'samples', label: 'Muestras temporales' }, { key: 'validTimeSpan', label: 'Intervalo temporal cubierto', unit: 'ms' }, { key: 'lastValidDepth', label: 'Última profundidad cubierta', unit: 'm' }] }),
  },
  compute({ depth, inputs, params, warn }) {
    const result = buildSynthetic(depth, inputs.dt, inputs.rho, params);
    result.warnings.forEach((w) => warn(w));
    return {
      velocity: result.velocity, impedance: result.impedance, reflectivity: result.reflectivity, trace: result.syntheticDepth, twt: result.twt,
      depthTime: { rows: Array.from(depth, (value, index) => ({ depth: cell(value), twt: cell(result.twt[index]) })) },
      time: { rows: Array.from(result.time, (value, index) => ({ time: cell(value), impedance: cell(result.timeImpedance[index]), reflectivity: cell(result.timeReflectivity[index]), trace: cell(result.trace[index]) })) },
      wavelet: { rows: Array.from(result.wavelet.time, (value, index) => ({ time: cell(value), amplitude: cell(result.wavelet.amplitude[index]) })) },
      summary: { rows: [{ totalTime: cell(result.totalTime), gapCount: result.gapCount, samples: result.time.length, validTimeSpan: cell(result.validTimeSpan), lastValidDepth: cell(result.lastValidDepth) }] },
    };
  },
  docs: {
    summary: 'Convierte el sónico compresional canónico µs/ft a velocidad m/s, calcula impedancia acústica con densidad g/cm³, reflexión a incidencia normal y tiempo doble mediante integración. Remuestrea a tiempo regular y convoluciona con Ricker de fase cero. El sintético se vuelve a mapear a profundidad para el visor. No incluye transmisión, atenuación, múltiples ni calibración sísmica automática.',
    equations: [
      { latex: 'V_p=304800/\\Delta t', description: 'Velocidad m/s a partir del sónico µs/ft; conversión exacta de unidades.' },
      { latex: 'AI=\\rho_bV_p/1000', description: 'Densidad en g/cm³ y velocidad m/s; resultado en MRayl (10⁶ kg/m²/s).' },
      { latex: 'R_i=(AI_{i+1}-AI_i)/(AI_{i+1}+AI_i)', description: 'Coeficiente de reflexión a incidencia normal.' },
      { latex: 't_{2w}=t_0+2\\int dz/V_p', description: 'Tiempo doble; integración trapezoidal, con conversión s a ms.' },
      { latex: 'w(t)=[1-2(\\pi f t)^2]e^{-(\\pi f t)^2}', description: 'Ondícula de Ricker, t en segundos y f en Hz.' },
      { latex: 's(t)=R(t)*w(t)', description: 'Convolución discreta en tiempo regular; inversión opcional de polaridad.' },
    ],
    references: ['Wang, Y. (2015), The Ricker wavelet and the Lambert W function, Geophysical Journal International 200, 111–115, p. 112, ecuación 3 (ondícula Ricker).', 'Yilmaz, Ö. (2001), Seismic Data Analysis, 2.ª ed., SEG. Página específica SIN VERIFICAR; consultar el encabezado del motor para las referencias verificadas.'],
    notes: 'Frecuencia, suavizado y relleno de huecos son elecciones del intérprete, no constantes de libro. El tiempo es relativo al tope del perfil cuando no se aporta una referencia externa. Una traza sintética es una hipótesis acústica 1D y requiere amarre con datos sísmicos y check-shot/VSP para uso absoluto. SEG-Y queda fuera de alcance.',
  },
});
