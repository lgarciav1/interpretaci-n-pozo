/** Paso 3 — Profundidad: amarres fila ↔ profundidad impresa (m o ft), método y resultado de la calibración. */
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Callout, IconButton, SegmentedControl, Section, TextField } from '../../../ui';
import { formatNumber, parseDecimal } from '../../../ui/format';
import { calibrationOf, depthInImageUnit, type TieDraft } from '../model/form';
import { useDigitizer } from '../store';
import { deskViewActions } from './DeskCanvas';
import { Kv, StepIntro, ToolButton } from './common';

function TieRow({ tie, index, estimate }: { tie: TieDraft; index: number; estimate: number }) {
  const unit = useDigitizer((s) => s.work.depthUnit);
  const focus = useDigitizer((s) => s.focusTieId === tie.id);
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!(focus && tie.depth === null)) return;
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [focus, tie.depth]);
  const commit = () => {
    if (draft === null) return;
    const v = draft.trim() === '' ? null : parseDecimal(draft);
    setDraft(null);
    if (v === undefined || (v !== null && !Number.isFinite(v))) return;
    useDigitizer.getState().updateWork((w) => ({ ...w, ties: w.ties.map((k) => (k.id === tie.id ? { ...k, depth: v } : k)) }));
  };
  const text = draft ?? (tie.depth === null ? '' : formatNumber(tie.depth, { digits: 2, grouping: false }));
  return (
    <li className={`dz-tie${focus ? ' is-focus' : ''}${tie.depth === null ? ' is-pending' : ''}`}>
      <button type="button" className="dz-tie__row" title="Centrar la vista en este amarre" onClick={() => (useDigitizer.getState().set({ focusTieId: tie.id }), deskViewActions.centerRow(tie.y))}>
        <span className="dz-tie__n num">{index + 1}</span>
        <span className="dz-tie__y num">fila {formatNumber(tie.y, { digits: 1 })}</span>
      </button>
      <TextField
        ref={ref}
        size="sm"
        value={text}
        inputMode="decimal"
        aria-label={`Profundidad del amarre ${index + 1}`}
        placeholder={Number.isFinite(estimate) ? `≈ ${formatNumber(estimate, { digits: 1, grouping: false })}` : 'profundidad'}
        suffix={unit}
        invalid={tie.depth === null}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            useDigitizer.getState().set({ focusTieId: null });
            // Listo para el próximo amarre: el foco vuelve a la mesa (la barra espaciadora vuelve a desplazar).
            e.currentTarget.blur();
          }
        }}
        style={{ width: 'calc(120px * var(--ui-scale))' }}
        data-testid={`digitizer-tie-depth-${index}`}
      />
      <IconButton icon="trash" size="sm" label={`Quitar amarre ${index + 1}`} onClick={() => useDigitizer.getState().updateWork((w) => ({ ...w, ties: w.ties.filter((k) => k.id !== tie.id) }))} />
    </li>
  );
}

export function StepDepth() {
  const work = useDigitizer((s) => s.work);
  const updateWork = useDigitizer((s) => s.updateWork);
  const state = calibrationOf(work);
  const cal = state.calibration;
  const mPerPx = cal ? Math.abs(cal.slopeMPerPx) : NaN;
  return (
    <>
      <StepIntro>Marcá filas con profundidad conocida (líneas rotuladas de la grilla) y escribí la profundidad impresa. Hacen falta al menos 2; con 3 o más se mide el residuo.</StepIntro>
      <div className="dz-grid2">
        <SegmentedControl
          aria-label="Unidad de profundidad del registro"
          size="sm"
          value={work.depthUnit}
          onChange={(v) => updateWork((w) => ({ ...w, depthUnit: v }))}
          options={[
            { value: 'm', label: 'Metros' },
            { value: 'ft', label: 'Pies' },
          ]}
        />
        <SegmentedControl
          aria-label="Método de calibración"
          size="sm"
          value={work.method}
          onChange={(v) => updateWork((w) => ({ ...w, method: v }))}
          options={[
            { value: 'piecewise', label: 'Por tramos', title: 'Lineal por tramos: pasa por todos los amarres (absorbe estiramientos del escaneo)' },
            { value: 'linear', label: 'Recta', title: 'Recta de mínimos cuadrados: promedia el error al marcar' },
          ]}
        />
      </div>
      <div className="dz-row">
        <ToolButton tool="tie" icon="plus" kbd="T" />
      </div>
      <Section title="Amarres" meta={<Badge tone={cal ? 'ok' : work.ties.length ? 'warn' : 'neutral'}>{work.ties.length}</Badge>}>
        {work.ties.length === 0 ? (
          <p className="dz-muted">Todavía no hay amarres. Activá «Marcar amarres» y hacé clic sobre una línea de profundidad rotulada.</p>
        ) : (
          <ol className="dz-ties">
            {work.ties.map((t, i) => (
              <TieRow key={t.id} tie={t} index={i} estimate={t.depth === null ? depthInImageUnit(cal, t.y) : NaN} />
            ))}
          </ol>
        )}
      </Section>
      {cal ? (
        <Callout tone={cal.warnings.length ? 'warn' : 'ok'} title="Profundidad calibrada">
          <Kv
            items={[
              ['Amarres', String(cal.ties.length)],
              ['Resolución', `${formatNumber(1 / mPerPx, { digits: 1 })} px/m`],
              ['Residuo (recta)', cal.ties.length >= 3 ? `${formatNumber(cal.rmsResidualPx, { digits: 2 })} px` : 'con 3 amarres o más'],
            ]}
          />
          {cal.warnings.map((w) => (
            <p key={w} className="dz-warn-line">
              {w}
            </p>
          ))}
          {1 / mPerPx < 10 && <p className="dz-warn-line">Menos de 10 px por metro: la profundidad de cada muestra será gruesa.</p>}
        </Callout>
      ) : (
        work.ties.length > 0 && (
          <Callout tone="warn" title={state.pending ? `Faltan ${state.pending} profundidades` : 'Calibración incompleta'}>
            {state.problems[0]}
          </Callout>
        )
      )}
      {work.ties.length > 0 && (
        <div>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => updateWork((w) => ({ ...w, ties: [] }))}>
            Quitar todos
          </Button>
        </div>
      )}
    </>
  );
}
