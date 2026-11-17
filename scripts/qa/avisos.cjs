/*
 * Panel Avisos agrupado y navegable (docs/decisiones/0072) sobre el HTML construido (file://): carga los datos del TP
 * desde Inicio, abre la pestaña «Avisos» y comprueba grupos por paso con contador, filtros por gravedad, que el chip de
 * zona lleva el visor a la zona, que el nombre del módulo abre su paso, y que «visto» atenúa el aviso, baja la insignia y se puede deshacer.
 * Saca capturas a 1366×768 en claro y oscuro.
 *
 * Uso: `npm run build && node scripts/qa/avisos.cjs [carpeta de capturas]`. Sin carpeta no captura. Sale con 1 si algo
 * falla.
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

/** Centro de la vista del visor (m), leído de la minimapa. */
const viewCenter = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[aria-valuetext^="Vista de"]');
    return el ? Number(el.getAttribute('aria-valuenow')) : NaN;
  });
const badge = (page) =>
  page.evaluate(() => {
    const tab = [...document.querySelectorAll('[role=tab]')].find((t) => /Avisos/.test(t.textContent || ''));
    const m = tab && (tab.textContent || '').match(/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
  });

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

    await page.getByRole('tab', { name: /Avisos/ }).click();
    await page.waitForSelector('[data-testid^=diag-group-]', { timeout: 20000 });
    await page.waitForTimeout(800);

    const groups = await page.$$eval('[data-testid^=diag-group-]', (els) =>
      els.map((e) => ({ id: e.getAttribute('data-testid').replace('diag-group-', ''), open: e.classList.contains('is-open'), title: e.querySelector('.ui-section__title')?.textContent, count: Number(e.querySelector('.diag-group__meta .num')?.textContent) })),
    );
    console.log('      grupos: ' + groups.map((g) => `${g.title} ${g.count}${g.open ? '' : ' (plegado)'}`).join(' · '));
    const total = groups.reduce((n, g) => n + g.count, 0);
    check('hay grupos por paso con contador', groups.length >= 3 && groups.every((g) => g.count > 0), `${groups.length} grupos, ${total} avisos`);
    const ids = groups.map((g) => g.id);
    check('«Otros módulos» va al final', !ids.includes('other') || ids.at(-1) === 'other');
    check('con más de 10 avisos, los grupos sin errores arrancan plegados', total <= 10 || groups.some((g) => !g.open));
    const b0 = await badge(page);
    check('la insignia cuenta todos (ninguno visto todavía)', b0 === total, `${b0}`);
    const levels = await page.$$eval('[data-testid^=diag-filter-]', (els) => els.map((e) => e.textContent));
    check('fichas de filtro por gravedad con contador', levels.length === 3, levels.join(' | '));
    await shot(page, 'avisos-claro');

    // Desplegar el grupo Rw (avisos por zona).
    const target = groups.find((g) => g.id === 'rw') || groups.find((g) => !g.open) || groups[0];
    const group = page.getByTestId(`diag-group-${target.id}`);
    if (!target.open) await group.locator('.ui-section__toggle').click();
    const zoneChip = group.getByTestId('diag-zone').first();
    check('un aviso por zona muestra el chip de zona', (await zoneChip.count()) > 0);
    const zoneText = await zoneChip.innerText();
    const before = await viewCenter(page);
    await zoneChip.locator('button').click();
    await page.waitForTimeout(800);
    const after = await viewCenter(page);
    check('clic en la zona mueve el visor', Number.isFinite(after) && after !== before, `${zoneText}: centro ${before} → ${after} m`);
    check('la lista sigue a la vista (el chip no abre el paso)', (await page.locator('.diag-panel').count()) === 1);

    // Marcar visto el primer aviso del grupo.
    const item = group.getByTestId('diag-item').first();
    const text = await item.locator('.diag-item__text').innerText();
    await item.getByRole('button', { name: 'Marcar como visto' }).click();
    await page.waitForTimeout(300);
    const seenItem = group.locator('[data-testid=diag-item].is-seen').filter({ hasText: text });
    check('«visto» atenúa el aviso', (await seenItem.count()) === 1);
    const last = await group.locator('.diag-module').first().getByTestId('diag-item').last().locator('.diag-item__text').innerText();
    check('el visto baja al final de su módulo', last === text || (await group.locator('.diag-module').first().getByTestId('diag-item').count()) === 1);
    const b1 = await badge(page);
    check('la insignia baja en uno', b1 === b0 - 1, `${b0} → ${b1}`);
    check('se puede desmarcar', (await seenItem.getByRole('button', { name: 'Marcar como no visto' }).count()) === 1);
    await group.scrollIntoViewIfNeeded();
    await shot(page, 'avisos-grupo-visto');

    // «Ocultar vistos» lo saca de la lista.
    await page.getByTestId('diag-hide-seen').locator('label').click();
    await page.waitForTimeout(200);
    check('«Ocultar vistos» saca el aviso visto', (await page.locator('[data-testid=diag-item].is-seen').count()) === 0);
    await page.getByTestId('diag-hide-seen').locator('label').click();

    // Filtro por gravedad: ocultar advertencias.
    await page.getByTestId('diag-filter-warning').locator('button').click();
    await page.waitForTimeout(200);
    const warnLeft = await page.locator('[data-testid=diag-item] .ui-dot--warn').count();
    check('ocultar advertencias las saca de la lista', warnLeft === 0);
    await page.getByTestId('diag-filter-warning').locator('button').click();

    // Oscuro.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(400);
    const dark = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || getComputedStyle(document.body).backgroundColor);
    console.log('      tema: ' + dark);
    await page.locator('.diag-panel').evaluate((el) => {
      let p = el.parentElement;
      while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement;
      if (p) p.scrollTop = 0;
    });
    await shot(page, 'avisos-oscuro');

    // Deshacer el visto (Ctrl+Z) y la insignia vuelve.
    await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    check('deshacer quita la marca de visto', (await badge(page)) === b0, `${await badge(page)}`);

    // Clic en el nombre del módulo: abre su paso en el Inspector.
    const name = await group.locator('.diag-module__name').first().innerText();
    await group.locator('.diag-module__name').first().click();
    await page.waitForTimeout(400);
    const active = await page.locator('.inspector-head').first().innerText().catch(() => '');
    const panelText = await page.locator('.inspector-head').first().locator('xpath=..').innerText().catch(() => '');
    check('el nombre del módulo abre su paso', /Temperatura y Rw/.test(active) && panelText.includes(name), `${name} · ${active.split('\n').slice(0, 2).join(' · ')}`);
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
