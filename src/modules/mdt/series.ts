/**
 * Presiones MDT como serie de tendencias (docs/decisiones/0008 D3 y 0009): proveedor `mdt` y análisis de gradientes.
 *
 * - Serie `<conjunto>`: presión (psi) vs. profundidad (m) de los puntos INCLUIDOS del conjunto (los descartados por
 *   calidad o a mano no entran en ningún ajuste). `<conjunto>:<fluido>`: los mismos puntos, para un gradiente de ese
 *   fluido (la clave lleva el fluido: así un gradiente sabe de qué fluido es sin tocar `TrendSpec`).
 * - `xIsDepth: true` (la pendiente es un gradiente: psi/ft, bar/m, g/cm³) y se dibuja en la pista propia de la
 *   superposición 'mdt'. Clave de punto = id de la prueba.
 * - `mdtAnalysis`: gradientes con fluido, densidad, fluido sugerido y contactos. Lo usan la superposición (líneas de
 *   contacto, colores por fluido) y el panel. Caché por identidad del pozo y la interpretación.
 *
 * Interfaz (importa `src/plots`): el worker no lo carga.
 */
import type { Interpretation } from '../../core/interpretation';
import type { PointSet } from '../../core/pointSets';
import { depthOrder, pointNumbers, shiftedDepth } from '../../core/pointSets';
import type { TrendSpec } from '../../core/trends';
import type { Well } from '../../core/well';
import { classifyFluidByDensity, fluidFitsDensity, type FluidSuggestion } from '../../petro/pressure';
import { evaluateTrend, excludedIndices, type TrendResult } from '../../plots/trend/compute';
import type { ResolvedSeries, SeriesOption, TrendSeriesProvider } from '../../plots/trend/series';
import { FLUID_LABEL, findContacts, MDT_OVERLAY_ID, MDT_PROVIDER_ID, mdtSeriesKey, parseMdtSeriesKey, pointStatuses, pressureSets, FLUIDS, type Fluid, type FluidContact, type GradientLine } from './model';

const seriesCache = new WeakMap<PointSet, WeakMap<object, Map<string, ResolvedSeries>>>();
const NO_DEC = {};

/** Serie de un conjunto (puntos incluidos con presión). Misma identidad mientras no cambien datos ni decisiones. */
export function mdtSeries(set: PointSet, interpretation: Pick<Interpretation, 'pointSets'>, fluid: Fluid | null): ResolvedSeries | null {
  const p = pointNumbers(set, 'pressure');
  if (!p) return null;
  const dec = interpretation.pointSets?.[set.id];
  let byDec = seriesCache.get(set);
  if (!byDec) seriesCache.set(set, (byDec = new WeakMap()));
  const dkey = dec ?? NO_DEC;
  let byKey = byDec.get(dkey);
  if (!byKey) byDec.set(dkey, (byKey = new Map()));
  const key = mdtSeriesKey(set.id, fluid);
  let s = byKey.get(key);
  if (!s) {
    const st = pointStatuses(set, dec);
    // Profundidad corregida (puesta en profundidad del conjunto o de la corrida), ordenada: `xIsDepth` la exige.
    const z = shiftedDepth(set, dec);
    const idx = depthOrder(z).filter((i) => st[i]!.included && Number.isFinite(p[i]!));
    const x = Float64Array.from(idx, (i) => z[i]!);
    const y = Float64Array.from(idx, (i) => p[i]!);
    const ids = idx.map((i) => set.pointIds[i]!);
    const at = new Map(ids.map((id, k) => [id, k]));
    s = {
      ref: { provider: MDT_PROVIDER_ID, key },
      label: 'P',
      x,
      y,
      depth: x,
      xUnit: 'm',
      yUnit: (set.columns['pressure'] as { unit?: string } | undefined)?.unit ?? 'psi',
      xScale: 'linear',
      yScale: 'linear',
      xIsDepth: true,
      pointKey: (i) => ids[i]!,
      indexOfKey: (k) => at.get(k) ?? -1,
      placement: { overlayId: MDT_OVERLAY_ID },
      canvasLabel: 'gradient',
      pickSamples: false,
    };
    byKey.set(key, s);
  }
  return s;
}

export const mdtSeriesProvider: TrendSeriesProvider = {
  id: MDT_PROVIDER_ID,
  label: 'Presiones MDT',
  list(ctx) {
    const out: SeriesOption[] = [];
    for (const set of pressureSets(ctx.well.pointSets)) {
      const name = set.synthetic && !/sint[eé]tic/i.test(set.name) ? `${set.name} (ejemplo sintético)` : set.name;
      out.push({ key: mdtSeriesKey(set.id), label: `${name} · todos los puntos`, group: 'Presiones MDT', unit: 'psi' });
      for (const f of FLUIDS) out.push({ key: mdtSeriesKey(set.id, f), label: `${name} · gradiente de ${FLUID_LABEL[f].toLowerCase()}`, group: 'Presiones MDT', unit: 'psi' });
    }
    return out;
  },
  resolve(ctx, key) {
    const { setId, fluid } = parseMdtSeriesKey(key);
    const set = ctx.well.pointSets.find((s) => s.id === setId && s.kind === 'pressure');
    return set ? mdtSeries(set, ctx.interpretation, fluid) : null;
  },
};

export const seriesProviders: TrendSeriesProvider[] = [mdtSeriesProvider];

// ── análisis: gradientes por fluido y contactos ─────────────────────────────────────────────────────────────

export interface MdtGradient {
  spec: TrendSpec;
  /** Índice de la tendencia en `interpretation.trends` (color de paleta por orden). */
  index: number;
  setId: string;
  fluid: Fluid | null;
  series: ResolvedSeries | null;
  result: TrendResult | null;
  /** Densidad del fluido (g/cm³) a partir del gradiente; NaN sin ajuste. */
  density: number;
  suggestion: FluidSuggestion | null;
  /** El fluido elegido no coincide con el que sugiere la densidad. */
  mismatch: boolean;
}

export interface MdtAnalysis {
  sets: PointSet[];
  gradients: MdtGradient[];
  contacts: FluidContact[];
  /** Fluido de cada punto según el gradiente que lo usa: `<conjunto>|<punto>` → fluido. */
  fluidOfPoint: Map<string, { fluid: Fluid; trendId: string; name: string }>;
}

const analysisCache = new WeakMap<Well, WeakMap<Interpretation, MdtAnalysis>>();

export const pointRef = (setId: string, pointId: string) => `${setId}|${pointId}`;

/** Gradientes de presión del pozo (tendencias sobre series `mdt`) con densidad, fluido sugerido y contactos. */
export function mdtAnalysis(well: Well, interpretation: Interpretation): MdtAnalysis {
  let byI = analysisCache.get(well);
  if (!byI) analysisCache.set(well, (byI = new WeakMap()));
  const hit = byI.get(interpretation);
  if (hit) return hit;
  const sets = pressureSets(well.pointSets);
  const gradients: MdtGradient[] = [];
  const fluidOfPoint: MdtAnalysis['fluidOfPoint'] = new Map();
  interpretation.trends.forEach((spec, index) => {
    if (spec.series.provider !== MDT_PROVIDER_ID) return;
    const { setId, fluid } = parseMdtSeriesKey(spec.series.key);
    const set = sets.find((s) => s.id === setId);
    const series = set ? mdtSeries(set, interpretation, fluid) : null;
    const result = series ? evaluateTrend(spec, series, interpretation.zones) : null;
    const dens = result?.gradients.find((g) => g.unit.startsWith('g/cm³'))?.value ?? NaN;
    const suggestion = Number.isFinite(dens) ? classifyFluidByDensity(dens) : null;
    gradients.push({ spec, index, setId, fluid, series, result, density: dens, suggestion, mismatch: !!(fluid && suggestion?.fluid && !fluidFitsDensity(fluid, dens)) });
    // Puntos que usa este gradiente: su fluido.
    if (fluid && series && result?.span && spec.visible) {
      const [a, b] = result.span;
      const ex = excludedIndices(spec.selection.excluded, series);
      for (let i = 0; i < series.x.length; i++) {
        const z = series.x[i]!;
        if (z < a - 1e-9 || z > b + 1e-9 || ex.has(i)) continue;
        const k = pointRef(setId, series.pointKey(i));
        if (!fluidOfPoint.has(k)) fluidOfPoint.set(k, { fluid, trendId: spec.id, name: spec.name });
      }
    }
  });
  const lines: GradientLine[] = gradients
    .filter((g) => g.spec.visible && g.fluid && g.result?.coeffs && g.result.span)
    .map((g) => ({ id: g.spec.id, name: g.spec.name, fluid: g.fluid, coeffs: g.result!.coeffs!, span: g.result!.span! }));
  // Contactos por conjunto (dos corridas de MDT en compartimentos distintos no se cruzan entre sí).
  const contacts: FluidContact[] = [];
  for (const set of sets) {
    const ids = new Set(gradients.filter((g) => g.setId === set.id).map((g) => g.spec.id));
    contacts.push(...findContacts(lines.filter((l) => ids.has(l.id))));
  }
  const out: MdtAnalysis = { sets, gradients, contacts, fluidOfPoint };
  byI.set(interpretation, out);
  return out;
}
