// Segments 2–6 of the video, filmed frame by frame with the Director.
// Usage: node segments.cjs <segment> <outDir> <repo> [scanDir]
//   segment: visor | mdt | graficos | digitizer | extras
const fs = require('fs');
const path = require('path');
const { Director, FPS } = require('./director.cjs');
const [SEG, OUT, REPO, SCANDIR] = process.argv.slice(2);

async function prelude(d) {
  const p = d.page;
  // Clicks with the mouse at the element's center: locator.click() waits for animation frames, frozen here.
  const tapNow = async (loc) => {
    await loc.waitFor({ state: 'visible', timeout: 30000 });
    const b = await loc.boundingBox();
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await d.settleRun(700);
  };
  await d.settleRun(1500);
  await tapNow(p.getByRole('button', { name: 'Cargar pozo' }).first());
  await tapNow(p.getByRole('button', { name: /Cargar datos del TP/ }));
  await tapNow(p.getByRole('button', { name: 'Siguiente: control de calidad' }));
  await tapNow(p.getByRole('button', { name: 'Cargar', exact: true }));
  await d.waitFor(() => [...document.querySelectorAll('*')].some((e) => e.childElementCount === 0 && e.textContent === 'Pozo cargado.'));
  await d.settleRun(55000);
  await p.mouse.move(5, 5);
  await d.settleRun(1500);
}
const tab = (d, name) => d.page.getByRole('tab', { name: new RegExp('^' + name) });
const panel = (d) => d.page.locator('.shell-dock__panel:not([hidden])').first();
const canvas = (d) => d.page.locator('canvas.wv-canvas').first();
async function typeText(d, s, framesPerChar = 2) {
  for (const ch of s) { await d.page.keyboard.type(ch); for (let i = 0; i < framesPerChar; i++) await d.shoot(); }
}
async function wheel(d, dy, sec) {
  const n = Math.round(sec * FPS);
  for (let i = 0; i < n; i++) { const k = Math.sin((Math.PI * (i + 0.5)) / n); await d.page.mouse.wheel(0, dy * k); await d.shoot(); }
}

const SEGMENTS = {
  async visor(d) {
    const p = d.page;
    d.cur = { x: 900, y: 520, vis: 0 };
    d.mark('visor');
    await d.hold(1.2);
    await d.showCursor(true, 0.25);
    const cb = await d.box(canvas(d));
    await d.moveTo(cb.x + cb.width * 0.3, cb.y + cb.height * 0.45, 0.8);
    await d.moveTo(cb.x + cb.width * 0.62, cb.y + cb.height * 0.6, 1.0);
    d.mark('zona');
    await d.clickLoc(p.getByRole('button', { name: 'Ver la zona D' }), { move: 0.7, after: 1.2 });
    await d.moveTo(cb.x + cb.width * 0.45, cb.y + cb.height * 0.55, 0.6);
    await wheel(d, 70, 1.4);
    await d.hold(0.4);
    await wheel(d, -70, 1.0);
    await d.hold(0.3);
    d.mark('snapshot');
    if (process.env.STOP_AT === 'snapshot') { await d.hold(0.6); return; }
    await d.clickLoc(p.getByRole('button', { name: /^Snapshots/ }), { move: 0.7, after: 0.6 });
    await d.moveToLoc(p.getByRole('textbox', { name: 'Nombre del snapshot' }), 0.5);
    await typeText(d, 'Base');
    await d.clickLoc(p.getByRole('button', { name: 'Guardar snapshot' }), { move: 0.5, after: 0.6 });
    await p.keyboard.press('Escape');
    await d.hold(0.5);
    d.mark('saturacion');
    await d.clickLoc(p.getByRole('button', { name: /^Paso \d+: Saturación/ }), { move: 0.8, after: 1.0 });
    const sl = p.locator('aside input[type=range], .shell-inspector input[type=range]');
    // exponent n is the third slider of Sw–Archie (a, m, n); fall back to the last visible one
    const count = await sl.count();
    const target = sl.nth(Math.min(2, count - 1));
    const b = await d.moveToLoc(target, 0.8);
    await d.hold(0.2);
    d.mark('slider');
    await d.dragTo(b.x + b.width * 0.85, b.y + b.height / 2, 1.8);
    await d.hold(1.4);
    d.mark('cortina');
    await d.clickLoc(p.getByRole('button', { name: /^Snapshots/ }), { move: 0.8, after: 0.6 });
    await d.clickLoc(p.getByRole('button', { name: 'Cortina' }).first(), { move: 0.6, after: 1.2 });
    const h = p.locator('[role=slider][aria-label^="Cortina"]').first();
    const hb = await d.moveToLoc(h, 0.7);
    await d.dragTo(hb.x - hb.width / 2 - 220, hb.y + hb.height / 2, 1.3);
    await d.hold(0.3);
    await d.dragTo(d.cur.x + 420, d.cur.y, 1.6);
    await d.hold(0.3);
    await d.dragTo(d.cur.x - 200, d.cur.y, 1.0);
    await d.hold(1.2);
  },

  async mdt(d) {
    const p = d.page;
    d.cur = { x: 900, y: 600, vis: 0 };
    d.mark('mdt');
    await d.hold(0.6);
    await d.showCursor(true, 0.25);
    await d.clickLoc(tab(d, 'Presiones MDT'), { move: 0.8, after: 0.5 });
    await d.clickLoc(p.getByRole('button', { name: 'Cargar presiones del TP' }), { move: 0.6, after: 1.4 });
    await d.clickLoc(p.getByRole('button', { name: 'Ver la zona D' }), { move: 0.8, after: 0.8 });
    await d.clickLoc(panel(d).getByRole('button', { name: 'Agua' }), { move: 0.8, after: 0.4 });
    d.mark('gradiente');
    const cb = await d.box(canvas(d));
    await d.moveTo(cb.x + 40, cb.y + cb.height * 0.1, 0.8);
    await d.dragTo(cb.x + 40, cb.y + cb.height * 0.9, 1.6);
    await d.hold(2.0);
    d.mark('corona');
    await d.clickLoc(tab(d, 'Corona'), { move: 0.8, after: 0.5 });
    await d.clickLoc(p.getByRole('button', { name: 'Cargar corona del TP' }), { move: 0.6, after: 1.4 });
    await d.clickLoc(p.getByRole('button', { name: 'Ver todo el pozo' }), { move: 0.8, after: 1.0 });
    await d.moveTo(cb.x + cb.width * 0.55, cb.y + cb.height * 1.25, 0.9);
    await d.hold(2.0);
  },

  async graficos(d) {
    const p = d.page;
    d.cur = { x: 900, y: 600, vis: 0 };
    d.mark('crossplot');
    await d.hold(0.5);
    await d.showCursor(true, 0.25);
    await d.clickLoc(tab(d, 'Crossplot'), { move: 0.8, after: 0.7 });
    const x = panel(d).getByRole('combobox', { name: 'Curva del eje X' });
    await d.moveToLoc(x, 0.6); await d.click(0.2); await x.selectOption({ value: 'm:GR' }, { force: true }); await d.hold(0.7);
    const y = panel(d).getByRole('combobox', { name: 'Curva del eje Y' });
    await d.moveToLoc(y, 0.5); await d.click(0.2); await y.selectOption({ value: 'm:AT90' }, { force: true }); await d.hold(0.8);
    await d.clickLoc(panel(d).locator('button', { hasText: /^Log$/ }).nth(1), { move: 0.6, after: 0.8 });
    await d.clickLoc(panel(d).locator('button', { hasText: /^D$/ }).first(), { move: 0.6, after: 0.8 });
    d.mark('cutoff');
    await d.clickLoc(panel(d).getByRole('button', { name: /Agregar/ }).first(), { move: 0.6, after: 0.6 });
    const hx = panel(d).locator('[role=slider]').first();
    if (await hx.count()) { const b = await d.moveToLoc(hx, 0.6); await d.dragTo(b.x + b.width / 2 + 110, b.y + b.height / 2, 1.4); }
    await d.hold(1.2);
    d.mark('histograma');
    await d.clickLoc(tab(d, 'Histograma'), { move: 0.8, after: 0.7 });
    await d.clickLoc(panel(d).getByRole('button', { name: /Agregar cutoff libre|Mostrar el cutoff/ }).first(), { move: 0.6, after: 0.5 });
    await d.clickLoc(panel(d).locator('button', { hasText: /^B$/ }).first(), { move: 0.6, after: 0.5 });
    await d.clickLoc(panel(d).locator('button', { hasText: /^D$/ }).first(), { move: 0.4, after: 0.7 });
    const hh = panel(d).locator('[role=slider]').first();
    if (await hh.count()) { const b = await d.moveToLoc(hh, 0.6); await d.dragTo(b.x + b.width / 2 - 90, b.y + b.height / 2, 1.4); }
    await d.hold(1.2);
    d.mark('tendencias');
    await d.clickLoc(tab(d, 'Tendencias'), { move: 0.8, after: 0.5 });
    await d.clickLoc(p.getByRole('button', { name: 'Ver todo el pozo' }), { move: 0.7, after: 0.5 });
    await d.clickLoc(p.getByRole('button', { name: 'Nueva tendencia' }).first(), { move: 0.7, after: 0.4 });
    const cb = await d.box(canvas(d));
    const son = await p.locator('text=SÓNICO').first().boundingBox().catch(() => null);
    const tx = son ? son.x + 45 : cb.x + cb.width * 0.37;
    await d.moveTo(tx, cb.y + cb.height * 0.1, 0.8);
    await d.dragTo(tx, cb.y + cb.height * 0.9, 1.8);
    await d.hold(2.2);
  },

  async digitizer(d) {
    const p = d.page;
    const M = JSON.parse(fs.readFileSync(path.join(SCANDIR, 'meta.json'), 'utf8'));
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const q = M.quad;
    const SIZE = { w: Math.round((dist(q[0], q[1]) + dist(q[3], q[2])) / 2), h: Math.round((dist(q[0], q[3]) + dist(q[1], q[2])) / 2) };
    const FX0 = M.L - M.M, FX1 = M.R + M.M, FY0 = M.TOP - M.M, FY1 = M.BOT + M.M;
    const toCorrected = (x, y) => [((x - FX0) / (FX1 - FX0)) * (SIZE.w - 1), ((y - FY0) / (FY1 - FY0)) * (SIZE.h - 1)];
    const rowOfDepth = (dd) => M.TOP + (dd - M.D0) / M.DZ;
    const cv = () => p.locator('[data-testid="digitizer-canvas"]');
    const toScreen = async (x, y) => {
      const c = cv(); const box = await c.boundingBox();
      const [s, ox, oy] = (await c.getAttribute('data-viewport')).split(' ').map(Number);
      return { x: box.x + ox + (x + 0.5) * s, y: box.y + oy + (y + 0.5) * s, box };
    };
    const side = () => p.locator('.dz-side');
    const stepBtn = (name) => p.locator('.dz-desk .ui-stepper').getByRole('button', { name: new RegExp(`^Paso \\d: ${name}`) }).first();
    const clickImg = async (x, y, move = 0.5, after = 0.25) => {
      const s = await toScreen(x, y);
      if (s.y < s.box.y + 30 || s.y > s.box.y + s.box.height - 30) throw new Error('punto fuera de vista ' + JSON.stringify([x, y]));
      await d.moveTo(s.x, s.y, move); await d.hold(0.08); await d.click(after);
    };
    const waitJob = async () => { await d.settle(300); await d.waitFor(() => !document.querySelector('.dz-status__job')); await d.settle(1500); };

    d.cur = { x: 900, y: 500, vis: 0 };
    d.mark('digitizer');
    await d.hold(0.4);
    await d.showCursor(true, 0.25);
    await d.clickLoc(p.getByRole('button', { name: 'Digitalizar registro' }), { move: 0.8, after: 0.8 });
    await p.setInputFiles('[data-testid="digitizer-image-input"]', path.join(SCANDIR, 'scan-perspectiva.png'));
    await d.waitFor(() => !!document.querySelector('[data-testid="digitizer-canvas"]')?.dataset.viewport);
    await d.settle(800);
    await d.hold(1.0);
    d.mark('esquinas');
    await d.clickLoc(stepBtn('Geometría'), { move: 0.7, after: 0.4 });
    await d.clickLoc(side().getByRole('button', { name: /Marcar esquinas/ }), { move: 0.6, after: 0.3 });
    for (const c of q) await clickImg(c[0], c[1], 0.55, 0.25);
    await d.hold(0.6);
    await d.clickLoc(side().getByRole('button', { name: 'Aplicar corrección' }), { move: 0.6, after: 0.2 });
    await waitJob();
    await d.hold(1.2);
    d.mark('profundidad');
    await d.clickLoc(stepBtn('Profundidad'), { move: 0.7, after: 0.3 });
    for (const k of [3, 21]) {
      const [u, v] = toCorrected(M.L + 70, M.TOP + 100 * k);
      await clickImg(u, v, 0.5, 0.15);
      await typeText(d, (M.D0 + 100 * k * M.DZ).toFixed(0), 2);
      await p.keyboard.press('Enter'); await d.hold(0.25);
    }
    d.mark('curva');
    await d.clickLoc(stepBtn('Curvas'), { move: 0.7, after: 0.3 });
    await d.moveToLoc(side().getByTestId('digitizer-new-curve'), 0.5);
    await d.click(0.1); await typeText(d, 'GR', 2); await p.keyboard.press('Enter'); await d.hold(0.3);
    const midY = toCorrected(M.L, (M.TOP + M.BOT) / 2)[1];
    await clickImg(toCorrected(M.L, 0)[0], midY, 0.6, 0.2);
    await clickImg(toCorrected(M.R, 0)[0], midY, 0.6, 0.2);
    const lv = side().getByLabel('Valor del borde izquierdo');
    await d.moveToLoc(lv, 0.5); await d.click(0.1); await p.keyboard.press('Control+a'); await p.keyboard.press('Backspace'); await typeText(d, '0', 2); await p.keyboard.press('Enter');
    const rv = side().getByLabel('Valor del borde derecho');
    await d.moveToLoc(rv, 0.4); await d.click(0.1); await p.keyboard.press('Control+a'); await p.keyboard.press('Backspace'); await typeText(d, '150', 2); await p.keyboard.press('Enter');
    let best = 100;
    for (let i = 100; i < M.gr.length - 100; i++) if (Math.abs(M.gr[i + 1] - M.gr[i - 1]) < Math.abs(M.gr[best + 1] - M.gr[best - 1])) best = i;
    const eye = side().getByRole('button', { name: /Cuentagotas/ });
    if ((await eye.getAttribute('aria-pressed')) !== 'true') await d.clickLoc(eye, { move: 0.5, after: 0.2 });
    const [cu, cw] = toCorrected(M.L + (M.gr[best] / 150) * (M.R - M.L), rowOfDepth(M.depth[best]));
    await clickImg(cu, cw, 0.6, 0.3);
    d.mark('trazar');
    await d.clickLoc(side().getByTestId('digitizer-trace'), { move: 0.6, after: 0.2 });
    await waitJob();
    await d.hold(1.6);
    d.mark('revision');
    await d.clickLoc(stepBtn('Revisión'), { move: 0.7, after: 2.0 });
    d.mark('importar');
    await d.clickLoc(stepBtn('Importar'), { move: 0.7, after: 0.5 });
    await d.clickLoc(side().getByTestId('digitizer-add-to-well'), { move: 0.6, after: 0.5 });
    await d.clickLoc(side().getByTestId('digitizer-show-in-viewer'), { move: 0.6, after: 0.5 });
    await d.clickLoc(p.locator('.dz-desk .ui-dialog__head').getByRole('button', { name: 'Cerrar' }), { move: 0.7, after: 0.4 });
    d.mark('en-visor');
    const gr = p.locator('[aria-label^="GR_DIG: editar escala"]').first();
    if (await gr.count()) await d.moveToLoc(gr, 0.8);
    await d.hold(2.0);
  },

  async extras(d) {
    const p = d.page;
    d.cur = { x: 900, y: 500, vis: 0 };
    d.mark('litologia');
    await d.hold(0.3);
    await d.showCursor(true, 0.2);
    await d.clickLoc(p.getByRole('radio', { name: 'Geología' }), { move: 0.7, after: 0.3 });
    await d.waitFor(() => !!document.querySelector('[aria-label^="Paso"]'));
    await d.clickLoc(p.getByRole('button', { name: /^Paso \d+: Litología/ }), { move: 0.6, after: 2.2 });
    d.mark('geologia');
    await d.clickLoc(p.getByRole('button', { name: /^Paso \d+: Geología/ }), { move: 0.6, after: 2.2 });
    await d.clickLoc(p.getByRole('radio', { name: 'Petrofísica' }), { move: 0.7, after: 0.6 });
    d.mark('radial');
    await d.clickLoc(tab(d, 'Perfil radial'), { move: 0.8, after: 2.0 });
    d.mark('rocas');
    await d.clickLoc(tab(d, 'Tipos de roca'), { move: 0.7, after: 2.0 });
    d.mark('ecuaciones');
    await d.clickLoc(p.getByRole('button', { name: 'Ecuaciones de los métodos' }), { move: 0.8, after: 0.8 });
    const dlg = p.getByRole('dialog').first();
    await d.clickLoc(dlg.getByText(/Indonesia/).first(), { move: 0.7, after: 1.8 });
    await p.keyboard.press('Escape');
    await d.hold(0.4);
    d.mark('oscuro');
    await d.clickLoc(p.getByRole('radio', { name: 'Tema oscuro' }), { move: 0.9, after: 1.6 });
    await d.clickLoc(p.getByRole('button', { name: 'Ver la zona B' }), { move: 0.8, after: 1.4 });
    d.mark('informe');
    await d.clickLoc(p.getByRole('button', { name: 'Informe' }).first(), { move: 0.9, after: 2.2 });
    await p.keyboard.press('Escape');
    await d.hold(0.3);
    d.mark('cierre');
    await d.clickLoc(p.getByTestId('open-home'), { move: 0.9, after: 0.3 });
    await d.showCursor(false, 0.3);
    await d.hold(5.0);
  },
};

(async () => {
  const d = new Director(OUT);
  await d.open('file://' + REPO + '/dist/index.html?inicio=no');
  await prelude(d);
  await SEGMENTS[SEG](d);
  await d.close();
  console.log('\nOK', SEG, d.frame, 'frames');
})().catch((e) => { console.error('FAILED', SEG, e.message.split('\n')[0]); process.exit(1); });
