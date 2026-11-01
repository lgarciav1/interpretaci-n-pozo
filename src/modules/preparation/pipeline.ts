/**
 * «Tubería» de preparación (0058): las etapas en el orden fijo del motor, con su estado y un conteo legible.
 * PURO: sin React ni DOM; lo dibuja `Pipeline.tsx`.
 *
 *   Original → Exclusión → Interpolación → Mediana → Alineación → Normalización → Preparada
 *
 * El estado de cada etapa sale de la receta guardada (`PreparationNode`) y, si hay una vista previa, de la receta
 * propuesta: la etapa que cambia queda «en vista previa» con los conteos del cálculo del motor. Los conteos vienen de
 * las banderas de calidad de la curva preparada (`Quality`); nunca se recalcula una etapa acá.
 */
import { maskRanges, nodeFilter, nodeGapFill, nodeNormalization, nodeShift, type PreparationNode } from '../../core/preparation/state';
import { Quality } from '../../core/preparation/quality';
import type { NormalizationStats } from '../../core/preparation/normalization';

export type StageId = 'original' | 'exclusion' | 'interpolation' | 'median' | 'alignment' | 'normalization' | 'prepared';
/** Herramientas del panel que abre cada etapa. */
export type ToolId = 'exclude' | 'suspects' | 'interpolate' | 'filter' | 'shift' | 'normalize';
/** done = aplicada; preview = cambia con la vista previa; idle = sin aplicar (opcional); blocked = no combinable. */
export type StageState = 'done' | 'preview' | 'idle' | 'blocked';

export interface PipelineStage {
  id: StageId;
  label: string;
  state: StageState;
  /** Conteo o valor corto: «412 excluidas», «+2,0 m», «Sin aplicar». */
  detail: string;
  /** Herramienta que abre (null = no tiene herramienta propia). */
  tool: ToolId | null;
}

/** Curva preparada calculada por el motor (resultado vigente o vista previa). */
export interface PreparedView {
  data: Float64Array;
  quality: Uint16Array;
  /** Conteos de las etapas previas al corrimiento (el corrimiento remuestrea y reasigna banderas). */
  sourceCounts?: { interpolated: number; filtered: number };
  /** Anclajes de la normalización (0060), si la receta normaliza. */
  normalization?: NormalizationStats;
}

export interface PipelineInput {
  /** Datos originales de la curva. */
  original: ArrayLike<number>;
  /** Receta guardada de la curva (si hay). */
  applied?: PreparationNode | undefined;
  appliedView?: PreparedView | null | undefined;
  /** Receta propuesta por la vista previa (si hay). */
  preview?: PreparationNode | undefined;
  previewView?: PreparedView | null | undefined;
  /** El rol de la curva usa la preparada. */
  inUse?: boolean;
  role?: string | null;
}

export const STAGE_LABELS: Readonly<Record<StageId, string>> = {
  original: 'Original',
  exclusion: 'Exclusión',
  interpolation: 'Interpolación',
  median: 'Mediana',
  alignment: 'Alineación',
  normalization: 'Normalización',
  prepared: 'Preparada',
};

const n = (v: number) => v.toLocaleString('es-AR');

/** Desplazamiento con signo y coma decimal: «+2,0 m», «−0,15 m». */
export function formatOffset(m: number): string {
  const sign = m > 0 ? '+' : m < 0 ? '−' : '';
  return `${sign}${Math.abs(m).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 3 })} m`;
}

export interface StageCounts {
  samples: number;
  originalMissing: number;
  /** Mediciones que pasan a sin dato por exclusión (no cuenta las que ya faltaban). */
  excluded: number;
  /** Faltantes originales estimados. */
  interpolated: number;
  filtered: number;
  /** Salidas alineadas con dato. */
  aligned: number;
  outOfDomain: number;
  /** Salidas normalizadas (bit 256) y, de ellas, fuera del dominio físico del rol. */
  normalized: number;
  normalizedOutOfDomain: number;
}

/** Conteos de una curva preparada (o del original, sin vista). */
export function stageCounts(original: ArrayLike<number>, view?: PreparedView | null): StageCounts {
  let originalMissing = 0;
  for (let i = 0; i < original.length; i++) if (Number.isNaN(original[i]!)) originalMissing++;
  const c: StageCounts = { samples: original.length, originalMissing, excluded: 0, interpolated: 0, filtered: 0, aligned: 0, outOfDomain: 0, normalized: 0, normalizedOutOfDomain: 0 };
  if (!view) return c;
  let shifted = false;
  for (let i = 0; i < view.quality.length; i++) {
    const q = view.quality[i]!;
    if (q & Quality.Excluded && !(q & Quality.OriginallyMissing)) c.excluded++;
    if (q & Quality.Interpolated && q & Quality.OriginallyMissing) c.interpolated++;
    if (q & Quality.Filtered) c.filtered++;
    if (q & Quality.OutOfDomain) c.outOfDomain++;
    if (q & Quality.Normalized) {
      c.normalized++;
      if (q & Quality.OutOfDomain) c.normalizedOutOfDomain++;
    }
    if (q & Quality.Shifted) {
      shifted = true;
      if (Number.isFinite(view.data[i]!)) c.aligned++;
    }
  }
  // Tras alinear, las banderas son las del soporte remuestreado: las etapas previas usan los conteos de origen.
  if (shifted && view.sourceCounts) {
    c.interpolated = view.sourceCounts.interpolated;
    c.filtered = view.sourceCounts.filtered;
  }
  return c;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Qué etapas difieren entre dos recetas (la vista previa cambia solo esas). */
export function changedStages(a: PreparationNode | undefined, b: PreparationNode | undefined): Set<StageId> {
  const out = new Set<StageId>();
  if (!sameJson(a ? maskRanges(a.intervals) : [], b ? maskRanges(b.intervals) : [])) out.add('exclusion');
  if (!sameJson(a && nodeGapFill(a), b && nodeGapFill(b))) out.add('interpolation');
  if (!sameJson(a && nodeFilter(a), b && nodeFilter(b))) out.add('median');
  if (!sameJson(a && nodeShift(a), b && nodeShift(b))) out.add('alignment');
  if (!sameJson(a && nodeNormalization(a), b && nodeNormalization(b))) out.add('normalization');
  if ((a?.kind === 'mgt-borehole') !== (b?.kind === 'mgt-borehole') || (a?.kind === 'mgt-borehole' && !sameJson(a, b))) out.add('prepared');
  return out;
}

/** Etapas en el orden fijo del motor, con estado y conteo. */
export function pipelineStages(input: PipelineInput): PipelineStage[] {
  const { applied, preview } = input;
  const showPreview = !!preview;
  const changed = showPreview ? changedStages(applied, preview) : new Set<StageId>();
  const node = showPreview ? preview : applied;
  const view = showPreview ? input.previewView : input.appliedView;
  const counts = stageCounts(input.original, view);
  const mgt = node?.kind === 'mgt-borehole';
  const stateOf = (id: StageId, has: boolean): StageState => (mgt && id !== 'original' && id !== 'prepared' ? 'blocked' : changed.has(id) ? 'preview' : has ? 'done' : 'idle');
  const idle = 'Sin aplicar';
  const pending = view ? null : 'Calculando…';
  const stages: PipelineStage[] = [];

  stages.push({
    id: 'original',
    label: STAGE_LABELS.original,
    state: 'done',
    detail: counts.originalMissing ? `${n(counts.originalMissing)} sin dato` : `${n(counts.samples)} muestras`,
    tool: null,
  });

  const intervals = node?.intervals.length ?? 0;
  const exState = stateOf('exclusion', intervals > 0);
  stages.push({
    id: 'exclusion',
    label: STAGE_LABELS.exclusion,
    state: exState,
    detail: exState === 'blocked' ? 'No combinable con MGT' : intervals ? (pending ?? `${n(counts.excluded)} excluidas`) : idle,
    tool: 'exclude',
  });

  const gap = node ? nodeGapFill(node) : undefined;
  const inState = stateOf('interpolation', !!gap);
  stages.push({
    id: 'interpolation',
    label: STAGE_LABELS.interpolation,
    state: inState,
    detail: inState === 'blocked' ? 'No combinable con MGT' : gap ? (pending ?? `${n(counts.interpolated)} estimadas`) : idle,
    tool: 'interpolate',
  });

  const filter = node ? nodeFilter(node) : undefined;
  const fiState = stateOf('median', !!filter);
  stages.push({
    id: 'median',
    label: STAGE_LABELS.median,
    state: fiState,
    detail: fiState === 'blocked' ? 'No combinable con MGT' : filter ? (pending ?? `${n(counts.filtered)} filtradas`) : idle,
    tool: 'filter',
  });

  const shift = node ? nodeShift(node) : undefined;
  const shState = stateOf('alignment', !!shift);
  stages.push({
    id: 'alignment',
    label: STAGE_LABELS.alignment,
    state: shState,
    detail: shState === 'blocked' ? 'No combinable con MGT' : shift ? formatOffset(shift.offsetM) : idle,
    tool: 'shift',
  });

  const normalization = node ? nodeNormalization(node) : undefined;
  const noState = stateOf('normalization', !!normalization);
  stages.push({
    id: 'normalization',
    label: STAGE_LABELS.normalization,
    state: noState,
    detail: noState === 'blocked' ? 'No combinable con MGT' : normalization ? (pending ?? `${n(counts.normalized)} normalizadas`) : idle,
    tool: 'normalize',
  });

  const prepared: PipelineStage = { id: 'prepared', label: STAGE_LABELS.prepared, state: 'idle', detail: 'Sin cambios', tool: null };
  if (showPreview) {
    prepared.state = 'preview';
    prepared.detail = 'Sin aplicar aún';
  } else if (applied) {
    prepared.state = 'done';
    prepared.detail = mgt ? (input.inUse ? 'Corregida por MGT · en uso' : 'Corregida por MGT') : input.inUse && input.role ? `En uso como ${input.role}` : input.role ? 'Guardada · sin usar' : 'Guardada';
  }
  stages.push(prepared);
  return stages;
}

/** Resumen de una línea de lo que falta (todas las etapas son opcionales). */
export function pipelineSummary(stages: readonly PipelineStage[]): string {
  const work = stages.filter((s) => s.id !== 'original' && s.id !== 'prepared');
  const done = work.filter((s) => s.state === 'done').length;
  const preview = work.filter((s) => s.state === 'preview').length;
  if (work.every((s) => s.state === 'blocked')) return 'Corrección MGT aplicada: retirala para usar las etapas de limpieza.';
  if (preview) return `${preview === 1 ? 'Una etapa' : `${preview} etapas`} en vista previa: revisá el gráfico y aplicá o descartá.`;
  if (!done) return 'Curva sin preparar. Todas las etapas son opcionales y se aplican en este orden.';
  const left = work.filter((s) => s.state === 'idle').map((s) => s.label.toLowerCase());
  return left.length ? `${done} de ${work.length} etapas aplicadas. Sin aplicar: ${left.join(', ')}.` : 'Todas las etapas aplicadas.';
}
