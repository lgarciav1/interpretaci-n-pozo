/**
 * Lógica pura del panel de lectura automática del pozo (sin React): lee las tablas del módulo, arma las tarjetas de
 * lectura y las líneas generales, aplica los filtros y compone el texto para copiar al informe. No recalcula nada del
 * motor (src/petro/wellReading.ts).
 */
import type { TableCell } from '../../core/module';

export type Row = Readonly<Record<string, TableCell>>;

export type ReadingKind = 'hydrocarbon' | 'water';
export type ReadingFluid = 'gas' | 'oil' | 'water' | 'doubtful';
export type ReadingConfidence = 'high' | 'medium' | 'low';
export type KindFilter = 'all' | ReadingKind;

/** Clave del filtro de zona para «todas». */
export const ALL_ZONES = '__all';

const num = (c: TableCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : NaN);
const str = (c: TableCell | undefined): string => (c === null || c === undefined ? '' : String(c));
const capitalize = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('es') + s.slice(1) : s);
/** El motor abre cada lectura con «tope–base m (zona X): »; la tarjeta ya muestra eso, así que se quita. */
export const stripLead = (text: string): string => capitalize(text.replace(/^[\d.,\s–-]+m(\s*\([^)]*\))?\s*:\s*/, ''));
const pick = <T extends string>(c: TableCell | undefined, allowed: readonly T[], fallback: T): T => {
  const s = str(c) as T;
  return allowed.includes(s) ? s : fallback;
};

export interface ReadingCard {
  rank: number;
  top: number;
  base: number;
  zoneId: string;
  zone: string;
  kind: ReadingKind;
  fluid: ReadingFluid;
  fluidLabel: string;
  confidence: ReadingConfidence;
  confidenceLabel: string;
  text: string;
  evidence: string[];
  h: number;
}

export interface GeneralLine {
  order: number;
  kind: 'summary' | 'contacts' | 'quality';
  top: number | null;
  base: number | null;
  text: string;
}

const FLUID_LABEL: Record<ReadingFluid, string> = { gas: 'Gas', oil: 'Petróleo', water: 'Agua', doubtful: 'Dudoso' };
const CONFIDENCE_LABEL: Record<ReadingConfidence, string> = { high: 'Alta', medium: 'Media', low: 'Baja' };

/** Evidencias: el motor las une con « · ». */
export const splitEvidence = (s: TableCell | undefined): string[] =>
  str(s)
    .split(' · ')
    .map((e) => e.trim())
    .filter(Boolean);

/** Tarjetas en el orden del motor (rank creciente). */
export function cardsFrom(rows: readonly Row[]): ReadingCard[] {
  return rows
    .map((r) => {
      const fluid = pick(r.fluid, ['gas', 'oil', 'water', 'doubtful'] as const, 'doubtful');
      const confidence = pick(r.confidence, ['high', 'medium', 'low'] as const, 'low');
      return {
        rank: num(r.rank),
        top: num(r.top),
        base: num(r.base),
        zoneId: str(r.zoneId),
        zone: str(r.zone),
        kind: pick(r.kind, ['hydrocarbon', 'water'] as const, fluid === 'water' ? 'water' : 'hydrocarbon'),
        fluid,
        fluidLabel: capitalize(str(r.fluidLabel)) || FLUID_LABEL[fluid],
        confidence,
        confidenceLabel: capitalize(str(r.confidenceLabel)) || CONFIDENCE_LABEL[confidence],
        text: stripLead(str(r.text)),
        evidence: splitEvidence(r.evidence),
        h: num(r.h),
      };
    })
    .filter((c) => Number.isFinite(c.top) && Number.isFinite(c.base))
    .sort((a, b) => (Number.isFinite(a.rank) ? a.rank : Infinity) - (Number.isFinite(b.rank) ? b.rank : Infinity));
}

export function generalFrom(rows: readonly Row[]): GeneralLine[] {
  return rows
    .map((r) => {
      const top = num(r.top);
      const base = num(r.base);
      return {
        order: num(r.order),
        kind: pick(r.kind, ['summary', 'contacts', 'quality'] as const, 'summary'),
        top: Number.isFinite(top) ? top : null,
        base: Number.isFinite(base) ? base : Number.isFinite(top) ? top : null,
        text: str(r.text),
      };
    })
    .filter((g) => g.text)
    .sort((a, b) => a.order - b.order);
}

/** Zonas presentes en las tarjetas, en orden de profundidad (sin repetir). */
export function zonesOf(cards: readonly ReadingCard[]): { id: string; name: string }[] {
  const seen = new Map<string, { id: string; name: string; top: number }>();
  for (const c of cards) {
    const prev = seen.get(c.zoneId);
    if (!prev) seen.set(c.zoneId, { id: c.zoneId, name: c.zone || 'Pozo completo', top: c.top });
    else if (c.top < prev.top) prev.top = c.top;
  }
  return [...seen.values()].sort((a, b) => a.top - b.top).map(({ id, name }) => ({ id, name }));
}

export function filterCards(cards: readonly ReadingCard[], kind: KindFilter, zone: string): ReadingCard[] {
  return cards.filter((c) => (kind === 'all' || c.kind === kind) && (zone === ALL_ZONES || c.zoneId === zone));
}

const fmtDepth = (v: number) => v.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** «7650,3–7662,1 m»; una sola cifra si tope = base. */
export const depthLabel = (top: number, base: number): string => (base - top > 1e-6 ? `${fmtDepth(top)}–${fmtDepth(base)} m` : `${fmtDepth(top)} m`);

/** Texto plano para pegar en el informe: líneas generales y luego cada tramo con fluido, confianza y evidencias. */
export function readingText(general: readonly GeneralLine[], cards: readonly ReadingCard[]): string {
  const out: string[] = ['Lectura automática del pozo', ''];
  for (const g of general) out.push(g.text);
  if (general.length) out.push('');
  if (!cards.length) out.push('Sin tramos candidatos con los cutoffs actuales.');
  cards.forEach((c, i) => {
    const where = `${depthLabel(c.top, c.base)}${c.zone ? ` (${c.zone})` : ''}`;
    out.push(`${i + 1}. ${where} · ${c.fluidLabel} · confianza ${c.confidenceLabel.toLowerCase()}`);
    if (c.text) out.push(`   ${c.text}`);
    if (c.evidence.length) out.push(`   Evidencias: ${c.evidence.join('; ')}.`);
  });
  return out.join('\n').trimEnd() + '\n';
}

/** Tramo a mostrar en el visor al hacer clic: centrado en el tramo, con al menos `minSpan` m de contexto. */
export function viewRangeFor(top: number, base: number, minSpan = 20): { top: number; base: number } {
  const mid = (top + base) / 2;
  const span = Math.max(minSpan, (base - top) * 1.5);
  return { top: mid - span / 2, base: mid + span / 2 };
}
