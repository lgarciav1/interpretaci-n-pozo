/**
 * Entrada del Web Worker del motor. Es el punto de composición: une el motor genérico (core) con el registro de
 * módulos. No debe importar nada de React ni de la interfaz.
 */
import { serveEngine } from '../core/engine/serve';
import type { Endpoint } from '../core/engine/protocol';
import { registry } from '../modules';

// En desarrollo el motor verifica que ningún módulo escriba en sus entradas (en producción no, por costo).
serveEngine(self as unknown as Endpoint, registry, { checkInputs: import.meta.env.DEV });
