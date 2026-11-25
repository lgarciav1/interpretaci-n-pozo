/**
 * G01 — Regla viva de Pay al medir un intervalo:
 *   - Paridad exacta entre `summarizeDepthInterval` y `ZONE_SUMMARY` sobre el pozo real del TP (y casos sintéticos con
 *     ponderación por espesor, volumen poral h·φ y media geométrica de k > 0).
 *   - Comportamiento sin inventar ceros cuando faltan curvas (sin cutoffs, sin PERM, sin Sw, tramo sin clasificar).
 *   - Ficha TSV («Copiar ficha del intervalo medido»), texto y acotado de nota («Crear nota en el intervalo medido»).
 *   - Superposición `createMeasureTool`: tarjeta compacta vs. píldora, actualización en vivo sin re-arrastrar,
 *     no mutación de zonas/interpretación/historial y fluidez durante el arrastre.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { computedCurves } from '../src/app/computed';
import { plotContextOf } from '../src/app/plots/context';
import type { ClientResult } from '../src/core/engine/client';
import { engineContext } from '../src/core/engine/context';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { NOTE_MAX_LENGTH } from '../src/core/notes';
import { saveNote } from '../src/core/state/notes';
import { addWell, createProject, getWellEntry } from '../src/core/state/project';
import { sampleThickness } from '../src/core/well';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { zoneSummaryStats } from '../src/modules/zone-summary/stats';
import { depthIndexRange, summarizeDepthInterval, type DepthIntervalInput } from '../src/petro/summary';
import { engineInputData } from '../src/plots/data';
import { thicknessOf } from '../src/plots/distribution/series';
import { THEMES } from '../src/ui/tokens';
import {
  clampMeasurementForNote,
  measureCardItems,
  measureInterval,
  measureLabel,
  measurementNoteText,
  measurementSheetText,
} from '../src/viewer/contextMenu';
import type { OverlayFrame } from '../src/viewer/overlay';
import { createMeasureTool } from '../src/viewer/overlays/measure';
import { createNotesOverlay } from '../src/viewer/overlays/notes';

function runTpEngine() {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const interpretation = { ...emptyInterpretation(), zones };
  const engine = new Engine(registry);
  engine.setWell(toEngineWell(well));
  const raw = engine.run(interpretation);
  const result: ClientResult = {
    ...raw,
    context: engineContext(toEngineWell(well), interpretation),
    wellId: well.id,
    seq: 1,
    gen: 1,
    roundTripMs: 0,
    coalesced: 0,
  };
  const computed = computedCurves(result, well);
  const ctx = plotContextOf(well, interpretation, computed);
  const get = (port: string) => engineInputData(ctx, result.sources, port);
  const input: DepthIntervalInput = {
    depth: well.depth.values,
    thickness: thicknessOf(well),
    netRes: get('NET_RES'),
    netPay: get('NET_PAY'),
    netSand: get('NET_SAND'),
    phi: get('PHIE'),
    sw: get('SW'),
    vsh: get('VSH'),
    perm: get('PERM'),
  };
  const tableOut = result.outputs.find((o) => o.port === 'ZONE_SUMMARY' && o.active);
  const rows = (tableOut?.value as TableValue).rows;
  return { well, zones, interpretation, result, computed, input, rows };
}

function fakeCanvas() {
  const texts: string[] = [];
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  let roundRects = 0;
  const ctx = new Proxy(
    {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: '',
      textBaseline: '',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop === 'fillText') return (text: string) => texts.push(text);
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 6.5 });
        if (prop === 'roundRect') return (x: number, y: number, w: number, h: number) => {
          roundRects++;
          boxes.push({ x, y, w, h });
        };
        if (prop in target) return target[prop as string];
        return () => {};
      },
      set(target, prop, value) {
        target[prop as string] = value;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, boxes, getRoundRects: () => roundRects };
}

describe('G01 — summarizeDepthInterval y paridad con ZONE_SUMMARY', () => {
  const tp = runTpEngine();

  it('medir exactamente tope–base de cada zona del pozo del TP coincide con su fila en ZONE_SUMMARY', () => {
    expect(tp.zones.length).toBeGreaterThanOrEqual(5);
    let zonesWithPay = 0;

    const fullStats =
      tp.input.netRes && tp.input.netPay && tp.input.phi && tp.input.sw
        ? zoneSummaryStats(
            {
              thickness: tp.input.thickness!,
              netRes: tp.input.netRes,
              netPay: tp.input.netPay,
              phi: tp.input.phi,
              sw: tp.input.sw,
              ...(tp.input.vsh ? { vsh: tp.input.vsh } : {}),
              ...(tp.input.perm ? { perm: tp.input.perm } : {}),
            },
            tp.well.depth.values,
            tp.zones,
          )
        : null;

    for (const z of tp.zones) {
      const row = tp.rows.find((r) => r.zone === z.name);
      expect(row).toBeDefined();
      const s = summarizeDepthInterval(tp.input, z.top, z.base);
      const rev = summarizeDepthInterval(tp.input, z.base, z.top);
      expect(rev).toEqual(s);

      expect(s.hasNetRes).toBe(true);
      expect(s.netRes).toBeCloseTo(row!.netRes as number, 12);
      expect(s.ntgRes).toBeCloseTo(row!.ntgRes as number, 12);

      if (typeof row!.netPay === 'number') {
        expect(s.netPay).toBeCloseTo(row!.netPay, 12);
        expect(s.ntgPay).toBeCloseTo(row!.ntgPay as number, 12);
        if (row!.netPay > 0) zonesWithPay++;
      } else {
        expect(s.netPay).toBeNaN();
      }

      if (typeof row!.phiRes === 'number') expect(s.phiRes).toBeCloseTo(row!.phiRes, 12);
      else expect(s.phiRes).toBeNaN();

      if (typeof row!.phiPay === 'number') expect(s.phiPay).toBeCloseTo(row!.phiPay, 12);
      else expect(s.phiPay).toBeNaN();

      if (typeof row!.swPay === 'number') expect(s.swPay).toBeCloseTo(row!.swPay, 12);
      else expect(s.swPay).toBeNaN();

      if (typeof row!.hphiShPay === 'number') expect(s.hphiShPay).toBeCloseTo(row!.hphiShPay, 12);
      else expect(s.hphiShPay).toBeNaN();

      if (typeof row!.khPay === 'number') expect(s.khPay).toBeCloseTo(row!.khPay, 12);
      else expect(s.khPay).toBeNaN();

      const statRow = fullStats?.get(z.name);
      if (statRow) {
        if (Number.isFinite(statRow.kMeansPay.geo)) expect(s.kGeoPay).toBeCloseTo(statRow.kMeansPay.geo, 12);
        else expect(s.kGeoPay).toBeNaN();
      }
    }
    expect(zonesWithPay).toBeGreaterThan(0);
  });

  it('verifica manualmente ponderación por espesor, Sw ponderada por volumen poral φ·h y k geométrica (k > 0)', () => {
    // 5 muestras con espesores desiguales: [1, 2, 1, 2, 1]
    const depth = Float64Array.from([100, 101, 103, 104, 106]);
    const thickness = Float64Array.from([1, 2, 1, 2, 1]);
    // Muestra 0: no res; Muestra 1: res sin pay; Muestra 2: pay (k=10); Muestra 3: pay (k=40); Muestra 4: pay (k=0)
    const netRes = Float64Array.from([0, 1, 1, 1, 1]);
    const netPay = Float64Array.from([0, 0, 1, 1, 1]);
    const phi = Float64Array.from([0.05, 0.12, 0.1, 0.3, 0.2]);
    const sw = Float64Array.from([0.9, 0.7, 0.2, 0.5, 0.4]);
    const perm = Float64Array.from([0.1, 2, 10, 40, 0]);

    const s = summarizeDepthInterval({ depth, thickness, netRes, netPay, phi, sw, perm }, 100, 106);

    expect(s.gross).toBeCloseTo(7, 12);
    expect(s.netRes).toBeCloseTo(6, 12);
    expect(s.netPay).toBeCloseTo(4, 12);
    expect(s.ntgPay).toBeCloseTo(4 / 7, 12);

    // φe media en reservorio (muestras 1..4): (2*0.12 + 1*0.10 + 2*0.30 + 1*0.20) / 6 = 1.14 / 6 = 0.19
    expect(s.phiRes).toBeCloseTo(1.14 / 6, 12);

    // Sw media en pay ponderada por volumen poral h·φ (muestras 2..4):
    // h·φ = [0.1, 0.6, 0.2] -> Σh·φ = 0.9; Σh·φ·Sw = 0.1*0.2 + 0.6*0.5 + 0.2*0.4 = 0.40
    expect(s.swPay).toBeCloseTo(0.4 / 0.9, 12);
    // Identidad exacta: netPay * phiPay * (1 - swPay) = h·φ·Sh
    expect(s.hphiShPay).toBeCloseTo(0.9 - 0.4, 12);
    expect(s.netPay * s.phiPay * (1 - s.swPay)).toBeCloseTo(s.hphiShPay, 12);

    // k geométrica en pay solo para k > 0 (muestras 2 y 3, h = 1 y 2; muestra 4 tiene k = 0 y se excluye):
    // exp((1*ln(10) + 2*ln(40)) / 3)
    expect(s.kGeoPay).toBeCloseTo(Math.exp((Math.log(10) + 2 * Math.log(40)) / 3), 12);
    // kh en pay: 1*10 + 2*40 + 1*0 = 90
    expect(s.khPay).toBeCloseTo(90, 12);
  });

  it('no inventa ceros cuando faltan curvas (sin cutoffs, sin PERM, sin Sw, tramo vacío o sin clasificar)', () => {
    const depth = Float64Array.from([100, 101, 102, 103]);
    const thickness = sampleThickness(depth);
    const phi = Float64Array.from([0.15, 0.2, 0.25, 0.18]);
    const sw = Float64Array.from([0.3, 0.4, 0.25, 0.35]);

    // 1. Pozo sin curvas calculadas: todo NaN, tarjeta vacía.
    const empty = summarizeDepthInterval({ depth, thickness }, 100, 103);
    expect(empty.hasNetRes).toBe(false);
    expect(empty.netRes).toBeNaN();
    expect(empty.netPay).toBeNaN();
    expect(empty.phiRes).toBeNaN();
    expect(empty.grossMetrics.phi).toBeNaN();
    expect(measureCardItems(empty).items).toEqual([]);

    // 2. Pozo sin cutoffs pero con PHIE y SW: expone promedios brutos del tramo sin inventar Res./Pay.
    const noCutoffs = summarizeDepthInterval({ depth, thickness, phi, sw }, 100, 103);
    expect(noCutoffs.hasNetRes).toBe(false);
    expect(noCutoffs.netRes).toBeNaN();
    expect(noCutoffs.netPay).toBeNaN();
    expect(noCutoffs.grossMetrics.phi).toBeGreaterThan(0.15);
    expect(noCutoffs.grossMetrics.sw).toBeGreaterThan(0.25);
    expect(noCutoffs.grossMetrics.kGeo).toBeNaN();
    const cardNoCutoffs = measureCardItems(noCutoffs);
    expect(cardNoCutoffs.note).toMatch(/Sin cutoffs/);
    expect(cardNoCutoffs.items.map((it) => it.label)).toEqual(['φe', 'Sw', 'h·φ·Sh']);

    // 3. Con cutoffs pero sin PERM: omite k geom. y k·h sin inventar 0.
    const netRes = Float64Array.from([1, 1, 1, 1]);
    const netPay = Float64Array.from([1, 1, 0, 0]);
    const noPerm = summarizeDepthInterval({ depth, thickness, netRes, netPay, phi, sw }, 100, 103);
    expect(noPerm.hasNetPay).toBe(true);
    expect(noPerm.kGeoPay).toBeNaN();
    expect(noPerm.khPay).toBeNaN();
    expect(measureCardItems(noPerm).items.map((it) => it.label)).not.toContain('k geom.');
    expect(measureCardItems(noPerm).items.map((it) => it.label)).not.toContain('k·h');

    // 4. Reservorio sin dato de Sw (netPay todo NaN): pay es NaN (no 0).
    const noSw = summarizeDepthInterval(
      { depth, thickness, netRes, netPay: Float64Array.from([NaN, NaN, NaN, NaN]), phi, sw: Float64Array.from([NaN, NaN, NaN, NaN]) },
      100,
      103,
    );
    expect(noSw.hasNetRes).toBe(true);
    expect(noSw.hasNetPay).toBe(false);
    expect(noSw.netPay).toBeNaN();
    expect(noSw.hphiShPay).toBeNaN();
    expect(measureCardItems(noSw).note).toMatch(/Sin dato de pay/);

    // 5. Tramo completamente sin clasificar (netRes todo NaN): no inventa Res. = 0 ni Pay = 0 y distingue «sin clasificar» de «sin cutoffs».
    const unclassified = summarizeDepthInterval(
      { depth, thickness, netRes: Float64Array.from([NaN, NaN, NaN, NaN]), netPay, phi, sw },
      100,
      103,
    );
    expect(unclassified.hasNetRes).toBe(false);
    expect(unclassified.netRes).toBeNaN();
    expect(unclassified.netPay).toBeNaN();
    expect(measureCardItems(unclassified).note).toMatch(/sin clasificar/i);
    expect(measurementSheetText(measureInterval(100, 103), unclassified)).toContain('tramo sin clasificar');

    // 6. Tramo degenerado (top === base) o sin muestras dentro.
    expect(depthIndexRange(depth, 101, 101)).toEqual({ start: 0, end: 0 });
    expect(summarizeDepthInterval({ depth, thickness, netRes, netPay, phi, sw }, 101.2, 101.8).sampleCount).toBe(0);
  });

  it('rechaza curvas de distinto largo a depth y trata ±Infinity y thickness no finito como sin dato', () => {
    const depth = Float64Array.from([100, 101, 102, 103, 104, 105]);
    const shortRes = Float64Array.from([1, 1, 1]);
    const longRes = Float64Array.from([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(summarizeDepthInterval({ depth, netRes: shortRes }, 100, 102).hasNetRes).toBe(false);
    expect(summarizeDepthInterval({ depth, netRes: longRes }, 100, 105).hasNetRes).toBe(false);

    const d3 = Float64Array.from([100, 101, 102]);
    const sInf = summarizeDepthInterval(
      {
        depth: d3,
        thickness: Float64Array.from([1, 1, 1]),
        netRes: Float64Array.from([1, 1, 1]),
        netPay: Float64Array.from([1, 1, 1]),
        phi: Float64Array.from([0.2, Infinity, 0.2]),
        sw: Float64Array.from([0.3, 0.3, 0.3]),
        vsh: Float64Array.from([0.1, Infinity, 0.1]),
        perm: Float64Array.from([10, Infinity, 40]),
      },
      100,
      102,
    );
    expect(sInf.phiRes).toBeCloseTo(0.2, 12);
    expect(sInf.phiPay).toBeCloseTo(0.2, 12);
    expect(sInf.swPay).toBeCloseTo(0.3, 12);
    expect(sInf.vshRes).toBeCloseTo(0.1, 12);
    expect(sInf.kPay).toBeCloseTo(25, 12);
    expect(sInf.kGeoPay).toBeCloseTo(20, 12);
    expect(sInf.khPay).toBeCloseTo(50, 12);
    expect(sInf.hphiPay).toBeCloseTo(0.4, 12);
    expect(sInf.hphiShPay).toBeCloseTo(0.28, 12);

    const sBadH = summarizeDepthInterval(
      {
        depth: d3,
        thickness: Float64Array.from([1, NaN, 1]),
        netRes: Float64Array.from([Infinity, 1, 1]),
        netPay: Float64Array.from([1, 1, 1]),
        phi: Float64Array.from([0.2, 0.2, 0.2]),
        sw: Float64Array.from([0.3, 0.3, 0.3]),
      },
      100,
      102,
    );
    expect(sBadH.gross).toBeCloseTo(2, 12);
    expect(sBadH.noData).toBeCloseTo(1, 12);
    expect(sBadH.hasNetRes).toBe(true);
    expect(sBadH.netRes).toBeCloseTo(1, 12);
    expect(sBadH.netPay).toBeCloseTo(1, 12);
  });

  it('mantiene fluidez durante el arrastre: 100 resúmenes consecutivos sobre el pozo del TP en < 80 ms', () => {
    const z = tp.zones[0]!;
    // Calentar JIT
    for (let k = 0; k < 5; k++) summarizeDepthInterval(tp.input, z.top, z.base);
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) {
      summarizeDepthInterval(tp.input, tp.well.depth.values[0]!, tp.well.depth.values[tp.well.depth.values.length - 1 - k]!);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(80);
  });
});

describe('G01 — Ficha TSV, notas en el intervalo y superposición en canvas', () => {
  const tp = runTpEngine();

  it('genera TSV legible de dos columnas con las métricas disponibles y texto acotado para notas', () => {
    // Elegir una zona con pay positivo en el pozo del TP.
    const payZone = tp.zones.find((z) => {
      const s = summarizeDepthInterval(tp.input, z.top, z.base);
      return s.hasNetPay && s.netPay > 0;
    })!;
    expect(payZone).toBeDefined();

    const m = measureInterval(payZone.top, payZone.base);
    const summary = summarizeDepthInterval(tp.input, m.top, m.base);
    const tsv = measurementSheetText(m, summary);
    const lines = tsv.split('\n');
    expect(lines.every((line) => line.split('\t').length === 2)).toBe(true);
    expect(tsv).toContain('Tope MD\t');
    expect(tsv).toContain('Base MD\t');
    expect(tsv).toContain('Espesor MD\t');
    expect(tsv).toContain('Reservorio neto (NET_RES)\t');
    expect(tsv).toContain('Pay neto (NET_PAY)\t');
    expect(tsv).toContain('NTG pay\t');
    expect(tsv).toContain('φe media en reservorio\t');
    expect(tsv).toContain('Sw media en pay (pond. φ·h)\t');
    expect(tsv).toContain('h·φ·Sh en pay\t');
    expect(tsv).not.toContain('NaN');
    expect(tsv).not.toContain('undefined');

    // Sin curvas calculadas: solo geometría (tope, base, espesor).
    const plainTsv = measurementSheetText(m, null);
    expect(plainTsv.split('\n')).toHaveLength(3);
    expect(plainTsv).not.toContain('Pay');

    // Nota prellenada y acotada al rango del pozo (incluso si el arrastre se pasó de los extremos).
    const noteText = measurementNoteText(m, summary);
    expect(noteText.length).toBeGreaterThan(0);
    expect(noteText.length).toBeLessThanOrEqual(NOTE_MAX_LENGTH);
    expect(noteText).toContain('Pay');

    const overflow = measureInterval(tp.well.depth.values[0]! - 5, tp.well.depth.values[tp.well.depth.values.length - 1]! + 5);
    const clamped = clampMeasurementForNote(overflow, tp.well.depth.values)!;
    const project = addWell(createProject('G01'), tp.well, tp.zones);
    const saved = saveNote(project, tp.well.id, { id: 'nota-1', text: noteText, top: clamped.top, base: clamped.base });
    expect(getWellEntry(saved, tp.well.id).interpretation.notes).toHaveLength(1);
  });

  it('dibuja tarjeta compacta en claro/oscuro, actualiza en vivo al cambiar curvas y no muta el proyecto', () => {
    const payZone = tp.zones.find((z) => {
      const s = summarizeDepthInterval(tp.input, z.top, z.base);
      return s.hasNetPay && s.netPay > 0;
    })!;
    let currentInput: DepthIntervalInput | null = tp.input;
    let commitCalls = 0;
    let announced = '';
    const tool = createMeasureTool({
      tvdss: () => null,
      intervalInput: () => currentInput,
      measured: (text) => { announced = text; },
    });
    expect(tool.overlay.order).toBeGreaterThan(createNotesOverlay().order ?? 0);

    const mkFrame = (themeName: 'light' | 'dark') => {
      const canvas = fakeCanvas();
      const frame: OverlayFrame = {
        ctx: canvas.ctx,
        theme: THEMES[themeName],
        viewport: {
          top: payZone.top - 10,
          base: payZone.base + 10,
          height: 600,
          pxPerM: 600 / (payZone.base - payZone.top + 20),
          yOf: (d) => ((d - (payZone.top - 10)) * 600) / (payZone.base - payZone.top + 20),
          depthOf: (y) => payZone.top - 10 + (y * (payZone.base - payZone.top + 20)) / 600,
        },
        tracks: [
          { id: 'depth', kind: 'depth', title: 'Prof.', x: 0, width: 64, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
          { id: 'corr', kind: 'curves', title: 'Correlación', x: 64, width: 220, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
          { id: 'res', kind: 'curves', title: 'Resistividad', x: 284, width: 220, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
        ],
        data: {
          wellId: tp.well.id,
          depth: tp.well.depth.values,
          zones: [],
          selectedZoneId: null,
          qc: null,
          well: tp.well,
          interpretation: tp.interpretation,
          computed: tp.computed,
          commit: () => { commitCalls++; },
        },
        invalidate: () => {},
      };
      return { canvas, frame };
    };

    tool.arm();
    const light = mkFrame('light');
    const hit = tool.overlay.hit!(light.frame, { x: 100, y: 100, depth: payZone.top, track: null });
    expect(hit?.drag).toBeDefined();
    hit!.drag!.move({ x: 100, y: 400, depth: payZone.base, track: null }, { x: 100, y: 100, depth: payZone.top, track: null });
    hit!.drag!.end({ x: 100, y: 400, depth: payZone.base, track: null }, { x: 100, y: 100, depth: payZone.top, track: null });

    expect(tool.armed).toBe(false);
    expect(tool.measurement).not.toBeNull();
    expect(tool.summary?.hasNetPay).toBe(true);
    expect(announced).toContain(measureLabel(tool.measurement!));
    expect(commitCalls).toBe(0);

    // Dibujo en tema claro y oscuro con tarjeta completa.
    tool.overlay.draw(light.frame);
    expect(light.canvas.texts).toContain(measureLabel(tool.measurement!));
    expect(light.canvas.texts).toContain('Res.');
    expect(light.canvas.texts).toContain('Pay');
    expect(light.canvas.texts).toContain('φe (res.)');
    expect(light.canvas.texts).toContain('Sw (pay)');
    expect(light.canvas.texts).toContain('h·φ·Sh');

    const dark = mkFrame('dark');
    tool.overlay.draw(dark.frame);
    expect(dark.canvas.texts).toContain('Pay');

    // En diseño clásico (Correlación | Prof. | Resistividad), la tarjeta ancla a la derecha de Prof. sin cruzarla.
    const classicCanvas = fakeCanvas();
    tool.overlay.draw({
      ...light.frame,
      ctx: classicCanvas.ctx,
      tracks: [
        { id: 'corr', kind: 'curves', title: 'Correlación', x: 0, width: 110, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
        { id: 'depth', kind: 'depth', title: 'Prof.', x: 110, width: 64, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
        { id: 'res', kind: 'curves', title: 'Resistividad', x: 174, width: 220, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
        { id: 'den', kind: 'curves', title: 'Densidad', x: 394, width: 220, curves: [], scale: null, hasRole: () => false, xOf: () => null, valueOf: () => null },
      ],
    });
    expect(classicCanvas.boxes.length).toBeGreaterThan(0);
    expect(classicCanvas.boxes[0]!.x).toBeGreaterThanOrEqual(174);

    // Al cambiar las curvas activas (p. ej. sin cutoffs), la medida fija se recalcula en vivo sin re-arrastrar.
    currentInput = { depth: tp.well.depth.values, thickness: tp.input.thickness };
    const noCurveFrame = mkFrame('light');
    tool.overlay.draw(noCurveFrame.frame);
    expect(noCurveFrame.canvas.texts).toEqual([measureLabel(tool.measurement!)]);

    expect(tool.clear()).toBe(true);
    expect(tool.measurement).toBeNull();
    expect(tool.summary).toBeNull();
    expect(commitCalls).toBe(0);
  });
});
