/*
 * Prueba de punta a punta del Log Digitizer (docs/decisiones/0063) sobre el HTML construido, abierto por file://,
 * para tres cosas que quedaban sin validar en el navegador:
 *
 *  (1) PERSPECTIVA con 4 esquinas: un registro «fotografiado en ángulo» (homografía conocida) se rectifica marcando las
 *      4 esquinas del marco; se calibra, se traza el GR y el LAS exportado se compara con la verdad.
 *  (2) CURVA SIN ROL en el visor: se agrega al pozo del TP (que ya tiene GR, así que entra como GR_DIG sin rol), no
 *      aparece en las pistas de fábrica, «Mostrar en el visor» crea su pista, y Ctrl+Z / Ctrl+Mayús+Z la quitan y la
 *      devuelven.
 *  (3) «ABRIR SESIÓN»: guardar la sesión, recargar la página (se pierde todo lo que está en memoria), abrirla con el
 *      selector de archivos, comprobar que vuelven la geometría, la calibración y la curva, exportar otra vez y
 *      comparar con la verdad; y un archivo que no es una sesión se rechaza con un aviso, sin romper la mesa.
 *
 * Uso: npm run build
 *      python3 scripts/qa/make-digitizer-scan.py <carpeta de datos>
 *      node scripts/qa/log-digitizer-perspectiva-sesion.cjs <carpeta de datos> [carpeta de capturas]
 *   (capturas por defecto: docs/capturas/log-digitizer). Sale con 1 si algo falla o hay errores de página.
 *
 * Todo con clics reales sobre el lienzo. Los puntos que «mira» la usuaria (las 4 esquinas del marco, las líneas de
 * grilla, los bordes de la pista y un píxel de la curva) se calculan con la geometría conocida del generador.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = path.resolve(process.argv[2] || 'scan');
const SCAN = path.join(DATA, 'scan-perspectiva.png');
const M = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
const OUT = path.resolve(process.argv[3] || 'docs/capturas/log-digitizer');
const DL = fs.mkdtempSync(path.join(os.tmpdir(), 'pozo-digitizer-persp-'));
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('·', ...a);
const ERRORS = [];
let PAGE = null;
const results = {};
const assert = async (c, m) => {
  if (!c) {
    if (PAGE) await PAGE.screenshot({ path: `${OUT}/error-perspectiva.png` }).catch(() => {});
    throw new Error('FALLÓ: ' + m);
  }
  log('ok:', m);
};

// ── geometría conocida del generador ─────────────────────────────────────────
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Tamaño de la imagen rectificada: el mismo criterio que la mesa (promedio de lados opuestos). */
const quadSize = (q) => ({ w: Math.max(2, Math.round((dist(q[0], q[1]) + dist(q[3], q[2])) / 2)), h: Math.max(2, Math.round((dist(q[0], q[3]) + dist(q[1], q[2])) / 2)) });
const SIZE = quadSize(M.quad);
const FX0 = M.L - M.M;
const FX1 = M.R + M.M;
const FY0 = M.TOP - M.M;
const FY1 = M.BOT + M.M;
/** De la coordenada frontal (la del generador) a la de la imagen rectificada (esquinas del marco → esquinas de la imagen). */
const toCorrected = (x, y) => [((x - FX0) / (FX1 - FX0)) * (SIZE.w - 1), ((y - FY0) / (FY1 - FY0)) * (SIZE.h - 1)];
const rowOfDepth = (d) => M.TOP + (d - M.D0) / M.DZ;

// ── LAS mínimo y comparación (como en log-digitizer.cjs) ─────────────────────────────────
function readLas(text) {
  let sect = '';
  const names = [];
  let nul = -999.25;
  const rows = [];
  for (const l of text.split(/\r?\n/)) {
    if (l.startsWith('~')) {
      sect = l[1].toUpperCase();
      continue;
    }
    if (!l.trim() || l.startsWith('#')) continue;
    if (sect === 'W' && /^\s*NULL\s*\./i.test(l)) nul = parseFloat(l.split(':')[0].split('.').slice(1).join('.').trim().split(/\s+/).pop());
    if (sect === 'C') names.push(l.trim().split(/[.\s]/)[0]);
    if (sect === 'A') rows.push(l.trim().split(/\s+/).map(Number));
  }
  const col = (n) => rows.map((r) => r[names.indexOf(n)]).map((v) => (v === nul ? NaN : v));
  return { names, col };
}
function interp(xs, ys, x) {
  if (x < xs[0] || x > xs[xs.length - 1]) return NaN;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m;
    else hi = m;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}
function compare(z, v, zt, vt, range) {
  const ok = z.map((_, i) => i).filter((i) => Number.isFinite(v[i]));
  const zz = ok.map((i) => z[i]);
  const vv = ok.map((i) => v[i]);
  let n = 0;
  let se = 0;
  const a = [];
  const b = [];
  for (let i = 0; i < zt.length; i++) {
    const d = interp(zz, vv, zt[i]);
    if (!Number.isFinite(d)) continue;
    n++;
    se += (d - vt[i]) ** 2;
    a.push(d);
    b.push(vt[i]);
  }
  const mean = (x) => x.reduce((s, y) => s + y, 0) / x.length;
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  const rmse = Math.sqrt(se / n);
  return { rmse, pct: (100 * rmse) / range, r: sab / Math.sqrt(saa * sbb), coverage: n / zt.length, n };
}

// ── interacción ───────────────────────────────────────────────────────────
const canvas = (page) => page.locator('[data-testid="digitizer-canvas"]');
async function view(page) {
  const c = canvas(page);
  const box = await c.boundingBox();
  const [scale, ox, oy] = (await c.getAttribute('data-viewport')).split(' ').map(Number);
  return { box, scale, ox, oy };
}
async function toScreen(page, x, y) {
  const v = await view(page);
  return { x: v.box.x + v.ox + (x + 0.5) * v.scale, y: v.box.y + v.oy + (y + 0.5) * v.scale, v };
}
/** Desplaza la vista (barra espaciadora + arrastre, como una usuaria) hasta que el punto quede a la vista. */
async function ensureVisible(page, x, y) {
  for (let k = 0; k < 25; k++) {
    const s = await toScreen(page, x, y);
    const { box } = s.v;
    const inside = s.x > box.x + 40 && s.x < box.x + box.width - 40 && s.y > box.y + 60 && s.y < box.y + box.height - 60;
    if (inside) return s;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const okX = s.x > box.x + 40 && s.x < box.x + box.width - 40;
    const dx = okX ? 0 : Math.max(-box.width / 2 + 20, Math.min(box.width / 2 - 20, cx - s.x));
    const dy = Math.max(-box.height / 2 + 20, Math.min(box.height / 2 - 20, cy - s.y));
    await page.mouse.move(cx, cy);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 3 });
    await page.mouse.move(cx + dx, cy + dy, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(80);
  }
  throw new Error(`no se pudo llevar (${x}, ${y}) a la vista: ${JSON.stringify(await view(page))}`);
}
async function clickImg(page, x, y) {
  const s = await ensureVisible(page, x, y);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(60);
}
async function palette(page, text) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}
const side = (page) => page.locator('.dz-side');
async function step(page, name) {
  await page.locator('.dz-desk .ui-stepper').getByRole('button', { name: new RegExp(`^Paso \\d: ${name}`) }).first().click();
  await page.waitForTimeout(150);
}
async function waitJob(page, timeout = 90000) {
  await page.waitForTimeout(100);
  await page.waitForFunction(() => !document.querySelector('.dz-status__job'), null, { timeout });
}
async function shot(page, name, target) {
  await page.mouse.move(3, 3);
  await page.waitForTimeout(200);
  if (target) await page.locator(target).screenshot({ path: `${OUT}/${name}.png` });
  else await page.screenshot({ path: `${OUT}/${name}.png` });
  log('captura', name);
}
async function download(page, fn) {
  const [d] = await Promise.all([page.waitForEvent('download'), fn()]);
  const p = path.join(DL, d.suggestedFilename());
  await d.saveAs(p);
  return p;
}
const closeDesk = async (page) => {
  await page.locator('.dz-desk .ui-dialog__head').getByRole('button', { name: 'Cerrar' }).click();
  await page.waitForTimeout(300);
};
async function loadTp(page) {
  await page.getByRole('button', { name: 'Cargar pozo' }).first().click();
  await page.getByRole('button', { name: /Cargar datos del TP/ }).click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Siguiente: control de calidad' }).click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cargar', exact: true }).click();
  await page.getByText('Pozo cargado.').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
}
/** Las filas de la verdad usadas en la comparación. */
const compareLas = (file) => {
  const las = readLas(fs.readFileSync(file, 'utf8'));
  return compare(las.col(las.names[0]), las.col('GR'), M.depth, M.gr, M.grMax - M.grMin);
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  PAGE = page;
  page.on('pageerror', (e) => ERRORS.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && ERRORS.push(m.text()));
  await page.goto('file://' + path.join(ROOT(), 'dist/index.html') + '?inicio=no');
  await page.waitForTimeout(1500);

  // Pozo del TP primero: la digitalizada de GR va a chocar con su rol (entra sin rol).
  await loadTp(page);
  await palette(page, 'Log Digitizer');
  await assert(await page.locator('.dz-desk').isVisible(), 'la mesa se abre con Ctrl+K «Log Digitizer»');

  // ═══ (1) Perspectiva con 4 esquinas ═══════════════════════════════════════════════════════════════
  await page.setInputFiles('[data-testid="digitizer-image-input"]', SCAN);
  await page.waitForFunction(() => document.querySelector('[data-testid="digitizer-canvas"]')?.dataset.viewport);
  await page.waitForTimeout(500);
  await step(page, 'Geometría');
  await side(page).getByRole('button', { name: /Marcar esquinas/ }).click();
  for (const q of M.quad) await clickImg(page, q[0], q[1]);
  await assert(await side(page).getByText('4 de 4 esquinas').isVisible(), 'las 4 esquinas del marco quedan marcadas');
  await shot(page, 'perspectiva-esquinas-claro');
  await side(page).getByRole('button', { name: 'Aplicar corrección' }).click();
  await waitJob(page);
  await assert(await side(page).getByText('Imagen corregida', { exact: true }).isVisible(), 'la imagen se rectifica en el worker');
  await assert(await side(page).getByText(/perspectiva rectificada/).isVisible(), 'el panel informa «perspectiva rectificada»');
  await assert(await page.getByText(`${SIZE.w} × ${SIZE.h} px`).first().isVisible(), `el tamaño rectificado es ${SIZE.w} × ${SIZE.h} px (el esperado por las esquinas)`);
  await shot(page, 'perspectiva-corregida-claro');

  // Amarres: 4 líneas de grilla de la imagen frontal (cada 100 px = 5 m), llevadas a la imagen rectificada.
  await step(page, 'Profundidad');
  for (const k of [3, 9, 15, 21]) {
    const [u, v] = toCorrected(M.L + 70, M.TOP + 100 * k);
    await clickImg(page, u, v);
    await page.waitForTimeout(80);
    await page.keyboard.type((M.D0 + 100 * k * M.DZ).toFixed(4).replace('.', ','));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
  }
  await assert(await side(page).getByText('Profundidad calibrada').isVisible(), '4 amarres: profundidad calibrada');
  const resid = (await side(page).locator('.dz-kv__row', { hasText: 'Residuo' }).innerText()).replace(/\s+/g, ' ');
  log('residuo', resid);
  results.residual = resid;

  // Curva GR: bordes de la pista (= columnas del marco rectificado), valores 0 y 150, cuentagotas, trazado.
  await step(page, 'Curvas');
  await side(page).getByTestId('digitizer-new-curve').fill('GR');
  await side(page).getByTestId('digitizer-new-curve').press('Enter');
  await page.waitForTimeout(150);
  const midY = toCorrected(M.L, (M.TOP + M.BOT) / 2)[1];
  await clickImg(page, toCorrected(M.L, 0)[0], midY);
  await clickImg(page, toCorrected(M.R, 0)[0], midY);
  const lv = side(page).getByLabel('Valor del borde izquierdo');
  await lv.fill('0');
  await lv.press('Enter');
  const rv = side(page).getByLabel('Valor del borde derecho');
  await rv.fill('150');
  await rv.press('Enter');
  // Cuentagotas sobre un tramo casi vertical de la curva (lo que haría una persona: el centro del trazo).
  let best = 100;
  for (let i = 100; i < M.gr.length - 100; i++) if (Math.abs(M.gr[i + 1] - M.gr[i - 1]) < Math.abs(M.gr[best + 1] - M.gr[best - 1])) best = i;
  const [cu, cv] = toCorrected(M.L + (M.gr[best] / 150) * (M.R - M.L), rowOfDepth(M.depth[best]));
  const eye = side(page).getByRole('button', { name: /Cuentagotas/ });
  if ((await eye.getAttribute('aria-pressed')) !== 'true') await eye.click();
  await clickImg(page, cu, cv);
  await page.waitForTimeout(100);
  await side(page).getByTestId('digitizer-trace').click();
  await waitJob(page);
  await shot(page, 'perspectiva-curva-claro');

  await step(page, 'Revisión');
  await shot(page, 'perspectiva-revision-claro');

  // LAS contra la verdad
  await step(page, 'Importar');
  const las1 = await download(page, () => side(page).getByTestId('digitizer-export-las').click());
  results.perspectiva = compareLas(las1);
  log('(1) GR con perspectiva rectificada:', JSON.stringify(results.perspectiva));
  await assert(results.perspectiva.pct < 3 && results.perspectiva.coverage > 0.9, 'GR rectificado: error < 3 % del rango y cobertura > 90 %');

  // ═══ (2) Curva sin rol: al pozo del TP y al visor ═══════════════════════════════════════════════════════
  const note = await side(page).locator('.dz-out__head', { hasText: 'GR' }).innerText();
  await assert(/entra como GR_DIG/.test(note), 'el pozo del TP ya tiene GR: la digitalizada entra como «GR_DIG» (sin rol)');
  await side(page).getByTestId('digitizer-add-to-well').click();
  await page.waitForTimeout(400);
  const callout = side(page).getByTestId('digitizer-in-viewer');
  await assert(await callout.isVisible(), 'tras agregar, la mesa avisa que las curvas están en el pozo');
  await assert(/no aparece sola en el visor/.test(await callout.innerText()), 'el aviso explica que sin rol no aparece sola en las pistas de fábrica');
  await shot(page, 'visor-ofrece-mostrar-claro');
  await closeDesk(page);
  const gr = page.locator('[aria-label^="GR_DIG: editar escala"]');
  await assert((await gr.count()) === 0, 'GR_DIG NO está en las pistas de fábrica del visor (el problema que se reportó)');
  await palette(page, 'Log Digitizer');
  await step(page, 'Importar');
  await side(page).getByTestId('digitizer-show-in-viewer').click();
  await page.waitForTimeout(600);
  await assert(/Ya están en el visor/.test(await side(page).getByTestId('digitizer-in-viewer').innerText()), 'el aviso pasa a «Ya están en el visor»');
  await closeDesk(page);
  await page.waitForTimeout(500);
  await assert((await gr.count()) === 1, 'GR_DIG aparece en el visor, en su propia pista');
  // «Está en el DOM» no alcanza: el visor es angosto y una pista al final de la lista queda recortada fuera de la vista.
  const inView = await gr.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const clips = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowX === 'visible') continue;
      const q = p.getBoundingClientRect();
      clips.push(r.left >= q.left - 1 && r.right <= q.right + 1);
    }
    return { visible: clips.length > 0 && clips.every(Boolean), clips: clips.length, left: Math.round(r.left), right: Math.round(r.right) };
  });
  log('encabezado dentro del área visible:', JSON.stringify(inView));
  await assert(inView.visible, 'la pista nueva queda dentro del área visible del visor (junto a la profundidad), sin desplazarse');
  await shot(page, 'visor-pista-gr-dig-claro');
  // Escala impresa del registro: 0–150 con GR_DIG (verificado en el encabezado de la pista)
  const head = await page.locator('.wv-head__curves', { has: gr }).first().innerText();
  log('encabezado de la pista:', head.replace(/\s+/g, ' '));
  results.trackHead = head.replace(/\s+/g, ' ');
  await assert(/0/.test(head) && /150/.test(head), 'la pista muestra la escala 0–150 del registro');
  // Deshacer / rehacer: un solo Ctrl+Z quita la pista y deja la curva en el pozo
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  await assert((await gr.count()) === 0, 'Ctrl+Z quita la pista del visor');
  await assert((await page.getByText('GR_DIG', { exact: true }).count()) > 0, 'la curva GR_DIG sigue en el pozo (tabla de curvas)');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(500);
  await assert((await gr.count()) === 1, 'Ctrl+Mayús+Z devuelve la pista');

  // ═══ (3) Guardar sesión, recargar, abrirla ═══════════════════════════════════════════════════════════
  await palette(page, 'Log Digitizer');
  const sess = await download(page, () => page.getByRole('button', { name: 'Guardar sesión' }).click());
  results.sessionBytes = fs.statSync(sess).size;
  log('sesión guardada', path.basename(sess), results.sessionBytes, 'bytes');
  await page.reload();
  await page.waitForTimeout(1500);
  await palette(page, 'Log Digitizer');
  await assert((await page.locator('[data-testid="digitizer-canvas"]').count()) === 0, 'tras recargar, la mesa está vacía (el estado en memoria se perdió)');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Abrir sesión', exact: true }).click();
  await (await chooser).setFiles(sess);
  await page.waitForFunction(() => document.querySelector('[data-testid="digitizer-canvas"]')?.dataset.viewport, null, { timeout: 60000 });
  await page.getByText('Sesión abierta').first().waitFor({ timeout: 30000 });
  await assert(true, 'la sesión se abre desde el selector de archivos («Sesión abierta»)');
  await page.waitForTimeout(800);
  await step(page, 'Geometría');
  await assert(await side(page).getByText(/perspectiva rectificada/).isVisible(), 'la perspectiva rectificada se restauró');
  await step(page, 'Profundidad');
  await assert(await side(page).getByText('Profundidad calibrada').isVisible(), 'los 4 amarres se restauraron (profundidad calibrada)');
  const resid2 = (await side(page).locator('.dz-kv__row', { hasText: 'Residuo' }).innerText()).replace(/\s+/g, ' ');
  await assert(resid2 === results.residual, `el residuo de la calibración es el mismo (${resid2})`);
  await step(page, 'Curvas');
  await assert((await page.locator('.dz-curve').count()) === 1, 'la curva GR se restauró con su traza');
  await shot(page, 'sesion-abierta-claro');
  await step(page, 'Importar');
  const las2 = await download(page, () => side(page).getByTestId('digitizer-export-las').click());
  results.sesion = compareLas(las2);
  log('(3) GR desde la sesión reabierta:', JSON.stringify(results.sesion));
  await assert(Math.abs(results.sesion.rmse - results.perspectiva.rmse) < 1e-6 && results.sesion.coverage === results.perspectiva.coverage, 'el LAS exportado desde la sesión reabierta es idéntico al de antes');

  // Un archivo que no es una sesión se rechaza con un aviso y la mesa sigue sirviendo
  const bad = path.join(DL, 'no-es-una-sesion.json');
  fs.writeFileSync(bad, JSON.stringify({ hola: 'mundo' }));
  const chooser2 = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Abrir sesión', exact: true }).click();
  await (await chooser2).setFiles(bad);
  await page.getByText('No se pudo abrir la sesión').first().waitFor({ timeout: 15000 });
  await assert(true, 'un JSON que no es una sesión se rechaza («No se pudo abrir la sesión»)');
  await step(page, 'Curvas');
  await assert((await page.locator('.dz-curve').count()) === 1, 'la sesión abierta antes no se pierde por el intento fallido (sigue la curva GR)');

  await browser.close();
  console.log('\n— Resumen —');
  console.log(JSON.stringify(results, null, 1));
  console.log(`Errores de página: ${ERRORS.length}`);
  ERRORS.slice(0, 10).forEach((e) => console.log('  ', e));
  process.exit(ERRORS.length ? 1 : 0);
})().catch((e) => {
  console.error('FALLÓ el guion:', e.message);
  process.exit(1);
});

function ROOT() {
  return process.cwd();
}
