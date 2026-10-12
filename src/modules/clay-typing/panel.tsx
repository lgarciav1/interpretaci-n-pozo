/** Panel Geo-2: lectura por zona y acceso al crossplot persistente, coloreado por zonas. */
import { usePlotContext, commitPlotConfig } from '../../app/plots/connect';
import { useUi } from '../../app/store/ui';
import type { CrossplotTemplateId } from '../../core/plots';
import type { TableValue } from '../../core/module';
import { crossplotTemplatePatch } from '../../plots/crossplot/applyTemplate';
import { Button, Callout, EmptyState, formatNumber, toast } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { CLAY_ZONES } from './index';
import './panel.css';

export function MineralCrossplotButton({ template, children }: { template: CrossplotTemplateId; children: string }) {
  const ctx = usePlotContext();
  return <Button size="sm" variant="secondary" icon="scatter" disabled={!ctx} onClick={() => {
    if (!ctx) return;
    const result = crossplotTemplatePatch(ctx, template);
    if (!result.ok) { toast({ tone: 'warn', title: result.title, description: result.description }); return; }
    commitPlotConfig('crossplot', { ...result.patch, color: { kind: 'zone' }, zones: [] }, result.label);
    useUi.getState().set({ dockTab: 'crossplot' });
    useUi.getState().setLayout({ dockCollapsed: false });
  }}>{children}</Button>;
}

function ClayPanel({ module, result }: ModulePanelProps) {
  const rows = (result?.outputs.find(o => o.moduleId === module.id && o.port === CLAY_ZONES)?.value as TableValue | undefined)?.rows ?? [];
  const fmt = (v: unknown, digits = 1) => typeof v === 'number' ? formatNumber(v, { digits }) : '—';
  return <div className="mineral-panel">
    <MineralCrossplotButton template="th-k">Ver Th–K por zona</MineralCrossplotButton>
    <Callout tone="warn" title="Afinidades aproximadas">Regiones SIN VERIFICAR contra CP-19. Las superposiciones y las muestras exteriores requieren revisión del intérprete.</Callout>
    {!rows.length ? <EmptyState size="sm" title="Sin resumen por zona" description="Definí zonas y cargá K y Th para comparar sus afinidades." /> : <div className="mineral-panel__table"><table>
      <thead><tr><th>Zona</th><th>Afinidad dominante</th><th>Th/U</th><th>U alto</th></tr></thead>
      <tbody>{rows.map(r => <tr key={String(r.zoneId)}><td>{r.zone}</td><td>{r.clay}<small>{r.samples} muestras · distancia {fmt(r.distance, 3)}<br />{fmt(r.outside)} % fuera · {fmt(r.ambiguous)} % ambiguas</small></td><td>{fmt(r.ratio)}<small>{r.environment}</small></td><td>{fmt(r.highU)} %</td></tr>)}</tbody>
    </table></div>}
    <p className="mineral-panel__note">Th/U se interpreta por muestra; la media de zona es orientativa. Uranio alto puede acompañar materia orgánica o inundación máxima y también otras causas.</p>
  </div>;
}
export const panel: ModulePanel = { moduleId: 'clay-typing', component: ClayPanel };
