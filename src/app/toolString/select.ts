/**
 * Conexión de la sarta de perfilaje (docs/decisiones/0032) con la interfaz: curvas que ve el visor y disponibilidad de
 * módulos del pozo activo, con caché por identidad (curvas del pozo, estado de la sarta, módulos desactivados) para que
 * los memos de React no se rompan en cada render. La lógica está en `src/core/toolString.ts`.
 */
import type { Interpretation } from '../../core/interpretation';
import { availabilityReason, filterCurvesByToolString, moduleAvailability, resolveToolString, type AvailabilityReport, type ModuleAvailability, type ResolvedToolString } from '../../core/toolString';
import type { Curve, Well } from '../../core/well';
import { registry } from '../../modules';
import { selectActiveEntry, useProject } from '../store/project';

const visibleCache = new WeakMap<readonly Curve[], { state: Interpretation['toolString']; curves: readonly Curve[] }>();

/**
 * Curvas medidas que ven el visor, el catálogo de pistas y las figuras: sin las de herramientas apagadas (o fuera de la
 * sarta planificada). El mismo array del pozo si no hay nada excluido.
 */
export function visibleCurves(well: Well, interpretation: Pick<Interpretation, 'toolString'> | undefined): readonly Curve[] {
  const state = interpretation?.toolString;
  if (!state) return well.curves;
  const hit = visibleCache.get(well.curves);
  if (hit && hit.state === state) return hit.curves;
  const curves = filterCurvesByToolString(well.curves, state, registry.tools);
  visibleCache.set(well.curves, { state, curves });
  return curves;
}

export interface ToolStringView {
  resolved: ResolvedToolString;
  availability: AvailabilityReport;
  /** Disponibilidad de un módulo con su motivo en español ('' si está disponible). */
  status(moduleId: string): { availability: ModuleAvailability | undefined; reason: string };
}

let last: { curves: readonly Curve[]; state: Interpretation['toolString']; disabled: readonly string[]; view: ToolStringView } | null = null;

/** Sarta resuelta y disponibilidad de módulos de un pozo (caché de una entrada: la del pozo activo). */
export function toolStringView(well: Well, interpretation: Interpretation): ToolStringView {
  const state = interpretation.toolString;
  if (last && last.curves === well.curves && last.state === state && last.disabled === interpretation.disabled) return last.view;
  const resolved = resolveToolString(well.curves, state, registry.tools);
  const availability = moduleAvailability(registry, well.curves, resolved, { disabled: interpretation.disabled });
  const ctx = { tools: registry.tools, roles: registry.roles, resolved };
  const view: ToolStringView = {
    resolved,
    availability,
    status(moduleId) {
      const av = availability.modules.get(moduleId);
      return { availability: av, reason: av ? availabilityReason(av, ctx) : '' };
    },
  };
  last = { curves: well.curves, state, disabled: interpretation.disabled, view };
  return view;
}

/** Sarta y disponibilidad del pozo activo (null sin pozo). Barato: `toolStringView` cachea por identidad. */
export function useToolStringView(): ToolStringView | null {
  const entry = useProject(selectActiveEntry);
  return entry ? toolStringView(entry.well, entry.interpretation) : null;
}

/** Rótulo corto del estado de disponibilidad (insignias del panel de módulos). */
export const AVAILABILITY_LABEL = {
  available: 'disponible',
  'needs-data': 'sin datos',
  unavailable: 'no disponible',
  disabled: 'desactivado',
} as const;
