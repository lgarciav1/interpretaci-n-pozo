/*
 * «Copiar contexto para un chat» (F25) sobre el HTML construido (file://): carga los datos del TP desde Inicio, espera el
 * cálculo, abre la paleta (Ctrl+K), busca «contexto», ejecuta el comando y comprueba el portapapeles y el toast. Luego
 * repite en un contexto donde `navigator.clipboard.writeText` falla (como en file:// sin permiso) para ejercitar el
 * respaldo con `document.execCommand('copy')`. Saca capturas a 1366×768 en claro y oscuro: paleta con el comando y
 * toast tras copiar.
 *
 * Uso: `npm run build && node scripts/qa/chat-contexto.cjs [carpeta de capturas]`. Sin carpeta no captura. Sale con 1
 * si algo falla.
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

/** Carga el TP desde Inicio y espera a que el cálculo termine (insignia de Avisos con contador). */
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
  await page.waitForTimeout(1500);
}
/** Abre la paleta, escribe «contexto» y devuelve la opción del comando. */
async function openPalette(page) {
  await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.ui-cmd [role=option]');
  await page.keyboard.type('contexto');
  await page.waitForTimeout(250);
  return page.locator('.ui-cmd [role=option]').filter({ hasText: 'Copiar contexto para un chat' });
}
async function toastText(page) {
  const t = page.locator('.ui-toast').filter({ hasText: /Contexto copiado|No se pudo/ }).last();
  await t.waitFor({ timeout: 10000 });
  return t.innerText();
}

(async () => {
  const browser = await chromium.launch();
  try {
    // 1) Con permiso de portapapeles: copia por la API asíncrona.
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, colorScheme: scheme });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
      const tag = scheme === 'light' ? 'claro' : 'oscuro';
      await loadTp(page);
      const option = await openPalette(page);
      check(`[${tag}] la paleta muestra el comando al buscar «contexto»`, (await option.count()) === 1);
      await shot(page, `paleta-${tag}`);
      await option.first().click();
      const text = await toastText(page);
      const m = text.match(/Contexto copiado · ([\d.]+) caracteres/);
      check(`[${tag}] aparece el toast de copiado`, !!m, text.replace(/\s+/g, ' '));
      await page.waitForTimeout(350);
      await shot(page, `toast-${tag}`);
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'ERROR ' + e.message);
      const n = m ? Number(m[1].replace(/\./g, '')) : NaN;
      check(`[${tag}] el portapapeles tiene el contexto`, clip.startsWith('Contexto de interpretación petrofísica') && clip.includes('## Zonas') && clip.includes('## Sumario por zona'), `${clip.length} caracteres`);
      check(`[${tag}] el largo del toast coincide y respeta el tope`, clip.length === n && clip.length <= 12000, `${n}`);
      check(`[${tag}] sin ecuaciones ni restos de formato`, !/<\/?[a-z][^>]*>|undefined|NaN|\\frac|\$\$/.test(clip));
      if (scheme === 'light') fs.writeFileSync(path.join(require('os').tmpdir(), 'chat-contexto-portapapeles.txt'), clip);
      await ctx.close();
    }

    // 2) Sin API de portapapeles (writeText rechaza): debe usar el respaldo execCommand('copy').
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, colorScheme: 'light' });
      await ctx.addInitScript(() => {
        window.__copied = null;
        window.__execCalls = 0;
        const deny = () => Promise.reject(new DOMException('Denegado', 'NotAllowedError'));
        try { Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => ({ writeText: deny, readText: deny }) }); } catch {}
        const orig = Document.prototype.execCommand;
        Document.prototype.execCommand = function (cmd, ...rest) {
          if (cmd === 'copy') {
            window.__execCalls++;
            const el = document.activeElement;
            window.__copied = el && 'value' in el ? el.value.slice(el.selectionStart, el.selectionEnd) : String(document.getSelection());
          }
          return orig.call(this, cmd, ...rest);
        };
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await loadTp(page);
      const option = await openPalette(page);
      await option.first().click();
      const text = await toastText(page);
      const st = await page.evaluate(() => ({ calls: window.__execCalls, copied: window.__copied, leftovers: document.querySelectorAll('body > textarea').length }));
      check('[respaldo] usa execCommand("copy") con el texto completo seleccionado', st.calls === 1 && (st.copied || '').startsWith('Contexto de interpretación petrofísica'), `${st.calls} llamada(s), ${(st.copied || '').length} caracteres`);
      check('[respaldo] toast acorde al resultado del respaldo', /Contexto copiado/.test(text) || /No se pudo copiar al portapapeles/.test(text), text.replace(/\s+/g, ' '));
      check('[respaldo] no deja el textarea temporal en la página', st.leftovers === 0);
      await ctx.close();
    }
  } catch (e) {
    check('el recorrido terminó sin excepción', false, e.message);
  } finally {
    await browser.close();
  }
  const relevant = errors.filter((e) => !/favicon|WebGL|GPU stall/i.test(e));
  check('sin errores en la consola', relevant.length === 0, relevant.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones ok`);
  process.exit(failed ? 1 : 0);
})();
