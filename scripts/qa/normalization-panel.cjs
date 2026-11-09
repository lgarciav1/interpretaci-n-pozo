/*
 * Prueba de punta a punta de la normalización de curvas (docs/decisiones/0060) sobre el HTML construido, abierto por
 * file://, con los perfiles REALES del TP. Uso: `npm run build && node scripts/qa/normalization-panel.cjs [carpeta]`
 * (por defecto docs/capturas/normalizacion). Usa el Playwright y el Chromium instalados; sale con 1 si algo falla o hay
 * errores de página. Modelo: scripts/qa/preparation-panel.cjs.
 *
 * Flujo: cargar los datos del TP (asistente de 3 pasos) → excluir los picos de NPHI (espurios) → Normalizar NPHI
 * (P5/P95 → referencias) con histograma antes/después → arrastrar un marcador (y Escape) → aplicar, deshacer, rehacer →
 * guardar el proyecto v7 y reabrirlo → exportar LAS → capturas claro/oscuro, ancho/angosto.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = process.cwd();
const OUT = path.resolve(process.argv[2] || 'docs/capturas/normalizacion');
const DL = fs.mkdtempSync(path.join(os.tmpdir(), 'pozo-normalizacion-'));
fs.mkdirSync(OUT, { recursive: true });
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
const status = (page) => page.locator('.prep-apply__status').innerText();
async function waitStatus(page, re, timeout = 60000) {
  try {
    await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.prep-apply__status')?.textContent ?? ''), re.source, { timeout });
  } catch (e) {
    await page.screenshot({ path: `${OUT}/_fallo.png` }).catch(() => {});
    throw new Error(`Estado esperado ${re}; actual: «${await page.locator('.prep-apply__status').innerText().catch(() => '?')}»`);
  }
}
async function selectCurve(page, mnemonic) {
  await page.locator(`.prep-card[data-curve="${mnemonic}"]`).click();
  await page.waitForTimeout(300);
}
async function openTool(page, title) {
  await page.locator('.prep-tile', { hasText: title }).click();
  await page.waitForTimeout(200);
}
const applyBtn = (page) => page.locator('.prep-tool .prep-apply__buttons button', { hasText: 'Aplicar' });
const stageDetail = (page, label) => page.locator('.prep-pipe__node', { hasText: label }).locator('.prep-pipe__detail').innerText();
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
  await page.waitForTimeout(300);
  await page.locator(target).screenshot({ path: `${OUT}/${name}.png` });
  log('captura', name);
}
const histData = (page) => page.locator('.prep-norm-hist__canvas').evaluate((c) => c.toDataURL());
const chartData = (page) => page.locator('.prep-chart__canvas').evaluate((c) => c.toDataURL());
const levelField = (page, i) => page.locator('.prep-norm-table tbody tr').nth(i).locator('input').first();
const refField = (page, i) => page.locator('.prep-norm-table tbody tr').nth(i).locator('input').nth(1);
const sourceCell = (page, i) => page.locator('.prep-norm-table tbody tr').nth(i).locator('.prep-norm-table__source').innerText();
const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.').replace('−', '-'));
/** x del marcador en el canvas del histograma: recorre buscando el cursor de arrastre. */
async function markerXs(page) {
  const c = page.locator('.prep-norm-hist__canvas');
  await c.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const b = await c.boundingBox();
  const xs = [];
  let inside = false;
  for (let x = b.x + 2; x < b.x + b.width - 2; x += 2) {
    await page.mouse.move(x, b.y + b.height / 2);
    const on = (await c.evaluate((el) => el.style.cursor)) === 'ew-resize';
    if (on && !inside) xs.push(x);
    inside = on;
  }
  return { b, xs: xs.map((x) => x + 10) };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1300 }, acceptDownloads: true });
  // Estas comprobaciones recorren el dock de abajo: se fija esa disposición (la de fábrica es el panel lateral,
  // docs/decisiones/0068, y la columna del pozo arranca plegada en ventanas angostas, 0069).
  await ctx.addInitScript(() => {
    try {
      if (localStorage.getItem('pozo.ui.layout') === null) {
        localStorage.setItem('pozo.ui.layout.v', '2');
        localStorage.setItem('pozo.ui.layout', JSON.stringify({ panels: 'bottom', leftCollapsed: false }));
      }
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + ROOT + '/dist/index.html?inicio=no');
  await page.waitForTimeout(1200);

  // 1. Datos reales del TP: Cargar pozo → Cargar datos del TP → asistente (Archivo → Columnas → Control de calidad).
  await page.getByRole('button', { name: 'Cargar pozo' }).first().click();
  await page.getByRole('button', { name: /Cargar datos del TP/ }).click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Siguiente: control de calidad' }).click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cargar', exact: true }).click();
  await page.waitForTimeout(2500);

  // 2. Ctrl+K «Normalizar curva» abre el panel con la herramienta.
  await palette(page, 'Normalizar curva');
  await page.locator('.prep').waitFor({ state: 'visible' });
  await page.locator('.prep-tool', { hasText: 'Normalizar' }).waitFor();
  assert(true, 'Ctrl+K «Normalizar curva» abre Preparar datos con la herramienta');
  await page.locator('.prep-tool__close').click();
  await palette(page, 'Ocultar la columna del pozo');
  await palette(page, 'Ocultar el panel del paso');
  await page.getByRole('separator', { name: 'Alto de los paneles' }).focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(400);

  // 3. NPHI: excluir los picos (hasta 3,3 v/v) con la búsqueda de espurios antes de normalizar.
  await selectCurve(page, 'NPHI');
  await page.locator('.prep-range select').selectOption({ label: 'Pozo completo' });
  await openTool(page, 'Normalizar');
  await page.locator('.prep-norm-table').waitFor();
  const rawP95 = num(await sourceCell(page, 1));
  log('NPHI original: P5 =', await sourceCell(page, 0), '· P95 =', rawP95);
  await page.locator('.prep-tool__close').click();
  // Los picos (3,317 / 3,317 / 0,788 v/v) están en 8.498,89–8.499,20 m: vista exacta y «Excluir toda la vista».
  const setView = async (top, base) => {
    for (const [name, v] of [['Tope de la vista (m MD)', top], ['Base de la vista (m MD)', base]]) {
      const f = page.getByRole('textbox', { name, exact: true }).or(page.getByLabel(name, { exact: true })).first();
      await f.fill(v);
      await f.press('Enter');
    }
    await page.waitForTimeout(300);
  };
  await setView('8498,8', '8499,25');
  await openTool(page, 'Excluir tramo');
  await page.getByRole('button', { name: 'Excluir toda la vista' }).click();
  await waitStatus(page, /pasan a sin dato/);
  log('exclusión de picos:', (await status(page)).replace(/\s+/g, ' '));
  await applyBtn(page).click();
  await page.locator('.prep-applied', { hasText: 'Excluir mediciones de NPHI' }).waitFor();
  const excluded = await waitStage(page, 'Exclusión', /excluidas/);
  assert(/^3 excluidas$/.test(excluded), `los tres picos de NPHI excluidos (${excluded})`);
  await page.locator('.prep-range select').selectOption({ label: 'Pozo completo' });
  await page.waitForTimeout(300);

  // 4. Normalizar NPHI: intervalo = pozo completo, P5/P95.
  await openTool(page, 'Normalizar');
  await page.locator('.prep-norm-hist__canvas').waitFor();
  await waitStatus(page, /coinciden con los percentiles de origen/);
  assert(await applyBtn(page).isDisabled(), 'con referencias = origen (identidad), Aplicar está deshabilitado y dice por qué');
  const p5 = num(await sourceCell(page, 0)), p95 = num(await sourceCell(page, 1));
  const samples = (await page.locator('.prep-norm-caption').innerText()).replace(/\s+/g, ' ');
  log(`NPHI sin picos: P5 = ${p5} · P95 = ${p95} v/v · ${samples}`);
  assert(p95 < rawP95 + 1e-9, 'los percentiles salen de la curva sin los picos excluidos');
  await shot(page, 'claro-ancho-identidad');
  const h0 = await histData(page), c0 = await chartData(page);
  // Referencias elegidas (como de un pozo vecino): P5 → 0,12 v/v y P95 → 0,30 v/v.
  await refField(page, 0).fill('0,12');
  await refField(page, 0).press('Enter');
  await refField(page, 1).fill('0,3');
  await refField(page, 1).press('Enter');
  await waitStatus(page, /muestras normalizadas/);
  const summary = (await status(page)).replace(/\s+/g, ' ');
  log('vista previa:', summary);
  assert((await histData(page)) !== h0, 'el histograma dibuja el después (vista previa)');
  assert((await chartData(page)) !== c0, 'el gráfico central antes/después muestra la vista previa');
  assert(/en vista previa/.test(await page.locator('.prep-pipe__node', { hasText: 'Normalización' }).getAttribute('aria-label')), 'la etapa Normalización queda en vista previa');
  await shot(page, 'claro-ancho-vista-previa');

  // 5. Arrastrar el marcador P5 (y Escape a mitad de otro arrastre).
  const { b, xs } = await markerXs(page);
  assert(xs.length >= 2, `dos marcadores arrastrables en el histograma (${xs.length})`);
  const y = b.y + b.height / 2;
  await page.mouse.move(xs[0], y);
  await page.mouse.down();
  await page.mouse.move(xs[0] + 30, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await levelField(page, 0).inputValue();
  assert(dragged !== '5,0', `arrastrar P5 cambia el percentil bajo (5,0 → ${dragged})`);
  const again = (await markerXs(page)).xs;
  await page.mouse.move(again[0], y);
  await page.mouse.down();
  await page.mouse.move(again[0] - 20, y, { steps: 6 });
  const mid = await levelField(page, 0).inputValue();
  await page.keyboard.press('Escape');
  await page.mouse.move(again[0] - 40, y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert((await levelField(page, 0).inputValue()) === dragged && mid !== dragged, `Escape durante el arrastre vuelve al nivel del comienzo (${mid} → ${dragged})`);
  // Volver a P5 escribiendo el nivel.
  await levelField(page, 0).fill('5');
  await levelField(page, 0).press('Enter');
  await waitStatus(page, /muestras normalizadas \(P5 /);
  const final = (await status(page)).replace(/\s+/g, ' ');
  log('normalización a aplicar:', final);
  const domain = await page.locator('.prep-tool .prep-warn').allInnerTexts();
  if (domain.length) log('aviso de dominio:', domain.join(' | ').replace(/\s+/g, ' '));
  await shot(page, 'claro-ancho-normalizacion');
  await page.locator('.prep-tool').screenshot({ path: `${OUT}/claro-herramienta.png` });

  // 6. Aplicar (un paso), deshacer y rehacer.
  await applyBtn(page).click();
  await page.locator('.prep-applied', { hasText: 'Normalizar NPHI' }).waitFor();
  const applied = await waitStage(page, 'Normalización', /normalizadas/);
  assert(/normalizadas/.test(applied), `normalización aplicada en la tubería (${applied})`);
  const flags = (await page.locator('.prep-flags').innerText()).replace(/\s+/g, ' ');
  assert(/Normalizada/.test(flags), `la barra de banderas muestra «Normalizada» (${flags})`);
  await shot(page, 'claro-ancho-aplicada');
  await page.locator('.prep-applied').getByRole('button', { name: 'Deshacer' }).click();
  assert((await waitStage(page, 'Normalización', /^Sin aplicar$/)) === 'Sin aplicar', 'Deshacer quita solo la normalización');
  assert(/^3 excluidas$/.test(await waitStage(page, 'Exclusión', /excluidas/)), 'la exclusión de picos sigue aplicada');
  await page.locator('.prep-box__title').click();
  await page.keyboard.press('Control+Shift+z');
  const redone = await waitStage(page, 'Normalización', /normalizadas/);
  assert(redone === applied, `Rehacer la vuelve a aplicar (${redone})`);

  // 7. Guardadas, guardar v7 y exportar LAS.
  await page.getByRole('tab', { name: /Guardadas/ }).click();
  await page.locator('.prep-saved__card').first().waitFor();
  const savedText = await page.locator('.prep-saved').innerText();
  assert(/Normalización/.test(savedText) && /dos puntos/.test(savedText), 'Guardadas muestra la normalización');
  await shot(page, 'claro-ancho-guardadas');
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /^Guardar proyecto/ }).click()]);
  const file = DL + '/normalizado.pozo.json';
  await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const prep = json.project.wells.map((w) => w.interpretation.preparation).find(Boolean);
  const node = prep.nodes.find((n) => n.kind === 'linear-normalization');
  assert(json.version === 7 && prep.schemaVersion === 6 && !!node, `proyecto v7 con preparación v6 (${JSON.stringify(node && node.normalization)})`);
  await page.getByTestId('export-open').click();
  const exp = page.getByRole('dialog', { name: 'Exportar', exact: true });
  await exp.getByRole('radio', { name: 'LAS 2.0', exact: true }).click();
  const [lasDl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), exp.getByRole('button', { name: 'Exportar', exact: true }).click()]);
  const lasFile = DL + '/' + lasDl.suggestedFilename();
  await lasDl.saveAs(lasFile);
  // Con el sumario por zona, la exportación es un .zip (curvas + sumario).
  const las = /\.zip$/i.test(lasFile) ? require('child_process').execFileSync('unzip', ['-p', lasFile, '*.las'], { maxBuffer: 64 << 20 }).toString('utf8') : fs.readFileSync(lasFile, 'utf8');
  log('archivo exportado:', path.basename(lasFile));
  const lasLines = las.split('\n').filter((l) => /Normalizaci/.test(l));
  if (!lasLines.length) log('cabecera LAS:', las.split('~A')[0].split('~C')[1]);
  assert(lasLines.length >= 2 && las.includes('256=normalizada'), `el LAS declara la normalización en la curva y su QC (${lasLines.length} líneas)`);
  log('LAS:', lasLines[lasLines.length - 1].slice(0, 260));
  await page.keyboard.press('Escape');

  // 8. Oscuro (ancho) y angosto, editando la normalización aplicada (P95 → 0,31).
  await page.getByRole('tab', { name: /Limpieza/ }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(500);
  await openTool(page, 'Normalizar');
  await waitStatus(page, /Es la normalización aplicada/);
  assert(true, 'reabrir la herramienta sobre la normalización aplicada no propone un cambio vacío');
  await refField(page, 1).fill('0,31');
  await refField(page, 1).press('Enter');
  await waitStatus(page, /0,31 v\/v\)/);
  // Esperar a que se vayan los avisos (proyecto guardado, datos exportados).
  await page.waitForFunction(() => !document.querySelector('.ui-toast'), null, { timeout: 20000 }).catch(() => log('aviso: quedan toasts en pantalla'));
  await page.waitForTimeout(800);
  await shot(page, 'oscuro-ancho-normalizacion');
  await page.locator('.prep-tool').screenshot({ path: `${OUT}/oscuro-herramienta.png` });
  await palette(page, 'Mostrar la columna del pozo');
  await palette(page, 'Mostrar el panel del paso');
  await page.setViewportSize({ width: 1180, height: 1300 });
  await page.waitForTimeout(700);
  await page.locator('.prep-tool').scrollIntoViewIfNeeded();
  await shot(page, 'oscuro-angosto-normalizacion');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(500);
  await shot(page, 'claro-angosto-normalizacion');
  await page.locator('.prep-tool').screenshot({ path: `${OUT}/claro-angosto-herramienta.png` });

  // 9. Reabrir el proyecto guardado: la normalización sigue intacta.
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => errors.push('p2: ' + String(e)));
  await page2.setViewportSize({ width: 1600, height: 1300 });
  await page2.goto('file://' + ROOT + '/dist/index.html?inicio=no');
  await page2.waitForTimeout(1000);
  await page2.locator('.shell-topbar input[type=file]').setInputFiles(file);
  await page2.getByText('Proyecto abierto', { exact: true }).waitFor({ timeout: 60000 });
  await page2.waitForTimeout(1500);
  await page2.getByRole('button', { name: 'Preparar datos', exact: true }).click();
  await page2.getByRole('tab', { name: /Guardadas/ }).click();
  await page2.locator('.prep-saved__card').first().waitFor();
  await page2.waitForTimeout(1500);
  assert((await page2.locator('.prep-saved').innerText()) === savedText, 'el proyecto reabierto muestra la misma normalización (con sus percentiles de origen)');
  await page2.getByRole('tab', { name: /Limpieza/ }).click();
  await page2.locator(`.prep-card[data-curve="NPHI"]`).click();
  const reopened = await waitStage(page2, 'Normalización', /normalizadas/);
  assert(reopened === applied, `la tubería reabierta cuenta lo mismo (${reopened})`);

  console.log('ERRORES DE PÁGINA:', JSON.stringify(errors));
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
