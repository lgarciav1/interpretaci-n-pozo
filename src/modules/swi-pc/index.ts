/**
 * Módulo de saturación de agua irreducible (Swi) desde datos SCAL de presión capilar (tarea 8 de la consigna del TP;
 * docs/decisiones/0055-swi-desde-scal.md). Definición PURA (la ejecuta el Web Worker).
 *
 * Calcula una curva SWI en el pozo con la ley de potencia de la cátedra, Swi = A·(√(k/φ))^B/100 (k en mD, φ en %),
 * con los seis niveles de presión capilar de la planilla o con (A, B) manuales, y la compara con la Sw calculada:
 * bandera SW_LT_SWI donde Sw < Swi − tolerancia y tabla por zona. NO ajusta coeficientes desde curvas de presión
 * capilar propias: los (A, B) son dato de la cátedra (ajuste y análisis puros en `src/petro/swiPc.ts`).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import {
  SWI_CATEDRA_LEVELS,
  SWI_SCAL_ROOT_RANGE,
  SW_BELOW_SWI_TOLERANCE,
  rootKOverPhi,
  swBelowSwiFlag,
  swiPowerLaw,
  swiPowerLawRaw,
  swiPresetById,
} from '../../petro/swiPc';

export const SWI_PC_ID = 'swi-pc';
/** Tabla por zona (no cambiar: la leen los tests y puede leerla el sumario). */
export const SWI_ZONES = 'SWI_ZONES';
/** Valor del enum de nivel para los coeficientes manuales. */
export const SWI_MANUAL_LEVEL = 'manual';

interface Coefficients {
  A: number;
  B: number;
  label: string;
  /** Solo los coeficientes de la cátedra están respaldados por un rango de √(k/φ). */
  hasRange: boolean;
}

function coefficientsOf(level: string, manualA: number, manualB: number): Coefficients | null {
  const preset = swiPresetById(level);
  if (preset) return { A: preset.A, B: preset.B, label: preset.label, hasRange: true };
  if (level === SWI_MANUAL_LEVEL && manualA > 0 && Number.isFinite(manualA) && Number.isFinite(manualB)) {
    return { A: manualA, B: manualB, label: 'Manual', hasRange: false };
  }
  return null;
}

export default defineModule({
  id: SWI_PC_ID,
  name: 'Swi desde presión capilar (SCAL)',
  description:
    'Saturación de agua irreducible por ley de potencia en √(k/φ) con los niveles de presión capilar de la cátedra, comparada con la Sw calculada.',
  category: 'saturation',
  workspace: 'petrophysics',
  roles: [
    {
      id: 'SWI',
      label: 'Saturación de agua irreducible (Swi)',
      unit: 'v/v',
      family: 'saturation',
      origin: 'computed',
      description: 'Swi por ley de potencia en √(k/φ) con coeficientes de presión capilar (SCAL).',
      display: { color: '#7e22ce', scale: 'linear', min: 0, max: 1, reversed: true },
    },
    {
      id: 'SW_LT_SWI',
      label: 'Bandera Sw por debajo de Swi',
      unit: 'unitless',
      family: 'flag',
      origin: 'computed',
      description: 'Sw menor que Swi menos la tolerancia: físicamente sospechoso.',
      display: { color: '#be123c', scale: 'linear', min: 0, max: 1 },
    },
  ],
  inputs: {
    k: input.curve('PERM'),
    phi: input.curve('PHIE'),
    sw: input.optionalCurve('SW'),
  },
  params: {
    level: param.enum({
      label: 'Nivel de presión capilar',
      tooltip:
        'Cada nivel es una presión capilar de la hoja SCAL de la cátedra, del 1 (menor presión capilar, mayor Swi) al 6 (mayor presión capilar, menor Swi). La presión mercurio–aire de cada nivel sale de las curvas de inyección de mercurio de las muestras. «Manual» usa los coeficientes A y B de abajo.',
      options: [...SWI_CATEDRA_LEVELS.map((p) => ({ value: p.id, label: p.label })), { value: SWI_MANUAL_LEVEL, label: 'Manual' }],
      default: 'level6',
      scope: 'zone',
      group: 'Coeficientes',
    }),
    manualA: param.number({
      label: 'Coeficiente A (manual)',
      tooltip:
        'Solo con el nivel «Manual». Es el Swi, en %, de una roca con √(k/φ) igual a 1 (k en mD, φ en %). A mayor A, mayor Swi.',
      default: 15,
      min: 0.1,
      max: 100,
      step: 0.01,
      scope: 'zone',
      group: 'Coeficientes',
    }),
    manualB: param.number({
      label: 'Exponente B (manual)',
      tooltip: 'Solo con el nivel «Manual». Negativo: la saturación irreducible baja al mejorar la calidad de la roca (en la cátedra, de −0,33 a −0,58).',
      default: -0.4,
      min: -2,
      max: 0,
      step: 0.001,
      scope: 'zone',
      group: 'Coeficientes',
    }),
    tolerance: param.number({
      label: 'Tolerancia de la bandera',
      tooltip:
        'Se marca Sw < Swi solo si Sw queda por debajo de Swi menos esta tolerancia: del orden de la incertidumbre de Sw. 0 marca cualquier Sw menor que Swi.',
      default: SW_BELOW_SWI_TOLERANCE,
      min: 0,
      max: 0.2,
      step: 0.005,
      unit: 'v/v',
      scope: 'zone',
      group: 'Comparación con Sw',
    }),
  },
  outputs: {
    swi: output.curve('SWI'),
    flag: output.curve('SW_LT_SWI'),
    byZone: output.table(SWI_ZONES, {
      label: 'Swi y comparación con Sw por zona',
      columns: [
        { key: 'zoneId', label: 'Id de zona', kind: 'text' },
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'level', label: 'Nivel', kind: 'text' },
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'nSwi', label: 'Muestras con Swi' },
        { key: 'swiMean', label: 'Swi medio', unit: 'v/v' },
        { key: 'swMean', label: 'Sw medio', unit: 'v/v' },
        { key: 'nBoth', label: 'Muestras con Sw y Swi' },
        { key: 'pctBelow', label: 'Sw < Swi', unit: '%' },
        { key: 'pctOutRange', label: 'Fuera del rango SCAL', unit: '%' },
      ],
    }),
  },
  compute({ n, inputs, segments, zones, paramsFor, warn }) {
    const { k, phi, sw } = inputs;
    const swi = new Float64Array(n).fill(NaN);
    const flag = new Float64Array(n).fill(NaN);

    const intervals =
      zones.length > 0
        ? zones.map((z) => ({ id: z.id as string | null, name: z.name, start: z.start, end: z.end }))
        : [{ id: null as string | null, name: 'Pozo completo', start: 0, end: n }];
    const whereOf = (name: string) => (zones.length > 0 ? `En la zona ${name}` : 'En el pozo');

    // Curvas: por tramo con los parámetros efectivos de su zona (también fuera de las zonas).
    for (const s of segments) {
      const coef = coefficientsOf(s.params.level, s.params.manualA, s.params.manualB);
      if (!coef) continue; // A ≤ 0 o B no finito: sin dato (se avisa más abajo, por zona)
      for (let i = s.start; i < s.end; i++) {
        swi[i] = swiPowerLaw(rootKOverPhi(k[i]!, phi[i]!), coef.A, coef.B);
        if (sw) flag[i] = swBelowSwiFlag(sw[i]!, swi[i]!, s.params.tolerance);
      }
    }
    if (!sw) warn('Sin curva Sw: se calcula Swi pero no la bandera ni la comparación con la saturación de agua.');

    // Tabla por zona (o del pozo completo) y avisos.
    const rows: Record<string, TableCell>[] = [];
    for (const iv of intervals) {
      const p = paramsFor(iv.id);
      const coef = coefficientsOf(p.level, p.manualA, p.manualB);
      if (!coef) {
        warn(`${whereOf(iv.name)} los coeficientes manuales no son válidos (A debe ser positivo y B finito): no hay Swi.`, { zoneId: iv.id ?? undefined });
        rows.push({ zoneId: iv.id ?? '', zone: iv.name, level: 'Manual (inválido)', a: null, b: null, nSwi: 0, swiMean: null, swMean: null, nBoth: 0, pctBelow: null, pctOutRange: null });
        continue;
      }
      let nSwi = 0;
      let sumSwi = 0;
      let nBoth = 0;
      let sumSw = 0;
      let nBelow = 0;
      let nOut = 0;
      let nClipped = 0;
      for (let i = iv.start; i < iv.end; i++) {
        const x = rootKOverPhi(k[i]!, phi[i]!);
        if (!Number.isFinite(swi[i]!)) continue;
        nSwi++;
        sumSwi += swi[i]!;
        if (swiPowerLawRaw(x, coef.A, coef.B) > 1) nClipped++;
        if (coef.hasRange && (x < SWI_SCAL_ROOT_RANGE.min || x > SWI_SCAL_ROOT_RANGE.max)) nOut++;
        if (flag[i]! === flag[i]!) {
          nBoth++;
          sumSw += sw![i]!;
          nBelow += flag[i]!;
        }
      }
      if (nClipped > 0) {
        warn(`${whereOf(iv.name)} ${nClipped} muestras de roca muy cerrada dan Swi mayor que 1 y se recortan a 1.`, { zoneId: iv.id ?? undefined });
      }
      rows.push({
        zoneId: iv.id ?? '',
        zone: iv.name,
        level: coef.label,
        a: coef.A,
        b: coef.B,
        nSwi,
        swiMean: nSwi > 0 ? sumSwi / nSwi : null,
        swMean: nBoth > 0 ? sumSw / nBoth : null,
        nBoth,
        pctBelow: nBoth > 0 ? (100 * nBelow) / nBoth : null,
        pctOutRange: coef.hasRange && nSwi > 0 ? (100 * nOut) / nSwi : null,
      });
    }
    return { swi, flag, byZone: { rows } };
  },
  docs: {
    summary:
      'Saturación de agua irreducible a partir de datos SCAL de presión capilar: ley de potencia en √(k/φ) (k en mD, φ en %), un par (A, B) por nivel de presión capilar. Los seis niveles de la cátedra van del 1 (menor presión capilar, mayor Swi) al 6 (mayor presión capilar, menor Swi); también se pueden dar A y B a mano. La curva SWI se compara con la Sw calculada: la bandera SW_LT_SWI marca donde Sw queda por debajo de Swi menos una tolerancia, y la tabla por zona da Swi medio, Sw medio y el porcentaje de muestras con Sw < Swi. Que el agua calculada esté por debajo de la irreducible es físicamente sospechoso (Sw sobreestimada de hidrocarburo, Rt o porosidad erróneas, roca fuera de la correlación o nivel de presión capilar demasiado bajo para esa altura sobre el agua libre).',
    equations: [
      { latex: 'x = \\sqrt{\\dfrac{k}{\\phi_{\\%}}} = \\sqrt{\\dfrac{k}{100\\,\\phi}}', description: 'Variable de correlación: k en mD y φ en porcentaje (φ en fracción v/v multiplicada por 100), como en la planilla de la cátedra.' },
      { latex: 'S_{wi} = \\dfrac{A\\,x^{B}}{100}', description: 'Swi en fracción (v/v); A y B de cada nivel de presión capilar (Swi% = A·x^B). Se recorta a [0, 1] y no hay dato si k ≤ 0, φ ≤ 0 o φ > 1.' },
      { latex: '\\ln S_{wi} = \\ln\\dfrac{A}{100} + B\\,\\ln x', description: 'Forma lineal para ajustar A y B por regresión log–log si se dispone de Swi y x por muestra.' },
      { latex: 'P_d = c\\,x^{-d}', description: 'Presión de desplazamiento contra √(k/φ) (kg/cm²); regresión log–log análoga, usada para analizar la tabla de desplazamiento.' },
      { latex: 'S_w < S_{wi} - \\varepsilon \\;\\Rightarrow\\; \\text{SW\\_LT\\_SWI} = 1', description: 'Bandera de agua por debajo de la irreducible, con tolerancia ε (v/v).' },
    ],
    references: [
      'Buckles, R.S. (1965). Correlating and averaging connate water saturation data. Journal of Canadian Petroleum Technology 4(1), 42-52.',
      'Planilla de la cátedra, hoja SCAL (TP de Interpretación de Perfiles, FIUBA): coeficientes (A, B) por nivel de presión capilar.',
      'Tiab, D. y Donaldson, E.C. (2015). Petrophysics, 4.ª ed. Gulf Professional Publishing, cap. 8 (presión capilar y saturación irreducible).',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16, cap. 4.',
    ],
    notes:
      'Los coeficientes (A, B) son dato de la cátedra: provienen de las curvas de presión capilar de sus muestras (√(k/φ) de 0,37 a 2,00) y valen en ese rango; fuera de él la ley de potencia es una extrapolación (la tabla informa el porcentaje de muestras fuera de rango). Este módulo no ajusta coeficientes desde curvas de presión capilar propias y la planilla no indica a qué presión ni altura corresponde cada nivel. Se recorta a 1 la Swi de roca muy cerrada. Con φ en fracción de la tabla de presión de desplazamiento, la «raíz» es 10 veces la de esta planilla.',
  },
});
