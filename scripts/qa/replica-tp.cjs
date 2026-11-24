/** Abre el HTML compilado con Chromium, ejecuta la réplica y descarga los archivos de control. */
const assert = require('node:assert/strict');
const { mkdir, readFile } = require('node:fs/promises');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, firefox } = require('playwright');

async function palette(page, command) {
  await page.keyboard.press('Control+k');
  const palette = page.locator('.ui-cmd');
  await palette.getByRole('combobox').fill(command);
  await palette.getByRole('option').filter({ hasText: command }).click();
}

async function openProject(page, file) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'), palette(page, 'Abrir un proyecto guardado'),
  ]);
  await chooser.setFiles(file);
  await page.getByText('Proyecto abierto', { exact: true }).first().waitFor();
}

async function chooseLabel(select, pattern) {
  const option = select.getByRole('option', { name: pattern });
  await option.waitFor({ state: 'attached' });
  await select.selectOption(await option.getAttribute('value'));
}

async function archive(page, file) {
  const [download] = await Promise.all([page.waitForEvent('download'), palette(page, 'Guardar el proyecto')]);
  await download.saveAs(file);
}

async function exportFile(page, out, format) {
  await palette(page, 'Exportar datos y figuras');
  const dialog = page.getByRole('dialog', { name: 'Exportar', exact: true });
  if (format === 'xlsx') {
    await dialog.getByText('Datos del pozo', { exact: true }).click();
    await dialog.getByText('Excel (.xlsx)', { exact: true }).click();
  } else {
    await dialog.getByText('Figuras', { exact: true }).click();
    await dialog.getByText(format.toUpperCase(), { exact: true }).click();
    await chooseLabel(dialog.getByLabel('Tramo de la figura'), /^Zona B /);
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exportar', exact: true }).click(),
  ]);
  const file = join(out, `replica-tp.${format}`);
  await download.saveAs(file);
  return file;
}

async function captureThemes(page, out, prefix) {
  const dismiss = await page.getByRole('button', { name: 'Cerrar aviso', exact: true }).all();
  for (const button of dismiss.reverse()) await button.click({ timeout: 750 }).catch(() => {});
  for (const theme of ['claro', 'oscuro']) {
    await palette(page, `Usar el tema ${theme}`);
    await page.screenshot({ path: join(out, `${prefix}-${theme}.png`) });
  }
  await palette(page, 'Usar el tema claro');
}

async function checkCalibration(page, tab, out) {
  const calibration = await tab('Calibración');
  const scope = calibration.getByLabel('Alcance de Aplicar: todo el pozo o una zona');
  for (const [name, count] of [['B', 90], ['D', 61]]) {
    await chooseLabel(scope, new RegExp(`^Zona ${name}$`));
    const plot = calibration.getByTestId('ccal-phi-plot').getByRole('img');
    await plot.waitFor();
    const metrics = (await calibration.locator('.ccal-kpis').first().innerText()).replace(/\s+/g, ' ');
    assert.match(metrics, new RegExp(`Plugs ${count} Sesgo .+ RMSE .+ R²`));
    const range = page.locator('.wv-toolbar__range');
    const before = await range.innerText();
    await plot.press('ArrowRight');
    await plot.press('Enter');
    await page.waitForFunction((previous) => document.querySelector('.wv-toolbar__range')?.textContent !== previous, before);
    console.log(`Calibración PHIE ${name}, ±0,15 m. ${metrics}`);
    await page.screenshot({ path: join(out, `calibracion-${name}.png`) });
  }
  await calibration.getByRole('button', { name: 'Cargar RI del TP', exact: true }).click();
  await calibration.getByRole('button', { name: 'Cargar RI del TP', exact: true }).waitFor({ state: 'hidden' });
}

async function checkWellQuality(page, out) {
  await page.getByRole('button', { name: /^Paso \d+: Calidad/ }).click();
  await page.getByRole('button', { name: 'Elegir intervalo de profundidad', exact: true }).click();
  const range = page.getByLabel('Intervalo de profundidad', { exact: true });
  await range.getByLabel('Tope', { exact: true }).fill('7633,2588');
  await range.getByLabel('Base', { exact: true }).fill('7657');
  await range.getByRole('button', { name: 'Mostrar tramo' }).click();
  const indicators = page.locator('.wv-head__title[title="Indicadores"]');
  await indicators.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, 'calidad.png') });
}

async function checkWater(tab) {
  const water = await tab('Agua de formación');
  await water.getByRole('radio', { name: 'A mano', exact: true }).click();
  for (const [field, value] of [['salinity', '140000'], ['temp', '115,5556']]) {
    const input = water.locator(`#fw-${field}`);
    await input.fill(value);
    await input.press('Enter');
  }
  assert.match(await water.getByTestId('fw-result-rw').innerText(), /0,0188/);
}

async function comparePorosityScenarios(page, out) {
  const reference = 'Referencia · Wyllie B';
  const alternative = 'Alternativa · densidad–neutrón B';
  const dialog = page.getByRole('dialog', { name: 'Snapshots' });
  const saveSnapshot = async (name) => {
    await palette(page, 'Abrir los snapshots');
    await dialog.getByLabel('Nombre del snapshot').fill(name);
    await dialog.getByRole('button', { name: 'Guardar snapshot', exact: true }).click();
    await dialog.getByRole('row', { name: new RegExp(name) }).waitFor();
  };
  await saveSnapshot(reference);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Paso \d+: Porosidad/ }).click();
  await page.getByRole('radio', { name: /Porosidad total/ }).click();
  const zonePicker = page.getByRole('radiogroup', { name: 'Editar parámetros de' });
  await zonePicker.getByRole('radio', { name: 'B', exact: true }).click();
  await page.locator('select[name="phit.method"]').selectOption('densityNeutronGas');
  await saveSnapshot(alternative);
  await chooseLabel(dialog.getByTestId('snap-pick-a'), new RegExp(reference));
  await chooseLabel(dialog.getByTestId('snap-pick-b'), new RegExp(alternative));
  const comparison = dialog.getByTestId('snap-compare-table');
  await comparison.waitFor();
  await comparison.getByRole('row').filter({ has: page.getByRole('cell', { name: 'B', exact: true }) }).and(comparison.locator('[data-changed]')).waitFor();
  await page.screenshot({ path: join(out, 'snapshots.png') });
  await dialog.getByRole('row', { name: new RegExp(reference) }).getByRole('button', { name: 'Restaurar' }).click();
  await page.getByText(/snapshot.*restaurado/i).first().waitFor();
  await page.keyboard.press('Escape');
}

async function main() {
  const out = resolve(process.argv[2] || 'tmp/replica-tp');
  await mkdir(out, { recursive: true });
  const { makeReplicaSeed, verifyReplicaExport } = await import('./replica-tp-seed.mjs');
  const seed = await makeReplicaSeed(out);
  const browser = process.env.QA_BROWSER === 'firefox'
    ? await firefox.launch()
    : await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const url = process.env.QA_URL || pathToFileURL(resolve('dist/index.html')).href;
  const context = await browser.newContext({ offline: url.startsWith('file:'), viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  const network = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route(/^https?:/, async (route) => {
    if (route.request().isNavigationRequest() && route.request().url() === url) return route.continue();
    network.push(route.request().url());
    await route.abort();
  });

  const tab = async (name) => {
    await palette(page, `Abrir la pestaña ${name}`);
    return page.locator('.shell-dock__panel:not([hidden])');
  };
  try {
    await page.goto(url);
    await context.setOffline(true);
    await page.getByTestId('home-load').press('Enter');
    await page.getByRole('button', { name: 'Cargar datos del TP', exact: true }).click();
    await page.getByRole('button', { name: /Siguiente: control de calidad/ }).click();
    await page.getByRole('button', { name: 'Cargar', exact: true }).click();
    await page.getByTestId('home-enter').click();
    await page.locator('canvas.wv-canvas').first().waitFor();
    // Abrir los mismos perfiles con la receta comprobada en tests/tp-replica.test.ts.
    await openProject(page, seed);

    const mdt = await tab('Presiones MDT');
    await mdt.getByRole('button', { name: 'Cargar presiones del TP', exact: true }).click();
    const color = mdt.getByLabel('Color de puntos', { exact: true });
    await chooseLabel(color, /^Drawdown$/);
    const scope = mdt.getByLabel('Filtrar pruebas por zona');
    for (const [name, count] of [['D', 31], ['C', 2], ['B', 25]]) {
      await chooseLabel(scope, new RegExp(`^${name} · origen$`));
      await mdt.getByText(new RegExp(`\\b${count} incluidas`)).first().waitFor();
    }
    const trial = mdt.getByRole('row', { name: /MDT-03/ });
    assert.match(await trial.innerText(), /66,59/);
    await mdt.getByRole('radio', { name: 'bar', exact: true }).click();
    assert.match(await trial.innerText(), /4,59/);
    await page.getByLabel('Drawdown (bar)', { exact: true }).waitFor();
    await mdt.getByRole('radio', { name: 'psi', exact: true }).click();
    await page.getByLabel('Drawdown (psi)', { exact: true }).waitFor();
    await page.locator('.wv-scroll').first().evaluate((element) => { element.scrollLeft = 160; });
    await captureThemes(page, out, 'mdt');
    for (const format of ['png', 'svg', 'pdf']) {
      const figure = await exportFile(page, out, format);
      const content = await readFile(figure);
      if (format === 'png') assert.equal(content.subarray(1, 4).toString(), 'PNG');
      if (format === 'pdf') assert.equal(content.subarray(0, 4).toString(), '%PDF');
      if (format === 'svg') {
        assert.match(content.toString(), /<svg\b/);
        assert.match(content.toString(), /Drawdown/);
      }
    }
    console.log('MDT: pozo del TP, drawdown y figuras PNG/SVG/PDF.');
    if (process.env.QA_MDT_ONLY) {
      const file = join(out, 'mdt.pozo.json');
      await archive(page, file);
      await openProject(page, file);
      await tab('Presiones MDT');
      assert.equal(await color.locator('option:checked').textContent(), 'Drawdown');
      assert.deepEqual(network, []);
      assert.deepEqual(errors, []);
      return;
    }

    const core = await tab('Corona');
    await core.getByRole('button', { name: 'Cargar corona del TP', exact: true }).click();
    await chooseLabel(core.getByLabel('Método del modelo k–φ'), /^Potencial$/);
    const zone = core.getByLabel('Tramo de los plugs del ajuste');
    for (const [name, activate] of [['B', false], ['D', true]]) {
      await chooseLabel(zone, new RegExp(`^(Zona )?${name}$`));
      await core.getByLabel('y usarlo para PERM').setChecked(activate);
      await core.getByRole('button', { name: `Aplicar a la zona ${name}`, exact: true }).click();
      await page.getByText('Modelo k–φ aplicado', { exact: true }).first().waitFor();
      if (activate) await page.getByText(/La permeabilidad.*zona D.*modelo de la corona/).waitFor();
    }
    await chooseLabel(zone, /^(Zona )?B$/);
    await captureThemes(page, out, 'corona');

    const scal = await tab('SCAL');
    await scal.getByText(/Datos del TP.*SCAL/).first().waitFor();
    await page.screenshot({ path: join(out, 'scal.png') });

    await checkCalibration(page, tab, out);
    await checkWater(tab);
    await checkWellQuality(page, out);
    await comparePorosityScenarios(page, out);

    const final = join(out, 'replica-tp.pozo.json');
    await archive(page, final);
    await openProject(page, final);
    await tab('Presiones MDT');
    assert.equal(await color.locator('option:checked').textContent(), 'Drawdown');
    const excel = await exportFile(page, out, 'xlsx');
    const controls = await verifyReplicaExport(final, excel);
    console.log('B608:', controls.B608);
    console.log('Corona: potencial aplicado por zona, SCAL, reapertura y exportación Excel.');

    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
    console.log(`Modo ${url.startsWith('file:') ? 'file:// sin red' : 'HTTP local, sin red después de cargar'}.`);
  } catch (error) {
    await page.screenshot({ path: join(out, 'error.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(-7000));
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
