/*
 * Pantalla de Inicio y entrada al pozo (docs/decisiones/0065) sobre el HTML construido (file://). Verifica y captura:
 * Inicio sin pozo y con pozo (claro y oscuro), selección de una herramienta sin tocar el proyecto, giro y arrastre,
 * coherencia con el configurador, la entrada al pozo cuadro a cuadro (reloj de Playwright), saltar, Escape, movimiento
 * reducido, volver a Inicio sin perder el visor, la alternativa sin WebGL, la pérdida del contexto, pestaña oculta sin
 * bucle, notebook y pantalla angosta, y errores de consola.
 *
 * Uso: `npm run build && node scripts/qa/inicio.cjs [carpeta]` (por defecto docs/capturas/inicio). Sale con 1 si algo
 * falla. WebGL corre en SwiftShader (por CPU): los tiempos de cuadro no representan una GPU.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const URL = 'file://' + ROOT + '/dist/index.html';
const OUT = path.resolve(process.argv[2] || 'docs/capturas/inicio');
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const results = [];
const errors = [];
function check(name, ok, note = '') {
  results.push({ name, ok: !!ok, note });
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${name}${note ? ' · ' + note : ''}`);
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

async function open(browser, { theme = 'light', width = 1440, height = 900, reduced = false, noWebGL = false, clock = false, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}/${width}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${theme}/${width}: console: ${m.text()}`);
  });
  if (noWebGL) {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/.test(String(type)) ? null : orig.call(this, type, ...rest);
      };
    });
  }
  // Cuenta los pedidos de cuadro (para ver que no queda un bucle oculto).
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__raf = 0;
    window.requestAnimationFrame = (cb) => {
      window.__raf++;
      return raf(cb);
    };
  });
  if (clock) await page.clock.install();
  await page.goto(URL + query);
  await page.waitForSelector('[data-testid=home]', { timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

/** Clic y espera al cierre de Inicio, medido en la página (las acciones de Playwright tardan con SwiftShader). */
async function timedClose(page, act) {
  await page.evaluate(() => {
    window.__t0 = performance.now();
    window.__closedAt = null;
    const mo = new MutationObserver(() => {
      if (!document.querySelector('[data-testid=home]')) {
        window.__closedAt = performance.now();
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
  await act();
  await page.waitForFunction(() => window.__closedAt !== null, null, { timeout: 8000 });
  return Math.round(await page.evaluate(() => window.__closedAt - window.__t0));
}
const phase = (page) => page.evaluate(() => document.querySelector('[data-testid=home]')?.getAttribute('data-phase') ?? 'closed');
const undoLabel = (page) => page.getByTestId('undo').getAttribute('aria-label');
const canvases = (page) => page.evaluate(() => document.querySelectorAll('canvas.ts3d__canvas').length);
const chips = (page) => page.locator('.home__chip').allInnerTexts();
async function loadDemo(page) {
  await page.getByTestId('home-demo').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=engine-status]')?.textContent?.includes('Listo'), null, { timeout: 60000 });
  await page.waitForSelector('[data-testid=home-enter]');
  // SwiftShader comparte la CPU con el motor recién terminado: unos segundos para que la escena vuelva a su ritmo.
  await page.waitForTimeout(4000);
}
async function rafRate(page, ms = 1500) {
  const a = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(ms);
  const b = await page.evaluate(() => window.__raf);
  return ((b - a) * 1000) / ms;
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });

  // ── 1. Sin pozo, claro y oscuro ──────────────────────────────────────────────────────────────────────────────
  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await open(browser, { theme });
    const t = await page.getByTestId('home').innerText();
    check(`sin pozo (${theme}): acciones y composición rotulada`, (await page.getByTestId('home-load').isVisible()) && t.includes('Abrir proyecto') && t.includes('Ver demostración') && t.includes('Composición de demostración') && !t.includes('Entrar al pozo'));
    check(`sin pozo (${theme}): escena 3D montada`, (await canvases(page)) === 1);
    await shot(page, `inicio-sin-pozo-${theme === 'light' ? 'claro' : 'oscuro'}`);
    await ctx.close();
  }

  // ── 2. Con pozo: demo por el flujo existente, selección sin tocar el proyecto, arrastre, configurador ─────────
  {
    const { ctx, page } = await open(browser);
    await loadDemo(page);
    const t = await page.getByTestId('home').innerText();
    check('con pozo: «Entrar al pozo» y secundarias', t.includes('Entrar al pozo') && t.includes('Cargar otro pozo') && t.includes('Abrir proyecto') && t.includes('Explorar sarta'));
    check('con pozo: la sarta es la del pozo (no la de demostración)', t.includes('Sarta de Pozo sintético') && !t.includes('Composición de demostración'));
    check('con pozo: el espacio de trabajo está inerte debajo', await page.evaluate(() => document.querySelector('.shell')?.hasAttribute('inert')));
    const idle = await rafRate(page);
    check('reposo: hay giro automático (bucle activo)', idle > 2, `${idle.toFixed(1)} cuadros/s con SwiftShader`);
    await shot(page, 'inicio-con-pozo-claro');
    const undo0 = await undoLabel(page);
    await page.locator('.home__chip', { hasText: 'DEN' }).click();
    await page.waitForTimeout(800);
    const card = page.getByTestId('home-card');
    const ct = (await card.isVisible()) ? await card.innerText() : '';
    check('selección: ficha breve con nombre, qué mide y curvas', ct.includes('Densidad') && /curvas en este pozo/i.test(ct) && /ZDEN/.test(ct));
    await shot(page, 'inicio-herramienta-seleccionada');
    // Arrastrar sobre la escena: el giro se detiene y la cámara se mueve.
    const box = await page.getByTestId('home-stage').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.3, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    check('arrastre: detiene el giro automático', await page.evaluate(() => document.querySelector('[data-testid=home]')?.classList.contains('is-interacted')));
    const after = await rafRate(page);
    check('arrastre: sin bucle después del gesto', after < 2, `${after.toFixed(1)} cuadros/s`);
    check('selección y giro: el proyecto no cambió (historial intacto)', (await undoLabel(page)) === undo0, undo0);
    // Pestaña oculta: el renderizador para su bucle.
    await page.locator('.home__chip', { hasText: 'DEN' }).click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = await rafRate(page);
    check('pestaña oculta: sin cuadros pedidos', hidden < 1, `${hidden.toFixed(1)} cuadros/s`);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Explorar sarta → el configurador con la misma sarta y la selección.
    const homeChips = await chips(page);
    await page.locator('.home__chip', { hasText: 'NEU' }).click();
    await page.getByTestId('home-explore').click();
    await page.waitForTimeout(1500);
    const rows = await page.locator('.ts-row .ts-row__main').allInnerTexts();
    const shorts = rows.map((r) => r.split('\n')[0].trim());
    check('explorar: abre el configurador con la misma sarta', (await phase(page)) === 'closed' && shorts.join(',') === homeChips.join(','), `${homeChips.join(' ')} | ${shorts.join(' ')}`);
    check('explorar: conserva la herramienta elegida', (await page.locator('.ts-row.is-selected').innerText()).includes('Neutrón'));
    check('explorar: una sola vista 3D a la vez', (await canvases(page)) === 1);
    await ctx.close();
  }

  // ── 3. Entrada al pozo cuadro a cuadro (reloj manual), claro y oscuro ─────────────────────────────────────────
  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await open(browser, { theme, clock: true });
    await loadDemo(page);
    await page.clock.pauseAt(Date.now() + 1000);
    await page.waitForTimeout(400);
    await page.getByTestId('home-enter').click();
    const steps = [350, 800, 1150, 1600, 2190];
    let prev = 0;
    const tag = theme === 'light' ? 'claro' : 'oscuro';
    for (let i = 0; i < steps.length; i++) {
      await page.clock.runFor(steps[i] - prev);
      prev = steps[i];
      await page.waitForTimeout(350);
      if (i === 0) check(`entrada (${theme}): «Saltar animación» visible`, await page.getByTestId('home-skip').isVisible());
      // Secuencia completa en claro; en oscuro, el corte final (las capturas pesan).
      if (theme === 'light' || i === steps.length - 1) await shot(page, `entrada-${tag}-${i + 1}`);
    }
    await page.clock.resume();
    await page.waitForFunction(() => !document.querySelector('[data-testid=home]'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    check(`entrada (${theme}): termina en el espacio de trabajo`, (await phase(page)) === 'closed');
    check(`entrada (${theme}): sin lienzo de Inicio ni capa inerte`, (await canvases(page)) === 0 && !(await page.evaluate(() => document.querySelector('.shell')?.hasAttribute('inert'))));
    await shot(page, `entrada-${tag}-6-visor`);
    await ctx.close();
  }

  // ── 4. Saltar, Escape, segunda entrada breve, volver a Inicio sin perder el visor ─────────────────────────────
  {
    const { ctx, page } = await open(browser);
    await loadDemo(page);
    await page.getByTestId('home-enter').click();
    await page.waitForTimeout(300);
    const tSkip = await timedClose(page, () => page.evaluate(() => document.querySelector('[data-testid=home-skip]').click()));
    check('saltar: entra al espacio de trabajo en el acto', tSkip < 400, `${tSkip} ms desde el clic`);
    // El visor sigue usable: zoom.
    await page.getByRole('button', { name: 'Acercar' }).click();
    await page.getByRole('button', { name: 'Acercar' }).click();
    await page.waitForTimeout(300);
    const scale = await page.locator('.wv-toolbar__scale').innerText();
    const undo0 = await undoLabel(page);
    await page.getByTestId('open-home').click();
    await page.waitForTimeout(900);
    check('volver a Inicio: aparece con la sarta del pozo', (await phase(page)) === 'open' && (await page.getByTestId('home').innerText()).includes('Entrar al pozo'));
    // Segunda entrada: breve.
    const dt = await timedClose(page, () => page.evaluate(() => document.querySelector('[data-testid=home-enter]').click()));
    // 0,7 s de recorrido + 0,24 s de fundido; con SwiftShader cada cuadro con la formación tarda cientos de ms.
    check('segunda entrada: breve', dt < 2600, `${dt} ms desde el clic (0,94 s nominales)`);
    check('volver: el visor conserva zoom y escala', (await page.locator('.wv-toolbar__scale').innerText()) === scale, scale);
    check('volver: el proyecto no cambió', (await undoLabel(page)) === undo0);
    // Escape en Inicio (en reposo, sin ficha) entra directo.
    await page.getByTestId('open-home').click();
    await page.waitForTimeout(700);
    const tEsc = await timedClose(page, () => page.keyboard.press('Escape'));
    check('Escape: entra directo al espacio de trabajo', tEsc < 400, `${tEsc} ms`);
    // Escape durante la entrada.
    await page.getByTestId('open-home').click();
    await page.waitForTimeout(700);
    await page.getByTestId('home-enter').click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=home]'), null, { timeout: 3000 });
    check('Escape durante la entrada: la salta', true);
    // Doble clic: una sola entrada.
    await page.getByTestId('open-home').click();
    await page.waitForTimeout(700);
    await page.getByTestId('home-enter').dblclick({ force: true }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('[data-testid=home]'), null, { timeout: 8000 });
    check('clics repetidos: no superponen transiciones', (await phase(page)) === 'closed' && (await canvases(page)) === 0);
    const idle = await rafRate(page);
    check('espacio de trabajo: sin bucle oculto de Inicio', idle < 2, `${idle.toFixed(1)} cuadros/s pedidos en reposo`);
    await ctx.close();
  }

  // ── 5. Movimiento reducido ────────────────────────────────────────────────────────────────────────────────────
  {
    const { ctx, page } = await open(browser, { reduced: true });
    const idle = await rafRate(page);
    check('movimiento reducido: sin giro automático', idle < 2, `${idle.toFixed(1)} cuadros/s`);
    await loadDemo(page);
    const tRm = await timedClose(page, () => page.evaluate(() => document.querySelector('[data-testid=home-enter]').click()));
    check('movimiento reducido: entra sin recorrido de cámara', tRm < 500, `${tRm} ms desde el clic (fundido de 0,14 s)`);
    await ctx.close();
  }

  // ── 6. Sin WebGL y con el contexto perdido ────────────────────────────────────────────────────────────────────
  {
    const { ctx, page } = await open(browser, { noWebGL: true });
    check('sin WebGL: esquema estático y aviso', (await page.locator('.home-sil').count()) === 1 && (await page.getByTestId('home').innerText()).includes('WebGL 2 no está disponible'));
    await loadDemo(page);
    await page.locator('.home-sil__piece.is-tool').nth(1).click();
    await page.waitForTimeout(300);
    check('sin WebGL: el esquema selecciona y abre la ficha', await page.getByTestId('home-card').isVisible());
    await shot(page, 'inicio-sin-webgl-con-pozo');
    await page.getByTestId('home-enter').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=home]'), null, { timeout: 3000 });
    check('sin WebGL: «Entrar al pozo» funciona', (await phase(page)) === 'closed');
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser);
    await loadDemo(page);
    await page.evaluate(() => document.querySelector('canvas.ts3d__canvas')?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
    await page.waitForTimeout(800);
    check('contexto perdido: pasa al esquema y libera el lienzo', (await page.locator('.home-sil').count()) === 1 && (await canvases(page)) === 0);
    await page.getByTestId('home-enter').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=home]'), null, { timeout: 3000 });
    check('contexto perdido: «Entrar al pozo» funciona', (await phase(page)) === 'closed');
    await ctx.close();
  }

  // ── 7. Notebook y pantalla angosta ────────────────────────────────────────────────────────────────────────────
  for (const [w, h, name] of [
    [1366, 768, 'notebook'],
    [390, 844, 'angosta'],
  ]) {
    for (const theme of ['light', 'dark']) {
      const { ctx, page } = await open(browser, { width: w, height: h, theme });
      await loadDemo(page);
      // Solo Inicio: el espacio de trabajo debajo tiene su propio ancho mínimo (anterior a esta pantalla).
      const overflow = await page.evaluate(() => [...document.querySelectorAll('[data-testid=home] *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1); }).map((el) => el.className).slice(0, 3));
      check(`${name} (${theme}): Inicio sin desborde horizontal`, overflow.length === 0, overflow.join(' '));
      const enter = await page.getByTestId('home-enter').boundingBox();
      check(`${name} (${theme}): acción principal a la vista`, enter && enter.y + enter.height <= h + (w < 500 ? 400 : 0));
      await shot(page, `inicio-${name}-${theme === 'light' ? 'claro' : 'oscuro'}`);
      await ctx.close();
    }
  }

  // ── 8. Arranque de los scripts de QA: `?inicio=no` sigue entrando al espacio de trabajo ───────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(URL + '?inicio=no');
    await page.waitForSelector('[data-testid=open-tool-string]', { timeout: 20000 });
    check('?inicio=no: arranca en el espacio de trabajo con la demo', (await phase(page)) === 'closed');
    await ctx.close();
  }

  await browser.close();
  check('sin errores de consola ni de página', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verificaciones ok. Capturas en ${path.relative(ROOT, OUT)}`);
  process.exit(failed.length ? 1 : 0);
})();
