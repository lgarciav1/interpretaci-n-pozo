/**
 * Validación de una fuente elegida a mano para un puerto (`Interpretation.sources`). La usan el planificador del motor
 * (`planGraph`) y la disponibilidad de módulos de la sarta (`moduleAvailability`, docs/decisiones/0032): las dos tienen
 * que aceptar y rechazar exactamente las mismas elecciones, o el panel diría «disponible» de algo que el motor no corre.
 *
 * Puro: sin React ni stores.
 */
import type { SourceRef } from '../interpretation';
import { portOf } from '../module';
import type { Registry } from '../registry';
import type { RoleId } from '../roles';
import { getUnit, type UnitId } from '../units';

/** Lo que hace falta saber de una curva del pozo para validar una fuente explícita. */
export interface ExplicitCurveMeta {
  mnemonic: string;
  role: RoleId | null;
  /** Si falta, no se valida la dimensión. */
  unit?: UnitId;
}

/** Problema (en español) de una fuente explícita, o null si es válida. `curvesById` = curvas que ve el cálculo. */
export function validateExplicitSource(
  registry: Pick<Registry, 'roles' | 'get'>,
  curvesById: ReadonlyMap<string, ExplicitCurveMeta>,
  disabled: ReadonlySet<string>,
  port: string,
  ref: SourceRef,
): string | null {
  if (ref.kind === 'curve') {
    if (!registry.roles.has(port)) return `El puerto ${port} no es una curva: no puede tener como fuente una curva medida.`;
    const c = curvesById.get(ref.curveId);
    if (!c) return `La curva '${ref.curveId}' elegida para ${port} no existe en el pozo.`;
    // Con otro rol se admite, pero tiene que ser la misma magnitud (no se puede usar una densidad como Rt).
    const expected = getUnit(registry.roles.unitOf(port));
    const actual = c.unit !== undefined ? getUnit(c.unit) : undefined;
    if (c.role !== port && expected && actual && actual.dimension !== expected.dimension) {
      return `La curva '${c.mnemonic}' (${actual.label}) no puede ser ${port}: se esperaba una magnitud en ${expected.label}.`;
    }
    return null;
  }
  const m = registry.get(ref.moduleId);
  if (!m) return `El módulo '${ref.moduleId}' elegido para ${port} no existe.`;
  if (disabled.has(ref.moduleId)) return `El módulo '${m.name}' elegido para ${port} está desactivado.`;
  if (!Object.values(m.outputs).some((s) => portOf(s) === port)) return `El módulo '${m.name}' no produce ${port}.`;
  return null;
}
