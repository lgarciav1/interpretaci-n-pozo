/** F10 sobre el HTML de entrega con el pozo del TP y las presiones sintéticas de ejemplo. */
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'f10-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    viewport: { width: 1366, height: 768 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = context.pages()[0];
  page.setDefaultTimeout(15000);
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) external.push(request.url());
  });
  const url = process.env.QA_URL || pathToFileURL(resolve('dist/index.html')).href;
  const output = process.env.QA_CAPTURAS || 'docs/capturas/f10';
  const command = async (name) => {
    await page.keyboard.press('Control+k');
    await page.locator('.ui-cmd input[role=combobox]').fill(name);
    await page.keyboard.press('Enter');
  };
  const save = async (name) => {
    const [download] = await Promise.all([page.waitForEvent('download'), command('Guardar el proyecto')]);
    const path = join(profile, name);
    await download.saveAs(path);
    return JSON.parse(readFileSync(path, 'utf8')).project;
  };
  const activeWell = (project) => project.wells.find((entry) => entry.well.id === project.activeWellId);
  const meters = (label) => Number(label.replace(/\./g, '').replace(',', '.').replace(/ m$/, ''));

  try {
    if (url.startsWith('file:')) await context.setOffline(true);
    await page.goto(url);
    await context.setOffline(true);
    await page.getByTestId('home-load').press('Enter');
    await page.getByRole('button', { name: 'Cargar datos del TP' }).press('Enter');
    await page.getByRole('button', { name: /Siguiente: control de calidad/ }).press('Enter');
    await page.getByRole('button', { name: 'Cargar', exact: true }).press('Enter');
    await page.getByTestId('home-enter').press('Enter');
    await command('Abrir la pestaña Presiones MDT');
    await page.getByRole('button', { name: 'Usar presiones de ejemplo' }).click();
    const contact = page.getByRole('region', { name: 'Contactos' }).getByRole('listitem')
      .filter({ hasText: /gas.petróleo/i });
    const depthButton = contact.getByRole('button', { name: /m$/ });
    const depth = meters(await depthButton.innerText());
    await depthButton.click();
    const action = contact.getByRole('button', { name: 'Usar como tope de zona' });

    const before = await save('antes.json');
    const previous = activeWell(before).interpretation;
    const host = previous.zones.find((zone) => zone.top < depth && depth < zone.base);
    assert.ok(host, 'el contacto sintético debe caer dentro de una zona del TP');

    await action.click();
    await page.getByText(/^Tope de «/).waitFor();
    const after = await save('despues.json');
    const current = activeWell(after).interpretation;
    const lower = current.zones.find((zone) => !previous.zones.some((prior) => prior.id === zone.id));
    const upper = current.zones.find((zone) => zone.id === host.id);
    assert.equal(current.zones.length, previous.zones.length + 1);
    assert.ok(lower && upper);
    assert.equal(upper.top, host.top);
    assert.equal(lower.base, host.base);
    assert.ok(upper.base < lower.top && lower.top - upper.base < 0.153);
    assert.ok(Math.abs(lower.top - depth) <= 0.1524 / 2 + 0.05, 'tope ajustado a la muestra MD');
    assert.deepEqual(current.params.zones[lower.id], previous.params.zones[host.id]);
    assert.deepEqual(activeWell(after).well, activeWell(before).well);
    assert.deepEqual(current.trends, previous.trends, 'los gradientes MDT se conservan');

    mkdirSync(output, { recursive: true });
    for (const theme of ['claro', 'oscuro']) {
      await command(`Usar el tema ${theme}`);
      await action.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await page.locator('.ui-toast').last().waitFor({ state: 'hidden', timeout: 10000 });
      await page.screenshot({ path: join(output, `tope-mdt-${theme}.png`) });
    }

    await action.click();
    await page.getByText('No se creó el tope', { exact: true }).waitFor();
    await page.keyboard.press('Control+z');
    assert.deepEqual(await save('deshacer.json'), before);
    await page.keyboard.press('Control+y');
    assert.deepEqual(await save('rehacer.json'), after);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`OK · ${url.startsWith('file:') ? 'file:// sin red' : 'HTTP local sin red tras la carga'} · contacto ${depth} m, tope ${lower.top} m · deshacer/rehacer en un paso`);
  } catch (error) {
    await page.screenshot({ path: '/tmp/f10-fallo.png' }).catch(() => {});
    throw error;
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
