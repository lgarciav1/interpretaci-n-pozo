/** Piezas compartidas por los paneles de la mesa (docs/decisiones/0063). */
import type { ReactNode } from 'react';
import { Button, type SelectOption } from '../../../ui';
import type { IconName } from '../../../ui';
import { getUnit, listUnits, type UnitId } from '../../../core/units';
import { registry } from '../../index';
import { useDigitizer, type Tool } from '../store';

export const TOOL_LABEL: Record<Tool, string> = {
  pan: 'Mover',
  tilt: 'Marcar inclinación',
  quad: 'Marcar esquinas',
  tie: 'Marcar amarres',
  'edge-left': 'Borde izquierdo',
  'edge-right': 'Borde derecho',
  eyedropper: 'Cuentagotas',
  region: 'Dibujar región',
  guide: 'Dibujar guía',
  paint: 'Pintar traza',
  erase: 'Borrar tramo',
  add: 'Agregar puntos',
};

/** Qué hacer con cada herramienta (barra de estado). */
export const TOOL_HINT: Record<Tool, string> = {
  pan: 'Arrastrá para desplazar · rueda: zoom',
  tilt: 'Hacé clic en 2 puntos de una línea que debería ser vertical (p. ej. el borde de una pista)',
  quad: 'Hacé clic en las 4 esquinas en orden: arriba izquierda, arriba derecha, abajo derecha, abajo izquierda',
  tie: 'Clic sobre una línea de profundidad rotulada; escribí su profundidad en el panel · arrastrá un amarre para moverlo',
  'edge-left': 'Clic sobre el borde izquierdo de la pista (o una línea de grilla con valor conocido)',
  'edge-right': 'Clic sobre el borde derecho de la pista',
  eyedropper: 'Clic justo sobre el trazo de la curva para tomar su color',
  region: 'Arrastrá un rectángulo con el tramo de la pista donde buscar la curva',
  guide: 'Clic a lo largo de la curva (puntos aproximados) · doble clic o Enter para terminar · Retroceso borra el último',
  paint: 'Arrastrá a lo largo de la curva: cada fila toma la posición del puntero',
  erase: 'Arrastrá en vertical sobre el tramo a borrar',
  add: 'Clic para agregar puntos; cada punto se une con el anterior (Mayús+clic empieza otro tramo)',
};

/** Botón que activa una herramienta del lienzo (estado presionado visible). */
export function ToolButton({ tool, icon, children, disabled, kbd }: { tool: Tool; icon: IconName; children?: ReactNode; disabled?: boolean; kbd?: string }) {
  const current = useDigitizer((s) => s.tool);
  const on = current === tool;
  return (
    <Button
      size="sm"
      variant={on ? 'primary' : 'secondary'}
      icon={icon}
      aria-pressed={on}
      disabled={disabled}
      title={kbd ? `${TOOL_LABEL[tool]} (${kbd})` : TOOL_LABEL[tool]}
      onClick={() => {
        const st = useDigitizer.getState();
        const next = on ? 'pan' : tool;
        st.set({ tool: next, ...(next === 'tilt' || next === 'quad' ? { view: 'original' } : st.view === 'original' ? { view: 'corrected' } : {}) });
      }}
    >
      {children ?? TOOL_LABEL[tool]}
      {kbd && <kbd className="dz-kbd" aria-hidden="true">{kbd}</kbd>}
    </Button>
  );
}

export function roleOptions(): SelectOption[] {
  return [{ value: '', label: 'Sin rol' }, ...registry.roles.all().map((r) => ({ value: r.id, label: `${r.id} · ${r.label}` }))];
}

/** Unidades de la misma magnitud que la del rol (o todas), con la actual siempre presente. */
export function unitOptions(role: string | null, current: UnitId): SelectOption[] {
  const roleUnit = role ? registry.roles.get(role)?.unit : undefined;
  const dim = roleUnit ? getUnit(roleUnit)?.dimension : undefined;
  const list = listUnits(dim);
  const opts = list.map((u) => ({ value: u.id, label: u.label }));
  if (!opts.some((o) => o.value === current)) opts.unshift({ value: current, label: getUnit(current)?.label ?? current });
  return opts;
}

/** Fila «clave: valor» compacta. */
export function Kv({ items }: { items: readonly [ReactNode, ReactNode][] }) {
  return (
    <dl className="dz-kv">
      {items.map(([k, v], i) => (
        <div key={i} className="dz-kv__row">
          <dt>{k}</dt>
          <dd className="num">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StepIntro({ children }: { children: ReactNode }) {
  return <p className="dz-intro">{children}</p>;
}
