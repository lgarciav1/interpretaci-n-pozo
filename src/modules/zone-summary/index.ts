/**
 * Módulo de sumario por zona — espesores netos (arena, reservorio y pay; 0054), promedios y h·φ·Sh. Ver 0007, C21 y
 * D3/D6.
 * Consume curvas (los promedios ponderados necesitan las muestras) y publica una tabla para leer y valores por zona
 * (neto pay y h·φ·Sh) que consume el volumétrico. Datos faltantes (D6): una zona sin muestras o sin ninguna muestra
 * clasificada (0 o 1) da NaN en los valores por zona, no 0; una zona con reservorio pero sin Sw en todo él también
 * (el pay es «sin dato»). Si solo falta parte del Sw se suma lo conocido y el faltante queda en la columna
 * «Sin dato pay»; si supera el 5 % del neto de reservorio de la zona, se avisa.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell, type ZoneScalarValue } from '../../core/module';
import { summarizeRanges, type IntervalSummary, type SummaryOptions } from '../../petro/summary';

/**
 * La tabla del motor no lleva percentiles ni medias geo/armónica: no se pagan (ordenar ~2 ms por llamada) en cada
 * recálculo de cutoffs. El panel los calcula aparte, una vez por resultado, solo a la vista (`stats.ts`, 0068).
 */
const NO_DIST: SummaryOptions = { distributions: false };
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
  description: 'Espesor bruto, arena neta, reservorio neto y pay neto, relación neto/bruto, porosidad, saturación de agua y arcillosidad promedio por zona y en total.',
  category: 'summary',
  workspace: 'petrophysics',
  inputs: {
    netRes: input.curve('NET_RES'),
    netPay: input.curve('NET_PAY'),
    // Arena neta (0054): opcional, así un NET_RES/NET_PAY que no venga del módulo de cutoffs sigue sirviendo.
    netSand: input.optionalCurve('NET_SAND'),
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
        { key: 'netRes', label: 'Reservorio neto (permeable)', unit: 'm' },
        { key: 'netPay', label: 'Pay neto (útil)', unit: 'm' },
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
        { key: 'netSand', label: 'Arena neta', unit: 'm' },
        { key: 'ntgSand', label: 'N/G arena', unit: 'v/v' },
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
      ...(inputs.netSand ? { netSand: inputs.netSand } : {}),
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
      netSand: num(s.netSand),
      netRes: num(s.netRes),
      netPay: num(s.netPay),
      ntgSand: num(s.ntgSand),
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
      const s = summarizeRanges(data, [{ start: iv.start, end: iv.end }], NO_DIST);
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

    const total = summarizeRanges(data, intervals.map((iv) => ({ start: iv.start, end: iv.end })), NO_DIST);
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
      'Sumario por zona de lo que dejan los cutoffs: espesor bruto, arena neta (solo Vsh), reservorio neto o permeable (además φ y, si se usa, k) y pay neto o útil (además Sw), relación neto/bruto, porosidad y saturación de agua promedio, arcillosidad y permeabilidad del pay, capacidad de flujo y espesor equivalente de hidrocarburo.',
    equations: [
      { latex: '\\bar\\phi = \\frac{\\sum h_i\\,\\phi_i}{\\sum h_i}', description: 'Sobre el espesor neto.' },
      { latex: '\\bar S_w = \\frac{\\sum h_i\\,\\phi_i\\,S_{w,i}}{\\sum h_i\\,\\phi_i}', description: 'Ponderada por volumen poral.' },
      { latex: 'h\\phi S_h = \\sum h_i\\,\\phi_i\\,(1 - S_{w,i})', description: 'Sobre el pay; es igual a h·φ̄·(1 − S̄w).' },
      { latex: 'kh = \\sum h_i\\,k_i', description: 'Capacidad de flujo del pay, en mD·m. Equivale a la media aritmética de k por el espesor: flujo horizontal, capas en paralelo.' },
      { latex: '\\bar x_g = \\exp\\!\\left(\\frac{\\sum h_i\\,\\ln x_i}{\\sum h_i}\\right)', description: 'Media geométrica ponderada por espesor de k y de RT en el pay; solo cuentan las muestras con x > 0, las demás son nulas.' },
      { latex: '\\bar x_h = \\frac{\\sum h_i}{\\sum h_i / x_i}', description: 'Media armónica ponderada por espesor de k en el pay: permeabilidad efectiva con flujo vertical, capas en serie. Siempre x̄h ≤ x̄g ≤ x̄a.' },
      { latex: 'c_j = \\frac{\\sum_{m<j} w_m + w_j/2}{\\sum w_m},\\quad P_p = x_{(j)} + \\frac{p - c_j}{c_{j+1} - c_j}\\,(x_{(j+1)} - x_{(j)})', description: 'Percentil ponderado (P10, P50, P90) de Vsh, φ, Sw, k y RT, con peso wᵢ = hᵢ (Sw: wᵢ = hᵢ·φᵢ, volumen poral, como S̄w): muestras ordenadas por valor, cada una ubicada en el punto medio de su tramo de la distribución acumulada e interpolación lineal entre ellas; con pesos iguales es el método de Hazen. P10 es el valor bajo el cual queda el 10 % del espesor.' },
    ],
    references: [
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
      'Warren, J. E. y Price, H. S. (1961). Flow in heterogeneous porous media. SPE Journal 1(3), 153-169.',
      'Lake, L. W. (1989). Enhanced Oil Recovery, cap. 2. Prentice Hall.',
      'Hyndman, R. J. y Fan, Y. (1996). Sample quantiles in statistical packages. The American Statistician 50(4), 361-365.',
      'Worthington, P. F. y Cosentino, L. (2005). The role of cut-offs in integrated reservoir studies. SPE Reservoir Evaluation & Engineering 8(4).',
    ],
    notes:
      'Los percentiles, la media geométrica y la armónica se calculan sobre las mismas muestras que cada promedio (neto de reservorio para Vsh, φ, Sw y RT; neto pay para esas y para k). La media armónica de RT es la resistividad con corriente paralela a la estratificación, la que leen las herramientas de inducción. Los nulos (sin dato; para las medias geométrica y armónica, también valores ≤ 0) no entran y se informan aparte con su espesor. Los percentiles de Sw se ponderan por volumen poral h·φ, como la media; los demás, por espesor. Los tres espesores netos están anidados: pay ≤ reservorio ≤ arena ≤ bruto. Las muestras sin Vsh o porosidad que ningún corte descarta no se pueden clasificar y se informan como «sin dato». El reservorio sin Sw cuenta en «sin dato pay»: no se cuenta como no pay; si toda la zona carece de Sw, el pay queda sin dato. El total se calcula desde las sumas de todas las zonas, no promediando promedios; las muestras fuera de toda zona no cuentan.',
  },
});
