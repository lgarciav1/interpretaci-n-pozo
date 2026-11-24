/**
 * F17, lupa del visor: recorrido, medición de cuadros y capturas sobre el HTML único con el pozo del TP.
 *
 *   npm run build
 *   python3 -m http.server 4173 --bind 127.0.0.1 --directory dist &
 *   QA_URL=http://127.0.0.1:4173/index.html NODE_PATH=<carpeta con playwright> node scripts/qa/lupa.cjs
 *
 * Mide dos cosas con la lupa abierta sobre la vista del pozo entero:
 * 1. Puntero sintético: un `pointermove` por cuadro de requestAnimationFrame durante 4 s (el peor caso: la lupa se
 *    redibuja en cada cuadro). Intervalo entre cuadros y ms de dibujo de la lupa (`data-loupe-ms`).
 * 2. Puntero real de Playwright (`page.mouse.move`) barriendo el visor durante unos 4 s.
 */
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
};
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]));

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = process.env.QA_URL || pathToFileURL(resolve('dist/index.html')).href;
  const output = process.env.QA_CAPTURAS || 'docs/capturas/f17';
  mkdirSync(output, { recursive: true });
  const viewer = page.locator('.shell-viewer .wv-body');
  const loupe = page.getByTestId('viewer-loupe');

  await page.goto(url);
  await page.getByTestId('home-load').press('Enter');
  await page.getByRole('button', { name: 'Cargar datos del TP' }).press('Enter');
  await page.getByRole('button', { name: /Siguiente: control de calidad/ }).press('Enter');
  await page.getByRole('button', { name: 'Cargar', exact: true }).press('Enter');
  await page.getByTestId('home-enter').press('Enter');
  await viewer.waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const box = await viewer.boundingBox();
  // Profundidad → y de pantalla con la vista actual.
  const yAt = async (depth) => {
    const r = await page.getByTestId('viewer-visible').evaluate((el) => ({ top: Number(el.dataset.top), base: Number(el.dataset.base) }));
    return box.y + (box.height * (depth - r.top)) / (r.base - r.top);
  };
  const trackX = async (id, frac) => {
    const t = await page.locator(`.shell-viewer .wv-head[data-track-id="${id}"]`).boundingBox();
    return t.x + frac * t.width;
  };
  const tracks = await page.locator('.shell-viewer .wv-head').evaluateAll((els) => els.map((e) => e.dataset.trackId));
  console.log('pistas:', tracks.join(', '));

  // Abrir con L sobre el visor; Esc la cierra; L de nuevo la abre.
  const depth = Number(process.env.QA_DEPTH || 8160);
  const resTrack = tracks.find((t) => /resist/i.test(t)) ?? tracks[2];
  const x0 = await trackX(resTrack, 0.5);
  await page.mouse.move(x0, await yAt(depth));
  await page.keyboard.press('l');
  await loupe.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await loupe.waitFor({ state: 'detached' });
  await page.keyboard.press('l');
  await loupe.waitFor({ state: 'visible' });
  await page.mouse.move(x0 + 1, await yAt(depth));
  await page.waitForTimeout(200);
  const head = await loupe.locator('.wv-loupe__head').innerText();
  assert.match(head, /1:200/);
  console.log('encabezado de la lupa:', head.replace(/\n/g, ' | '));

  for (const [scheme, name] of [['light', 'claro'], ['dark', 'oscuro']]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.mouse.move(x0, await yAt(depth));
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(output, `lupa-${name}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });

  // 1) Puntero sintético, un evento por cuadro: sin eventos (referencia del navegador), sin lupa y con lupa.
  const sweep = (move) => viewer.evaluate(async (body, [ms, move]) => {
    const r = body.getBoundingClientRect();
    const root = body.closest('.wv');
    const frames = [];
    const draw = [];
    return await new Promise((done) => {
      const t0 = performance.now();
      let last = t0;
      let k = 0;
      const step = (now) => {
        frames.push(now - last);
        last = now;
        const v = Number(root.dataset.loupeMs);
        if (k > 0 && Number.isFinite(v)) draw.push(v);
        k++;
        // Barrido en zigzag por todo el alto y buena parte del ancho del visor.
        const fy = (k % 240) / 240;
        const y = r.top + 4 + (fy < 0.5 ? fy * 2 : 2 - fy * 2) * (r.height - 8);
        const x = r.left + r.width * (0.15 + 0.6 * ((k % 97) / 97));
        if (move) body.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse', pointerId: 1, isPrimary: true }));
        if (now - t0 < ms) requestAnimationFrame(step);
        else done({ frames: frames.slice(2), draw });
      };
      requestAnimationFrame(step);
    });
  }, [4000, move]);
  const idle = await sweep(false);
  await page.keyboard.press('Escape');
  await loupe.waitFor({ state: 'detached' });
  const noLoupe = await sweep(true);
  await page.keyboard.press('l');
  await loupe.waitFor({ state: 'visible' });
  const synthetic = await sweep(true);

  // 2) Puntero real: Playwright mueve el mouse y la página cuenta cuadros.
  await page.evaluate(() => {
    const w = window;
    w.__frames = [];
    w.__draw = [];
    let last = performance.now();
    const root = document.querySelector('.shell-viewer .wv');
    const step = (now) => {
      w.__frames.push(now - last);
      last = now;
      w.__draw.push(Number(root.dataset.loupeMs));
      if (!w.__stop) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 4000) {
    const f = (i % 200) / 200;
    const y = box.y + 6 + (f < 0.5 ? f * 2 : 2 - f * 2) * (box.height - 12);
    await page.mouse.move(box.x + box.width * (0.2 + 0.5 * ((i % 61) / 61)), y);
    i++;
  }
  const real = await page.evaluate(() => {
    window.__stop = true;
    return { frames: window.__frames.slice(2), draw: window.__draw.filter(Number.isFinite) };
  });

  const summary = (r) => ({ frame: round(stats(r.frames)), fps: +(1000 / stats(r.frames).mean).toFixed(1), over20ms: r.frames.filter((x) => x > 20).length });
  const report = {
    idle: summary(idle),
    pointerWithoutLoupe: summary(noLoupe),
    synthetic: { frame: round(stats(synthetic.frames)), fps: +(1000 / stats(synthetic.frames).mean).toFixed(1), over20ms: synthetic.frames.filter((x) => x > 20).length, loupeDraw: round(stats(synthetic.draw)) },
    real: { moves: i, frame: round(stats(real.frames)), fps: +(1000 / stats(real.frames).mean).toFixed(1), over20ms: real.frames.filter((x) => x > 20).length, loupeDraw: round(stats(real.draw)) },
    errors,
  };
  console.log(JSON.stringify(report, null, 2));

  // Rueda: cambia el aumento; Esc cierra.
  await page.mouse.move(x0, await yAt(depth));
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(150);
  assert.match(await loupe.locator('.wv-loupe__head').innerText(), /1:100/);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  assert.match(await loupe.locator('.wv-loupe__head').innerText(), /1:200/);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  assert.match(await loupe.locator('.wv-loupe__head').innerText(), /1:500/);
  await page.keyboard.press('Escape');
  await loupe.waitFor({ state: 'detached' });

  // Paleta y hoja de atajos.
  await page.keyboard.press('Control+k');
  await page.locator('.ui-cmd input[role=combobox]').fill('lupa');
  await page.keyboard.press('Enter');
  await loupe.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await loupe.waitFor({ state: 'detached' });
  await page.keyboard.press('?');
  await page.getByText('Abrir la lupa del visor (detalle a 1:200)').waitFor();
  await page.getByText('Cambiar el aumento de la lupa (1:50 a 1:1.000)').waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('OK · L abre y cierra · Esc cierra · rueda 1:200 → 1:100 → 1:200 → 1:500 · paleta · hoja de atajos');
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
