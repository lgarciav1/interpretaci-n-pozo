/**
 * Sección «Exponente de saturación n» del panel «Calibración» (docs/decisiones/0053): ensayo de índice de resistividad
 * de corona (pasos RI–Sw por plug), gráfico log–log RI–Sw con la recta ajustada por el origen (recomendada) y la libre,
 * n por plug con su casilla para descartarlo, «Aplicar n» y el resumen «Archie desde corona» (a y m del factor de
 * formación, n del índice de resistividad) con «Aplicar a, m y n» en una sola receta. Todo cambio va por `commit`.
 */
import { useMemo, useState } from 'react';
import type { Interpretation } from '../../core/interpretation';
import { addPointSet } from '../../core/state/pointSets';
import { activeWellEntry, makeId } from '../../core/state/project';
import type { Zone } from '../../core/well';
import { niceRange, type XYAxis } from '../../plots/xy/axes';
import type { XYLineLayer, XYPointLayer } from '../../plots/xy/layers';
import { XYPlot } from '../../plots/xy/XYPlot';
import { Badge, Button, Checkbox, DataTable, Select, SegmentedControl, formatNumber, toast, useThemeTokens, type Column } from '../../ui';
import { ensureContrast } from '../../ui/color';
import { useProject } from '../../app/store/project';
import type { PointSet } from '../../core/pointSets';
import { RUN_COLORS } from '../core/model';
import { LoadRiDialog } from './LoadRiDialog';
import { applyArchie, applySaturation, archieFits, CALIB_PARAMS, fitsParam, paramValue, plugCementation, roundedParam, zonesWithOwnValue, type PlugScope } from './model';
import { KPI, Legend } from './parts';
import { exampleRiSet } from './riExample';
import { riLine, riSaturation, riSets, setRiPlugIncluded, type RiPlugRow } from './saturation';

const f2 = (v: number | null | undefined) => formatNumber(v, { digits: 2 });
const f3 = (v: number | null | undefined) => formatNumber(v, { digits: 3 });
const r2Text = (v: number | null | undefined) => (v !== null && v !== undefined && v < 0 ? '< 0' : f2(v));
const activeWellId = () => activeWellEntry(useProject.getState().project)?.well.id ?? null;
const scopeText = (zones: readonly Zone[], zoneId: string | null) => {
  const z = zoneId ? zones.find((x) => x.id === zoneId) : undefined;
  return z ? `la zona ${z.name}` : 'todo el pozo';
};

/** Carga el ensayo RI–Sw de ejemplo (sintético) en el pozo activo. */
export function loadRiExample(): void {
  const w = activeWellId();
  if (!w) return;
  const set = exampleRiSet(makeId('ri'));
  useProject.getState().commit('Usar índice de resistividad de ejemplo', (p) => addPointSet(p, w, set));
  toast({
    tone: 'ok',
    title: 'Índice de resistividad de ejemplo cargado (sintético)',
    description: 'No son mediciones del pozo: cuatro plugs inventados, con los ids de los plugs de ejemplo, desaturados en nueve pasos.',
  });
}

type AMode = 'fixed' | 'free';

export function SaturationSection({ wellSets, interp, zoneId, coreSet, scope }: { wellSets: readonly PointSet[]; interp: Interpretation; zoneId: string | null; coreSet: PointSet | null; scope: PlugScope }) {
  const theme = useThemeTokens();
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [aMode, setAMode] = useState<AMode>('fixed');
  const sets = riSets(wellSets);
  const set = sets.find((s) => s.id === picked) ?? sets[0] ?? null;
  const dec = set ? interp.pointSets[set.id] : undefined;
  const sat = useMemo(() => (set ? riSaturation(set, dec) : null), [set, dec]);
  const zones = interp.zones;
  const target = scopeText(zones, zoneId);
  const nNow = paramValue(interp.params, CALIB_PARAMS.n, zoneId);
  const aNow = paramValue(interp.params, CALIB_PARAMS.a, zoneId);
  const mNow = paramValue(interp.params, CALIB_PARAMS.m, zoneId);
  const cem = useMemo(() => (coreSet ? plugCementation(coreSet, interp.pointSets[coreSet.id], aNow, scope) : null), [coreSet, interp.pointSets, aNow, scope.zones, scope.zoneId]);
  const dialog = loading && <LoadRiDialog onClose={() => setLoading(false)} onExample={loadRiExample} />;

  const origin = sat?.pooled.origin ?? null;
  const free = sat?.pooled.free ?? null;
  const nFit = origin?.n ?? NaN;
  const nRounded = roundedParam(CALIB_PARAMS.n, nFit);
  const nFits = fitsParam(CALIB_PARAMS.n, nFit);
  const nApplied = Number.isFinite(nRounded) && Math.abs(nRounded - nNow) < 1e-9;
  const nRange = `${f2(CALIB_PARAMS.n.spec.min)}–${f2(CALIB_PARAMS.n.spec.max)}`;

  const header = (
    <header className="ccal-col__head">
      <h3>Exponente de saturación n</h3>
      <span className="num" title={`Exponente de saturación vigente en ${target}`}>
        vigente n {f2(nNow)}
      </span>
    </header>
  );

  if (!set || !sat) {
    return (
      <section className="ccal-col" aria-label="Exponente de saturación n">
        {header}
        <p className="ccal-empty">
          El exponente n sale del ensayo de índice de resistividad de los plugs: pares de saturación de agua e índice de resistividad (Rt/Ro) medidos al desaturar cada plug. Cargá la tabla del laboratorio o usá el ensayo de ejemplo.
        </p>
        <div className="ccal-row">
          <Button size="sm" variant="primary" icon="upload" onClick={() => setLoading(true)}>
            Cargar RI–Sw
          </Button>
          <Button size="sm" icon="play" onClick={loadRiExample} title="Ensayo inventado para practicar: no son mediciones del pozo">
            Usar ensayo de ejemplo
          </Button>
        </div>
        {dialog}
      </section>
    );
  }

  const own = !zoneId ? zonesWithOwnValue(interp, CALIB_PARAMS.n) : [];
  const ownText = own.length ? ` Las zonas ${own.map((z) => z.name).join(', ')} tienen un valor propio y no cambian.` : '';
  const zoneLabel = zoneId ? ` a la zona ${zones.find((z) => z.id === zoneId)?.name}` : ' al pozo';
  const applyN = () => {
    const w = activeWellId();
    if (!w || !nFits) return;
    useProject.getState().commit(`Aplicar n de la corona${zoneLabel}`, (p) => applySaturation(p, w, nFit, zoneId));
    toast({ tone: 'ok', title: `n = ${f2(nRounded)}`, description: `Los modelos de saturación de ${target} usan ahora este exponente.${ownText}` });
  };

  // Gráfico log–log: Sw en x, RI en y; un color por plug.
  const plugIndex = new Map(sat.plugs.map((p, k) => [p.plug, k]));
  const plugOfIdx = new Map<number, string>();
  for (const p of sat.plugs) for (const i of p.idx) plugOfIdx.set(i, p.plug);
  // Colores de las coronas, con el violeta al final: se confunde con la recta ajustada (acento).
  const base = RUN_COLORS[theme.name === 'dark' ? 'dark' : 'light'];
  const palette = [base[0]!, base[1]!, base[2]!, base[4]!, base[3]!];
  const colorOf = (plug: string) => ensureContrast(palette[(plugIndex.get(plug) ?? 0) % palette.length]!, theme.viewer.trackBg, 3);
  const ok = sat.idx.map((_, j) => j).filter((j) => sat.sw[j]! > 0 && sat.sw[j]! <= 1 && sat.ri[j]! > 0);
  const xr = niceRange([Float64Array.from(ok, (j) => sat.sw[j]!)], 'log');
  const yr = niceRange([Float64Array.from(ok, (j) => sat.ri[j]!)], 'log');
  const x: XYAxis = { kind: 'log', min: Math.max(0.01, Math.min(xr?.min ?? 0.1, 0.2)), max: 1, label: 'Saturación de agua Sw', unit: 'v/v' };
  const y: XYAxis = { kind: 'log', min: 1, max: Math.max(10, yr?.max ?? 10), label: 'Índice de resistividad RI' };
  const fitColor = theme.color.accent;
  const freeColor = ensureContrast(theme.color.warn, theme.viewer.trackBg, 3);
  const nowColor = theme.color.textMuted;
  const pts: XYPointLayer[] = [
    {
      id: 'ri',
      name: 'Pasos de desaturación',
      x: Float64Array.from(ok, (j) => sat.sw[j]!),
      y: Float64Array.from(ok, (j) => sat.ri[j]!),
      color: (k) => colorOf(plugOfIdx.get(sat.idx[ok[k]!]!) ?? ''),
      interactive: true,
      radius: 3.5,
      label: (k) => {
        const j = ok[k]!;
        return `${plugOfIdx.get(sat.idx[j]!) ?? ''} · Sw ${f3(sat.sw[j])} · RI ${formatNumber(sat.ri[j], { significant: 3 })}`;
      },
    },
  ];
  const lines: XYLineLayer[] = [{ id: 'now', name: `Vigente (n ${f2(nNow)})`, ...riLine(nNow, 1, x.min, x.max), color: nowColor, width: 1.25, dash: [3, 3] }];
  if (free) lines.push({ id: 'free', name: 'Ajuste libre', ...riLine(free.n, free.intercept, x.min, x.max), color: freeColor, width: 1.5, dash: [6, 3] });
  if (origin) lines.push({ id: 'origin', name: 'Ajuste por el origen', ...riLine(origin.n, 1, x.min, x.max), color: fitColor, width: 2, label: `n ${f2(origin.n)}`, labelAt: 'start' });

  const toggle = (p: RiPlugRow, on: boolean) => {
    const w = activeWellId();
    if (w) useProject.getState().commit(on ? `Incluir el plug ${p.plug} en n` : `Descartar el plug ${p.plug} de n`, (pr) => setRiPlugIncluded(pr, w, set, p.plug, on));
  };
  const hasLab = sat.plugs.some((p) => Number.isFinite(p.nLab));
  const plugColumns: Column<RiPlugRow>[] = [
    {
      key: 'inc',
      header: '',
      title: 'Incluir el plug en el ajuste',
      width: 28,
      render: (p) => <Checkbox checked={p.included} onChange={(on) => toggle(p, on)} aria-label={`Incluir el plug ${p.plug}`} />,
    },
    {
      key: 'plug',
      header: 'Plug',
      render: (p) => (
        <span className="ccal-plug">
          <span className="ccal-plug__dot" style={{ ['--mark' as string]: colorOf(p.plug) }} aria-hidden="true" />
          <span className="mono">{p.plug}</span>
        </span>
      ),
    },
    { key: 'steps', header: 'Pasos', align: 'num', render: (p) => String(p.fit.count) },
    { key: 'swmin', header: 'Sw mín.', title: 'Saturación de agua mínima alcanzada en la desaturación', align: 'num', render: (p) => f2(p.swMin) },
    { key: 'n', header: 'n', title: 'Ajuste por el origen de los pasos del plug (con un solo paso, el n puntual)', align: 'num', render: (p) => <strong>{f2(p.fit.origin?.n)}</strong> },
    { key: 'r2', header: 'R²', align: 'num', render: (p) => (p.fit.count > 2 ? r2Text(p.fit.origin?.r2) : '—') },
    ...(hasLab ? [{ key: 'lab', header: 'n lab', title: 'n informado por el laboratorio (valor absoluto)', align: 'num' as const, render: (p: RiPlugRow) => f2(p.nLab) }] : []),
  ];

  // Resumen «Archie desde corona».
  const fixed = cem?.fixedA ?? null;
  const freeA = cem?.freeA ?? null;
  const am = aMode === 'free' && freeA ? { a: freeA.a, m: freeA.m } : fixed ? { a: fixed.a, m: fixed.m } : null;
  const trio = am && origin ? { a: am.a, m: am.m, n: origin.n } : null;
  const trioFits = !!trio && archieFits(trio);
  const trioRounded = trio ? { a: roundedParam(CALIB_PARAMS.a, trio.a), m: roundedParam(CALIB_PARAMS.m, trio.m), n: roundedParam(CALIB_PARAMS.n, trio.n) } : null;
  const trioApplied = !!trioRounded && Math.abs(trioRounded.a - aNow) < 1e-9 && Math.abs(trioRounded.m - mNow) < 1e-9 && Math.abs(trioRounded.n - nNow) < 1e-9;
  const applyTrio = () => {
    const w = activeWellId();
    if (!w || !trio || !trioFits) return;
    useProject.getState().commit(`Aplicar a, m y n de la corona${zoneLabel}`, (p) => applyArchie(p, w, trio, zoneId));
    toast({ tone: 'ok', title: `a = ${f2(trioRounded!.a)} · m = ${f2(trioRounded!.m)} · n = ${f2(trioRounded!.n)}`, description: `Los modelos de saturación de ${target} usan ahora los tres parámetros de la corona.` });
  };
  const missingAm = !coreSet ? 'Faltan plugs con factor de formación (panel Corona) para a y m.' : !fixed ? 'Los plugs no tienen factor de formación: a y m no se pueden calibrar.' : null;

  const freeIntercept = free ? free.intercept : NaN;
  const offOrigin = Number.isFinite(freeIntercept) && Math.abs(Math.log(freeIntercept)) > Math.log(1.15);

  return (
    <section className="ccal-col" aria-label="Exponente de saturación n">
      {header}
      <div className="ccal-row">
        {sets.length > 1 ? <Select size="sm" aria-label="Ensayo de índice de resistividad" value={set.id} options={sets.map((s) => ({ value: s.id, label: s.name }))} onChange={setPicked} /> : <span className="ccal-bar__name">{set.name}</span>}
        {set.synthetic && (
          <Badge tone="warn" icon="warning" title="Ensayo inventado para practicar: no son mediciones del pozo">
            Ejemplo sintético
          </Badge>
        )}
        <span className="shell-spacer" />
        <Button size="sm" variant="ghost" icon="upload" onClick={() => setLoading(true)} title="Cargar otra tabla de índice de resistividad">
          Cargar
        </Button>
      </div>
      {!origin ? (
        <p className="ccal-empty">Ningún paso válido (Sw entre 0 y 1, sin contar Sw = 1, y RI positivo) en los plugs incluidos: incluí algún plug o revisá la unidad de Sw.</p>
      ) : (
        <>
          <div className="ccal-kpis">
            <KPI label="n (por el origen)" value={f2(origin.n)} title="Recta por (Sw = 1, RI = 1) en log RI – log Sw: la recomendada" />
            <KPI label="R²" value={r2Text(origin.r2)} title="De log RI con la recta por el origen" />
            <KPI label="Pasos · plugs" value={`${origin.count} · ${sat.plugs.filter((p) => p.included).length}`} title="Pasos de desaturación válidos y plugs incluidos" />
          </div>
          <XYPlot
            height={210}
            className="ccal-plot"
            figureId="core-calibration-ri"
            figureTitle="Índice de resistividad contra saturación de agua"
            data-testid="ccal-ri-plot"
            ariaLabel={`Índice de resistividad contra saturación de agua en escala log–log, ${origin.count} pasos, con la recta por el origen n ${f2(origin.n)}`}
            x={x}
            y={y}
            points={pts}
            lines={lines}
          />
          <Legend
            items={[
              { color: fitColor, label: 'por el origen' },
              ...(free ? [{ color: freeColor, label: 'libre', dash: true }] : []),
              { color: nowColor, label: 'vigente', dash: true },
            ]}
          />
          <dl className="ccal-facts num">
            <dt title="Recta con ordenada: RI en Sw = 1 libre (debería dar ≈ 1)">Libre</dt>
            <dd>{free ? `n ${f2(free.n)} · RI en Sw = 1: ${f2(free.intercept)} · R² ${r2Text(free.r2)}` : 'hacen falta al menos 3 pasos con Sw distinta'}</dd>
            <dt title="Promedio de los n de cada plug incluido">Media por plug</dt>
            <dd>
              n {f2(sat.meanPerPlug.n)} · {sat.meanPerPlug.count} {sat.meanPerPlug.count === 1 ? 'plug' : 'plugs'}
            </dd>
          </dl>
          {offOrigin && <p className="ccal-warn">La recta libre no pasa por RI = 1 en Sw = 1: puede haber un error en Ro o conducción por arcillas. Se recomienda el n por el origen.</p>}
          {(origin.n < 1.5 || origin.n > 3) && nFits && <p className="ccal-warn">n fuera de 1,5–3: revisá la unidad de Sw o la mojabilidad de la roca (mojable al petróleo da n alto).</p>}
          {!nFits && <p className="ccal-warn">n {f2(origin.n)} queda fuera del rango del control ({nRange}): no se puede aplicar.</p>}
          <div className="ccal-apply">
            <Button size="sm" variant={nApplied ? 'secondary' : 'primary'} icon="check" disabled={!nFits || nApplied} onClick={applyN} data-testid="ccal-apply-n" title={`Escribe el exponente de saturación de los modelos de Sw en ${target}`}>
              {nApplied ? 'n aplicado' : `Aplicar n ${f2(nRounded)}`}
            </Button>
            <span className="ccal-apply__now num">
              Vigente en {target}: <strong>{f2(nNow)}</strong>
            </span>
          </div>
        </>
      )}
      <DataTable dense className="ccal-ri-table" data-testid="ccal-ri-plugs" caption="Exponente n por plug" maxHeight={180} rows={sat.plugs} rowKey={(p) => p.plug} columns={plugColumns} />

      <div className="ccal-mcard ccal-archie" aria-label="Archie desde corona">
        <div className="ccal-row">
          <div className="ccal-mcard__title">Archie desde corona</div>
          <span className="shell-spacer" />
          <SegmentedControl<AMode>
            size="sm"
            aria-label="a y m del factor de formación"
            value={aMode === 'free' && freeA ? 'free' : 'fixed'}
            options={[
              { value: 'fixed', label: 'a fija', title: `a vigente (${f2(aNow)}) y m por el origen` },
              { value: 'free', label: 'a libre', title: freeA ? 'a y m ajustados juntos' : 'Hacen falta al menos 3 plugs con F', disabled: !freeA },
            ]}
            onChange={setAMode}
          />
        </div>
        <div className="ccal-trio num">
          <div className="ccal-trio__item">
            <span className="ccal-trio__label">a</span>
            <span className="ccal-trio__value">{am ? f2(am.a) : '—'}</span>
            <span className="ccal-trio__now">vigente {f2(aNow)}</span>
          </div>
          <div className="ccal-trio__item">
            <span className="ccal-trio__label">m</span>
            <span className="ccal-trio__value">{am ? f2(am.m) : '—'}</span>
            <span className="ccal-trio__now">vigente {f2(mNow)}</span>
          </div>
          <div className="ccal-trio__item">
            <span className="ccal-trio__label">n</span>
            <span className="ccal-trio__value">{origin ? f2(origin.n) : '—'}</span>
            <span className="ccal-trio__now">vigente {f2(nNow)}</span>
          </div>
        </div>
        {missingAm && <p className="ccal-empty is-tight">{missingAm}</p>}
        {trio && !trioFits && <p className="ccal-warn">Alguno de los tres queda fuera del rango de su control: no se aplican.</p>}
        <div className="ccal-mcard__actions">
          <Button size="sm" variant={trioApplied ? 'secondary' : 'primary'} icon="check" disabled={!trioFits || trioApplied} onClick={applyTrio} data-testid="ccal-apply-amn" title={`Escribe a, m y n de los modelos de Sw en ${target}, en un solo paso (un Ctrl+Z)`}>
            {trioApplied ? 'a, m y n aplicados' : 'Aplicar a, m y n'}
          </Button>
        </div>
      </div>
      {dialog}
    </section>
  );
}
