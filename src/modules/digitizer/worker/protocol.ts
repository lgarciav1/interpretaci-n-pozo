/**
 * Protocolo del Web Worker del Log Digitizer (docs/decisiones/0063). PURO: sin DOM ni React. Lo usan el worker
 * (`digitizer.worker.ts`) y, sin worker (Vitest o navegadores sin `Worker`), el cliente en el hilo principal: el MISMO
 * servicio atiende los pedidos en ambos casos.
 *
 * El servicio guarda imágenes por clave (`put-image`) para no reenviarlas en cada pedido: la imagen original y la
 * corregida pueden ocupar cientos de MB. Los pedidos largos informan progreso; la cancelación se hace en el cliente
 * terminando el worker (el trabajo es síncrono: un mensaje de cancelación no se leería hasta el final).
 */
import {
  applyGeometry,
  buildMask,
  digitizeCurve,
  DigitizerError,
  suggestCurveColors,
  type ColorSuggestions,
  type CurveColorSpec,
  type DepthCalibration,
  type DigitizeCurveResult,
  type DigitizerCurveSpec,
  type GeometryStep,
  type Homography,
  type RasterImage,
  type Region,
  type TraceMask,
} from '../../../digitizer';

export type DigitizerTask =
  | { kind: 'put-image'; key: string; image: RasterImage }
  | { kind: 'drop-image'; key: string }
  | { kind: 'geometry'; key: string; steps: GeometryStep[]; outKey: string }
  | { kind: 'digitize'; key: string; depth: DepthCalibration; spec: DigitizerCurveSpec }
  | { kind: 'suggest'; key: string; region?: Region }
  | { kind: 'mask'; key: string; region: Region; color: CurveColorSpec };

export interface GeometryOutput {
  image: RasterImage;
  forward: Homography;
}

export type DigitizerTaskResult =
  | { kind: 'put-image' }
  | { kind: 'drop-image' }
  | { kind: 'geometry'; output: GeometryOutput }
  | { kind: 'digitize'; output: DigitizeCurveResult }
  | { kind: 'suggest'; output: ColorSuggestions }
  | { kind: 'mask'; output: TraceMask };

export interface DigitizerRequest {
  id: number;
  task: DigitizerTask;
}

export type DigitizerResponse =
  | { id: number; type: 'progress'; value: number }
  | { id: number; type: 'done'; result: DigitizerTaskResult }
  | { id: number; type: 'error'; message: string; code?: string };

/** Buffers que se pueden transferir (no copiar) al devolver un resultado. */
export function transferables(result: DigitizerTaskResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (a: { buffer: ArrayBufferLike }) => {
    if (a.buffer instanceof ArrayBuffer && !out.includes(a.buffer)) out.push(a.buffer);
  };
  if (result.kind === 'geometry') add(result.output.image.data);
  if (result.kind === 'mask') add(result.output.data);
  if (result.kind === 'digitize') {
    const { trace, series } = result.output;
    for (const a of [trace.x, trace.width, trace.confidence, trace.observed, series.depthM, series.values, series.confidence]) add(a);
  }
  return out;
}

export interface DigitizerService {
  run(task: DigitizerTask, onProgress?: (f: number) => void): DigitizerTaskResult;
  has(key: string): boolean;
}

/**
 * Servicio con estado (imágenes por clave). `copyOutputs`: el resultado de la geometría se guarda en el servicio Y se
 * devuelve; en el worker se devuelve una COPIA (el original se transfiere al hilo principal y dejaría de existir acá).
 */
export function createDigitizerService(opts: { copyOutputs?: boolean } = {}): DigitizerService {
  const images = new Map<string, RasterImage>();
  const get = (key: string): RasterImage => {
    const img = images.get(key);
    if (!img) throw new DigitizerError('invalid-image', `No hay una imagen cargada con la clave '${key}'.`);
    return img;
  };
  const progressOpts = (onProgress?: (f: number) => void) => (onProgress ? { onProgress } : {});
  return {
    has: (key) => images.has(key),
    run(task, onProgress) {
      switch (task.kind) {
        case 'put-image':
          images.set(task.key, task.image);
          return { kind: 'put-image' };
        case 'drop-image':
          images.delete(task.key);
          return { kind: 'drop-image' };
        case 'geometry': {
          const r = applyGeometry(get(task.key), task.steps, progressOpts(onProgress));
          images.set(task.outKey, r.image);
          const image = opts.copyOutputs ? { width: r.image.width, height: r.image.height, data: new Uint8ClampedArray(r.image.data) } : r.image;
          return { kind: 'geometry', output: { image, forward: r.forward } };
        }
        case 'digitize':
          return { kind: 'digitize', output: digitizeCurve(get(task.key), task.depth, task.spec, progressOpts(onProgress)) };
        case 'suggest':
          return { kind: 'suggest', output: suggestCurveColors(get(task.key), task.region) };
        case 'mask':
          return { kind: 'mask', output: buildMask(get(task.key), task.region, task.color, progressOpts(onProgress)) };
        default:
          throw new DigitizerError('invalid-options', 'Pedido desconocido para el digitalizador.');
      }
    },
  };
}

/**
 * Atiende un pedido del protocolo y emite las respuestas por `post` (progreso limitado a ~50 mensajes por pedido).
 * Lo usa el worker; el cliente sin worker llama al servicio directamente.
 */
export function serveRequest(service: DigitizerService, req: DigitizerRequest, post: (r: DigitizerResponse, transfer?: ArrayBuffer[]) => void): void {
  let last = -1;
  const onProgress = (f: number) => {
    const v = Math.round(f * 50) / 50;
    if (v === last) return;
    last = v;
    post({ id: req.id, type: 'progress', value: v });
  };
  try {
    const result = service.run(req.task, onProgress);
    post({ id: req.id, type: 'done', result }, transferables(result));
  } catch (err) {
    post({
      id: req.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof DigitizerError ? { code: err.code } : {}),
    });
  }
}
