/** Panel de hidrocarburo móvil y residual: resumen por zona y acceso al crossplot Rt–Rxo (ADR 0091). */
import { computedCurves } from '../../app/computed';
import { commitPlotConfig } from '../../app/plots/connect';
import { plotContextOf } from '../../app/plots/context';
import { effectiveWell } from '../../app/preparation/data';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useResults } from '../../app/store/results';
import { useUi } from '../../app/store/ui';
import type { TableValue } from '../../core/module';
import { crossplotTemplatePatch } from '../../plots/crossplot/applyTemplate';
import { MHI_MOVABLE_SANDSTONE } from '../../petro/movability';
import { Badge, Button, EmptyState, formatNumber, toast, type Tone } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { CROSSPLOT_DOCK_ID } from '../crossplot/dock';
import { MOVABLE_SUMMARY } from './index';
import './panel.css';

const fmt = (v: unknown, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? formatNumber(v, { digits }) : '—');
const fmtPct = (v: unknown, digits = 0) => (typeof v === 'number' && Number.isFinite(v) ? `${formatNumber(v, { digits })} %` : '—');
const fmtFracPct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${formatNumber(v * 100, { digits: 0 })} %` : '—');

function mhiTone(v: unknown): Tone {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'neutral';
  if (v < MHI_MOVABLE_SANDSTONE) return 'ok';
  if (v < 0.85) return 'warn';
  return 'neutral';
}

function MovableHcPanel({ module, result }: ModulePanelProps) {
  const entry = useProject(selectActiveEntry);
  const rows = (result?.outputs.find((o) => o.moduleId === module.id && o.port === MOVABLE_SUMMARY)?.value as TableValue | undefined)?.rows ?? [];
  const wellRow = rows[0];
  const zoneRows = rows.slice(1);
  const resolvedCount = typeof wellRow?.resolvedSamples === 'number' ? wellRow.resolvedSamples : 0;

  const openRatioPlot = () => {
    if (!entry) return;
    const latest = useResults.getState().result;
    const ctx = plotContextOf(effectiveWell(entry.well, latest), entry.interpretation, computedCurves(latest, entry.well));
    const patch = crossplotTemplatePatch(ctx, 'rt-rxo');
    if (!patch.ok) {
      toast({ tone: 'warn', title: patch.title, description: patch.description });
      return;
    }
    commitPlotConfig('crossplot', patch.patch, patch.label);
    useUi.getState().openPanel(CROSSPLOT_DOCK_ID);
  };

  return (
    <div className="movable-panel" data-testid="movable-hc-panel">
      <div className="movable-panel__actions">
        <Button size="sm" variant="secondary" icon="scatter" block disabled={!entry} onClick={openRatioPlot} data-testid="movable-open-rt-rxo">
          Abrir crossplot Movilidad Rt–Rxo
        </Button>
      </div>

      {!wellRow || resolvedCount === 0 ? (
        <EmptyState
          size="sm"
          title="Sin invasión resuelta"
          description="Hace falta Rxo (medida o de «Invasión escalonada») junto con Sw y φe para separar hidrocarburo móvil y residual."
        />
      ) : (
        <>
          <div className="movable-panel__head">
            <Badge tone="neutral" variant="outline">
              Invasión resuelta {fmtPct(wellRow.resolvedPct, 1)}
            </Badge>
            <Badge tone={mhiTone(wellRow.mhiMean)} variant="soft">
              MHI medio {fmt(wellRow.mhiMean, 2)}
            </Badge>
          </div>

          <dl className="movable-panel__kv">
            <div className="movable-panel__metric">
              <dt>Sw medio</dt>
              <dd>{fmt(wellRow.swMean, 2)}</dd>
            </div>
            <div className="movable-panel__metric">
              <dt>Sxo medio</dt>
              <dd>{fmt(wellRow.sxoMean, 2)}</dd>
            </div>
            <div className="movable-panel__metric">
              <dt>MOS medio</dt>
              <dd>{fmt(wellRow.mosMean, 2)}</dd>
            </div>
            <div className="movable-panel__metric">
              <dt>Shr medio</dt>
              <dd>{fmt(wellRow.shrMean, 2)}</dd>
            </div>
            <div className="movable-panel__metric">
              <dt>HC móvil / Sh</dt>
              <dd>{fmtFracPct(wellRow.movableHcFrac)}</dd>
            </div>
            <div className="movable-panel__metric">
              <dt>Muestras</dt>
              <dd>{fmt(wellRow.resolvedSamples, 0)}</dd>
            </div>
          </dl>

          {zoneRows.length > 0 && (
            <div className="movable-panel__table">
              <table>
                <thead>
                  <tr>
                    <th>Zona</th>
                    <th className="num">Resuelta</th>
                    <th className="num">Sw</th>
                    <th className="num">Sxo</th>
                    <th className="num">MOS</th>
                    <th className="num">Móvil / Sh</th>
                    <th className="num">MHI</th>
                  </tr>
                </thead>
                <tbody>
                  {zoneRows.map((r, i) => (
                    <tr key={String(r.zoneId ?? i)}>
                      <td>{String(r.zone ?? '')}</td>
                      <td className="num">{fmtPct(r.resolvedPct, 0)}</td>
                      <td className="num">{fmt(r.swMean, 2)}</td>
                      <td className="num">{fmt(r.sxoMean, 2)}</td>
                      <td className="num">{fmt(r.mosMean, 2)}</td>
                      <td className="num">{fmtFracPct(r.movableHcFrac)}</td>
                      <td className="num">{fmt(r.mhiMean, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="movable-panel__note">
        En la columna volumétrica del visor, donde hay invasión resuelta el hidrocarburo se parte en móvil y residual; donde Rxo no tiene dato se dibuja el hidrocarburo entero sin huecos. Arrastrá la recta de agua en Rt–Rxo para calibrar Rmf / Rw sobre las arenas acuíferas.
      </p>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'movable-hc', component: MovableHcPanel };
