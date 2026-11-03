/*
 * Recorrido completo del pozo del TP sobre el HTML construido (file://), cronometrado: carga de los datos reales,
 * los once pasos del flujo y los seis módulos obligatorios del profesor (visor, presiones MDT, crossplot libre, datos
 * de corona, histograma, gradientes y tendencias). Mide el tiempo de máquina de cada paso y cuenta los clics, para
 * comprobar la prioridad 3 del proyecto («un pozo interpretado de punta a punta en menos de 5 minutos»).
 *
 * Uso: `npm run build && node scripts/qa/recorrido-tp.cjs [carpeta]` (por defecto docs/capturas/recorrido-tp).
 * Sale con 1 si algún paso falla o hay errores de página. Un paso fallido no corta el resto: queda en el resumen.
 * Modelo: scripts/qa/normalization-panel.cjs.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const OUT = path.resolve(process.argv[2] || 'docs/capturas/recorrido-tp');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let clicks = 0;
const log = (...a) => console.log('·', ...a);

async function click(locator, opts) {
  await locator.click({ timeout: 15000, ...opts });
  clicks += 1;
}

/** Ejecuta un paso, mide el tiempo y registra el resultado sin abortar el recorrido. */
async function step(page, name, fn, shotName) {
  const t0 = Date.now();
  const c0 = clicks;
  let ok = true;
  let note = '';
  try {
    note = (await fn()) || '';
  } catch (e) {
    ok = false;
    note = String(e.message || e).split('\n')[0];
  }
  const ms = Date.now() - t0;
  if (shotName) await page.screenshot({ path: path.join(OUT, shotName + '.png') }).catch(() => {});
  results.push({ name, ok, ms, clicks: clicks - c0, note });
  log(`${ok ? 'ok   ' : 'FALLA'} ${name} · ${(ms / 1000).toFixed(1)} s · ${clicks - c0} clics${note ? ' · ' + note : ''}`);
}

const dockText = (page) => page.locator('.shell-dock__panel:not([hidden])').first().innerText();
async function openTab(page, name) {
  await click(page.getByRole('tab', { name: new RegExp('^' + name) }));
  await page.waitForTimeout(500);
}
const flat = (s) => s.replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + ROOT + '/dist/index.html');
  await page.waitForTimeout(1200);
  const tStart = Date.now();

  // 1. Cargar los datos reales del TP (asistente Archivo → Columnas → Control de calidad).
  await step(page, 'Cargar los datos del TP', async () => {
    await click(page.getByRole('button', { name: 'Cargar pozo' }).first());
    await click(page.getByRole('button', { name: /Cargar datos del TP/ }));
    await click(page.getByRole('button', { name: 'Siguiente: control de calidad' }));
    await click(page.getByRole('button', { name: 'Cargar', exact: true }));
    await page.getByText('Pozo cargado.').first().waitFor({ timeout: 30000 });
    return '';
  }, '01-pozo-cargado');

  // 2. Los once pasos del flujo, uno por uno.
  const flowSteps = ['Calidad', 'Zonas', 'Arcilla', 'Porosidad', 'Rw', 'Saturación', 'Permeabilidad', 'Cutoffs', 'Sumario', 'Volumen'];
  await step(page, 'Recorrer los pasos del flujo (10 clics)', async () => {
    const seen = [];
    for (const [i, s] of flowSteps.entries()) {
      await click(page.getByRole('button', { name: new RegExp('^Paso \\d+: ' + s) }));
      await page.waitForTimeout(250);
      const heading = flat(await page.locator('h2, h3').filter({ hasText: /./ }).first().innerText().catch(() => ''));
      seen.push(`${s}${heading ? '' : ' (sin encabezado)'}`);
      if (i === 5) await page.screenshot({ path: path.join(OUT, '02-flujo-saturacion.png') });
    }
    return seen.length + ' pasos visitados';
  }, '03-flujo-volumen');

  // 3. Presiones MDT del TP: gradientes por fluido, densidad y contactos, sobre el visor.
  await step(page, 'MDT: cargar presiones del TP', async () => {
    await openTab(page, 'Presiones MDT');
    await click(page.getByRole('button', { name: 'Cargar presiones del TP' }));
    await page.waitForTimeout(1500);
    const t = flat(await dockText(page));
    if (/Sin presiones de formación/.test(t)) throw new Error('el panel sigue vacío tras cargar');
    return t.slice(0, 160);
  }, '04-mdt');

  await step(page, 'MDT: gradiente de agua arrastrando sobre el visor (zona D)', async () => {
    const panel = page.locator('.shell-dock__panel:not([hidden])');
    await click(page.getByRole('button', { name: 'Ver la zona D' }));
    await click(panel.getByRole('button', { name: 'Agua' }));
    const b = await page.locator('canvas.wv-canvas').first().boundingBox();
    if (!b) throw new Error('sin canvas del visor');
    const x = b.x + 40;
    await page.mouse.move(x, b.y + b.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(x, b.y + b.height * 0.9, { steps: 10 });
    await page.mouse.up();
    clicks += 1;
    await page.waitForTimeout(600);
    const t = flat(await dockText(page));
    const m = t.match(/\d[\d,.]* psi\/ft.{0,80}/);
    if (!m) throw new Error('no apareció el gradiente');
    return m[0];
  }, '04b-mdt-gradiente');

  // 4. Datos de corona del TP: plugs, puesta en profundidad, modelo k–φ.
  await step(page, 'Corona: cargar plugs del TP', async () => {
    await openTab(page, 'Corona');
    await click(page.getByRole('button', { name: 'Cargar corona del TP' }));
    await page.waitForTimeout(1500);
    const t = flat(await dockText(page));
    if (/Sin datos de corona/.test(t)) throw new Error('el panel sigue vacío tras cargar');
    return t.slice(0, 160);
  }, '05-corona');

  // 5. Crossplot libre: cualquier curva contra cualquier otra, color por tercera curva, cutoffs.
  await step(page, 'Crossplot: GR contra AT90 (dos clics por eje)', async () => {
    await openTab(page, 'Crossplot');
    const panel = page.locator('.shell-dock__panel:not([hidden])');
    // Los ejes son <select> nativos: abrir la lista y elegir son dos clics por eje.
    await panel.getByRole('combobox', { name: 'Curva del eje X' }).selectOption({ value: 'm:GR' });
    await panel.getByRole('combobox', { name: 'Curva del eje Y' }).selectOption({ value: 'm:AT90' });
    clicks += 4;
    await page.waitForTimeout(800);
    const x = await panel.getByRole('combobox', { name: 'Curva del eje X' }).inputValue();
    const y = await panel.getByRole('combobox', { name: 'Curva del eje Y' }).inputValue();
    if (x !== 'm:GR' || y !== 'm:AT90') throw new Error(`los ejes no cambiaron (${x} / ${y})`);
    return 'ejes GR / AT90';
  }, '06-crossplot');

  await step(page, 'Crossplot: escala log en Y y filtro por capa', async () => {
    const panel = page.locator('.shell-dock__panel:not([hidden])');
    await click(panel.locator('button', { hasText: /^Log$/ }).nth(1));
    await click(panel.locator('button', { hasText: /^D$/ }).first());
    await page.waitForTimeout(600);
    return 'Y en log · capa D';
  }, '07-crossplot-log-capa');

  await step(page, 'Crossplot: agregar cutoff', async () => {
    const panel = page.locator('.shell-dock__panel:not([hidden])');
    await click(panel.getByRole('button', { name: /Agregar/ }).first());
    await page.waitForTimeout(500);
    return '';
  }, '08-crossplot-cutoff');

  // 6. Histograma: curva, cutoff arrastrable, superposición de capas.
  await step(page, 'Histograma: GR con cutoff y capas superpuestas', async () => {
    await openTab(page, 'Histograma');
    const panel = page.locator('.shell-dock__panel:not([hidden])');
    await click(panel.getByRole('button', { name: /Agregar cutoff libre|Mostrar el cutoff/ }).first());
    await click(panel.locator('button', { hasText: /^B$/ }).first());
    await click(panel.locator('button', { hasText: /^D$/ }).first());
    await page.waitForTimeout(600);
    return '';
  }, '09-histograma');

  // 7. Gradientes y tendencias: arrastrar sobre una curva del visor para ajustar un tramo.
  await step(page, 'Tendencia: ajuste sobre un tramo del visor', async () => {
    await openTab(page, 'Tendencias');
    await click(page.getByRole('button', { name: 'Ver todo el pozo' }));
    await click(page.getByRole('button', { name: 'Nueva tendencia' }).first());
    const b = await page.locator('canvas.wv-canvas').first().boundingBox();
    if (!b) throw new Error('sin canvas del visor');
    const x = b.x + 515; // pista del sónico (DT) en el ancho de 1600 px de este guion
    await page.mouse.move(x, b.y + b.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(x, b.y + b.height * 0.9, { steps: 12 });
    await page.mouse.up();
    clicks += 1;
    await page.waitForTimeout(800);
    const t = flat(await dockText(page));
    if (/Todavía no hay tendencias|Arrastrá sobre una curva/.test(t)) throw new Error('no se creó la tendencia');
    return t.slice(0, 200);
  }, '10-tendencia');

  const total = (Date.now() - tStart) / 1000;
  const failed = results.filter((r) => !r.ok);
  console.log('\n— Resumen —');
  console.log(`Pasos: ${results.length} · fallan: ${failed.length} · clics: ${clicks} · tiempo de máquina: ${total.toFixed(1)} s`);
  console.log(`Errores de página: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log('  ', e));
  fs.writeFileSync(path.join(OUT, 'resumen.json'), JSON.stringify({ results, clicks, totalSeconds: total, errors }, null, 2));
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => {
  console.error('FALLÓ el guion:', e.message);
  process.exit(1);
});
