/**
 * Módulo de capas de pay y punzados sugeridos (F04): tramos continuos de pay neto con espesor mínimo y tolerancia a
 * intercalaciones finas, ordenados por capacidad de flujo (k·h; sin permeabilidad, por h·φ).
 * Consume NET_PAY (cutoffs), φ, Sw y, opcional, k; publica la tabla PAY_INTERVALS (sin total: el orden es global).
 * Zonas: un tramo nunca cruza el límite de una zona. Los sellos se tratan como en el sumario por zona (zone-summary):
 * entran con su pay si los cutoffs lo marcan, de modo que Σ net de la tabla (con espesor mínimo 0) es NET_PAY_TOTAL. Sin
 * zonas, un único rango con el pozo completo. Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import { payIntervals, type PayOptions } from '../../petro/payIntervals';

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

export default defineModule({
  id: 'pay-intervals',
  name: 'Capas de pay y punzados',
  description: 'Tramos continuos de pay neto con espesor mínimo y tolerancia a intercalaciones finas, con φ, Sw, k·h y orden por capacidad de flujo, para elegir los intervalos a punzar.',
  category: 'summary',
  workspace: 'petrophysics',
  inputs: {
    netPay: input.curve('NET_PAY'),
    phi: input.curve('PHIE'),
    sw: input.curve('SW'),
    k: input.optionalCurve('PERM'),
  },
  params: {
    minThickness: param.number({
      label: 'Espesor mínimo de capa',
      tooltip: 'Se descartan los tramos cuyo pay neto (ya unidas las intercalaciones) sea menor que este espesor.',
      default: 1,
      min: 0,
      max: 20,
      step: 0.1,
      unit: 'm',
      scope: 'zone',
    }),
    maxGap: param.number({
      label: 'Tolerancia a intercalaciones',
      tooltip: 'Una intercalación de no pay (o sin dato) de hasta este espesor entre dos tramos de pay los une en uno solo. 0 = no se une nada.',
      default: 0.3,
      min: 0,
      max: 5,
      step: 0.1,
      unit: 'm',
      scope: 'zone',
    }),
  },
  outputs: {
    intervals: output.table('PAY_INTERVALS', {
      label: 'Capas de pay y punzados sugeridos',
      columns: [
        { key: 'rank', label: 'Orden' },
        { key: 'zoneId', label: 'Id de zona', kind: 'text' },
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'top', label: 'Tope', unit: 'm' },
        { key: 'base', label: 'Base', unit: 'm' },
        { key: 'gross', label: 'Bruto', unit: 'm' },
        { key: 'net', label: 'Espesor (pay neto)', unit: 'm' },
        { key: 'gaps', label: 'Intercalaciones' },
        { key: 'phi', label: 'φ', unit: 'v/v' },
        { key: 'sw', label: 'Sw', unit: 'v/v' },
        { key: 'k', label: 'k', unit: 'mD' },
        { key: 'kh', label: 'k·h (mD·m)', unit: 'unitless' },
        { key: 'hphi', label: 'h·φ', unit: 'm' },
        { key: 'hphiSh', label: 'h·φ·Sh', unit: 'm' },
        { key: 'khPct', label: 'k·h del total', unit: '%' },
      ],
    }),
  },
  compute({ n, inputs, depth, thickness, zones, paramsFor, warn }) {
    const intervals =
      zones.length > 0
        ? zones.map((z) => ({ id: z.id, name: z.name, start: z.start, end: z.end }))
        : [{ id: '', name: 'Pozo completo', start: 0, end: n }];
    const opts: PayOptions[] = intervals.map((iv) => {
      const p = paramsFor(zones.length > 0 ? iv.id : null);
      return { minThickness: p.minThickness, maxGap: p.maxGap };
    });

    const samples = { depth, thickness, netPay: inputs.netPay, phi: inputs.phi, sw: inputs.sw, perm: inputs.k };
    const { intervals: list, discarded } = payIntervals(samples, intervals, opts);

    const hasPerm = inputs.k !== undefined;
    if (!hasPerm) {
      warn('Falta la curva PERM: los tramos se ordenan por h·φ y no hay k·h.');
    }
    if (list.length === 0) {
      warn(
        discarded.count > 0
          ? `Ningún tramo de pay alcanza el espesor mínimo (${discarded.count} descartados, ${discarded.net.toFixed(2)} m de pay en total): bajá el espesor mínimo o subí la tolerancia a intercalaciones.`
          : 'No hay pay para armar tramos: revisá los cutoffs (NET_PAY sin ninguna muestra neta).',
      );
    }

    // Participación en el k·h de los tramos listados (suma 100 %); sin k no hay k·h.
    const khTotal = hasPerm ? list.reduce((s, t) => s + (Number.isFinite(t.kh) ? t.kh : 0), 0) : NaN;
    const rows = list.map((t): Record<string, TableCell> => {
      const iv = intervals[t.rangeIndex]!;
      return {
        rank: t.rank,
        zoneId: iv.id,
        zone: iv.name,
        top: num(t.top),
        base: num(t.base),
        gross: num(t.gross),
        net: num(t.net),
        gaps: t.gaps,
        phi: num(t.phi),
        sw: num(t.sw),
        k: num(t.k),
        kh: num(t.kh),
        hphi: num(t.hphi),
        hphiSh: num(t.hphiSh),
        khPct: khTotal > 0 ? num((100 * t.kh) / khTotal) : null,
      };
    });
    return { intervals: { rows } };
  },
  docs: {
    summary:
      'Tramos continuos de pay neto (NET_PAY = 1) listos para elegir los punzados: las intercalaciones finas de no pay se unen según una tolerancia, los tramos con poco pay se descartan según un espesor mínimo y el resultado se ordena por capacidad de flujo k·h (sin permeabilidad, por h·φ). Cada tramo informa tope, base, espesor bruto y neto, porosidad y Sw promedio, k·h y su parte del total.',
    equations: [
      { latex: 'g = \\sum h_i \\ \\ (\\text{muestras no pay entre dos de pay}),\\qquad g \\le g_{max} \\Rightarrow \\text{se unen}', description: 'Intercalación: espesor acumulado de las muestras no pay (0, sin dato) entre dos de pay de la misma zona; si no supera la tolerancia, los dos grupos forman un solo tramo. Con tolerancia 0 no se une nada.' },
      { latex: 'h_{net} = \\sum_{pay} h_i \\qquad h_{bruto} = h_{net} + \\sum g', description: 'Espesor neto (solo muestras de pay; es el «espesor» de la tabla) y bruto (con las intercalaciones unidas).' },
      { latex: 'h_{net} \\ge h_{min}', description: 'Un tramo se conserva si, ya unido, su pay neto alcanza el espesor mínimo.' },
      { latex: '\\bar\\phi = \\frac{\\sum h_i\\,\\phi_i}{\\sum h_i} \\qquad \\bar S_w = \\frac{\\sum h_i\\,\\phi_i\\,S_{w,i}}{\\sum h_i\\,\\phi_i}', description: 'Porosidad (ponderada por espesor) y Sw (ponderada por volumen poral) sobre las muestras de pay del tramo; las intercalaciones no entran.' },
      { latex: 'kh = \\sum h_i\\,k_i \\qquad h\\phi = \\sum h_i\\,\\phi_i \\qquad h\\phi S_h = \\sum h_i\\,\\phi_i\\,(1 - S_{w,i})', description: 'Capacidad de flujo (mD·m), de almacenaje y de hidrocarburo (m) del tramo.' },
      { latex: '\\%kh_j = 100\\,\\frac{kh_j}{\\sum_m kh_m}', description: 'Parte de cada tramo en el k·h de los tramos listados; el orden es por k·h decreciente.' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
    notes:
      'Un tramo nunca cruza el límite de una zona y nunca empieza ni termina en una intercalación. Las muestras con NET_PAY sin dato cuentan como intercalación, no como pay. El espesor mínimo se aplica después de unir y sobre el pay neto, no sobre el bruto. Con espesor mínimo 0, la suma del espesor neto de los tramos de cada zona es el pay neto del sumario por zona, cualquiera sea la tolerancia; los sellos se tratan igual que en ese sumario. La unión de intercalaciones y el espesor mínimo son criterios de diseño de punzados, no definiciones de la bibliografía. Tope y base son los bordes de la celda de la primera y la última muestra de pay. Sin la curva PERM el orden es por h·φ y no hay k ni k·h. El % k·h es sobre los tramos que se listan (los descartados no cuentan).',
  },
});
