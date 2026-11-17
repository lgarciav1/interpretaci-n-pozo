/**
 * Módulo de capacidad de almacenaje y de flujo (función S) y curvas de Lorenz por zona.
 * Consume φ y k (y, según el filtro, las banderas NET_RES / NET_PAY de cutoffs) y publica tres tablas:
 *   FLOW_UNITS    un renglón por tramo (muestra o grupo de muestras) y zona, de arriba hacia abajo;
 *   FLOW_LORENZ   puntos de las dos curvas de Lorenz por zona y para el total (formato largo, `hidden`: es para el gráfico);
 *   FLOW_SUMMARY  un renglón por zona y total, con φh, kh, promedios y coeficiente de Lorenz.
 * Las zonas de tipo sello no se calculan. «Total» concatena los tramos de las zonas calculadas en orden de profundidad.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell, type ZoneScalarValue } from '../../core/module';
import { param } from '../../core/params';
import { flowCapacity, flowCapacityFromUnits, type FlowCapacity, type FlowSamples } from '../../petro/flowCapacity';

type FilterKind = 'all' | 'netRes' | 'netPay';

const FILTER_LABEL: Record<FilterKind, string> = {
  all: 'Todo el tramo',
  netRes: 'Reservorio neto',
  netPay: 'Pay neto',
};

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);
const pct = (x: number): TableCell => (Number.isFinite(x) ? 100 * x : null);

export default defineModule({
  id: 'flow-capacity',
  name: 'Capacidad de flujo y Lorenz',
  description: 'Capacidad de almacenaje (φ·h) y de flujo (k·h) por tramo, curvas de Lorenz estratigráfica y ordenada y coeficiente de Lorenz por zona.',
  category: 'summary',
  workspace: 'petrophysics',
  inputs: {
    phi: input.curve('PHIE'),
    k: input.curve('PERM'),
    netRes: input.optionalCurve('NET_RES'),
    netPay: input.optionalCurve('NET_PAY'),
  },
  params: {
    filter: param.enum({
      label: 'Tramos considerados',
      tooltip: 'Qué muestras entran al cálculo: todas, solo el reservorio neto o solo el pay neto (según los cutoffs).',
      options: [
        { value: 'netRes', label: FILTER_LABEL.netRes },
        { value: 'netPay', label: FILTER_LABEL.netPay },
        { value: 'all', label: FILTER_LABEL.all },
      ],
      default: 'netRes',
      scope: 'zone',
    }),
    groupSize: param.number({
      label: 'Muestras por tramo',
      tooltip: 'Agrupa muestras consecutivas en un mismo tramo. 1 = un tramo por muestra. El coeficiente de Lorenz depende de esta resolución.',
      default: 1,
      min: 1,
      max: 200,
      step: 1,
      scale: 'log',
      scope: 'zone',
    }),
  },
  outputs: {
    units: output.table('FLOW_UNITS', {
      label: 'Capacidad de almacenaje y flujo por tramo',
      columns: [
        { key: 'zoneId', label: 'Id de zona', kind: 'text' },
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'index', label: 'Tramo' },
        { key: 'top', label: 'Tope', unit: 'm' },
        { key: 'base', label: 'Base', unit: 'm' },
        { key: 'h', label: 'Espesor', unit: 'm' },
        { key: 'phi', label: 'φ', unit: 'v/v' },
        { key: 'k', label: 'k', unit: 'mD' },
        { key: 'kOverPhi', label: 'k/φ', unit: 'mD' },
        { key: 'phiH', label: 'φ·h', unit: 'm' },
        { key: 'kH', label: 'k·h (mD·m)', unit: 'unitless' },
        { key: 'phiHPct', label: 'φ·h del total', unit: '%' },
        { key: 'kHPct', label: 'k·h del total', unit: '%' },
        { key: 'cumPhiHPct', label: 'φ·h acumulado', unit: '%' },
        { key: 'cumKHPct', label: 'k·h acumulado', unit: '%' },
      ],
    }),
    lorenz: output.table('FLOW_LORENZ', {
      label: 'Curvas de Lorenz',
      hidden: true,
      columns: [
        { key: 'zoneId', label: 'Id de zona (total = "")', kind: 'text' },
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'curve', label: 'Curva (strat | ordered)', kind: 'text' },
        { key: 'i', label: 'Punto' },
        { key: 'x', label: 'F φ·h acumulada', unit: 'v/v' },
        { key: 'y', label: 'F k·h acumulada', unit: 'v/v' },
      ],
    }),
    summary: output.table('FLOW_SUMMARY', {
      label: 'Resumen de capacidad de flujo por zona',
      columns: [
        { key: 'zoneId', label: 'Id de zona', kind: 'text' },
        { key: 'zone', label: 'Zona', kind: 'text' },
        { key: 'filter', label: 'Tramos considerados', kind: 'text' },
        { key: 'units', label: 'Tramos' },
        { key: 'noData', label: 'Muestras sin dato' },
        { key: 'h', label: 'Espesor', unit: 'm' },
        { key: 'phiH', label: 'φ·h', unit: 'm' },
        { key: 'kH', label: 'k·h (mD·m)', unit: 'unitless' },
        { key: 'phiMean', label: 'φ medio', unit: 'v/v' },
        { key: 'kMean', label: 'k medio', unit: 'mD' },
        { key: 'lc', label: 'Coeficiente de Lorenz', unit: 'unitless' },
      ],
    }),
    lc: output.zoneScalar('LORENZ_COEF', { label: 'Coeficiente de Lorenz', unit: 'unitless' }),
    lcTotal: output.scalar('LORENZ_COEF_TOTAL', { label: 'Coeficiente de Lorenz total', unit: 'unitless' }),
  },
  compute({ n, depth, thickness, inputs, zones, paramsFor, warn }) {
    const unitRows: Record<string, TableCell>[] = [];
    const lorenzRows: Record<string, TableCell>[] = [];
    const summaryRows: Record<string, TableCell>[] = [];
    const lc: ZoneScalarValue = {};

    const intervals =
      zones.length > 0
        ? zones.map((z) => ({ id: z.id, name: z.name, seal: z.kind === 'seal', start: z.start, end: z.end }))
        : [{ id: '', name: 'Pozo completo', seal: false, start: 0, end: n }];
    for (const z of zones) lc[z.id] = NaN;

    const lorenzOf = (zoneId: string, zone: string, c: FlowCapacity) => {
      (['strat', 'ordered'] as const).forEach((curve) => {
        const pts = curve === 'strat' ? c.lorenzStrat : c.lorenzOrdered;
        pts.forEach((p, i) => lorenzRows.push({ zoneId, zone, curve, i, x: p.x, y: p.y }));
      });
    };

    const computed: FlowCapacity[] = [];
    for (const iv of intervals) {
      if (iv.seal) continue;
      const p = paramsFor(zones.length > 0 ? iv.id : null);
      let filter = p.filter as FilterKind;
      let include: FlowSamples['include'];
      if (filter === 'netRes') include = inputs.netRes;
      else if (filter === 'netPay') include = inputs.netPay;
      if (filter !== 'all' && include === undefined) {
        warn(`En ${zones.length > 0 ? `la zona ${iv.name}` : 'el pozo'} falta la curva ${filter === 'netRes' ? 'NET_RES' : 'NET_PAY'} (activá los cutoffs): se usa todo el tramo.`, { zoneId: iv.id || undefined });
        filter = 'all';
      }
      const samples: FlowSamples = { depth, thickness, phi: inputs.phi, k: inputs.k, include };
      const c = flowCapacity(samples, [{ start: iv.start, end: iv.end }], p.groupSize);
      computed.push(c);
      if (zones.length > 0) lc[iv.id] = c.lc;

      for (const u of c.units) {
        unitRows.push({
          zoneId: iv.id,
          zone: iv.name,
          index: u.index,
          top: num(u.top),
          base: num(u.base),
          h: num(u.h),
          phi: num(u.phi),
          k: num(u.k),
          kOverPhi: num(u.kOverPhi),
          phiH: num(u.phiH),
          kH: num(u.kH),
          phiHPct: pct(u.phiHFrac),
          kHPct: pct(u.kHFrac),
          cumPhiHPct: pct(u.cumPhiH),
          cumKHPct: pct(u.cumKH),
        });
      }
      lorenzOf(iv.id, iv.name, c);
      summaryRows.push(summaryRow(iv.id, iv.name, FILTER_LABEL[filter], c));
      if (c.units.length === 0) {
        warn(`En ${zones.length > 0 ? `la zona ${iv.name}` : 'el pozo'} no hay muestras con φ y k para el filtro elegido.`, { zoneId: iv.id || undefined });
      } else if (!Number.isFinite(c.lc)) {
        warn(`En ${zones.length > 0 ? `la zona ${iv.name}` : 'el pozo'} la capacidad de almacenaje o de flujo es cero: no se puede armar la curva de Lorenz.`, { zoneId: iv.id || undefined });
      }
    }

    // Total: tramos de las zonas calculadas, en orden de profundidad (solo si hay zonas; sin zonas el único renglón ya es el total).
    let lcTotal = NaN;
    if (zones.length > 0) {
      const total = flowCapacityFromUnits(
        computed.flatMap((c) => c.units),
        computed.reduce((s, c) => s + c.used, 0),
        computed.reduce((s, c) => s + c.noData, 0),
      );
      lcTotal = total.lc;
      lorenzOf('', 'Total', total);
      summaryRows.push(summaryRow('', 'Total', null, total));
    } else if (computed[0]) {
      lcTotal = computed[0].lc;
    }
    return {
      units: { rows: unitRows },
      lorenz: { rows: lorenzRows },
      summary: { rows: summaryRows },
      lc,
      lcTotal,
    };
  },
  docs: {
    summary:
      'Capacidad de almacenaje (φ·h) y de flujo (k·h) de cada tramo de arriba hacia abajo, con sus porcentajes y acumulados normalizados. Con ellos se arman la curva de Lorenz estratigráfica (tramos en orden de profundidad), la ordenada (tramos por k/φ decreciente) y el coeficiente de Lorenz de cada zona.',
    equations: [
      { latex: '(\\phi h)_i = \\phi_i\\,h_i \\qquad (kh)_i = k_i\\,h_i', description: 'Capacidad de almacenaje (m) y de flujo (mD·m) del tramo i.' },
      { latex: 'F_{\\phi h,i} = \\frac{\\sum_{j\\le i}(\\phi h)_j}{\\sum_j (\\phi h)_j} \\qquad F_{kh,i} = \\frac{\\sum_{j\\le i}(kh)_j}{\\sum_j (kh)_j}', description: 'Acumulados normalizados desde el tope.' },
      { latex: 'L_{estrat} = \\{(0,0),(F_{\\phi h,1},F_{kh,1}),\\dots,(1,1)\\}', description: 'Lorenz estratigráfico: tramos en orden de profundidad.' },
      { latex: 'L_{ord}:\\ \\text{tramos ordenados por } k_i/\\phi_i \\text{ decreciente}', description: 'Lorenz ordenado (clásico): el más productivo primero.' },
      { latex: 'L_c = 2\\,(A - \\tfrac{1}{2})', description: 'A es el área bajo la curva ordenada; 0 = homogéneo, hacia 1 = muy heterogéneo.' },
    ],
    references: [
      'Gunter, G. W., Finneran, J. M., Hartmann, D. J. y Miller, J. D. (1997). Early determination of reservoir flow units using an integrated petrophysical method. SPE 38679.',
      'Lake, L. W. y Jensen, J. L. (1991). A review of heterogeneity measures used in reservoir characterization. In Situ 15(4).',
    ],
    notes:
      'k ≤ 0 aporta cero al flujo pero su porosidad cuenta en el almacenaje; las muestras sin φ, k o espesor válidos se descartan. El coeficiente de Lorenz depende de la cantidad de tramos (con N tramos de igual φ·h el máximo es 1 − 1/N). Los sellos no se calculan; el total concatena los tramos de las zonas calculadas.',
  },
});

function summaryRow(zoneId: string, zone: string, filter: string | null, c: FlowCapacity): Record<string, TableCell> {
  return {
    zoneId,
    zone,
    filter,
    units: c.units.length,
    noData: c.noData,
    h: num(c.h),
    phiH: num(c.phiH),
    kH: num(c.kH),
    phiMean: num(c.phiMean),
    kMean: num(c.kMean),
    lc: num(c.lc),
  };
}
