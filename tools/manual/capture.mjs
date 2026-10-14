/**
 * Capturas del manual: abre la app (servidor de desarrollo en :5173), carga el pozo del TP, recorre los pasos y
 * saca cada captura a 2× en `build/raw/`. Después `shots.py` las pasa a WebP en `build/shots/`.
 *
 *   node capture.mjs            → todas
 *   node capture.mjs a,b,c      → solo esas
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(here, 'build/raw');
mkdirSync(RAW, { recursive: true });
const URL = process.env.APP_URL ?? 'http://localhost:5173/';
const HIDE_TOASTS = '.ui-toaster{display:none!important}';

// ───── helpers ─────
const wait = (p, ms = 600) => p.waitForTimeout(ms);
const btn = (p, name, exact = false) => p.getByRole('button', { name, exact }).first();
const click = async (p, name, opts = {}) => { await btn(p, name, opts.exact).click(); await wait(p, opts.wait ?? 700); };
const step = async (p, n) => { await p.locator(`button[aria-label^="Paso ${n}:"]`).click(); await wait(p, 900); };
const tab = async (p, name) => {
  const t = p.getByRole('tab', { name }).first();
  if (await t.count()) await t.click(); else await btn(p, name).click();
  await wait(p, 1000);
};

async function open({ theme = 'light', w = 1600, h = 1000, layout = null, tp = true, interpret = true, scale = 2 } = {}) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: theme });
  await p.addInitScript(([l, t]) => {
    localStorage.setItem('pozo.ui.theme', t);
    if (l) localStorage.setItem('pozo.ui.layout', JSON.stringify(l));
  }, [layout, theme]);
  await p.goto(URL);
  await wait(p, 2500);
  await p.addStyleTag({ content: HIDE_TOASTS });
  if (tp) {
    await click(p, 'Cargar pozo', { wait: 400 });
    await click(p, 'Cargar datos del TP', { wait: 2000 });
    await p.locator('[role=dialog]').getByRole('button', { name: 'Siguiente: control de calidad' }).click();
    await wait(p, 1200);
    await p.locator('[role=dialog]').getByRole('button', { name: 'Cargar', exact: true }).click();
    await wait(p, 1500);
    if (interpret) {
      for (const n of [4, 5, 6, 7, 8, 9, 10, 11]) await step(p, n);
      await wait(p, 1200);
    }
  }
  return { b, p };
}

async function snap(p, name, target) {
  const file = path.join(RAW, `${name}.png`);
  if (!target) await p.screenshot({ path: file });
  else if (typeof target === 'string') await p.locator(target).first().screenshot({ path: file });
  else await p.screenshot({ path: file, clip: target });
  console.log('ok', name);
}

const FULL = { leftCollapsed: true, rightCollapsed: true, dockCollapsed: true };
const DOCK = { leftCollapsed: true, rightCollapsed: true, dockHeight: 600, dockAuto: false };
const mdtExample = async (p) => { await tab(p, 'Presiones MDT'); await click(p, 'Usar presiones de ejemplo', { wait: 1500 }); };
const coreExample = async (p) => { await tab(p, 'Corona'); await click(p, 'Usar plugs de ejemplo', { wait: 1500 }); };

/** Cada trabajo: opciones de apertura, acciones y capturas (una o varias). */
export const JOBS = {
  cover: { open: { theme: 'dark', w: 1600, h: 1000 }, run: async (p) => snap(p, 'cover') },
  overview: { open: {}, run: async (p) => snap(p, 'overview') },
  'first-open': { open: { tp: false }, run: async (p) => snap(p, 'first-open') },
  'load-dialog': {
    open: { tp: false },
    run: async (p) => { await click(p, 'Cargar pozo', { wait: 600 }); await snap(p, 'load-dialog', '[role=dialog]'); },
  },
  'load-columns': {
    open: { tp: false },
    run: async (p) => {
      await click(p, 'Cargar pozo', { wait: 400 });
      await click(p, 'Cargar datos del TP', { wait: 2000 });
      await snap(p, 'load-columns', '[role=dialog]');
      await p.locator('[role=dialog]').getByRole('button', { name: 'Siguiente: control de calidad' }).click();
      await wait(p, 1200);
      await snap(p, 'load-qc', '[role=dialog]');
    },
  },
  'step-qc': { open: { interpret: false }, run: async (p) => { await step(p, 2); await snap(p, 'step-qc'); await snap(p, 'inspector-qc', '.shell-side--right'); } },
  'step-zones': { open: { interpret: false }, run: async (p) => { await step(p, 3); await snap(p, 'step-zones'); await snap(p, 'inspector-zones', '.shell-side--right'); } },
  steps: {
    open: {},
    run: async (p) => {
      const names = { 4: 'arcilla', 5: 'porosidad', 6: 'rw', 7: 'saturacion', 8: 'permeabilidad', 9: 'cutoffs', 10: 'sumario', 11: 'volumen' };
      for (const [n, k] of Object.entries(names)) { await step(p, +n); await snap(p, `inspector-${k}`, '.shell-side--right'); }
      await step(p, 4);
      await snap(p, 'flowbar', '.shell-flowbar');
      await snap(p, 'topbar', '.shell-topbar');
    },
  },
  'viewer-full': { open: { layout: FULL }, run: async (p) => snap(p, 'viewer-full', '.shell-center') },
  'viewer-zone': {
    open: { layout: FULL },
    run: async (p) => { await btn(p, 'Ver la zona C').click(); await wait(p, 1200); await snap(p, 'viewer-zone', '.shell-center'); },
  },
  results: { open: { layout: { leftCollapsed: true, dockHeight: 420, dockAuto: false } }, run: async (p) => { await tab(p, 'Resultados'); await snap(p, 'results'); } },
  crossplot: { open: { layout: DOCK }, run: async (p) => { await tab(p, 'Crossplot'); await snap(p, 'crossplot'); } },
  histogram: { open: { layout: DOCK }, run: async (p) => { await tab(p, 'Histograma'); await snap(p, 'histogram'); } },
  mdt: { open: { layout: DOCK }, run: async (p) => { await mdtExample(p); await snap(p, 'mdt'); } },
  'mdt-viewer': { open: { layout: FULL }, run: async (p) => { await mdtExample(p); await snap(p, 'mdt-viewer', '.shell-center'); } },
  corona: { open: { layout: DOCK }, run: async (p) => { await coreExample(p); await snap(p, 'corona'); } },
  trends: { open: { layout: DOCK }, run: async (p) => { await mdtExample(p); await tab(p, 'Tendencias'); await snap(p, 'trends'); } },
  sarta: { open: {}, run: async (p) => { await click(p, 'Sarta', { exact: true, wait: 4000 }); await snap(p, 'sarta'); } },
  geology: { open: {}, run: async (p) => { await p.getByText('Geología', { exact: true }).first().click(); await wait(p, 3000); await snap(p, 'geology'); } },
  equations: { open: {}, run: async (p) => { await p.getByTestId('equations-open').click(); await wait(p, 2000); await snap(p, 'equations'); } },
  'sw-compare': {
    open: {},
    run: async (p) => { await step(p, 7); await click(p, 'Ver modelos de Sw lado a lado', { wait: 2500 }); await snap(p, 'sw-compare'); },
  },
  dark: { open: { theme: 'dark' }, run: async (p) => snap(p, 'overview-dark') },
  'qc-report': {
    open: {},
    run: async (p) => { await p.locator('.shell-side--left').getByRole('button', { name: 'Informe' }).click(); await wait(p, 1200); await snap(p, 'qc-report', '[role=dialog]'); },
  },
  'zone-editor': {
    open: { h: 1100 },
    run: async (p) => {
      const left = p.locator('.shell-side--left');
      await left.getByRole('cell', { name: 'C', exact: true }).first().click();
      await wait(p, 900);
      await left.locator('.shell-side__scroll').evaluate((e) => { e.scrollTop = e.scrollHeight; });
      await wait(p, 500);
      const head = left.getByText('Zonas', { exact: true }).last();
      const hb = await head.boundingBox(); const lb = await left.boundingBox();
      const y = hb.y - 14;
      await snap(p, 'zone-editor', { x: lb.x, y, width: lb.width, height: lb.y + lb.height - y });
    },
  },
  'zone-cards': { open: { layout: { leftCollapsed: true, dockHeight: 470, dockAuto: false } }, run: async (p) => { await tab(p, 'Zonas'); await snap(p, 'zone-cards', '.shell-center'); } },
  'all-modules': {
    open: { h: 1300 },
    run: async (p) => { await click(p, 'Todos los módulos', { wait: 900 }); await snap(p, 'all-modules', '[role=menu]'); },
  },
  snapshots: {
    open: { h: 1200 },
    run: async (p) => {
      await btn(p, /^Snapshots/).click(); await wait(p, 900);
      await p.getByPlaceholder(/Nombre del snapshot/).fill('Interpretación base');
      await click(p, 'Guardar snapshot', { wait: 900 });
      await p.keyboard.press('Escape'); await wait(p, 500);
      await step(p, 4);
      const f = p.getByRole('textbox', { name: /GR de arena limpia/ });
      if (await f.count()) { await f.first().fill('40'); await f.first().press('Enter'); }
      else { const sp = p.getByRole('spinbutton', { name: /GR de arena limpia/ }).first(); await sp.fill('40'); await sp.press('Enter'); }
      await wait(p, 1500);
      await btn(p, /^Snapshots/).click(); await wait(p, 900);
      await p.locator('[role=dialog]').getByRole('button', { name: 'Comparar' }).first().click();
      await wait(p, 2500);
      await snap(p, 'snapshots', '[role=dialog]');
    },
  },
  'export-data': { open: { h: 1300 }, run: async (p) => { await click(p, 'Exportar', { exact: true, wait: 1000 }); await snap(p, 'export-data', '[role=dialog]'); } },
  report: {
    open: {},
    run: async (p) => {
      await click(p, 'Exportar', { exact: true, wait: 1000 });
      await p.locator('[role=dialog]').getByRole('radio', { name: 'Informe' }).or(p.locator('[role=dialog]').getByRole('button', { name: 'Informe', exact: true })).first().click();
      await wait(p, 800);
      await click(p, 'Generar informe', { wait: 6000 });
      await snap(p, 'report');
    },
  },
  'viewer-cursor': {
    open: { layout: FULL },
    run: async (p) => {
      await btn(p, 'Ver la zona C').click(); await wait(p, 1000);
      const box = await p.locator('.shell-center canvas').first().boundingBox();
      await p.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5); await wait(p, 600);
      await snap(p, 'viewer-cursor', '.shell-center');
    },
  },
  'curve-editor': {
    open: { layout: FULL },
    run: async (p) => {
      await p.locator('.shell-center').getByRole('button', { name: /^GR\b/ }).first().click(); await wait(p, 900);
      const pop = p.locator('[role=dialog]').first();
      const b = await pop.boundingBox();
      await snap(p, 'curve-editor', { x: Math.max(0, b.x - 260), y: Math.max(0, b.y - 40), width: Math.min(1600, b.width + 520), height: Math.min(1000 - Math.max(0, b.y - 40), b.height + 80) });
    },
  },
  'linked-selection': {
    open: { layout: { leftCollapsed: true, rightCollapsed: true, dockHeight: 520, dockAuto: false } },
    run: async (p) => {
      await tab(p, 'Crossplot');
      const box = await p.locator('.shell-center canvas').first().boundingBox();
      const x = box.x + box.width * 0.3;
      await p.keyboard.down('Shift');
      await p.mouse.move(x, box.y + box.height * 0.35); await p.mouse.down();
      await p.mouse.move(x, box.y + box.height * 0.55, { steps: 12 }); await p.mouse.up();
      await p.keyboard.up('Shift'); await wait(p, 1500);
      await snap(p, 'linked-selection');
    },
  },
  'track-builder': { open: {}, run: async (p) => { await click(p, 'Pistas', { exact: true, wait: 1500 }); await snap(p, 'track-builder'); } },
  'crossplot-dn': {
    open: { layout: DOCK },
    run: async (p) => {
      await tab(p, 'Crossplot');
      await click(p, 'Elegir plantilla', { wait: 600 });
      await p.getByRole('menuitem', { name: /Densidad–neutrón/ }).first().click(); await wait(p, 1500);
      await snap(p, 'crossplot-dn');
    },
  },
  'crossplot-pickett': {
    open: { layout: DOCK },
    run: async (p) => {
      await tab(p, 'Crossplot');
      await click(p, 'Elegir plantilla', { wait: 600 });
      await p.getByRole('menuitem', { name: /Pickett/ }).first().click(); await wait(p, 1500);
      await snap(p, 'crossplot-pickett');
    },
  },
  'trend-viewer': {
    open: { layout: { leftCollapsed: true, rightCollapsed: true, dockHeight: 420, dockAuto: false } },
    run: async (p) => {
      const head = p.locator('.shell-center').getByText('Sónico', { exact: true }).first();
      const hb = await head.boundingBox();
      const cb = await p.locator('.shell-center canvas').first().boundingBox();
      await click(p, 'Tendencia', { exact: true, wait: 500 });
      const x = hb.x + hb.width * 0.5;
      await p.mouse.move(x, cb.y + cb.height * 0.45); await p.mouse.down();
      await p.mouse.move(x, cb.y + cb.height * 0.85, { steps: 15 }); await p.mouse.up();
      await wait(p, 1500);
      await snap(p, 'trend-viewer');
    },
  },
  calibration: { open: { layout: DOCK }, run: async (p) => { await coreExample(p); await tab(p, 'Calibración'); await snap(p, 'calibration'); } },
  'rock-types': { open: { layout: DOCK }, run: async (p) => { await coreExample(p); await tab(p, 'Tipos de roca'); await wait(p, 800); await snap(p, 'rock-types'); } },
  'core-viewer': { open: { layout: FULL }, run: async (p) => { await coreExample(p); await snap(p, 'core-viewer', '.shell-center'); } },
  'sarta-card': {
    open: {},
    run: async (p) => {
      await click(p, 'Sarta', { exact: true, wait: 3500 });
      await p.locator('.shell-side--left').getByText('Calibre', { exact: true }).first().click(); await wait(p, 2500);
      await snap(p, 'sarta-card');
    },
  },
  radial: { open: { layout: DOCK }, run: async (p) => { await tab(p, 'Perfil radial'); await wait(p, 800); await snap(p, 'radial'); } },
  geomods: {
    open: { layout: { leftCollapsed: true, rightWidth: 520, rightAuto: false } },
    run: async (p) => {
      await p.getByText('Geología', { exact: true }).first().click(); await wait(p, 2500);
      const open = async (n, name, shot) => {
        await step(p, n);
        await p.locator('.shell-side--right').getByText(name, { exact: true }).first().click(); await wait(p, 2500);
        await snap(p, shot);
      };
      await open(4, 'Litología sugerida (random forest)', 'geo-facies');
      await open(4, 'Electrofacies', 'geo-electrofacies');
      await open(5, 'Columna sedimentológica', 'geo-column');
      await open(5, 'Sismograma sintético', 'geo-synthetic');
      await open(5, 'Electrosecuencias', 'geo-electroseq');
    },
  },
  resmods: {
    open: { layout: { leftCollapsed: true, rightWidth: 560, rightAuto: false, dockCollapsed: true } },
    run: async (p) => {
      const open = async (n, name, shot, after) => {
        await step(p, n);
        await p.locator('.shell-side--right').getByText(name, { exact: true }).first().click(); await wait(p, 2000);
        if (after) await after();
        await snap(p, shot);
      };
      await open(9, 'Sensibilidad a los cutoffs', 'res-sensitivity');
      await open(10, 'Capacidad de flujo y Lorenz', 'res-lorenz');
      await open(10, 'Lectura automática del pozo', 'res-reading');
      await open(11, 'Incertidumbre del volumen', 'res-uncertainty', async () => { const c = btn(p, 'Calcular', true); if (await c.count()) { await c.click(); await wait(p, 4000); } });
    },
  },
  palette: {
    open: {},
    run: async (p) => { await p.keyboard.press('Control+k'); await wait(p, 600); await p.keyboard.type('satur'); await wait(p, 600); await snap(p, 'palette', '[role=dialog]'); },
  },
};

// ───── corrida ─────
const only = process.argv[2]?.split(',');
const extra = process.env.MANUAL_JOBS ? (await import(path.resolve(process.env.MANUAL_JOBS))).default : {};
const all = { ...JOBS, ...extra };
for (const [name, job] of Object.entries(all)) {
  if (only && !only.includes(name)) continue;
  const { b, p } = await open(job.open);
  try { await job.run(p, { click, step, tab, wait, snap, btn, mdtExample, coreExample }); }
  catch (e) { console.log('FALLÓ', name, e.message.split('\n')[0]); process.exitCode = 1; }
  await b.close();
}
