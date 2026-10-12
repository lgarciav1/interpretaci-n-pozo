/**
 * Módulo de incertidumbre del volumen in situ (función I): Monte Carlo sobre área, factor de volumen, porosidad, Sw y
 * cutoffs, con P90/P50/P10 por zona y total (petróleo y gas por separado) y los datos de un gráfico tornado.
 *
 * Los rangos se expresan RELATIVOS al valor vigente (el «más probable» es lo que está en el módulo de volumen in situ y en
 * los cutoffs): área × [bajo, alto], B × [bajo, alto], φ y Sw × [bajo, alto], cutoffs ± semiancho. Con todos los rangos en su
 * valor neutro (1 y 0) el resultado es el determinista del módulo de volumen in situ y P90 = P50 = P10.
 * Convención: P90 es el valor BAJO (superado con 90 % de probabilidad) y P10 el ALTO (SPE-PRMS).
 * Corre en el Web Worker como cualquier módulo (el motor ya ejecuta todo el registro allí); 5000 iteraciones × 5 zonas
 * tardan unas décimas de segundo, por eso solo se calcula con `calculate` activado (defecto: apagado) y no frena el
 * recálculo en vivo de los demás módulos. Tablas ocultas (`hidden`) para el panel a medida de los gráficos.
 * Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell, type ZoneScalarValue } from '../../core/module';
import { param } from '../../core/params';
import { convert } from '../../core/units';
import {
  runUncertainty,
  type Dist,
  type SampleFactorDists,
  type UncertainZone,
  type UncertaintyTarget,
} from '../../petro/uncertainty';
import { SHARED_PARAMS } from '../sharedParams';

const num = (x: number): TableCell => (Number.isFinite(x) ? x : null);

const FLUID_LABEL = { oil: 'Petróleo', gas: 'Gas' } as const;

/** Rango relativo [bajo, alto] alrededor del más probable (multiplicadores). */
const range = (label: string, tooltip: string, def: number, min: number, max: number) =>
  param.number({ label, tooltip, default: def, min, max, step: 0.01, unit: 'unitless' });

export default defineModule({
  id: 'uncertainty',
  name: 'Incertidumbre del volumen',
  description: 'Monte Carlo sobre área, factor de volumen, porosidad, Sw y cutoffs: P90/P50/P10 del volumen in situ por zona y qué parámetro mueve más el resultado.',
  category: 'volumetrics',
  workspace: 'petrophysics',
  inputs: {
    vsh: input.curve('VSH'),
    phi: input.curve('PHIE'),
    sw: input.curve('SW'),
  },
  params: {
    // Valores más probables: los mismos que usan el volumétrico y los cutoffs.
    vshCutoff: SHARED_PARAMS.vshCutoff,
    phiCutoff: SHARED_PARAMS.phiCutoff,
    swCutoff: SHARED_PARAMS.swCutoff,
    area: SHARED_PARAMS.area,
    fluid: SHARED_PARAMS.fluid,
    bo: SHARED_PARAMS.bo,
    bg: SHARED_PARAMS.bg,
    // Simulación
    calculate: param.boolean({
      label: 'Calcular incertidumbre',
      tooltip: 'La simulación es pesada (cientos de milisegundos): solo se calcula cuando está activada, para no frenar los sliders de los otros módulos.',
      default: false,
    }),
    distribution: param.enum({
      label: 'Distribución de los parámetros',
      tooltip: 'Forma con que se sortea cada parámetro entre su mínimo y su máximo. La triangular usa el valor vigente como más probable.',
      options: [
        { value: 'triangular', label: 'Triangular' },
        { value: 'uniform', label: 'Uniforme' },
        { value: 'normal', label: 'Normal truncada' },
      ],
      default: 'triangular',
    }),
    iterations: param.number({ label: 'Iteraciones', tooltip: 'Más iteraciones dan percentiles más estables.', default: 2000, min: 500, max: 20000, step: 500 }),
    seed: param.number({ label: 'Semilla', tooltip: 'Misma semilla, mismos resultados.', default: 42, min: 0, max: 99999, step: 1 }),
    zoneCorrelation: param.enum({
      label: 'Área y B entre zonas',
      tooltip: 'Correlacionadas: área y B suben y bajan juntos en todas las zonas (suma conservadora). Independientes: cada zona sortea la suya.',
      options: [
        { value: 'full', label: 'Correlacionadas' },
        { value: 'independent', label: 'Independientes' },
      ],
      default: 'full',
    }),
    tornadoRange: param.enum({
      label: 'Extremos del tornado',
      tooltip: 'Valores con que se mueve cada parámetro en el tornado: sus mínimo y máximo, o sus P10 y P90.',
      options: [
        { value: 'minmax', label: 'Mínimo y máximo' },
        { value: 'p10p90', label: 'P10 y P90' },
      ],
      default: 'minmax',
    }),
    bins: param.number({ label: 'Clases del histograma', default: 30, min: 10, max: 100, step: 1 }),
    // Rangos relativos (por zona: área y B)
    areaLow: { ...range('Área: mínimo (× vigente)', 'Fracción del área vigente en el caso bajo.', 0.7, 0.05, 1), scope: 'zone' },
    areaHigh: { ...range('Área: máximo (× vigente)', 'Múltiplo del área vigente en el caso alto.', 1.3, 1, 5), scope: 'zone' },
    bLow: { ...range('B: mínimo (× vigente)', 'Múltiplo de Bo (petróleo) o Bg (gas) en el caso bajo.', 0.95, 0.5, 1), scope: 'zone' },
    bHigh: { ...range('B: máximo (× vigente)', 'Múltiplo de Bo (petróleo) o Bg (gas) en el caso alto.', 1.05, 1, 2), scope: 'zone' },
    // Globales
    phiLow: range('φ: mínimo (× vigente)', 'Error sistemático de la porosidad (matriz, calibración).', 0.9, 0.5, 1),
    phiHigh: range('φ: máximo (× vigente)', 'Error sistemático de la porosidad (matriz, calibración).', 1.1, 1, 1.5),
    swLow: range('Sw: mínimo (× vigente)', 'Error sistemático de la saturación (Rw, m, n).', 0.9, 0.5, 1),
    swHigh: range('Sw: máximo (× vigente)', 'Error sistemático de la saturación (Rw, m, n).', 1.1, 1, 1.5),
    vshCutoffHalf: param.number({ label: 'Cutoff de Vsh: ± ', tooltip: 'Semiancho del rango del corte de arcillosidad. 0 = fijo.', default: 0.05, min: 0, max: 0.3, step: 0.01, unit: 'v/v' }),
    phiCutoffHalf: param.number({ label: 'Cutoff de φ: ± ', tooltip: 'Semiancho del rango del corte de porosidad. 0 = fijo.', default: 0.01, min: 0, max: 0.05, step: 0.005, unit: 'v/v' }),
    swCutoffHalf: param.number({ label: 'Cutoff de Sw: ± ', tooltip: 'Semiancho del rango del corte de saturación. 0 = fijo.', default: 0.05, min: 0, max: 0.3, step: 0.01, unit: 'v/v' }),
  },
  outputs: {
    summary: output.table('UNCERTAINTY', {
      label: 'Volumen in situ: P90 / P50 / P10',
      columns: [
        { key: 'key', label: 'Id', kind: 'text' },
        { key: 'target', label: 'Zona', kind: 'text' },
        { key: 'fluid', label: 'Fluido', kind: 'text' },
        { key: 'det', label: 'Determinista', unit: 'm3' },
        { key: 'p90', label: 'P90 (bajo)', unit: 'm3' },
        { key: 'p50', label: 'P50', unit: 'm3' },
        { key: 'p10', label: 'P10 (alto)', unit: 'm3' },
        { key: 'mean', label: 'Media', unit: 'm3' },
        { key: 'sd', label: 'Desvío', unit: 'm3' },
        { key: 'min', label: 'Mínimo', unit: 'm3' },
        { key: 'max', label: 'Máximo', unit: 'm3' },
        { key: 'fieldUnit', label: 'Unidad de campo', kind: 'text' },
        { key: 'detField', label: 'Determinista (campo)' },
        { key: 'p90Field', label: 'P90 (campo)' },
        { key: 'p50Field', label: 'P50 (campo)' },
        { key: 'p10Field', label: 'P10 (campo)' },
      ],
    }),
    hist: output.table('UNCERTAINTY_HIST', {
      label: 'Histograma del volumen',
      hidden: true,
      columns: [
        { key: 'key', label: 'Id', kind: 'text' },
        { key: 'target', label: 'Zona', kind: 'text' },
        { key: 'bin', label: 'Clase' },
        { key: 'x0', label: 'Desde', unit: 'm3' },
        { key: 'x1', label: 'Hasta', unit: 'm3' },
        { key: 'count', label: 'Cuenta' },
        { key: 'freq', label: 'Frecuencia', unit: 'unitless' },
        { key: 'cum', label: 'Acumulada hasta x1', unit: 'unitless' },
      ],
    }),
    cdf: output.table('UNCERTAINTY_CDF', {
      label: 'Curva acumulada del volumen',
      hidden: true,
      columns: [
        { key: 'key', label: 'Id', kind: 'text' },
        { key: 'target', label: 'Zona', kind: 'text' },
        { key: 'prob', label: 'Probabilidad acumulada', unit: 'unitless' },
        { key: 'value', label: 'Volumen', unit: 'm3' },
      ],
    }),
    tornado: output.table('UNCERTAINTY_TORNADO', {
      label: 'Tornado de sensibilidad',
      hidden: true,
      columns: [
        { key: 'key', label: 'Id', kind: 'text' },
        { key: 'target', label: 'Zona', kind: 'text' },
        { key: 'rank', label: 'Orden' },
        { key: 'param', label: 'Parámetro (id)', kind: 'text' },
        { key: 'label', label: 'Parámetro', kind: 'text' },
        { key: 'low', label: 'Valor bajo' },
        { key: 'high', label: 'Valor alto' },
        { key: 'vLow', label: 'Volumen con el bajo', unit: 'm3' },
        { key: 'vHigh', label: 'Volumen con el alto', unit: 'm3' },
        { key: 'base', label: 'Volumen base', unit: 'm3' },
        { key: 'deltaLow', label: 'Cambio con el bajo', unit: 'm3' },
        { key: 'deltaHigh', label: 'Cambio con el alto', unit: 'm3' },
        { key: 'swing', label: 'Amplitud', unit: 'm3' },
        { key: 'swingPct', label: 'Amplitud / base', unit: 'unitless' },
      ],
    }),
    spearman: output.table('UNCERTAINTY_SPEARMAN', {
      label: 'Correlación de rangos con el volumen',
      hidden: true,
      columns: [
        { key: 'key', label: 'Id', kind: 'text' },
        { key: 'target', label: 'Zona', kind: 'text' },
        { key: 'param', label: 'Parámetro (id)', kind: 'text' },
        { key: 'label', label: 'Parámetro', kind: 'text' },
        { key: 'zoneId', label: 'Id de zona del sorteo', kind: 'text' },
        { key: 'rho', label: 'ρ de Spearman', unit: 'unitless' },
      ],
    }),
    p90: output.zoneScalar('UNC_P90', { label: 'Volumen P90 (bajo)', unit: 'm3' }),
    p50: output.zoneScalar('UNC_P50', { label: 'Volumen P50', unit: 'm3' }),
    p10: output.zoneScalar('UNC_P10', { label: 'Volumen P10 (alto)', unit: 'm3' }),
    ooipP90: output.scalar('UNC_OOIP_P90', { label: 'Petróleo in situ total P90', unit: 'm3' }),
    ooipP50: output.scalar('UNC_OOIP_P50', { label: 'Petróleo in situ total P50', unit: 'm3' }),
    ooipP10: output.scalar('UNC_OOIP_P10', { label: 'Petróleo in situ total P10', unit: 'm3' }),
    ogipP90: output.scalar('UNC_OGIP_P90', { label: 'Gas in situ total P90', unit: 'm3' }),
    ogipP50: output.scalar('UNC_OGIP_P50', { label: 'Gas in situ total P50', unit: 'm3' }),
    ogipP10: output.scalar('UNC_OGIP_P10', { label: 'Gas in situ total P10', unit: 'm3' }),
  },
  compute({ thickness, inputs, params, zones, paramsFor, warn }) {
    const kind = params.distribution;
    const zoneP90: ZoneScalarValue = {};
    const zoneP50: ZoneScalarValue = {};
    const zoneP10: ZoneScalarValue = {};
    for (const z of zones) zoneP90[z.id] = zoneP50[z.id] = zoneP10[z.id] = NaN;
    const res = {
      summary: { rows: [] as Record<string, TableCell>[] },
      hist: { rows: [] as Record<string, TableCell>[] },
      cdf: { rows: [] as Record<string, TableCell>[] },
      tornado: { rows: [] as Record<string, TableCell>[] },
      spearman: { rows: [] as Record<string, TableCell>[] },
      p90: zoneP90,
      p50: zoneP50,
      p10: zoneP10,
      ooipP90: NaN,
      ooipP50: NaN,
      ooipP10: NaN,
      ogipP90: NaN,
      ogipP50: NaN,
      ogipP10: NaN,
    };
    if (!params.calculate) return res; // desactivada: salidas vacías (NaN por zona), sin costo
    if (zones.length === 0) {
      warn('Definí zonas para calcular la incertidumbre: el área, el fluido y los factores de volumen se eligen por zona.');
      return res;
    }

    const dist = (min: number, mode: number, max: number): Dist => ({ kind, min, mode, max });
    const half = (h: number): Dist => dist(-h, 0, h);
    const factors: SampleFactorDists = {
      phiMult: dist(params.phiLow, 1, params.phiHigh),
      swMult: dist(params.swLow, 1, params.swHigh),
      vshCutoff: half(params.vshCutoffHalf),
      phiCutoff: half(params.phiCutoffHalf),
      swCutoff: half(params.swCutoffHalf),
    };

    const uzones: UncertainZone[] = zones.map((z) => {
      const p = paramsFor(z.id);
      const seal = z.kind === 'seal';
      const area = p.area * 1e6; // km² → m²
      const b = p.fluid === 'gas' ? p.bg : p.bo;
      return {
        id: z.id,
        name: z.name,
        fluid: seal ? 'none' : p.fluid,
        h: thickness.subarray(z.start, z.end),
        vsh: inputs.vsh.subarray(z.start, z.end),
        phi: inputs.phi.subarray(z.start, z.end),
        sw: inputs.sw.subarray(z.start, z.end),
        cutoffs: { vshMax: p.vshCutoff, phiMin: p.phiCutoff, swMax: p.swCutoff },
        area: dist(area * p.areaLow, area, area * p.areaHigh),
        b: dist(b * p.bLow, b, b * p.bHigh),
      };
    });

    const result = runUncertainty({
      zones: uzones,
      factors,
      iterations: Math.round(params.iterations),
      seed: Math.round(params.seed),
      zoneCorrelation: params.zoneCorrelation,
      bins: Math.round(params.bins),
      tornadoQuantiles: params.tornadoRange === 'p10p90' ? [0.1, 0.9] : [0, 1],
    });

    for (const s of result.skipped) {
      if (s.reason === 'no-data') {
        const z = zones.find((x) => x.id === s.id)!;
        warn(`En la zona ${z.name} no hay h·φ·Sh (sin muestras clasificadas o sin Sw en el reservorio): la incertidumbre del volumen queda sin dato.`);
      }
    }
    if (result.targets.length === 0) warn('Ninguna zona tiene volumen para simular: revisá el fluido y los datos de cada zona.');

    const unitOf = (t: UncertaintyTarget) => (t.fluid === 'oil' ? 'MMbbl' : 'Bcf');
    const toField = (t: UncertaintyTarget, v: number) => num(convert(v, 'm3', unitOf(t)));
    for (const t of result.targets) {
      const s = t.stats;
      const name = t.name;
      res.summary.rows.push({
        key: t.key,
        target: name,
        fluid: FLUID_LABEL[t.fluid],
        det: num(t.deterministic),
        p90: num(s.p90),
        p50: num(s.p50),
        p10: num(s.p10),
        mean: num(s.mean),
        sd: num(s.sd),
        min: num(s.min),
        max: num(s.max),
        fieldUnit: t.fluid === 'oil' ? 'MMbbl' : 'Bcf',
        detField: toField(t, t.deterministic),
        p90Field: toField(t, s.p90),
        p50Field: toField(t, s.p50),
        p10Field: toField(t, s.p10),
      });
      let cum = 0;
      s.histogram.counts.forEach((c, i) => {
        cum += c;
        res.hist.rows.push({
          key: t.key,
          target: name,
          bin: i,
          x0: num(s.histogram.edges[i]!),
          x1: num(s.histogram.edges[i + 1]!),
          count: c,
          freq: c / s.n,
          cum: cum / s.n,
        });
      });
      s.curve.prob.forEach((p, i) => res.cdf.rows.push({ key: t.key, target: name, prob: p, value: num(s.curve.value[i]!) }));
      t.tornado.forEach((r, i) =>
        res.tornado.rows.push({
          key: t.key,
          target: name,
          rank: i + 1,
          param: r.param,
          label: r.label,
          low: num(r.low),
          high: num(r.high),
          vLow: num(r.vLow),
          vHigh: num(r.vHigh),
          base: num(r.base),
          deltaLow: num(r.vLow - r.base),
          deltaHigh: num(r.vHigh - r.base),
          swing: num(r.swing),
          swingPct: num(r.base > 0 ? r.swing / r.base : NaN),
        }),
      );
      for (const r of t.spearman) {
        res.spearman.rows.push({ key: t.key, target: name, param: r.param, label: r.label, zoneId: r.zoneId, rho: num(r.rho) });
      }
      if (t.kind === 'zone') {
        zoneP90[t.key] = s.p90;
        zoneP50[t.key] = s.p50;
        zoneP10[t.key] = s.p10;
      } else if (t.fluid === 'oil') {
        res.ooipP90 = s.p90;
        res.ooipP50 = s.p50;
        res.ooipP10 = s.p10;
      } else {
        res.ogipP90 = s.p90;
        res.ogipP50 = s.p50;
        res.ogipP10 = s.p10;
      }
    }
    return res;
  },
  docs: {
    summary:
      'Simulación Monte Carlo del volumen in situ por zona. Cada parámetro incierto (área, factor de volumen, porosidad, saturación de agua y cutoffs) se sortea entre su mínimo y su máximo alrededor del valor vigente; en cada iteración se recalcula el espesor equivalente de hidrocarburo muestra por muestra y el volumen. Resultado: P90, P50 y P10, histograma y curva acumulada, y un tornado (cada parámetro a su extremo bajo y alto con el resto en el más probable) con la correlación de rangos de cada parámetro con el volumen.',
    equations: [
      { latex: 'V_k = \\frac{A_k\\,(h\\phi S_h)_k}{B_k}', description: 'Volumen de la iteración k (Bo para petróleo, Bg para gas).' },
      { latex: '(h\\phi S_h)_k = \\sum_i h_i\\,\\phi_i m_{\\phi,k}\\,(1 - S_{w,i} m_{S_w,k})\\,[\\text{pay}_i]', description: 'Pay con los cutoffs de la iteración: Vsh ≤ Vsh_max + ΔVsh, φ ≥ φ_min + Δφ, Sw ≤ Sw_max + ΔSw.' },
      { latex: 'P_{90} = F^{-1}(0{,}10),\\quad P_{50} = F^{-1}(0{,}50),\\quad P_{10} = F^{-1}(0{,}90)', description: 'F es la distribución acumulada del volumen: Pxx es el valor superado con xx % de probabilidad.' },
      { latex: 'F^{-1}(u) = a + \\sqrt{u\\,(b-a)(c-a)}\\ \\ (u < \\tfrac{c-a}{b-a}),\\quad b - \\sqrt{(1-u)(b-a)(b-c)}\\ \\text{si no}', description: 'Triangular con mínimo a, más probable c y máximo b, muestreada por transformada inversa.' },
      { latex: '\\rho_S = \\mathrm{corr}\\big(\\mathrm{rango}(u_j),\\ \\mathrm{rango}(V)\\big)', description: 'Correlación de Spearman del parámetro j con el volumen.' },
    ],
    references: [
      'Murtha, J. A. (1997). Monte Carlo simulation: its status and future. Journal of Petroleum Technology 49(4), SPE 37932.',
      'SPE, AAPG, WPC, SPEE, SEG, SPWLA, EAGE (2018). Petroleum Resources Management System (PRMS).',
      'Capen, E. C. (1976). The difficulty of assessing uncertainty. Journal of Petroleum Technology 28(8).',
      'Dake, L. P. (1978). Fundamentals of Reservoir Engineering. Elsevier.',
    ],
    notes:
      'P90 es el valor bajo (superado con 90 % de probabilidad) y P10 el alto. Los multiplicadores de φ y Sw y los corrimientos de los cutoffs son únicos por iteración (iguales en todas las zonas); el área y B se sortean con el mismo cuantil en todas las zonas (correlacionadas) o de forma independiente. Simplificación: φ y Sw se perturban ya calculadas con un multiplicador; no se vuelve a correr la cadena Rw → Sw con otros m, n o a. Con la semilla fija el resultado es reproducible.',
  },
});
