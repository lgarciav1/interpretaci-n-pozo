/** F21: TP real, diagnóstico sin entradas, demostración híbrida y capturas offline del HTML único. */
const { chromium } = require('playwright');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

async function palette(page, text) {
  await page.keyboard.press('Control+k');
  await page.locator('.ui-cmd input[role=combobox]').fill(text);
  await page.keyboard.press('Enter');
}

async function openProject(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), palette(page, 'Abrir un proyecto guardado')]);
  await chooser.setFiles(file);
  await page.getByText('Proyecto abierto', { exact: true }).waitFor();
}

async function verifySynthetic(page, profile, panel) {
  const { makeHeightSeed } = await import('./saturacion-altura-seed.mjs');
  const { wellFile, labFile, scenario, rockType } = await makeHeightSeed(profile);
  await page.keyboard.press('Escape');
  await openProject(page, wellFile);
  await palette(page, 'Abrir la pestaña Saturación por altura');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'), panel.getByRole('button', { name: 'Cargar tabla capilar (JSON)' }).click(),
  ]);
  await chooser.setFiles(labFile);
  await panel.getByText('Tendencias MDT, geometría y ensayos disponibles', { exact: true }).click();
  const dataset = panel.locator('li').filter({ hasText: 'curva-sintetica-f21.json' });
  const setId = await dataset.locator('code').innerText();
  scenario.classes = [{
    rockType, reference: 'Curva del caso conocido', conditions: 'Drenaje primario del caso sintético',
    assignment: 'Misma clase del perfil sintético', saturationBasis: 'Agua mojante en v/v',
    basis: { kind: 'reservoir', drainage: 'primary', phase: 'oil' }, model: { kind: 'point-set', setId, sample: 'plug-1' },
  }];
  await panel.getByRole('button', { name: 'Editar plantilla' }).click();
  await panel.getByRole('textbox', { name: 'Escenario revisado (JSON)' }).fill(JSON.stringify(scenario, null, 2));
  const save = panel.getByRole('button', { name: 'Guardar escenario y snapshot' });
  await panel.getByText('101 puntos visibles · 1 curva capilar').waitFor();
  await panel.getByLabel('Zona', { exact: true }).selectOption('upper');
  await save.click();
  await panel.getByText('Escenario guardado en la interpretación.', { exact: true }).waitFor();
  await palette(page, 'Deshacer');
  await panel.getByText('Escenario guardado en la interpretación.', { exact: true }).waitFor({ state: 'hidden' });
  assert.ok(await save.isEnabled());
  await save.click();
  await panel.getByText('Escenario guardado en la interpretación.', { exact: true }).waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), palette(page, 'Guardar el proyecto')]);
  const accepted = join(profile, 'aceptado-f21.pozo.json');
  await download.saveAs(accepted);
  await openProject(page, accepted);
  await palette(page, 'Abrir la pestaña Saturación por altura');
  await panel.getByText('Escenario guardado en la interpretación.', { exact: true }).waitFor();
  assert.equal(await panel.getByLabel('Zona', { exact: true }).inputValue(), 'upper');
  await panel.getByText('50 puntos visibles · 1 curva capilar').waitFor();
  await palette(page, 'Abrir los snapshots');
  await page.getByText('Saturación por altura · escenario revisado', { exact: true }).waitFor();
  console.log('Caso sintético: tabla importada, FWL y curva, aplicación, deshacer, reapertura con filtro y snapshot.');
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'f21-'));
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = browser.pages()[0];
  const errors = [];
  const external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) external.push(request.url());
  });
  try {
    const url = process.env.QA_URL || pathToFileURL(resolve('dist/index.html')).href;
    if (url.startsWith('file:')) await browser.setOffline(true);
    await page.goto(url);
    await browser.setOffline(true);
    page.setDefaultTimeout(15000);
    await page.getByTestId('home-load').press('Enter');
    await page.getByRole('button', { name: 'Cargar datos del TP', exact: true }).press('Enter');
    await page.getByRole('button', { name: /Siguiente: control de calidad/ }).press('Enter');
    await page.getByRole('button', { name: 'Cargar', exact: true }).press('Enter');
    await page.getByTestId('home-enter').press('Enter');
    await page.keyboard.press('Escape');
    await palette(page, 'Abrir la pestaña Saturación por altura');
    const panel = page.getByTestId('saturation-height');
    await panel.getByText('Falta un nivel de agua libre admisible', { exact: true }).waitFor();
    assert.equal(await panel.getByTestId('height-count').count(), 0);
    await panel.getByRole('button', { name: 'Revisar MDT' }).press('Enter');
    await page.getByRole('button', { name: 'Cargar presiones del TP', exact: true }).press('Enter');
    await palette(page, 'Abrir la pestaña Saturación por altura');
    await page.getByTestId('panel-expand').press('Enter');
    await panel.getByText('Falta un nivel de agua libre admisible', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Editar plantilla' }).press('Enter');
    assert.equal(await panel.getByRole('button', { name: 'Guardar escenario y snapshot' }).isEnabled(), false);
    await panel.getByRole('button', { name: 'Ver demostración' }).press('Enter');
    const count = panel.getByTestId('height-count');
    await count.waitFor();
    const full = await count.innerText();
    assert.match(full, /5795 puntos visibles · 4 curvas capilares/);
    assert.equal(await panel.getByRole('button', { name: 'Guardar escenario y snapshot' }).isEnabled(), false);
    const zones = panel.getByLabel('Zona', { exact: true });
    const D = await zones.locator('option').filter({ hasText: /^D$/ }).getAttribute('value');
    await zones.selectOption(D);
    const zonal = await count.innerText();
    assert.notEqual(zonal, full);
    assert.match(zonal, /^[1-9]\d* puntos visibles/);
    const types = panel.getByLabel('Tipo de roca', { exact: true });
    const typeOptions = await types.locator('option').evaluateAll(options => options.map(o => o.value).filter(v => /^\d+$/.test(v)));
    let filtered = '';
    for (const type of typeOptions) {
      await types.selectOption(type);
      filtered = await count.innerText();
      if (/^[1-9]\d* puntos? visibles?/.test(filtered) && filtered !== zonal) break;
    }
    assert.match(filtered, /^[1-9]\d* puntos? visibles?/);
    assert.notEqual(filtered, zonal);
    await types.selectOption('*');
    mkdirSync('docs/capturas/f21', { recursive: true });
    for (const close of await page.getByRole('button', { name: 'Cerrar aviso', exact: true }).all()) await close.click();
    for (const theme of ['claro', 'oscuro']) {
      await palette(page, `Usar el tema ${theme}`);
      await panel.getByRole('heading', { name: 'Saturación por altura', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `docs/capturas/f21/tp-${theme}.png` });
    }
    await panel.getByRole('button', { name: 'Volver al escenario' }).press('Enter');
    await panel.getByText('Falta un nivel de agua libre admisible', { exact: true }).waitFor();
    await verifySynthetic(page, profile, panel);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`Modo ${url.startsWith('file:') ? 'file:// sin red desde el inicio' : 'HTTP local, sin red después de cargar'} · TP: ${full} · zona D: ${zonal} · zona/clase: ${filtered}`);
  } catch (error) {
    console.error('Excepciones de página:', errors);
    if (process.env.QA_URL) console.error((await page.locator('body').innerText()).slice(-5500));
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
