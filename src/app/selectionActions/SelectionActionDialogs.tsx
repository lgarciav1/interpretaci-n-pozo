/**
 * Diálogos de acción desde la selección compartida (`PlotSelection`, G02, docs/decisiones/0088):
 * 1. «Guardar como bandera…» → crea una bandera discreta 0/1 en `Interpretation.userFlags` (un paso de Ctrl+Z).
 * 2. «Excluir tramos en Preparación…» → agrega tramos MD exactos con motivo obligatorio y activación explícita (I01–I08).
 */
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { MASK_REASON_MAX } from '../../core/preparation/state';
import { makeId } from '../../core/state/project';
import { removeUserFlag } from '../../core/state/userFlags';
import { hiddenCurveReason } from '../../core/toolString';
import { unitLabel } from '../../core/units';
import {
  clipUserFlagSource,
  maskToExactIntervals,
  normalizeUserFlagName,
  USER_FLAG_NAME_MAX,
  USER_FLAG_PALETTE,
  userFlagColor,
} from '../../core/userFlags';
import { getPlotLink, selectionTitle, setPlotSelection, type PlotSelection } from '../../plots/link';
import { usePlotSelection } from '../../plots/useLink';
import {
  defaultExclusionCurveId,
  excludeSelectionInPreparation,
  exclusionTargetInfo,
  saveSelectionAsUserFlag,
} from '../../plots/userFlags';
import {
  Button,
  Callout,
  Checkbox,
  ColorPicker,
  Dialog,
  Field,
  IconButton,
  Select,
  TextField,
  formatNumber,
  toast,
} from '../../ui';
import { hiddenCurvesOf } from '../plots/context';
import { UNDO_SHORTCUT } from '../shell/historyActions';
import { selectActiveEntry, useProject } from '../store/project';
import { useSelectionActionsUi } from './store';
import './selectionActions.css';

const fmtMd = (d: number) => formatNumber(d, { digits: 2, grouping: false });
const fmtDepthTitle = (d: number) => formatNumber(d, { digits: 1 });

function sameDepthValues(a: Float64Array, b: Float64Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function SelectionActionDialogs() {
  const dialog = useSelectionActionsUi((s) => s.dialog);
  const close = useSelectionActionsUi((s) => s.close);
  const entry = useProject(selectActiveEntry);
  const selection = usePlotSelection(entry?.well.depth.values);

  useEffect(() => {
    if (dialog && (!entry || !selection)) close();
  }, [dialog, entry, selection, close]);

  if (!dialog || !entry || !selection) return null;

  return dialog.kind === 'flag' ? (
    <SaveFlagDialog selection={selection} defaultName={dialog.defaultName} onClose={close} />
  ) : (
    <ExcludePreparationDialog selection={selection} preferredKeys={dialog.preferredKeys} onClose={close} />
  );
}

function SaveFlagDialog({
  selection,
  defaultName,
  onClose,
}: {
  selection: PlotSelection;
  defaultName?: string;
  onClose(): void;
}) {
  const entry = useProject(selectActiveEntry)!;
  const commit = useProject((s) => s.commit);
  const existing = entry.interpretation.userFlags ?? [];
  const nameId = useId();
  const [name, setName] = useState(defaultName ?? '');
  const [color, setColor] = useState(() => userFlagColor(existing.length));
  const [error, setError] = useState<string | null>(null);

  const intervals = useMemo(
    () => maskToExactIntervals(entry.well.depth.values, selection.mask),
    [entry.well.depth.values, selection.mask],
  );
  const titleText = selectionTitle(selection, fmtDepthTitle);
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const duplicate = trimmed.length > 0 && existing.some((f) => normalizeUserFlagName(f.name) === normalizeUserFlagName(trimmed));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setError('Ingresá un nombre corto para la bandera.');
      return;
    }
    if (duplicate) {
      setError(`Ya existe una bandera llamada «${trimmed}» en este pozo.`);
      return;
    }
    try {
      commit(`Crear bandera «${trimmed}»`, (p) =>
        saveSelectionAsUserFlag(p, entry.well.id, selection, {
          id: makeId('uf'),
          name: trimmed,
          color,
          source: clipUserFlagSource(titleText),
        }),
      );
      toast({
        tone: 'ok',
        title: `Bandera «${trimmed}» guardada`,
        description: `${formatNumber(selection.count, { digits: 0 })} muestras (${intervals.length} ${intervals.length === 1 ? 'tramo' : 'tramos'}). Disponible en Filtros → Banderas y en Armar pistas.`,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDeleteExisting = (flagId: string, flagName: string) => {
    commit(`Quitar bandera «${flagName}»`, (p) => removeUserFlag(p, entry.well.id, flagId));
    toast({ tone: 'info', title: `Bandera «${flagName}» quitada`, description: `${UNDO_SHORTCUT} la restaura.` });
  };

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title="Guardar selección como bandera"
      description="Crea una curva discreta 0/1 en la interpretación sin modificar los originales del pozo."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="sel-save-flag-form"
            variant="primary"
            icon="bookmark"
            disabled={!trimmed || duplicate || intervals.length === 0}
            data-testid="save-flag-submit"
          >
            Guardar bandera
          </Button>
        </>
      }
    >
      <form id="sel-save-flag-form" className="sel-dialog__form" onSubmit={onSubmit}>
        <div className="sel-dialog__summary">
          <strong>{titleText}</strong>
          <span className="num">
            {formatNumber(selection.count, { digits: 0 })} muestras · {intervals.length}{' '}
            {intervals.length === 1 ? 'tramo MD' : 'tramos MD'}
          </span>
        </div>

        <Field
          label="Nombre corto"
          htmlFor={nameId}
          hint="Aparece en Filtros (Banderas), leyenda del visor y Armar pistas."
          error={error ?? (duplicate ? `Ya existe una bandera llamada «${trimmed}».` : undefined)}
        >
          <TextField
            id={nameId}
            block
            data-autofocus
            data-testid="save-flag-name"
            maxLength={USER_FLAG_NAME_MAX}
            placeholder="Ej. Arena limpia TS o Anomalía baritina"
            value={name}
            invalid={!!error || duplicate}
            onChange={(v) => {
              setName(v);
              if (error) setError(null);
            }}
          />
        </Field>

        <Field label="Color en pista de banderas">
          <ColorPicker aria-label="Color de la bandera" swatches={USER_FLAG_PALETTE} value={color} onChange={setColor} />
        </Field>

        <p className="sel-dialog__note">
          Se guarda en la interpretación (JSON puro), sobrevive al guardar/reabrir el proyecto y se deshace con un paso de{' '}
          <kbd className="ui-kbd">{UNDO_SHORTCUT}</kbd>.
        </p>

        {existing.length > 0 && (
          <div className="sel-dialog__existing">
            <p className="sel-dialog__existing-title">Banderas de usuario en este pozo ({existing.length})</p>
            <ul className="sel-dialog__flag-list">
              {existing.map((f, idx) => (
                <li key={f.id}>
                  <span
                    className="sel-dialog__flag-swatch"
                    style={{ background: f.color ?? userFlagColor(idx) }}
                    aria-hidden="true"
                  />
                  <span className="sel-dialog__flag-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="sel-dialog__flag-meta num">
                    {f.intervals.length} {f.intervals.length === 1 ? 'tramo' : 'tramos'}
                  </span>
                  <IconButton
                    size="sm"
                    icon="trash"
                    label={`Quitar bandera ${f.name}`}
                    onClick={() => onDeleteExisting(f.id, f.name)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Dialog>
  );
}

function ExcludePreparationDialog({
  selection,
  preferredKeys,
  onClose,
}: {
  selection: PlotSelection;
  preferredKeys?: readonly (string | null | undefined)[];
  onClose(): void;
}) {
  const project = useProject((s) => s.project);
  const entry = useProject(selectActiveEntry)!;
  const commit = useProject((s) => s.commit);
  const curveFieldId = useId();
  const reasonFieldId = useId();

  const hiddenCurves = useMemo(
    () => hiddenCurvesOf(entry.well, entry.interpretation),
    [entry.well, entry.interpretation],
  );
  const hiddenCurveIds = useMemo(
    () => (hiddenCurves.size ? new Set(hiddenCurves.keys()) : undefined),
    [hiddenCurves],
  );
  const defaultCurve = useMemo(
    () => defaultExclusionCurveId(entry, selection, preferredKeys, hiddenCurveIds) ?? '',
    [entry, selection, preferredKeys, hiddenCurveIds],
  );
  const [curveId, setCurveId] = useState(defaultCurve);
  const [reason, setReason] = useState('');
  const [activateSource, setActivateSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry.well.curves.some((c) => c.id === curveId)) {
      setCurveId(defaultCurve);
    }
  }, [entry.well.curves, curveId, defaultCurve]);

  const curveOptions = useMemo(
    () =>
      entry.well.curves.map((c) => ({
        value: c.id,
        label: `${c.mnemonic}${c.role ? ` · ${c.role}` : ''}${c.unit && c.unit !== 'unitless' ? ` (${unitLabel(c.unit)})` : ''}${hiddenCurves.has(c.id) ? ' (oculta por la sarta)' : ''}`,
      })),
    [entry.well.curves, hiddenCurves],
  );
  const selectedHidden = curveId ? (hiddenCurves.get(curveId) ?? null) : null;

  const info = useMemo(
    () => (curveId ? exclusionTargetInfo(project, entry.well.id, curveId, selection) : null),
    [project, entry.well.id, curveId, selection],
  );

  const titleText = selectionTitle(selection, fmtDepthTitle);
  const trimmedReason = reason.trim();
  const canSubmit = !!info && !info.blockingError && trimmedReason.length > 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!info || info.blockingError) return;
    if (!trimmedReason) {
      setError('Ingresá un motivo obligatorio para registrar esta exclusión.');
      return;
    }
    const willActivate = info.alreadyUsingPrepared || activateSource;
    try {
      const n = info.intervals.length;
      commit(
        `Excluir ${n} ${n === 1 ? 'tramo' : 'tramos'} de ${info.curve.mnemonic}`,
        (p) =>
          excludeSelectionInPreparation(p, entry.well.id, curveId, selection, {
            reason: trimmedReason,
            activateSource: willActivate,
            makeId,
          }),
        { group: makeId('exclude-sel') },
      );
      // Respaldo cuando `installUiSync` no está montado: re-vincula solo si la selección no fue re-vinculada ya.
      const updatedWell = useProject.getState().project.wells.find((w) => w.well.id === entry.well.id)?.well;
      if (
        updatedWell &&
        getPlotLink().selection === selection &&
        updatedWell.depth.values !== selection.depth &&
        sameDepthValues(updatedWell.depth.values, selection.depth)
      ) {
        setPlotSelection({ ...selection, depth: updatedWell.depth.values });
      }
      toast({
        tone: 'ok',
        title: `Exclusión guardada en ${info.curve.mnemonic}`,
        description:
          info.curve.role && !willActivate
            ? `${n} ${n === 1 ? 'tramo' : 'tramos'} agregados en Preparación (original intacto y activo como ${info.curve.role}). ${UNDO_SHORTCUT} deshace.`
            : `${n} ${n === 1 ? 'tramo' : 'tramos'} excluidos con original intacto. ${UNDO_SHORTCUT} deshace en un paso.`,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const previewRuns = info?.intervals.slice(0, 4) ?? [];
  const extraRuns = (info?.intervals.length ?? 0) - previewRuns.length;

  return (
    <Dialog
      open
      size="md"
      onClose={onClose}
      title="Excluir tramos en Preparación"
      description="Agrega los tramos MD exactos de la selección como exclusiones QC conservando la medición original intacta."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="sel-exclude-prep-form"
            variant="primary"
            icon="eye-off"
            disabled={!canSubmit}
            data-testid="exclude-prep-submit"
          >
            Excluir en Preparación
          </Button>
        </>
      }
    >
      <form id="sel-exclude-prep-form" className="sel-dialog__form" onSubmit={onSubmit}>
        <div className="sel-dialog__summary">
          <strong>{titleText}</strong>
          <span className="num">
            {formatNumber(selection.count, { digits: 0 })} muestras · {info?.intervals.length ?? 0}{' '}
            {(info?.intervals.length ?? 0) === 1 ? 'tramo MD exacto' : 'tramos MD exactos'}
          </span>
        </div>

        {curveOptions.length === 0 ? (
          <Callout tone="warn" title="Sin curvas medidas originales">
            Este pozo no tiene curvas medidas sobre las cuales registrar exclusiones en Preparación.
          </Callout>
        ) : (
          <Field
            label="Curva medida objetivo"
            htmlFor={curveFieldId}
            hint="Solo curvas medidas originales; nunca modifica la curva original en el lugar."
          >
            <Select
              id={curveFieldId}
              block
              data-testid="exclude-prep-curve"
              value={curveId}
              options={curveOptions}
              onChange={(v) => {
                setCurveId(v);
                setActivateSource(false);
                if (error) setError(null);
              }}
            />
          </Field>
        )}

        {selectedHidden && (
          <Callout tone="info" title={`${selectedHidden.mnemonic} está oculta por la sarta`}>
            {hiddenCurveReason(selectedHidden)} Podés guardar la exclusión en Preparación, pero mientras la herramienta
            siga oculta el motor no usará ni el original ni la versión preparada.
          </Callout>
        )}

        {previewRuns.length > 0 && (
          <ul className="sel-dialog__runs num" aria-label="Tramos MD a excluir">
            {previewRuns.map((r, i) => (
              <li key={`${r.top}-${r.base}-${i}`}>
                {fmtMd(r.top)} – {fmtMd(r.base)} m MD
              </li>
            ))}
            {extraRuns > 0 && <li>+{extraRuns} tramos más</li>}
          </ul>
        )}

        <Field
          label="Motivo de la exclusión (obligatorio)"
          htmlFor={reasonFieldId}
          hint="Queda registrado junto a cada tramo en Preparaciones guardadas y en los snapshots."
          error={error ?? undefined}
        >
          <TextField
            id={reasonFieldId}
            block
            data-autofocus
            data-testid="exclude-prep-reason"
            maxLength={MASK_REASON_MAX}
            placeholder="Ej. Lectura afectada por baritina / derrumbe en pared de pozo"
            value={reason}
            invalid={!!error}
            onChange={(v) => {
              setReason(v);
              if (error) setError(null);
            }}
          />
        </Field>

        {curveOptions.length === 0 ? null : info?.blockingError ? (
          <Callout tone="warn" title="No se puede aplicar la exclusión en esta curva">
            {info.blockingError}
          </Callout>
        ) : info?.curve.role ? (
          info.alreadyUsingPrepared ? (
            <Callout tone="info" title={`${info.curve.role} ya usa la curva preparada`}>
              Los nuevos tramos de <strong>{info.curve.mnemonic}</strong> se sumarán a la preparación activa y
              recalcularán la interpretación (deshacible con {UNDO_SHORTCUT}).
            </Callout>
          ) : (
            <div className="sel-dialog__activate">
              <Checkbox
                checked={activateSource}
                onChange={setActivateSource}
                data-testid="exclude-prep-activate"
                label={`Activar la curva preparada como fuente de ${info.curve.role}`}
              />
              <p className="sel-dialog__activate-hint">
                {info.otherActiveSource
                  ? `Atención: ${info.curve.role} usa actualmente «${info.otherActiveSource}». Si dejás esta casilla sin marcar, la exclusión se guarda en Preparación sin sustituir la fuente activa.`
                  : `Activación explícita (I04): si dejás esta casilla sin marcar, la exclusión queda guardada en Preparación y la interpretación sigue usando ${info.curve.mnemonic} original hasta que la actives.`}
              </p>
            </div>
          )
        ) : (
          <Callout tone="info">
            La curva no tiene un rol asignado: la exclusión se guardará en Preparación manteniendo el original intacto.
          </Callout>
        )}
      </form>
    </Dialog>
  );
}
