/** Geo-3: inversión mineral restringida; definición pura que publica volúmenes bulk independientes. */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { prepareMineralInversion } from '../../petro/mineralogy';

export const MINERAL_ZONES = 'MINERAL_ZONES';
export const VOLUME_ROLES = ['V_QUARTZ', 'V_CALCITE', 'V_DOLOMITE', 'V_CLAY', 'PHI_MINERAL'] as const;
export const VOLUME_LABELS = ['Cuarzo', 'Calcita', 'Dolomita', 'Arcilla', 'Porosidad mineral'] as const;
export const VOLUME_COLORS = ['#d8b962', '#52a2cd', '#ab79c5', '#8b775c', '#70b7b1'] as const;
const cell = (x: number): TableCell => Number.isFinite(x) ? x : null;
const weight = (label: string) => param.number({ label, default: 1, min: 0.1, max: 5, step: 0.1, group: 'Pesos por herramienta', scope: 'zone', tooltip: 'Peso relativo tras normalizar la respuesta. Se requieren las cuatro herramientas para resolver los cinco componentes con cierre.' });

export default defineModule({
  id: 'mineral-inversion', name: 'Mineralogía · PE–densidad',
  description: 'Volúmenes de cuarzo, calcita, dolomita, arcilla y porosidad con cierre, no negatividad y residuo de ajuste.',
  category: 'geology', workspace: 'geology',
  roles: [
    ...VOLUME_ROLES.map((id, i) => ({ id, label: VOLUME_LABELS[i], unit: 'v/v', family: 'lithology' as const, origin: 'computed' as const, display: { color: VOLUME_COLORS[i], scale: 'linear' as const, min: 0, max: 1 } })),
    { id: 'MIN_RESIDUAL', label: 'Residuo mineral normalizado', unit: 'unitless', family: 'other', origin: 'computed', display: { color: '#bd5b55', scale: 'linear', min: 0, max: 5 } },
  ],
  inputs: { rho: input.curve('RHOB'), pe: input.curve('PEF'), nphi: input.curve('NPHI'), gr: input.curve('GR') },
  params: {
    rhoWeight: weight('Peso de densidad'), uWeight: weight('Peso fotoeléctrico'), nphiWeight: weight('Peso de neutrón'), grWeight: weight('Peso de GR'),
    // Umbral práctico del residuo normalizado; no tolerancia de fabricante.
    residualLimit: param.number({ label: 'Avisar sobre residuo', default: 2, min: 0.1, max: 20, step: 0.1, group: 'Calidad del ajuste', scope: 'zone' }),
    clay: param.enum({ label: 'Extremo de arcilla', default: 'illite', options: [{ value: 'illite', label: 'Illita' }, { value: 'kaolinite', label: 'Caolinita' }, { value: 'chlorite', label: 'Clorita' }, { value: 'smectite', label: 'Esmectita' }], group: 'Hipótesis', scope: 'zone' }),
    // Schlumberger, Log Interpretation Charts, 2013, apéndice B, p. 280: illita 250–300 gAPI; centro ajustable.
    clayGr: param.number({ label: 'GR del extremo arcilloso', default: 275, min: 1, max: 350, step: 1, unit: 'gAPI', group: 'Hipótesis', scope: 'zone' }),
    cleanGr: param.number({ label: 'GR de matriz limpia', default: 0, min: 0, max: 100, step: 1, unit: 'gAPI', group: 'Hipótesis', scope: 'zone' }),
    fluidRho: param.number({ label: 'Densidad del fluido', default: 1, min: 0.1, max: 1.3, step: 0.01, unit: 'g/cm3', group: 'Hipótesis', scope: 'zone' }),
    // Schlumberger, Log Interpretation Charts, 2013, apéndice B, p. 280: agua dulce.
    fluidPe: param.number({ label: 'PE del fluido', default: 0.36, min: 0, max: 2, step: 0.01, unit: 'b/e', group: 'Hipótesis', scope: 'zone' }),
  },
  outputs: {
    quartz: output.curve('V_QUARTZ'), calcite: output.curve('V_CALCITE'), dolomite: output.curve('V_DOLOMITE'), clay: output.curve('V_CLAY'), phi: output.curve('PHI_MINERAL'), residual: output.curve('MIN_RESIDUAL'),
    zones: output.table(MINERAL_ZONES, { label: 'Volúmenes minerales medios por zona', hidden: true, columns: [
      { key: 'zone', label: 'Zona', kind: 'text' }, { key: 'samples', label: 'Muestras válidas' },
      ...VOLUME_ROLES.map((key,i) => ({ key, label: VOLUME_LABELS[i], unit: 'v/v' })), { key: 'residual', label: 'Residuo medio' },
    ] }),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const curves = VOLUME_ROLES.map(() => new Float64Array(n).fill(NaN));
    const residual = new Float64Array(n).fill(NaN);
    let fitted = 0, highResidual = 0, invalidNeutron = 0;
    for (const s of segments) {
      const p = s.params;
      if (p.clayGr <= p.cleanGr) warn('El GR arcilloso debe superar al GR limpio; revisá los extremos de la inversión.');
      const invert = prepareMineralInversion({ weights: { rho: p.rhoWeight, u: p.uWeight, nphi: p.nphiWeight, gr: p.grWeight }, clay: p.clay, clayGr: p.clayGr, cleanGr: p.cleanGr, fluidRho: p.fluidRho, fluidPe: p.fluidPe });
      for (let i = s.start; i < s.end; i++) {
        const r = invert({ rho: inputs.rho[i], pe: inputs.pe[i], nphi: inputs.nphi[i], gr: inputs.gr[i] });
        if (!r.valid) continue;
        for (let j = 0; j < curves.length; j++) curves[j][i] = r.volumes[j];
        residual[i] = r.residual;
        fitted++; if (r.residual > p.residualLimit) highResidual++;
        if (inputs.nphi[i] > 1 || inputs.nphi[i] < -0.15) invalidNeutron++;
      }
    }
    const rows = zones.map(z => {
      const sums = new Array<number>(5).fill(0); let count = 0, rsum = 0;
      for (let i = z.start; i < z.end; i++) if (Number.isFinite(residual[i])) { count++; rsum += residual[i]; curves.forEach((c,j) => sums[j] += c[i]); }
      const row: Record<string, TableCell> = { zoneId: z.id, zone: z.name, samples: count, residual: cell(count ? rsum/count : NaN) };
      VOLUME_ROLES.forEach((role,j) => row[role] = cell(count ? sums[j]/count : NaN));
      return row;
    });
    if (highResidual) warn(`${highResidual} de ${fitted} muestras superan el residuo configurado: el modelo mineral no reproduce las herramientas; los volúmenes requieren revisión.`);
    if (invalidNeutron) warn(`${invalidNeutron} muestras tienen neutrón fuera del rango físico operativo; comprobá unidades y control de calidad.`);
    warn('Neutrón supuesto en escala CNL caliza; verificá la calibración del registro importado.');
    warn('La inversión supone fluido acuoso y extremos minerales configurables. Revisá gas, barita, lavado y el residuo antes de interpretar; algunas respuestas están SIN VERIFICAR.');
    return { quartz: curves[0], calcite: curves[1], dolomite: curves[2], clay: curves[3], phi: curves[4], residual, zones: { rows } };
  },
  docs: {
    summary: 'Minimiza el residuo ponderado de densidad, absorción fotoeléctrica volumétrica, neutrón y GR sobre el simplex de cinco componentes. Publica volúmenes bulk; porosidad y arcilla no sustituyen las fuentes de PHIE o VSH. La matriz representa respuestas de herramientas y requiere calibración de extremos con corona.',
    equations: [{ latex: '\\min_{v\\ge0,\\,\\sum v=1}\\sum_j w_j[(A_jv-b_j)/s_j]^2', description: 'Mínimos cuadrados con no negatividad, cierre y escalas de normalización por herramienta.' }, { latex: 'U=PE\\,\\rho_e', description: 'Absorción volumétrica; la densidad electrónica se deriva de la densidad bulk mediante la aproximación documentada en el motor.' }],
    references: ['Lawson y Hanson (1974), Solving Least Squares Problems, capítulo 23.', 'Schlumberger, Log Interpretation Charts, cartas de densidad y fotoeléctrico: ver fuentes y SIN VERIFICAR en mineralogy.ts.'],
    notes: 'Las respuestas neutrónicas corresponden a la escala de caliza. Un residuo bajo no garantiza unicidad geológica. Los pesos no son incertidumbres estadísticas calibradas; el valor de GR de arcilla y el fluido son hipótesis del intérprete.',
  },
});
