const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
export async function openTP({ scale = 2, theme = 'dark', w = 1600, h = 1000, layout = null } = {}) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: theme });
  if (layout) await p.addInitScript((l) => localStorage.setItem('pozo.ui.layout', JSON.stringify(l)), layout);
  await p.goto('http://localhost:5173/');
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Cargar pozo' }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Cargar datos del TP' }).click();
  await p.waitForTimeout(2000);
  await p.locator('[role=dialog]').getByRole('button', { name: 'Siguiente: control de calidad' }).click();
  await p.waitForTimeout(1200);
  await p.locator('[role=dialog]').getByRole('button', { name: 'Cargar', exact: true }).click();
  await p.waitForTimeout(1500);
  for (const n of [4,5,6,7,8,9,10,11]) {
    await p.locator(`button[aria-label^="Paso ${n}:"]`).click();
    await p.waitForTimeout(700);
  }
  await p.waitForTimeout(1500);
  return { b, p };
}
export const tab = async (p, name) => { await p.getByRole('tab', { name }).first().click().catch(async () => p.getByRole('button', { name }).first().click()); await p.waitForTimeout(1000); };
