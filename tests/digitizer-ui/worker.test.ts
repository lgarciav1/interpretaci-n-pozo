/**
 * Protocolo del worker del Log Digitizer (docs/decisiones/0063): servicio con imágenes por clave, respuestas con
 * progreso y buffers transferibles, errores en español, y el cliente con worker (un doble que corre el mismo
 * servicio en otro «hilo» asíncrono) y sin worker (hilo principal).
 */
import { describe, expect, it } from 'vitest';
import { axisFromEdgeValues, buildDepthCalibration, type DigitizerCurveSpec } from '../../src/digitizer';
import { DigitizerClient, isAbort, type DigitizerWorkerPort } from '../../src/modules/digitizer/worker/client';
import { createDigitizerService, serveRequest, transferables, type DigitizerRequest, type DigitizerResponse } from '../../src/modules/digitizer/worker/protocol';
import { FIX, grTruth, smallLog } from './fixture';

const depth = buildDepthCalibration({ unit: 'm', method: 'piecewise', ties: [{ y: 100, depth: FIX.TOP_M + 100 * FIX.DZ }, { y: 800, depth: FIX.TOP_M + 800 * FIX.DZ }] });
const spec: DigitizerCurveSpec = {
  id: 'GR',
  mnemonic: 'GR',
  unit: 'gAPI',
  frame: { leftPx: FIX.LEFT, rightPx: FIX.RIGHT, scale: axisFromEdgeValues(0, 150, 'linear') },
  color: { mode: 'color', rgb: [30, 140, 60] },
  region: { x0: FIX.LEFT + 4, y0: 0, x1: FIX.RIGHT - 3, y1: FIX.H },
  mode: 'auto',
};

/** Doble de worker: el mismo servicio, con mensajes asíncronos y copia estructurada como el navegador. */
class FakeWorker implements DigitizerWorkerPort {
  onmessage: DigitizerWorkerPort['onmessage'] = null;
  onerror: DigitizerWorkerPort['onerror'] = null;
  readonly service = createDigitizerService({ copyOutputs: true });
  readonly received: DigitizerRequest[] = [];
  terminated = false;
  postMessage(data: DigitizerRequest): void {
    const msg = structuredClone(data);
    this.received.push(msg);
    setTimeout(() => {
      if (this.terminated) return;
      serveRequest(this.service, msg, (r: DigitizerResponse) => !this.terminated && this.onmessage?.({ data: r }));
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('servicio y respuestas del protocolo', () => {
  it('put-image + digitize: progreso creciente, resultado con buffers transferibles', () => {
    const { image } = smallLog();
    const svc = createDigitizerService();
    const out: DigitizerResponse[] = [];
    serveRequest(svc, { id: 1, task: { kind: 'put-image', key: 'original', image } }, (r) => out.push(r));
    serveRequest(svc, { id: 2, task: { kind: 'digitize', key: 'original', depth, spec } }, (r) => out.push(r));
    expect(out[0]).toEqual({ id: 1, type: 'done', result: { kind: 'put-image' } });
    const prog = out.filter((r) => r.id === 2 && r.type === 'progress').map((r) => (r as { value: number }).value);
    expect(prog.length).toBeGreaterThan(3);
    expect(prog.length).toBeLessThanOrEqual(51);
    for (let i = 1; i < prog.length; i++) expect(prog[i]!).toBeGreaterThan(prog[i - 1]!);
    const done = out.find((r) => r.id === 2 && r.type === 'done')!;
    if (done.type !== 'done' || done.result.kind !== 'digitize') throw new Error('sin resultado');
    expect(done.result.output.quality.metrics.coverage).toBeGreaterThan(0.95);
    expect(transferables(done.result).length).toBe(7);
  });

  it('errores: imagen desconocida y spec inválida vuelven como mensaje en español con código', () => {
    const svc = createDigitizerService();
    const out: DigitizerResponse[] = [];
    serveRequest(svc, { id: 7, task: { kind: 'suggest', key: 'nada' } }, (r) => out.push(r));
    expect(out[0]).toMatchObject({ id: 7, type: 'error', code: 'invalid-image' });
    expect((out[0] as { message: string }).message).toMatch(/No hay una imagen/);
    svc.run({ kind: 'put-image', key: 'a', image: smallLog().image });
    serveRequest(svc, { id: 8, task: { kind: 'digitize', key: 'a', depth, spec: { ...spec, mode: 'guided' } } }, (r) => out.push(r));
    expect(out[1]).toMatchObject({ id: 8, type: 'error', code: 'invalid-options' });
  });

  it('geometría: guarda la corregida con su clave y devuelve una copia (en el worker)', () => {
    const { image } = smallLog();
    const svc = createDigitizerService({ copyOutputs: true });
    svc.run({ kind: 'put-image', key: 'original', image });
    const r = svc.run({ kind: 'geometry', key: 'original', steps: [{ kind: 'rotate', angleRad: 0.01, expand: true }], outKey: 'corrected' });
    if (r.kind !== 'geometry') throw new Error();
    expect(r.output.image.width).toBeGreaterThan(FIX.W);
    expect(svc.has('corrected')).toBe(true);
    const m = svc.run({ kind: 'mask', key: 'corrected', region: { x0: 50, y0: 0, x1: 300, y1: 100 }, color: { mode: 'color', rgb: [30, 140, 60] } });
    if (m.kind !== 'mask') throw new Error();
    expect(m.output.width).toBe(250);
    expect(m.output.data.some((v) => v > 0)).toBe(true);
  });
});

describe('cliente', () => {
  it('sin worker (Vitest): corre el servicio en el hilo principal y da el mismo resultado', async () => {
    const { image, log } = smallLog();
    const c = new DigitizerClient(() => null);
    c.putImage('original', image);
    const sug = await c.suggest('original', spec.region);
    expect(c.mode).toBe('in-process');
    expect(sug.colors[0]!.kind).toBe('color');
    const r = await c.digitize('original', depth, spec);
    const i = 450 - r.trace.y0;
    expect(Math.abs(r.trace.x[i]! - log.trueX('GR', 450))).toBeLessThan(1.5);
    // serie en unidades físicas: valor a la profundidad de la fila 450
    const d = FIX.TOP_M + 450 * FIX.DZ;
    const k = r.series.depthM.findIndex((z) => Math.abs(z - d) < 1e-6);
    expect(Math.abs(r.series.values[k]! - grTruth(d))).toBeLessThan(1.5);
  });

  it('con worker: envía la imagen UNA vez por clave, informa progreso y obtiene lo mismo', async () => {
    const { image } = smallLog();
    const w = new FakeWorker();
    const c = new DigitizerClient(() => w);
    c.putImage('original', image);
    const progress: number[] = [];
    const a = await c.digitize('original', depth, spec, (f) => progress.push(f));
    const b = await c.digitize('original', depth, spec);
    expect(c.mode).toBe('worker');
    expect(w.received.filter((m) => m.task.kind === 'put-image')).toHaveLength(1);
    expect(progress.length).toBeGreaterThan(3);
    expect(Array.from(b.trace.x)).toEqual(Array.from(a.trace.x));
    const local = await new DigitizerClient(() => null).digitize('original', depth, spec).catch(() => null);
    expect(local).toBeNull(); // otro cliente no tiene la imagen: error claro, no un resultado inventado
  });

  it('cancelar termina el worker, rechaza con AbortError, y el próximo pedido crea otro y reenvía la imagen', async () => {
    const { image } = smallLog();
    const workers: FakeWorker[] = [];
    const c = new DigitizerClient(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    c.putImage('original', image);
    const p = c.digitize('original', depth, spec);
    expect(c.busy).toBe(true);
    c.cancel();
    const err = await p.catch((e) => e);
    expect(isAbort(err)).toBe(true);
    expect(workers[0]!.terminated).toBe(true);
    const r = await c.digitize('original', depth, spec);
    expect(r.quality.metrics.coverage).toBeGreaterThan(0.95);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.received[0]!.task.kind).toBe('put-image');
  });

  it('un error del worker (onerror) rechaza los pendientes y no deja el cliente colgado', async () => {
    const w = new FakeWorker();
    w.postMessage = () => setTimeout(() => w.onerror?.({ message: 'falló' }), 0);
    const c = new DigitizerClient(() => w);
    c.putImage('original', smallLog().image);
    await expect(c.suggest('original')).rejects.toThrow('falló');
    expect(c.busy).toBe(false);
  });
});
