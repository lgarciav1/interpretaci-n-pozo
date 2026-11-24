/** Lupa del visor (F17, docs/decisiones/0085): geometría pura y armado del cuadro sobre el renderer del visor. */
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { defaultRoleCatalog } from '../../src/core/roles';
import { pxPerMeterForScale } from '../../src/io/export/figures/sizing';
import { THEMES } from '../../src/ui/tokens';
import type { TrackBox } from '../../src/viewer/layout';
import { layoutTracks } from '../../src/viewer/layout';
import { DEFAULT_LOUPE_SCALE, LOUPE_GAP, LOUPE_HEIGHT, loupeColumns, loupeMark, loupeSize, loupeSpan, loupeStart, loupeViewport, placeLoupe, setLoupeViewport, stepLoupeScale } from '../../src/viewer/loupe';
import { LoupePainter } from '../../src/viewer/loupeView';
import type { FrameInput } from '../../src/viewer/render';
import { resolveTracks } from '../../src/viewer/resolve';
import { BUILTIN_LAYOUTS } from '../../src/viewer/templates';
import { baseOf, depthOf, fitAll, viewportLimits, yOf } from '../../src/viewer/viewport';

describe('viewport de la lupa', () => {
  it('1:200 a 96 ppp: un metro mide 5 mm en pantalla y la profundidad del puntero queda en el centro', () => {
    expect(DEFAULT_LOUPE_SCALE).toBe(200);
    const vp = loupeViewport(8000, 200, 300);
    expect(vp.pxPerM).toBeCloseTo(pxPerMeterForScale(200), 12);
    expect((vp.pxPerM * 25.4) / 96).toBeCloseTo(5, 9); // mm por metro
    expect(vp.pxPerM).toBeCloseTo(18.8976378, 6);
    expect(depthOf(vp, 150)).toBeCloseTo(8000, 9);
    expect(yOf(vp, 8000)).toBeCloseTo(150, 9);
    // Tramo mostrado: 300 px / 18,9 px/m = 15,875 m, mitad arriba y mitad abajo.
    expect(baseOf(vp) - vp.top).toBeCloseTo(15.875, 9);
    expect(vp.top).toBeCloseTo(8000 - 7.9375, 9);
    expect(loupeSpan(200, 300)).toBeCloseTo(15.875, 9);
    expect(loupeSpan(500, 300)).toBeCloseTo(39.6875, 9);
  });

  it('setLoupeViewport escribe en el mismo objeto (sin asignar por cuadro) con los mismos valores', () => {
    const out = { top: 0, pxPerM: 1, height: 1 };
    const same = setLoupeViewport(out, 7700.5, 200, 280);
    expect(same).toBe(out);
    expect(out).toEqual(loupeViewport(7700.5, 200, 280));
  });

  it('la rueda recorre los aumentos y se detiene en los extremos', () => {
    expect(stepLoupeScale(200, 1)).toBe(100);
    expect(stepLoupeScale(200, -1)).toBe(500);
    expect(stepLoupeScale(50, 1)).toBe(50);
    expect(stepLoupeScale(1000, -1)).toBe(1000);
    expect(stepLoupeScale(300, 1)).toBe(200); // fuera de la lista: al vecino
  });
});

describe('tamaño y posición del recuadro', () => {
  it('~40 % del ancho visible, con topes, y alto fijo que nunca supera el visor', () => {
    expect(loupeSize(1000, 700)).toEqual({ width: 400, height: LOUPE_HEIGHT });
    expect(loupeSize(400, 700).width).toBe(240); // mínimo legible
    expect(loupeSize(3000, 700).width).toBe(640); // máximo
    expect(loupeSize(200, 700).width).toBe(184); // visor angosto: lo que entra con margen
    expect(loupeSize(1000, 200).height).toBe(184);
    expect(loupeSize(1000, 700, 1.25)).toEqual({ width: 400, height: 400 });
    expect(loupeSize(400, 700, 1.25).width).toBe(300); // el mínimo crece con el tamaño de interfaz
  });

  const area = { left: 0, top: 0, width: 1000, height: 600 };
  const size = { width: 400, height: 320 };

  it('a la derecha del puntero y centrado en su altura', () => {
    expect(placeLoupe({ x: 100, y: 300 }, size, area)).toEqual({ x: 100 + LOUPE_GAP, y: 140, side: 'right' });
  });

  it('a la izquierda si a la derecha no entra; acotado arriba y abajo', () => {
    expect(placeLoupe({ x: 900, y: 300 }, size, area)).toEqual({ x: 900 - LOUPE_GAP - 400, y: 140, side: 'left' });
    expect(placeLoupe({ x: 100, y: 5 }, size, area).y).toBe(8);
    expect(placeLoupe({ x: 100, y: 595 }, size, area).y).toBe(600 - 8 - 320);
  });

  it('nunca se sale del área visible, tampoco con el visor desplazado en horizontal', () => {
    for (const left of [0, 350]) {
      const a = { ...area, left, width: 500 };
      for (let x = left; x <= left + 500; x += 25) {
        for (const y of [0, 100, 300, 600]) {
          const p = placeLoupe({ x, y }, size, a);
          expect(p.x).toBeGreaterThanOrEqual(left + 8);
          expect(p.x + size.width).toBeLessThanOrEqual(left + 500 - 8);
          expect(p.y).toBeGreaterThanOrEqual(8);
          expect(p.y + size.height).toBeLessThanOrEqual(600 - 8);
        }
      }
    }
  });

  it('si no entra a ningún lado, va al lado con más lugar', () => {
    const narrow = { ...area, width: 500 };
    expect(placeLoupe({ x: 100, y: 300 }, size, narrow)).toMatchObject({ x: 92, side: 'right' });
    expect(placeLoupe({ x: 400, y: 300 }, size, narrow)).toMatchObject({ x: 8, side: 'left' });
  });
});

describe('pistas de la lupa', () => {
  // Profundidad (80 px) y cuatro pistas de 200 px.
  const boxes: TrackBox[] = [
    { x: 0, width: 80 },
    { x: 80, width: 200 },
    { x: 280, width: 200 },
    { x: 480, width: 200 },
    { x: 680, width: 200 },
  ];

  it('la ventana arranca en un borde de pista y contiene entera la pista bajo el puntero', () => {
    // Puntero en la pista 3: el borde más cercano a «puntero − media ventana» es 280, pero así la pista 3 no entra.
    expect(loupeStart(boxes, 0, 500, 320)).toBe(3);
    const c = loupeColumns(boxes, 0, 3, 400);
    expect(c.indices).toEqual([3, 4]);
    expect(c.boxes).toEqual([
      { x: 0, width: 80 },
      { x: 80, width: 200 },
      { x: 280, width: 200 }, // la última queda cortada por el borde del recuadro
    ]);
    expect([c.from, c.to]).toEqual([480, 800]);
  });

  it('cerca del borde izquierdo empieza en la primera pista; el puntero en la profundidad toma la más cercana', () => {
    expect(loupeStart(boxes, 0, 100, 320)).toBe(1);
    expect(loupeStart(boxes, 0, 10, 320)).toBe(1);
    const c = loupeColumns(boxes, 0, 1, 400);
    expect(c.indices).toEqual([1, 2]);
    expect([c.from, c.to]).toEqual([80, 400]);
  });

  it('con todas las pistas dentro del ancho, empieza en la primera', () => {
    expect(loupeStart(boxes, 0, 800, 2000)).toBe(1);
    expect(loupeColumns(boxes, 0, 1, 2080).indices).toEqual([1, 2, 3, 4]);
  });

  it('sin pista de profundidad la ventana usa todo el ancho; sin pistas, solo la profundidad', () => {
    const noDepth = boxes.slice(1).map((b) => ({ x: b.x - 80, width: b.width }));
    // Puntero en la pista 1 [200, 400): la ventana [0, 400) la contiene entera.
    expect(loupeStart(noDepth, -1, 300, 400)).toBe(0);
    expect(loupeStart(noDepth, -1, 500, 400)).toBe(1);
    const c = loupeColumns(noDepth, -1, 1, 400);
    expect(c.boxes).toEqual([{ x: 0, width: 200 }, { x: 200, width: 200 }]);
    expect([c.from, c.to]).toEqual([200, 600]);
    expect(loupeStart([{ x: 0, width: 80 }], 0, 40, 320)).toBe(-1);
    expect(loupeColumns([{ x: 0, width: 80 }], 0, -1, 400)).toMatchObject({ indices: [], boxes: [{ x: 0, width: 80 }] });
  });
});

describe('marca en el visor general', () => {
  const main = { top: 7600, pxPerM: 0.7, height: 600 };

  it('el tramo de la lupa en px del visor', () => {
    const m = loupeMark(main, 8000, 8015.875, 480, 800)!;
    expect(m.x).toBe(480);
    expect(m.width).toBe(320);
    expect(m.y).toBeCloseTo(280, 9);
    expect(m.height).toBeCloseTo(15.875 * 0.7, 9);
  });

  it('nunca menos de 4 px de alto (centrada en el tramo); null fuera de la vista; acotado al alto', () => {
    const thin = loupeMark(main, 8000, 8000.5, 0, 10)!;
    expect(thin.height).toBe(4);
    expect(thin.y + 2).toBeCloseTo(280 + 0.25 * 0.7, 9);
    expect(loupeMark(main, 9000, 9010, 0, 10)).toBeNull();
    const cut = loupeMark(main, 7590, 7610, 0, 10)!;
    expect(cut.y).toBe(0);
    expect(cut.height).toBeCloseTo(7, 9);
  });
});

describe('LoupePainter sobre el renderer del visor', () => {
  const rects: number[][] = [];
  const g = globalThis as { Path2D?: unknown };
  g.Path2D ??= class {
    moveTo() {}
    lineTo() {}
    closePath() {}
    rect() {}
  };
  const ctx = new Proxy({}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'rect' ? (...a: number[]) => rects.push(a) : () => {}),
    set: () => true,
  }) as CanvasRenderingContext2D;
  const { well } = syntheticWell(3000);
  const lim = viewportLimits(well.depth.values, 600, well.depth.step);
  const tracks = resolveTracks(BUILTIN_LAYOUTS.petrophysics, { depth: well.depth.values, curves: well.curves, computed: [], catalog: defaultRoleCatalog });
  const layout = layoutTracks(tracks, 1200);
  const main: FrameInput = { tracks, boxes: layout.boxes, viewport: fitAll(lim, 600), theme: THEMES.light, depth: well.depth.values, width: layout.total, overlays: [], data: {} as never };
  const center = (lim.min + lim.max) / 2;

  it('dibuja con la profundidad a la izquierda y las pistas recortadas dentro del recuadro', () => {
    const p = new LoupePainter();
    const ci = tracks.findIndex((t) => t.kind === 'curves' && t.curves.length > 0);
    const b = layout.boxes[ci]!;
    expect(p.update(main, b.x + b.width / 2, 480)).toBe(true);
    const cols = p.columns!;
    expect(tracks[cols.indices[0]!]).toBeDefined();
    expect(cols.indices).toContain(ci);
    expect(cols.boxes[0]!.x).toBe(0);
    rects.length = 0;
    p.paint(ctx, main, center, 200, 480, 300);
    // Cada recorte de pista cae en las cajas de la lupa (coordenadas del recuadro, no del visor).
    const clips = rects.filter((r) => r[1] === 0 && r[3] === 300);
    expect(clips.length).toBeGreaterThan(0);
    for (const r of clips) expect(cols.boxes.some((bx) => Math.abs(bx.x - r[0]!) < 1e-9)).toBe(true);
    expect(p.viewport.pxPerM).toBeCloseTo(pxPerMeterForScale(200), 12);
    expect(depthOf(p.viewport, 150)).toBeCloseTo(center, 9);
  });

  it('mover el puntero dentro de la misma pista no rearma las columnas ni cambia el viewport de objeto', () => {
    const p = new LoupePainter();
    const ci = tracks.findIndex((t) => t.kind === 'curves' && t.curves.length > 0);
    const b = layout.boxes[ci]!;
    p.update(main, b.x + 2, 480);
    const cols = p.columns;
    const vp = p.viewport;
    for (let k = 0; k < 20; k++) {
      expect(p.update(main, b.x + 2 + k, 480)).toBe(false);
      p.paint(ctx, main, center + k * 0.1524, 200, 480, 300);
    }
    expect(p.columns).toBe(cols);
    expect(p.viewport).toBe(vp);
    // Otras pistas (o un ancho nuevo) sí las rearman.
    expect(p.update(main, b.x + 2, 520)).toBe(true);
  });
});
