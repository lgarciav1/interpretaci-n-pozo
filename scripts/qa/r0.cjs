/*
 * Resistividad mojada (R0) en la pista de resistividad (F16) sobre el HTML construido (file://), a 1366 × 768, en claro y
 * oscuro. Con el pozo sintético de demostración (zona C con hidrocarburo, el resto acuífero: R0 se superpone con Rt y
 * el relleno aparece solo en C) y con los datos del TP. Comprueba que la leyenda de la pista lista R0 y que no hay
 * errores de página.
 *
 * Uso: `npm run build && node scripts/qa/r0.cjs [html] [carpeta de capturas]`
 *   html     por defecto dist/index.html
 *   carpeta  por defecto docs/capturas/r0
 * Sale con 1 si algo falla.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HTML = path.resolve(process.argv[2] || 'dist/index.html');
const OUT = path.resolve(process.argv[3] || 'docs/capturas/r0');
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];
const check = (name, ok, note = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${name}${note ? ' · ' + note : ''}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

async function open(browser, theme, scale = 1) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: scale, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  // Laterales y dock plegados y sin encabezado de pozo: el perfil ocupa el área de trabajo.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('pozo.ui.layout', JSON.stringify({ leftCollapsed: true, rightCollapsed: true, dockCollapsed: true, wellHeader: false }));
    } catch {}
  });
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${theme}: console: ${m.text()}`));
  await page.goto('file://' + HTML + '?inicio=no');
  await page.waitForFunction(() => document.querySelector('[data-testid=engine-status]')?.textContent?.includes('Listo'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}

async function loadTp(page) {
  await page.getByRole('button', { name: 'Cargar pozo' }).first().click();
  await page.getByRole('button', { name: /Cargar datos del TP/ }).click();
  await page.getByRole('button', { name: 'Siguiente: control de calidad' }).click();
  await page.getByRole('button', { name: 'Cargar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=engine-status]')?.textContent?.includes('Listo'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

async function showRange(page, top, base) {
  await page.locator('.wv-range-trigger').click();
  const dialog = page.getByRole('dialog', { name: 'Intervalo de profundidad' });
  await dialog.getByLabel('Tope').fill(String(top).replace('.', ','));
  await dialog.getByLabel('Base').fill(String(base).replace('.', ','));
  await dialog.getByRole('button', { name: 'Mostrar tramo' }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => document.querySelectorAll('.ui-toast-region, .ui-toasts, [role=status].ui-toast').forEach((e) => e.remove()));
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
}

async function legendHasR0(page) {
  return page.evaluate(() => {
    const head = document.querySelector('.wv-head[data-track-id=resistivity]');
    return head ? /R0/.test(head.textContent || '') : null;
  });
}

(async () => {
  const browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const label = theme === 'light' ? 'claro' : 'oscuro';
    {
      const { ctx, page } = await open(browser, theme);
      const has = await legendHasR0(page);
      check(`demo ${label}: la pista de resistividad lista R0`, has === true, String(has));
      await page.getByRole('button', { name: 'Ver todo el pozo', exact: true }).click();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(500);
      await shot(page, `demo-${label}-pozo-completo`);
      // Transición acuífero (B) → zona con hidrocarburo (C) → acuífero (D): ~170 m.
      await showRange(page, 7890, 7990);
      await shot(page, `demo-${label}-zona-c`);
      await ctx.close();
    }
    {
      // Detalle de la pista (×2): acuífero (B, superposición) → zona con hidrocarburo (C, relleno) → acuífero (D).
      const { ctx, page } = await open(browser, theme, 2);
      await showRange(page, 7860, 7980);
      const head = await page.locator('.wv-head[data-track-id=resistivity]').boundingBox();
      const body = await page.locator('.wv-body').boundingBox();
      await page.screenshot({ path: path.join(OUT, `demo-${label}-pista-resistividad.png`), clip: { x: head.x, y: head.y, width: head.width, height: body.y + body.height - head.y } });
      await ctx.close();
    }
    {
      const { ctx, page } = await open(browser, theme);
      await loadTp(page);
      const has = await legendHasR0(page);
      check(`TP ${label}: la pista de resistividad lista R0`, has === true, String(has));
      await page.getByRole('button', { name: 'Ver todo el pozo', exact: true }).click();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(500);
      await shot(page, `tp-${label}-pozo-completo`);
      await showRange(page, 7890, 7990);
      await shot(page, `tp-${label}-zona-c`);
      await ctx.close();
    }
  }
  await browser.close();
  check('sin errores de página', errors.length === 0, errors.slice(0, 3).join(' | '));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
