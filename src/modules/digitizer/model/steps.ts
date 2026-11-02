/**
 * Pasos de la mesa de digitalización y su estado (docs/decisiones/0063). Puro: el estado sale de lo marcado, no se
 * guarda aparte (salvo «revisado», «geometría omitida» y «importado/exportado»).
 */
/** Estados de la barra de pasos (mismos valores que `StepperStatus` de src/ui; acá sin importar la interfaz). */
export type StepStatus = 'done' | 'partial' | 'todo' | 'skipped' | 'empty' | 'locked';
import type { CalibrationState, WorkState } from './form';

export const STEPS = [
  { id: 'image', label: 'Imagen', short: 'Imagen' },
  { id: 'geometry', label: 'Geometría', short: 'Geom.' },
  { id: 'depth', label: 'Profundidad', short: 'Prof.' },
  { id: 'curves', label: 'Curvas', short: 'Curvas' },
  { id: 'review', label: 'Revisión', short: 'Rev.' },
  { id: 'output', label: 'Importar y exportar', short: 'Salida' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

export interface StepFacts {
  hasImage: boolean;
  geometryApplied: boolean;
  geometrySkipped: boolean;
  calibration: CalibrationState;
  work: WorkState;
  reviewed: boolean;
  delivered: boolean;
}

export interface StepState {
  id: StepId;
  label: string;
  short: string;
  status: StepStatus;
  /** Qué falta o qué está hecho (tooltip y panel). */
  hint: string;
}

export function stepStates(f: StepFacts): StepState[] {
  const traced = f.work.curves.filter((c) => c.trace).length;
  const cal = f.calibration.calibration;
  const out: Record<StepId, Pick<StepState, 'status' | 'hint'>> = {
    image: f.hasImage ? { status: 'done', hint: 'Imagen cargada.' } : { status: 'todo', hint: 'Cargá una imagen JPG, PNG o WebP.' },
    geometry: !f.hasImage
      ? { status: 'todo', hint: 'Primero cargá una imagen.' }
      : f.geometryApplied
        ? { status: 'done', hint: 'Imagen corregida.' }
        : f.geometrySkipped
          ? { status: 'skipped', hint: 'Sin corrección geométrica.' }
          : { status: 'todo', hint: 'Enderezá la imagen o omití el paso.' },
    depth: !f.hasImage
      ? { status: 'todo', hint: 'Primero cargá una imagen.' }
      : cal
        ? { status: 'done', hint: `${f.calibration.calibration!.ties.length} amarres.` }
        : f.work.ties.length > 0
          ? { status: 'partial', hint: f.calibration.problems[0] ?? 'Completá los amarres.' }
          : { status: 'todo', hint: 'Marcá al menos 2 amarres de profundidad.' },
    curves: !cal
      ? { status: 'todo', hint: 'Primero calibrá la profundidad.' }
      : traced > 0
        ? { status: traced === f.work.curves.length ? 'done' : 'partial', hint: `${traced} de ${f.work.curves.length} curvas trazadas.` }
        : f.work.curves.length > 0
          ? { status: 'partial', hint: 'Trazá la curva.' }
          : { status: 'todo', hint: 'Agregá una curva.' },
    review: traced === 0 ? { status: 'todo', hint: 'Primero trazá una curva.' } : f.reviewed ? { status: 'done', hint: 'Revisada.' } : { status: 'partial', hint: 'Revisá la calidad de las curvas.' },
    output: traced === 0 ? { status: 'todo', hint: 'Primero trazá una curva.' } : f.delivered ? { status: 'done', hint: 'Curvas importadas o exportadas.' } : { status: 'todo', hint: 'Agregá las curvas a un pozo o exportalas.' },
  };
  return STEPS.map((s) => ({ id: s.id, label: s.label, short: s.short, ...out[s.id] }));
}

/** Paso sugerido: el primero no resuelto. */
export function suggestedStep(states: readonly StepState[]): StepId | null {
  return states.find((s) => s.status !== 'done' && s.status !== 'skipped')?.id ?? null;
}
