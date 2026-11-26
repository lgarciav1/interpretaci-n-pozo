/**
 * G07 — Hidrocarburo móvil vs. residual: Sxo, MOS, Shr, MHI y tabla MOVABLE_SUMMARY (docs/decisiones/0091).
 *
 * Conecta RXO (medida o producida por `invasion-step`) con SW y PHIE para separar hidrocarburo desplazado por el
 * filtrado (móvil) del residual. Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import {
  DEFAULT_RMF_OVER_RW,
  emptyMovabilityCounts,
  movabilityInto,
  summarizeMovability,
  type MovabilityCounts,
  type MovabilityMethod,
} from '../../petro/movability';
import { SHARED_PARAMS } from '../sharedParams';

export const MOVABLE_SUMMARY = 'MOVABLE_SUMMARY';

const cell = (x: number): TableCell => (Number.isFinite(x) ? x : null);
const pct = (x: number, total: number): string => `${Math.round((100 * x) / Math.max(total, 1))} %`;

export default defineModule({
  id: 'movable-hc',
  name: 'Hidrocarburo móvil y residual (Sxo · MOS)',
  description:
    'Calcula la saturación de agua en la zona lavada (Sxo), el hidrocarburo móvil (MOS), el residual (Shr) y el índice de movilidad (Sw/Sxo) a partir de Rxo.',
  category: 'saturation',
  workspace: 'petrophysics',
  roles: [
    {
      id: 'MOS',
      label: 'Hidrocarburo móvil (MOS)',
      unit: 'v/v',
      family: 'saturation',
      origin: 'computed',
      display: { color: '#15803d', scale: 'linear', min: 0, max: 1 },
    },
    {
      id: 'SHR',
      label: 'Hidrocarburo residual (Shr)',
      unit: 'v/v',
      family: 'saturation',
      origin: 'computed',
      display: { color: '#b45309', scale: 'linear', min: 0, max: 1 },
    },
    {
      id: 'MHI',
      label: 'Índice de movilidad (Sw/Sxo)',
      unit: 'unitless',
      family: 'saturation',
      origin: 'computed',
      display: { color: '#6d28d9', scale: 'linear', min: 0, max: 1.5 },
    },
  ],
  inputs: {
    sw: input.curve('SW'),
    phi: input.curve('PHIE'),
    rxo: input.curve('RXO'),
    rt: input.optionalCurve('RT'),
    temp: input.optionalCurve('TEMP'),
  },
  params: {
    method: param.enum({
      label: 'Método de Sxo',
      tooltip:
        'Cociente Rt–Rxo estima Sxo sin porosidad a partir de (Rxo/Rt)/(Rmf/Rw) y Sw. Archie en zona lavada usa a, m, n, φe y Rmf.',
      options: [
        { value: 'ratio', label: 'Cociente Rt–Rxo (sin φ)' },
        { value: 'archie', label: 'Archie en zona lavada (Rmf)' },
      ],
      default: 'ratio',
      scope: 'zone',
    }),
    rmfOverRw: param.number({
      label: 'Relación Rmf / Rw',
      tooltip:
        'Cociente empírico (Rxo / Rt) leído en una arena limpia con 100 % de agua. Se usa en el método de cocientes y puede calibrarse arrastrando la recta de agua en el crossplot «Movilidad Rt–Rxo».',
      default: DEFAULT_RMF_OVER_RW,
      min: 0.1,
      max: 200,
      step: 0.01,
      unit: 'unitless',
      scale: 'log',
      scope: 'zone',
    }),
    rmf: SHARED_PARAMS.rmf,
    tRmf: SHARED_PARAMS.tRmf,
    correctRmfTemp: param.boolean({
      label: 'Corregir Rmf por temperatura',
      tooltip:
        'En modo Archie, lleva Rmf desde su temperatura de medición hasta la temperatura de formación de cada muestra con Arps.',
      default: true,
      scope: 'zone',
    }),
    a: SHARED_PARAMS.a,
    m: SHARED_PARAMS.m,
    n: SHARED_PARAMS.n,
  },
  outputs: {
    sxo: output.curve('SXO'),
    mos: output.curve('MOS'),
    shr: output.curve('SHR'),
    mhi: output.curve('MHI'),
    summary: output.table(MOVABLE_SUMMARY, {
      label: 'Resumen de hidrocarburo móvil y residual por zona',
      columns: [
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'resolvedPct', label: 'Invasión resuelta', unit: '%' },
        { key: 'swMean', label: 'Sw medio', unit: 'v/v' },
        { key: 'sxoMean', label: 'Sxo medio', unit: 'v/v' },
        { key: 'mosMean', label: 'MOS medio', unit: 'v/v' },
        { key: 'shrMean', label: 'Shr medio', unit: 'v/v' },
        { key: 'movableHcFrac', label: 'HC móvil / Sh', unit: 'v/v' },
        { key: 'mhiMean', label: 'MHI (Sw/Sxo)', unit: 'unitless' },
        { key: 'resolvedSamples', label: 'Muestras resueltas' },
      ],
    }),
  },
  compute({ n, thickness, inputs, segments, zones, warn }) {
    const sxo = new Float64Array(n).fill(NaN);
    const mos = new Float64Array(n).fill(NaN);
    const shr = new Float64Array(n).fill(NaN);
    const mhi = new Float64Array(n).fill(NaN);

    const byZone = new Map<string, MovabilityCounts>();
    const noZone = '';
    let warnedMissingRt = false;
    let warnedMissingTemp = false;

    for (const s of segments) {
      const method = s.params.method as MovabilityMethod;
      if (method === 'ratio' && !inputs.rt && !warnedMissingRt) {
        warnedMissingRt = true;
        warn(
          'El método de cocientes Rt–Rxo necesita la curva RT: las salidas de movilidad quedan sin dato (cambiá a «Archie en zona lavada» si conocés Rmf).',
        );
      }
      if (method === 'archie' && s.params.correctRmfTemp && !inputs.temp && !warnedMissingTemp) {
        warnedMissingTemp = true;
        warn('Sin curva de temperatura (TEMP): en modo Archie, Rmf se usa sin corrección por temperatura.');
      }
      const counts = movabilityInto(
        {
          sw: inputs.sw,
          phi: inputs.phi,
          rxo: inputs.rxo,
          ...(inputs.rt ? { rt: inputs.rt } : {}),
          ...(inputs.temp ? { temp: inputs.temp } : {}),
        },
        { sxo, mos, shr, mhi },
        {
          method,
          rmfOverRw: s.params.rmfOverRw,
          rmf: s.params.rmf,
          tRmf: s.params.tRmf,
          correctRmfTemp: s.params.correctRmfTemp,
          a: s.params.a,
          m: s.params.m,
          n: s.params.n,
        },
        s.start,
        s.end,
      );
      const key = s.zoneId ?? noZone;
      const acc = byZone.get(key) ?? emptyMovabilityCounts();
      acc.total += counts.total;
      acc.resolved += counts.resolved;
      acc.belowSw += counts.belowSw;
      acc.clippedHigh += counts.clippedHigh;
      acc.missingRxo += counts.missingRxo;
      acc.missingInputs += counts.missingInputs;
      byZone.set(key, acc);
    }

    let totalResolved = 0;
    let totalSamples = 0;
    let totalMissingRxo = 0;
    for (const [key, c] of byZone) {
      totalResolved += c.resolved;
      totalSamples += c.total;
      totalMissingRxo += c.missingRxo;
      if (c.belowSw > 0 && c.resolved > 0) {
        const where = key === noZone ? 'Fuera de las zonas' : `En la zona ${zones.find((z) => z.id === key)?.name ?? key}`;
        warn(
          `${where}, ${pct(c.belowSw, c.resolved)} de las muestras resueltas (${c.belowSw} de ${c.resolved}) dio Sxo sin recortar menor que Sw: se recortó Sxo = Sw y MOS = 0. Revisá Rmf/Rw, Rmf o si el lodo es base aceite.`,
          { zoneId: key || undefined },
        );
      }
    }
    if (n > 0 && totalResolved === 0 && !warnedMissingRt) {
      if (totalMissingRxo >= totalSamples) {
        warn('Ninguna muestra tiene Rxo válido para evaluar movilidad: Sxo, MOS, Shr y MHI quedan sin dato.');
      } else {
        warn(
          'Hay lecturas válidas de Rxo pero faltan otras entradas válidas (Sw, Rt, φe o TEMP según el método) en esas muestras: Sxo, MOS, Shr y MHI quedan sin dato.',
        );
      }
    }

    const summaryInput = {
      rxo: inputs.rxo,
      sw: inputs.sw,
      sxo,
      mos,
      shr,
      mhi,
      phi: inputs.phi,
      thickness,
    };
    const toRow = (zoneId: string | null, label: string, start: number, end: number): Record<string, TableCell> => {
      const st = summarizeMovability(summaryInput, start, end);
      return {
        zoneId,
        zone: label,
        resolvedPct: cell(st.resolvedPct),
        swMean: cell(st.swMean),
        sxoMean: cell(st.sxoMean),
        mosMean: cell(st.mosMean),
        shrMean: cell(st.shrMean),
        movableHcFrac: cell(st.movableHcFraction),
        mhiMean: cell(st.mhiMean),
        resolvedSamples: st.resolvedSamples,
        totalSamples: st.totalSamples,
        movableSamplesPct: cell(st.movableSamplesPct),
      };
    };

    const rows: Record<string, TableCell>[] = [toRow(null, 'Pozo', 0, n)];
    for (const z of zones) {
      rows.push(toRow(z.id, z.name, z.start, z.end));
    }

    return { sxo, mos, shr, mhi, summary: { rows } };
  },
  docs: {
    summary:
      'Evalúa la movilidad del hidrocarburo comparando la saturación de la zona virgen (Sw) con la de la zona lavada (Sxo). El filtrado acuoso desplaza la fracción móvil (MOS = Sxo − Sw) y deja la fracción residual (Shr = 1 − Sxo). Soporta el método de cocientes Rt–Rxo (independiente de la porosidad) y Archie en zona lavada.',
    equations: [
      {
        latex: '\\frac{S_w}{S_{xo}} = \\left(\\frac{R_{xo} / R_t}{R_{mf} / R_w}\\right)^{1/n}, \\qquad S_{xo} = \\operatorname{clip}_{[S_w,\\,1]}\\!\\left(\\frac{S_w}{\\bigl((R_{xo}/R_t)/(R_{mf}/R_w)\\bigr)^{1/n}}\\right)',
        description: 'Método de cocientes (ratio, sin porosidad): Rmf/Rw es la pendiente (Rxo/Rt) en arena limpia con agua.',
      },
      {
        latex: 'S_{xo} = \\operatorname{clip}_{[S_w,\\,1]}\\!\\left(\\left(\\frac{a\\,R_{mf}(T)}{\\phi_e^{m}\\,R_{xo}}\\right)^{1/n}\\right)',
        description: 'Archie en zona lavada: Rmf(T) llevada a temperatura de formación con Arps.',
      },
      {
        latex: '\\text{MOS} = \\max(0,\\; S_{xo} - S_w), \\qquad S_{hr} = 1 - S_{xo}, \\qquad \\text{MHI} = \\frac{S_w}{S_{xo}}',
        description: 'Hidrocarburo móvil, residual e índice de movilidad (< 0,7 indica hidrocarburo móvil típico en areniscas).',
      },
      {
        latex: 'f_{\\text{móvil}} = \\frac{\\sum h_i\\,\\phi_{e,i}\\,\\text{MOS}_i}{\\sum h_i\\,\\phi_{e,i}\\,(1 - S_{w,i})} = \\frac{\\overline{\\text{MOS}}}{1 - \\overline{S_w}}',
        description: 'Fracción móvil del hidrocarburo por zona, ponderada por volumen poral sobre muestras con invasión resuelta.',
      },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16, cap. 6 (Ratio Method, Sxo, MOS e índice Sw/Sxo).',
      'Schlumberger (1989). Log Interpretation Principles/Applications, cap. 8 (zona lavada y movilidad de hidrocarburos).',
      'Archie, G. E. (1942). The electrical resistivity log as an aid in determining some reservoir characteristics. Trans. AIME 146.',
    ],
    notes:
      'Cuando el filtrado acuoso desplaza hidrocarburo se cumple Sxo ∈ [Sw, 1], garantizando MOS + Shr = 1 − Sw en el espacio poral y en la columna volumétrica. Si el valor sin recortar cae por debajo de Sw (lodo base aceite, invasión invertida o Rmf/Rw mal calibrado), el módulo recorta Sxo = Sw (MOS = 0) y emite un aviso por zona. En muestras donde Rxo es NaN (sin invasión resuelta), las salidas quedan sin dato y la columna volumétrica dibuja el hidrocarburo entero sin huecos falsos (ADR 0091).',
  },
});
