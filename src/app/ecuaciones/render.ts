/**
 * Render de LaTeX con KaTeX, con caché por texto (las ecuaciones no cambian en la sesión). Solo la usa la pantalla
 * «Ecuaciones»: es el único lugar de la interfaz donde se muestran ecuaciones (docs/decisiones/0025).
 */
import katex from 'katex';

export type RenderedLatex = { ok: true; html: string } | { ok: false; latex: string };

const cache = new Map<string, RenderedLatex>();

export function renderLatex(latex: string): RenderedLatex {
  let r = cache.get(latex);
  if (!r) {
    try {
      // Con throwOnError: false KaTeX no lanza por LaTeX mal escrito: devuelve un `katex-error`. En ese caso (o ante
      // cualquier otra falla) se muestra el LaTeX crudo en monoespaciado.
      const html = katex.renderToString(latex, { throwOnError: false, displayMode: true });
      r = html.includes('katex-error') ? { ok: false, latex } : { ok: true, html };
    } catch {
      r = { ok: false, latex };
    }
    cache.set(latex, r);
  }
  return r;
}
