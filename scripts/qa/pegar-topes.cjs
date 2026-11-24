/**
 * F09 · Pegar topes. Carga el pozo del TP, abre «Pegar topes» con una tabla con un solape, saca capturas (claro y
 * oscuro) y comprueba el aplicado y que Ctrl+Z lo deshace en un paso.
 * Uso: QA_URL=http://127.0.0.1:5173/ node scripts/qa/pegar-topes.cjs   (QA_CAPTURAS=docs/capturas/f09)
 */
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');

const TABLA = [
  'Formación\tTope (m)\tBase (m)',
  'A\t7633,3\t7800',
  'B\t7790\t7900',
  'C\t7900,5\t',
  'D\t8150\t',
  'E\t8300\t',
].join('\n');
const TABLA_OK = TABLA.replace('7790', '7800,5');

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' })).newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const output = process.env.QA_CAPTURAS || 'docs/capturas/f09';
  mkdirSync(output, { recursive: true });
  const command = async (name) => {
    await page.keyboard.press('Control+k');
    await page.locator('.ui-cmd input[role=combobox]').fill(name);
    await page.keyboard.press('Enter');
  };
  const zoneNames = () => page.locator('[data-testid=zones-table] tbody tr td:first-child').allInnerTexts();
  try {
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173/');
    await page.getByTestId('home-load').press('Enter');
    await page.getByRole('button', { name: 'Cargar datos del TP' }).press('Enter');
    await page.getByRole('button', { name: /Siguiente: control de calidad/ }).press('Enter');
    await page.getByRole('button', { name: 'Cargar', exact: true }).press('Enter');
    await page.getByTestId('home-enter').press('Enter');
    await page.getByRole('button', { name: 'Mostrar datos del pozo' }).click();
    const before = await zoneNames();
    await page.getByTestId('zones-paste-tops').click();
    await page.getByTestId('paste-tops-text').fill(TABLA);
    await page.getByTestId('paste-tops-preview').waitFor();
    assert.equal(await page.getByTestId('paste-tops-apply').isDisabled(), true, 'el solape bloquea');
    for (const theme of ['claro', 'oscuro']) {
      await command(`Usar el tema ${theme}`);
      await page.screenshot({ path: join(output, `pegar-topes-${theme}.png`) });
    }
    await command('Usar el tema claro');
    await page.getByTestId('paste-tops-text').fill(TABLA_OK);
    assert.equal(await page.getByTestId('paste-tops-apply').isDisabled(), false);
    await page.getByTestId('paste-tops-apply').click();
    const after = await zoneNames();
    assert.deepEqual(after.map((t) => t.trim()), ['A', 'B', 'C', 'D', 'E']);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await zoneNames(), before, 'un solo Ctrl+Z vuelve a las zonas previas');
    assert.deepEqual(errors, []);
    console.log('OK · bloqueo por solape · aplicar · un solo deshacer');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
