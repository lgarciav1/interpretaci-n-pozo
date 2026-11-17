/*
 * Estado «revisado» por paso (docs/decisiones/0073) sobre el HTML construido (file://): carga los datos del TP desde
 * Inicio y comprueba que ningún paso de módulos figura revisado, que el contador dice «N calculados · M revisados», que
 * mover un slider de Cutoffs marca ese paso y que deshacer lo vuelve a «valores de fábrica».
 * Saca capturas a 1366×768 en claro y oscuro.
 *
 * Uso: `npm run build && node scripts/qa/revisado.cjs [carpeta de capturas]`. Sin carpeta no captura. Sale con 1 si
 * algo falla.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const URL = 'file://' + path.resolve('dist/index.html');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const results = [];
const errors = [];
function check(name, ok, note = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${name}${note ? ' · ' + note : ''}`);
}
const shot = async (page, name) => OUT && page.screenshot({ path: path.join(OUT, name + '.png') });

const MODULE_STEPS = ['Arcilla', 'Porosidad', 'Rw', 'Saturación', 'Permeabilidad', 'Cutoffs', 'Sumario', 'Volumen'];
/** aria-label de cada paso de la barra, por rótulo. */
const steps = (page) =>
  page.$$eval('.shell-flowbar .ui-step__button', (els) =>
    Object.fromEntries(els.map((e) => [(e.querySelector('.ui-step__full') || e.querySelector('.ui-step__label'))?.textContent?.trim(), e.getAttribute('aria-label')])),
  );
const counter = (page) => page.locator('.shell-flowbar__progress').getAttribute('aria-label');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  try {
    await page.goto(URL);
    await page.waitForSelector('[data-testid=home]');
    await page.getByTestId('home-load').click();
    await page.getByRole('button', { name: 'Cargar datos del TP' }).click();
    await page.getByRole('button', { name: /Siguiente: control de calidad/ }).click();
    await page.getByRole('button', { name: 'Cargar', exact: true }).click();
    await page.waitForSelector('[data-testid=home-enter]');
    await page.getByTestId('home-enter').click();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=home]', { state: 'detached' });
    await page.waitForFunction(() => /11 pasos calculados/.test(document.querySelector('.shell-flowbar__progress')?.getAttribute('aria-label') || ''), null, { timeout: 30000 });

    const s0 = await steps(page);
    const c0 = await counter(page);
    console.log('      contador: ' + c0 + ' · visible: ' + (await page.locator('.shell-flowbar__progress').innerText()).replace(/\s+/g, ' '));
    check('recién cargado: ningún paso de módulos revisado', MODULE_STEPS.every((l) => /valores de fábrica/.test(s0[l] || '')), MODULE_STEPS.map((l) => `${l}: ${(s0[l] || '').split(', ').slice(-1)}`).join(' | '));
    check('el contador dice calculados y revisados', /11 pasos calculados y 2 revisados/.test(c0 || ''), c0);
    const rings = await page.locator('.shell-flowbar .ui-step.is-unreviewed').count();
    check('los pasos sin revisar se dibujan en anillo', rings === MODULE_STEPS.length + 1, `${rings} (pasos de módulos y Zonas, que solo se revisa con la marca)`);

    // Abrir Cutoffs y mover su primer slider.
    await page.locator('.shell-flowbar .ui-step__button', { hasText: 'Cutoffs' }).click();
    await page.waitForTimeout(400);
    const slider = page.locator('input[type=range]').first();
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    const s1 = await steps(page);
    const c1 = await counter(page);
    check('mover un slider de Cutoffs marca ese paso', /, revisado$/.test(s1['Cutoffs'] || ''), s1['Cutoffs']);
    check('el contador sube', /\b[3-9] revisados/.test(c1 || ''), c1);
    const review = await page.locator('.inspector-head__review').first().innerText().catch(() => '');
    check('el Inspector dice por qué', /Revisado: cambiaste/.test(review), review);
    await page.locator('.shell-flowbar .ui-step__button', { hasText: 'Cutoffs' }).hover();
    await page.waitForTimeout(500);
    await shot(page, 'revisado-claro');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await shot(page, 'revisado-oscuro');

    // Deshacer (las dos flechas del slider son un solo paso del historial): vuelve a valores de fábrica.
    await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    const s2 = await steps(page);
    check('deshacer lo vuelve a valores de fábrica', /valores de fábrica/.test(s2['Cutoffs'] || ''), s2['Cutoffs']);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(400);
    await shot(page, 'recien-cargado-claro');
  } catch (e) {
    check('el recorrido terminó sin excepción', false, e.message);
  } finally {
    await browser.close();
  }
  const relevant = errors.filter((e) => !/favicon/i.test(e));
  check('sin errores en la consola', relevant.length === 0, relevant.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones ok`);
  process.exit(failed ? 1 : 0);
})();
