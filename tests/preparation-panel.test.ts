/**
 * Lógica pura del panel «Preparar datos» (0058): banderas de calidad, tubería de etapas y conteos, y la acción de la
 * paleta. Sin píxeles: el dibujo se prueba en el navegador.
 */
import { describe, expect, it } from 'vitest';
import { Quality } from '../src/core/preparation/quality';
import type { PreparationNode } from '../src/core/preparation/state';
import { columnFlags, dominantFlag, flagCounts, flagRuns, indexRange, minMaxColumns, qualityOf, QUALITY_FLAGS, withSuspects } from '../src/modules/preparation/flags';
import { changedStages, formatOffset, pipelineStages, pipelineSummary, stageCounts } from '../src/modules/preparation/pipeline';
import { windowSamples } from '../src/modules/preparation/FilterEditor';
import { robustSpread } from '../src/modules/preparation/SuspectReview';

const input = { kind: 'original' as const, inputRevisionId: 'rev', curveId: 'GR' };
const base = { id: 'n1', methodVersion: 1 as const, enabled: true, input };
const mask: PreparationNode = { ...base, kind: 'mask', intervals: [{ id: 'a', top: 10, base: 12 }] };
const filtered: PreparationNode = { ...base, kind: 'median-filter', intervals: [{ id: 'a', top: 10, base: 12 }], filter: { top: 0, base: 100, radiusM: 1, maxStepM: 1 } };
const shifted: PreparationNode = {
  ...base,
  kind: 'constant-shift',
  intervals: [],
  gapFill: { top: 0, base: 100, maxGapM: 2 },
  shift: { offsetM: 2, maxGapM: 1, referenceId: 'w', depthKind: 'MD', datum: 'KB' },
};

describe('banderas de calidad', () => {
  it('nombra los ocho bits de Quality en orden, con leyenda en español', () => {
    expect(QUALITY_FLAGS.map((f) => f.bit)).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
    expect(QUALITY_FLAGS.map((f) => f.bit)).toEqual(Object.values(Quality));
    for (const f of QUALITY_FLAGS) {
      expect(f.label.trim()).not.toBe('');
      expect(f.description).not.toMatch(/[=\\^]/); // sin ecuaciones
    }
  });

  it('qualityOf marca solo los faltantes originales y withSuspects agrega «sospechosa» sin tocar el original', () => {
    const q = qualityOf([1, NaN, 3, NaN]);
    expect([...q]).toEqual([1, 0, 0, 1].map((x, i) => (i === 1 || i === 3 ? Quality.OriginallyMissing : 0 * x)));
    const s = withSuspects(q, [2, 99, -1]);
    expect(s[2]).toBe(Quality.Suspect);
    expect(q[2]).toBe(0);
  });

  it('cuenta por bandera en un tramo y arma tramos contiguos', () => {
    const q = Uint16Array.from([0, 2, 2, 0, 2 | 8, 8, 0, 1]);
    const c = flagCounts(q, 1, 6);
    expect(c.excluded).toBe(3);
    expect(c.interpolated).toBe(2);
    expect(c.missing).toBe(0);
    expect(flagRuns(q, Quality.Excluded)).toEqual([
      [1, 3],
      [4, 5],
    ]);
    expect(flagRuns(q, Quality.Interpolated, 0, 5)).toEqual([[4, 5]]);
  });

  it('indexRange incluye ambos extremos y tolera tramos vacíos', () => {
    const d = Float64Array.from([10, 10.5, 11, 11.5, 12]);
    expect(indexRange(d, 10.5, 11.5)).toEqual({ start: 1, end: 4 });
    expect(indexRange(d, 0, 100)).toEqual({ start: 0, end: 5 });
    expect(indexRange(d, 12.1, 13)).toEqual({ start: 5, end: 5 });
    expect(indexRange(d, 12, 11)).toEqual({ start: 0, end: 0 });
  });

  it('columnFlags no pierde una muestra marcada al reducir a columnas', () => {
    const q = new Uint16Array(1000);
    q[537] = Quality.Excluded;
    const cols = columnFlags(q, 0, 1000, 10);
    expect([...cols].filter(Boolean)).toEqual([Quality.Excluded]);
    expect(cols[5]).toBe(Quality.Excluded);
  });

  it('minMaxColumns conserva los picos y deja NaN en columnas sin dato', () => {
    const data = Float64Array.from([1, 9, 2, NaN, NaN, NaN, 3, -4]);
    const { min, max } = minMaxColumns(data, 0, 8, 4);
    expect([...max.slice(0, 1)]).toEqual([9]);
    expect(Number.isNaN(min[2]!)).toBe(true);
    expect(min[3]).toBe(-4);
  });

  it('la bandera dominante prioriza excluida sobre interpolada y faltante', () => {
    expect(dominantFlag(Quality.OriginallyMissing | Quality.Interpolated)).toBe('interpolated');
    expect(dominantFlag(Quality.Excluded | Quality.OriginallyMissing)).toBe('excluded');
    expect(dominantFlag(0)).toBeNull();
  });
});

describe('tubería de preparación', () => {
  const original = Float64Array.from([1, NaN, 3, 4, 5, 6]);

  it('orden fijo del motor y curva sin preparar', () => {
    const s = pipelineStages({ original });
    expect(s.map((x) => x.id)).toEqual(['original', 'exclusion', 'interpolation', 'median', 'alignment', 'prepared']);
    expect(s[0]!.detail).toBe('1 sin dato');
    expect(s.slice(1, 5).every((x) => x.state === 'idle' && x.detail === 'Sin aplicar')).toBe(true);
    expect(s[5]!.detail).toBe('Sin cambios');
    expect(pipelineSummary(s)).toMatch(/opcionales/);
  });

  it('conteos de la receta aplicada salen de las banderas (excluidas sin contar faltantes previos)', () => {
    const quality = Uint16Array.from([0, 1 | 2, 2, 2, 16, 0]);
    const s = pipelineStages({ original, applied: filtered, appliedView: { data: original, quality }, inUse: true, role: 'GR' });
    expect(s.find((x) => x.id === 'exclusion')).toMatchObject({ state: 'done', detail: '2 excluidas', tool: 'exclude' });
    expect(s.find((x) => x.id === 'median')).toMatchObject({ state: 'done', detail: '1 filtradas', tool: 'filter' });
    expect(s.find((x) => x.id === 'interpolation')!.state).toBe('idle');
    expect(s.find((x) => x.id === 'prepared')!.detail).toBe('En uso como GR');
    expect(pipelineSummary(s)).toMatch(/2 de 4 etapas aplicadas/);
  });

  it('la vista previa marca solo las etapas que cambian', () => {
    const quality = Uint16Array.from([0, 1, 2, 2, 2, 0]);
    const s = pipelineStages({ original, applied: mask, preview: filtered, previewView: { data: original, quality } });
    expect(s.find((x) => x.id === 'exclusion')!.state).toBe('done');
    expect(s.find((x) => x.id === 'median')!.state).toBe('preview');
    expect(s.find((x) => x.id === 'prepared')!.state).toBe('preview');
    expect([...changedStages(mask, filtered)]).toEqual(['median']);
    expect(pipelineSummary(s)).toMatch(/Una etapa en vista previa/);
  });

  it('sin resultado todavía, la etapa en vista previa dice que calcula', () => {
    const s = pipelineStages({ original, preview: mask, previewView: null });
    expect(s.find((x) => x.id === 'exclusion')).toMatchObject({ state: 'preview', detail: 'Calculando…' });
  });

  it('alineación: corrimiento con signo y conteos de origen para las etapas previas', () => {
    const quality = Uint16Array.from([32 | 128, 32, 32 | 8 | 1, 32, 32 | 16, 32]);
    const data = Float64Array.from([NaN, 1, 2, 3, 4, 5]);
    const s = pipelineStages({ original, applied: shifted, appliedView: { data, quality, sourceCounts: { interpolated: 7, filtered: 3 } } });
    expect(s.find((x) => x.id === 'alignment')!.detail).toBe('+2,0 m');
    expect(s.find((x) => x.id === 'interpolation')!.detail).toBe('7 estimadas');
    expect(stageCounts(original, { data, quality, sourceCounts: { interpolated: 7, filtered: 3 } })).toMatchObject({ aligned: 5, outOfDomain: 1, filtered: 3 });
  });

  it('MGT bloquea las etapas de limpieza', () => {
    const mgt = { ...base, kind: 'mgt-borehole', intervals: [], mgt: {} } as unknown as PreparationNode;
    const s = pipelineStages({ original, applied: mgt, appliedView: { data: original, quality: new Uint16Array(6) } });
    expect(s.slice(1, 5).every((x) => x.state === 'blocked')).toBe(true);
    expect(s[5]!.detail).toMatch(/MGT/);
    expect(pipelineSummary(s)).toMatch(/MGT/);
  });

  it('formatea desplazamientos con signo tipográfico y coma decimal', () => {
    expect(formatOffset(2)).toBe('+2,0 m');
    expect(formatOffset(-0.15)).toBe('−0,15 m');
    expect(formatOffset(0.3048)).toBe('+0,305 m');
  });
});

describe('ayudas de las herramientas', () => {
  it('ventana de la mediana en muestras', () => {
    expect(windowSamples(0.1524, 0.1524)).toBe(3);
    expect(windowSamples(0.3048, 0.1524)).toBe(5);
    expect(windowSamples(1, 0)).toBe(0);
  });
  it('escala robusta para proponer la desviación mínima', () => {
    const v = Float64Array.from({ length: 101 }, (_, i) => i);
    expect(robustSpread(v)).toBe(90);
    expect(robustSpread([NaN, 5])).toBe(1);
    expect(robustSpread([3, 3, 3])).toBe(3);
  });
});
