/**
 * Instancia del cliente con el worker incrustado (`?worker&inline`: Vite lo empaqueta aparte y lo mete en base64 en
 * el HTML único; se instancia desde un Blob URL, así funciona por `file://`). Sin `Worker` (Vitest), el cliente corre
 * el mismo servicio en el hilo principal.
 */
import DigitizerWorker from '../digitizer.worker?worker&inline';
import { DigitizerClient, type DigitizerWorkerPort } from './client';

export const digitizerClient = new DigitizerClient(() =>
  typeof Worker === 'undefined' ? null : (new DigitizerWorker({ name: 'log-digitizer' }) as unknown as DigitizerWorkerPort),
);
