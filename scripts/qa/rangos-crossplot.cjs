/** F11 sobre el HTML de entrega, con el pozo del TP y un segundo pozo. */
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'f11-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    viewport: { width: 1366, height: 768 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = context.pages()[0];
  page.setDefaultTimeout(35000);
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) external.push(request.url());
  });
  const url = process.env.QA_URL || pathToFileURL(resolve('dist/index.html')).href;
  const output = process.env.QA_CAPTURAS || 'docs/capturas/f11';
  const command = async (name) => {
    await page.keyboard.press('Control+k');
    await page.locator('.ui-cmd input[role=combobox]').fill(name);
    await page.locator('.ui-cmd').getByRole('option').filter({ hasText: name }).first().click();
  };
  const save = async (name) => {
    const [download] = await Promise.all([page.waitForEvent('download'), command('Guardar el proyecto')]);
    const path = join(profile, name);
    await download.saveAs(path);
    return { path, project: JSON.parse(readFileSync(path, 'utf8')).project };
  };
  const panel = page.getByTestId('crossplot-panel');
  const input = (axis, limit) => panel.getByRole('textbox', { name: `${limit} del eje ${axis}` });
  const limits = async (axis) => Promise.all(['Mínimo', 'Máximo'].map(async (limit) =>
    Number((await input(axis, limit).inputValue()).replace(',', '.'))));
  const set = async (axis, limit, value, key = 'Enter') => {
    const field = input(axis, limit);
    await field.fill(String(value));
    await field.press(key);
  };
  const scale = (axis, name) => panel.getByLabel(`Escala del eje ${axis}`).getByText(name, { exact: true }).click();
  const curve = (axis, value) => panel.getByRole('combobox', { name: `Curva del eje ${axis}` }).selectOption(value);
  const reset = (axis) => panel.getByRole('button', { name: `Volver a rango automático en ${axis}` });
  const activeWell = (name) => page.locator('.shell-context__well-name').getByText(name, { exact: true }).waitFor();
  const config = (project) => project.display.plots?.[project.activeWellId]?.crossplot;
  let openCount = 0;
  const reopen = async (path) => {
    const name = `reabrir-${++openCount}.pozo.json`;
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), command('Abrir un proyecto guardado')]);
    await chooser.setFiles({ name, mimeType: 'application/json', buffer: readFileSync(path) });
    await page.getByText(name, { exact: true }).waitFor();
  };

  try {
    if (url.startsWith('file:')) await context.setOffline(true);
    await page.goto(url);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Cargar pozo', exact: true }).click();
    await page.getByRole('button', { name: 'Cargar datos del TP' }).press('Enter');
    await page.getByRole('button', { name: /Siguiente: control de calidad/ }).press('Enter');
    await page.getByRole('button', { name: 'Cargar', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Entrar al pozo', exact: true }).click();
    await command('Abrir la pestaña Crossplot');
    await page.getByRole('button', { name: 'Agrandar el panel' }).click();
    await curve('X', 'm:GR');
    await curve('Y', 'm:AT90');
    await scale('X', 'Lin');
    await scale('Y', 'Log');
    const autoY = await limits('Y');

    await set('X', 'Mínimo', '-10,5');
    await set('X', 'Máximo', 180, 'Tab');
    assert.deepEqual(await limits('X'), [-10.5, 180]);
    assert.deepEqual(await limits('Y'), autoY);
    await set('Y', 'Mínimo', '0,1');
    await set('Y', 'Máximo', 100);
    await scale('Y', 'Log');
    assert.deepEqual(await limits('Y'), [0.1, 100]);
    assert.deepEqual(await limits('X'), [-10.5, 180]);

    for (const [axis, limit, value, error] of [
      ['X', 'Mínimo', '', /Escribí un número/],
      ['X', 'Máximo', '1e999', /Escribí un número/],
      ['X', 'Máximo', '-10,5', /no pueden ser iguales/],
      ['X', 'Mínimo', 181, /mayor que el mínimo/],
      ['Y', 'Mínimo', 0, /mínimo tiene que ser mayor que 0/],
      ['Y', 'Máximo', -1, /máximo tiene que ser mayor que 0/],
    ]) {
      await set(axis, limit, value);
      await panel.getByRole('alert').filter({ hasText: error }).waitFor();
      assert.deepEqual(await limits('X'), [-10.5, 180]);
      assert.deepEqual(await limits('Y'), [0.1, 100]);
    }
    await set('Y', 'Máximo', 100);
    await set('X', 'Mínimo', '-10,5');
    await panel.getByRole('alert').waitFor({ state: 'hidden' });

    const count = async () => Number((await page.getByTestId('crossplot-count').innerText()).replace(/\D/g, ''));
    const all = await count();
    await panel.getByRole('group', { name: 'Filtro por zonas' }).getByRole('button', { name: 'D', exact: true }).click();
    const filtered = await count();
    assert.ok(filtered > 0 && filtered < all, `filtro D: ${filtered} de ${all}`);
    await panel.locator('button[title="Agregar un cutoff en X"]').click();
    const guide = panel.getByRole('slider', { name: /GR/ });
    const priorCutoff = await guide.getAttribute('aria-valuenow');
    await guide.press('ArrowRight');
    assert.notEqual(await guide.getAttribute('aria-valuenow'), priorCutoff);
    assert.deepEqual(await limits('X'), [-10.5, 180]);
    assert.deepEqual(await limits('Y'), [0.1, 100]);

    mkdirSync(output, { recursive: true });
    for (const theme of ['claro', 'oscuro']) {
      await command(`Usar el tema ${theme}`);
      await panel.getByText('Ejes', { exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.locator('.ui-toast').last().waitFor({ state: 'hidden' });
      await page.screenshot({ path: join(output, `rangos-crossplot-${theme}.png`) });
    }

    console.log(`TP · límite lineal X y log Y, errores, filtro D: ${filtered} de ${all}, cutoff y capturas`);
    const saved = await save('rangos.pozo.json');
    const first = config(saved.project);
    assert.deepEqual(first.xRange, [-10.5, 180]);
    assert.deepEqual(first.yRange, [0.1, 100]);
    assert.equal(first.zones.length, 1);
    assert.equal(Object.keys(first.cutoffs).length, 1);

    const swap = panel.getByRole('button', { name: 'Intercambiar X e Y' });
    await swap.click();
    assert.deepEqual(await limits('X'), first.yRange);
    assert.deepEqual(await limits('Y'), first.xRange);
    await swap.click();

    await reset('Y').click();
    assert.ok(await reset('Y').isDisabled());
    assert.deepEqual(await limits('X'), first.xRange);
    await reopen(saved.path);
    await reset('X').click();
    assert.ok(await reset('X').isDisabled());
    assert.notDeepEqual(await limits('X'), first.xRange);
    assert.deepEqual(await limits('Y'), first.yRange);
    await curve('Y', 'm:ZDEN');
    assert.ok(await reset('Y').isDisabled());
    await reopen(saved.path);
    assert.deepEqual(await limits('X'), first.xRange);
    assert.deepEqual(await limits('Y'), first.yRange);
    assert.deepEqual(config((await save('reabierto.pozo.json')).project), first);
    await set('X', 'Mínimo', 'inválido');
    await panel.getByRole('alert').waitFor();
    await reopen(saved.path);
    await panel.getByRole('alert').waitFor({ state: 'hidden' });

    await scale('Y', 'Lin');
    assert.ok(await reset('Y').isDisabled());
    assert.deepEqual(await limits('X'), first.xRange);
    await scale('Y', 'Log');
    assert.ok(await reset('Y').isDisabled());
    await set('Y', 'Máximo', 101);
    await curve('X', 'm:ZDEN');
    assert.ok(await reset('X').isDisabled());
    assert.equal((await limits('Y'))[1], 101);
    await reopen(saved.path);

    console.log('Proyecto · intercambio, restablecimiento, cambios de curva y escala, guardado y reapertura');
    const tp = saved.project.wells.find((entry) => entry.well.id === saved.project.activeWellId).well.name;
    const demo = 'Pozo sintético de demostración';
    await command('Cargar el pozo de demostración');
    await activeWell(demo);
    assert.ok(await reset('X').isDisabled());
    assert.ok(await reset('Y').isDisabled());
    const demoX = await limits('X');
    await set('X', 'Mínimo', demoX[0] - 1);
    assert.ok(await reset('X').isEnabled());
    await command(`Cambiar al pozo ${tp}`);
    await activeWell(tp);
    assert.deepEqual(await limits('X'), first.xRange);
    assert.deepEqual(await limits('Y'), first.yRange);
    await command('Ir al pozo de demostración');
    await activeWell(demo);
    assert.equal((await limits('X'))[0], demoX[0] - 1);

    // Formato anterior a F11: mismas claves y versión, rangos opcionales ausentes.
    const legacy = JSON.parse(readFileSync(saved.path, 'utf8'));
    const legacyConfig = config(legacy.project);
    delete legacyConfig.xRange;
    delete legacyConfig.yRange;
    const legacyPath = join(profile, 'sin-rangos.pozo.json');
    writeFileSync(legacyPath, JSON.stringify(legacy));
    await reopen(legacyPath);
    assert.ok(await reset('X').isDisabled());
    assert.ok(await reset('Y').isDisabled());
    assert.equal(await count(), filtered);

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`OK · ${url.startsWith('file:') ? 'file:// sin red' : 'HTTP local sin red tras la carga'} · filtro D: ${filtered} de ${all} puntos`);
  } catch (error) {
    await page.screenshot({ path: '/tmp/f11-fallo.png' }).catch(() => {});
    throw error;
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
