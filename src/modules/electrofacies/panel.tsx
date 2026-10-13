/** Panel de electrofacies: curva de BIC (o inercia) por k con el sugerido marcado (clic = elegir k) y tabla de grupos. */
import type { ReadonlyTableValue, TableValue } from '../../core/module';
import { Badge, Button, formatNumber, useResolvedTheme, useThemeTokens } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { efColor } from './draw';
import { decodeScan, EF_CLUSTERS_TABLE, EF_SCAN_TABLE, efParams, ELECTROFACIES_ID, METHOD_LABEL, SCORE_LABEL, scoreOf, suggestK } from './model';
import '../lithology-facies/panel.css';

const fmt = (v: unknown, digits: number) => (typeof v === 'number' && Number.isFinite(v) ? formatNumber(v, { digits }) : '—');

function ElectrofaciesPanel({ module, result, interpretation, setParam }: ModulePanelProps) {
  const theme = useResolvedTheme();
  const tokens = useThemeTokens();
  const find = (port: string) => result?.outputs.find((o) => o.port === port && o.active)?.value as TableValue | undefined;
  const scan = decodeScan(find(EF_SCAN_TABLE) as ReadonlyTableValue | undefined);
  const clusters = (result?.outputs.find((o) => o.moduleId === module.id && o.port === EF_CLUSTERS_TABLE)?.value as TableValue | undefined)?.rows ?? [];
  const { method, k: kParam } = efParams(interpretation.params);
  const scores = scan.map((r) => scoreOf(r, method));
  const suggested = suggestK(scan.map((r) => r.k), scores);
  const current = clusters.length || null;

  // Gráfico de barras: alto = mejora respecto del peor k (BIC o inercia más alto), para que se lea «más alto, mejor ajuste».
  const W = 280, H = 112, padB = 18, padT = 14;
  const finite = scores.filter(Number.isFinite);
  const hi = Math.max(...finite), lo = Math.min(...finite);
  const bw = scan.length ? (W / scan.length) * 0.62 : 0;
  return (
    <div className="facies-panel">
      <div className="facies-panel__heading">
        <span className="facies-panel__eyebrow">ELECTROFACIES · {METHOD_LABEL[method].toUpperCase()}</span>
        <Badge tone="info">Sin etiquetas</Badge>
      </div>
      <p className="facies-panel__note">Grupos de muestras con respuesta de perfiles parecida, numerados de menor a mayor GR. No son litologías: comparalos con la columna y con la litología sugerida.</p>
      <section className="facies-panel__section" aria-label="Elección de k">
        <div className="facies-panel__heading">
          <h4>Elección de k · {SCORE_LABEL[method]}</h4>
          {kParam !== 'auto' && <Button size="sm" variant="ghost" onClick={() => setParam('k', 'auto')}>Usar el sugerido</Button>}
        </div>
        {scan.length && finite.length ? (
          <svg className="facies-scan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${SCORE_LABEL[method]} por cantidad de electrofacies; sugerido k = ${suggested ?? '—'}`}>
            <line x1={0} x2={W} y1={H - padB + 0.5} y2={H - padB + 0.5} stroke={tokens.viewer.gridMajor} />
            {scan.map((r, i) => {
              const s = scores[i]!;
              const frac = hi > lo && Number.isFinite(s) ? (hi - s) / (hi - lo) : 0;
              const h = 3 + frac * (H - padB - padT - 3);
              const cx = (W / scan.length) * (i + 0.5);
              const isSug = r.k === suggested;
              const isCur = r.k === current;
              return (
                <g key={r.k} className="facies-scan__bar" tabIndex={0} role="button" aria-label={`Elegir k = ${r.k}`} onClick={() => setParam('k', String(r.k))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setParam('k', String(r.k)); }}>
                  <title>{`k = ${r.k} · ${SCORE_LABEL[method]} ${fmt(s, 0)}${isSug ? ' · sugerido' : ''}`}</title>
                  <rect x={cx - bw / 2} y={H - padB - h} width={bw} height={h} rx={2} fill={isCur ? tokens.color.accent : tokens.color.textMuted} opacity={isCur ? 1 : 0.35} />
                  {isSug && <text x={cx} y={H - padB - h - 4} textAnchor="middle" fontSize={9} fontWeight={600} fill={tokens.color.accent}>sugerido</text>}
                  <text x={cx} y={H - 5} textAnchor="middle" fontSize={10} fill={isCur ? tokens.color.text : tokens.color.textMuted} fontWeight={isCur ? 600 : 400}>{r.k}</text>
                </g>
              );
            })}
          </svg>
        ) : (
          <p className="facies-panel__note">Sin curva de elección de k (faltan curvas).</p>
        )}
        <p className="facies-panel__note">Alto de la barra: cuánto baja el {SCORE_LABEL[method]} respecto del peor k. El sugerido es el codo de la curva (o el mínimo del BIC si vuelve a subir). Tocá una barra para elegir k.</p>
      </section>
      {!!clusters.length && (
        <section className="facies-panel__section" aria-label="Grupos">
          <h4>Grupos · centro de cada uno</h4>
          <table>
            <thead><tr><th>Grupo</th><th>%</th><th>P</th><th>GR</th><th>ρb</th><th>φN</th><th>Rt</th></tr></thead>
            <tbody>
              {clusters.map((r, c) => (
                <tr key={c}>
                  <td><span className="facies-swatch" style={{ background: efColor(c, theme) }} />{String(r.facies)}</td>
                  <td className="num">{fmt(r.percent, 0)}</td>
                  <td className="num">{fmt(r.meanP, 2)}</td>
                  <td className="num">{fmt(r.gr, 0)}</td>
                  <td className="num">{fmt(r.rhob, 2)}</td>
                  <td className="num">{fmt(r.nphi, 2)}</td>
                  <td className="num">{fmt(r.rt, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

export const panel: ModulePanel = { moduleId: ELECTROFACIES_ID, component: ElectrofaciesPanel };
