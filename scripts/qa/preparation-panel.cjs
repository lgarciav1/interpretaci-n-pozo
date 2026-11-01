/*
 * Prueba de punta a punta del panel «Preparar datos» (docs/decisiones/0058) sobre el HTML construido, abierto por
 * file://. Uso: `npm run build && node scripts/qa/preparation-panel.cjs [carpeta de capturas]` (por defecto
 * docs/capturas/preparacion). Usa el Playwright y el Chromium instalados en la máquina; sale con 1 si algo falla o hay
 * errores de página.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = process.cwd();
const OUT = path.resolve(process.argv[2] || 'docs/capturas/preparacion');
const DL = fs.mkdtempSync(path.join(os.tmpdir(), 'pozo-preparacion-'));
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DL, { recursive: true });
const log = (...a) => console.log('·', ...a);
const assert = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); log('ok:', m); };

async function palette(page, text) {
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}
const prep = (page) => page.locator('.prep');
const canvasData = (page) => page.locator('.prep-chart__canvas').evaluate((c) => c.toDataURL());
const status = (page) => page.locator('.prep-apply__status').innerText();
async function waitStatus(page, re, timeout = 60000) {
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.prep-apply__status')?.textContent ?? ''), re.source, { timeout });
}
async function selectCurve(page, mnemonic) {
  await page.locator(`.prep-card[data-curve="${mnemonic}"]`).click();
  await page.waitForTimeout(300);
}
async function openTool(page, title) {
  await page.locator('.prep-tile', { hasText: title }).click();
  await page.waitForTimeout(200);
}
async function drag(page, f0, f1) {
  const c = page.locator('.prep-chart__canvas');
  await c.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const b = await c.boundingBox();
  const gutter = await page.evaluate(() => 118 * (Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1));
  const w = b.width - gutter - 8;
  const y = b.y + 80;
  await page.mouse.move(b.x + gutter + w * f0, y);
  await page.mouse.down();
  await page.mouse.move(b.x + gutter + w * ((f0 + f1) / 2), y, { steps: 4 });
  await page.mouse.move(b.x + gutter + w * f1, y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}
const applyBtn = (page) => page.locator('.prep-tool .prep-apply__buttons button', { hasText: 'Aplicar' });
async function stageDetail(page, label) {
  return page.locator('.prep-pipe__node', { hasText: label }).locator('.prep-pipe__detail').innerText();
}
async function waitStage(page, label, re, timeout = 30000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeout) {
    last = await stageDetail(page, label);
    if (re.test(last)) return last;
    await page.waitForTimeout(250);
  }
  return last;
}
async function shot(page, name, target = '.shell-dock') {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(250);
  await page.locator(target).screenshot({ path: `${OUT}/${name}.png` });
  log('captura', name);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1300 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + ROOT + '/dist/index.html');
  await page.waitForTimeout(1200);
  await palette(page, 'Usar los datos del TP');
  await page.getByRole('button', { name: 'Siguiente: control de calidad' }).click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cargar', exact: true }).click();
  await page.waitForTimeout(2500);

  // 1. Abrir por el botón de la columna izquierda.
  await page.getByRole('button', { name: 'Preparar datos', exact: true }).click();
  await prep(page).waitFor();
  assert(await page.getByRole('tab', { name: /Preparar datos/ }).getAttribute('aria-selected') === 'true', 'el botón abre la pestaña Preparar datos');
  // 2. Por la paleta: primero otra pestaña.
  await page.getByRole('tab', { name: /Resultados/ }).click();
  assert(!(await prep(page).isVisible()), 'otra pestaña oculta el panel');
  await palette(page, 'Abrir Preparar datos');
  await prep(page).waitFor({ state: 'visible' });
  assert(await prep(page).isVisible(), 'Ctrl+K «Abrir Preparar datos» abre el panel');

  // Vista ancha: sin columnas laterales.
  await palette(page, 'Ocultar la columna del pozo');
  await palette(page, 'Ocultar el panel del paso');
  await page.waitForTimeout(500);
  // Más alto para las capturas (el usuario lo hace con el separador).
  await page.getByRole('separator', { name: 'Alto de los paneles' }).focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(400);

  // 3. GR
  await selectCurve(page, 'GR');
  assert(await page.locator('.prep-card.is-selected').getAttribute('data-curve') === 'GR', 'GR elegida');
  await page.locator('.prep-range select').selectOption({ label: 'Zona B' });
  await page.waitForTimeout(400);
  await shot(page, 'claro-ancho-inicio');
  const flagsBefore = await page.locator('.prep-flags').innerText();
  const c0 = await canvasData(page);

  // 4. Exclusión con vista previa.
  await openTool(page, 'Excluir tramo');
  assert((await status(page)).includes('Marcá el tramo a excluir'), 'motivo visible antes de marcar el tramo');
  assert(await applyBtn(page).isDisabled(), 'Aplicar deshabilitado sin tramo');
  await drag(page, 0.42, 0.5);
  await waitStatus(page, /pasan a sin dato/);
  const c1 = await canvasData(page);
  assert(c1 !== c0, 'el gráfico antes/después cambia con la vista previa');
  const flagsPreview = await page.locator('.prep-flags').innerText();
  assert(flagsPreview !== flagsBefore, 'la leyenda de banderas cambia (excluidas)');
  assert((await stageDetail(page, 'Exclusión')).match(/excluidas/), 'la tubería muestra el conteo en vista previa');
  await shot(page, 'claro-ancho-exclusion-vista-previa');
  await applyBtn(page).click();
  await page.locator('.prep-applied', { hasText: 'Excluir mediciones de GR' }).waitFor();
  const excl = await waitStage(page, 'Exclusión', /excluidas/);
  assert(/excluidas/.test(excl), `exclusión aplicada en la tubería (${excl})`);
  // Deshacer desde el aviso y rehacer con el teclado.
  await page.locator('.prep-applied').getByRole('button', { name: 'Deshacer' }).click();
  assert((await waitStage(page, 'Exclusión', /^Sin aplicar$/)) === 'Sin aplicar', 'Deshacer quita la exclusión');
  await page.locator('.prep-box__title').click();
  await page.keyboard.press('Control+Shift+z');
  const redone = await waitStage(page, 'Exclusión', /excluidas/);
  assert(/excluidas/.test(redone), `Rehacer la vuelve a aplicar (${redone})`);

  // 5. Espurios (NPHI tiene picos de hasta 3,3).
  await selectCurve(page, 'NPHI');
  await page.locator('.prep-range select').selectOption({ label: 'Pozo completo' });
  await openTool(page, 'Buscar espurios');
  await page.waitForFunction(() => /candidatos en/.test(document.querySelector('.prep-status')?.textContent ?? ''), null, { timeout: 30000 });
  const cand = await page.locator('.prep-status').innerText();
  log('espurios NPHI:', cand.replace(/\s+/g, ' '));
  await shot(page, 'claro-ancho-espurios');
  const nCand = Number((cand.match(/^([\d.]+)/) || ['', '0'])[1].replace(/\./g, ''));
  if (nCand > 0) {
    await page.getByRole('button', { name: 'Elegir todos' }).click();
    await waitStatus(page, /pasan a sin dato/);
    await applyBtn(page).click();
    await page.locator('.prep-applied', { hasText: 'Excluir mediciones de NPHI' }).waitFor();
    log('espurios excluidos:', await stageDetail(page, 'Exclusión'));
  }

  // 6. Interpolar: GR no tiene huecos (motivo); SP sí.
  await selectCurve(page, 'GR');
  await openTool(page, 'Interpolar huecos');
  await waitStatus(page, /No hay huecos/);
  assert(true, 'GR sin huecos: el motivo lo dice');
  await page.locator('.prep-tool__close').click();
  await selectCurve(page, 'SP');
  await openTool(page, 'Interpolar huecos');
  const slider = page.locator('.prep-tool input[type=range]').first();
  await slider.focus();
  for (let k = 0; k < 14; k++) await page.keyboard.press('ArrowRight');
  await waitStatus(page, /muestras estimadas|No hay huecos/);
  log('SP:', (await status(page)).replace(/\s+/g, ' '));
  if (/muestras estimadas/.test(await status(page))) {
    await shot(page, 'claro-ancho-interpolacion');
    await applyBtn(page).click();
    await page.locator('.prep-applied', { hasText: 'Interpolar faltantes de SP' }).waitFor();
  }

  // 7. Mediana sobre GR.
  await selectCurve(page, 'GR');
  await page.locator('.prep-range select').selectOption({ label: 'Zona B' });
  await openTool(page, 'Mediana móvil');
  const before = await canvasData(page);
  // Escape durante el arrastre del slider vuelve al valor anterior.
  const radius = page.locator('.prep-tool input[type=range]').first();
  const rb = await radius.boundingBox();
  const val0 = await page.locator('.prep-tool .ui-input--number input').first().inputValue();
  await page.mouse.move(rb.x + 4, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width * 0.6, rb.y + rb.height / 2, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.move(rb.x + rb.width * 0.8, rb.y + rb.height / 2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const val1 = await page.locator('.prep-tool .ui-input--number input').first().inputValue();
  assert(val0 === val1, `Escape durante el arrastre restaura el radio (${val0} → ${val1})`);
  const pos = Number(await radius.inputValue());
  assert(pos < 0.3, `el riel del slider vuelve a su lugar tras Escape (${pos.toFixed(2)})`);
  await waitStatus(page, /muestras filtradas/);
  assert((await canvasData(page)) !== before, 'el gráfico muestra la mediana en vista previa');
  await shot(page, 'claro-ancho-mediana');
  await applyBtn(page).click();
  await page.locator('.prep-applied', { hasText: 'Filtrar con mediana GR' }).waitFor();
  assert(/filtradas/.test(await waitStage(page, 'Mediana', /filtradas/)), 'mediana aplicada en la tubería');

  // 8. Alinear GR con la declaración del datum.
  await openTool(page, 'Alinear en profundidad');
  await waitStatus(page, /datum/);
  log('motivo sin datum:', (await status(page)).trim());
  await page.getByRole('textbox', { name: 'Datum declarado de origen y destino' }).fill('KB');
  await waitStatus(page, /Tildá la declaración del datum/);
  assert(true, 'el motivo anticipa la declaración del datum');
  await page.getByRole('checkbox', { name: /Declaro que la curva/ }).check();
  await waitStatus(page, /desplazamiento distinto de cero/);
  const off = page.locator('.prep-tool .ui-input--number input').first();
  await off.fill('0,6');
  await off.press('Enter');
  await waitStatus(page, /salidas con dato/);
  await shot(page, 'claro-ancho-alineacion');
  await applyBtn(page).click();
  await page.locator('.prep-applied', { hasText: 'Alinear curva GR' }).waitFor();
  await page.waitForTimeout(1500);
  const al = await stageDetail(page, 'Alineación');
  assert(/\+0,6/.test(al), `alineación aplicada (${al})`);
  await shot(page, 'claro-ancho-aplicado');
  {
    const c = page.locator('.prep-chart__canvas');
    await c.scrollIntoViewIfNeeded();
    const b = await c.boundingBox();
    await page.mouse.move(b.x + b.width * 0.47, b.y + 90);
    await page.waitForTimeout(300);
    const readout = await page.locator('.prep-chart__readout').innerText();
    assert(/MD/.test(readout) && /Original/.test(readout), `lectura bajo el cursor (${readout.replace(/\s+/g, ' ')})`);
    await page.locator('.shell-dock').screenshot({ path: `${OUT}/claro-ancho-lectura-cursor.png` });
  }

  // 9. Guardadas + guardar el proyecto y reabrirlo.
  await page.getByRole('tab', { name: /Guardadas/ }).click();
  await page.locator('.prep-saved__card').first().waitFor();
  const savedCards = await page.locator('.prep-saved__card').count();
  assert(savedCards >= 2, `preparaciones guardadas (${savedCards})`);
  await shot(page, 'claro-ancho-guardadas');
  const savedText = await page.locator('.prep-saved').innerText();
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /^Guardar proyecto/ }).click()]);
  const file = DL + '/preparado.pozo.json';
  await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(json.version === 7, 'el proyecto se guarda en formato v7');

  // Tema oscuro (mismas vistas).
  await page.getByRole('tab', { name: /Limpieza/ }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(500);
  await shot(page, 'oscuro-ancho-aplicado');
  await openTool(page, 'Excluir tramo');
  await drag(page, 0.3, 0.36);
  await waitStatus(page, /pasan a sin dato/);
  await shot(page, 'oscuro-ancho-exclusion-vista-previa');
  await page.locator('.prep-tool__close').click();
  await page.getByRole('tab', { name: /DRX/ }).click();
  await page.waitForTimeout(400);
  await shot(page, 'oscuro-ancho-drx');
  await page.getByRole('tab', { name: /Limpieza/ }).click();

  // Angosto: columnas visibles y ventana más chica.
  await palette(page, 'Mostrar la columna del pozo');
  await palette(page, 'Mostrar el panel del paso');
  await page.setViewportSize({ width: 1180, height: 1300 });
  await page.waitForTimeout(600);
  await shot(page, 'oscuro-angosto');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(400);
  await openTool(page, 'Mediana móvil');
  await waitStatus(page, /muestras filtradas|No hay ventanas/);
  await page.locator('.prep-tool').scrollIntoViewIfNeeded();
  await shot(page, 'claro-angosto-mediana');
  await page.locator('.prep-tool__close').click();

  // Paso Calidad: tarjeta que lleva al panel.
  await page.getByRole('tab', { name: /Resultados/ }).click();
  await palette(page, 'Ir al paso Calidad');
  await page.locator('.qc-prep-card').waitFor();
  await page.locator('.qc-prep-card').screenshot({ path: `${OUT}/claro-paso-calidad-tarjeta.png` });
  await page.locator('.qc-prep-card').getByRole('button', { name: 'Abrir Preparar datos' }).click();
  await prep(page).waitFor({ state: 'visible' });
  assert(true, 'la tarjeta del paso Calidad abre el panel');

  // Reabrir el proyecto guardado en una página nueva: se ve igual.
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => errors.push('p2: ' + String(e)));
  await page2.setViewportSize({ width: 1600, height: 1300 });
  await page2.goto('file://' + ROOT + '/dist/index.html');
  await page2.waitForTimeout(1000);
  await page2.locator('.shell-topbar input[type=file]').setInputFiles(file);
  await page2.getByText('Proyecto abierto', { exact: true }).waitFor({ timeout: 60000 });
  await page2.waitForTimeout(1500);
  await page2.getByRole('button', { name: 'Preparar datos', exact: true }).click();
  await page2.getByRole('tab', { name: /Guardadas/ }).click();
  await page2.locator('.prep-saved__card').first().waitFor();
  assert((await page2.locator('.prep-saved').innerText()) === savedText, 'el proyecto reabierto muestra las mismas preparaciones');

  console.log('ERRORES DE PÁGINA:', JSON.stringify(errors));
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
