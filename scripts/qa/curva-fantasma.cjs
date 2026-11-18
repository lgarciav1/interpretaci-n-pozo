/** F18, recorrido sobre el HTML único. NODE_PATH debe incluir playwright o playwright-core. */
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'f18-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    viewport: { width: 1366, height: 768 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = context.pages()[0];
  page.setDefaultTimeout(12000);
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:')) external.push(r.url());
  });
  const url = process.env.QA_URL || pathToFileURL(resolve('dist/index.html')).href;
  const output = process.env.QA_CAPTURAS || 'docs/capturas/f18';
  const viewer = page.locator('.shell-viewer .wv-body');
  const status = page.getByTestId('viewer-ghost-status');
  const target = page.locator('[data-target="viewer-ghost|ghost"]');
  const command = async (name) => {
    await page.keyboard.press('Control+k');
    await page.locator('.ui-cmd input[role=combobox]').fill(name);
    await page.keyboard.press('Enter');
  };
  const exported = async (name) => {
    const [download] = await Promise.all([page.waitForEvent('download'), command('Guardar el proyecto')]);
    const path = join(profile, name);
    await download.saveAs(path);
    return JSON.parse(readFileSync(path, 'utf8')).project;
  };
  const range = async () => page.getByTestId('viewer-visible').evaluate((el) =>
    ({ top: Number(el.dataset.top), base: Number(el.dataset.base) }));
  const show = async (top, base) => {
    await page.locator('.wv-range-trigger').click();
    const dialog = page.getByRole('dialog', { name: 'Intervalo de profundidad' });
    await dialog.getByLabel('Tope').fill(String(top));
    await dialog.getByLabel('Base').fill(String(base));
    await dialog.getByRole('button', { name: 'Mostrar tramo' }).click();
    await page.waitForFunction(([a, b]) => {
      const d = document.querySelector('[data-testid=viewer-visible]').dataset;
      return Math.abs(Number(d.top) - a) < 0.5 && Math.abs(Number(d.base) - b) < 0.5;
    }, [top, base]);
  };
  const coords = async (track, depth, fraction) => {
    const head = page.locator(`.shell-viewer .wv-head[data-track-id="${track}"]`);
    await head.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const t = await head.boundingBox();
    const v = await viewer.boundingBox();
    const window = await range();
    return { x: t.x + fraction * t.width, y: v.y + v.height * (depth - window.top) / (window.base - window.top), left: t.x };
  };
  const arm = async (track, depth, fraction, name) => {
    const p = await coords(track, depth, fraction);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    const action = page.getByRole('menuitem', { name: new RegExp(`^Calcar un tramo de ${name}`) });
    await action.click();
    await status.getByText('Arrastrá', { exact: false }).waitFor();
  };
  const drag = async (a, b, finish = true) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    if (finish) await page.mouse.up();
  };
  const select = async (track, top, base) => {
    await drag(await coords(track, top, 0.55), await coords(track, base, 0.55));
    await status.getByText('+0', { exact: false }).waitFor();
  };
  const remove = async () => {
    await page.getByRole('button', { name: 'Quitar calco' }).click();
    await status.waitFor({ state: 'detached' });
    await target.waitFor({ state: 'detached' });
  };
  try {
    if (url.startsWith('file:')) await context.setOffline(true);
    await page.goto(url);
    await context.setOffline(true);
    await page.getByTestId('home-load').press('Enter');
    await page.getByRole('button', { name: 'Cargar datos del TP' }).press('Enter');
    await page.getByRole('button', { name: /Siguiente: control de calidad/ }).press('Enter');
    await page.getByRole('button', { name: 'Cargar', exact: true }).press('Enter');
    await page.getByTestId('home-enter').press('Enter');
    await viewer.waitFor();
    await page.keyboard.press('Escape');
    const before = await exported('antes.json');

    await show(7800, 7930);
    await arm('correlation', 7830, 0.4, 'GR');
    await page.keyboard.press('Escape');
    await status.waitFor({ state: 'detached' });

    await arm('correlation', 7830, 0.4, 'GR');
    await drag(await coords('correlation', 7820, 0.5), await coords('correlation', 7860, 0.5), false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await status.waitFor({ state: 'detached' });

    await arm('correlation', 7830, 0.4, 'GR');
    await drag(await coords('correlation', 7820, 0.5), await coords('correlation', 7860, 0.5), false);
    await viewer.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
    await page.mouse.up();
    await status.waitFor({ state: 'detached' });

    await arm('correlation', 7830, 0.4, 'GR');
    await select('correlation', 7820, 7860);
    const midpoint = await coords('correlation', 7840, 0);
    const grip = { x: midpoint.left + 12, y: midpoint.y };
    const initial = await status.innerText();
    await drag(grip, { x: grip.x, y: grip.y + 48 });
    const moved = await status.innerText();
    assert.notEqual(moved, initial);
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await status.innerText(), moved);
    await page.keyboard.press('ArrowUp');
    assert.equal(await status.innerText(), moved);
    await target.focus();
    await page.keyboard.press('Shift+ArrowUp');
    assert.notEqual(await status.innerText(), moved);
    await page.keyboard.press('Shift+ArrowDown');
    assert.equal(await status.innerText(), moved);
    await page.keyboard.press('Escape');
    const originalRange = await range();
    await page.keyboard.press('+');
    await page.waitForFunction((span) => {
      const d = document.querySelector('[data-testid=viewer-visible]').dataset;
      return Number(d.base) - Number(d.top) < span;
    }, originalRange.base - originalRange.top);
    const zoomed = await range();
    await page.keyboard.press('PageDown');
    await page.waitForFunction((lastTop) =>
      Number(document.querySelector('[data-testid=viewer-visible]').dataset.top) > lastTop, zoomed.top);
    assert.equal(await status.innerText(), moved);

    mkdirSync(output, { recursive: true });
    await show(7800, 7930);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: join(output, 'gr-claro.png') });
    await remove();

    await arm('resistivity', 7830, 0.45, 'AT(?:10|30|60|90)');
    await select('resistivity', 7820, 7860);
    await target.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Escape');
    await show(7800, 7930);
    await command('Usar el tema oscuro');
    await page.mouse.move(5, 5);
    await page.screenshot({ path: join(output, 'resistividad-oscuro.png') });
    await remove();

    await show(8450, 8518);
    await arm('sonic', 8490, 0.45, 'DT');
    await select('sonic', 8482, 8516);
    await target.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Escape');
    assert.match(await status.innerText(), /−/);
    await show(8450, 8518);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: join(output, 'dt-hueco-oscuro.png') });
    assert.deepEqual(await exported('despues.json'), before);

    await command('Cargar el pozo de demostración');
    await status.waitFor({ state: 'detached' });
    await target.waitFor({ state: 'detached' });
    assert.match(await viewer.getAttribute('aria-label'), /demostr|sintético/i);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`OK · ${url.startsWith('file:') ? 'file:// sin red desde el inicio' : 'HTTP local sin red tras la carga'} · TP GR, resistividad y DT · capturas 1366 × 768`);
  } catch (error) {
    await page.screenshot({ path: '/tmp/f18-fallo.png' }).catch(() => {});
    console.error({ errors, external });
    throw error;
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
