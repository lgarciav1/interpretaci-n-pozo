import { expect, it } from 'vitest';
import { THEMES } from '../src/ui/tokens';
import type { OverlayFrame, OverlayPointer, OverlayTrack, ViewerData } from '../src/viewer/overlay';
import { createGhostTool, type GhostStatus } from '../src/viewer/overlays/ghost';
import type { ResolvedCurve } from '../src/viewer/resolve';

function setup() {
  const depth = Float64Array.of(100, 101, 102, 103, 104, 105, 106, 107);
  const values = Float64Array.of(1, 10, NaN, 10, 100, 0, 20, 30);
  const curve = {
    key: 'm:rt', role: 'RT', name: 'RT', kind: 'line', data: values,
    axis: { kind: 'log', min: 1, max: 100, reversed: true },
    styles: { light: { color: 'red', width: 1 } },
  } as ResolvedCurve;
  const track: OverlayTrack = {
    id: 'res', kind: 'curves', title: 'Resistividad', x: 10, width: 100, curves: [curve], scale: curve.axis,
    hasRole: (role) => role === curve.role, xOf: () => null, valueOf: () => null,
  };
  const calls: Array<[string, number, number]> = [];
  const noop = () => {};
  const ctx = {
    save: noop, restore: noop, beginPath: noop, rect: noop, clip: noop, stroke: noop, arc: noop, fill: noop,
    moveTo(x: number, y: number) { calls.push(['M', x, y]); },
    lineTo(x: number, y: number) { calls.push(['L', x, y]); },
  } as unknown as CanvasRenderingContext2D;
  const frame: OverlayFrame = {
    ctx, theme: THEMES.light, tracks: [track],
    data: { wellId: 'tp', depth, interpretation: { sources: {} } } as ViewerData,
    viewport: { top: 100, base: 110, height: 100, pxPerM: 10, yOf: (d) => (d - 100) * 10, depthOf: (y) => 100 + y / 10 },
    invalidate: noop,
  };
  const states: Array<GhostStatus | null> = [];
  const tool = createGhostTool((state) => states.push(state), noop);
  tool.arm({ wellId: 'tp', trackId: track.id, depth, curve, roleSource: undefined });
  const p = (d: number): OverlayPointer => ({ depth: d, x: 22, y: frame.viewport.yOf(d), track });
  return { frame, depth, curve, track, calls, states, tool, p };
}

it('desplaza solo la MD, respeta escala logarítmica invertida y corta en NaN y cero', () => {
  const { tool, frame, p, states, calls, curve, depth } = setup();
  tool.overlay.hit!(frame, p(105))!.drag!.end(p(99), p(105));
  const target = tool.overlay.targets!(frame)[0]!;
  target.hit.nudge!(1);
  tool.overlay.draw(frame);
  expect(calls.slice(0, 4)).toEqual([['M', 110, 10], ['L', 60, 20], ['M', 60, 40], ['L', 10, 50]]);
  expect(states.at(-1)).toEqual({ name: 'RT', offset: 1 });
  expect([...curve.data]).toEqual([1, 10, NaN, 10, 100, 0, 20, 30]);
  expect([...depth]).toEqual([100, 101, 102, 103, 104, 105, 106, 107]);
});

it('cancela selección y descarta gestos capturados cuando desaparece la serie', () => {
  const { tool, frame, p, states, track } = setup();
  const selection = tool.overlay.hit!(frame, p(100))!.drag!;
  selection.cancel!();
  selection.end(p(104), p(100));
  expect(tool.overlay.targets!(frame)).toEqual([]);
  expect(states.at(-1)).toBeNull();

  tool.arm({ wellId: 'tp', trackId: track.id, depth: frame.data.depth, curve: track.curves[0]!, roleSource: undefined });
  tool.overlay.hit!(frame, p(100))!.drag!.end(p(104), p(100));
  const target = tool.overlay.targets!(frame)[0]!;
  target.hit.drag!.move(p(103), p(102));
  target.hit.drag!.cancel!();
  expect(states.at(-1)?.offset).toBe(0);
  expect(tool.reconcile({ ...frame, tracks: [] })).toBe(true);
  target.hit.nudge!(1);
  expect(states.at(-1)).toBeNull();
});
