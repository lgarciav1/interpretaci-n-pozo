/** Leyenda y espesores desde la misma tabla de capas que alimenta la pista. */
import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { TableValue } from '../../core/module';
import type { SedLayer, SedLithology } from '../../petro/sedColumn';
import { useTrendsUi } from '../../app/trends/store';
import { Badge, EmptyState, formatNumber, useThemeTokens } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { decodeSedLayers } from './model';
import { LITHOLOGIES, LITHOLOGY_LABEL, LITHOLOGY_PATTERNS, PATTERN_REFERENCE, lithologyPaint } from './draw';
import { layerTooltip } from './overlay';
import { getSelectedLayer, selectLayer, subscribeSelectedLayer } from './selection';
import './panel.css';

const fmt = (value: number) => formatNumber(value, { digits: 1 });

/** La miniatura usa el mosaico vectorial de la pista, nunca una textura estirada. */
function PatternSwatch({ lithology }: { lithology: SedLithology }) {
  const id = `sed-pattern-${useId().replace(/:/g, '')}`;
  const theme = useThemeTokens();
  const pattern = LITHOLOGY_PATTERNS[lithology];
  const paint = lithologyPaint(lithology, theme);
  return <svg className="sed-swatch" width="36" height="24" viewBox="0 0 36 24" aria-hidden="true">
    <title>{PATTERN_REFERENCE[lithology]}</title>
    <defs><pattern id={id} width={pattern.width} height={pattern.height} patternUnits="userSpaceOnUse">
      <rect width={pattern.width} height={pattern.height} fill={paint.background} />
      {pattern.lines?.map(([x1, y1, x2, y2], i) => <line key={`l${i}`} {...{ x1, y1, x2, y2 }} stroke={paint.stroke} strokeWidth=".85" />)}
      {pattern.dots?.map(([cx, cy, r], i) => <circle key={`d${i}`} {...{ cx, cy, r }} fill={paint.stroke} />)}
    </pattern></defs>
    <rect x=".5" y=".5" width="35" height="23" rx="3" fill={`url(#${id})`} stroke={theme.viewer.trackBorder} />
  </svg>;
}

function thicknessFor(layers: readonly SedLayer[], lithology: SedLithology): number {
  return layers.reduce((sum, layer) => sum + (layer.lithology === lithology ? layer.thickness : 0), 0);
}

function SedColumnPanel({ module, result, interpretation, zoneId }: ModulePanelProps) {
  const table = result?.outputs.find(output => output.moduleId === module.id && output.port === 'SED_COLUMN_LAYERS' && output.active)?.value as TableValue | undefined;
  const layers = useMemo(() => decodeSedLayers(table), [table]);
  const [pickedZone, setPickedZone] = useState<string | null>(null);
  const zone = pickedZone === 'all' ? null : pickedZone ?? zoneId;
  const selected = useSyncExternalStore(subscribeSelectedLayer, getSelectedLayer, getSelectedLayer);
  const selectedTop = selected?.wellId === result?.wellId ? selected?.top : null;
  const selectedLayer = selectedTop !== null && selectedTop !== undefined ? layers.find(layer => layer.top === selectedTop) : null;
  const zones = interpretation.zones.map(item => ({ ...item, layers: layers.filter(layer => layer.zoneId === item.id) }));
  const scoped = zone === null ? layers : layers.filter(layer => layer.zoneId === zone);
  const scopeName = interpretation.zones.find(item => item.id === zone)?.name ?? 'Pozo completo';
  const total = layers.reduce((sum, layer) => sum + layer.thickness, 0);
  const scopedTotal = scoped.reduce((sum, layer) => sum + layer.thickness, 0);
  const mineral = layers.some(layer => layer.source === 'minerals');
  const pick = (layer: SedLayer) => {
    if (result) selectLayer(result.wellId, layer.top);
    useTrendsUi.getState().requestRange(layer.top, layer.base);
  };

  return <div className="sed-panel">
    <div className="sed-panel__heading"><span className="sed-panel__eyebrow">COLUMNA SEDIMENTOLÓGICA</span><Badge tone="info">Estimación</Badge></div>
    <p className="sed-panel__note">Litología y grano estimados desde perfiles; no describen un testigo. En carbonatos el ancho también es un proxy de GR o Vsh, no una textura medida.</p>
    {!layers.length ? <EmptyState size="sm" title="Sin capas calculadas" description="Se necesita GR, Vsh o una inversión mineral válida. Revisá las entradas y los avisos del motor." /> : <>
      <div className="sed-panel__stats"><div><strong className="num">{fmt(total)} <small>m</small></strong><span>espesor representado</span></div><div><strong className="num">{layers.length}</strong><span>capas</span></div></div>
      <p className="sed-panel__source">{mineral ? 'Minerales dominantes de la inversión, con respaldo en Vsh y GR donde falta.' : 'Clasificación de respaldo desde Vsh o GR normalizado.'}</p>
      <section className="sed-panel__section" aria-label="Espesores por litología">
        <div className="sed-panel__section-heading"><h4>Tramas y espesores</h4><button type="button" className="sed-panel__reset" onClick={() => setPickedZone('all')}>Todo el pozo</button></div>
        <table className="sed-legend"><thead><tr><th>Litología</th><th>Total · m</th><th>{zone !== null && zone !== 'all' ? scopeName : '% total'}</th></tr></thead><tbody>
          {LITHOLOGIES.map(lithology => {
            const thickness = thicknessFor(layers, lithology);
            const partial = thicknessFor(scoped, lithology);
            return <tr key={lithology} className={thickness ? '' : 'sed-legend__inactive'}><td><PatternSwatch lithology={lithology} /><span>{LITHOLOGY_LABEL[lithology]}</span></td><td className="num">{fmt(thickness)}</td><td className="num">{zone !== null && zone !== 'all' ? `${fmt(partial)} m` : `${fmt(total ? thickness / total * 100 : 0)} %`}</td></tr>;
          })}
        </tbody></table>
        <p className="sed-panel__note">Anhidrita: trama provisional (SIN VERIFICAR); la inversión actual no aporta ese componente.</p>
      </section>
      {!!zones.length && <section className="sed-panel__section" aria-label="Espesores por zona">
        <h4>Por zona <span className="sed-panel__quiet">elegí una para desglosar</span></h4>
        <table className="sed-zones"><thead><tr><th>Zona</th><th>Espesor · m</th><th>Litología dominante</th></tr></thead><tbody>{zones.map(item => {
          const thickness = item.layers.reduce((sum, layer) => sum + layer.thickness, 0);
          const dominant = [...LITHOLOGIES].sort((a, b) => thicknessFor(item.layers, b) - thicknessFor(item.layers, a))[0]!;
          return <tr key={item.id} className={zone === item.id ? 'is-selected' : ''}><td><button type="button" onClick={() => { setPickedZone(item.id); useTrendsUi.getState().requestRange(item.top, item.base); }} aria-pressed={zone === item.id}>{item.name}</button></td><td className="num">{fmt(thickness)}</td><td>{thickness ? LITHOLOGY_LABEL[dominant] : 'Sin capas'}</td></tr>;
        })}</tbody></table>
      </section>}
      {selectedLayer && <section className="sed-layer-detail" aria-label="Capa seleccionada"><div className="sed-panel__section-heading"><h4>{LITHOLOGY_LABEL[selectedLayer.lithology]}</h4><button type="button" className="sed-panel__reset" onClick={() => result && selectLayer(result.wellId, null)}>Cerrar</button></div><p>{layerTooltip(selectedLayer)}</p></section>}
      <section className="sed-panel__section" aria-label="Capas"><div className="sed-panel__section-heading"><h4>Capas {zone !== null && zone !== 'all' ? `· ${scopeName}` : ''}</h4><span className="sed-panel__quiet num">{fmt(zone === 'all' ? total : scopedTotal)} m</span></div>
        <div className="sed-layer-list">{(zone === 'all' ? layers : scoped).map(layer => <button key={layer.top} type="button" className={`sed-layer-row${selectedLayer === layer ? ' is-selected' : ''}`} onClick={() => pick(layer)} title={layerTooltip(layer)}>
          <PatternSwatch lithology={layer.lithology} /><span><strong>{LITHOLOGY_LABEL[layer.lithology]}</strong><small className="num">{fmt(layer.top)}–{fmt(layer.base)} m</small></span><span className="num">{fmt(layer.thickness)} m</span>
        </button>)}</div>
      </section>
      <p className="sed-panel__note">Arc · lim · mf · f · m · g · gr: clases ordinales de grano. El contorno es un proxy; el tamaño no se midió. El carbón subpíxel conserva un mínimo gráfico de 1,5 px.</p>
    </>}
  </div>;
}

export const panel: ModulePanel = { moduleId: 'sed-column', component: SedColumnPanel };
