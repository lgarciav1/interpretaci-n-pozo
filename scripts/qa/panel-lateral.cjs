/*
 * Capturas del panel lateral (docs/decisiones/0068) sobre el HTML construido (file://), a 1366 × 768 y 1920 × 1080:
 * panel lateral con el resumen, un módulo obligatorio (histograma y crossplot) en el panel, panel plegado, disposición
 * abajo, panel agrandado y modo oscuro. Revisa además que el perfil sea alto, que ningún texto del panel quede cortado
 * (scrollWidth > clientWidth en elementos con texto y overflow oculto) y que no haya errores de página.
 *
 * Uso: `npm run build && node scripts/qa/panel-lateral.cjs [html] [carpeta] [--1920]` (por defecto solo 1366 × 768)
 * Sale con 1 si algo falla.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HTML = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dist/index.html');
const OUT = path.resolve(process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'docs/capturas/panel-lateral');
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];
const check = (name, ok, note = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${name}${note ? ' · ' + note : ''}`);
};

async function open(browser, { width, height, theme = 'light', layout = null }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  if (layout) {
    await page.addInitScript((l) => {
      try {
        localStorage.setItem('pozo.ui.layout', JSON.stringify(l));
      } catch {}
    }, layout);
  }
  page.on('pageerror', (e) => { errors.push(`${width}·${theme}: ${e.message}`); console.log('ERROR de página', e.message, (e.stack || '').split('\n').slice(0, 6).join(' | ')); });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${width}·${theme}: console: ${m.text()}`);
  });
  await page.goto('file://' + HTML + '?inicio=no');
  await page.waitForTimeout(800);
  // «Usar datos del TP» (paso Cargar del panel lateral).
  // Paso «Cargar» del flujo → «Usar datos del TP».
  await page.locator('.shell-flowbar').getByRole('button', { name: /Cargar/ }).first().click();
  await page.getByRole('button', { name: 'Usar datos del TP' }).first().click();
  await page.getByRole('button', { name: 'Siguiente: control de calidad' }).click();
  await page.getByRole('button', { name: 'Cargar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=engine-status]')?.textContent?.includes('Listo'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  // Los avisos (toasts) tapan el panel en las capturas: se ocultan con CSS (quitar sus nodos rompe React).
  await page.addStyleTag({ content: '.ui-toast-region, .ui-toasts, .ui-toast { visibility: hidden !important; }' });
  await page.mouse.move(2, 2);
  return { ctx, page };
}

async function settle(page, ms = 700) {
  await page.waitForTimeout(ms);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(150);
}

/**
 * Abre un panel del panel lateral (docs/decisiones/0069): por su pestaña fija de la barra o, si no es fija, desde el
 * menú «Más» (por el título del panel). Devuelve false si no está en ninguno de los dos.
 */
const MORE_TITLES = { 'zone-distribution': 'Distribuciones', 'formation-water': 'Agua de formación', 'rock-typing': 'Tipos de roca', preparation: 'Preparar datos', engine: 'Motor' };
async function openTab(page, id) {
  const tab = page.getByTestId(`side-tab-${id}`);
  if (await tab.count()) {
    await tab.click();
    return true;
  }
  const title = MORE_TITLES[id];
  if (!title || !(await page.getByTestId('side-more').count())) return false;
  await page.getByTestId('side-more').click();
  const item = page.getByRole('menuitem', { name: title });
  if (!(await item.count())) {
    await page.keyboard.press('Escape');
    return false;
  }
  await item.click();
  return true;
}

/** Textos cortados dentro de `root` (elementos hoja con texto, overflow oculto y contenido más ancho que la caja). */
async function clipped(page, root) {
  return page.evaluate((sel) => {
    const out = [];
    const host = document.querySelector(sel);
    if (!host) return out;
    for (const el of host.querySelectorAll('*')) {
      if (el.closest('[hidden]') || el.children.length > 0 || el.closest('.ui-visually-hidden, .ui-sr-only')) continue;
      // Recortes visualmente ocultos a propósito (nombres accesibles): clip 1 px.
      if (el.getBoundingClientRect().width <= 1) continue;
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const hides = st.overflow !== 'visible' || st.textOverflow === 'ellipsis' || st.overflowX !== 'visible';
      if (hides && el.scrollWidth > el.clientWidth + 1) out.push(`${el.className || el.tagName}: «${text.slice(0, 40)}»`);
    }
    return out;
  }, root);
}

async function viewerHeight(page) {
  return page.evaluate(() => Math.round(document.querySelector('.shell-viewer')?.getBoundingClientRect().height ?? 0));
}

async function run(browser, width, height) {
  const tag = `${width}`;
  // 1. Disposición de fábrica: panel lateral con el resumen.
  {
    const { ctx, page } = await open(browser, { width, height });
    const vh = await viewerHeight(page);
    check(`${tag}: el perfil usa la altura (${vh} px)`, vh > height * 0.7, `ventana ${height}`);
    await page.getByTestId('side-tab-glance').click();
    await settle(page, 1200);
    await page.screenshot({ path: path.join(OUT, `${tag}-resumen.png`) });
    const cut = await clipped(page, '[data-testid=side-panel]');
    check(`${tag}: resumen sin textos cortados`, cut.length === 0, cut.slice(0, 4).join(' | '));
    // Elegir una zona en los chips.
    const chip = page.locator('.glance-zones').getByRole('button', { name: 'C', exact: true });
    if (await chip.count()) {
      await chip.click();
      await settle(page, 600);
      await page.screenshot({ path: path.join(OUT, `${tag}-resumen-zona-c.png`) });
    }
    // 2. Módulos obligatorios en el panel.
    await page.getByTestId('side-tab-histogram').click();
    await settle(page, 900);
    await page.screenshot({ path: path.join(OUT, `${tag}-histograma.png`) });
    const cutH = await clipped(page, '[data-testid=side-panel]');
    check(`${tag}: histograma sin textos cortados`, cutH.length === 0, cutH.slice(0, 4).join(' | '));
    await page.getByTestId('side-tab-crossplot').click();
    await settle(page, 900);
    await page.screenshot({ path: path.join(OUT, `${tag}-crossplot.png`) });
    const cutC = await clipped(page, '[data-testid=side-panel]');
    check(`${tag}: crossplot sin textos cortados`, cutC.length === 0, cutC.slice(0, 4).join(' | '));
    for (const id of ['mdt', 'core', 'trends', 'zone-distribution', 'results']) {
      if (!(await openTab(page, id))) {
        check(`${tag}: el panel ${id} se puede abrir`, false, 'no está en la barra ni en «Más»');
        continue;
      }
      await settle(page, 500);
      // Datos del TP para ver los módulos obligatorios con datos (presiones MDT y plugs de corona).
      const load = { mdt: 'Cargar presiones del TP', core: 'Cargar corona del TP' }[id];
      if (load) {
        const b = page.getByRole('button', { name: load });
        if (await b.count()) {
          await b.first().click();
          await settle(page, 1500);
        }
      }
      await page.screenshot({ path: path.join(OUT, `${tag}-${id}.png`) });
      const c = await clipped(page, '[data-testid=side-panel]');
      check(`${tag}: ${id} sin textos cortados`, c.length === 0, c.slice(0, 4).join(' | '));
    }
    // 3. Agrandado (⤢) con el crossplot.
    await page.getByTestId('side-tab-crossplot').click();
    await settle(page, 500);
    await page.getByTestId('panel-expand').click();
    await settle(page, 900);
    await page.screenshot({ path: path.join(OUT, `${tag}-crossplot-agrandado.png`) });
    await page.keyboard.press('Escape');
    await settle(page, 300);
    check(`${tag}: Escape restaura el panel agrandado`, (await page.locator('[data-expanded]').count()) === 0);
    // 4. Plegado.
    await page.getByTestId('side-collapse').click();
    await settle(page, 700);
    await page.screenshot({ path: path.join(OUT, `${tag}-plegado.png`) });
    // 5. Disposición abajo (se recuerda al recargar).
    await page.getByTestId('side-collapse').click();
    await settle(page, 300);
    await page.getByTestId('panels-to-bottom').click();
    await settle(page, 900);
    await page.screenshot({ path: path.join(OUT, `${tag}-abajo.png`) });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pozo.ui.layout') || '{}').panels);
    check(`${tag}: la disposición abajo se guarda`, saved === 'bottom', String(saved));
    await page.getByTestId('panels-to-side').click();
    await settle(page, 300);
    await ctx.close();
  }
  // 6. Modo oscuro con el resumen.
  {
    const { ctx, page } = await open(browser, { width, height, theme: 'dark' });
    await page.getByTestId('side-tab-glance').click();
    await settle(page, 1200);
    await page.screenshot({ path: path.join(OUT, `${tag}-oscuro-resumen.png`) });
    await page.getByTestId('side-tab-histogram').click();
    await settle(page, 900);
    await page.screenshot({ path: path.join(OUT, `${tag}-oscuro-histograma.png`) });
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, 1366, 768);
    if (process.argv.includes('--1920')) await run(browser, 1920, 1080);
  } finally {
    await browser.close();
  }
  for (const e of errors) console.log('ERROR', e);
  check('sin errores de página', errors.length === 0, errors.length ? `${errors.length} errores` : '');
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} comprobaciones ok`);
  process.exit(bad.length ? 1 : 0);
})();
