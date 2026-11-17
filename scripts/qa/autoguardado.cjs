/*
 * Autoguardado y «Seguir donde quedaste» (docs/decisiones/0071) sobre el HTML construido (file://), con un perfil
 * persistente de Chromium para que IndexedDB sobreviva a la recarga. Recorre: cargar los datos del TP desde Inicio,
 * cambiar un parámetro, esperar el autoguardado, recargar, «Seguir donde quedaste» y comprobar que vuelve igual; el
 * aviso al cerrar con un cambio pendiente; descartar; y que la barra entra a 1366 px (Compacto y Normal).
 *
 * Uso: `npm run build && node scripts/qa/autoguardado.cjs [carpeta de capturas]`. Sin carpeta no captura. Sale con 1
 * si algo falla.
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
const shot = async (page, name) => OUT && page.screenshot({ path: path.join(OUT, name + '.png') });
const status = (page) => page.getByTestId('autosave-status').getAttribute('data-status');
const grClean = (page) => page.getByLabel('GR de arena limpia (número)').inputValue();

async function enterWell(page) {
  await page.getByTestId('home-enter').click();
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid=home]', { state: 'detached' });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoguardado-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1366, height: 768 }, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.accept();
  });
  // Cantidad de sesiones en la base (lectura directa de IndexedDB, para esperar al autoguardado sin la barra).
  await page.addInitScript(() => {
    window.sessionCount = () =>
      new Promise((resolve) => {
        const q = indexedDB.open('fiubalog-autoguardado');
        q.onsuccess = () => {
          try {
            const c = q.result.transaction('sesiones').objectStore('sesiones').count();
            c.onsuccess = () => { resolve(c.result); q.result.close(); };
          } catch { resolve(-1); }
        };
        q.onerror = () => resolve(-1);
      });
  });
  try {
    await page.goto(URL);
    await page.waitForSelector('[data-testid=home]');
    check('primer arranque: sin sesiones, «Cargar pozo» es la acción principal', (await page.getByTestId('home-resume').count()) === 0 && (await page.getByTestId('home-load').count()) === 1);

    // Cargar los datos del TP desde Inicio: Cargar pozo → Cargar datos del TP → Siguiente → Cargar.
    await page.getByTestId('home-load').click();
    await page.getByRole('button', { name: 'Cargar datos del TP' }).click();
    await page.getByRole('button', { name: /Siguiente: control de calidad/ }).click();
    await page.getByRole('button', { name: 'Cargar', exact: true }).click();
    await page.waitForSelector('[data-testid=home-enter]');
    await enterWell(page);
    check('tras cargar, la barra marca cambios sin guardar', (await status(page)) === 'dirty');
    await page.waitForFunction(() => document.querySelector('[data-testid=autosave-status]')?.getAttribute('data-status') === 'saved', null, { timeout: 15000 });
    check('a los 3 s queda guardado', true);

    // Cambiar un parámetro: GR de arena limpia 30 → 25.
    await page.getByRole('button', { name: /Arcilla/ }).first().click();
    const field = page.getByLabel('GR de arena limpia (número)');
    await field.fill('25');
    await field.press('Enter');
    await page.waitForTimeout(300);
    check('el cambio deja «Cambios sin guardar»', (await status(page)) === 'dirty');
    const t0 = Date.now();
    await page.waitForFunction(() => document.querySelector('[data-testid=autosave-status]')?.getAttribute('data-status') === 'saved', null, { timeout: 15000 });
    const waited = Date.now() - t0;
    check('el autoguardado espera ~3 s', waited > 2000 && waited < 9000, `${waited} ms`);
    const label = await page.getByTestId('autosave-status').getAttribute('aria-label');
    check('tooltip/nombre con la hora y el estado del archivo', /a las \d\d:\d\d\./.test(label) && /no guardado/.test(label), label);
    const bar = await page.evaluate(() => { const t = document.querySelector('.shell-topbar'); return [t.scrollWidth, t.clientWidth]; });
    check('la barra entra a 1366 px (Normal)', bar[0] <= bar[1], bar.join(' / '));
    await shot(page, 'barra-guardado');

    // Recargar: Inicio ofrece seguir.
    await page.reload();
    await page.waitForSelector('[data-testid=home-resume]', { timeout: 15000 });
    check('sin aviso al recargar con todo guardado', dialogs === 0);
    const resumeText = await page.locator('.home__resume').innerText();
    check('«Seguir donde quedaste» muestra proyecto, pozos y hace cuánto', /pozo_tp_perfiles/.test(resumeText) && /guardado (recién|hace)/.test(resumeText), resumeText.replace(/\s+/g, ' '));
    await shot(page, 'inicio-seguir');
    await page.getByTestId('home-resume').click();
    await page.waitForSelector('[data-testid=home-enter]', { timeout: 15000 });
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    check('tras recuperar, Inicio muestra el pozo y «Entrar al pozo» tiene el foco', focused === 'home-enter', focused);
    await enterWell(page);
    check('recuperado cuenta como guardado', (await status(page)) === 'saved');
    await page.getByRole('button', { name: /Arcilla/ }).first().click();
    check('el parámetro cambiado vuelve', (await grClean(page)) === '25,0', await grClean(page));
    const zones = await page.locator('text=5 zonas').count();
    check('las zonas vuelven', zones > 0);

    // Cambio pendiente + recarga: el navegador pide confirmación.
    const field2 = page.getByLabel('GR de arena limpia (número)');
    await field2.fill('27');
    await field2.press('Enter');
    await page.waitForTimeout(200);
    await page.reload();
    await page.waitForSelector('[data-testid=home]');
    check('con un cambio pendiente, recargar pide confirmación', dialogs === 1, `${dialogs} diálogos`);

    // La misma sesión de trabajo: una sola entrada, con el último guardado (25, el 27 no llegó a guardarse).
    check('una sola sesión (se continuó la misma)', (await page.locator('.home__session').count()) === 0);
    await page.getByTestId('home-resume').click();
    await page.waitForSelector('[data-testid=home-enter]');
    await enterWell(page);
    await page.getByRole('button', { name: /Arcilla/ }).first().click();
    check('se recupera lo último autoguardado', (await grClean(page)) === '25,0');

    // Compacto a 1366: la barra entra con los rótulos.
    await page.evaluate(() => localStorage.setItem('pozo.ui.scale', 'compact'));
    await page.reload();
    await page.waitForSelector('[data-testid=home-resume]');
    await page.getByTestId('home-resume').click();
    await page.waitForSelector('[data-testid=home-enter]');
    await enterWell(page);
    const bar2 = await page.evaluate(() => { const t = document.querySelector('.shell-topbar'); return [t.scrollWidth, t.clientWidth]; });
    check('la barra entra a 1366 px (Compacto)', bar2[0] <= bar2[1], bar2.join(' / '));
    await shot(page, 'barra-compacto');

    // Otra sesión de trabajo: la demostración no pisa la del TP (punto 5).
    await page.reload();
    await page.waitForSelector('[data-testid=home-resume]');
    await page.getByTestId('home-demo').click();
    await page.waitForSelector('[data-testid=home-enter]');
    const d0 = dialogs;
    const t1 = Date.now();
    while (Date.now() - t1 < 20000 && (await page.evaluate(() => window.sessionCount())) !== 2) await page.waitForTimeout(250);
    console.log('      demostración guardada en', Date.now() - t1, 'ms');
    await page.reload();
    check('sin aviso al recargar tras autoguardar la demostración', dialogs === d0);
    await page.waitForSelector('[data-testid=home-resume]');
    const resume2 = await page.locator('.home__resume').innerText();
    const others = await page.locator('.home__session').count();
    check('la demostración es otra sesión: se ofrece primero y el TP queda debajo', /Demostraci|demo/i.test(resume2) && others === 1, `${resume2.replace(/\s+/g, ' ')} · ${others} más`);
    await shot(page, 'inicio-dos-sesiones');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(400);
    await shot(page, 'inicio-dos-sesiones-oscuro');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByTestId('home-session-discard').click();
    await page.waitForSelector('.home__session', { state: 'detached' });
    check('descartar una sesión de la lista', true);

    // Descartar la principal.
    await page.getByTestId('home-resume-discard').click();
    await page.waitForSelector('[data-testid=home-resume]', { state: 'detached' });
    check('descartar deja Inicio como al principio', (await page.getByTestId('home-load').count()) === 1);
  } catch (err) {
    check('recorrido completo', false, err.message);
    await shot(page, 'error');
  }
  check('sin errores de consola', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `${failed} fallas` : 'todo bien');
  process.exit(failed ? 1 : 0);
})();
