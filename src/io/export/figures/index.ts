/**
 * Exportación de figuras (fase 6c-2): contexto SVG, escritor de PDF, dimensionado y plantillas. Puro.
 * El dibujo de cada figura vive junto a lo que dibuja (`src/viewer/figure.ts`, `src/plots/xy/figure.ts`) y la descarga en
 * `src/app/export/`. Ver docs/decisiones/0012-exportacion-de-figuras.md.
 */
export { num, PathBuilder, SvgPath2D, withSvgPath2D } from './path';
export { approximateMeasure, parseCssColor, parseFont, SvgContext2D, SvgGradient } from './svg';
export type { SvgContextOptions, TextMeasure } from './svg';
export { pdfTextWidth, rgbaToRgb, toWinAnsi, writePdf } from './pdf';
export type { PdfColor, PdfDocument, PdfImage, PdfItem, PdfPage } from './pdf';
export * from './sizing';
export * from './templates';
export { crc32, readPngDpi, setPngDpi } from './png';
export { framePdfPage, wrapFields } from './pdfPage';
export type { FramedPage, PdfPageMeta } from './pdfPage';
