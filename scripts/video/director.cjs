/*
 * Director: captures the real app (dist/index.html) frame by frame at 30 fps, deterministically.
 * - JS time (timers, rAF, Date, performance): Playwright clock, advanced 1/30 s per frame.
 * - CSS animations/transitions: paused via CDP and seeked to the same virtual time on every frame.
 * - Cursor: drawn by us, position computed per frame (eased paths); real mouse events drive hover/clicks.
 * Real (wall-clock) waits between frames never show up in the video: virtual time only advances with frames.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FPS = 30, DT = 1000 / FPS;

const OVERLAY = () => {
  const boot = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = `#__cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;will-change:transform;
      filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}
      .__rip{position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
      border:2.5px solid rgba(91,91,240,.9);z-index:2147483646;pointer-events:none}`;
    document.documentElement.appendChild(st);
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 2.5l7.2 18.2 2.5-7.6 7.6-2.5z" fill="#fff" stroke="#16161d" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    c.style.opacity = '0';
    document.documentElement.appendChild(c);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.__ripples = [];
  window.__drawOverlay = (x, y, vis, now) => {
    boot();
    const c = document.getElementById('__cur');
    c.style.opacity = String(vis); c.style.transform = `translate(${x - 4}px,${y - 2}px)`;
    for (const r of window.__ripples) {
      const k = (now - r.t) / 520;
      if (!r.el) { r.el = document.createElement('div'); r.el.className = '__rip'; document.documentElement.appendChild(r.el); }
      if (k >= 1) { r.el.remove(); r.dead = true; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      r.el.style.transform = `translate(${r.x}px,${r.y}px) scale(${0.35 + 0.9 * e})`; r.el.style.opacity = String(1 - k);
    }
    window.__ripples = window.__ripples.filter((r) => !r.dead);
  };
};

class Director {
  constructor(outDir, { width = 1600, height = 900, scale = 1.2, theme = 'light' } = {}) {
    this.out = outDir; this.w = width; this.h = height; this.scale = scale; this.theme = theme;
    this.frame = 0; this.vnow = 0; this.cur = { x: width * 0.5, y: height * 0.6, vis: 0 };
    this.anims = new Map(); this.marks = [];
    fs.mkdirSync(outDir, { recursive: true });
  }
  async open(url) {
    this.browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    this.ctx = await this.browser.newContext({ viewport: { width: this.w, height: this.h }, deviceScaleFactor: this.scale, colorScheme: this.theme });
    await this.ctx.addInitScript(OVERLAY);
    this.page = await this.ctx.newPage();
    this.page.on('pageerror', (e) => console.log('pageerror:', e.message));
    await this.page.clock.install();
    this.cdp = await this.ctx.newCDPSession(this.page);
    await this.cdp.send('Animation.enable');
    this.cdp.on('Animation.animationStarted', (e) => {
      const a = e.animation; const src = a.source || {};
      const total = (src.delay || 0) + (src.duration || 0) * Math.max(1, src.iterations || 1) + (src.endDelay || 0);
      this.anims.set(a.id, { start: this.vnow, total: isFinite(total) ? total : 1e9 });
    });
    await this.page.goto(url);
    await this.cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
    await this.page.clock.pauseAt((await this.page.evaluate(() => Date.now())) + 500);
  }
  /** Real wait, not filmed, while also advancing app timers (background work that runs on timers). A cut point. */
  async settleRun(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await this.page.clock.runFor(100); await this.page.waitForTimeout(100); }
  }
  /** Real wait (not filmed): lets workers/compute finish while virtual time stays frozen. */
  async settle(ms) { await this.page.waitForTimeout(ms); }
  async waitFor(fn, timeout = 120000) {
    const t0 = Date.now();
    while (!(await this.page.evaluate(fn).catch(() => false))) {
      if (Date.now() - t0 > timeout) throw new Error('waitFor timeout: ' + fn);
      // advance virtual time a little without filming, so app timers can fire (e.g. debounce) — kept tiny
      await this.page.clock.runFor(16);
      await this.page.waitForTimeout(150);
    }
  }
  async seekAnims() {
    const groups = new Map();
    for (const [id, a] of this.anims) {
      const t = this.vnow - a.start;
      if (t > a.total + 200) { this.anims.delete(id); continue; }
      const key = Math.round(Math.min(t, a.total));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    }
    for (const [t, ids] of groups) await this.cdp.send('Animation.seekAnimations', { animations: ids, currentTime: t }).catch(() => {});
  }
  /** Film one frame: advance time, update cursor/ripples, seek CSS animations, screenshot. */
  async shoot() {
    await this.page.clock.runFor(DT);
    this.vnow += DT;
    await this.seekAnims();
    await this.page.evaluate(([x, y, v, n]) => window.__drawOverlay(x, y, v, n), [this.cur.x, this.cur.y, this.cur.vis, this.vnow]);
    if (!process.env.DRY) await this.page.screenshot({ path: path.join(this.out, `f${String(this.frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93, timeout: 180000 });
    this.frame += 1;
    if (this.frame % 30 === 0) process.stdout.write(`  ${this.frame}f `);
  }
  async hold(sec) { for (let i = 0, n = Math.round(sec * FPS); i < n; i++) await this.shoot(); }
  mark(name) { this.marks.push([name, this.frame / FPS]); console.log(`\n[${(this.frame / FPS).toFixed(2)}s] ${name}`); }
  async showCursor(on = true, sec = 0.3) {
    const a = this.cur.vis, b = on ? 1 : 0, n = Math.max(1, Math.round(sec * FPS));
    for (let i = 1; i <= n; i++) { this.cur.vis = a + (b - a) * (i / n); await this.shoot(); }
  }
  /** Move the cursor along an eased arc to (x,y) in `sec` seconds, filming each frame. Real mouse follows (hover). */
  async moveTo(x, y, sec = 0.7) {
    const x0 = this.cur.x, y0 = this.cur.y, n = Math.max(1, Math.round(sec * FPS));
    const dx = x - x0, dy = y - y0, bend = Math.min(80, Math.hypot(dx, dy) * 0.12);
    const nx = -dy / (Math.hypot(dx, dy) || 1), ny = dx / (Math.hypot(dx, dy) || 1);
    for (let i = 1; i <= n; i++) {
      const k = i / n, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const arc = Math.sin(Math.PI * e) * bend;
      this.cur.x = x0 + dx * e + nx * arc; this.cur.y = y0 + dy * e + ny * arc;
      await this.page.mouse.move(this.cur.x, this.cur.y);
      await this.shoot();
    }
  }
  async box(loc) {
    await loc.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
    const b = await loc.boundingBox({ timeout: 15000 });
    if (!b) throw new Error('no box');
    return b;
  }
  async moveToLoc(loc, sec = 0.7, fx = 0.5, fy = 0.5) {
    const b = await this.box(loc);
    await this.moveTo(b.x + b.width * fx, b.y + b.height * fy, sec);
    return b;
  }
  /** Click at the cursor: ripple + real click. Then films `after` seconds. */
  async click(after = 0.5) {
    await this.page.evaluate(([x, y, t]) => window.__ripples.push({ x, y, t }), [this.cur.x, this.cur.y, this.vnow]);
    await this.page.mouse.down();
    await this.shoot();
    await this.page.mouse.up();
    await this.hold(after);
  }
  async clickLoc(loc, { move = 0.7, after = 0.6 } = {}) { await this.moveToLoc(loc, move); await this.hold(0.12); await this.click(after); }
  /** Drag from current cursor position to (x,y), filming. */
  async dragTo(x, y, sec = 1.0) {
    await this.page.evaluate(([x, y, t]) => window.__ripples.push({ x, y, t }), [this.cur.x, this.cur.y, this.vnow]);
    await this.page.mouse.down();
    await this.hold(0.1);
    const x0 = this.cur.x, y0 = this.cur.y, n = Math.max(1, Math.round(sec * FPS));
    for (let i = 1; i <= n; i++) {
      const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.cur.x = x0 + (x - x0) * e; this.cur.y = y0 + (y - y0) * e;
      await this.page.mouse.move(this.cur.x, this.cur.y);
      await this.shoot();
    }
    await this.page.mouse.up();
  }
  async close() {
    fs.writeFileSync(path.join(this.out, 'marks.json'), JSON.stringify({ fps: FPS, frames: this.frame, marks: this.marks }, null, 1));
    await this.browser.close();
  }
}
module.exports = { Director, FPS };
