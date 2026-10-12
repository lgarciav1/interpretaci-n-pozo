/**
 * Panel de lectura automática del pozo (src/modules/well-reading/model.ts y panel.tsx): tarjetas, líneas generales,
 * filtros, texto para copiar y empalme del panel con el módulo.
 */
import { describe, expect, it } from 'vitest';
import { ALL_ZONES, stripLead, cardsFrom, depthLabel, filterCards, generalFrom, readingText, splitEvidence, viewRangeFor, zonesOf } from '../src/modules/well-reading/model';
import { panel } from '../src/modules/well-reading/panel';
import { registry } from '../src/modules';

const READING = [
  { rank: 2, top: 7800, base: 7804, zoneId: 'zc', zone: 'C', kind: 'water', fluid: 'water', fluidLabel: 'Agua', confidence: 'medium', confidenceLabel: 'Media', text: 'Acuífero.', evidence: 'Sw alta · sin cruce densidad–neutrón' },
  { rank: 1, top: 7650.25, base: 7662.1, zoneId: 'za', zone: 'A', kind: 'hydrocarbon', fluid: 'gas', fluidLabel: 'Gas', confidence: 'high', confidenceLabel: 'Alta', text: 'Gas probable.', evidence: 'Sw baja · Rt 8 veces el acuífero · cruce densidad–neutrón' },
  { rank: 3, top: 7700, base: 7701, zoneId: 'za', zone: 'A', kind: 'hydrocarbon', fluid: 'raro', fluidLabel: '', confidence: 'low', confidenceLabel: '', text: '', evidence: '' },
  { rank: 4, top: null, base: 7701, zoneId: 'za', zone: 'A', kind: 'hydrocarbon', fluid: 'oil', fluidLabel: 'Petróleo', confidence: 'low', confidenceLabel: 'Baja', text: '', evidence: '' },
];
const GENERAL = [
  { order: 2, kind: 'contacts', top: 7790, base: null, text: 'Contacto aparente a 7790 m.' },
  { order: 1, kind: 'summary', top: null, base: null, text: 'Dos tramos con hidrocarburo.' },
];

describe('modelo del panel de lectura', () => {
  const cards = cardsFrom(READING);
  it('ordena por rank, descarta filas sin profundidad y normaliza fluido y confianza', () => {
    expect(cards.map((c) => c.rank)).toEqual([1, 2, 3]);
    expect(cards[0]!.evidence).toEqual(['Sw baja', 'Rt 8 veces el acuífero', 'cruce densidad–neutrón']);
    expect(cards[2]!.fluid).toBe('doubtful');
    expect(cards[2]!.fluidLabel).toBe('Dudoso');
    expect(cards[2]!.confidenceLabel).toBe('Baja');
  });
  it('quita el encabezado de profundidad del texto y capitaliza etiquetas', () => {
    expect(stripLead('8.387,9–8.399,8 m (zona E): 11,4 m de reservorio')).toBe('11,4 m de reservorio');
    expect(stripLead('7700 m: algo')).toBe('Algo');
    expect(cardsFrom([{ ...READING[0]!, fluidLabel: 'petróleo', confidenceLabel: 'media' }])[0]).toMatchObject({ fluidLabel: 'Petróleo', confidenceLabel: 'Media' });
  });
  it('separa evidencias solo en « · »', () => expect(splitEvidence('φ·h alto · Sw baja')).toEqual(['φ·h alto', 'Sw baja']));
  it('líneas generales ordenadas; contacto sin base usa el tope', () => {
    const g = generalFrom(GENERAL);
    expect(g.map((x) => x.kind)).toEqual(['summary', 'contacts']);
    expect(g[0]!.top).toBeNull();
    expect(g[1]).toMatchObject({ top: 7790, base: 7790 });
  });
  it('filtros por tipo y zona', () => {
    expect(zonesOf(cards).map((z) => z.name)).toEqual(['A', 'C']);
    expect(filterCards(cards, 'hydrocarbon', ALL_ZONES)).toHaveLength(2);
    expect(filterCards(cards, 'water', ALL_ZONES)).toHaveLength(1);
    expect(filterCards(cards, 'all', 'zc').map((c) => c.rank)).toEqual([2]);
  });
  it('texto para copiar con generales, tramos y evidencias', () => {
    const t = readingText(generalFrom(GENERAL), cards);
    expect(t).toContain('Dos tramos con hidrocarburo.');
    expect(t).toContain(`1. ${depthLabel(7650.25, 7662.1)} (A) · Gas · confianza alta`);
    expect(t).toContain('Evidencias: Sw baja; Rt 8 veces el acuífero; cruce densidad–neutrón.');
    expect(readingText([], [])).toContain('Sin tramos candidatos');
  });
  it('salto al visor con al menos 20 m de contexto', () => {
    const r = viewRangeFor(7700, 7701);
    expect(r.base - r.top).toBeCloseTo(20);
    expect((r.top + r.base) / 2).toBeCloseTo(7700.5);
  });
  it('el panel se engancha al módulo registrado', () => {
    expect(panel.moduleId).toBe('well-reading');
    expect(registry.get('well-reading')).toBeDefined();
  });
});
