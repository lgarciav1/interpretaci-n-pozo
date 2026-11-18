/** Genera los archivos del caso conocido con el mismo fixture de integración. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';

export async function makeHeightSeed(dir) {
  const vite = await createServer({
    configFile: false, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
  });
  try {
    const fixture = await vite.ssrLoadModule('/tests/fixtures/saturation-height.ts');
    const { p: project, scenario } = fixture.saturationHeightFixture();
    const { serializeProject } = await vite.ssrLoadModule('/src/core/state/serialize.ts');
    const { computeOnce, toEngineWell } = await vite.ssrLoadModule('/src/core/engine/engine.ts');
    const { registry } = await vite.ssrLoadModule('/src/modules/index.ts');
    const entry = project.wells[0];
    const output = computeOnce(registry, toEngineWell(entry.well), entry.interpretation);
    const rockType = output.outputs.find(o => o.active && o.port === 'ROCK_TYPE').value[0];
    const wellFile = join(dir, 'sintetico-f21.pozo.json');
    const labFile = join(dir, 'curva-sintetica-f21.json');
    await writeFile(wellFile, await serializeProject(project));
    await writeFile(labFile, JSON.stringify(fixture.saturationHeightLab));
    return { wellFile, labFile, scenario, rockType };
  } finally {
    await vite.close();
  }
}
