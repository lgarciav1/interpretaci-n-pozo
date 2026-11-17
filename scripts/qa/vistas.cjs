/*
 * Vistas guardadas y modo defensa (F07, docs/decisiones/0075) sobre el HTML construido (file://), con un perfil
 * persistente de Chromium para que el autoguardado (IndexedDB) sobreviva a la recarga. Recorre: cargar los datos del
 * TP desde Inicio; guardar cinco vistas con el teclado (Ctrl+K → «Guardar la vista actual…» → nombre → Intro),
 * variando tramo, zona activa, panel, plantilla y espacio entre una y otra; comprobar el panel «Vistas»; recargar y
 * seguir donde quedó (autoguardado) y ver que las cinco vuelven en orden; entrar al modo defensa por teclado,
 * recorrer con → y ← comprobando el índice y el tramo visible, que no hay barra superior ni flujo, que Ctrl+Z no
 * deshace nada y que Esc devuelve la disposición anterior (barras, columnas, pestaña, tramo y pistas).
 *
 * Uso: `npm run build && node scripts/qa/vistas.cjs [carpeta de capturas]`. Sin carpeta no captura. Sale con 1 si
 * algo falla.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
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
const shot = async (page, name) => {
  if (!OUT) return;
  await clearToasts(page);
  await page.mouse.move(683, 300);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
};
const fmt = (r) => (r ? `${r.top.toFixed(1)}–${r.base.toFixed(1)}` : '—');
const near = (a, b, tol = 0.6) => !!a && !!b && Math.abs(a.top - b.top) <= tol && Math.abs(a.base - b.base) <= tol;

/** Tramo visible del visor (lo publica la app en un `data-` oculto). */
const visible = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid=viewer-visible]');
    return el && el.dataset.top ? { top: Number(el.dataset.top), base: Number(el.dataset.base) } : null;
  });
/** Espera a que el tramo visible deje de moverse. */
async function stableVisible(page) {
  let prev = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const v = await visible(page);
    if (prev && near(prev, v, 0.01)) return v;
    prev = v;
  }
  return prev;
}

/** Paleta: Ctrl+K, escribir, esperar que la acción esperada sea la elegida y pulsar Intro. */
async function palette(page, text, id) {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.ui-cmd input[role=combobox]');
  await page.keyboard.type(text, { delay: 5 });
  await page.waitForSelector(`[data-testid="cmd-${id}"][aria-selected="true"]`, { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
}

/** Guardar la vista actual con el teclado. */
async function saveView(page, name) {
  await palette(page, 'Guardar la vista actual', 'views:save');
  await page.waitForFunction(() => document.activeElement?.id === 'views-save-name');
  await page.keyboard.press('Control+a');
  await page.keyboard.type(name, { delay: 5 });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#views-save-name', { state: 'detached' });
  await page.waitForTimeout(300);
}

/** Enfoca el perfil (después de que la paleta devuelva el foco a donde estaba). */
async function focusViewer(page) {
  await page.waitForTimeout(300);
  await page.locator('.shell-viewer .wv-body').focus();
  await page.waitForFunction(() => document.activeElement?.classList.contains('wv-body'));
}
const zoneButton = (page, z) => page.getByRole('button', { name: `Ver la zona ${z}`, exact: true });
const rowNames = (page) => page.$$eval('[data-testid=views-panel] .views-row__name', (els) => els.map((e) => e.textContent));
const templateLabel = (page) => page.locator('.tb-template-btn__label').innerText().catch(() => '');

async function enterWell(page) {
  await page.getByTestId('home-enter').click();
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid=home]', { state: 'detached' });
  await page.waitForTimeout(1200);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vistas-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 768 }, colorScheme: 'light', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', (d) => void d.accept());
  const saved = [];
  try {
    await page.goto(URL);
    await page.waitForSelector('[data-testid=home]');
    await page.getByTestId('home-load').click();
    await page.getByRole('button', { name: 'Cargar datos del TP' }).click();
    await page.getByRole('button', { name: /Siguiente: control de calidad/ }).click();
    await page.getByRole('button', { name: 'Cargar', exact: true }).click();
    await page.waitForSelector('[data-testid=home-enter]');
    await enterWell(page);

    // 1 · Pozo entero, de fábrica, sin panel.
    await palette(page, 'Plegar el panel lateral', 'layout:right');
    await focusViewer(page);
    await page.keyboard.press('0');
    await page.waitForFunction(() => { const d = document.querySelector('[data-testid=viewer-visible]')?.dataset; return d && Number(d.base) - Number(d.top) > 800; }, null, { timeout: 5000 });
    let v = await stableVisible(page);
    await saveView(page, 'Pozo entero');
    saved.push({ name: 'Pozo entero', range: v, panel: null, workspace: 'petrophysics' });

    // 2 · Zona C con Petrofísica esencial y la zona activa.
    await page.locator('.tb-template-btn').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: /Petrofísica esencial/ }).click();
    await page.waitForTimeout(400);
    await zoneButton(page, 'C').focus();
    await page.keyboard.press('Enter');
    v = await stableVisible(page);
    await saveView(page, 'Zona C · Petrofísica esencial');
    saved.push({ name: 'Zona C · Petrofísica esencial', range: v, panel: null, workspace: 'petrophysics', template: 'Petrofísica esencial', zone: 'C' });

    // 3 · Zona B con el crossplot abierto.
    await zoneButton(page, 'B').focus();
    await page.keyboard.press('Enter');
    await palette(page, 'Abrir la pestaña Crossplot', 'dock:crossplot');
    await page.waitForTimeout(800);
    v = await stableVisible(page);
    await saveView(page, 'Crossplot zona B');
    saved.push({ name: 'Crossplot zona B', range: v, panel: 'crossplot', workspace: 'petrophysics', zone: 'B' });

    // 4 · Zona D con el histograma, sin zona activa.
    await zoneButton(page, 'D').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Dejar de editar la zona' }).focus();
    await page.keyboard.press('Enter');
    await palette(page, 'Abrir la pestaña Histograma', 'dock:histogram');
    await page.waitForTimeout(800);
    await focusViewer(page);
    await page.keyboard.press('-');
    v = await stableVisible(page);
    await saveView(page, 'Histograma zona D');
    saved.push({ name: 'Histograma zona D', range: v, panel: 'histogram', workspace: 'petrophysics' });

    // 5 · Geología, pozo entero, sin panel.
    await palette(page, 'Ir al espacio de trabajo Geología', 'workspace:geology');
    await palette(page, 'Plegar el panel lateral', 'layout:right');
    await focusViewer(page);
    await page.keyboard.press('0');
    await page.waitForFunction(() => { const d = document.querySelector('[data-testid=viewer-visible]')?.dataset; return d && Number(d.base) - Number(d.top) > 800; }, null, { timeout: 5000 });
    v = await stableVisible(page);
    await saveView(page, 'Geología');
    saved.push({ name: 'Geología', range: v, panel: null, workspace: 'geology' });
    check('cinco vistas guardadas con el teclado', saved.length === 5, saved.map((s) => `${s.name} ${fmt(s.range)}`).join(' | '));

    // Panel «Vistas».
    await palette(page, 'Abrir la pestaña Vistas', 'dock:views');
    await page.waitForSelector('[data-testid=views-panel]');
    let names = await rowNames(page);
    check('el panel «Vistas» lista las cinco en orden', names.join('|') === saved.map((s) => s.name).join('|'), names.join(' | '));
    const row2 = await page.getByTestId('view-row-2').innerText();
    check('la fila dice tramo, zona y plantilla', /Zona C/.test(row2) && /Petrofísica esencial/.test(row2) && / m/.test(row2), row2.replace(/\s+/g, ' '));
    const row3 = await page.getByTestId('view-row-3').innerText();
    check('la fila dice el panel', /Crossplot/.test(row3), row3.replace(/\s+/g, ' '));
    await shot(page, 'vistas-panel-claro');
    if (OUT) await page.getByTestId('views-panel').screenshot({ path: path.join(OUT, 'vistas-panel-detalle.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(400);
    await shot(page, 'vistas-panel-oscuro');
    await page.emulateMedia({ colorScheme: 'light' });

    // Autoguardado → recargar → seguir donde quedaste.
    await page.waitForFunction(() => document.querySelector('[data-testid=autosave-status]')?.getAttribute('data-status') === 'saved', null, { timeout: 15000 });
    await page.reload();
    await page.waitForSelector('[data-testid=home-resume]', { timeout: 15000 });
    await page.getByTestId('home-resume').click();
    await page.waitForSelector('[data-testid=home-enter]', { timeout: 15000 });
    await enterWell(page);
    await palette(page, 'Abrir la pestaña Vistas', 'dock:views');
    await page.waitForSelector('[data-testid=views-panel]');
    names = await rowNames(page);
    check('tras recargar (autoguardado) vuelven las cinco en orden', names.join('|') === saved.map((s) => s.name).join('|'), names.join(' | '));

    // Disposición «antes»: Petrofísica, pestaña Resumen al costado, zona A, columna del pozo como esté.
    await palette(page, 'Ir al espacio de trabajo Petrofísica', 'workspace:petrophysics');
    await palette(page, 'Abrir la pestaña Resumen', 'dock:glance');
    await zoneButton(page, 'A').focus();
    await page.keyboard.press('Enter');
    // Algo para deshacer: un snapshot.
    await palette(page, 'Guardar un snapshot ahora', 'project:snapshot-now');
    const before = {
      range: await stableVisible(page),
      template: await templateLabel(page),
      undo: await page.getByTestId('undo').getAttribute('aria-label'),
      leftOpen: await page.locator('.shell-side--left').count(),
      sideTab: await page.locator('.side-rail__tab[aria-selected=true]').getAttribute('data-testid').catch(() => null),
      panelTitle: await page.locator('.side-panels__title').innerText().catch(() => ''),
    };
    await clearToasts(page);

    // Modo defensa por teclado.
    await palette(page, 'Modo defensa', 'views:defense');
    await page.waitForSelector('[data-testid=defense-hud]');
    check('sin barra superior ni flujo', (await page.locator('.shell-topbar').count()) === 0 && (await page.locator('.shell-flowbar').count()) === 0);
    check('sin columna del pozo ni rieles', (await page.locator('.shell-side--left').count()) === 0 && (await page.locator('.shell-rail').count()) === 0 && !(await page.locator('.side-rail').isVisible().catch(() => false)));
    const idx = () => page.getByTestId('defense-index').innerText();
    const checkView = async (i) => {
      const r = await stableVisible(page);
      const s = saved[i - 1];
      const text = await idx();
      const panelShown = s.panel ? await page.locator(`[data-testid=side-panel] .side-panels__title`).innerText().catch(() => '') : '';
      const sidePanel = await page.locator('[data-testid=side-panel]').count();
      const okPanel = s.panel ? sidePanel === 1 && panelShown.length > 0 : sidePanel === 0;
      check(`vista ${i}: índice, tramo y panel`, text === `${i} / 5` && near(r, s.range, Math.max(0.6, (s.range.base - s.range.top) * 0.01)) && okPanel, `${text} · visor ${fmt(r)} · guardado ${fmt(s.range)}${s.panel ? ` · panel ${panelShown}` : ''}`);
    };
    await checkView(1);
    await page.waitForTimeout(3200);
    check('el indicador se atenúa sin movimiento', await page.getByTestId('defense-hud').evaluate((el) => el.classList.contains('is-idle')));
    check('al entrar no hay cursor de teclado ni foco en el visor', await page.evaluate(() => document.activeElement === document.body));
    await page.keyboard.press('ArrowRight');
    await checkView(2);
    check('la vista 2 usa sus pistas (Petrofísica esencial) sin tocar el proyecto', (await page.locator('.wv-head').count()) > 0);
    // Ctrl+Z no deshace nada.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(300);
    check('Ctrl+Z / Ctrl+Y no hacen nada en el modo', (await idx()) === '2 / 5' && (await page.locator('.ui-toast', { hasText: /Se deshizo|Se rehízo/ }).count()) === 0);
    await page.keyboard.press('ArrowRight');
    await checkView(3);
    await shot(page, 'defensa-claro');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await shot(page, 'defensa-oscuro');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.keyboard.press('ArrowRight');
    await checkView(4);
    await page.keyboard.press('ArrowRight');
    await checkView(5);
    await shot(page, 'defensa-geologia-claro');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    check('en la última, → no hace nada (sin vuelta circular)', (await idx()) === '5 / 5');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await checkView(3);
    await page.keyboard.press('ArrowLeft');
    await checkView(2);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(400);
    await shot(page, 'defensa-zona-oscuro');
    await page.emulateMedia({ colorScheme: 'light' });

    const r1 = await visible(page);
    await page.keyboard.press('+');
    const r1z = await stableVisible(page);
    check('+ sigue siendo del visor (acerca)', r1 && r1z && r1z.base - r1z.top < (r1.base - r1.top) * 0.95, `${fmt(r1)} → ${fmt(r1z)}`);

    // Esc: vuelve la disposición anterior.
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=defense-hud]', { state: 'detached' });
    const after = {
      range: await stableVisible(page),
      template: await templateLabel(page),
      undo: await page.getByTestId('undo').getAttribute('aria-label'),
      leftOpen: await page.locator('.shell-side--left').count(),
      sideTab: await page.locator('.side-rail__tab[aria-selected=true]').getAttribute('data-testid').catch(() => null),
      panelTitle: await page.locator('.side-panels__title').innerText().catch(() => ''),
    };
    check('Esc devuelve barra superior y flujo', (await page.locator('.shell-topbar').count()) === 1 && (await page.locator('.shell-flowbar').count()) === 1);
    check('Esc devuelve columnas y pestaña', after.leftOpen === before.leftOpen && after.sideTab === before.sideTab && after.panelTitle === before.panelTitle, `${before.sideTab}/${after.sideTab} · ${before.panelTitle}/${after.panelTitle}`);
    check('Esc devuelve el tramo', near(after.range, before.range), `antes ${fmt(before.range)} · después ${fmt(after.range)}`);
    check('Esc devuelve las pistas del proyecto', after.template === before.template, `${before.template} / ${after.template}`);
    check('el historial no cambió durante el modo', after.undo === before.undo, after.undo);
    const snaps = await page.getByRole('button', { name: /Snapshots/ }).innerText();
    check('el snapshot sigue ahí (Ctrl+Z no lo deshizo)', /1/.test(snaps), snaps.replace(/\s+/g, ' '));
    await shot(page, 'despues-de-salir');

    // Desde el panel: «Presentar desde acá» en la 4 y salir con el botón.
    await palette(page, 'Abrir la pestaña Vistas', 'dock:views');
    await page.getByTestId('view-present-4').click();
    await page.waitForSelector('[data-testid=defense-hud]');
    check('«Presentar desde esta vista» arranca en la 4', (await idx()) === '4 / 5');
    await page.getByTestId('defense-exit').click();
    await page.waitForSelector('[data-testid=defense-hud]', { state: 'detached' });
    check('«Salir» del indicador vuelve', (await page.locator('.shell-topbar').count()) === 1);
  } catch (err) {
    check('recorrido completo', false, err.message.split('\n')[0]);
    if (OUT) await page.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
  }
  const relevant = errors.filter((e) => !/favicon/i.test(e));
  check('sin errores de consola', relevant.length === 0, relevant.slice(0, 3).join(' | '));
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `${failed} fallas` : 'todo bien');
  process.exit(failed ? 1 : 0);
})();
