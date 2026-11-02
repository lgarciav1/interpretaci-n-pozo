/**
 * Paso 6 — Importar y exportar: nombre, mnemónico, unidad y rol de cada curva (con la política de roles y
 * mnemónicos repetidos), y «Agregar al pozo activo», «Crear pozo nuevo», «Exportar LAS» y «Exportar CSV».
 */
import { Badge, Button, Checkbox, EmptyState, Field, NumberField, SegmentedControl, Section, Select, TextField } from '../../../ui';
import { selectActiveEntry, useProject } from '../../../app/store/project';
import { addToActiveWell, createNewWell, exportCurves } from '../actions';
import { updateCurve } from '../model/form';
import { importPlan } from '../model/outputs';
import { useDigitizer } from '../store';
import { registry } from '../../index';
import { CurveSwatchDot } from './StepCurves';
import { StepIntro, roleOptions, unitOptions } from './common';
import { useDigitized } from './StepReview';

export function StepOutput() {
  const rows = useDigitized();
  const well = useProject((s) => selectActiveEntry(s)?.well ?? null);
  const choices = useDigitizer((s) => s.importChoices);
  const newWell = useDigitizer((s) => s.newWell);
  const exportStep = useDigitizer((s) => s.exportStep);
  const set = useDigitizer((s) => s.set);
  const updateWork = useDigitizer((s) => s.updateWork);
  if (!rows.length) return <EmptyState size="sm" icon="curve" title="No hay curvas trazadas" description="Trazá al menos una curva en el paso Curvas." />;
  const included = rows.filter((r) => r.curve.include && r.series && r.series.depthM.length > 0).length;
  return (
    <>
      <StepIntro>Las curvas entran como curvas medidas (fuente «Log Digitizer»). Agregarlas al pozo es un paso que se deshace con Ctrl+Z en la app.</StepIntro>
      <Section title="Curvas" meta={`${included} de ${rows.length}`}>
        {rows.map(({ curve: c }) => {
          const plan = importPlan(c, well, choices[c.id]);
          return (
            <div key={c.id} className="dz-out">
              <div className="dz-out__head">
                <Checkbox checked={c.include} onChange={(on) => updateWork((w) => updateCurve(w, c.id, { include: on }))} aria-label={`Incluir ${c.mnemonic}`} />
                <CurveSwatchDot c={c} />
                <strong>{c.mnemonic}</strong>
                {well && plan.meta.mnemonic !== c.mnemonic && <Badge tone="info">entra como {plan.meta.mnemonic}</Badge>}
              </div>
              <div className="dz-grid2">
                <Field label="Mnemónico">
                  <TextField size="sm" value={c.mnemonic} onChange={(v) => updateWork((w) => updateCurve(w, c.id, { mnemonic: v.toUpperCase() }))} aria-label={`Mnemónico de ${c.mnemonic}`} />
                </Field>
                <Field label="Unidad">
                  <Select size="sm" value={c.unit} options={unitOptions(c.role, c.unit)} onChange={(v) => updateWork((w) => updateCurve(w, c.id, { unit: v }))} aria-label={`Unidad de ${c.mnemonic}`} />
                </Field>
              </div>
              <div className="dz-grid2">
                <Field label="Rol">
                  <Select size="sm" value={c.role ?? ''} options={roleOptions()} onChange={(v) => updateWork((w) => updateCurve(w, c.id, { role: v || null, ...(v ? { unit: registry.roles.get(v)?.unit ?? c.unit } : {}) }))} aria-label={`Rol de ${c.mnemonic}`} />
                </Field>
                <Field label="Descripción">
                  <TextField size="sm" value={c.description} placeholder="Digitalizada con Log Digitizer" onChange={(v) => updateWork((w) => updateCurve(w, c.id, { description: v }))} aria-label={`Descripción de ${c.mnemonic}`} />
                </Field>
              </div>
              {plan.roleConflict && (
                <Checkbox
                  checked={!!choices[c.id]?.keepRole}
                  onChange={(on) => set({ importChoices: { ...choices, [c.id]: { keepRole: on } } })}
                  label={`Conservar el rol ${c.role} en el pozo activo`}
                  description={`El pozo ya tiene ${plan.roleConflict} con ese rol. Por defecto la digitalizada entra sin rol y los cálculos no cambian.`}
                />
              )}
              {well && plan.notes.length > 0 && (
                <ul className="dz-notes">
                  {plan.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="Pozo activo">
        {well ? (
          <>
            <p className="dz-muted">
              {well.name}: las curvas se remuestrean a su índice de profundidad ({well.depth.values.length.toLocaleString('es-AR')} muestras), sin extrapolar; fuera del tramo digitalizado quedan sin dato.
            </p>
            <div>
              <Button variant="primary" icon="plus" disabled={!included} onClick={addToActiveWell} data-testid="digitizer-add-to-well">
                Agregar al pozo activo
              </Button>
            </div>
          </>
        ) : (
          <p className="dz-muted">No hay pozo activo: creá uno nuevo con las curvas digitalizadas.</p>
        )}
      </Section>

      <Section title="Pozo nuevo">
        <Field label="Nombre">
          <TextField size="sm" value={newWell.name} onChange={(v) => set({ newWell: { ...newWell, name: v } })} aria-label="Nombre del pozo nuevo" />
        </Field>
        <div className="dz-grid2">
          <Field label="Paso de muestreo">
            <NumberField size="sm" value={newWell.step} min={0.001} max={100} step={0.0001} format={(v) => String(v).replace('.', ',')} onChange={(v) => set({ newWell: { ...newWell, step: v } })} aria-label="Paso del pozo nuevo" />
          </Field>
          <Field label="Unidad">
            <SegmentedControl aria-label="Unidad del paso del pozo nuevo" size="sm" value={newWell.unit} onChange={(u) => set({ newWell: { ...newWell, unit: u, step: u === 'ft' ? 0.5 : 0.1524 } })} options={[{ value: 'm', label: 'm' }, { value: 'ft', label: 'ft' }]} />
          </Field>
        </div>
        <div>
          <Button variant={well ? 'secondary' : 'primary'} icon="well" disabled={!included} onClick={createNewWell} data-testid="digitizer-new-well">
            Crear pozo nuevo
          </Button>
        </div>
      </Section>

      <Section title="Archivo">
        <div className="dz-grid2">
          <Field label="Paso de muestreo">
            <NumberField size="sm" value={exportStep.step} min={0.001} max={100} step={0.0001} format={(v) => String(v).replace('.', ',')} onChange={(v) => set({ exportStep: { ...exportStep, step: v } })} aria-label="Paso del archivo exportado" />
          </Field>
          <Field label="Unidad">
            <SegmentedControl aria-label="Unidad de profundidad del archivo" size="sm" value={exportStep.unit} onChange={(u) => set({ exportStep: { unit: u, step: u === 'ft' ? 0.5 : 0.1524 } })} options={[{ value: 'm', label: 'm' }, { value: 'ft', label: 'ft' }]} />
          </Field>
        </div>
        <div className="dz-row">
          <Button icon="download" disabled={!included} onClick={() => exportCurves('las')} data-testid="digitizer-export-las">
            Exportar LAS
          </Button>
          <Button icon="download" disabled={!included} onClick={() => exportCurves('csv')} data-testid="digitizer-export-csv">
            Exportar CSV
          </Button>
        </div>
      </Section>
    </>
  );
}
