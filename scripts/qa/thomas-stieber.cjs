/*
 * Prueba de punta a punta de la plantilla Thomas–Stieber (docs/decisiones/0061) sobre el HTML construido, abierto por
 * file://, con los perfiles REALES del TP y con el pozo sintético de demostración. Uso:
 * `npm run build && node scripts/qa/thomas-stieber.cjs [carpeta]` (por defecto docs/capturas/thomas-stieber). Usa el
 * Playwright y el Chromium instalados; sale con 1 si algo falla o hay errores de página.
 *
 * Flujo: cargar el pozo → Ctrl+K «plantilla Thomas–Stieber» → nube PHIT contra VSH con rectas y regiones → «Estimar de
 * los datos» → arrastrar cada extremo (rectas y resumen cambian) → deshacer → tabla por zona del módulo en Resultados
 * → capturas claro y oscuro.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const OUT = path.resolve(process.argv[2] || 'docs/capturas/thomas-stieber');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('·', ...a);
const assert = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); log('ok:', m); };

async function palette(page, text) {
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}
async function shot(page, name, target = '.shell-dock') {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  await page.locator(target).screenshot({ path: `${OUT}/${name}.png` });
  log('captura', name);
}
const summary = (page) => page.getByTestId('thomas-stieber-summary').innerText().catch(() => '');
const readouts = (page) => page.getByTestId('crossplot-template-info').locator('.plot-params').innerText();
const plotData = (page) => page.getByTestId('crossplot-plot').locator('canvas').first().evaluate((c) => c.toDataURL());
const handle = (page, id) => page.getByTestId(`xy-handle-${id}`);

async function dragVertical(page, id, dy) {
  const b = await handle(page, id).boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy / 2, { steps: 5 });
  await page.mouse.move(x, y + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}

async function exercise(page, tag) {
  await palette(page, 'plantilla Thomas');
  await page.getByTestId('crossplot-panel').waitFor({ state: 'visible' });
  await page.getByTestId('thomas-stieber').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  const n = await page.getByTestId('crossplot-count').innerText();
  log(`${tag}: ${n} puntos visibles`);
  assert(Number(n.replace(/\./g, '')) > 100, `${tag}: la nube de PHIT contra VSH tiene puntos`);
  assert(await handle(page, 'ts-sand').isVisible() && await handle(page, 'ts-shale').isVisible(), `${tag}: los dos extremos son manijas`);
  const s0 = await summary(page);
  log(`${tag}: resumen inicial «${s0}»`);
  await shot(page, `${tag}-claro-inicial`);

  // Estimar de los datos.
  const est = page.getByTestId('thomas-stieber').getByRole('button');
  const problem = await page.getByTestId('thomas-stieber-problem').innerText().catch(() => null);
  if (problem) {
    log(`${tag}: no se puede estimar → ${problem}`);
  } else {
    log(`${tag}: propuesta → ${(await page.getByTestId('thomas-stieber').locator('.plot-hint').first().innerText()).replace(/\s+/g, ' ')}`);
    if (await est.isEnabled()) {
      await est.click();
      await page.waitForTimeout(1200);
      log(`${tag}: tras estimar → ${(await readouts(page)).replace(/\s+/g, ' ')}`);
      log(`${tag}: resumen «${await summary(page)}»`);
      assert(/coinciden/.test(await est.innerText()), `${tag}: tras estimar, el botón dice que los extremos coinciden con los datos`);
    }
  }
  await shot(page, `${tag}-claro-estimado`);
  const r1 = await readouts(page);
  const s1 = await summary(page);
  const img1 = await plotData(page);
  const box1 = await handle(page, 'ts-shale').boundingBox();

  // Arrastrar el extremo de la arena hacia arriba y el de la lutita hacia abajo.
  await dragVertical(page, 'ts-sand', -40);
  const r2 = await readouts(page);
  assert(r2 !== r1, `${tag}: arrastrar la arena cambia φ arena (${r2.split('\n').slice(0, 2).join(' ')})`);
  await dragVertical(page, 'ts-shale', 25);
  const r3 = await readouts(page);
  const s3 = await summary(page);
  assert(r3 !== r2, `${tag}: arrastrar la lutita cambia φ lutita`);
  assert((await plotData(page)) !== img1, `${tag}: las rectas se redibujan`);
  log(`${tag}: resumen tras arrastrar «${s3}» (antes «${s1}»)`);
  assert(s3 !== s1 || r3 !== r1, `${tag}: el resumen o las lecturas cambian`);
  await shot(page, `${tag}-claro-arrastrado`);

  // Deshacer: un Ctrl+Z por gesto.
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(800);
  assert((await readouts(page)) === r2, `${tag}: un Ctrl+Z deshace el arrastre de la lutita entero`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(800);
  assert((await readouts(page)) === r1, `${tag}: otro Ctrl+Z deshace el de la arena`);
  const box2 = await handle(page, 'ts-shale').boundingBox();
  assert(Math.abs(box2.y - box1.y) < 1.5, `${tag}: tras deshacer, la manija de la lutita vuelve a su lugar (${box1.y.toFixed(1)} → ${box2.y.toFixed(1)} px)`);
  return { s1, r1 };
}

async function resultsTable(page, tag) {
  await page.getByRole('tab', { name: /Resultados/ }).click();
  await page.waitForTimeout(800);
  const t = page.locator('table', { hasText: 'Dispersa (%)' }).first();
  await t.scrollIntoViewIfNeeded().catch(() => {});
  if (await t.count()) {
    log(`${tag}: tabla por zona\n${(await t.innerText()).replace(/\t/g, ' | ')}`);
    await t.screenshot({ path: `${OUT}/${tag}-tabla.png` });
  } else {
    log(`${tag}: la tabla no está a la vista en Resultados`);
  }
  return t.count();
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  // Estas comprobaciones recorren el dock de abajo: se fija esa disposición (la de fábrica es el panel lateral,
  // docs/decisiones/0068, y la columna del pozo arranca plegada en ventanas angostas, 0069).
  await ctx.addInitScript(() => {
    try {
      if (localStorage.getItem('pozo.ui.layout') === null) {
        localStorage.setItem('pozo.ui.layout.v', '2');
        localStorage.setItem('pozo.ui.layout', JSON.stringify({ panels: 'bottom', leftCollapsed: false }));
      }
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + ROOT + '/dist/index.html?inicio=no');
  await page.waitForTimeout(1500);
  try {
    // 1. Pozo sintético de demostración (el que abre la app).
    await palette(page, 'Ocultar la columna del pozo');
    await palette(page, 'Ocultar el panel del paso');
    await page.getByRole('separator', { name: 'Alto de los paneles' }).focus().catch(() => {});
    await page.keyboard.press('End').catch(() => {});
    await exercise(page, 'sintetico');

    // 2. Datos reales del TP: Cargar pozo → Cargar datos del TP → asistente de 3 pasos.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Cargar pozo' }).first().click();
    await page.getByRole('button', { name: /Cargar datos del TP/ }).click({ timeout: 30000 });
    await page.getByRole('button', { name: 'Siguiente: control de calidad' }).click({ timeout: 30000 });
    await page.getByRole('button', { name: 'Cargar', exact: true }).click();
    await page.waitForTimeout(3000);
    await exercise(page, 'tp');
    // Estimar y dejarlo para la tabla por zona.
    const est = page.getByTestId('thomas-stieber').getByRole('button');
    if (await est.isEnabled()) { await est.click(); await page.waitForTimeout(1200); }
    await shot(page, 'tp-claro-final');
    // Por zona: filtrar cada zona y leer el resumen con los extremos globales.
    for (const z of ['A', 'B', 'C', 'D', 'E']) {
      const chip = page.getByTestId('crossplot-panel').getByRole('group').first().getByRole('button', { name: z, exact: true });
      if (!(await chip.count())) continue;
      await chip.click();
      await page.waitForTimeout(700);
      log(`tp zona ${z}: «${await summary(page)}» · ${(await readouts(page)).replace(/\s+/g, ' ')}`);
      await chip.click();
      await page.waitForTimeout(400);
    }
    // 3. Oscuro.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(800);
    await shot(page, 'tp-oscuro-final');
    await page.getByTestId('crossplot-plot').screenshot({ path: `${OUT}/tp-oscuro-grafico.png` });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(600);
    await page.getByTestId('crossplot-plot').screenshot({ path: `${OUT}/tp-claro-grafico.png` });
    await resultsTable(page, 'tp');
    assert(errors.length === 0, `sin errores de página (${errors.join(' | ')})`);
  } catch (e) {
    await page.screenshot({ path: `${OUT}/_fallo.png` }).catch(() => {});
    console.error(e.message, errors);
    await browser.close();
    process.exit(1);
  }
  await browser.close();
})();
