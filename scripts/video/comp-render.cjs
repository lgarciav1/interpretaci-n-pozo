// Renders the final composition frame by frame.
// Usage: node comp-render.cjs <videoDir> <timeline.json> <outDir> [from_s] [to_s] [every_n]
// Serves <videoDir> under a fictitious origin (Playwright route): no port opened.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const [root, tlFile, out, from = '0', to = '1e9', every = '1'] = process.argv.slice(2);
  const tl = JSON.parse(fs.readFileSync(tlFile, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
  await p.route('http://local.video/**', (r) => {
    const f = path.join(root, decodeURIComponent(new URL(r.request().url()).pathname));
    if (!fs.existsSync(f)) { console.log('404', f); return r.fulfill({ status: 404, body: '' }); }
    r.fulfill({ status: 200, contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await p.goto('http://local.video/comp/index.html');
  await p.waitForFunction(() => window.ready);
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate((tl) => window.load(tl), tl);
  const n = Math.round(tl.duration * 30);
  const f0 = Math.round(+from * 30), f1 = Math.min(n, Math.round(+to * 30));
  const t0 = Date.now();
  for (let i = f0; i < f1; i += +every) {
    await p.evaluate((t) => window.renderAt(t), i / 30);
    await p.screenshot({ path: path.join(out, `c${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 });
    if (i % 150 === 0) console.log(`comp ${i}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
