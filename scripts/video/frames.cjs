// Renderiza una escena determinista (window.renderAt(t)) cuadro por cuadro.
// Uso: node frames.cjs <carpeta-escena> <carpeta-salida> <fps> [t1,t2,...]   (sin lista: toda la duración)
// La carpeta se sirve bajo un origen ficticio interceptado por Playwright: no se abre ningún puerto.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const [dir, out, fps, list] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  p.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  await p.route('http://local.video/**', (r) => {
    const f = path.join(dir, decodeURIComponent(new URL(r.request().url()).pathname));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await p.goto('http://local.video/index.html');
  await p.waitForFunction(() => window.ready, null, { timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  const dur = await p.evaluate(() => window.DUR);
  const times = list ? list.split(',').map(Number) : Array.from({ length: Math.round(dur * fps) }, (_, i) => i / fps);
  const t0 = Date.now();
  for (const [i, t] of times.entries()) {
    await p.evaluate((t) => window.renderAt(t), t);
    const name = list ? `t${t.toFixed(2)}.png` : `f${String(i).padStart(5, '0')}.png`;
    await p.screenshot({ path: path.join(out, name) });
    if (i % 60 === 0) console.log(`frame ${i}/${times.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await b.close();
})();
