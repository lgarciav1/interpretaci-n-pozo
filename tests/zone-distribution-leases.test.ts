/**
 * Distribuciones por zona (docs/decisiones/0066, D4): al agregar una serie, la que ya estaba elegida y se está calculando
 * en el motor de comparación no se cancela (se toma la nueva selección antes de soltar la anterior).
 */
import { describe, expect, it } from 'vitest';
import { IsolatedRunner, type RunnerEngine } from '../src/app/snapshots/runner';
import type { SupervisorEvent } from '../src/core/engine/supervisor';
import type { PreparationPlan } from '../src/core/preparation/plan';
import { swapLeases } from '../src/modules/zone-distribution/leases';
import { curve, interp, well } from './helpers';

/** Motor falso: guarda los pedidos; `cancel` responde como el supervisor (cancelado y libre). */
function fakeEngine() {
  const listeners = new Set<(e: SupervisorEvent) => void>();
  const emit = (e: SupervisorEvent) => listeners.forEach((l) => l(e));
  const stats = { runs: 0, cancels: 0 };
  const engine: RunnerEngine = {
    syncWell() {},
    run() {
      stats.runs++;
    },
    cancel() {
      stats.cancels++;
      emit({ type: 'cancelled' } as SupervisorEvent);
      emit({ type: 'busy', busy: false } as SupervisorEvent);
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { engine, stats };
}

const w = well([curve('GR1', 'GR', [10, 20, 30, 40])]);
const [ia, ib] = [interp({ params: { global: { a: 1 }, zones: {} } }), interp({ params: { global: { a: 2 }, zones: {} } })];
const prep = {} as PreparationPlan;

describe('distribuciones: cambio de series en el motor de comparación', () => {
  it('agregar una serie no cancela la que sigue elegida y está en vuelo (con preparación)', () => {
    const { engine, stats } = fakeEngine();
    const r = new IsolatedRunner(() => engine);
    const acquire = (keys: string[]) => () => keys.map((k) => r.acquire(k, w, k === 'a' ? ia : ib, undefined, prep));
    let held = swapLeases([], acquire(['a']));
    expect(stats.runs).toBe(1); // «a» en vuelo
    held = swapLeases(held, acquire(['a', 'b']));
    expect(stats.cancels).toBe(0);
    expect(r.get('a')?.status).toBe('pending');
    // Quitar «b» tampoco toca «a».
    held = swapLeases(held, acquire(['a']));
    expect(stats.cancels).toBe(0);
    expect(r.get('b')).toBeUndefined();
    held.forEach((release) => release());
  });

  it('control: soltar antes de tomar (como antes) cancela «a» y la deja con error', () => {
    const { engine, stats } = fakeEngine();
    const r = new IsolatedRunner(() => engine);
    const releaseA = r.acquire('a', w, ia, undefined, prep);
    releaseA();
    r.acquire('a', w, ia, undefined, prep);
    expect(stats.cancels).toBe(1);
    expect(r.get('a')?.status).toBe('error');
  });
});
