/** Prepara una copia del pozo con los parámetros de referencia comprobados por Vitest. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

export async function makeReplicaSeed(dir) {
  const vite = await createServer({
    configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
  });
  try {
    const { well, zones, interpretation, zoneId } = await vite.ssrLoadModule('/tests/fixtures/tp-replica.ts');
    const { addWell, createProject } = await vite.ssrLoadModule('/src/core/state/project.ts');
    const { serializeProject } = await vite.ssrLoadModule('/src/core/state/serialize.ts');
    const project = addWell(createProject(), well, zones);
    const entry = project.wells[0];
    const configured = {
      ...project,
      name: 'Réplica TP FIUBALog',
      wells: [{
        ...entry,
        interpretation: {
          ...interpretation,
          params: {
            ...interpretation.params,
            global: { ...interpretation.params.global, 'flow-capacity.filter': 'netPay' },
            zones: {
              ...interpretation.params.zones,
              // Área, fluido y Bo ilustrativos, fijos para comparar los escenarios.
              [zoneId('B')]: { ...interpretation.params.zones[zoneId('B')], area: 1, fluid: 'oil', bo: 1.2 },
            },
          },
        },
      }],
    };
    const file = join(dir, 'referencia-tp.pozo.json');
    await writeFile(file, await serializeProject(configured));
    return file;
  } finally {
    await vite.close();
  }
}

/** Lee nuevamente los archivos descargados y coteja Excel con la cadena activa de cálculo. */
export async function verifyReplicaExport(projectFile, excelFile) {
  const vite = await createServer({
    configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
  });
  try {
    const { deserializeProject } = await vite.ssrLoadModule('/src/core/state/serialize.ts');
    const { registry } = await vite.ssrLoadModule('/src/modules/index.ts');
    const { Engine, toEngineWell } = await vite.ssrLoadModule('/src/core/engine/engine.ts');
    const { parseTable } = await vite.ssrLoadModule('/src/io/index.ts');
    const project = await deserializeProject(await readFile(projectFile, 'utf8'));
    const { well, interpretation } = project.wells[0];
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(toEngineWell(well));
    const result = engine.run(interpretation);
    const output = (port) => {
      const record = result.outputs.find((item) => item.port === port && item.active);
      assert.ok(record, `Falta la salida activa ${port}`);
      return record.value;
    };
    const row = well.depth.values.findIndex((value) => Math.abs(value - 7724.5464) < 1e-6);
    const near = (value, reference, tolerance) => {
      assert.ok(Math.abs(value - reference) < tolerance, `Esperaba ${reference} ± ${tolerance}. Recibí ${value}`);
    };
    assert.deepEqual(result.sources.PERM, { kind: 'module', moduleId: 'perm-core' });
    near(output('PERM')[row], 16.169330448, 1e-6);
    near(output('PHIE')[row], 0.205168148, 1e-9);
    near(output('SW')[row], 0.255091027, 1e-9);
    near(Math.sqrt(output('PERM')[row] / (100 * output('PHIE')[row])), 0.8877507525, 1e-9);
    const a8 = well.depth.values.findIndex((value) => Math.abs(value - 7633.2588) < 1e-6);
    near(output('PHIE')[a8], 0.191435715, 1e-9);
    assert.equal(output('SW')[a8], 1);
    for (const port of ['NET_SAND', 'NET_RES', 'NET_PAY']) assert.equal(output(port)[row], 1);
    for (const [id, key] of [['swi-pc', 'k'], ['zone-summary', 'k'], ['flow-capacity', 'k']]) {
      assert.deepEqual(result.nodes.find((node) => node.moduleId === id)?.inputs?.[key], result.sources.PERM);
    }

    const bytes = await readFile(excelFile);
    const curves = parseTable(bytes, excelFile, { sheet: 'Curvas' });
    const excelDepth = curves.columns[curves.depthColumn].numbers;
    const index = excelDepth.findIndex((value) => Math.abs(value - 7724.5464) < 1e-6);
    assert.ok(index >= 0, 'Falta la muestra B608 en la hoja Curvas');
    for (const port of ['PERM', 'PHIE', 'SW', 'SWI']) {
      const values = curves.columns.find((column) => column.name === port)?.numbers;
      near(values?.[index], output(port)[row], 1e-8);
    }
    const summary = parseTable(bytes, excelFile, { sheet: 'Sumario', requireDepth: false });
    const headers = summary.columns.map((column) => column.name);
    assert.ok(headers.some((h) => /^k pay/i.test(h)));
    assert.ok(headers.some((h) => /^kh pay/i.test(h)));
    const zoneSummary = output('ZONE_SUMMARY').rows.find((zone) => zone.zone === 'B');
    const flow = output('FLOW_SUMMARY').rows.find((zone) => zone.zone === 'B');
    near(zoneSummary.khPay, flow.kH, 1e-8);
    const controls = {
      B608: { phie: output('PHIE')[row], sw: output('SW')[row], perm: output('PERM')[row], swi: output('SWI')[row] },
      B: zoneSummary,
      scenarios: project.snapshots.map((snapshot) => {
        const run = engine.run(snapshot.interpretation);
        const rows = (port) => run.outputs.find((item) => item.active && item.port === port).value.rows;
        return {
          name: snapshot.name,
          summary: rows('ZONE_SUMMARY').filter((zone) => zone.zone === 'B' || zone.zone === 'Total'),
          volumes: rows('VOLUMETRICS').filter((zone) => zone.zone === 'B' || zone.zone === 'Total'),
        };
      }),
    };
    assert.equal(controls.scenarios.length, 2);
    assert.ok(controls.scenarios.every((scenario) => scenario.volumes[0].ooipSi > 0));
    assert.notEqual(controls.scenarios[0].volumes[0].ooipSi, controls.scenarios[1].volumes[0].ooipSi);
    await writeFile(join(dirname(excelFile), 'controles.json'), JSON.stringify(controls, null, 2) + '\n');
    return controls;
  } finally {
    await vite.close();
  }
}
