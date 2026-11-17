/**
 * Panel a medida de la lectura automática del pozo (función T): líneas generales como párrafo de lectura (las que
 * tienen profundidad llevan al tramo), tarjetas por tramo candidato con fluido (color convencional de relleno),
 * confianza, profundidad, zona, texto y evidencias; filtros por tipo y zona; «Copiar lectura» para el informe.
 * Clic en una tarjeta = el visor va a ese tramo con al menos 20 m de contexto.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useTrendsUi } from '../../app/trends/store';
import type { TableValue } from '../../core/module';
import { Badge, Button, EmptyState, SegmentedControl, copyText, ensureContrast, fillColor, toast, useThemeTokens, withAlpha, type FillId } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import {
  ALL_ZONES,
  cardsFrom,
  depthLabel,
  filterCards,
  generalFrom,
  readingText,
  viewRangeFor,
  zonesOf,
  type KindFilter,
  type ReadingCard,
  type ReadingConfidence,
  type ReadingFluid,
} from './model';
import './panel.css';

const FLUID_FILL: Record<ReadingFluid, FillId> = { gas: 'gas', oil: 'oil', water: 'water', doubtful: 'undivided' };
const CONFIDENCE_TONE: Record<ReadingConfidence, 'ok' | 'info' | 'neutral'> = { high: 'ok', medium: 'info', low: 'neutral' };

const goTo = (top: number, base: number) => {
  const r = viewRangeFor(top, base);
  useTrendsUi.getState().requestRange(r.top, r.base);
};

function WellReadingPanel({ module, result }: ModulePanelProps) {
  const theme = useThemeTokens();
  const table = (port: string) => (result?.outputs.find((o) => o.moduleId === module.id && o.port === port)?.value as TableValue | undefined)?.rows ?? [];
  const readingRows = table('WELL_READING');
  const generalRows = table('WELL_READING_GENERAL');
  const cards = useMemo(() => cardsFrom(readingRows), [readingRows]);
  const general = useMemo(() => generalFrom(generalRows), [generalRows]);
  const zones = useMemo(() => zonesOf(cards), [cards]);

  const [kind, setKind] = useState<KindFilter>('all');
  const [zonePicked, setZone] = useState<string>(ALL_ZONES);
  const zone = zonePicked === ALL_ZONES || zones.some((z) => z.id === zonePicked) ? zonePicked : ALL_ZONES;

  const shown = useMemo(() => filterCards(cards, kind, zone), [cards, kind, zone]);
  const count = (k: KindFilter) => filterCards(cards, k, zone).length;

  const fluidStyle = (f: ReadingFluid): CSSProperties => {
    const c = fillColor(FLUID_FILL[f], theme.name).color;
    return {
      ['--fluid' as string]: c,
      ['--fluid-soft' as string]: withAlpha(c, theme.name === 'dark' ? 0.22 : 0.14),
      ['--fluid-text' as string]: ensureContrast(c, theme.color.surface, 4.5),
    };
  };

  const copy = async () => {
    const ok = await copyText(readingText(general, shown.length ? shown : cards));
    toast(ok ? { tone: 'ok', title: 'Lectura copiada', description: 'Pegala en el informe: líneas generales y tramos con sus evidencias.' } : { tone: 'error', title: 'No se pudo copiar', description: 'El navegador no dio acceso al portapapeles.' });
  };

  if (!result) return null;

  return (
    <div className="wrd">
      <section className="wrd-lead" aria-label="Lectura general">
        <div className="wrd-lead__head">
          <h4 className="wrd-title">Lectura general</h4>
          <Button size="sm" variant="secondary" icon="copy" onClick={copy} disabled={!general.length && !cards.length}>
            Copiar lectura
          </Button>
        </div>
        {general.length ? (
          <p className="wrd-lead__text">
            {general.map((g) =>
              g.top !== null ? (
                <button key={g.order} type="button" className="wrd-lead__link" title="Ver en el visor" onClick={() => goTo(g.top!, g.base ?? g.top!)}>
                  {g.text}
                </button>
              ) : (
                <span key={g.order}>{g.text}</span>
              ),
            ).flatMap((el, i) => (i ? [' ', el] : [el]))}
          </p>
        ) : (
          <p className="wrd-note">Sin lectura general para este pozo.</p>
        )}
      </section>

      {cards.length === 0 ? (
        <EmptyState
          size="sm"
          icon="search"
          title="Ningún tramo pasa los criterios"
          description="No hay tramos candidatos con los cutoffs actuales. Revisá los cutoffs de φ, Sw y Vsh, o bajá «Espesor mínimo del tramo» y «Resistividad relativa mínima»."
        />
      ) : (
        <section className="wrd-list" aria-label="Tramos leídos">
          <div className="wrd-filters">
            <SegmentedControl<KindFilter>
              aria-label="Tipo de tramo"
              size="sm"
              block
              value={kind}
              onChange={setKind}
              options={[
                { value: 'hydrocarbon', label: `Hidrocarburo ${count('hydrocarbon')}` },
                { value: 'water', label: `Agua ${count('water')}` },
                { value: 'all', label: `Todos ${count('all')}` },
              ]}
            />
            {zones.length > 1 && (
              <SegmentedControl
                aria-label="Zona"
                size="sm"
                block
                wrap
                value={zone}
                onChange={setZone}
                options={[{ value: ALL_ZONES, label: 'Todas' }, ...zones.map((z) => ({ value: z.id, label: z.name }))]}
              />
            )}
          </div>

          {shown.length === 0 ? (
            <p className="wrd-note">Ningún tramo con este filtro.</p>
          ) : (
            <ol className="wrd-cards">
              {shown.map((c) => (
                <li key={`${c.rank}-${c.top}`}>
                  <ReadingCardView card={c} style={fluidStyle(c.fluid)} />
                </li>
              ))}
            </ol>
          )}
          <p className="wrd-note">Clic en un tramo para verlo en el visor. El orden sigue la importancia: espesor × porosidad × saturación de hidrocarburo.</p>
        </section>
      )}
    </div>
  );
}

function ReadingCardView({ card: c, style }: { card: ReadingCard; style: CSSProperties }) {
  return (
    <button
      type="button"
      className={`wrd-card${c.confidence === 'low' ? ' is-low' : ''}`}
      style={style}
      data-fluid={c.fluid}
      onClick={() => goTo(c.top, c.base)}
      aria-label={`${c.fluidLabel}, confianza ${c.confidenceLabel.toLowerCase()}, ${depthLabel(c.top, c.base)}${c.zone ? `, ${c.zone}` : ''}. Ver en el visor.`}
    >
      <span className="wrd-card__head">
        <span className="wrd-card__rank num">{c.rank}</span>
        <span className="wrd-fluid">
          <span className="wrd-fluid__dot" aria-hidden="true" />
          {c.fluidLabel}
        </span>
        <Badge tone={CONFIDENCE_TONE[c.confidence]} variant={c.confidence === 'low' ? 'outline' : 'soft'} className="wrd-conf" title="Confianza de la lectura">
          {c.confidenceLabel}
        </Badge>
        <span className="wrd-card__where">
          <span className="wrd-card__depth num">{depthLabel(c.top, c.base)}</span>
          {c.zone && <span className="wrd-card__zone">{c.zone}</span>}
        </span>
      </span>
      {c.text && <span className="wrd-card__text">{c.text}</span>}
      {c.evidence.length > 0 && (
        <span className="wrd-card__evidence">
          {c.evidence.map((e) => (
            <span key={e} className="wrd-ev">
              {e}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

export const panel: ModulePanel = { moduleId: 'well-reading', component: WellReadingPanel };
