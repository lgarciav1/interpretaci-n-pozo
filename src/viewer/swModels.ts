/**
 * Pista «Modelos de Sw» (docs/decisiones/0018): Archie, Simandoux e Indonesia lado a lado, con una banda entre la
 * mínima y la máxima de los tres para ver dónde difieren. Puro.
 *
 * - Cada modelo es una entrada `{ role: 'SW', module }`: toma la salida de ESE módulo, la alimente o no a la cadena
 *   (el motor calcula las que no alimentan si están en `compare`).
 * - La banda es el relleno `range` sobre el rol SW de la pista (`curveEnvelope` en `resolve.ts`).
 * - La pista no está en la plantilla de fábrica: se agrega desde el catálogo de «Armar pistas» o con la acción
 *   «Mostrar modelos de Sw» (que además activa la comparación de los tres módulos).
 */
import type { TrackSpec } from '../core/display';
import { setCompare, type Project } from '../core/state/project';
import { addTrack, updateTrackLayout } from '../core/state/tracks';
import type { ComputedCurve } from './resolve';

export interface SwModel {
  moduleId: string;
  label: string;
  /** Color de la curva (se asegura contraste 3:1 contra el fondo de la pista en cada tema). */
  color: string;
  line: 'solid' | 'dashed' | 'dotted' | 'dashdot';
}

/**
 * Los tres modelos, en el orden en que se dibujan (el último queda arriba). Distinguibles por color Y por trazo
 * (azul continuo, naranja rayado, verde punteado): no depende solo del color.
 */
export const SW_MODELS: readonly SwModel[] = [
  { moduleId: 'sw-archie', label: 'Archie', color: '#1d4ed8', line: 'solid' },
  { moduleId: 'sw-simandoux', label: 'Simandoux', color: '#d9480f', line: 'dashed' },
  { moduleId: 'sw-indonesia', label: 'Indonesia', color: '#0f8a6c', line: 'dotted' },
];

export const SW_MODEL_IDS: readonly string[] = SW_MODELS.map((m) => m.moduleId);

/** Id de la pista de fábrica del catálogo (al agregarla recibe uno único). */
export const SW_MODELS_TRACK_ID = 'sw-models';

/** La pista (sin id propio al soltarla desde el catálogo). Escala 1 → 0 como la pista de Sw. */
export const SW_MODELS_TRACK: TrackSpec = {
  id: SW_MODELS_TRACK_ID,
  title: 'Modelos de Sw',
  kind: 'curves',
  width: 1.2,
  scale: { kind: 'linear', min: 0, max: 1, reversed: true },
  curves: SW_MODELS.map((m) => ({ select: { role: 'SW', module: m.moduleId }, style: { color: m.color, line: m.line, width: 1.6 } })),
  fills: [{ kind: 'range', curve: 'SW', fill: 'modelSpread', opacity: 1 }],
  emptyHint: 'Sin modelos de Sw calculados: hacen falta Rt, porosidad y Rw (y Vsh para Simandoux e Indonesia).',
};

/** ¿Es una pista de modelos de Sw (alguna entrada nombra a uno de los tres módulos)? */
export const isSwModelsTrack = (t: Pick<TrackSpec, 'curves'>): boolean =>
  (t.curves ?? []).some((e) => 'role' in e.select && e.select.module !== undefined && SW_MODEL_IDS.includes(e.select.module));

/** Qué curvas calculadas entran en la pista: las salidas SW de los tres módulos, en el orden de `SW_MODELS`. */
export function swModelCurves(computed: readonly ComputedCurve[]): ComputedCurve[] {
  const out: ComputedCurve[] = [];
  for (const m of SW_MODELS) {
    const c = computed.find((x) => x.port === 'SW' && x.moduleId === m.moduleId);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Módulos que hay que poner en comparación para que los tres tengan resultado: los que todavía no están en
 * `compare` y no son la fuente activa del puerto SW (esa ya corre porque alimenta la cadena).
 */
export function swModelsToCompare(compare: readonly string[], activeModuleId: string | null): string[] {
  return SW_MODEL_IDS.filter((id) => id !== activeModuleId && !compare.includes(id));
}

/**
 * Receta de «Mostrar modelos de Sw»: pone en comparación los módulos que faltan y agrega la pista después de la de
 * Porosidad · Sw (o, si no está, antes de la columna volumétrica; si tampoco, al final). Si el espacio ya tiene una
 * pista de modelos de Sw, solo activa la comparación. `current` = pistas que se ven hoy (propias o de fábrica, con
 * las de superposiciones). Devuelve el mismo proyecto si no hay nada que cambiar.
 */
export function showSwModelsRecipe(project: Project, wellId: string, workspace: string, current: readonly TrackSpec[], activeModuleId: string | null): Project {
  const compare = project.wells.find((w) => w.well.id === wellId)?.interpretation.compare ?? [];
  let out = project;
  for (const id of swModelsToCompare(compare, activeModuleId)) out = setCompare(out, wellId, id, true);
  return updateTrackLayout(out, workspace, current, (tracks) => {
    if (tracks.some(isSwModelsTrack)) return tracks;
    const at = tracks.findIndex((t) => t.id === 'saturation');
    const before = at >= 0 ? (tracks[at + 1]?.id ?? null) : (tracks.find((t) => t.id === 'volumetric')?.id ?? null);
    return addTrack(tracks, SW_MODELS_TRACK, before);
  });
}
