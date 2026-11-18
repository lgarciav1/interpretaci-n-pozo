// Recorrido F15 sobre el HTML de entrega.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
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
    await context.addInitScript(() => {
      window.f15 = { engineRuns: 0, bandsRuns: 0 };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          this.taskName = options?.name;
          if (this.taskName === 'bandas-de-incertidumbre') {
            this.addEventListener('message', event => { window.f15.bands = event.data; });
          }
        }
        postMessage(data, ...args) {
          if (this.taskName === 'bandas-de-incertidumbre') {
            window.f15.bandsRuns++;
            window.f15.inputs = data;
          }
          if (this.taskName === 'motor' && data.type === 'run') window.f15.engineRuns++;
          super.postMessage(data, ...args);
        }
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    const external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) external.push(request.url());
    });
    const url = process.env.QA_URL || pathToFileURL(resolve('dist/index.html')).href;
    if (url.startsWith('file:')) await context.setOffline(true);
    await page.goto(url);
    await context.setOffline(true);

    const button = (name, root = page) => root.getByRole('button', { name, exact: typeof name === 'string' });
    const command = async name => {
      await page.keyboard.press('Control+k');
      await page.locator('.ui-cmd input[role=combobox]').fill(name);
      await page.locator('.ui-cmd').getByRole('option').filter({ hasText: name }).first().click();
    };
    await page.getByTestId('home-load').click();
    await button('Cargar datos del TP').press('Enter');
    await button(/Siguiente: control de calidad/).press('Enter');
    await button('Cargar').press('Enter');
    await button('Entrar al pozo').click();
    const factoryControls = button('Mostrar banda de incertidumbre', page.locator('[data-track-id="saturation"]'));
    await factoryControls.nth(1).waitFor();
    assert.deepEqual(await factoryControls.evaluateAll(controls => controls.map(control => control.getAttribute('aria-pressed'))),
      ['false', 'false']);
    await page.locator('.tb-template-btn').click();
    await page.getByRole('menuitem', { name: /Petrofísica esencial/ }).click();

    const sw = button('Mostrar banda de incertidumbre', page.locator('[data-track-id="saturation"]'));
    const phi = button('Mostrar banda de incertidumbre', page.locator('[data-track-id="effective-porosity"]'));
    await sw.waitFor();
    await phi.waitFor();
    await page.waitForFunction(() => window.f15.bands?.SW && window.f15.bands?.PHIE);
    const crossing = await page.evaluate(() => {
      const { bands, inputs } = window.f15;
      const depthAt = i => 7633.2588 + i * 0.1524;
      let best = [];
      let run = [];
      for (let i = 0; i < bands.SW.p90.length; i++) {
        if (bands.SW.p90[i] < 0.6 && 0.6 < bands.SW.p10[i]) {
          run.push(i);
          if (run.length > best.length) best = run;
        } else {
          run = [];
        }
      }
      const i = best[Math.floor(best.length / 2)];
      return { n: best.length, top: depthAt(best[0]), base: depthAt(best.at(-1)), md: depthAt(i),
        sw: inputs.SW.values[i], p90: bands.SW.p90[i], p10: bands.SW.p10[i] };
    });
    assert.ok(crossing.n > 1);
    console.log('Cruce con Sw máxima 0,60:', crossing);

    await button('Elegir intervalo de profundidad').click();
    const dialog = page.getByRole('dialog', { name: 'Intervalo de profundidad' });
    await dialog.getByLabel('Tope').fill((crossing.md - 10).toFixed(2));
    await dialog.getByLabel('Base').fill((crossing.md + 10).toFixed(2));
    await button('Mostrar tramo', dialog).click();
    const counts = () => page.evaluate(() => [window.f15.engineRuns, window.f15.bandsRuns]);
    const before = await counts();
    assert.ok(before[0] > 0, 'Se instrumentaron los pedidos al motor principal');
    const frame = async () => {
      await page.mouse.move(0, 0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return page.locator('.wv-canvas').first().evaluate(canvas => canvas.toDataURL());
    };
    const check = async (swOn, phiOn) => {
      assert.equal(await sw.getAttribute('aria-pressed'), String(swOn));
      assert.equal(await phi.getAttribute('aria-pressed'), String(phiOn));
      return frame();
    };
    const off = await check(false, false);
    await sw.click();
    const onlySw = await check(true, false);
    await phi.click();
    const both = await check(true, true);
    await sw.click();
    const onlyPhi = await check(false, true);
    await phi.click();
    assert.equal(await check(false, false), off);
    assert.equal(new Set([off, onlySw, onlyPhi, both]).size, 4, 'Cada combinación cambia el canvas');
    assert.deepEqual(await counts(), before, 'Los toggles no envían pedidos al motor ni al worker de bandas');
    await sw.click();
    await phi.click();

    const output = process.env.QA_CAPTURAS;
    if (output) await command('Plegar el panel lateral');
    for (const theme of ['claro', 'oscuro']) {
      await command(`Usar el tema ${theme}`);
      await page.locator('.ui-toast').last().waitFor({ state: 'hidden' });
      if (output) {
        mkdirSync(output, { recursive: true });
        await page.screenshot({ path: join(output, `bandas-${theme}.png`) });
      }
    }
    if (output) await command('Mostrar el panel lateral');
    await button(/^Paso \d+: Saturación/).click();
    const slider = page.getByRole('slider', { name: 'Exponente de saturación (n)' }).first();
    await slider.waitFor();
    const beforeSlide = await counts();
    const readSlider = () => slider.evaluate(input => +input.value);
    const initial = await readSlider();
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('.wv-band-status')?.textContent.includes('desactualizadas')) {
          window.f15.sawStale = true;
          observer.disconnect();
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await slider.press('ArrowRight');
    assert.ok(await readSlider() > initial, 'El slider cambia de inmediato');
    await page.waitForFunction(() => window.f15.sawStale);
    await page.waitForFunction(previous => window.f15.engineRuns > previous, beforeSlide[0]);
    await page.waitForFunction(previous => window.f15.bandsRuns > previous, beforeSlide[1]);
    await page.locator('.wv-band-status').waitFor({ state: 'hidden' });
    console.log('El slider actualizó el motor y el aviso de bandas desactualizadas desapareció al terminar el nuevo cálculo.');

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('Las cuatro combinaciones producen rellenos distintos. Red deshabilitada, cero solicitudes externas y cero errores de página.');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
