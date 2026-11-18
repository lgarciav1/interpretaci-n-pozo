// Recorrido de F06 sobre el único HTML de entrega.
const assert = require('node:assert/strict');
const { mkdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    const external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) external.push(request.url());
    });
    const url = process.env.QA_URL || pathToFileURL(resolve('dist/index.html')).href;
    const command = async name => {
      await page.keyboard.press('Control+k');
      await page.locator('.ui-cmd input[role=combobox]').fill(name);
      await page.locator('.ui-cmd').getByRole('option').filter({ hasText: name }).first().click();
    };
    const button = (name, root = page) => root.getByRole('button', { name, exact: typeof name === 'string' });
    if (url.startsWith('file:')) await context.setOffline(true);
    await page.goto(url);
    await context.setOffline(true);

    await page.getByTestId('home-load').click();
    await button('Cargar datos del TP').press('Enter');
    await button(/Siguiente: control de calidad/).press('Enter');
    await button('Cargar').press('Enter');
    await button('Entrar al pozo').click();
    const showWell = button('Mostrar datos del pozo');
    if (await showWell.isVisible()) await showWell.click();
    const dialog = page.getByRole('dialog');
    const add = async (name, formula, unit) => {
      await button('Nueva curva por fórmula').click();
      await dialog.getByLabel('Mnemónico').fill(name);
      await dialog.getByLabel('Fórmula', { exact: true }).fill(formula);
      if (unit) await dialog.getByLabel('Unidad del resultado').selectOption(unit);
      await button('Guardar fórmula', dialog).click();
    };
    await add('REL_RT', 'AT90/AT10');
    await dialog.waitFor({ state: 'hidden' });
    await add('PHI_HC', 'PHIE*(1-SW)', 'v/v');
    await dialog.waitFor({ state: 'hidden' });
    await add('INVALIDA', 'max(2,)');
    await dialog.getByRole('alert').filter({ hasText: /Sintaxis, columna/ }).waitFor();
    await dialog.getByLabel('Fórmula', { exact: true }).fill('CURVA_INEXISTENTE');
    await button('Guardar fórmula', dialog).click();
    await dialog.getByRole('alert').filter({ hasText: /No existe la referencia/ }).waitFor();
    await page.keyboard.press('Escape');
    await button('Editar REL_RT').click();
    await dialog.getByLabel('Fórmula', { exact: true }).fill('REL_RT');
    await button('Guardar fórmula', dialog).click();
    await dialog.getByRole('alert').filter({ hasText: /ciclo.*REL_RT/ }).waitFor();
    await page.keyboard.press('Escape');

    console.log('Fórmulas creadas. Sintaxis, referencia y ciclo rechazados.');
    await command('Armar pistas');
    for (const name of ['REL_RT', 'PHI_HC']) {
      await page.getByLabel('Buscar en el catálogo').fill(name);
      await button(`Agregar ${name} a una pista…`).click();
      await page.getByRole('menuitem', { name: /En una pista nueva/ }).click();
    }
    await command('Terminar de armar pistas');
    for (const name of ['REL_RT', 'PHI_HC']) await page.locator('.wv-head').getByText(name, { exact: true }).first().waitFor();

    console.log('Ambas curvas agregadas a pistas del visor.');
    await command('Abrir la pestaña Crossplot');
    await page.getByLabel('Curva del eje X').selectOption('r:REL_RT');
    await page.getByLabel('Curva del eje Y').selectOption('r:PHI_HC');
    const crossplot = page.getByTestId('crossplot-count');
    assert.ok(Number((await crossplot.innerText()).replace(/\D/g, '')) > 100);
    await page.locator('.wv-head').filter({ has: page.getByText('REL_RT', { exact: true }) }).first()
      .evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'start' }));
    console.log(`Crossplot: ${await crossplot.innerText()}`);
    const output = process.env.QA_CAPTURAS;
    for (const theme of ['claro', 'oscuro']) {
      await command(`Usar el tema ${theme}`);
      if (output) {
        mkdirSync(output, { recursive: true });
        await page.locator('.ui-toast').last().waitFor({ state: 'hidden' });
        await page.screenshot({ path: join(output, `formula-${theme}.png`) });
      }
    }
    await command('Abrir la pestaña Histograma');
    for (const name of ['REL_RT', 'PHI_HC']) {
      await page.getByRole('combobox', { name: 'Curva del histograma', exact: true }).selectOption(`r:${name}`);
      await page.getByTestId('histogram-plot').waitFor();
      await page.getByTestId('histogram-stats').waitFor();
    }
    console.log('Ambas curvas disponibles en el Histograma.');
    const [saved] = await Promise.all([page.waitForEvent('download'), command('Guardar el proyecto')]);
    const file = readFileSync(await saved.path());
    const archive = JSON.parse(file.toString());
    const formulas = archive.project.wells[0].interpretation.formulas;
    assert.deepEqual(formulas.map(f => f.expression), ['AT90/AT10', 'PHIE*(1-SW)']);
    const [reopen] = await Promise.all([page.waitForEvent('filechooser'), command('Abrir un proyecto guardado')]);
    await reopen.setFiles({ name: 'f06.pozo.json', mimeType: 'application/json', buffer: file });
    await page.getByText('f06.pozo.json', { exact: true }).waitFor();
    await button('Editar PHI_HC').waitFor();
    await page.getByTestId('computed-table').locator('[data-port="PHI_HC"][data-active="true"]').waitFor();

    await command('Exportar datos y figuras');
    await dialog.getByRole('radio', { name: 'LAS 2.0', exact: true }).click();
    const summary = dialog.getByRole('checkbox', { name: 'Incluir el sumario por zona' });
    if (await summary.isChecked()) await summary.uncheck();
    const [download] = await Promise.all([page.waitForEvent('download'), button('Exportar', dialog).click()]);
    assert.match(download.suggestedFilename(), /\.las$/i);
    const las = readFileSync(await download.path(), 'utf8');
    assert.match(las.split('~A')[0], /^REL_RT\.\s+: Fórmula: AT90\/AT10$/m);
    assert.match(las.split('~A')[0], /^PHI_HC\.v\/v\s+: Fórmula: PHIE\*\(1-SW\)$/m);
    const rows = las.split(/\r?\n/);
    const start = rows.findIndex(row => row.startsWith('~A'));
    const names = rows[start].trim().split(/\s+/).slice(1);
    for (const index of [1, 598, 1080, 2000, 3271, 5154, 5809]) {
      const row = rows[start + 1 + index].trim().split(/\s+/).map(Number);
      const at = name => row[names.indexOf(name)];
      assert.ok(Math.abs(at('REL_RT') - at('AT90') / at('AT10')) < 1e-12);
      assert.ok(Math.abs(at('PHI_HC') - (at('PHIE') - at('SW') * at('PHIE'))) < 1e-12);
      console.log(`muestra ${index}, MD ${at('DEPT')} m, REL_RT ${at('REL_RT')}, PHI_HC ${at('PHI_HC')}`);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`${url}: TP, visor, crossplot, histograma, errores, proyecto y LAS verificados sin red.`);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
