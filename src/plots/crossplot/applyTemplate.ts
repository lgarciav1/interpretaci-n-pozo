/**
 * Qué cambia en la configuración del crossplot al aplicar una plantilla (docs/decisiones/0014, D7). Puro: lo usan el
 * menú «Plantilla» del panel y la paleta de comandos (docs/decisiones/0018), así los dos hacen exactamente lo mismo.
 */
import type { CrossplotConfig, CrossplotTemplateId } from '../../core/plots';
import { keyForRole } from '../data';
import type { SeriesContext } from '../trend/series';
import { templateDef } from './templates';

export type TemplatePatch =
  | { ok: true; patch: Partial<CrossplotConfig>; label: string }
  | { ok: false; title: string; description: string };

/**
 * Ejes, escalas, rangos y color de la plantilla con las curvas del pozo (la medida con ese rol o la fuente activa). Si
 * al pozo le falta una de las dos curvas de los ejes, devuelve el motivo.
 */
export function crossplotTemplatePatch(ctx: SeriesContext, id: CrossplotTemplateId): TemplatePatch {
  const def = templateDef(id)!;
  const x = keyForRole(ctx, def.x.role);
  const y = keyForRole(ctx, def.y.role);
  if (!x || !y) {
    return { ok: false, title: `No se puede armar «${def.label}»`, description: `Hace falta ${!x ? def.x.role : def.y.role} en el pozo (medida o calculada).` };
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
      ...(color ? { color: { kind: 'curve' as const, curve: color } } : id === 'th-k' || id === 'pe-density' ? { color: { kind: 'zone' as const } } : {}),
    },
  };
}

