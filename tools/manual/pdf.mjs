/** Imprime docs/manual/FiubaLog-manual.html a PDF A4 con Chromium (pie con número de página). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
import { execFileSync } from 'node:child_process';
// Variante para imprimir: mismas páginas con capturas en JPEG.
const html = path.join(here, 'build/print.html');
execFileSync(process.execPath, [path.join(here, 'build.mjs')], { env: { ...process.env, MANUAL_PRINT: '1', MANUAL_OUT: html }, stdio: 'inherit' });
const pdf = path.join(root, 'docs/manual/FiubaLog-manual.pdf');

const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + html, { waitUntil: 'load' });
await p.evaluate(() => Promise.all([...document.images].map((i) => (i.loading = 'eager', i.decode().catch(() => {})))));
await p.emulateMedia({ media: 'print' });
const foot = '<div style="width:100%;font:8px "Liberation Sans",Helvetica,Arial,sans-serif;color:#86868b;padding:0 16mm;display:flex;justify-content:space-between"><span>FiubaLog · Manual de usuario</span><span><span class="pageNumber"></span></span></div>';
await p.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: foot, outline: true, tagged: true });
await b.close();
console.log('pdf →', path.relative(root, pdf));
