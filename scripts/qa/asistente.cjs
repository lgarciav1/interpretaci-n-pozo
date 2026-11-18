// Recorrido F26 sobre el HTML autocontenido.
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
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
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
    await command('Abrir la pestaña Asistente');

    const panel = page.getByRole('region', { name: 'Asistente del pozo' });
    const response = panel.getByRole('status');
    const ask = async (query, expected) => {
      await panel.getByRole('textbox', { name: 'Pregunta sobre el pozo' }).fill(query);
      await button('Preguntar', panel).click();
      await response.filter({ hasText: expected }).waitFor();
    };

    await button('Mostrame Sw en la zona D', panel).click();
    await button('Mostrar SW en la zona D', panel).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-curve-key')?.endsWith(':SW'));
    const interval = await page.locator('.wv-toolbar__range').innerText();
    console.log('Tramo en el visor:', interval);

    await ask('¿Por qué la zona C tiene poco pay?', /ZONE_SUMMARY/);
    const summary = await response.innerText();
    assert.match(summary, /Zona C.*\d.* m.*reservorio neto/);
    console.log('Respuesta de zona C:', summary);

    const output = process.env.QA_CAPTURAS;
    if (output) {
      mkdirSync(output, { recursive: true });
      for (const theme of ['claro', 'oscuro']) {
        await command(`Usar el tema ${theme}`);
        await page.locator('.ui-toast').last().waitFor({ state: 'hidden' });
        await page.screenshot({ path: join(output, `asistente-${theme}.png`) });
      }
    }

    await ask('¿Qué pasa si muevo el cutoff de Sw a 65 % en la zona D?', /0,650 v\/v/);
    assert.match(await response.innerText(), /CUTOFF_SWEEP/);
    await ask('¿Cómo funciona Archie?', /arenas limpias/);
    await button(/Sw.*Archie/, panel).click();
    await page.getByRole('dialog', { name: /Ecuaciones/ }).waitFor();
    await page.keyboard.press('Escape');

    await ask('Quiero abrir el crossplot', /No reconocí/);
    await button('Abrir la pestaña Crossplot', panel).waitFor();

    await page.getByText('Geología', { exact: true }).first().click();
    await command('Abrir la pestaña Asistente');
    await ask('¿Cuánto pay hay en la zona D?', /ZONE_SUMMARY/);
    await button('Abrir Sumario', panel).click();
    await page.getByText('Sumario por zona', { exact: true }).first().waitFor();

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('Verificados visor, sumario, sensibilidad, Ecuaciones y sugerencias. Cero solicitudes externas y cero errores de página.');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
