import { describe, expect, it } from 'vitest';
import rawManualHtml from '../docs/manual/index.html?raw';
import { answerQuestion, suggestCommands } from '../src/app/assistant/model';
import { buildEquationEntries } from '../src/app/ecuaciones/model';
import { commands as manualCommands } from '../src/app/manual/commands';
import {
  buildStandaloneManualHtml,
  collectManualImageRefs,
  patchManualDocumentAttrs,
  stripExternalLinks,
} from '../src/app/manual/inlineManual';
import { closeManual, getThemedManualHtml, openManual } from '../src/app/manual/open';
import { useUi } from '../src/app/store/ui';
import { registry } from '../src/modules';

const diskImgFiles = Object.keys(import.meta.glob('../docs/manual/img/*'))
  .map((p) => p.split('/').pop()!)
  .sort();

describe('Manual HTML visual y empaquetado sin conexión (0095)', () => {
  it('mantiene integridad exacta de docs/manual/index.html y docs/manual/img sin .png ni huérfanos', () => {
    expect(rawManualHtml).not.toMatch(/\.png\b/i);

    const refs = collectManualImageRefs(rawManualHtml);
    const expectedFiles = refs.map((r) => r.replace(/^img\//, '')).sort();

    expect(diskImgFiles.filter((f) => f.endsWith('.png'))).toEqual([]);
    expect(expectedFiles.filter((f) => !diskImgFiles.includes(f))).toEqual([]);
    expect(diskImgFiles.filter((f) => !expectedFiles.includes(f))).toEqual([]);

    expect(refs).toContain('img/asistente-v2-consultas.webp');
    expect(refs).toContain('img/asistente-v2-defensa.webp');
    expect(rawManualHtml).toContain('Preparar defensa');

    const realMap = Object.fromEntries(refs.map((r, i) => [r, `data:image/webp;base64,REAL_${i}`]));
    const standaloneReal = buildStandaloneManualHtml(rawManualHtml, realMap, { theme: 'dark', anchor: 'asistente' });
    const realMarkupNoScripts = standaloneReal.replace(/<script[\s\S]*?<\/script>/gi, '');
    expect(realMarkupNoScripts).not.toMatch(/<img\b[^>]*\ssrc=["']img\//i);
    expect(standaloneReal).toContain("window.__manualImg('img/' + s[2] + '.webp')");
    expect(standaloneReal).toContain('window.__manualImg(f.dataset.full)');
    expect(standaloneReal).toContain('if (window.parent === window || ev.source !== window.parent) return;');
    expect(standaloneReal).not.toMatch(/loading=["']lazy["']/i);

    // Seguridad: anclas maliciosas no rompen el atributo <html ...> ni inyectan HTML/JS
    const xssOut = buildStandaloneManualHtml(rawManualHtml, realMap, {
      theme: 'light',
      anchor: 'asistente" onload="alert(1)',
    });
    expect(xssOut).not.toContain('onload="alert(1)"');
    expect(xssOut).not.toContain('data-manual-anchor=');
  });

  it('escapa </script sin importar mayúsculas, maneja $ en reemplazos y evita rutas img/ sin hidratar', () => {
    const sampleHtml = `
      <title>Manual</title>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <style>body{margin:0}</style>
      <div class="hero">
        <figure data-full="img/demo.webp"><img src="img/demo.webp" alt="A"></figure>
        <figure data-full="img/demo.webp"><img src="img/demo.webp" loading="lazy" alt="B"></figure>
      </div>
      <script>
        const steps = [['Paso', 'Título', 'p-10-paso']];
        const s = steps[0];
        const card = \`<img src="img/\${s[2]}.webp">\`;
        const open = (f) => { $('#lb-img').src = f.dataset.full; };
      </script>
    `;

    expect(stripExternalLinks(sampleHtml)).not.toMatch(/fonts\.googleapis|fonts\.gstatic/i);

    const refs = collectManualImageRefs(sampleHtml);
    expect(refs).toEqual(['img/demo.webp', 'img/p-10-paso.webp']);

    const sentinelA = 'data:image/webp;base64,UNIQUE_DEMO_TOKEN_$$_$&';
    const sentinelB = 'data:image/webp;base64,UNIQUE_STEP_TOKEN_</SCRIPT>';
    const out = buildStandaloneManualHtml(
      sampleHtml,
      {
        'img/demo.webp': sentinelA,
        'img/p-10-paso.webp': sentinelB,
      },
      { theme: 'dark', anchor: 'asistente' },
    );

    expect(out).toMatch(/^<!doctype html><html lang="es"[^>]*data-theme="dark"[^>]*data-manual-anchor="asistente">/i);
    expect(out).not.toMatch(/fonts\.googleapis|fonts\.gstatic/i);
    expect(out).not.toContain('</SCRIPT>');
    expect(out).toContain('<\\/SCRIPT>');
    const markupWithoutScripts = out.replace(/<script[\s\S]*?<\/script>/gi, '');
    expect(markupWithoutScripts).not.toMatch(/<img\b[^>]*\ssrc=["']img\//i);
    expect(markupWithoutScripts).not.toContain('data-manual-src=""');
    expect(out).not.toMatch(/loading=["']lazy["']/i);
    expect(out).toContain('data-manual-src="img/demo.webp"');
    expect(out).toContain("window.__manualImg('img/' + s[2] + '.webp')");
    expect(out).toContain('window.__manualImg(f.dataset.full)');
    expect(out).toContain('fiubalog:manual-theme');
    expect(out).toContain('fiubalog:manual-close');

    // Cada data URI aparece una única vez aunque la figura se use en dos nodos + data-full
    expect(out.split(sentinelA).length - 1).toBe(1);
    expect(out.split('UNIQUE_STEP_TOKEN_<\\/SCRIPT>').length - 1).toBe(1);

    const patched = patchManualDocumentAttrs(out, { theme: 'light', anchor: 'superficie-2d' });
    expect(patched).toMatch(/<html\b[^>]*data-theme="light"[^>]*data-manual-anchor="superficie-2d"/i);
  });

  it('abre y cierra el estado UI del manual, expone comando help:manual y lo sugiere en el Asistente', () => {
    closeManual();
    expect(useUi.getState().manual).toBeNull();

    openManual('asistente');
    expect(useUi.getState().manual).toEqual({ anchor: 'asistente' });

    closeManual();
    expect(useUi.getState().manual).toBeNull();

    const themed = getThemedManualHtml('dark', 'coherencia');
    expect(themed).toMatch(/<html\b[^>]*data-theme="dark"[^>]*data-manual-anchor="coherencia"/i);

    const cmds = manualCommands();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.id).toBe('help:manual');
    expect(typeof cmds[0]!.run).toBe('function');
    cmds[0]!.run?.();
    expect(useUi.getState().manual).toEqual({});
    closeManual();

    const navCmds = [
      ...cmds.map((c) => ({ id: c.id, title: c.title, group: c.group, keywords: c.keywords, run: c.run })),
      { id: 'help:equations', title: 'Abrir las ecuaciones de los métodos', group: 'Ayuda', run() {} },
    ];
    const ctx = {
      zones: [],
      result: null,
      equations: buildEquationEntries(registry),
      commands: navCmds,
    };

    const ans = answerQuestion('Quiero abrir el manual de uso', ctx);
    expect(ans.actions).toContainEqual(expect.objectContaining({ kind: 'command', id: 'help:manual' }));

    const cmdsSuggested = suggestCommands('abrir manual', navCmds);
    expect(cmdsSuggested).toContainEqual(expect.objectContaining({ kind: 'command', id: 'help:manual' }));
  });
});
