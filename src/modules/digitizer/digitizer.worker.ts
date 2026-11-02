/// <reference lib="webworker" />
/**
 * Web Worker del Log Digitizer (docs/decisiones/0063): geometría, máscaras, colores sugeridos y trazado. Se incrusta
 * en el HTML único con `?worker&inline` (ver `worker/instance.ts`). No importa React ni la interfaz.
 */
import { createDigitizerService, serveRequest, type DigitizerRequest } from './worker/protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const service = createDigitizerService({ copyOutputs: true });
scope.onmessage = (event: MessageEvent<DigitizerRequest>) => {
  serveRequest(service, event.data, (r, transfer) => scope.postMessage(r, transfer ?? []));
};
