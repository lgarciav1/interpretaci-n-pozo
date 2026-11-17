/*
 * Cronómetro del recorrido (F19) sobre el HTML construido (file://): carga los datos del TP desde Inicio y comprueba
 * que el chip aparece y avanza, que abrir el paso «Sumario» lo frena (no cambia en 2 s), que deshacer no lo toca, que
 * la paleta lo oculta y lo vuelve a mostrar, que el menú del chip lo reinicia, que pasar la meta lo pone en
 * advertencia y que el informe trae la línea del tiempo. Saca capturas a 1366×768 (factor 1) en claro y oscuro.
 *
 * Para «fuera de meta» adelanta `Date.now` con un desfase (`window.__skew`), sin falsear los temporizadores.
 *
 * Uso: `npm run build && node scripts/qa/cronometro.cjs [carpeta de capturas]`. Sin carpeta no captura. Sale con 1 si
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
const shot = async (page, name, clip) => OUT && page.screenshot({ path: path.join(OUT, name + '.png'), ...(clip ? { clip } : {}) });
const CLOCK = '[data-testid=walkthrough-clock]';
const clockText = (page) => page.locator(CLOCK).locator('.shell-clock__time').innerText();
const clockAttr = (page, name) => page.locator(CLOCK).getAttribute(name);
/** Franja superior: barra de arriba + barra del flujo (+ lugar para el tooltip). */
const BAR_CLIP = { x: 0, y: 0, width: 1366, height: 210 };

async function loadTp(page) {
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
  await page.waitForFunction(() => [...document.querySelectorAll('[role=tab]')].some((t) => /Avisos\s*\d+/.test(t.textContent || '')), null, { timeout: 30000 });
  await page.waitForTimeout(800);
}

/** Ejecuta un comando de la paleta por su título exacto. */
async function runCommand(page, query, title) {
  await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.ui-cmd [role=option]');
  await page.keyboard.type(query);
  await page.waitForTimeout(250);
  const option = page.locator('.ui-cmd [role=option]').filter({ hasText: title }).first();
  if ((await option.count()) === 0) {
    await page.keyboard.press('Escape');
    return false;
  }
  await option.click();
  await page.waitForTimeout(250);
  return true;
}

async function hoverTooltip(page) {
  await page.locator(CLOCK).hover();
  await page.waitForSelector('.ui-tooltip[data-open]', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(250);
  return page.locator('.ui-tooltip[data-open]').last().innerText().catch(() => '');
}

async function newPage(browser, scheme) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, colorScheme: scheme });
  await ctx.addInitScript(() => {
    const real = Date.now.bind(Date);
    window.__skew = 0;
    Date.now = () => real() + window.__skew;
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ── Claro: recorrido completo ─────────────────────────────────────────────
    {
      const { ctx, page } = await newPage(browser, 'light');
      await page.goto(URL);
      await page.waitForSelector('[data-testid=home]');
      check('[claro] sin pozo cargado no hay cronómetro', (await page.locator(CLOCK).count()) === 0);
      await loadTp(page);
      check('[claro] al cargar el pozo aparece el chip', (await page.locator(CLOCK).count()) === 1);
      check('[claro] el chip arranca corriendo y dentro de la meta', (await clockAttr(page, 'data-state')) === 'running' && (await clockAttr(page, 'data-goal')) === 'within');
      const t0 = await clockText(page);
      await page.waitForTimeout(2200);
      const t1 = await clockText(page);
      check('[claro] el tiempo avanza', t0 !== t1 && /^\d+:\d{2}$/.test(t1), `${t0} → ${t1}`);

      // La barra no se rompe a 1366 px.
      const bar = await page.evaluate((sel) => {
        const b = document.querySelector('.shell-flowbar').getBoundingClientRect();
        const c = document.querySelector(sel).getBoundingClientRect();
        const fb = document.querySelector('.shell-flowbar');
        return { overflow: fb.scrollWidth - fb.clientWidth, right: c.right, barRight: b.right, h: b.height, ch: c.height };
      }, CLOCK);
      check('[claro] a 1366 px la barra no desborda y el chip entra', bar.overflow <= 0 && bar.right <= bar.barRight && bar.ch <= bar.h, JSON.stringify(bar));
      await shot(page, 'barra-corriendo-claro', BAR_CLIP);
      await shot(page, 'app-corriendo-claro');

      // Abrir el Sumario lo frena.
      check('[claro] la paleta abre el paso Sumario', await runCommand(page, 'Ir al paso Sumario', 'Ir al paso Sumario'));
      await page.waitForTimeout(300);
      const s0 = await clockText(page);
      check('[claro] abrir el Sumario frena el cronómetro', (await clockAttr(page, 'data-state')) === 'stopped');
      await page.waitForTimeout(2100);
      const s1 = await clockText(page);
      check('[claro] frenado: el valor no cambia en 2 s', s0 === s1, `${s0} = ${s1}`);
      check('[claro] frenó dentro de la meta', (await clockAttr(page, 'data-goal')) === 'within');
      const tip = await hoverTooltip(page);
      check('[claro] el tooltip dice qué mide, la meta y el estado', /Desde que cargaste el pozo hasta abrir el sumario/.test(tip) && /Meta: menos de 5 minutos/.test(tip) && /Frenado/.test(tip), tip.replace(/\s+/g, ' '));
      await shot(page, 'chip-frenado-tooltip-claro', BAR_CLIP);
      await page.mouse.move(600, 500);

      // Deshacer no lo toca: un cambio con deshacer (snapshot) y Ctrl+Z.
      check('[claro] guardar un snapshot (cambio con deshacer)', await runCommand(page, 'snapshot ahora', 'Guardar un snapshot ahora'));
      await page.waitForTimeout(400);
      await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(400);
      const undone = await page.locator('.ui-toast').filter({ hasText: /Se deshizo/ }).count();
      check('[claro] deshacer se aplicó', undone > 0);
      check('[claro] deshacer no toca el cronómetro', (await clockText(page)) === s0 && (await clockAttr(page, 'data-state')) === 'stopped', await clockText(page));

      // Informe con la línea del tiempo.
      await page.getByTestId('export-open').click();
      await page.getByRole('radio', { name: 'Informe' }).click().catch(async () => page.getByText('Informe', { exact: true }).first().click());
      const box = page.getByRole('checkbox', { name: 'Tiempo de interpretación' });
      check('[claro] la casilla «Tiempo de interpretación» está y viene marcada', (await box.count()) === 1 && (await box.isChecked()));
      await page.getByRole('button', { name: 'Generar informe' }).click();
      const frame = page.locator('iframe.report-preview');
      await frame.waitFor({ timeout: 60000 });
      const html = await frame.getAttribute('srcdoc');
      const line = (html.match(/Tiempo de interpretación: [^<]+/) || [''])[0];
      check('[claro] el informe trae el tiempo con la meta', /^Tiempo de interpretación: \d+ (min \d{2} )?s \(meta: menos de 5 min\)$/.test(line), line);
      await page.waitForTimeout(600);
      await shot(page, 'informe-dialogo-claro');
      // Encabezado del informe a página completa.
      const rp = await ctx.newPage();
      await rp.setContent(html, { waitUntil: 'load' });
      await shot(rp, 'informe-encabezado', { x: 0, y: 0, width: 1366, height: 420 });
      await rp.close();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Ocultar y mostrar por la paleta.
      check('[claro] la paleta ofrece ocultarlo', await runCommand(page, 'cronometro', 'Ocultar el cronómetro del recorrido'));
      check('[claro] oculto, el chip no está', (await page.locator(CLOCK).count()) === 0);
      check('[claro] la paleta ofrece mostrarlo', await runCommand(page, 'cronometro', 'Mostrar el cronómetro del recorrido'));
      check('[claro] vuelve a mostrarse con el mismo tiempo', (await page.locator(CLOCK).count()) === 1 && (await clockText(page)) === s0);
      const stored = await page.evaluate(() => localStorage.getItem('pozo.ui.walkthroughClock'));
      check('[claro] la preferencia se recuerda en localStorage', stored === 'visible', String(stored));
      await ctx.close();
    }

    // ── Oscuro: corriendo, frenado con tooltip, reinicio y fuera de meta ──────
    {
      const { ctx, page } = await newPage(browser, 'dark');
      await loadTp(page);
      await page.waitForTimeout(1200);
      check('[oscuro] el chip aparece corriendo', (await clockAttr(page, 'data-state')) === 'running');
      await shot(page, 'barra-corriendo-oscuro', BAR_CLIP);
      await shot(page, 'app-corriendo-oscuro');
      await runCommand(page, 'Ir al paso Sumario', 'Ir al paso Sumario');
      check('[oscuro] abrir el Sumario lo frena', (await clockAttr(page, 'data-state')) === 'stopped');
      await hoverTooltip(page);
      await shot(page, 'chip-frenado-tooltip-oscuro', BAR_CLIP);
      await page.mouse.move(600, 500);

      // Menú del chip: reiniciar.
      await page.locator(CLOCK).click();
      await page.getByRole('menuitem', { name: /Reiniciar desde ahora/ }).click();
      await page.waitForTimeout(300);
      check('[oscuro] «Reiniciar desde ahora» vuelve a correr desde 0', (await clockAttr(page, 'data-state')) === 'running' && /^0:0\d$/.test(await clockText(page)), await clockText(page));

      // Fuera de meta: adelantar el reloj 5 min 10 s.
      await page.evaluate(() => { window.__skew = 310_000; });
      await page.waitForTimeout(1300);
      check('[oscuro] pasada la meta, el chip queda fuera de meta', (await clockAttr(page, 'data-goal')) === 'over', await clockText(page));
      await page.mouse.move(600, 500);
      await shot(page, 'barra-fuera-de-meta-oscuro', BAR_CLIP);
      await ctx.close();
    }
    // Fuera de meta en claro, frenado (ámbar).
    {
      const { ctx, page } = await newPage(browser, 'light');
      await loadTp(page);
      await page.evaluate(() => { window.__skew = 342_000; });
      await page.waitForTimeout(1200);
      await runCommand(page, 'Ir al paso Sumario', 'Ir al paso Sumario');
      check('[claro] frenado fuera de meta', (await clockAttr(page, 'data-state')) === 'stopped' && (await clockAttr(page, 'data-goal')) === 'over', await clockText(page));
      await hoverTooltip(page);
      await shot(page, 'chip-frenado-fuera-de-meta-claro', BAR_CLIP);
      await ctx.close();
    }
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
