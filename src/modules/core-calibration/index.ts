/**
 * Módulo de calibración con corona (fase 8, función N; docs/decisiones/0023-calibracion-con-corona.md).
 * Definición PURA (la ejecuta el Web Worker).
 *
 * El motor no ve los plugs (0009, D1): este módulo calcula lo que sale solo del perfil —la densidad de matriz aparente
 * ρmaa por muestra, con su tabla y su valor por zona— y el panel «Calibración» (`dock.tsx`, misma carpeta) compara el
 * perfil con los plugs y escribe ρma y m en los módulos de porosidad y de saturación.
 *
 * Porosidad de entrada: PHIT (densidad–neutrón), no PHIE (0023, D2). PHID entra solo para avisar la circularidad:
 * si en un tramo PHIT sale únicamente de la densidad, ρmaa repite la ρma elegida y no informa nada.
 */
import { defineModule, input, output, type TableCell, type ZoneScalarValue } from '../../core/module';
import { param } from '../../core/params';
import { apparentMatrixDensityInto, summarizeByRanges, summarizeValues, type ValueSummary } from '../../petro/coreCalibration';

export const CORE_CALIBRATION_ID = 'core-calibration';
/** Puertos que lee el panel (no cambiarlos: van en el resultado del motor). */
export const RHOMAA_ZONES = 'RHOMAA_ZONES';
export const RHOMAA_ZONE = 'RHOMAA_ZONE';
/** Id de la fila del pozo completo en `RHOMAA_ZONES`. */
export const WHOLE_WELL_ROW = '';

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

function rowOf(zoneId: string, zone: string, s: ValueSummary): Record<string, TableCell> {
  return { zoneId, zone, n: s.n, median: num(s.median), p10: num(s.p10), p90: num(s.p90), mean: num(s.mean), sd: num(s.sd) };
}

/** PHIT idéntica a PHID en todas las muestras con dato del tramo (y al menos una): ρmaa es circular. */
function sameAsDensity(phit: ArrayLike<number>, phid: ArrayLike<number>, start: number, end: number): boolean {
  let n = 0;
  for (let i = start; i < end; i++) {
    const a = phit[i]!;
    const b = phid[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (Math.abs(a - b) > 1e-9) return false;
    n++;
  }
  return n > 0;
}

export default defineModule({
  id: CORE_CALIBRATION_ID,
  name: 'Densidad de matriz aparente (ρmaa)',
  description:
    'Densidad de matriz que hace coincidir la porosidad densidad con la porosidad total de densidad–neutrón, por muestra y por zona. Se compara con la densidad de grano de los plugs en el panel Calibración.',
  category: 'porosity',
  workspace: 'petrophysics',
  inputs: {
    rhob: input.curve('RHOB'),
    phit: input.curve('PHIT'),
    phid: input.optionalCurve('PHID'),
    vsh: input.optionalCurve('VSH'),
  },
  params: {
    rhoFl: param.number({
      label: 'Densidad del fluido',
      tooltip:
        'Fluido de la zona que lee la densidad (zona lavada): agua dulce 1,0; salada hasta 1,15 g/cm³. Conviene que sea la misma de la porosidad por densidad; con hidrocarburo liviano ρmaa deja de ser la matriz.',
      default: 1,
      min: 0.6,
      max: 1.3,
      step: 0.01,
      unit: 'g/cm3',
      scope: 'zone',
    }),
    vshMax: param.number({
      label: 'Vsh máxima para el valor por zona',
      tooltip:
        'El valor por zona (mediana, P10 y P90) usa solo las muestras con Vsh hasta este valor: en las arcillas ρmaa no es la matriz del reservorio. La curva se calcula en todas las muestras.',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      unit: 'v/v',
      scope: 'zone',
    }),
  },
  outputs: {
    rhomaa: output.curve('RHOMAA'),
    byZone: output.table(RHOMAA_ZONES, {
      label: 'Densidad de matriz aparente por zona',
      columns: [
        { key: 'zoneId', label: 'Id de zona', kind: 'text' },
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'n', label: 'Muestras limpias' },
        { key: 'median', label: 'ρmaa mediana', unit: 'g/cm3' },
        { key: 'p10', label: 'ρmaa P10', unit: 'g/cm3' },
        { key: 'p90', label: 'ρmaa P90', unit: 'g/cm3' },
        { key: 'mean', label: 'ρmaa media', unit: 'g/cm3' },
        { key: 'sd', label: 'Desvío estándar', unit: 'g/cm3' },
      ],
    }),
    perZone: output.zoneScalar(RHOMAA_ZONE, { label: 'Densidad de matriz aparente (mediana)', unit: 'g/cm3' }),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const { rhob, phit, phid, vsh } = inputs;
    const rhomaa = new Float64Array(n);
    // Máscara de muestras limpias (Vsh ≤ Vsh máx. de su zona); sin VSH, todas.
    const clean = new Uint8Array(n);
    for (const s of segments) {
      const where = s.zoneId ? `En la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'Fuera de las zonas';
      apparentMatrixDensityInto(rhob, phit, rhomaa, s.params.rhoFl, s.start, s.end);
      for (let i = s.start; i < s.end; i++) clean[i] = !vsh || vsh[i]! <= s.params.vshMax ? 1 : 0;
      if (phid && sameAsDensity(phit, phid, s.start, s.end)) {
        warn(`${where} la porosidad total sale solo de la densidad: ρmaa repite la densidad de matriz elegida. Usá densidad–neutrón en la porosidad total para que ρmaa informe la matriz.`);
      }
    }
    if (!vsh) warn('No hay volumen de arcilla: el valor por zona de ρmaa usa todas las muestras, también las arcillosas.');

    const include = (i: number) => clean[i] === 1;
    const stats = summarizeByRanges(rhomaa, zones, include);
    const rows = zones.map((z, k) => rowOf(z.id, z.name, stats[k]!));
    rows.push(rowOf(WHOLE_WELL_ROW, 'Pozo completo', summarizeValues(rhomaa, 0, n, include)));
    const perZone: ZoneScalarValue = {};
    zones.forEach((z, k) => (perZone[z.id] = stats[k]!.median));
    return { rhomaa, byZone: { rows }, perZone };
  },
  docs: {
    summary:
      'Densidad de matriz aparente: la densidad de matriz que haría que la porosidad por densidad coincidiera con la porosidad total de densidad–neutrón (independiente de la matriz supuesta). En areniscas limpias y acuíferas ronda 2,65 g/cm³ (cuarzo), en calizas 2,71 y en dolomías 2,87; valores menores señalan gas o hidrocarburo liviano, carbón o un fluido supuesto demasiado denso, y mayores, minerales pesados (pirita, anhidrita). El valor por zona es la mediana de las muestras limpias (Vsh hasta el máximo elegido), con P10 y P90 de la distribución. Se compara con la densidad de grano de los plugs y con la densidad de matriz que iguala la porosidad densidad con la de corona en el panel Calibración, que también calibra los exponentes de Archie: m con el factor de formación y n con el índice de resistividad de los plugs.',
    equations: [
      { latex: '\\rho_{maa} = \\frac{\\rho_b - \\phi_t\\,\\rho_f}{1 - \\phi_t}', description: 'Densidad de matriz aparente (g/cm³) con la porosidad total φt de densidad–neutrón; sin dato si φt < 0 o φt ≥ 1.' },
      { latex: '\\rho_{ma} = \\rho_f + \\frac{\\sum d_i^2}{\\sum d_i\\,(1 - \\phi_{c,i})},\\quad d_i = \\rho_{b,i} - \\rho_f', description: 'Densidad de matriz que iguala, en mínimos cuadrados, la porosidad densidad con la porosidad de corona φc de los plugs (solución cerrada).' },
      { latex: '\\text{sesgo} = \\overline{\\phi_{perfil} - \\phi_{corona}},\\quad RMSE = \\sqrt{\\overline{(\\phi_{perfil} - \\phi_{corona})^2}}', description: 'Calibración de la porosidad del perfil contra la de los plugs, con el perfil promediado en una ventana ±h alrededor de cada plug.' },
      { latex: 'b_1^{RMA} = \\operatorname{signo}(s_{xy})\\sqrt{s_{yy}/s_{xx}},\\quad b_1^{OLS} = s_{xy}/s_{xx}', description: 'Rectas de calibración corona = b0 + b1·perfil: eje mayor reducido (ambas variables con error) y mínimos cuadrados ordinarios.' },
      { latex: 'F = \\frac{a}{\\phi^m} \\;\\Rightarrow\\; \\ln F = \\ln a - m\\ln\\phi', description: 'Exponente de cementación desde el factor de formación de los plugs, con a fija (regresión por el origen) o libre.' },
      { latex: 'm = \\frac{\\ln(a\\,R_w/R_t)}{\\ln\\phi}', description: 'Exponente de cementación por muestra en una zona acuífera (Sw = 1, Rt = Ro); se usa la mediana.' },
      { latex: 'RI = \\frac{R_t}{R_o} = S_w^{-n} \\;\\Rightarrow\\; n = -\\frac{\\sum \\ln S_{w,i}\\,\\ln RI_i}{\\sum (\\ln S_{w,i})^2}', description: 'Exponente de saturación desde el ensayo de índice de resistividad de los plugs: recta por el origen (RI = 1 en Sw = 1) en log RI – log Sw; también se informa la recta con ordenada libre.' },
      { latex: 'n = -\\frac{\\ln RI}{\\ln S_w}', description: 'Exponente de saturación puntual de un plug (un paso de desaturación con Sw < 1).' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16, caps. 4 y 5.',
      'Clavier, C. y Rust, D.H. (1976). MID plot: a new lithology technique. The Log Analyst 17(6).',
      'Bateman, R.M. (1985). Openhole Log Analysis and Formation Evaluation. IHRDC.',
      'Archie, G.E. (1942). The electrical resistivity log as an aid in determining some reservoir characteristics. Trans. AIME 146.',
      'Warton, D.I., Wright, I.J., Falster, D.S. y Westoby, M. (2006). Bivariate line-fitting methods for allometry. Biological Reviews 81(2).',
    ],
  },
});
