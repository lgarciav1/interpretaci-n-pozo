/**
 * Mesa de digitalización (docs/decisiones/0063): diálogo a ventana completa con el flujo en pasos (izquierda), el
 * lienzo con la imagen (centro), la barra del lienzo arriba y la de estado abajo. Cerrar la mesa no pierde la sesión.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Button, Callout, Dialog, EmptyState, FileDrop, Icon, IconButton, Popover, SegmentedControl, Spinner, Stepper, isTypingTarget } from '../../../ui';
import { formatNumber } from '../../../ui/format';
import { unitLabel } from '../../../core/units';
import { IMAGE_ACCEPT, cancelJob, loadImage, saveSession } from '../actions';
import { calibrationOf } from '../model/form';
import { STEPS, stepStates, suggestedStep, type StepId } from '../model/steps';
import { useDigitizer, type Tool } from '../store';
import { DeskCanvas, ORIGINAL_TOOLS, deskViewActions } from './DeskCanvas';
import { StepCurves } from './StepCurves';
import { StepDepth } from './StepDepth';
import { StepGeometry } from './StepGeometry';
import { StepImage, pickSessionFile } from './StepImage';
import { StepOutput } from './StepOutput';
import { StepReview } from './StepReview';
import { TOOL_HINT, TOOL_LABEL } from './common';
import { useDeskView } from './viewStore';
import './digitizer.css';

const TOOL_KEYS: Record<string, Tool> = { h: 'pan', i: 'tilt', q: 'quad', t: 'tie', '[': 'edge-left', ']': 'edge-right', e: 'eyedropper', r: 'region', g: 'guide', p: 'paint', b: 'erase', a: 'add' };

/** Herramienta por defecto al entrar a cada paso. */
const STEP_TOOL: Partial<Record<StepId, Tool>> = { geometry: 'tilt', depth: 'tie' };

export function useStepStates() {
  const s = useDigitizer();
  return useMemo(
    () =>
      stepStates({
        hasImage: !!s.image,
        geometryApplied: s.geometry.length > 0,
        geometrySkipped: s.geometrySkipped,
        calibration: calibrationOf(s.work),
        work: s.work,
        reviewed: s.reviewed,
        delivered: s.delivered,
      }),
    [s.image, s.geometry, s.geometrySkipped, s.work, s.reviewed, s.delivered],
  );
}

function goStep(id: StepId) {
  const st = useDigitizer.getState();
  const tool = STEP_TOOL[id] ?? 'pan';
  st.set({ step: id, tool, view: ORIGINAL_TOOLS.includes(tool) ? 'original' : st.view === 'original' ? 'corrected' : st.view, focusTieId: null });
}

function HelpButton() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton ref={ref} icon="help" size="sm" label="Ayuda y atajos de la mesa" onClick={() => setOpen((o) => !o)} pressed={open} />
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)} label="Ayuda de la mesa de digitalización" width={380} align="end">
        <div className="dz-help">
          <h3>Atajos</h3>
          <dl className="dz-help__keys">
            <dt>Rueda</dt>
            <dd>zoom alrededor del puntero (Mayús: desplazar en horizontal)</dd>
            <dt>Espacio + arrastrar</dt>
            <dd>desplazar con cualquier herramienta</dd>
            <dt>+ / − / 0</dt>
            <dd>acercar, alejar, encuadrar</dd>
            <dt>V</dt>
            <dd>alternar imagen original y corregida</dd>
            <dt>H · I · Q · T</dt>
            <dd>mover · inclinación · esquinas · amarres</dd>
            <dt>[ · ] · E · R · G</dt>
            <dd>bordes · cuentagotas · región · guía</dd>
            <dt>P · B · A</dt>
            <dd>pintar · borrar tramo · agregar puntos</dd>
            <dt>Ctrl+Z / Ctrl+Mayús+Z</dt>
            <dd>deshacer y rehacer dentro de la mesa</dd>
            <dt>Esc</dt>
            <dd>soltar la herramienta; otra vez, cerrar la mesa</dd>
          </dl>
          <h3>Límites</h3>
          <ul>
            <li>Solo imágenes JPG, PNG o WebP: los PDF y TIFF hay que convertirlos antes.</li>
            <li>Sin OCR: la escala y los amarres de profundidad los marcás vos.</li>
            <li>No sigue curvas que «dan la vuelta» al borde de la pista: digitalizá cada tramo como curva aparte o corregilo a mano.</li>
            <li>Dos curvas del mismo color que se cruzan: usá el modo guiado.</li>
            <li>Precisión típica: 1–2 % del rango de la escala con ~20 px por metro. Revisá siempre el resultado.</li>
          </ul>
        </div>
      </Popover>
    </>
  );
}

function StageToolbar() {
  const view = useDigitizer((s) => s.view);
  const hasMask = useDigitizer((s) => !!s.mask);
  const hasGeometry = useDigitizer((s) => s.geometry.length > 0);
  const set = useDigitizer((s) => s.set);
  const scale = useDeskView((s) => s.vp.scale);
  return (
    <div className="dz-toolbar" role="toolbar" aria-label="Vista del lienzo">
      <SegmentedControl
        aria-label="Imagen que se muestra"
        size="sm"
        value={view}
        onChange={(v) => set({ view: v })}
        options={[
          { value: 'original', label: 'Original' },
          { value: 'corrected', label: hasGeometry ? 'Corregida' : 'Trabajo' },
          { value: 'mask', label: 'Máscara', disabled: !hasMask },
        ]}
      />
      <span className="dz-spacer" />
      <IconButton icon="zoom-out" size="sm" label="Alejar" hint="−" onClick={() => deskViewActions.zoom(1 / 1.4)} />
      <span className="dz-zoom num" aria-label="Zoom">{formatNumber(scale * 100, { digits: 0 })} %</span>
      <IconButton icon="zoom-in" size="sm" label="Acercar" hint="+" onClick={() => deskViewActions.zoom(1.4)} />
      <IconButton icon="fit-height" size="sm" label="Encuadrar" hint="0" onClick={deskViewActions.fit} />
      <HelpButton />
    </div>
  );
}

function StatusBar() {
  const tool = useDigitizer((s) => s.tool);
  const job = useDigitizer((s) => s.job);
  const view = useDigitizer((s) => s.view);
  const unit = useDigitizer((s) => s.work.depthUnit);
  const sel = useDigitizer((s) => s.work.curves.find((c) => c.id === s.selectedCurveId) ?? null);
  const cursor = useDeskView((s) => s.cursor);
  const spacePan = useDeskView((s) => s.spacePan);
  return (
    <div className="dz-status" aria-live="polite">
      {job ? (
        <span className="dz-status__job">
          <Spinner size={14} />
          <span>{job.label}</span>
          {job.progress !== null && (
            <span className="dz-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)} aria-label={job.label}>
              <span className="dz-progress__bar" style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </span>
          )}
          {job.cancellable && (
            <Button size="sm" variant="ghost" icon="x" onClick={cancelJob}>
              Cancelar
            </Button>
          )}
        </span>
      ) : (
        <span className="dz-status__tool">
          <strong>{spacePan ? 'Desplazar' : TOOL_LABEL[tool]}</strong> · {spacePan ? 'soltá la barra espaciadora para volver' : TOOL_HINT[tool]}
        </span>
      )}
      <span className="dz-spacer" />
      {cursor?.inside && (
        <span className="dz-status__read num" data-testid="digitizer-readout">
          {view !== 'original' && Number.isFinite(cursor.depth) && (
            <span>
              {formatNumber(cursor.depth, { digits: 2 })} {unit}
            </span>
          )}
          {view !== 'original' && sel && Number.isFinite(cursor.value) && (
            <span>
              {sel.mnemonic} {formatNumber(cursor.value, { significant: 4 })} {unitLabel(sel.unit)}
            </span>
          )}
          <span className="dz-muted">
            x {Math.round(cursor.x)} · y {Math.round(cursor.y)} px
          </span>
        </span>
      )}
    </div>
  );
}

function Stage() {
  const image = useDigitizer((s) => s.image);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void loadImage(f, f.name);
  };
  return (
    <section
      className={`dz-stage${over ? ' is-over' : ''}`}
      aria-label="Lienzo"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <StageToolbar />
      {image ? (
        <DeskCanvas />
      ) : (
        <div className="dz-stage__empty">
          <EmptyState
            size="lg"
            icon="upload"
            title="Cargá un registro escaneado"
            description="Soltá una imagen JPG, PNG o WebP en cualquier lugar de la mesa, pegala con Ctrl+V o elegila desde el archivo."
            actions={
              <div className="dz-empty-drop">
                <FileDrop accept={IMAGE_ACCEPT} title="Elegir imagen" description="o arrastrala acá" onFile={(f) => void loadImage(f, f.name)} inputTestId="digitizer-image-input-stage" />
              </div>
            }
          />
        </div>
      )}
      <StatusBar />
    </section>
  );
}

function StepPanel({ id }: { id: StepId }) {
  switch (id) {
    case 'image':
      return <StepImage />;
    case 'geometry':
      return <StepGeometry />;
    case 'depth':
      return <StepDepth />;
    case 'curves':
      return <StepCurves />;
    case 'review':
      return <StepReview />;
    case 'output':
      return <StepOutput />;
  }
}

/** Atajos de la mesa: se capturan antes que el diálogo (Escape suelta la herramienta antes de cerrar). */
function useDeskKeys(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const down = (e: KeyboardEvent) => {
      const st = useDigitizer.getState();
      const typing = isTypingTarget(e.target as Element | null);
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod && k === 'z' && !typing) {
        if (e.shiftKey) st.redo();
        else st.undo();
        return handled();
      }
      if (mod && k === 'y' && !typing) {
        st.redo();
        return handled();
      }
      if (e.key === 'Escape') {
        if (useDeskView.getState().spacePan) return handled();
        if (st.tool !== 'pan' && !typing) {
          st.set({ tool: 'pan' });
          return handled();
        }
        if (st.job?.cancellable) {
          cancelJob();
          return handled();
        }
        return;
      }
      if (typing || mod || e.altKey) return;
      if (e.key === ' ') {
        if (!useDeskView.getState().spacePan) useDeskView.setState({ spacePan: true });
        return handled();
      }
      if (st.tool === 'guide' && (e.key === 'Enter' || e.key === 'Backspace')) {
        if (e.key === 'Enter') st.set({ tool: 'pan' });
        else {
          const c = st.work.curves.find((x) => x.id === st.selectedCurveId);
          if (c?.guide.length) st.updateWork((w) => ({ ...w, curves: w.curves.map((x) => (x.id === c.id ? { ...x, guide: x.guide.slice(0, -1) } : x)) }));
        }
        return handled();
      }
      if (!st.image) return;
      if (e.key === '+' || e.key === '=') return handled(), deskViewActions.zoom(1.4);
      if (e.key === '-') return handled(), deskViewActions.zoom(1 / 1.4);
      if (e.key === '0') return handled(), deskViewActions.fit();
      if (k === 'v') {
        st.set({ view: st.view === 'original' ? 'corrected' : 'original' });
        return handled();
      }
      const tool = TOOL_KEYS[k];
      if (tool) {
        const next = st.tool === tool ? 'pan' : tool;
        st.set({ tool: next, ...(ORIGINAL_TOOLS.includes(next) ? { view: 'original' } : st.view === 'original' ? { view: 'corrected' } : {}) });
        return handled();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') useDeskView.setState({ spacePan: false });
    };
    const blur = () => useDeskView.setState({ spacePan: false });
    const paste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target as Element | null)) return;
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      void loadImage(f, f.name && f.name !== 'image.png' ? f.name : `portapapeles-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`);
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('paste', paste);
    };
  }, [open]);
}

export function DigitizerDesk() {
  const open = useDigitizer((s) => s.open);
  const step = useDigitizer((s) => s.step);
  const image = useDigitizer((s) => s.image);
  const set = useDigitizer((s) => s.set);
  const states = useStepStates();
  useDeskKeys(open);
  if (!open) return null;
  const idx = STEPS.findIndex((s) => s.id === step);
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];
  const nextReady = next && (next.id === 'geometry' || next.id === 'depth' ? !!image : states.find((s) => s.id === next.id)!.hint.startsWith('Primero') === false);
  return (
    <Dialog
      open
      size="full"
      flush
      className="dz-desk"
      title="Mesa de digitalización"
      description={image ? `${image.name} · ${image.original.width.toLocaleString('es-AR')} × ${image.original.height.toLocaleString('es-AR')} px` : 'Log Digitizer: de un registro escaneado a curvas digitales'}
      onClose={() => set({ open: false, tool: 'pan' })}
      headerExtra={
        <Stepper
          aria-label="Pasos de la digitalización"
          items={states.map((s) => ({ id: s.id, label: s.label, shortLabel: s.short, status: s.status, hint: s.hint }))}
          activeId={step}
          suggestedId={suggestedStep(states)}
          onSelect={(id) => goStep(id as StepId)}
        />
      }
      footer={
        <>
          <span className="dz-foot__note">
            <Icon name="info" size={14} />
            Precisión típica 1–2 % del rango de la escala: revisá siempre las curvas digitalizadas.
          </span>
          <span className="dz-spacer" />
          <Button size="sm" variant="ghost" icon="folder" onClick={pickSessionFile}>
            Abrir sesión
          </Button>
          <Button size="sm" variant="ghost" icon="save" disabled={!image} onClick={saveSession}>
            Guardar sesión
          </Button>
          <span className="dz-foot__sep" aria-hidden="true" />
          <Button size="sm" icon="chevron-left" disabled={!prev} onClick={() => prev && goStep(prev.id)}>
            Anterior
          </Button>
          <Button size="sm" variant="primary" iconRight="chevron-right" disabled={!next || !nextReady} onClick={() => next && goStep(next.id)}>
            {next ? `Siguiente: ${next.label}` : 'Último paso'}
          </Button>
        </>
      }
    >
      <div className="dz-body">
        <aside className="dz-side" aria-label={`Paso ${idx + 1}: ${STEPS[idx]!.label}`}>
          <div className="dz-side__head">
            <span className="ui-overline">
              Paso {idx + 1} de {STEPS.length}
            </span>
            <h3 className="dz-side__title">{STEPS[idx]!.label}</h3>
          </div>
          <div className="dz-side__scroll" key={step}>
            {!image && step !== 'image' ? (
              <Callout tone="info" title="Primero cargá una imagen" actions={<Button size="sm" onClick={() => goStep('image')}>Ir a Imagen</Button>}>
                Este paso trabaja sobre la imagen del registro.
              </Callout>
            ) : (
              <StepPanel id={step} />
            )}
          </div>
        </aside>
        <Stage />
      </div>
    </Dialog>
  );
}
