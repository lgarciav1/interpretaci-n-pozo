/**
 * Editor de escala y color de una curva (fase 4b): popover anclado al encabezado de la curva en el visor.
 * Mínimo, máximo, lin/log, invertir, color, trazo, grosor, curva de respaldo, ocultar y restablecer, con alcance
 * explícito: «esta curva» (`setCurveDisplay`) o «todas las curvas del rol» (`setRoleDisplay`). Cada cambio válido
 * se guarda al momento (el visor se redibuja en vivo); uno inválido queda en el campo con el motivo.
 * Lógica pura y validación: src/viewer/curveEdit.ts. docs/decisiones/0005-visor-multipista.md, D11.
 */
import { useState, type RefObject } from 'react';
import type { CurveDisplayOverride, LineStyleId, ScaleKind } from '../../core/display';
import { setCurveDisplay, setRoleDisplay } from '../../core/state/project';
import { isUserFlagRole } from '../../core/userFlags';
import { registry } from '../../modules';
import { Button, Callout, ColorPicker, Field, IconButton, NumberField, Popover, SegmentedControl, Select, Switch, useResolvedTheme } from '../../ui';
import { defaultScope, patchOverride, scopeOptions, scaleEditStep, shadowedFields, validateScale, validateWidth, WIDTH_RANGE, type EditScope, type ScaleDraft } from '../../viewer/curveEdit';
import { logFloor, type ResolvedCurve } from '../../viewer/resolve';
import { useProject } from '../store/project';
import './curve-editor.css';

const LINES: { value: LineStyleId; label: string }[] = [
  { value: 'solid', label: 'Continua' },
  { value: 'dashed', label: 'Rayada' },
  { value: 'dotted', label: 'Punteada' },
  { value: 'dashdot', label: 'Raya y punto' },
];

const FIELD_NAMES: Partial<Record<keyof CurveDisplayOverride, string>> = {
  scale: 'escala',
  min: 'mínimo',
  max: 'máximo',
  reversed: 'inversión',
  color: 'color',
  line: 'trazo',
  width: 'grosor',
  wrap: 'respaldo',
};

export interface CurveEditorProps {
  wellId: string;
  curve: ResolvedCurve;
  anchorRef: RefObject<HTMLElement | null>;
  onClose(): void;
}

export function CurveEditor({ wellId, curve, anchorRef, onClose }: CurveEditorProps) {
  const theme = useResolvedTheme();
  const display = useProject((s) => s.project.display);
  const commit = useProject((s) => s.commit);
  const [scope, setScope] = useState<EditScope>(() => defaultScope(curve));
  const [draft, setDraft] = useState<ScaleDraft | null>(null);
  const [widthDraft, setWidthDraft] = useState<number | null>(null);

  const roleOv = curve.role ? display.roles[curve.role] : undefined;
  const curveOv = curve.curveId ? display.curves[wellId]?.[curve.curveId] : undefined;
  const current = scope === 'curve' ? curveOv : roleOv;
  const scopes = scopeOptions(curve);
  const userFlag = isUserFlagRole(curve.role);
  const roleLabel = userFlag ? 'Bandera de usuario' : curve.role ? (registry.roles.get(curve.role)?.label ?? curve.role) : null;
  const style = curve.styles[theme];
  const subjectFor = (sc: EditScope) => (sc === 'curve' ? curve.name : userFlag ? `la bandera «${curve.name}»` : `las ${curve.role}`);

  const write = (patch: Partial<Record<keyof CurveDisplayOverride, unknown>>, what: 'escala' | 'sentido' | 'color' | 'trazo' | 'grosor' | 'respaldo' | 'ocultar') => {
    const next = patchOverride(current, patch);
    // Se lee en «Deshacer: Cambiar escala de GR» / «Se deshizo: Ocultar las RT».
    const subject = subjectFor(scope);
    const label = what === 'ocultar' ? `Ocultar ${subject}` : `Cambiar ${what} de ${subject}`;
    commit(label, (p) => (scope === 'curve' && curve.curveId ? setCurveDisplay(p, wellId, curve.curveId, next) : curve.role ? setRoleDisplay(p, curve.role, next) : p));
  };

  const effective: ScaleDraft = draft ?? { scale: curve.axis.kind, min: curve.axis.min, max: curve.axis.max };
  const errors = draft ? validateScale(draft) : null;

  const changeScale = (patch: Partial<ScaleDraft>) => {
    const next = { ...effective, ...patch };
    // Pasar a log con un mínimo ≤ 0: se propone la década por debajo de los datos (y se ve antes de guardar).
    if (patch.scale === 'log') {
      if (!(next.max > 0)) next.max = Math.max(1, ...[curve.axis.max].filter((v) => v > 0));
      if (!(next.min > 0)) next.min = logFloor(curve.data, next.max);
    }
    if (validateScale(next)) {
      setDraft(next);
      return;
    }
    setDraft(null);
    write({ scale: next.scale, min: next.min, max: next.max }, 'escala');
  };

  const reset = () => {
    setDraft(null);
    setWidthDraft(null);
    commit(`Restablecer ${subjectFor(scope)}`, (p) =>
      scope === 'curve' && curve.curveId ? setCurveDisplay(p, wellId, curve.curveId, null) : curve.role ? setRoleDisplay(p, curve.role, null) : p,
    );
  };

  const shadowed = scope === 'role' ? shadowedFields(curveOv) : [];
  const step = scaleEditStep(effective.min, effective.max);
  const unit = curve.unitLabel !== '—' ? curve.unitLabel : undefined;
  const widthValue = widthDraft ?? style.width;
  const widthError = widthDraft !== null ? validateWidth(widthDraft) : null;

  return (
    <Popover open anchorRef={anchorRef} onClose={onClose} label={`Escala y color de ${curve.name}`} width={320} className="ce">
      <div className="ce__head">
        <div className="ce__titles">
          <span className="ce__name" style={{ color: style.color }}>
            {curve.name}
          </span>
          <span className="ce__sub">
            {userFlag ? '' : curve.alternative ? 'Alternativa · ' : curve.origin === 'computed' ? 'Calculada · ' : curve.origin === 'prepared' ? 'Preparada · ' : ''}
            {roleLabel ?? 'sin rol'}
            {unit ? ` · ${unit}` : ''}
          </span>
        </div>
        <IconButton icon="x" size="sm" label="Cerrar" onClick={onClose} />
      </div>

      <div className="ce__body">
        <SegmentedControl
          size="sm"
          block
          aria-label="Aplicar los cambios a"
          value={scope}
          onChange={(v) => {
            setScope(v);
            setDraft(null);
            setWidthDraft(null);
          }}
          options={scopes.map((o) => ({ value: o.scope, label: o.label, disabled: !!o.disabled, ...(o.disabled ? { title: o.disabled } : {}) }))}
        />
        {scopes.find((o) => o.disabled) && <p className="ce__note">{scopes.find((o) => o.disabled)!.disabled}</p>}

        <div className="ce__row">
          <SegmentedControl
            size="sm"
            aria-label="Tipo de escala"
            value={effective.scale}
            onChange={(v: ScaleKind) => changeScale({ scale: v })}
            options={[
              { value: 'linear', label: 'Lineal' },
              { value: 'log', label: 'Log' },
            ]}
          />
          <Switch checked={curve.axis.reversed} onChange={(v) => write({ reversed: v }, 'sentido')} label="Invertir" />
        </div>

        <div className="ce__grid">
          <Field label="Mínimo" error={errors?.min}>
            <NumberField
              size="sm"
              aria-label="Mínimo de la escala"
              value={effective.min}
              min={-1e12}
              max={1e12}
              step={step}
              {...(effective.scale === 'log' && effective.min > 0 ? { scale: 'log' as const } : {})}
              clampToRange={false}
              {...(unit ? { unit } : {})}
              format={(v) => String(+v.toPrecision(6)).replace('.', ',')}
              onChange={(v) => changeScale({ min: v })}
            />
          </Field>
          <Field label="Máximo" error={errors?.max}>
            <NumberField
              size="sm"
              aria-label="Máximo de la escala"
              value={effective.max}
              min={-1e12}
              max={1e12}
              step={step}
              {...(effective.scale === 'log' && effective.max > 0 ? { scale: 'log' as const } : {})}
              clampToRange={false}
              {...(unit ? { unit } : {})}
              format={(v) => String(+v.toPrecision(6)).replace('.', ',')}
              onChange={(v) => changeScale({ max: v })}
            />
          </Field>
        </div>

        <Field label="Color">
          <ColorPicker aria-label={`Color de ${curve.name}`} value={current?.color ?? style.color} onChange={(c) => write({ color: c }, 'color')} />
        </Field>

        <div className="ce__grid">
          <Field label="Trazo">
            <Select size="sm" block aria-label="Tipo de trazo" value={style.line} options={LINES} onChange={(v) => write({ line: v }, 'trazo')} />
          </Field>
          <Field label="Grosor" error={widthError}>
            <NumberField
              size="sm"
              aria-label="Grosor del trazo"
              value={widthValue}
              min={0}
              max={20}
              step={WIDTH_RANGE.step}
              clampToRange={false}
              unit="px"
              onChange={(v) => {
                if (validateWidth(v)) {
                  setWidthDraft(v);
                  return;
                }
                setWidthDraft(null);
                write({ width: v }, 'grosor');
              }}
            />
          </Field>
        </div>

        <Switch
          checked={curve.wrap}
          disabled={effective.scale === 'log'}
          onChange={(v) => write({ wrap: v }, 'respaldo')}
          label="Curva de respaldo"
          description={effective.scale === 'log' ? 'Solo en escala lineal.' : 'Lo que pasa del máximo vuelve a entrar corrido un ancho de escala.'}
        />

        {shadowed.length > 0 && (
          <Callout
            tone="info"
            title="Esta curva tiene ajustes propios"
            actions={
              <Button size="sm" variant="ghost" onClick={() => curve.curveId && commit(`Quitar ajustes propios de ${curve.name}`, (p) => setCurveDisplay(p, wellId, curve.curveId!, null))}>
                Quitar ajustes propios
              </Button>
            }
          >
            Su {shadowed.map((k) => FIELD_NAMES[k] ?? k).join(', ')} tienen prioridad sobre lo que cambies para todas las {curve.role}.
          </Callout>
        )}
      </div>

      <div className="ce__foot">
        <Button
          size="sm"
          variant="ghost"
          icon="eye-off"
          onClick={() => {
            write({ hidden: true }, 'ocultar');
            onClose();
          }}
        >
          {scope === 'curve' ? 'Ocultar curva' : userFlag ? 'Ocultar bandera' : `Ocultar las ${curve.role}`}
        </Button>
        <Button size="sm" variant="ghost" icon="refresh" onClick={reset} disabled={!current}>
          Restablecer
        </Button>
      </div>
    </Popover>
  );
}

