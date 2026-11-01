/**
 * Qué cambia en la configuración del crossplot al aplicar una plantilla (docs/decisiones/0014, D7). Puro: lo usan el
 * menú «Plantilla» del panel y la paleta de comandos (docs/decisiones/0018), así los dos hacen exactamente lo mismo.
 */
import type { CrossplotConfig, CrossplotTemplateId } from '../../core/plots';
import { hiddenCurveReason, type HiddenCurve } from '../../core/toolString';
import { hiddenCurveOfRole, keyForRole, resolvePlotCurve } from '../data';
import type { SeriesContext } from '../trend/series';
import { templateDef } from './templates';

export type TemplatePatch =
  | { ok: true; patch: Partial<CrossplotConfig>; label: string }
  | { ok: false; title: string; description: string; /** Motivo corto para el menú («falta DT»). */ reason: string; /** La curva que falta está en el pozo pero la sarta la oculta. */ hidden?: HiddenCurve };

/**
 * Ejes, escalas, rangos y color de la plantilla con las curvas del pozo (la medida con ese rol o la fuente activa). Si
 * al pozo le falta una de las dos curvas de los ejes, devuelve el motivo.
 */
export function crossplotTemplatePatch(ctx: SeriesContext, id: CrossplotTemplateId): TemplatePatch {
  const def = templateDef(id)!;
  const x = keyForRole(ctx, def.x.role);
  const y = keyForRole(ctx, def.y.role);
  if (!x || !y) {
    const role = !x ? def.x.role : def.y.role;
    // La curva está en el pozo pero la sarta la oculta (0032): decir cuál herramienta prender, no «falta».
    const hidden = hiddenCurveOfRole(ctx, role);
    const description = hidden ? `${hidden.mnemonic === role ? role : `${hidden.mnemonic} (${role})`} está oculta: ${hiddenCurveReason(hidden).replace(/^L/, 'l')}` : `Hace falta ${role} en el pozo (medida o calculada).${def.needs ? ` ${def.needs}` : ''}`;
    return { ok: false, title: `No se puede armar «${def.label}»`, description, reason: hidden ? `${hidden.mnemonic} oculta por la sarta` : `falta ${role}`, ...(hidden ? { hidden } : {}) };
  }
  // Curva derivada que existe pero quedó sin dato (al módulo le faltan entradas): misma respuesta que si faltara.
  for (const [key, role] of [[x, def.x.role], [y, def.y.role]] as const) {
    const data = resolvePlotCurve(ctx, key)?.data;
    if (data && !data.some(Number.isFinite)) {
      return { ok: false, title: `No se puede armar «${def.label}»`, description: `${role} no tiene datos en este pozo.${def.needs ? ` ${def.needs}` : ''}`, reason: `${role} sin datos` };
    }
  }
  const color = def.colorRole ? keyForRole(ctx, def.colorRole) : null;
  return {
    ok: true,
    label: `Usar la plantilla ${def.label}`,
    patch: {
      x,
      y,
      xScale: def.x.scale,
      yScale: def.y.scale,
      xReversed: !!def.x.reversed,
      yReversed: !!def.y.reversed,
      xRange: def.x.range,
      yRange: def.y.range,
      template: id,
      ...(color ? { color: { kind: 'curve' as const, curve: color } } : def.zoneColor ? { color: { kind: 'zone' as const } } : {}),
    },
  };
}

