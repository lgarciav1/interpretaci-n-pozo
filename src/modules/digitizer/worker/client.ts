/**
 * Cliente del Web Worker del Log Digitizer (docs/decisiones/0063). Sin React.
 *
 * - Con worker: los pedidos se encolan en el worker (uno detrás de otro, en orden); las imágenes se envían una sola
 *   vez por clave (`putImage`) y el cliente recuerda cuáles tiene el worker actual.
 * - Cancelar = terminar el worker (el cálculo es síncrono). Los pedidos pendientes fallan con `AbortError`; el
 *   próximo pedido crea un worker nuevo y le reenvía las imágenes que necesita.
 * - Sin worker (`createWorker` devuelve null o lanza): el mismo servicio corre en el hilo principal (Vitest).
 */
import type { ColorSuggestions, CurveColorSpec, DepthCalibration, DigitizeCurveResult, DigitizerCurveSpec, GeometryStep, RasterImage, Region, TraceMask } from '../../../digitizer';
import { createDigitizerService, type DigitizerRequest, type DigitizerResponse, type DigitizerService, type DigitizerTask, type DigitizerTaskResult, type GeometryOutput } from './protocol';

export interface DigitizerWorkerPort {
  onmessage: ((event: { data: DigitizerResponse }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?(): void }) => void) | null;
  postMessage(data: DigitizerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export class DigitizerAbort extends Error {
  constructor() {
    super('Se canceló la operación.');
    this.name = 'AbortError';
  }
}

export const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

interface Pending {
  resolve(r: DigitizerTaskResult): void;
  reject(e: Error): void;
  onProgress?: ((f: number) => void) | undefined;
}

export class DigitizerClient {
  private worker: DigitizerWorkerPort | null = null;
  private local: DigitizerService | null = null;
  private sent = new Set<string>();
  private readonly images = new Map<string, RasterImage>();
  private readonly pending = new Map<number, Pending>();
  private seq = 0;
  /** 'worker' | 'in-process' | null (todavía sin usar). */
  mode: 'worker' | 'in-process' | null = null;

  constructor(private readonly createWorker: () => DigitizerWorkerPort | null) {}

  private port(): DigitizerWorkerPort | null {
    if (this.worker) return this.worker;
    if (this.local) return null;
    let w: DigitizerWorkerPort | null = null;
    try {
      w = this.createWorker();
    } catch {
      w = null;
    }
    if (!w) {
      this.local = createDigitizerService();
      this.mode = 'in-process';
      return null;
    }
    this.mode = 'worker';
    w.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      if (data.type === 'progress') p.onProgress?.(data.value);
      else {
        this.pending.delete(data.id);
        if (data.type === 'done') p.resolve(data.result);
        else {
          const e = new Error(data.message);
          if (data.code) (e as Error & { code?: string }).code = data.code;
          p.reject(e);
        }
      }
    };
    w.onerror = (event) => {
      event.preventDefault?.();
      this.reset(new Error(event.message || 'El cálculo del digitalizador falló.'));
    };
    this.worker = w;
    this.sent = new Set();
    return w;
  }

  private reset(reason: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.sent = new Set();
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(reason);
  }

  /** Cancela todo lo que esté corriendo o en cola. */
  cancel(): void {
    if (this.worker) this.reset(new DigitizerAbort());
  }

  /** Hay pedidos en curso. */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Registra una imagen (se envía al worker cuando un pedido la necesita). La imagen del llamador no se modifica. */
  putImage(key: string, image: RasterImage): void {
    this.images.set(key, image);
    this.sent.delete(key);
    if (this.local) this.local.run({ kind: 'put-image', key, image });
  }

  dropImage(key: string): void {
    this.images.delete(key);
    if (this.local) this.local.run({ kind: 'drop-image', key });
    else if (this.worker && this.sent.has(key)) this.post({ kind: 'drop-image', key });
    this.sent.delete(key);
  }

  private post(task: DigitizerTask, onProgress?: (f: number) => void): Promise<DigitizerTaskResult> {
    const w = this.worker!;
    const id = ++this.seq;
    return new Promise<DigitizerTaskResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      try {
        w.postMessage({ id, task });
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private async run(task: DigitizerTask & { key: string }, onProgress?: (f: number) => void): Promise<DigitizerTaskResult> {
    const w = this.port();
    if (!w) {
      const local = this.local!;
      if (!local.has(task.key)) {
        const img = this.images.get(task.key);
        if (img) local.run({ kind: 'put-image', key: task.key, image: img });
      }
      // Cede el hilo para que la interfaz pinte el estado «trabajando» antes del cálculo síncrono.
      await Promise.resolve();
      return local.run(task, onProgress);
    }
    if (!this.sent.has(task.key)) {
      const img = this.images.get(task.key);
      if (img) {
        this.sent.add(task.key);
        void this.post({ kind: 'put-image', key: task.key, image: img }).catch(() => {});
      }
    }
    return this.post(task, onProgress);
  }

  /** Aplica la geometría a la imagen `key`; el resultado queda registrado como `outKey`. */
  async geometry(key: string, steps: GeometryStep[], outKey: string, onProgress?: (f: number) => void): Promise<GeometryOutput> {
    const r = await this.run({ kind: 'geometry', key, steps, outKey }, onProgress);
    if (r.kind !== 'geometry') throw new Error('Respuesta inválida del digitalizador.');
    this.images.set(outKey, r.output.image);
    if (this.worker) this.sent.add(outKey);
    return r.output;
  }

  async digitize(key: string, depth: DepthCalibration, spec: DigitizerCurveSpec, onProgress?: (f: number) => void): Promise<DigitizeCurveResult> {
    const r = await this.run({ kind: 'digitize', key, depth, spec }, onProgress);
    if (r.kind !== 'digitize') throw new Error('Respuesta inválida del digitalizador.');
    return r.output;
  }

  async suggest(key: string, region?: Region): Promise<ColorSuggestions> {
    const r = await this.run({ kind: 'suggest', key, ...(region ? { region } : {}) });
    if (r.kind !== 'suggest') throw new Error('Respuesta inválida del digitalizador.');
    return r.output;
  }

  async mask(key: string, region: Region, color: CurveColorSpec, onProgress?: (f: number) => void): Promise<TraceMask> {
    const r = await this.run({ kind: 'mask', key, region, color }, onProgress);
    if (r.kind !== 'mask') throw new Error('Respuesta inválida del digitalizador.');
    return r.output;
  }

  dispose(): void {
    this.reset(new DigitizerAbort());
    this.images.clear();
    this.local = null;
  }
}
