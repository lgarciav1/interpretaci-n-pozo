/*
 * Panel «Origen» — «¿De dónde sale este número?» (docs/decisiones/0074) sobre el HTML construido (file://): carga los
 * datos del TP desde Inicio, muestra 7800–7840 m (zona B, con hidrocarburo), abre el menú contextual sobre la pista de
 * Sw en 7820,25 m, elige «¿De dónde sale este número?» y comprueba la cadena (eslabones, valor de Sw igual a la lectura
 * del visor, una muestra abajo/arriba, enlace a Ecuaciones). Saca capturas a 1366×768 en claro y oscuro.
 *
 * Uso: `npm run build && node scripts/qa/origen.cjs [carpeta de capturas]`. Sin carpeta no captura. Sale con 1 si algo
 * falla.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const URL = 'file://' + path.resolve('dist/index.html');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const TARGET = 7820.2536;

const results = [];
const errors = [];
function check(name, ok, note = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${name}${note ? ' · ' + note : ''}`);
}
const shot = async (page, name) => OUT && page.screenshot({ path: path.join(OUT, name + '.png') });
const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));

(async () => {
  const browser = await chromium.launch();
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
    await page.waitForTimeout(1500);

    // Tramo 7800–7840 m.
    await page.getByRole('button', { name: 'Elegir intervalo de profundidad' }).click();
    await page.locator('.wv-range').getByLabel('Tope', { exact: true }).fill('7800');
    await page.locator('.wv-range').getByLabel('Base', { exact: true }).fill('7840');
    await page.getByRole('button', { name: 'Mostrar tramo' }).click();
    await page.waitForTimeout(900);

    // Pista con la curva SW calculada.
    const head = page.locator('.wv-head', { has: page.locator('[data-curve-key$=":SW"]') }).first();
    const hb = await head.boundingBox();
    const body = await page.locator('.wv-body').boundingBox();
    check('hay una pista con Sw calculada', !!hb && !!body);
    const range = await page.locator('.wv-toolbar__range').innerText();
    const [top, base] = range.split(/[–-]/).map((s) => num(s.replace(/[^\d.,]/g, '')));
    let y = body.y + ((TARGET - top) / (base - top)) * body.height;
    const xs = [0.5, 0.3, 0.7, 0.15, 0.85].map((f) => hb.x + f * hb.width);
    let header = '';
    let x = xs[0];
    // Ajuste fino: leer la MD del encabezado del menú y corregir la altura (dos pasadas) y la x hasta tomar SW.
    for (let pass = 0; pass < 6; pass++) {
      await page.mouse.click(Math.round(x), Math.round(y), { button: 'right' });
      await page.waitForSelector('.ui-menu__header');
      header = await page.locator('.ui-menu__header').innerText();
      const md = num((header.match(/MD ([\d.,]+) m/) || [])[1]);
      const pxPerM = body.height / (base - top);
      const onSw = /\bSW\b/.test(header);
      if (Math.abs(md - TARGET) < 0.08 && onSw) break;
      await page.keyboard.press('Escape');
      if (Math.abs(md - TARGET) >= 0.08) y += (TARGET - md) * pxPerM;
      if (!onSw) x = xs[(xs.indexOf(x) + 1) % xs.length];
    }
    console.log('      menú: ' + header.replace(/\n/g, ' · '));
    check('el menú se abrió sobre SW en 7820,25 m', /7\.?820,25/.test(header) && /\bSW\b/.test(header));
    const item = page.getByRole('menuitem', { name: /¿De dónde sale este número\?/ });
    check('el menú ofrece «¿De dónde sale este número?» habilitado', (await item.count()) === 1 && !(await item.isDisabled()));
    if (OUT) await shot(page, 'origen-menu');
    const readSw = Number((header.match(/SW ([\d,.]+)/) || [])[1]?.replace(',', '.'));
    await item.click();

    await page.waitForSelector('[data-testid=provenance-panel] [data-testid=prov-link]', { timeout: 20000 });
    await page.waitForTimeout(600);
    const links = await page.$$eval('[data-testid=prov-link]', (els) => els.map((e) => e.getAttribute('data-module')));
    console.log('      eslabones: ' + links.join(' → '));
    check('la cadena va de los perfiles a Sw (igr … sw-archie)', links[0] === 'igr' && links.at(-1) === 'sw-archie' && links.includes('rw-manual') && links.includes('phie-vsh'), `${links.length} eslabones`);
    check('cada módulo una sola vez', new Set(links).size === links.length);
    const depthText = await page.getByTestId('prov-depth').innerText();
    check('la profundidad del panel es la del menú', /7\.?820,25/.test(depthText), depthText);
    const summary = await page.getByTestId('prov-summary').innerText();
    const panelSw = Number((summary.match(/(\d+,\d+)/) || [])[1]?.replace(',', '.'));
    check('el Sw del panel coincide con la lectura del visor', Number.isFinite(readSw) && Math.abs(panelSw - readSw) < 0.006, `${panelSw} vs ${readSw}`);
    check('no se muestran ecuaciones', !/\\frac|\^\{|S_w\s*=/.test(await page.getByTestId('provenance-panel').innerText()));
    // Captura con la cadena desplazada para ver Sw y sus entradas.
    await shot(page, 'origen-claro');

    // Una muestra abajo cambia la profundidad.
    await page.getByRole('button', { name: 'Muestra de abajo' }).click();
    await page.waitForTimeout(300);
    const d2 = await page.getByTestId('prov-depth').innerText();
    check('«muestra de abajo» avanza 0,15 m', /7\.?820,41/.test(d2), d2);
    await page.getByRole('button', { name: 'Muestra de arriba' }).click();
    await page.waitForTimeout(300);

    // Oscuro, con la tarjeta de Sw a la vista.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await page.locator('[data-module=sw-archie]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await shot(page, 'origen-oscuro');

    // Enlace a Ecuaciones.
    await page.locator('[data-module=sw-archie]').getByRole('button', { name: /Ecuaciones/ }).click();
    await page.waitForTimeout(600);
    const eq = await page.locator('body').innerText();
    check('«Ecuaciones» abre la entrada del módulo Sw', /Archie/.test(eq));
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
