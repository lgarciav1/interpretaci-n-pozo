/**
 * Empaquetador puro del manual HTML visual (`docs/manual/index.html`) para uso 100 % sin conexión.
 * Sin dependencias de React ni de Node (`node:fs`): lo usan el plugin de Vite, la app y los tests.
 */

export type ManualTheme = 'light' | 'dark' | 'system';

export interface StandaloneManualOptions {
  theme?: ManualTheme;
  anchor?: string;
}

/**
 * Recolecta las rutas únicas `img/<archivo>` referenciadas tanto en HTML (`src`, `data-full`)
 * como en la lista de pasos generada por script (`'p-NN-...'` -> `'img/p-NN-....webp'`).
 */
export function collectManualImageRefs(rawHtml: string): string[] {
  const refs = new Set<string>();
  const attrRe = /(?:src|data-full)=["'](img\/[a-zA-Z0-9._-]+\.(?:webp|png|jpg|jpeg|svg))["']/gi;
  for (const m of rawHtml.matchAll(attrRe)) {
    refs.add(m[1]!);
  }
  const stepImgRe = /['"](p-\d+-[a-z0-9-]+)['"]/g;
  for (const m of rawHtml.matchAll(stepImgRe)) {
    refs.add(`img/${m[1]!}.webp`);
  }
  return [...refs].sort();
}

/** Quita hojas o preconexiones externas (`http://` / `https://`) para garantizar funcionamiento offline sin errores de red. */
export function stripExternalLinks(rawHtml: string): string {
  return rawHtml.replace(/<link\b[^>]*\bhref=["']https?:\/\/[^"']*["'][^>]*>\s*/gi, '');
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/<\/(script)/gi, '<\\/$1')
    .replaceAll('<!--', '<\\!--');
}

function sanitizeAnchor(raw: string | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/^#/, '');
  return /^[A-Za-z0-9_-]+$/.test(clean) ? clean : null;
}

function splitManualDocument(cleanedHtml: string): { isFullDoc: boolean; headPart: string; bodyPart: string } {
  if (/<html\b/i.test(cleanedHtml)) {
    return { isFullDoc: true, headPart: '', bodyPart: cleanedHtml };
  }
  const styleClose = cleanedHtml.indexOf('</style>');
  if (styleClose >= 0) {
    const cut = styleClose + '</style>'.length;
    return {
      isFullDoc: false,
      headPart: cleanedHtml.slice(0, cut),
      bodyPart: cleanedHtml.slice(cut),
    };
  }
  return {
    isFullDoc: false,
    headPart: '<title>Manual de fiubaLog</title>',
    bodyPart: cleanedHtml,
  };
}

function applyHtmlAttrs(htmlTag: string, theme?: ManualTheme, anchor?: string): string {
  let out = htmlTag;
  if (theme === 'light' || theme === 'dark') {
    if (/\bdata-theme=/.test(out)) {
      out = out.replace(/\bdata-theme=["'][^"']*["']/, () => `data-theme="${theme}"`);
    } else {
      out = out.replace(/>$/, () => ` data-theme="${theme}">`);
    }
  }
  const safeAnchor = sanitizeAnchor(anchor);
  if (safeAnchor) {
    if (/\bdata-manual-anchor=/.test(out)) {
      out = out.replace(/\bdata-manual-anchor=["'][^"']*["']/, () => `data-manual-anchor="${safeAnchor}"`);
    } else {
      out = out.replace(/>$/, () => ` data-manual-anchor="${safeAnchor}">`);
    }
  }
  return out;
}

/**
 * Ajusta tema o ancla sobre un manual ya empaquetado sin recomputar el diccionario de imágenes.
 */
export function patchManualDocumentAttrs(html: string, opts: StandaloneManualOptions): string {
  return html.replace(/<html\b[^>]*>/i, (tag) => applyHtmlAttrs(tag, opts.theme, opts.anchor));
}

/**
 * Construye un documento HTML completo y autocontenido:
 * - Elimina enlaces remotos (Google Fonts).
 * - Inyecta cada imagen una única vez en `window.__MANUAL_IMAGES__`.
 * - Reemplaza `src="img/..."` estáticos por `data-manual-src` para evitar 404 antes de hidratar.
 * - Adapta `#stepcards` y lightbox (`#lb-img`) y agrega puente `postMessage` con la app (tema, ancla, `Esc`).
 */
export function buildStandaloneManualHtml(
  rawHtml: string,
  imageMap: Readonly<Record<string, string>>,
  opts: StandaloneManualOptions = {},
): string {
  let cleaned = stripExternalLinks(rawHtml);

  // Evita peticiones fallidas a rutas relativas `img/...` antes de hidratar desde `__MANUAL_IMAGES__`.
  cleaned = cleaned.replace(
    /(<img\b[^>]*?)\ssrc=["'](img\/[a-zA-Z0-9._-]+)["']/gi,
    (_m, prefix: string, ref: string) => `${prefix} data-manual-src="${ref}"`,
  );

  // En scripts dinámicos del manual (`#stepcards` y lightbox `#lb-img`), resuelve contra el mapa único.
  cleaned = cleaned.replace(
    /src="img\/\$\{s\[2\]\}\.webp"/g,
    () => 'src="${window.__manualImg ? window.__manualImg(\'img/\' + s[2] + \'.webp\') : \'img/\' + s[2] + \'.webp\'}"',
  );
  // Quita loading="lazy" en imágenes estáticas y dinámicas (#stepcards) para asegurar decodificación inmediata y PDF completo.
  cleaned = cleaned.replace(
    /(<img\b[^>]*?)\s+loading=["']lazy["']/gi,
    (_m, prefix: string) => prefix,
  );
  cleaned = cleaned.replace(
    /\$\(['"]#lb-img['"]\)\.src\s*=\s*f\.dataset\.full\s*;/g,
    () => "$('#lb-img').src = window.__manualImg ? window.__manualImg(f.dataset.full) : f.dataset.full;",
  );

  const headInject =
    `<script>` +
    `window.__MANUAL_IMAGES__=${escapeJsonForScript(imageMap)};` +
    `window.__manualImg=function(k){return(window.__MANUAL_IMAGES__&&window.__MANUAL_IMAGES__[k])||k;};` +
    `</script>`;

  const bridgeScript = `<script>
(function(){
  var hydrate = function(){
    var imgs = document.querySelectorAll('img[data-manual-src]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var key = img.getAttribute('data-manual-src');
      if (!key) continue;
      img.removeAttribute('loading');
      img.loading = 'eager';
      img.src = window.__manualImg(key);
      img.removeAttribute('data-manual-src');
      img.addEventListener('load', function(){ window.dispatchEvent(new Event('resize')); }, { once: true });
    }
  };
  hydrate();
  requestAnimationFrame(function(){ window.dispatchEvent(new Event('resize')); });

  var applyThemeAttr = function(t){
    if (t !== 'light' && t !== 'dark') return;
    document.documentElement.setAttribute('data-theme', t);
    var btns = document.querySelectorAll('.rail__theme button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-t') === t));
    }
    window.dispatchEvent(new Event('resize'));
  };

  var preset = document.documentElement.getAttribute('data-theme');
  if (preset === 'light' || preset === 'dark') {
    applyThemeAttr(preset);
  }

  var initialAnchor = document.documentElement.getAttribute('data-manual-anchor');
  if (initialAnchor && /^[A-Za-z0-9_-]+$/.test(initialAnchor)) {
    requestAnimationFrame(function(){
      var el = document.getElementById(initialAnchor);
      if (el) el.scrollIntoView({ behavior: 'auto' });
    });
  }

  window.addEventListener('message', function(ev){
    if (window.parent === window || ev.source !== window.parent) return;
    var d = ev && ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'fiubalog:manual-theme') applyThemeAttr(d.theme);
    if (d.type === 'fiubalog:manual-anchor' && typeof d.anchor === 'string') {
      var id = d.anchor.trim().replace(/^#/, '');
      if (/^[A-Za-z0-9_-]+$/.test(id)) {
        var target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });

  document.addEventListener('keydown', function(ev){
    if (ev.key === 'Escape' && window.parent !== window) {
      var lb = document.getElementById('lb');
      if (!lb || !lb.open) {
        window.parent.postMessage({ type: 'fiubalog:manual-close' }, '*');
      }
    }
  });
})();
</script>`;

  const parts = splitManualDocument(cleaned);
  if (parts.isFullDoc) {
    let doc = parts.bodyPart;
    doc = patchManualDocumentAttrs(doc, opts);
    if (/<\/head>/i.test(doc)) doc = doc.replace(/<\/head>/i, () => `${headInject}</head>`);
    else doc = `${headInject}${doc}`;
    if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>/i, () => `${bridgeScript}</body>`);
    else doc = `${doc}${bridgeScript}`;
    return doc;
  }

  const hasCharset = /<meta\b[^>]*charset=/i.test(parts.headPart);
  const metaCharset = hasCharset ? '' : '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
  const openHtml = applyHtmlAttrs('<html lang="es">', opts.theme, opts.anchor);
  return `<!doctype html>${openHtml}<head>${metaCharset}${parts.headPart}${headInject}</head><body>${parts.bodyPart}${bridgeScript}</body></html>`;
}
