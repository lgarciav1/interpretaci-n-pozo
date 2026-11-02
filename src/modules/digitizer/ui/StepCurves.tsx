/**
 * Paso 4 — Curvas: agregar curva, bordes de su pista con valores y escala, color (cuentagotas, sugeridos o negro sobre
 * claro), región de búsqueda, modo automático o guiado, «Trazar» con progreso y cancelación, edición manual y
 * suavizado/picos opcionales.
 */
import { useState } from 'react';
import { DEFAULT_COLOR_TOLERANCE, type CurveColorSpec } from '../../../digitizer';
import { Badge, Button, Callout, Chip, Field, IconButton, NumberField, SegmentedControl, Section, Select, SliderField, Switch, TextField } from '../../../ui';
import { suggestRole } from '../../../io/mnemonics';
import { formatNumber } from '../../../ui/format';
import { registry } from '../../index';
import { cancelJob, showMask, suggestColors, traceCurve } from '../actions';
import { calibrationOf, inkColor, newCurveDraft, rgbHex, scaleForRole, specOf, updateCurve, type CurveDraft } from '../model/form';
import { tracedRows } from '../model/traceEdit';
import { useDigitizer } from '../store';
import { StepIntro, ToolButton, roleOptions, unitOptions } from './common';

/** Valores de escala tal como se imprimen (0,45 · −0,15 · 2000), sin redondear a enteros. */
const fmtScale = (v: number) => formatNumber(v, { significant: 6, grouping: false });

const QUICK = ['GR', 'SP', 'CALI', 'NPHI', 'RHOB', 'DT', 'ILD', 'ILM', 'LLD', 'MSFL'];

export function CurveSwatchDot({ c }: { c: CurveDraft }) {
  const ink = inkColor(c);
  return <span className={`dz-dot${ink ? '' : ' dz-dot--dark'}`} style={ink ? { background: ink } : undefined} aria-hidden="true" />;
}

function AddCurve() {
  const [name, setName] = useState('');
  const add = (mnemonic: string, from?: HTMLElement) => {
    // El foco vuelve a la mesa: el próximo paso es hacer clic en el lienzo (y la barra espaciadora debe desplazar).
    from?.blur();
    const m = mnemonic.trim().toUpperCase();
    if (!m) return;
    const st = useDigitizer.getState();
    const c = newCurveDraft(m, registry.roles, st.work.curves.length);
    // La nueva hereda la pista de la anterior: lo común es que varias curvas compartan pista.
    const prev = st.work.curves[st.work.curves.length - 1];
    const draft = prev && prev.leftPx !== null && prev.rightPx !== null ? { ...c, leftPx: prev.leftPx, rightPx: prev.rightPx } : c;
    st.updateWork((w) => ({ ...w, curves: [...w.curves, draft] }));
    st.set({ selectedCurveId: draft.id, tool: draft.leftPx === null ? 'edge-left' : 'eyedropper', view: 'corrected' });
    setName('');
  };
  return (
    <div className="dz-add">
      <div className="dz-row">
        <TextField size="sm" value={name} onChange={setName} placeholder="Mnemónico (GR, NPHI…)" aria-label="Mnemónico de la curva nueva" onKeyDown={(e) => e.key === 'Enter' && add(name, e.currentTarget)} data-testid="digitizer-new-curve" />
        <Button size="sm" icon="plus" variant="primary" onClick={() => add(name || `CURVA${useDigitizer.getState().work.curves.length + 1}`)}>
          Agregar curva
        </Button>
      </div>
      <div className="dz-chips" aria-label="Agregar una curva habitual">
        {QUICK.map((q) => (
          <Chip key={q} onClick={() => add(q)} title={`Agregar ${q}`}>
            {q}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function CurveList() {
  const curves = useDigitizer((s) => s.work.curves);
  const sel = useDigitizer((s) => s.selectedCurveId);
  const set = useDigitizer((s) => s.set);
  if (!curves.length) return null;
  return (
    <ul className="dz-curves" role="listbox" aria-label="Curvas">
      {curves.map((c) => (
        <li key={c.id}>
          <button type="button" role="option" aria-selected={c.id === sel} className={`dz-curve${c.id === sel ? ' is-selected' : ''}`} onClick={() => set({ selectedCurveId: c.id, mask: null })}>
            <CurveSwatchDot c={c} />
            <span className="dz-curve__name">{c.mnemonic}</span>
            <span className="dz-curve__meta">{c.trace ? `${tracedRows(c.trace).toLocaleString('es-AR')} filas` : c.leftPx === null ? 'sin pista' : !c.color ? 'sin color' : 'sin trazar'}</span>
            {c.trace ? <Badge tone="ok">trazada</Badge> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ColorSection({ c }: { c: CurveDraft }) {
  const sug = useDigitizer((s) => s.suggestions[c.id]);
  const updateWork = useDigitizer((s) => s.updateWork);
  const setColor = (color: CurveColorSpec | null) => {
    updateWork((w) => updateCurve(w, c.id, { color }));
    useDigitizer.getState().set({ mask: null });
  };
  const dark = c.color?.mode === 'dark';
  return (
    <Section
      title="Color del trazo"
      meta={c.color ? <span className="dz-swatch-label"><CurveSwatchDot c={c} /> {c.color.mode === 'color' ? rgbHex(c.color.rgb) : 'negro'}</span> : <Badge tone="warn">falta</Badge>}
    >
      <div className="dz-row">
        <ToolButton tool="eyedropper" icon="droplet" kbd="E" />
        <Button size="sm" variant="ghost" icon="sliders" onClick={() => void suggestColors(c)}>
          Sugerir colores
        </Button>
      </div>
      {sug && sug.colors.length > 0 && (
        <div className="dz-chips" aria-label="Colores sugeridos">
          {sug.colors.map((s) => (
            <Chip key={rgbHex(s.rgb)} color={rgbHex(s.rgb)} selected={c.color?.mode === s.spec.mode && (s.spec.mode === 'dark' || (c.color?.mode === 'color' && rgbHex(c.color.rgb) === rgbHex(s.rgb)))} onClick={() => setColor(s.spec)} title={`${Math.round(s.fraction * 100)} % de la tinta`}>
              {s.kind === 'dark' ? 'Negro' : rgbHex(s.rgb)}
            </Chip>
          ))}
        </div>
      )}
      <Switch checked={dark} onChange={(on) => setColor(on ? { mode: 'dark' } : null)} label="Negro sobre claro" description="Para registros en blanco y negro: toma los trazos oscuros sin color. Mantené la región dentro de la pista (el borde también es negro)." />
      {c.color?.mode === 'color' && (
        <Field label="Tolerancia de color" tooltip="Distancia de color ΔE admitida: más alta toma trazos más claros o borrosos, pero también ruido y otras tintas parecidas.">
          <SliderField min={8} max={60} step={1} value={c.color.tolerance ?? DEFAULT_COLOR_TOLERANCE} onChange={(v) => updateWork((w) => updateCurve(w, c.id, { color: { ...(c.color as Extract<CurveColorSpec, { mode: 'color' }>), tolerance: v } }))} aria-label="Tolerancia de color" />
        </Field>
      )}
      {c.color && (
        <div>
          <Button size="sm" variant="ghost" icon="eye" onClick={() => void showMask(c)}>
            Ver máscara de color
          </Button>
        </div>
      )}
    </Section>
  );
}

function CurveEditor({ c }: { c: CurveDraft }) {
  const updateWork = useDigitizer((s) => s.updateWork);
  const corrected = useDigitizer((s) => s.corrected);
  const job = useDigitizer((s) => s.job);
  // Solo si hay calibración (booleano: un selector que arma objetos nuevos dispararía renders sin fin).
  const cal = useDigitizer((s) => calibrationOf(s.work).calibration !== null);
  const canUndo = useDigitizer((s) => s.past.length > 0);
  const canRedo = useDigitizer((s) => s.future.length > 0);
  const patch = (p: Partial<CurveDraft>) => updateWork((w) => updateCurve(w, c.id, p));
  const { problems } = corrected ? specOf(c, corrected) : { problems: [] as string[] };
  const reversed = c.leftValue > c.rightValue;
  const typical = scaleForRole(c.role, registry.roles);
  return (
    <>
      <Section title="Identidad">
        <div className="dz-grid2">
          <Field label="Mnemónico">
            <TextField
              size="sm"
              value={c.mnemonic}
              onChange={(v) => {
                const m = v.toUpperCase();
                const s = suggestRole(m);
                patch({ mnemonic: m, ...(c.role === null && s.role ? { role: s.role, unit: s.unit ?? c.unit } : {}) });
              }}
              aria-label="Mnemónico"
            />
          </Field>
          <Field label="Rol">
            <Select size="sm" value={c.role ?? ''} options={roleOptions()} onChange={(v) => patch({ role: v || null, ...(v ? { unit: registry.roles.get(v)?.unit ?? c.unit } : {}) })} aria-label="Rol" />
          </Field>
        </div>
        <Field label="Unidad">
          <Select size="sm" value={c.unit} options={unitOptions(c.role, c.unit)} onChange={(v) => patch({ unit: v })} aria-label="Unidad" />
        </Field>
      </Section>

      <Section title="Pista y escala" meta={c.leftPx !== null && c.rightPx !== null ? <Badge tone="ok">marcada</Badge> : <Badge tone="warn">falta</Badge>}>
        <div className="dz-row">
          <ToolButton tool="edge-left" icon="chevron-left" kbd="[" />
          <ToolButton tool="edge-right" icon="chevron-right" kbd="]" />
        </div>
        <div className="dz-grid2">
          <Field label="Valor a la izquierda">
            <NumberField size="sm" value={c.leftValue} min={-1e6} max={1e6} clampToRange={false} format={fmtScale} onChange={(v) => patch({ leftValue: v })} aria-label="Valor del borde izquierdo" unit={c.leftPx === null ? undefined : `x ${Math.round(c.leftPx)}`} />
          </Field>
          <Field label="Valor a la derecha">
            <NumberField size="sm" value={c.rightValue} min={-1e6} max={1e6} clampToRange={false} format={fmtScale} onChange={(v) => patch({ rightValue: v })} aria-label="Valor del borde derecho" unit={c.rightPx === null ? undefined : `x ${Math.round(c.rightPx)}`} />
          </Field>
        </div>
        <div className="dz-row">
          <SegmentedControl
            aria-label="Tipo de escala"
            size="sm"
            value={c.scaleKind}
            onChange={(v) => patch({ scaleKind: v })}
            options={[
              { value: 'linear', label: 'Lineal' },
              { value: 'log', label: 'Logarítmica' },
            ]}
          />
          {reversed && <Badge tone="info">invertida</Badge>}
          {typical && (typical.leftValue !== c.leftValue || typical.rightValue !== c.rightValue || typical.scaleKind !== c.scaleKind) && (
            <Button size="sm" variant="ghost" onClick={() => patch(typical)} title="Usar el rango típico del rol">
              Escala típica de {c.role}
            </Button>
          )}
        </div>
      </Section>

      <ColorSection c={c} />

      <Section title="Búsqueda">
        <SegmentedControl
          aria-label="Modo de trazado"
          size="sm"
          block
          value={c.mode}
          onChange={(v) => patch({ mode: v })}
          options={[
            { value: 'auto', label: 'Automático', title: 'Sigue la curva de ese color en toda la región' },
            { value: 'guided', label: 'Guiado', title: 'Seguís la curva con una guía aproximada y un corredor: para cruces del mismo color' },
          ]}
        />
        {c.mode === 'guided' && (
          <>
            <div className="dz-row">
              <ToolButton tool="guide" icon="pen" kbd="G" />
              {c.guide.length > 0 && (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => patch({ guide: [] })}>
                  Borrar guía ({c.guide.length})
                </Button>
              )}
            </div>
            <Field label="Corredor" tooltip="Semiancho de la franja alrededor de la guía donde se busca el trazo.">
              <SliderField min={3} max={60} step={1} value={c.corridor} onChange={(v) => patch({ corridor: v })} unit="px" aria-label="Corredor" />
            </Field>
          </>
        )}
        <div className="dz-row">
          <ToolButton tool="region" icon="fit-height" kbd="R" />
          {c.region && (
            <Button size="sm" variant="ghost" icon="restore-view" onClick={() => patch({ region: null })}>
              Toda la pista
            </Button>
          )}
        </div>
      </Section>

      {problems.length > 0 && !c.trace && (
        <Callout tone="info" title="Para trazar falta">
          <ul className="dz-list">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
            {!cal && <li>Calibrar la profundidad (paso 3).</li>}
          </ul>
        </Callout>
      )}
      <div className="dz-actions">
        {job?.cancellable ? (
          <Button variant="danger" icon="x" onClick={cancelJob}>
            Cancelar
          </Button>
        ) : (
          <Button variant="primary" icon="play" disabled={problems.length > 0 || !cal || !!job} onClick={() => void traceCurve(c.id)} data-testid="digitizer-trace">
            {c.trace ? 'Volver a trazar' : 'Trazar'}
          </Button>
        )}
      </div>
      {c.warnings.length > 0 && (
        <Callout tone="warn" title="Avisos del trazado">
          <ul className="dz-list">
            {c.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      <Section title="Edición manual" meta={c.trace ? `${tracedRows(c.trace).toLocaleString('es-AR')} filas` : undefined}>
        <p className="dz-muted">Corregí la traza a mano: pintá encima de la curva, borrá un tramo o agregá puntos (también sirve para digitalizar una curva entera a mano).</p>
        <div className="dz-row dz-row--wrap">
          <ToolButton tool="paint" icon="pen" kbd="P">Pintar</ToolButton>
          <ToolButton tool="erase" icon="trash" kbd="B">Borrar tramo</ToolButton>
          <ToolButton tool="add" icon="plus" kbd="A">Agregar puntos</ToolButton>
        </div>
        <div className="dz-row">
          <IconButton icon="undo" label="Deshacer en la mesa" hint="Ctrl+Z" disabled={!canUndo} onClick={() => useDigitizer.getState().undo()} />
          <IconButton icon="redo" label="Rehacer en la mesa" hint="Ctrl+Mayús+Z" disabled={!canRedo} onClick={() => useDigitizer.getState().redo()} />
        </div>
      </Section>

      <Section title="Suavizado" meta={c.median > 1 || c.despike ? <Badge tone="accent">activo</Badge> : 'apagado'}>
        <Field label="Mediana móvil" tooltip="Reduce el temblor del trazo. Apagada por defecto: puede redondear picos reales.">
          <Select
            size="sm"
            value={String(c.median)}
            onChange={(v) => patch({ median: Number(v) })}
            options={[
              { value: '1', label: 'Apagada' },
              { value: '3', label: '3 puntos' },
              { value: '5', label: '5 puntos' },
              { value: '7', label: '7 puntos' },
            ]}
            aria-label="Mediana móvil"
          />
        </Field>
        <Switch checked={c.despike} onChange={(on) => patch({ despike: on })} label="Quitar picos aislados" description="Elimina puntos sueltos que se apartan más de un cuarto de la pista de sus dos vecinos." />
      </Section>

      <div>
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          onClick={() => {
            const st = useDigitizer.getState();
            st.updateWork((w) => ({ ...w, curves: w.curves.filter((k) => k.id !== c.id) }));
            st.set({ selectedCurveId: st.work.curves[0]?.id ?? null, mask: null });
          }}
        >
          Quitar curva {c.mnemonic}
        </Button>
      </div>
    </>
  );
}

export function StepCurves() {
  const curves = useDigitizer((s) => s.work.curves);
  const sel = useDigitizer((s) => s.work.curves.find((c) => c.id === s.selectedCurveId) ?? null);
  return (
    <>
      <StepIntro>Para cada curva: marcá los bordes de su pista con sus valores, tomá el color del trazo y trazala.</StepIntro>
      <AddCurve />
      <CurveList />
      {sel ? (
        <div className="dz-editor" key={sel.id}>
          <CurveEditor c={sel} />
        </div>
      ) : (
        curves.length > 0 && <p className="dz-muted">Elegí una curva de la lista para editarla.</p>
      )}
    </>
  );
}
