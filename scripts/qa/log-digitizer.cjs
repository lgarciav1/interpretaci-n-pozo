/*
 * Prueba de punta a punta del Log Digitizer (docs/decisiones/0063) sobre el HTML construido, abierto por file://.
 *
 * Uso: npm run build && node scripts/qa/log-digitizer.cjs <scan.png> <meta.json> [carpeta de capturas] [carpeta temporal]
 *   scan.png / meta.json: registro generado por un programa independiente (no por el motor) y su verdad: arrays
 *   `depth`, `gr`, `nph`; la fila de la profundidad d en el generador es TOP + (d − D0)/DZ.
 *
 * Todo con clics reales sobre el lienzo, como una usuaria: los puntos que «mira» (borde de la pista, líneas de grilla,
 * píxeles de la curva) se ubican analizando la imagen ORIGINAL en el navegador, y se llevan a la imagen corregida con
 * la misma rotación que aplicará la mesa (calculada desde los dos clics de inclinación).
 *
 * (a) GR y NPHI del registro independiente: inclinación, 4 amarres, bordes, cuentagotas, trazar, exportar LAS y
 *     comparar con la verdad (RMSE, correlación, cobertura).
 * (b) PNG exportado por la propia app (pozo del TP): digitalizar el GR de la figura y comparar con el GR original.
 * (c) Agregar al pozo activo, verlo en el visor, deshacer, rehacer, guardar el proyecto, reabrirlo; LAS releído.
 * Sale con 1 si algo falla o hay errores de página.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.cwd();
const SCAN = path.resolve(process.argv[2] || 'scan.png');
const META = JSON.parse(fs.readFileSync(path.resolve(process.argv[3] || 'meta.json'), 'utf8'));
const OUT = path.resolve(process.argv[4] || 'docs/capturas/log-digitizer');
const DL = fs.mkdtempSync(path.join(process.argv[5] || os.tmpdir(), 'pozo-digitizer-'));
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('·', ...a);
let PAGE = null;
const ERRORS = [];
const assert = async (c, m) => {
  if (!c) {
    if (PAGE) await PAGE.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
    throw new Error('FALLÓ: ' + m);
  }
  log('ok:', m);
};
const results = {};

// ── geometría: misma rotación que el motor (src/digitizer/geometry.ts, rotateImage con expand) ───────────────────
function rotationH(angle, w, h) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const H = [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy];
  const ap = (x, y) => [H[0] * x + H[1] * y + H[2], H[3] * x + H[4] * y + H[5]];
  const corners = [[-0.5, -0.5], [w - 0.5, -0.5], [w - 0.5, h - 0.5], [-0.5, h - 0.5]].map(([x, y]) => ap(x, y));
  const minX = Math.min(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  return (x, y) => {
    const [u, v] = ap(x, y);
    return [u - (minX + 0.5), v - (minY + 0.5)];
  };
}

// ── LAS mínimo ───────────────────────────────────────────────────────────────────────────────────────────────────
function readLas(text) {
  const lines = text.split(/\r?\n/);
  let sect = '';
  const names = [];
  let nul = -999.25;
  const rows = [];
  for (const l of lines) {
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
  return { names, col, n: rows.length, nul };
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

/** Compara una curva digitalizada (z, v) con la verdad (zt, vt) en las profundidades de la verdad. */
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
    // un hueco del digitalizado (más de 1 m sin puntos) no cuenta como dato
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

// ── interacción ──────────────────────────────────────────────────────────────────────────────────────────────────
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
/** Desplaza la vista (barra espaciadora + arrastre, como una usuaria) hasta que el punto quede cómodo a la vista. */
async function ensureVisible(page, x, y) {
  for (let k = 0; k < 20; k++) {
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
  await page.screenshot({ path: `${OUT}/error-vista.png` });
  throw new Error(`no se pudo llevar (${x}, ${y}) a la vista: ${JSON.stringify(await view(page))}`);
}
async function clickImg(page, x, y) {
  const s = await ensureVisible(page, x, y);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(60);
}
async function palette(page, text) {
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
async function waitJob(page, timeout = 60000) {
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

/** Análisis de la imagen original en el navegador: lo que «ve» la usuaria (bordes, grilla, píxeles de color). */
async function analyze(page, file, spec) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate(
    async ({ b64, spec }) => {
      const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const W = bmp.width;
      const H = bmp.height;
      const cv = new OffscreenCanvas(W, H);
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, W, H).data;
      const px = (x, y) => {
        const i = (y * W + x) * 4;
        return [d[i], d[i + 1], d[i + 2]];
      };
      const lum = (x, y) => {
        const [r, g, b] = px(x, y);
        return (r + g + b) / 3;
      };
      const colCentroid = (y, x0, x1, base) => {
        let s = 0;
        let sw = 0;
        for (let x = x0; x <= x1; x++) {
          const w = Math.max(0, base - lum(x, y));
          s += w * x;
          sw += w;
        }
        return sw ? s / sw : NaN;
      };
      const rowCentroid = (x, y0, y1, base) => {
        let s = 0;
        let sw = 0;
        for (let y = y0; y <= y1; y++) {
          let w = 0;
          for (let k = -1; k <= 1; k++) w += Math.max(0, base - lum(x + k, y));
          s += w * y;
          sw += w;
        }
        return sw ? s / sw : NaN;
      };
      const findColor = (y0, x0, x1, kind) => {
        let best = null;
        // la usuaria apunta al centro del trazo: el píxel más saturado entre unas filas
        for (let y = y0 - 12; y <= y0 + 12; y++)
        for (let x = x0; x <= x1; x++) {
          const [r, g, b] = px(x, y);
          const score = kind === 'green' ? g - (r + b) / 2 : kind === 'blue' ? b - (r + g) / 2 : 255 - (r + g + b) / 3;
          if (!best || score > best.score) best = { x, y, score };
        }
        return best;
      };
      const out = { W, H, border: {}, grid: {}, color: {} };
      for (const [key, y, x0, x1, base] of spec.border) out.border[key] = colCentroid(y, x0, x1, base);
      for (const [key, x, y0, y1, base] of spec.grid) out.grid[key] = rowCentroid(x, y0, y1, base);
      for (const [key, y, x0, x1, kind] of spec.color) out.color[key] = findColor(y, x0, x1, kind);
      return out;
    },
    { b64, spec },
  );
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  PAGE = page;
  const errors = ERRORS;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('file://' + path.join(ROOT, 'dist/index.html'));
  await page.waitForTimeout(1500);

  // ═══ (a) registro independiente ═══════════════════════════════════════════════════════════════════════════════
  const M = META;
  const yOf = (d) => M.TOP + (d - M.D0) / M.DZ;
  // Lo que mira la usuaria en la imagen original.
  const look = await analyze(page, SCAN, {
    border: [
      ['top', 160, M.L - 14, M.L + 14, 200],
      ['bottom', M.H - 160, M.L - 14, M.L + 14, 200],
      ['leftMid', 1250, M.L - 14, M.L + 14, 200],
      ['rightMid', 1250, M.R - 14, M.R + 14, 200],
    ],
    grid: [4, 8, 16, 22].map((k) => [`k${k}`, M.R - 12, M.TOP + 100 * k - 9, M.TOP + 100 * k + 9, 238]),
    color: [
      ['green', 900, M.L + 5, M.R - 5, 'green'],
      ['blue', 1500, M.L + 5, M.R - 5, 'blue'],
    ],
  });
  log('análisis', JSON.stringify(look));

  // Abrir la mesa por la paleta y cargar la imagen.
  await palette(page, 'Log Digitizer');
  await assert(await page.locator('.dz-desk').isVisible(), 'la mesa se abre con Ctrl+K «Log Digitizer»');
  await shot(page, 'mesa-vacia-claro');
  await page.setInputFiles('[data-testid="digitizer-image-input"]', SCAN);
  await page.waitForFunction(() => document.querySelector('[data-testid="digitizer-canvas"]')?.dataset.viewport);
  await page.waitForTimeout(500);

  // (2) Inclinación: dos clics sobre el borde izquierdo de la pista, en la imagen original.
  const t1 = [look.border.top, 160];
  const t2 = [look.border.bottom, M.H - 160];
  await clickImg(page, ...t1);
  await clickImg(page, ...t2);
  const angle = Math.atan2(t2[0] - t1[0], t2[1] - t1[1]);
  log(`inclinación marcada ${(angle * 180 / Math.PI).toFixed(3)}° (real ${M.ang}°)`);
  results.angle = { marked: (angle * 180) / Math.PI, real: M.ang };
  await shot(page, 'geometria-claro');
  await side(page).getByRole('button', { name: 'Aplicar corrección' }).click();
  await waitJob(page);
  await assert(await side(page).getByText('Imagen corregida', { exact: true }).isVisible(), 'la imagen se corrige en el worker');
  const H = rotationH(angle, M.W, M.H);

  // (3) Amarres: 4 líneas de grilla rotuladas (cada 100 px del generador = 5 m).
  await step(page, 'Profundidad');
  const ks = [4, 8, 16, 22];
  for (const k of ks) {
    const [, yc] = H(M.R - 12, look.grid[`k${k}`]);
    const [xc] = H(M.R - 12, look.grid[`k${k}`]);
    await clickImg(page, xc, yc);
    await page.waitForTimeout(80);
    const depth = M.D0 + 100 * k * M.DZ;
    await page.keyboard.type(depth.toFixed(4).replace('.', ','));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
  }
  await assert(await side(page).getByText('Profundidad calibrada').isVisible(), '4 amarres: profundidad calibrada');
  const resid = await side(page).locator('.dz-kv__row', { hasText: 'Residuo' }).innerText();
  log('residuo', resid.replace(/\s+/g, ' '));
  results.residual = resid.replace(/\s+/g, ' ');
  await shot(page, 'profundidad-claro');

  // (4) Curvas: GR verde 0–150 y NPHI azul 0,45 → −0,15.
  await step(page, 'Curvas');
  const [xl] = H(look.border.leftMid, 1250);
  const [xr] = H(look.border.rightMid, 1250);
  const [, ymid] = H(look.border.leftMid, 1250);
  async function curve(mnemonic, left, right, colorKey, rowColor) {
    await side(page).getByTestId('digitizer-new-curve').fill(mnemonic);
    await side(page).getByTestId('digitizer-new-curve').press('Enter');
    await page.waitForTimeout(150);
    const already = await side(page).getByRole('button', { name: /Borde izquierdo/ }).getAttribute('aria-pressed');
    if (already === 'true' || mnemonic === 'GR') {
      await clickImg(page, xl, ymid);
      await clickImg(page, xr, ymid);
    }
    const lv = side(page).getByLabel('Valor del borde izquierdo');
    await lv.fill(String(left).replace('.', ','));
    await lv.press('Enter');
    const rv = side(page).getByLabel('Valor del borde derecho');
    await rv.fill(String(right).replace('.', ','));
    await rv.press('Enter');
    // cuentagotas sobre un píxel de la curva
    const eye = side(page).getByRole('button', { name: /Cuentagotas/ });
    if ((await eye.getAttribute('aria-pressed')) !== 'true') await eye.click();
    const [cx, cy] = H(look.color[colorKey].x, look.color[colorKey].y);
    await clickImg(page, cx, cy);
    await page.waitForTimeout(100);
    await side(page).getByTestId('digitizer-trace').click();
    await waitJob(page);
  }
  const t0 = Date.now();
  await curve('GR', 0, 150, 'green', 900);
  results.traceMsGR = Date.now() - t0;
  await shot(page, 'curvas-gr-claro');
  await curve('NPHI', 0.45, -0.15, 'blue', 1500);
  await assert((await page.locator('.dz-curve').count()) === 2, 'dos curvas trazadas');

  // (5) Revisión
  await step(page, 'Revisión');
  for (const m of ['GR', 'NPHI']) {
    const t = await page.getByTestId(`digitizer-review-${m}`).innerText();
    results[`review${m}`] = t.replace(/\s+/g, ' ').slice(0, 300);
    log('revisión', m, results[`review${m}`]);
  }
  await shot(page, 'revision-claro');

  // (6) Exportar LAS y comparar con la verdad.
  await step(page, 'Importar');
  const lasA = await download(page, () => side(page).getByTestId('digitizer-export-las').click());
  const las = readLas(fs.readFileSync(lasA, 'utf8'));
  const z = las.col(las.names[0]);
  results.a = {
    GR: compare(z, las.col('GR'), M.depth, M.gr, 150),
    NPHI: compare(z, las.col('NPHI'), M.depth, M.nph, 0.6),
  };
  log('(a) GR', JSON.stringify(results.a.GR));
  log('(a) NPHI', JSON.stringify(results.a.NPHI));
  await assert(results.a.GR.pct < 3 && results.a.GR.coverage > 0.9, 'GR: error < 3 % del rango y cobertura > 90 %');
  await assert(results.a.NPHI.pct < 4 && results.a.NPHI.coverage > 0.9, 'NPHI: error < 4 % del rango y cobertura > 90 %');
  await shot(page, 'salida-claro');

  // Guardar y reabrir la sesión.
  const sess = await download(page, () => page.getByRole('button', { name: 'Guardar sesión' }).click());
  results.sessionBytes = fs.statSync(sess).size;
  log('sesión', path.basename(sess), results.sessionBytes, 'bytes');

  // Oscuro
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await step(page, 'Curvas');
  await shot(page, 'curvas-oscuro');
  await step(page, 'Revisión');
  await shot(page, 'revision-oscuro');
  await page.emulateMedia({ colorScheme: 'light' });

  fs.writeFileSync(path.join(DL, 'results.json'), JSON.stringify(results, null, 2));
  log('errores de página:', errors.length ? errors.join('\n') : 'ninguno');
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  if (errors.length) process.exit(1);
})().catch(async (e) => {
  if (PAGE) await PAGE.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
  console.error('errores de página:', ERRORS.join('\n'));
  console.error(e);
  process.exit(1);
});
