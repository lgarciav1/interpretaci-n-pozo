/**
 * Módulo de sumario por zona — espesores netos, promedios y h·φ·Sh. Ver 0007, C21 y D3/D6.
 * Consume curvas (los promedios ponderados necesitan las muestras) y publica una tabla para leer y valores por zona
 * (neto pay y h·φ·Sh) que consume el volumétrico. Datos faltantes (D6): una zona sin muestras o sin ninguna muestra
 * clasificada (0 o 1) da NaN en los valores por zona, no 0; una zona con reservorio pero sin Sw en todo él también
 * (el pay es «sin dato»). Si solo falta parte del Sw se suma lo conocido y el faltante queda en la columna
 * «Sin dato pay»; si supera el 5 % del neto de reservorio de la zona, se avisa.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell, type ZoneScalarValue } from '../../core/module';
import { summarizeRanges, type IntervalSummary } from '../../petro/summary';
import type { ZoneKind } from '../../core/well';

const KIND_LABEL: Record<ZoneKind, string> = {
  formation: 'Formación',
  reservoir: 'Reservorio',
  seal: 'Sello',
  other: 'Otro',
};

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

/** true si hay al menos una muestra clasificada (NET_RES 0 o 1) en el intervalo. */
const hasClassified = (s: IntervalSummary) => s.gross > 0 && s.noData < s.gross;

/** Fracción del neto de reservorio sin dato de pay (falta Sw) a partir de la cual se avisa. */
const PAY_GAP_WARN = 0.05;

export default defineModule({
  id: 'zone-summary',
  name: 'Sumario por zona',
  description: 'Espesor bruto y neto, relación neto/bruto, porosidad, saturación de agua y arcillosidad promedio por zona y en total.',
  category: 'summary',
  workspace: 'petrophysics',
  inputs: {
    netRes: input.curve('NET_RES'),
    netPay: input.curve('NET_PAY'),
    phi: input.curve('PHIE'),
    sw: input.curve('SW'),
    vsh: input.optionalCurve('VSH'),
    k: input.optionalCurve('PERM'),
  },
  params: {},
  outputs: {
    table: output.table('ZONE_SUMMARY', {
      label: 'Sumario por zona',
      columns: [
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'kind', label: 'Tipo', kind: 'text' },
        { key: 'top', label: 'Tope', unit: 'm' },
        { key: 'base', label: 'Base', unit: 'm' },
        { key: 'gross', label: 'Bruto', unit: 'm' },
        { key: 'netRes', label: 'Neto reservorio', unit: 'm' },
        { key: 'netPay', label: 'Neto pay', unit: 'm' },
        { key: 'ntgRes', label: 'N/G reservorio', unit: 'v/v' },
        { key: 'ntgPay', label: 'N/G pay', unit: 'v/v' },
        { key: 'phiRes', label: 'φ reservorio', unit: 'v/v' },
        { key: 'swRes', label: 'Sw reservorio', unit: 'v/v' },
        { key: 'phiPay', label: 'φ pay', unit: 'v/v' },
        { key: 'swPay', label: 'Sw pay', unit: 'v/v' },
        { key: 'vshPay', label: 'Vsh pay', unit: 'v/v' },
        { key: 'kPay', label: 'k pay', unit: 'mD' },
        { key: 'khPay', label: 'kh pay (mD·m)', unit: 'unitless' },
        { key: 'hphiPay', label: 'h·φ pay', unit: 'm' },
        { key: 'hphiShPay', label: 'h·φ·Sh pay', unit: 'm' },
        { key: 'noData', label: 'Sin dato', unit: 'm' },
        { key: 'noDataPay', label: 'Sin dato pay', unit: 'm' },
      ],
    }),
    netPayH: output.zoneScalar('NET_PAY_H', { label: 'Neto pay', unit: 'm' }),
    hphiSh: output.zoneScalar('HPHISH_PAY', { label: 'h·φ·Sh pay', unit: 'm' }),
    netPayTotal: output.scalar('NET_PAY_TOTAL', { label: 'Neto pay total', unit: 'm' }),
    hphiShTotal: output.scalar('HPHISH_TOTAL', { label: 'h·φ·Sh total', unit: 'm' }),
  },
  compute({ n, depth, thickness, inputs, zones, warn }) {
    const data = {
      thickness,
      netRes: inputs.netRes,
      netPay: inputs.netPay,
      phi: inputs.phi,
      sw: inputs.sw,
      vsh: inputs.vsh,
      perm: inputs.k,
    };

    // Intervalos (D6): las zonas en orden, o el pozo completo si no hay zonas.
    const intervals =
      zones.length > 0
        ? zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind as ZoneKind | null, top: z.top, base: z.base, start: z.start, end: z.end }))
        : [{ id: '', name: 'Pozo completo', kind: null as ZoneKind | null, top: n > 0 ? depth[0]! : NaN, base: n > 0 ? depth[n - 1]! : NaN, start: 0, end: n }];

    const row = (name: string, kind: string | null, top: number, base: number, s: IntervalSummary): Record<string, TableCell> => ({
      zone: name,
      kind,
      top: num(top),
      base: num(base),
      gross: num(s.gross),
      netRes: num(s.netRes),
      netPay: num(s.netPay),
      ntgRes: num(s.ntgRes),
      ntgPay: num(s.ntgPay),
      phiRes: num(s.phiRes),
      swRes: num(s.swRes),
      phiPay: num(s.phiPay),
      swPay: num(s.swPay),
      vshPay: num(s.vshPay),
      kPay: num(s.kPay),
      khPay: num(s.khPay),
      hphiPay: num(s.hphiPay),
      hphiShPay: num(s.hphiShPay),
      noData: num(s.noData),
      noDataPay: num(s.noDataPay),
    });

    const rows: Record<string, TableCell>[] = [];
    const netPayH: ZoneScalarValue = {};
    const hphiSh: ZoneScalarValue = {};
    for (const iv of intervals) {
      const s = summarizeRanges(data, [{ start: iv.start, end: iv.end }]);
      rows.push(row(iv.name, iv.kind ? KIND_LABEL[iv.kind] : null, iv.top, iv.base, s));
      // El sello no aporta volumen: su faltante de Sw no se avisa.
      if (iv.kind !== 'seal' && s.noDataPay > PAY_GAP_WARN * s.netRes) {
        const where = zones.length > 0 ? `En la zona ${iv.name}` : 'En el pozo';
        const pct = Math.round((100 * s.noDataPay) / s.netRes);
        warn(
          Number.isNaN(s.netPay)
            ? `${where}, ningún tramo de reservorio tiene Sw: el pay y el h·φ·Sh quedan sin dato.`
            : `${where}, al ${pct} % del reservorio neto (${s.noDataPay.toFixed(1)} m) le falta Sw: el pay se calcula solo con el resto.`,
        );
      }
      if (zones.length > 0) {
        const ok = hasClassified(s);
        netPayH[iv.id] = ok ? s.netPay : NaN;
        hphiSh[iv.id] = ok ? s.hphiShPay : NaN;
      }
    }

    const total = summarizeRanges(data, intervals.map((iv) => ({ start: iv.start, end: iv.end })));
    const tops = intervals.map((iv) => iv.top).filter(Number.isFinite);
    const bases = intervals.map((iv) => iv.base).filter(Number.isFinite);
    rows.push(row('Total', null, tops.length ? Math.min(...tops) : NaN, bases.length ? Math.max(...bases) : NaN, total));

    const ok = hasClassified(total);
    return {
      table: { rows },
      netPayH,
      hphiSh,
      netPayTotal: ok ? total.netPay : NaN,
      hphiShTotal: ok ? total.hphiShPay : NaN,
    };
  },
  docs: {
    summary:
      'Sumario por zona de lo que dejan los cutoffs: espesor bruto, neto de reservorio y de pay, relación neto/bruto, porosidad y saturación de agua promedio, arcillosidad y permeabilidad del pay, capacidad de flujo y espesor equivalente de hidrocarburo.',
    equations: [
      { latex: '\\bar\\phi = \\frac{\\sum h_i\\,\\phi_i}{\\sum h_i}', description: 'Sobre el espesor neto.' },
      { latex: '\\bar S_w = \\frac{\\sum h_i\\,\\phi_i\\,S_{w,i}}{\\sum h_i\\,\\phi_i}', description: 'Ponderada por volumen poral.' },
      { latex: 'h\\phi S_h = \\sum h_i\\,\\phi_i\\,(1 - S_{w,i})', description: 'Sobre el pay; es igual a h·φ̄·(1 − S̄w).' },
      { latex: 'kh = \\sum h_i\\,k_i', description: 'Capacidad de flujo del pay, en mD·m.' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Worthington, P. F. y Cosentino, L. (2005). The role of cut-offs in integrated reservoir studies. SPE Reservoir Evaluation & Engineering 8(4).',
    ],
    notes:
      'Las muestras sin Vsh o porosidad que ningún corte descarta no se pueden clasificar y se informan como «sin dato». El reservorio sin Sw cuenta en «sin dato pay»: no se cuenta como no pay; si toda la zona carece de Sw, el pay queda sin dato. El total se calcula desde las sumas de todas las zonas, no promediando promedios; las muestras fuera de toda zona no cuentan.',
  },
});
