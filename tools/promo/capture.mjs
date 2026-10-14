import { openTP, tab } from './capture-lib.mjs';
const only = process.argv[2];
const HIDE = '.ui-toaster{display:none!important}';
const full = { leftCollapsed: true, rightCollapsed: true, dockCollapsed: true };
const dock = { leftCollapsed: true, rightCollapsed: true, dockHeight: 640, dockAuto: false };
const jobs = {
  hero: { opts: {}, run: async () => {} },
  hero_light: { opts: { theme: 'light' }, run: async () => {} },
  viewer_well: { opts: { layout: full }, run: async () => {} },
  viewer_mdt: { opts: { layout: full }, run: async (p) => { await mdt(p); } },
  crossplot: { opts: { layout: dock }, run: async (p) => tab(p, 'Crossplot') },
  histogram: { opts: { layout: dock }, run: async (p) => tab(p, 'Histograma') },
  mdt: { opts: { layout: dock }, run: async (p) => { await mdt(p); } },
  corona: { opts: { layout: dock }, run: async (p) => { await tab(p, 'Corona'); await p.getByRole('button', { name: 'Usar plugs de ejemplo' }).first().click(); await p.waitForTimeout(1500); } },
  trends: { opts: { layout: dock }, run: async (p) => { await mdt(p); await tab(p, 'Tendencias'); } },
  geology: { opts: {}, run: async (p) => { await p.getByText('Geología', { exact: true }).first().click(); await p.waitForTimeout(3000); } },
  sarta: { opts: {}, run: async (p) => { await p.getByRole('button', { name: 'Sarta', exact: true }).click(); await p.waitForTimeout(4000); } },
  ecuaciones: { opts: {}, run: async (p) => { await p.getByTestId('equations-open').click(); await p.waitForTimeout(2500); } },
  sw: { opts: {}, run: async (p) => { await p.locator('button[aria-label^="Paso 7:"]').click(); await p.waitForTimeout(800); await p.getByRole('button', { name: 'Ver modelos de Sw lado a lado' }).click(); await p.waitForTimeout(2500); } },
};
async function mdt(p) { await tab(p, 'Presiones MDT'); await p.getByRole('button', { name: 'Usar presiones de ejemplo' }).first().click(); await p.waitForTimeout(1500); }
for (const [name, j] of Object.entries(jobs)) {
  if (only && !only.split(',').includes(name)) continue;
  const { b, p } = await openTP({ scale: 2, ...j.opts });
  await p.addStyleTag({ content: HIDE });
  try { await j.run(p); await p.waitForTimeout(800); await p.screenshot({ path: `shots/${name}.png` }); console.log('ok', name); }
  catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); }
  await b.close();
}
