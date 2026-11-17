/// <reference lib="webworker" />
import { runProjectFileTask, type ProjectFileTask, type ProjectFileResponse } from './task';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let busy = false;
scope.onmessage = async (event: MessageEvent<ProjectFileTask>) => {
  if (busy) { scope.postMessage({ ok: false, error: 'Ya se está procesando un archivo.', infra: true } satisfies ProjectFileResponse); return; }
  busy = true;
  try { scope.postMessage({ ok: true, result: await runProjectFileTask(event.data) } satisfies ProjectFileResponse); }
  catch (err) { scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ProjectFileResponse); }
  finally { busy = false; }
};
