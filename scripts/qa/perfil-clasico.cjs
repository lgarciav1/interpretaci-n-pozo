/*
 * Capturas del perfil clásico (docs/decisiones/0067) sobre un HTML construido (file://), a 1366 × 768: pozo completo,
 * ~1:1000 y ~1:200 en la transición B/C del pozo del TP, modo oscuro y (si existe) el menú contextual del perfil.
 * Revisa además que ningún título de pista quede cortado (scrollWidth > clientWidth) y que no haya errores de página.
 *
 * Uso: `npm run build && node scripts/qa/perfil-clasico.cjs [html] [carpeta] [prefijo]`
 *   html     por defecto dist/index.html
 *   carpeta  por defecto docs/capturas/perfil-clasico
 *   prefijo  por defecto «despues» (para el build anterior, «antes»)
 * Sale con 1 si algo falla.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const HTML = path.resolve(process.argv[2] || 'dist/index.html');
const OUT = path.resolve(process.argv[3] || 'docs/capturas/perfil-clasico');
const PREFIX = process.argv[4] || 'despues';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];
const check = (name, ok, note = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${name}${note ? ' · ' + note : ''}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}.png`) });

/** px CSS por metro de una escala 1:N a 96 ppp (la misma cuenta del visor). */
const pxPerM = (n) => 96000 / (25.4 * n);

async function open(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  // Laterales y dock plegados y sin encabezado de pozo: el perfil ocupa el área de trabajo (como en lectura).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('pozo.ui.layout', JSON.stringify({ leftCollapsed: true, rightCollapsed: true, dockCollapsed: true, wellHeader: false }));
    } catch {}
  });
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${theme}: console: ${m.text()}`);
  });
  await page.goto('file://' + HTML + '?inicio=no');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Cargar pozo' }).first().click();
  await page.getByRole('button', { name: /Cargar datos del TP/ }).click();
  await page.getByRole('button', { name: 'Siguiente: control de calidad' }).click();
  await page.getByRole('button', { name: 'Cargar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=engine-status]')?.textContent?.includes('Listo'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  // Los avisos (toasts) tapan el perfil en las capturas.
  await page.evaluate(() => document.querySelectorAll('.ui-toast-region, .ui-toasts, [role=status].ui-toast').forEach((e) => e.remove()));
  await page.mouse.move(2, 2);
  return { ctx, page };
}

/** Muestra un tramo con el diálogo de intervalo (existe en los dos builds). */
async function showRange(page, top, base) {
  await page.locator('.wv-range-trigger').click();
  const dialog = page.getByRole('dialog', { name: 'Intervalo de profundidad' });
  await dialog.getByLabel('Tope').fill(String(top).replace('.', ','));
  await dialog.getByLabel('Base').fill(String(base).replace('.', ','));
  await dialog.getByRole('button', { name: 'Mostrar tramo' }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
}

/** Tramo de la escala 1:N centrado en `center` (m), con el alto real del cuerpo del visor. */
async function showScale(page, n, center) {
  const h = await page.evaluate(() => document.querySelector('.wv-body').getBoundingClientRect().height);
  const span = h / pxPerM(n);
  await showRange(page, +(center - span / 2).toFixed(2), +(center + span / 2).toFixed(2));
}

async function headerChecks(page, label) {
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('.wv-head__title, .ui-curve-legend__name, .ui-curve-legend__unit, .ui-curve-legend__lo, .ui-curve-legend__hi, .wv-head__overflow, .ui-curve-legend__tag, .wv-stack-item__label, .ui-curve-legend__value')]
      .filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1)
      .map((e) => e.textContent),
  );
  check(`${label}: ningún texto de encabezado cortado`, cut.length === 0, cut.slice(0, 6).join(' | '));
  const scale = await page.evaluate(() => document.querySelector('.wv-toolbar__scale, .wv-scale-btn')?.textContent?.trim());
  return scale;
}

(async () => {
  const browser = await chromium.launch();
  {
    const { ctx, page } = await open(browser, 'light');
    await page.getByRole('button', { name: 'Ver todo el pozo', exact: true }).click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(500);
    check('pozo completo', true, await headerChecks(page, 'pozo completo'));
    await shot(page, '1-pozo-completo');
    await showScale(page, 1000, 7930);
    check('~1:1000', true, await headerChecks(page, '1:1000'));
    await shot(page, '2-escala-1000');
    await showScale(page, 200, 7906);
    check('~1:200', true, await headerChecks(page, '1:200'));
    await shot(page, '3-escala-200');
    // Con el cursor sobre el perfil, las lecturas ocupan los encabezados: tampoco se corta nada.
    {
      const b = await page.locator('.wv-body').boundingBox();
      await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5);
      await page.waitForTimeout(300);
      await headerChecks(page, '1:200 con lecturas');
      await shot(page, '3b-escala-200-lecturas');
      await page.mouse.move(2, 2);
    }

    // Menú contextual (solo el build nuevo): clic derecho sobre la pista de resistividad.
    const body = await page.locator('.wv-body').boundingBox();
    const res = await page.locator('.wv-head[data-track-id=resistivity]').boundingBox();
    if (res && body) {
      await page.mouse.move(res.x + res.width * 0.5, body.y + body.height * 0.45);
      await page.waitForTimeout(150);
      await page.mouse.click(res.x + res.width * 0.5, body.y + body.height * 0.45, { button: 'right' });
      await page.waitForTimeout(400);
      const menu = page.getByRole('menu', { name: /Perfil/ });
      if (await menu.isVisible().catch(() => false)) {
        const items = await menu.getByRole('menuitem').allInnerTexts();
        check('menú contextual: copiar, tope, editar, medir y exportar', ['Copiar', 'tope', 'Editar', 'Medir', 'PNG'].every((w) => items.some((t) => t.includes(w))), items.join(' | '));
        await shot(page, '5-menu-contextual');
        // Teclado: la primera opción tiene el foco y Escape lo cierra.
        const focused = await page.evaluate(() => document.activeElement?.getAttribute('role'));
        check('menú contextual: el foco queda en una opción', focused === 'menuitem', focused);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        check('menú contextual: Escape lo cierra', !(await menu.isVisible().catch(() => false)));
        // Medir un intervalo arrastrando.
        await page.mouse.click(res.x + res.width * 0.5, body.y + body.height * 0.3, { button: 'right' });
        await page.waitForTimeout(300);
        await page.getByRole('menuitem', { name: /Medir/ }).click();
        await page.mouse.move(res.x + res.width * 0.5, body.y + body.height * 0.3);
        await page.mouse.down();
        await page.mouse.move(res.x + res.width * 0.55, body.y + body.height * 0.62, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        await shot(page, '6-medir');
      } else if (PREFIX !== 'antes') check('menú contextual visible', false);
    }
    // Geología (pilas de mineralogía con tramas, módulos con pista propia): tampoco se corta nada.
    await page.getByText('Geología', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await showScale(page, 500, 8070);
    await headerChecks(page, 'Geología 1:500');
    await shot(page, '7-geologia-500');
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, 'dark');
    await showScale(page, 1000, 7930);
    check('oscuro ~1:1000', true, await headerChecks(page, 'oscuro'));
    await shot(page, '4-oscuro-1000');
    await ctx.close();
  }
  await browser.close();
  if (errors.length) console.log('Errores de página:\n' + errors.join('\n'));
  check('sin errores de página', errors.length === 0);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
