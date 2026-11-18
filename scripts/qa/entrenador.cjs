/** F14 sobre el HTML de entrega, con navegador administrado y red deshabilitada. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

async function start(page, seed) {
  await page.getByRole('button', { name: 'Entrenador', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Entrenador' });
  if (seed !== undefined) await form.getByLabel('Semilla (opcional)').fill(String(seed));
  await form.getByRole('button', { name: 'Iniciar ejercicio' }).click();
  await page.getByTestId('home').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Corregir ejercicio' }).waitFor();
}

async function palette(page, query) {
  await page.keyboard.press('Control+k');
  await page.locator('.ui-cmd input[role=combobox]').fill(query);
  await page.keyboard.press('Enter');
}

async function save(page, path) {
  const [download] = await Promise.all([
    page.waitForEvent('download'), palette(page, 'Guardar el proyecto'),
  ]);
  await download.saveAs(path);
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(text, /"truth"|"trainerRecipe"[^}]*"(phi|sw|vsh)"/i);
  return JSON.parse(text).project;
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'f14-'));
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'reduce',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = browser.pages()[0];
  page.setDefaultTimeout(15000);
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:')) external.push(r.url());
  });
  try {
    const url = process.env.QA_URL || pathToFileURL(resolve('dist/index.html')).href;
    if (url.startsWith('file:')) await browser.setOffline(true);
    await page.goto(url);
    await browser.setOffline(true);
    await page.emulateMedia({ colorScheme: 'light' });
    await start(page, 73154);

    const earlyTruth = () => page.getByText('Verdad sembrada', { exact: false }).count();
    assert.equal(await earlyTruth(), 0);
    await palette(page, 'Abrir la pestaña Crossplot');
    await page.getByTestId('crossplot-panel').waitFor();
    assert.equal(await earlyTruth(), 0);
    await palette(page, 'Abrir la pestaña Histograma');
    await page.getByTestId('histogram-panel').waitFor();
    assert.equal(await earlyTruth(), 0);

    await page.getByRole('button', { name: /Arcilla/ }).first().click();
    for (const [label, value] of [['GR de arena limpia', '32'], ['GR de arcilla', '117']]) {
      const field = page.getByLabel(`${label} (número)`);
      await field.fill(value);
      await field.press('Enter');
    }
    await palette(page, 'Ir al paso Temperatura y Rw');
    await page.getByRole('radio', { name: /Rw conocida/ }).click();
    const thermal = page.locator('.param').filter({ hasText: 'Corregir por temperatura' }).getByRole('switch');
    await thermal.click();
    await palette(page, 'Ir al paso Saturación de agua');

    await page.getByRole('button', { name: 'Snapshots', exact: true }).click();
    const snapshots = page.getByRole('dialog', { name: 'Snapshots' });
    await snapshots.getByLabel('Nombre del snapshot').fill('Interpretación del ejercicio');
    await snapshots.getByRole('button', { name: 'Guardar snapshot' }).click();
    await snapshots.getByText('Interpretación del ejercicio', { exact: true }).first().waitFor();
    assert.equal(await earlyTruth(), 0);
    await snapshots.getByRole('button', { name: 'Cerrar', exact: true }).click();

    await page.getByTestId('export-open').click();
    const exports = page.getByRole('dialog', { name: 'Exportar' });
    assert.equal(await earlyTruth(), 0);
    const summary = exports.getByLabel('Incluir el sumario por zona');
    if (await summary.isEnabled()) await summary.click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exports.getByRole('button', { name: 'Exportar', exact: true }).click(),
    ]);
    const lasPath = join(profile, 'ejercicio.las');
    await download.saveAs(lasPath);
    const las = readFileSync(lasPath, 'utf8');
    assert.match(las, /PHIE/);
    assert.doesNotMatch(las, /verdad|sembrada|truth/i);

    const file = join(profile, 'ejercicio.pozo.json');
    const saved = await save(page, file);
    assert.deepEqual(saved.wells[0].trainerRecipe, { version: 1, seed: 73154, noise: true });
    assert.deepEqual(saved.wells[0].well.curves.map(c => c.role), ['GR', 'RHOB', 'NPHI', 'RT']);
    assert.equal(saved.snapshots.length, 1);
    assert.equal(saved.snapshots[0].trainerRecipe, undefined);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'), palette(page, 'Abrir un proyecto guardado'),
    ]);
    await chooser.setFiles(file);
    await page.getByText('Proyecto abierto', { exact: true }).waitFor();
    assert.equal(await earlyTruth(), 0);
    await page.getByRole('button', { name: 'Cerrar aviso', exact: true }).first().waitFor({ state: 'hidden' });
    const correct = page.getByRole('button', { name: 'Corregir ejercicio' });
    await correct.click();
    const dialog = page.getByRole('dialog', { name: 'Corrección del entrenador' });
    await dialog.getByText('Verdad sembrada', { exact: false }).waitFor();
    assert.match(await dialog.innerText(), /73154 · Con ruido · Versión 1/);
    for (const variable of ['Porosidad efectiva φ', 'Volumen de arcilla Vsh', 'Saturación de agua Sw']) {
      await dialog.getByRole('region', { name: variable, exact: true }).locator('canvas').first().waitFor();
    }
    const metrics = await dialog.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent?.trim())));
    assert.equal(metrics.length, 6);
    assert.ok(metrics.every(row => row[4] === '400 / 400' && /^100(?:,0)? %$/.test(row[5])), JSON.stringify(metrics));
    assert.ok(metrics.every(row => Number(row[2].replace(',', '.')) < (row[1] === 'Sw' ? 1 : 0.2)), JSON.stringify(metrics));
    const geometry = await dialog.locator('.ui-dialog__body').evaluate(body => {
      const box = body.getBoundingClientRect();
      const last = body.querySelector('tbody tr:last-child').getBoundingClientRect();
      return { viewTop: box.top, viewBottom: box.bottom, lastRowBottom: last.bottom, scrollHeight: body.scrollHeight };
    });
    assert.ok(geometry.lastRowBottom <= geometry.viewBottom, `La tabla debe verse entera a 1366 × 768. ${JSON.stringify(geometry)}`);
    const out = 'docs/capturas/f14';
    mkdirSync(out, { recursive: true });
    for (const [theme, name] of [['light', 'claro'], ['dark', 'oscuro']]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
      await page.screenshot({ path: `${out}/correccion-${name}.png` });
    }
    await dialog.getByRole('button', { name: 'Volver al pozo' }).click();
    assert.equal(await earlyTruth(), 0);

    await page.getByTestId('open-home').click();
    await start(page, 73154);
    const replay = await save(page, join(profile, 'repetido.pozo.json'));
    assert.equal(replay.wells.length, 2);
    assert.notEqual(replay.wells[0].well.id, replay.wells[1].well.id);
    assert.deepEqual(replay.wells[0].well.curves, replay.wells[1].well.curves);
    assert.deepEqual(replay.wells[0].trainerRecipe, replay.wells[1].trainerRecipe);

    await page.getByTestId('open-home').click();
    await start(page);
    const random = await save(page, join(profile, 'aleatorio.pozo.json'));
    assert.equal(random.wells.length, 3);
    assert.ok(Number.isInteger(random.wells[2].trainerRecipe.seed));
    assert.ok(random.wells[2].trainerRecipe.seed >= 0 && random.wells[2].trainerRecipe.seed <= 0xffffffff);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`Modo ${url.startsWith('file:') ? 'file:// sin red desde el inicio' : 'HTTP local, sin red después de la carga'}`);
    console.log('MAE y RMSE por zona en p.p., pares válidos y cobertura:', metrics);
    console.log('Archivo, snapshot, LAS, repetición y semilla aleatoria verificados; cero solicitudes externas y excepciones de página.');
  } finally {
    await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
