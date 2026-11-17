/*
 * Capas de pay y punzados sugeridos (F04) sobre el HTML construido (file://): carga los datos del TP desde Inicio, abre
 * el paso Sumario → «Capas de pay y punzados», comprueba la tabla (ordenada por k·h), elige los 3 primeros y destilda
 * uno, hace clic en una fila (el visor salta al tramo), mira que la superposición marque los punzados en la pista de
 * profundidad, prueba «Exportar a Excel» (descarga .xlsx) y, con espesor mínimo 0, que Σ pay neto de la tabla coincida
 * con el neto pay del Sumario por zona. Capturas a 1366×768 en claro y oscuro, y una del perfil con los punzados.
 *
 * Uso: `npm run build && node scripts/qa/capas-pay.cjs [carpeta de capturas]`. Sin carpeta no captura. Sale con 1 si
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
const clearToasts = async (page) => {
  for (const b of await page.locator('.ui-toast button').all()) await b.click().catch(() => {});
  await page.waitForTimeout(250);
};
const shot = async (page, name, opts = {}) => {
  if (!OUT) return;
  await clearToasts(page);
  await page.screenshot({ path: path.join(OUT, name + '.png'), ...opts });
};
const num = (s) => Number(String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: 'light', acceptDownloads: true });
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
    await page.waitForTimeout(1500);

    // Paso Sumario → Capas de pay y punzados.
    await page.getByRole('button', { name: /^Paso \d+: Sumario/ }).click();
    await page.getByRole('radio', { name: /Capas de pay y punzados/ }).click();
    await page.waitForSelector('[data-testid=pay-intervals-table]', { timeout: 20000 });
    await page.waitForTimeout(500);

    const panel = page.getByTestId('pay-intervals-panel');
    const count = Number(await page.getByTestId('pay-count').innerText());
    check('la tabla tiene tramos de pay', count > 0, `${count} tramos`);
    check('los parámetros siguen editables arriba del panel', (await page.getByRole('textbox', { name: /Espesor mínimo de capa/ }).count()) + (await page.getByRole('spinbutton', { name: /Espesor mínimo de capa/ }).count()) > 0);
    const ranks = await page.$$eval('[data-testid=pay-intervals-table] tbody tr', (trs) => trs.map((t) => Number(t.getAttribute('data-rank'))));
    check('ordenada por rank (k·h)', ranks.every((r, i) => r === i + 1), ranks.slice(0, 6).join(','));
    check('no se muestran ecuaciones', !/\\frac|\\sum/.test(await panel.innerText()));

    // Elegir los 3 primeros y destildar el 2.
    await panel.getByRole('combobox', { name: 'Cantidad de tramos a elegir' }).selectOption('3');
    await panel.getByRole('button', { name: 'Elegir primeros' }).click();
    await page.waitForTimeout(300);
    let picked = await page.$$eval('[data-testid=pay-intervals-table] tbody tr[data-picked]', (trs) => trs.map((t) => t.getAttribute('data-rank')));
    check('«Elegir primeros» marca los 3 de mayor k·h', picked.join(',') === '1,2,3', picked.join(','));
    await panel.getByRole('checkbox', { name: /Elegir el tramo 2 / }).click({ force: true });
    await page.waitForTimeout(300);
    picked = await page.$$eval('[data-testid=pay-intervals-table] tbody tr[data-picked]', (trs) => trs.map((t) => t.getAttribute('data-rank')));
    check('la casilla destilda un tramo', picked.join(',') === '1,3', picked.join(','));
    // Deshacer vuelve a elegirlo (la selección entra en el historial).
    await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    picked = await page.$$eval('[data-testid=pay-intervals-table] tbody tr[data-picked]', (trs) => trs.map((t) => t.getAttribute('data-rank')));
    check('Ctrl+Z deshace el cambio de selección', picked.join(',') === '1,2,3', picked.join(','));
    await panel.getByRole('checkbox', { name: /Elegir el tramo 2 / }).click({ force: true });
    await page.waitForTimeout(300);

    // Clic en la fila 1: el visor va al tramo.
    const row1 = page.locator('[data-testid=pay-intervals-table] tbody tr[data-rank="1"]');
    const depthTxt = await row1.locator('.pay-depth').innerText();
    const [top, base] = depthTxt.split('\n').map(num);
    await row1.click();
    await page.waitForTimeout(900);
    const range = await page.locator('.wv-toolbar__range').innerText();
    const [vt, vb] = range.split(/[–-]/).map((s) => num(s));
    check('clic en la fila lleva el visor al tramo', vt <= top && vb >= base && vb - vt < 60, `tramo ${top}–${base} · visor ${vt}–${vb}`);
    await shot(page, 'capas-pay-claro');
    if (OUT) await panel.screenshot({ path: path.join(OUT, 'capas-pay-panel.png') });

    // Superposición: tooltip en la pista de profundidad sobre el tramo 1.
    const dh = await page.locator('.wv-head', { hasText: 'Prof.' }).first().boundingBox();
    const body = await page.locator('.wv-body').boundingBox();
    const yMid = body.y + (((top + base) / 2 - vt) / (vb - vt)) * body.height;
    let tip = '';
    for (const dx of [12, 10, 14, 16, 20, 26]) {
      await page.mouse.move(dh.x + dx, yMid);
      await page.waitForTimeout(350);
      tip = await page.locator('.wv-tip').innerText().catch(() => '');
      if (/Punzado sugerido/.test(tip)) break;
    }
    check('la superposición muestra el punzado con tooltip', /Punzado sugerido · tramo 1/.test(tip), tip.replace(/\s+/g, ' ').slice(0, 120));
    if (OUT) {
      const vb2 = await page.locator('.wv-body').boundingBox();
      await page.screenshot({ path: path.join(OUT, 'capas-pay-perfil.png'), clip: { x: Math.max(0, vb2.x - 4), y: Math.max(0, vb2.y - 70), width: Math.min(560, vb2.width), height: Math.min(vb2.height + 70, 768 - Math.max(0, vb2.y - 70)) } });
    }
    await page.mouse.move(5, 5);

    // Exportar a Excel.
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), panel.getByTestId('pay-export').click()]);
    const file = await dl.path();
    const bytes = file ? fs.readFileSync(file) : Buffer.alloc(0);
    check('«Exportar a Excel» descarga un .xlsx', /\.xlsx$/.test(dl.suggestedFilename()) && bytes.slice(0, 2).toString() === 'PK', dl.suggestedFilename());

    // Oscuro.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(600);
    await shot(page, 'capas-pay-oscuro');
    if (OUT) {
      const vb3 = await page.locator('.wv-body').boundingBox();
      await page.screenshot({ path: path.join(OUT, 'capas-pay-perfil-oscuro.png'), clip: { x: Math.max(0, vb3.x - 4), y: Math.max(0, vb3.y - 70), width: Math.min(560, vb3.width), height: Math.min(vb3.height + 70, 768 - Math.max(0, vb3.y - 70)) } });
    }
    await page.emulateMedia({ colorScheme: 'light' });

    // Espesor mínimo 0 (global): Σ pay neto == neto pay del Sumario por zona.
    const field = page.getByRole('textbox', { name: /Espesor mínimo de capa/ }).or(page.getByRole('spinbutton', { name: /Espesor mínimo de capa/ })).first();
    await field.fill('0');
    await field.press('Enter');
    await page.waitForTimeout(1500);
    const net = num(await page.getByTestId('pay-net').innerText());
    await page.getByRole('radio', { name: /Sumario por zona/ }).click();
    await page.waitForTimeout(800);
    const zsum = num(await page.locator('.zsum-kpi', { hasText: 'Neto pay' }).locator('.zsum-kpi__value').innerText());
    check('con espesor mínimo 0, Σ neto = neto pay del sumario', Math.abs(net - zsum) <= 0.051, `${net} m vs ${zsum} m`);
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
