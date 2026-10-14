/**
 * Pozo «según la sarta» para los gráficos, los selectores de curvas y las listas (docs/decisiones/0032, D9): el mismo
 * filtro que el motor y el visor (`visibleCurves`), aplicado una sola vez al armar el contexto de series. Así el
 * histograma, el crossplot (ejes, color, plantillas), las tendencias y los paneles de los módulos ven las mismas curvas
 * sin repetir la regla. Nunca se borra un dato: el pozo del proyecto no cambia y al prender la herramienta todo vuelve.
 */
import type { Interpretation } from '../../core/interpretation';
import { restrictQcReport, type QcReport } from '../../io';
import { hiddenCurves, type HiddenCurve } from '../../core/toolString';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import type { SeriesContext } from '../../plots/trend/series';
import type { ComputedCurve } from '../../viewer/resolve';
import { visibleCurves } from '../toolString/select';

const wellCache = new WeakMap<Well, { curves: readonly Curve[]; well: Well }>();
type Curve = Well['curves'][number];

/**
 * El pozo con solo las curvas que deja ver la sarta. EL MISMO objeto si no hay nada oculto, y el mismo objeto derivado
 * mientras no cambien el pozo ni la sarta (los memos y las cachés por identidad no se rompen).
 */
export function visibleWell(well: Well, interpretation: Pick<Interpretation, 'toolString'> | undefined): Well {
  const curves = visibleCurves(well, interpretation);
  if (curves === well.curves) return well;
  const hit = wellCache.get(well);
  if (hit && hit.curves === curves) return hit.well;
  const derived: Well = { ...well, curves: curves as Curve[] };
  wellCache.set(well, { curves, well: derived });
  return derived;
}

const hiddenCache = new WeakMap<readonly Curve[], { state: Interpretation['toolString']; hidden: ReadonlyMap<string, HiddenCurve> }>();

/** Curvas medidas que la sarta oculta, con su herramienta y el motivo (caché por identidad de curvas y sarta). */
export function hiddenCurvesOf(well: Well, interpretation: Pick<Interpretation, 'toolString'> | undefined): ReadonlyMap<string, HiddenCurve> {
  const state = interpretation?.toolString;
  const hit = hiddenCache.get(well.curves);
  if (hit && hit.state === state) return hit.hidden;
  const hidden = hiddenCurves(well.curves, state, registry.tools);
  hiddenCache.set(well.curves, { state, hidden });
  return hidden;
}

/** Contexto de series con el pozo según la sarta y las curvas ocultas (para explicar por qué no se ven). */
export function plotContextOf(well: Well, interpretation: Interpretation, computed: readonly ComputedCurve[]): SeriesContext {
  const hidden = hiddenCurvesOf(well, interpretation);
  return { well: visibleWell(well, interpretation), interpretation, computed, catalog: registry.roles, ...(hidden.size ? { hidden } : {}) };
}

/**
 * Control de calidad visto a través de la sarta (superposición de derrumbes del visor y de las figuras): sin las curvas
 * ocultas y sin los derrumbes si el caliper está oculto. El reporte completo sigue en el paso Calidad y en su informe.
 */
export function visibleQc(report: QcReport | null, well: Well, interpretation: Pick<Interpretation, 'toolString'> | undefined): QcReport | null {
  return report ? restrictQcReport(report, hiddenCurvesOf(well, interpretation)) : null;
}
