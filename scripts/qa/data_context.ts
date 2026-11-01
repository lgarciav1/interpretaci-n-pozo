/** Harness independiente: usa el mismo worker incrustado que producción, sin stores ni hooks de prueba. */
import WorkerFactory from '../../src/app/engine.worker?worker&inline';
import { EngineClient, type ClientResult } from '../../src/core/engine/client';
import { resolveDataContext, type PreparedArtifact } from '../../src/core/preparation/projection';
import { emptyInterpretation, type Interpretation } from '../../src/core/interpretation';
import { createWell } from '../../src/core/well';
import { registry } from '../../src/modules';
import { DEFAULT_TOOL_STRING } from '../../src/core/toolString';

const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
async function verify() {
  const worker = new WorkerFactory({ name: 'qa-proyeccion' });
  const client = new EngineClient(worker, () => worker.terminate());
  const well = createWell({ id: 'qa', name: 'QA', depth: Float64Array.of(10, 11, 12), curves: [
    { id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.of(10, 20, 30), origin: { kind: 'measured' } },
    { id: 'CALI', mnemonic: 'CALI', role: 'CALI', unit: 'in', data: Float64Array.of(8, 8, 8), origin: { kind: 'measured' } },
  ] });
  const i: Interpretation = { ...emptyInterpretation(), params: { global: { grClean: 0, grShale: 100 }, zones: {} }, sources: { GR: { kind: 'curve', curveId: 'prep:mask:GR' } } };
  const identity = resolveDataContext(well, i, registry, 'rev');
  const a: PreparedArtifact = { id: 'prep:mask:GR', mnemonic: 'GR preparado', role: 'GR', unit: 'gAPI', inputRevisionId: 'rev', depthKey: identity.context.depthKey,
    recipeKey: 'fixture@1', inputs: ['GR', 'CALI'].map(curveId => ({ curveId, contentVersion: identity.lineage.get(curveId)!.contentVersion })),
    data: Float64Array.of(40, NaN, 60), quality: Uint16Array.of(0, 2, 0) };
  const calculate = (interpretation: Interpretation, artifacts: PreparedArtifact[]) => {
    const data = resolveDataContext(well, interpretation, registry, 'rev', artifacts);
    const promise = new Promise<ClientResult>((resolve, reject) => {
      const timer = window.setTimeout(() => { off(); reject(new Error('Timeout del worker')); }, 20000);
      const off = client.subscribe(e => { if (e.type === 'result' || e.type === 'error') { window.clearTimeout(timer); off(); if (e.type === 'result') resolve(e.result); else reject(new Error(e.message)); } });
    });
    client.syncWell(data.engineWell, data.context); client.run(interpretation, data.context);
    return promise;
  };
  const values = (r: ClientResult) => r.outputs.find(o => o.port === 'IGR')?.value as Float64Array | undefined;
  try {
    let rejectedMixedContext = false;
    try { client.syncWell(resolveDataContext(well, i, registry, 'rev', [a]).engineWell, identity.context); } catch { rejectedMixedContext = true; }
    check(rejectedMixedContext, 'Acepta una preparación bajo el contexto de originales');
    const prepared = await calculate(i, [a]), p = values(prepared);
    check(!!p && Math.abs(p[0]! - .4) < 1e-12 && Number.isNaN(p[1]!) && Math.abs(p[2]! - .6) < 1e-12, 'IGR no usa los datos preparados');
    const hidden = await calculate({ ...i, toolString: { ...DEFAULT_TOOL_STRING, off: ['caliper'] } }, [a]);
    check(!values(hidden) && hidden.diagnostics.some(d => d.code === 'invalid-source'), 'La ascendencia permite un fallback incorrecto');
    const missing = await calculate(i, []);
    check(!values(missing), 'Una preparación ausente usa la curva original');
    const restored = await calculate({ ...i, sources: { GR: { kind: 'curve', curveId: 'GR' } } }, []), r = values(restored);
    check(!!r && Math.abs(r[0]! - .1) < 1e-12 && Math.abs(r[2]! - .3) < 1e-12, 'No recupera la selección original');
    check(well.depth.values.byteLength === 24 && well.curves.every(c => c.data.byteLength === 24) && a.data.byteLength === 24 && a.quality.byteLength === 6, 'Buffers detached');
    return { preparedValues: [p![0], 'NaN', p![2]], inheritedTools: resolveDataContext(well, i, registry, 'rev', [a]).lineage.get(a.id)!.ancestorToolIds,
      rejectedMixedContext, disabledAncestorBlocks: true, missingArtifactBlocks: true, explicitOriginalRecovers: true, originalAndPreparedBuffersIntact: true };
  } finally { client.dispose(); }
}
verify().then(evidence => { document.querySelector('#evidence')!.textContent = JSON.stringify(evidence); document.body.dataset.status = 'passed'; })
  .catch(error => { document.querySelector('#evidence')!.textContent = String(error.stack ?? error); document.body.dataset.status = 'failed'; });
