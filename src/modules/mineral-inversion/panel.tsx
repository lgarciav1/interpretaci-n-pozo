/** Panel Geo-3 y activación explícita de su columna volumétrica en Geología. */
import { useProject } from '../../app/store/project';
import { updateTrackLayout, addTrack } from '../../core/state/tracks';
import type { TableValue } from '../../core/module';
import { layoutFor } from '../../viewer/templates';
import { Button, Callout, EmptyState, formatNumber } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { MineralCrossplotButton } from '../clay-typing/panel';
import { MINERAL_ZONES, VOLUME_ROLES, VOLUME_LABELS } from './index';
import { MineralParameters } from './parameters';
import { MINERAL_TRACK } from './track';

function MineralPanel(props: ModulePanelProps) {
  const { module, result } = props;
  const rows = (result?.outputs.find(o => o.moduleId === module.id && o.port === MINERAL_ZONES)?.value as TableValue | undefined)?.rows ?? [];
  const fmt = (v: unknown) => typeof v === 'number' ? formatNumber(100*v, { digits: 1 }) : '—';
  return <div className="mineral-panel">
    <MineralParameters {...props} />
    <div className="mineral-panel__actions">
      <MineralCrossplotButton template="pe-density">Ver PE–densidad</MineralCrossplotButton>
      <Button size="sm" variant="secondary" onClick={() => {
        useProject.getState().commit('Ver columna mineral en Geología', p => {
          const current = layoutFor('geology', p.display.layouts, p.display.look);
          if (current.some(t => t.id === MINERAL_TRACK.id && !t.hidden)) return p;
          return updateTrackLayout(p, 'geology', current, list => addTrack(list.filter(t => t.id !== MINERAL_TRACK.id), MINERAL_TRACK));
        });
      }}>Ver columna mineral</Button>
    </div>
    <Callout tone="info" title="Modelo de cinco componentes">Volúmenes bulk y fluido acuoso. Ajustá extremos de arcilla y GR; gas, barita y lavado pueden sesgar el resultado. Algunas respuestas minerales están SIN VERIFICAR.</Callout>
    {rows.some(r => typeof r.residual === 'number' && r.residual > 2) && <Callout tone="warn" title="Revisar compatibilidad de las herramientas">Hay zonas con residuo medio alto. Los volúmenes describen el mejor ajuste del modelo; no confirman la mineralogía. Revisá PE, calibración del neutrón, fluido y extremos de arcilla.</Callout>}
    {!rows.length ? <EmptyState size="sm" title="Sin inversión por zona" description="Hacen falta densidad, PE, neutrón, GR y zonas." /> : <div className="mineral-panel__table"><table>
      <thead><tr><th>Zona</th>{VOLUME_LABELS.map(l => <th key={l}>{l} %</th>)}<th>Residuo</th></tr></thead>
      <tbody>{rows.map(r => <tr key={String(r.zoneId)}><td>{r.zone}<small>{r.samples} válidas</small></td>{VOLUME_ROLES.map(role => <td key={role}>{fmt(r[role])}</td>)}<td>{typeof r.residual === 'number' ? formatNumber(r.residual, { digits: 2 }) : '—'}</td></tr>)}</tbody>
    </table></div>}
    <p className="mineral-panel__note">La columna conserva el cierre de los cinco componentes. El residuo es normalizado por herramienta; revisalo junto con el control de calidad y la corona.</p>
  </div>;
}
export const panel: ModulePanel = { moduleId: 'mineral-inversion', component: MineralPanel, mode: 'replace' };
