import { useId, useState } from 'react';
import { withCurveFormula } from '../../core/engine/validateFormula';
import type { CurveFormula } from '../../core/formulas';
import { FORMULA_LENGTH } from '../../petro/formula';
import { updateInterpretation, type WellEntry } from '../../core/state/project';
import { listUnits } from '../../core/units';
import { registry } from '../../modules';
import { Button, Dialog, Field, Select, TextField } from '../../ui';
import { effectiveWell } from '../preparation/data';
import { useProject } from '../store/project';
import { useResults } from '../store/results';
import "./formula-editor.css";

const units = listUnits().map(({ id, label }) => ({ value: id, label: id === 'unitless' ? 'Sin unidad' : label }));

export function FormulaEditor({ entry }: { entry: WellEntry }) {
  const [draft, setDraft] = useState<CurveFormula | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const open = (formula?: CurveFormula) => {
    setEditing(!!formula);
    setError('');
    setDraft(formula ?? { mnemonic: '', expression: '', unit: 'unitless' });
  };
  return <>
    <Button size="sm" icon="plus" onClick={() => open()}>Nueva curva por fórmula</Button>
    {entry.interpretation.formulas?.map(formula => (
      <div key={formula.mnemonic}>
        <Button size="sm" variant="ghost" onClick={() => open(formula)}>Editar {formula.mnemonic}</Button>
      </div>
    ))}
    {draft && <Dialog open onClose={() => setDraft(null)} title={editing ? 'Editar curva por fórmula' : 'Nueva curva por fórmula'} size="sm">
      <form className="formula-editor" onSubmit={event => {
        event.preventDefault();
        const formula = { ...draft, mnemonic: draft.mnemonic.trim().toUpperCase(), expression: draft.expression.trim() };
        try {
          const store = useProject.getState();
          const well = effectiveWell(entry.well, useResults.getState().result);
          if (!editing && entry.interpretation.formulas?.some(f => f.mnemonic === formula.mnemonic)) {
            throw new Error(`Ya existe la curva ${formula.mnemonic}. Elegí otro mnemónico o editá la fórmula existente.`);
          }
          const next = withCurveFormula(registry, well.curves, entry.interpretation, formula);
          store.commit(`Guardar fórmula ${formula.mnemonic}`, p => updateInterpretation(p, entry.well.id, () => next));
          setDraft(null);
        } catch (e) {
          setError((e as Error).message);
        }
      }}>
        <Field label="Mnemónico" htmlFor={`${id}-name`}>
          <TextField id={`${id}-name`} value={draft.mnemonic} onChange={mnemonic => setDraft({ ...draft, mnemonic })} data-autofocus={!editing ? '' : undefined} readOnly={editing} maxLength={32} block />
        </Field>
        <Field label="Fórmula" htmlFor={`${id}-expression`} hint="Usá mnemónicos o @ROL para elegir la fuente de un rol.">
          <TextField id={`${id}-expression`} value={draft.expression} onChange={expression => setDraft({ ...draft, expression })} data-autofocus={editing ? '' : undefined} maxLength={FORMULA_LENGTH} block />
        </Field>
        <Field label="Unidad del resultado" htmlFor={`${id}-unit`}>
          <Select id={`${id}-unit`} value={draft.unit} onChange={unit => setDraft({ ...draft, unit })} options={units} block />
        </Field>
        {error && <p role="alert" className="ui-field__error">{error}</p>}
        <Button type="submit" variant="primary">Guardar fórmula</Button>
      </form>
    </Dialog>}
  </>;
}
