/**
 * Pestaña «Preparaciones guardadas» (0058): una tarjeta por receta del pozo con sus etapas, si el rol usa la
 * preparada o el original, y cómo quitar cada etapa o restaurar el original. Cada acción es un `commit` (un deshacer).
 */
import type { ClientResult } from '../../core/engine/client';
import { nodeFilter, nodeGapFill, nodeNormalization, nodeShift } from '../../core/preparation/state';
import { NORMALIZATION_METHOD_LABEL, normalizationAnchorsList } from '../../core/preparation/normalization';
import { preparedCurveId } from '../../core/preparation/source';
import { removeDepthShift, removeGapFill, removeMedianFilter, removeNormalization, restoreMaskInterval } from '../../core/state/preparation';
import { makeId, setSource, type Project, type WellEntry } from '../../core/state/project';
import { useProject } from '../../app/store/project';
import { Badge, Button, Callout, EmptyState, formatNumber } from '../../ui';
import { formatOffset } from './pipeline';

const show = (n: number) => (Number.isNaN(n) ? '—' : formatNumber(n, { digits: 2 }));

export function SavedPreparations({ entry, result, onError, onOpenCurve }: {
  entry: WellEntry;
  result: ClientResult | null;
  onError(message: string | null): void;
  onOpenCurve(curveId: string): void;
}) {
  const commit = useProject((s) => s.commit);
  const wellId = entry.well.id;
  const nodes = entry.interpretation.preparation?.nodes ?? [];
  const run = (label: string, recipe: (p: Project) => Project, group: string) => {
    try {
      commit(label, recipe, { group: makeId(group) });
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };
  if (!nodes.length) {
    return <EmptyState size="sm" icon="filter" title="Todavía no hay preparaciones guardadas" description="Elegí una curva arriba, abrí una herramienta y aplicá la vista previa: la receta queda acá, con el original intacto." />;
  }
  return (
    <section className="prep-saved" aria-label="Preparaciones guardadas">
      {nodes.map((node) => {
        const c = entry.well.curves.find((x) => x.id === node.input.curveId);
        const preparedId = preparedCurveId(node.id, 'masked');
        const source = c?.role ? entry.interpretation.sources[c.role] : undefined;
        const active = source?.kind === 'curve' && source.curveId === preparedId;
        const gapFill = nodeGapFill(node), filter = nodeFilter(node), shift = nodeShift(node), normalization = nodeNormalization(node);
        const stats = result?.preparation?.artifacts.find((a) => a.id === preparedId)?.normalization;
        const name = c?.mnemonic ?? node.input.curveId;
        return (
          <article className="prep-saved__card" key={node.id} aria-label={`Preparación de ${name}`}>
            <header className="prep-saved__head">
              <button type="button" className="prep-saved__name" onClick={() => c && onOpenCurve(c.id)} title="Ver en el gráfico">
                {name}
              </button>
              {c?.role && <Badge tone={active ? 'accent' : 'neutral'}>{active ? `En uso como ${c.role}` : 'Sin usar'}</Badge>}
              {node.kind === 'mgt-borehole' && <Badge tone="info">MGT</Badge>}
              <span className="prep-spacer" />
              {c?.role && (
                <Button size="sm" onClick={() => run(`Usar ${active ? 'original' : 'preparada'} de ${c.mnemonic}`, (p) => setSource(p, wellId, c.role!, { kind: 'curve', curveId: active ? c.id : preparedId }), 'source')}>
                  {active ? 'Usar original' : 'Usar preparada'}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="restore-view" onClick={() => run('Restaurar datos originales', (p) => restoreMaskInterval(p, wellId, node.id), 'restore')}>
                Restaurar original de {name}
              </Button>
            </header>
            {result?.preparation?.plan.diagnostics
              .filter((d) => d.nodeId === node.id && d.status === 'needs-input')
              .map((d) => (
                <Callout key={d.nodeId} tone="warn">
                  {d.message}
                </Callout>
              ))}
            <ul className="prep-saved__stages">
              {node.intervals.map((r) => (
                <li key={r.id}>
                  <span className="prep-saved__stage">Exclusión</span>
                  <span className="num">
                    {show(r.top)} – {show(r.base)} m MD
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => run('Restaurar datos originales', (p) => restoreMaskInterval(p, wellId, node.id, r.id), 'restore')} aria-label={`Restaurar exclusión ${r.id}`}>
                    Restaurar exclusión
                  </Button>
                </li>
              ))}
              {gapFill && (
                <li>
                  <span className="prep-saved__stage">Interpolación</span>
                  <span className="num">
                    {show(gapFill.top)} – {show(gapFill.base)} m MD · anclajes a ≤ {show(gapFill.maxGapM)} m
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => run('Quitar interpolación', (p) => removeGapFill(p, wellId, node.id), 'remove-fill')}>
                    Quitar interpolación
                  </Button>
                </li>
              )}
              {filter && (
                <li>
                  <span className="prep-saved__stage">Mediana</span>
                  <span className="num">
                    {show(filter.top)} – {show(filter.base)} m MD · radio {show(filter.radiusM)} m · separación ≤ {show(filter.maxStepM)} m
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => run('Quitar filtro', (p) => removeMedianFilter(p, wellId, node.id), 'remove-filter')}>
                    Quitar filtro
                  </Button>
                </li>
              )}
              {shift && (
                <li>
                  <span className="prep-saved__stage">Alineación</span>
                  <span className="num">
                    {formatOffset(shift.offsetM)} · datum {shift.datum} · hueco ≤ {show(shift.maxGapM)} m
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => run('Quitar alineación', (p) => removeDepthShift(p, wellId, node.id), 'remove-shift')}>
                    Quitar alineación
                  </Button>
                </li>
              )}
              {normalization && (
                <li>
                  <span className="prep-saved__stage">Normalización</span>
                  <span className="num">
                    {NORMALIZATION_METHOD_LABEL[normalization.method]} · {show(normalization.top)} – {show(normalization.base)} m MD ·{' '}
                    {(stats ? normalizationAnchorsList(normalization, stats) : normalizationAnchorsList(normalization, { sourceLow: NaN, sourceHigh: NaN }))
                      .map((a) => `P${formatNumber(a.percentile, { significant: 3 })}${stats ? ` ${formatNumber(a.source, { significant: 4 })}` : ''} → ${formatNumber(a.reference, { significant: 4 })}`)
                      .join(' · ')}
                    {c ? ` ${c.unit}` : ''}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => run('Quitar normalización', (p) => removeNormalization(p, wellId, node.id), 'remove-normalization')}>
                    Quitar normalización
                  </Button>
                </li>
              )}
              {node.kind === 'mgt-borehole' && (
                <li>
                  <span className="prep-saved__stage">MGT</span>
                  <span>Corrección de GR por pozo. Se retira en la pestaña Correcciones / MGT.</span>
                </li>
              )}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
