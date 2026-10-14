/** Panel de la litología sugerida: variante del modelo y su motivo, e importancia de cada curva (MDI del modelo). */
import type { TableValue } from '../../core/module';
import { Badge, EmptyState, formatNumber } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { IMPORTANCE_TABLE, LITHOLOGY_FACIES_ID } from './model';
import './panel.css';

const VARIANT_LABEL: Readonly<Record<string, string>> = { noPe: 'Modelo sin PE', withPe: 'Modelo con PE' };

function LithologyFaciesPanel({ module, result }: ModulePanelProps) {
  const table = result?.outputs.find((o) => o.moduleId === module.id && o.port === IMPORTANCE_TABLE && o.active)?.value as TableValue | undefined;
  const rows = (table?.rows ?? []).filter((r) => typeof r.importance === 'number');
  const max = Math.max(1e-9, ...rows.map((r) => r.importance as number));
  const variant = typeof rows[0]?.variant === 'string' ? rows[0].variant : null;
  const reason = typeof rows[0]?.reason === 'string' ? rows[0].reason : null;
  return (
    <div className="facies-panel">
      <div className="facies-panel__heading">
        <span className="facies-panel__eyebrow">RANDOM FOREST · FORCE 2020</span>
        <Badge tone="warn">Sugerencia</Badge>
      </div>
      {!rows.length ? (
        <EmptyState size="sm" title="Sin modelo aplicado" description="Faltan curvas o el cálculo no terminó. Revisá los avisos del módulo." />
      ) : (
        <>
          <section className="facies-panel__section" aria-label="Variante del modelo">
            <div className="facies-panel__heading">
              <h4>{variant ? (VARIANT_LABEL[variant] ?? variant) : 'Modelo'}</h4>
            </div>
            {reason && <p className="facies-panel__note">{reason}</p>}
          </section>
          <section className="facies-panel__section" aria-label="Importancia de las curvas">
            <h4>Importancia de las curvas</h4>
            <ul className="facies-bars">
              {rows.map((r) => (
                <li key={String(r.feature)} title={`${r.label}: ${formatNumber((r.importance as number) * 100, { digits: 1 })} % de la reducción de impureza del bosque`}>
                  <span className="facies-bars__label">{String(r.label)}</span>
                  <span className="facies-bars__track"><span className="facies-bars__fill" style={{ width: `${(100 * (r.importance as number)) / max}%`, display: 'block' }} /></span>
                  <span className="facies-bars__value num">{formatNumber((r.importance as number) * 100, { digits: 0 })} %</span>
                </li>
              ))}
            </ul>
            <p className="facies-panel__note">Importancia por impureza (MDI) guardada al entrenar con FORCE 2020: cuánto usa el bosque cada curva, no cuánto acierta en este pozo. Sin litología medida del TP no hay con qué medir la exactitud aquí.</p>
          </section>
        </>
      )}
    </div>
  );
}

export const panel: ModulePanel = { moduleId: LITHOLOGY_FACIES_ID, component: LithologyFaciesPanel };
