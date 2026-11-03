// Segment 1: start screen (tool string) → loading with QC → start screen with the well → entering the well.
const { Director } = require('./director.cjs');
const REPO = process.argv[3];
(async () => {
  const d = new Director(process.argv[2]);
  const p = () => d.page;
  await d.open('file://' + REPO + '/dist/index.html');
  await p().waitForSelector('[data-testid=home]', { timeout: 30000 });
  await d.settle(1500);
  d.mark('inicio');
  await d.hold(1.4);
  d.cur = { x: 1180, y: 640, vis: 0 };
  await d.showCursor(true, 0.25);
  await d.clickLoc(p().locator('.home__chip', { hasText: 'DEN' }), { move: 0.8, after: 1.7 });
  d.mark('neu');
  await d.clickLoc(p().locator('.home__chip', { hasText: 'NEU' }), { move: 0.45, after: 1.7 });
  d.mark('son');
  await d.clickLoc(p().locator('.home__chip', { hasText: 'SON' }), { move: 0.5, after: 1.6 });
  await p().keyboard.press('Escape');   // close the tool card before loading
  await d.hold(0.5);
  d.mark('carga');
  await d.clickLoc(p().getByTestId('home-load'), { move: 0.8, after: 0.9 });
  await d.clickLoc(p().getByRole('button', { name: /Cargar datos del TP/ }), { move: 0.7, after: 1.6 });
  d.mark('qc');
  await d.clickLoc(p().getByRole('button', { name: 'Siguiente: control de calidad' }), { move: 0.7, after: 2.4 });
  await d.clickLoc(p().getByRole('button', { name: 'Cargar', exact: true }), { move: 0.6, after: 0.3 });
  // Load + engine: not filmed (cut)
  d.mark('CUT');
  await d.waitFor(() => !!document.querySelector('[data-testid=home-enter]'));
  await d.settleRun(55000);
  d.mark('con-pozo');
  await d.hold(2.2);
  d.mark('entrar');
  await d.clickLoc(p().getByTestId('home-enter'), { move: 0.9, after: 0.2 });
  await d.showCursor(false, 0.2);
  await d.hold(3.4);
  d.mark('visor');
  await d.hold(1.5);
  await d.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
