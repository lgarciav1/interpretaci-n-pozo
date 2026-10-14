/**
 * Arma el manual en un único HTML autocontenido (docs/manual/FiubaLog-manual.html):
 * capítulos de `chapters/` + referencia de módulos, glosario y mnemónicos generados desde `build/registry.json`
 * + capturas de `build/shots/*.webp` + KaTeX (ecuaciones ya renderizadas, fuentes incrustadas).
 *
 * Convenciones dentro de los capítulos:
 *   «Rótulo»                         → rótulo de la interfaz (span.ui)
 *   <figure data-shot="x">…</figure> → captura build/shots/x.webp (clases opcionales: wide, half)
 *   <aside class="callout tip|warn|note|ok" data-title="…">…</aside>
 *   <!--modules--> <!--glossary--> <!--mnemonics--> <!--flow:petrophysics--> <!--flow:geology--> <!--stats-->
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(path.join(root, 'package.json'));
const katex = require('katex');
const katexDir = path.dirname(require.resolve('katex/dist/katex.min.css'));

const REG = JSON.parse(readFileSync(path.join(here, 'build/registry.json'), 'utf8'));
const OUT = process.env.MANUAL_OUT ? path.resolve(process.env.MANUAL_OUT) : path.join(root, 'docs/manual/FiubaLog-manual.html');
// Para el PDF: JPEG (Chromium los incrusta sin recodificar); para la pantalla, WebP.
const PRINT = process.env.MANUAL_PRINT === '1';
const VERSION = process.env.MANUAL_VERSION ?? new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmtNum = (v) => (typeof v === 'number' ? v.toLocaleString('es-AR', { maximumSignificantDigits: 6 }) : esc(v));
const tex = (latex, display = true) => katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });

const WS_LABEL = Object.fromEntries(REG.workspaces.map((w) => [w.id, w.label]));
const ROLE = Object.fromEntries(REG.roles.map((r) => [r.id, r]));
const missingShots = [];

const ICONS = {
  tip: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  note: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  ok: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
};
const MARK = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b80ff"/><stop offset="1" stop-color="#4b51d6"/></linearGradient></defs><rect x="1" y="1" width="22" height="22" rx="6" fill="url(#${id})"/><path d="M6.5 6.5h11M6.5 12h11M6.5 17.5h11" stroke="rgba(255,255,255,0.22)" stroke-width="1.2"/><path d="M9 4.5l3.2 2.8-2.4 2.6 4.6 2.4-3.6 2.6 2.4 2.4-2.2 2.2" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ───── Capturas ─────
function shot(name) {
  const f = path.join(here, 'build/shots', `${name}.${PRINT ? 'jpg' : 'webp'}`);
  if (!existsSync(f)) { missingShots.push(name); return ''; }
  return `data:image/${PRINT ? 'jpeg' : 'webp'};base64,${readFileSync(f).toString('base64')}`;
}

// ───── Bloques generados ─────
function roleChip(id, extra = '') {
  const r = ROLE[id];
  const dot = r?.color ? `<span class="dot" style="background:${esc(r.color)}"></span>` : '';
  return `<span class="chip mono">${dot}${esc(id)}</span>${r ? ` ${esc(r.label)}` : ''}${extra}`;
}
function inputItem(i) {
  const opt = i.optional ? ' <span class="opt">· opcional</span>' : '';
  if (i.kind === 'curve') return `<li>${roleChip(i.port, opt)}</li>`;
  const kind = { scalar: 'valor', table: 'tabla', zoneScalar: 'valor por zona' }[i.kind];
  return `<li><span class="chip mono">${esc(i.port)}</span> ${esc(i.label ?? kind)}${opt}</li>`;
}
function outputItem(o) {
  if (o.kind === 'curve') return `<li>${roleChip(o.port)}</li>`;
  const kind = { scalar: '', table: ' · tabla', zoneScalar: ' · por zona' }[o.kind];
  const unit = o.unit && o.unit !== '—' ? ` <span class="opt">(${esc(o.unit)})</span>` : '';
  return `<li><span class="chip mono">${esc(o.port)}</span> ${esc(o.label)}${unit}<span class="opt">${kind}</span></li>`;
}
function paramRow(p) {
  let def = '', range = '';
  if (p.type === 'number') {
    def = fmtNum(p.default);
    range = `${fmtNum(p.min)} – ${fmtNum(p.max)}${p.scale === 'log' ? ' <span class="sub">escala log</span>' : ''}`;
  } else if (p.type === 'enum') {
    def = esc(p.options.find((o) => o.value === p.default)?.label ?? p.default);
    range = p.options.map((o) => esc(o.label)).join(' · ');
  } else {
    def = p.default ? 'Sí' : 'No';
    range = 'Sí · No';
  }
  const scope = p.scope === 'zone' ? 'por zona' : 'global';
  const unit = p.unitLabel && p.unitLabel !== '—' ? esc(p.unitLabel) : '';
  return `<tr><td>${esc(p.label)}${p.tooltip ? `<span class="sub">${esc(p.tooltip)}</span>` : ''}</td><td>${unit}</td><td class="num">${def}</td><td>${range}</td><td>${scope}${p.shared ? '<span class="sub">compartido</span>' : ''}</td></tr>`;
}
function moduleCard(m) {
  const ws = m.workspace.map((w) => `<span class="chip">${esc(WS_LABEL[w] ?? w)}</span>`).join('');
  const groups = m.inputGroups.map((g) => `<li class="opt">Necesita al menos ${g.min} de: ${g.inputs.map((k) => esc(m.inputs.find((i) => i.key === k)?.port ?? k)).join(', ')}</li>`).join('');
  const outs = m.outputs.filter((o) => !o.hidden);
  const params = m.params.length
    ? `<div class="sec"><h5>Parámetros</h5><div class="table-wrap"><table><thead><tr><th>Parámetro</th><th>Unidad</th><th class="num">Por defecto</th><th>Rango u opciones</th><th>Alcance</th></tr></thead><tbody>${m.params.map(paramRow).join('')}</tbody></table></div></div>`
    : '';
  const eqs = m.docs.equations?.length
    ? `<div class="sec"><h5>Ecuaciones</h5><div class="eqs">${m.docs.equations.map((e) => `<div class="eq">${tex(e.latex)}${e.description ? `<div class="d">${esc(e.description)}</div>` : ''}</div>`).join('')}</div></div>`
    : '';
  const notes = m.docs.notes ? `<div class="sec"><h5>Notas</h5><p class="notes">${esc(m.docs.notes)}</p></div>` : '';
  const refs = m.docs.references?.length ? `<div class="sec"><h5>Referencias</h5><ol class="refs">${m.docs.references.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></div>` : '';
  const summary = m.docs.summary && m.docs.summary !== m.description ? `<p class="desc">${esc(m.docs.summary)}</p>` : '';
  return `<article class="module" id="mod-${esc(m.id)}">
  <h3>${esc(m.name)}</h3>
  <div class="chips"><span class="chip accent">${esc(m.categoryLabel)}</span>${ws}<span class="chip mono">${esc(m.id)}</span></div>
  ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ''}${summary}
  <div class="io"><div><h5>Entradas</h5><ul>${m.inputs.map(inputItem).join('') || '<li class="opt">Ninguna</li>'}${groups}</ul></div>
  <div><h5>Salidas</h5><ul>${outs.map(outputItem).join('') || '<li class="opt">Se muestran en su panel</li>'}</ul></div></div>
  ${params}${eqs}${notes}${refs}
</article>`;
}
function modulesBlock() {
  return REG.categories.map((c) => {
    const ms = REG.modules.filter((m) => m.category === c.id);
    if (!ms.length) return '';
    return `<h2 id="ref-${esc(c.id)}"><span class="cat-head">${esc(c.label)} <span class="count">${ms.length} ${ms.length === 1 ? 'módulo' : 'módulos'}</span></span></h2>${ms.map(moduleCard).join('\n')}`;
  }).join('\n');
}
function flowBlock(ws) {
  const steps = REG.flows[ws];
  const rows = steps.map((s, i) => {
    const mods = s.kind === 'modules' ? REG.modules.filter((m) => (s.categories ?? []).includes(m.category) && m.workspace.includes(ws)) : [];
    const what = { load: 'Carga del pozo', qc: 'Control de calidad', zones: 'Zonas' }[s.kind] ?? mods.map((m) => `<a href="#mod-${esc(m.id)}">${esc(m.name)}</a>`).join(' · ');
    return `<tr><td class="num">${i + 1}</td><td><b>${esc(s.label)}</b><span class="sub">${esc(s.title ?? '')}</span></td><td>${esc(s.hint ?? '')}</td><td>${what}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr><th class="num">#</th><th>Paso</th><th>Qué se hace</th><th>Módulos</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function glossaryBlock() {
  const fam = { borehole: 'Pozo', lithology: 'Litología', porosity: 'Porosidad', resistivity: 'Resistividad', saturation: 'Saturación', permeability: 'Permeabilidad', shale: 'Arcillosidad', water: 'Agua de formación', nmr: 'Resonancia magnética', spectral: 'GR espectral', flag: 'Banderas', geology: 'Geología', other: 'Otras' };
  const groups = {};
  for (const r of REG.roles) (groups[r.family] ??= []).push(r);
  return Object.entries(groups).map(([f, rs]) => `<h3>${esc(fam[f] ?? f)}</h3><div class="table-wrap"><table><thead><tr><th>Curva</th><th>Nombre</th><th>Unidad</th><th>Origen</th></tr></thead><tbody>${rs.map((r) => `<tr><td>${roleChip(r.id).replace(/ [^<]*$/, '')}</td><td>${esc(r.label)}${r.description ? `<span class="sub">${esc(r.description)}</span>` : ''}</td><td>${esc(r.unit && r.unit !== '—' ? r.unit : '')}</td><td>${{ measured: 'medida', computed: 'calculada', any: 'medida o calculada' }[r.origin] ?? ''}</td></tr>`).join('')}</tbody></table></div>`).join('');
}
function mnemonicsBlock() {
  const conf = { high: 'alta', medium: 'media', low: 'baja' };
  return `<div class="table-wrap"><table><thead><tr><th>Rol</th><th>Mnemónicos reconocidos</th><th>Unidad usual</th><th>Confianza</th></tr></thead><tbody>${REG.mnemonics.map((m) => `<tr><td>${m.role ? roleChip(m.role) : '—'}</td><td><code>${m.aliases.map(esc).join('</code> <code>')}</code></td><td>${esc(m.unit ?? '')}</td><td>${conf[m.confidence] ?? ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function statsBlock() {
  const nEq = REG.modules.reduce((a, m) => a + (m.docs.equations?.length ?? 0), 0);
  const nP = REG.modules.reduce((a, m) => a + m.params.length, 0);
  const tiles = [[REG.modules.length, 'módulos de cálculo', 'Cada uno con su documentación y sus ecuaciones.'], [REG.flows.petrophysics.length, 'pasos guiados', 'De la carga del pozo al volumen in situ.'], [nEq, 'ecuaciones', 'Visibles en la pantalla Ecuaciones y en este manual.'], [nP, 'parámetros', 'Globales o por zona, con su rango y su valor por defecto.'], [REG.roles.length, 'tipos de curva', 'Medidas y calculadas, con colores y escalas convencionales.'], [1, 'archivo HTML', 'Sin instalación, sin servidor y sin internet.']];
  return `<div class="grid">${tiles.map(([k, t, d]) => `<div class="tile"><span class="k">${k.toLocaleString('es-AR')}</span><h4>${t}</h4><p>${d}</p></div>`).join('')}</div>`;
}

// ───── Capítulos ─────
const chapterFiles = readdirSync(path.join(here, 'chapters')).filter((f) => f.endsWith('.html')).sort();
const toc = [];
const chapters = chapterFiles.map((f, idx) => {
  let html = readFileSync(path.join(here, 'chapters', f), 'utf8');
  const n = idx + 1;
  const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ?? [])[1]?.replace(/<[^>]+>/g, '').trim() ?? f;
  const id = f.replace(/^\d+-/, '').replace(/\.html$/, '');
  html = html
    .replace('<!--modules-->', modulesBlock)
    .replace('<!--glossary-->', glossaryBlock)
    .replace('<!--mnemonics-->', mnemonicsBlock)
    .replace('<!--flow:petrophysics-->', () => flowBlock('petrophysics'))
    .replace('<!--flow:geology-->', () => flowBlock('geology'))
    .replace('<!--stats-->', statsBlock);
  // rótulos de interfaz
  html = html.replace(/«([^«»<>\n]{1,70})»/g, '<span class="ui">$1</span>');
  // recuadros
  html = html.replace(/<aside class="callout (\w+)"(?: data-title="([^"]*)")?>([\s\S]*?)<\/aside>/g, (_, kind, t, body) =>
    `<aside class="callout ${kind}">${ICONS[kind] ?? ICONS.note}<div>${t ? `<b class="t">${t}</b>` : ''}${body.trim()}</div></aside>`);
  // figuras
  html = html.replace(/<figure data-shot="([^"]+)"([^>]*)>([\s\S]*?)<\/figure>/g, (_, name, attrs, body) => {
    const cap = body.match(/<figcaption>([\s\S]*?)<\/figcaption>/)?.[1] ?? '';
    const alt = esc(cap.replace(/<[^>]+>/g, '').trim());
    const marks = (attrs.match(/data-marks="([^"]+)"/)?.[1] ?? '').split(';').filter(Boolean)
      .map((xy, i) => { const [x, y] = xy.split(',').map(Number); return `<span class="pin" style="left:${x}%;top:${y}%">${i + 1}</span>`; }).join('');
    attrs = attrs.replace(/\s*data-marks="[^"]*"/, '');
    return `<figure${attrs}><div class="frame"><img loading="lazy" src="${shot(name)}" alt="${alt}">${marks}</div>${body}</figure>`;
  });
  // ids de secciones
  const subs = [];
  html = html.replace(/<h2(?![^>]*\bid=)([^>]*)>([\s\S]*?)<\/h2>/g, (_, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const sid = `${id}-${slug(text)}`;
    subs.push({ id: sid, title: text });
    return `<h2 id="${sid}"${attrs}>${inner}</h2>`;
  });
  for (const m of html.matchAll(/<h2 id="(ref-[^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)) subs.push({ id: m[1], title: m[2].replace(/<span class="count">[\s\S]*?<\/span>/, '').replace(/<[^>]+>/g, '').trim() });
  toc.push({ n, id, title, subs });
  return `<section class="chapter" id="${id}"><p class="eyebrow">Capítulo ${n}</p>${html}</section>`;
});


// ───── KaTeX con fuentes incrustadas ─────
let katexCss = readFileSync(path.join(katexDir, 'katex.min.css'), 'utf8');
katexCss = katexCss.replace(/src:url\(fonts\/([^)]+)\.woff2\) format\("woff2"\)[^;}]*/g, (_, f) => {
  const b = readFileSync(path.join(katexDir, 'fonts', `${f}.woff2`)).toString('base64');
  return `src:url(data:font/woff2;base64,${b}) format("woff2")`;
});
const css = readFileSync(path.join(here, 'manual.css'), 'utf8');
// Inter (OFL) incrustada en TrueType: misma tipografía en cualquier sistema y fuentes nítidas en el PDF.
const fontCss = [400, 500, 600, 700].map((w) => `@font-face{font-family:"FiubaLog Inter";font-style:normal;font-weight:${w};font-display:block;src:url(data:font/ttf;base64,${readFileSync(path.join(here, 'fonts', `Inter-${w}.ttf`)).toString('base64')}) format("truetype")}`).join('');

const tocHtml = `<ol>${toc.map((c) => `<li data-ch="${c.id}"><a href="#${c.id}"><span class="num">${c.n}</span>${esc(c.title)}</a>${c.subs.length ? `<ol>${c.subs.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('')}</ol>` : ''}</li>`).join('')}</ol>`;
const printToc = `<section class="print-toc"><p class="eyebrow">Contenido</p><h2>Índice</h2><ol>${toc.map((c) => `<li><span class="n">${c.n}</span>${esc(c.title)}</li>`).join('')}</ol></section>`;

const js = `
const links=[...document.querySelectorAll('.toc a')];
const targets=links.map(a=>document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
const search=document.querySelector('.search');
search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
 document.querySelectorAll('.toc > ol > li').forEach(li=>{let any=false;li.querySelectorAll('li').forEach(s=>{const hit=!q||s.textContent.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').includes(q);s.classList.toggle('hidden',!hit);any=any||(hit&&q);});
 const own=li.querySelector(':scope > a').textContent.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').includes(q);li.classList.toggle('hidden',!(own||any||!q));li.classList.toggle('open',!!q&&any);
 if(own&&q)li.querySelectorAll('li').forEach(s=>s.classList.remove('hidden'));});});
let ticking=false;function spy(){ticking=false;let cur=null;for(const t of targets){if(t.getBoundingClientRect().top<120)cur=t;else break;}
 links.forEach(a=>a.classList.toggle('active',cur&&a.getAttribute('href')==='#'+cur.id));
 const ch=cur&&cur.closest('section.chapter');document.querySelectorAll('.toc > ol > li').forEach(li=>{if(!search.value)li.classList.toggle('open',!!ch&&li.dataset.ch===ch.id);});}
addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(spy);}},{passive:true});spy();
`;

const page = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FiubaLog · Manual de usuario</title>
<meta name="description" content="Manual de usuario de FiubaLog, la webapp de interpretación de perfiles de pozo.">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(MARK('fav'))}">
<style>${fontCss}</style>
<style>${katexCss}</style>
<style>${css}</style>
</head>
<body>
<header class="cover" id="inicio">
  <svg class="mark" viewBox="0 0 24 24">${MARK('cv').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
  <h1>Fiuba<span>Log</span></h1>
  <p class="tag">Manual de usuario</p>
  <p class="meta">Interpretación de perfiles de pozo · FIUBA · ${esc(VERSION)}</p>
  <div class="hero"><img src="${shot('cover')}" alt="FiubaLog con el pozo del TP interpretado"></div>
</header>
<div class="layout">
<nav class="sidebar no-print" aria-label="Índice">
  <a class="brand" href="#inicio">${MARK('sb')}<span>FiubaLog<small>Manual de usuario</small></span></a>
  <input class="search" type="search" placeholder="Buscar en el índice" aria-label="Buscar en el índice">
  <div class="toc">${tocHtml}</div>
</nav>
<main>
<div class="page">
${printToc}
${chapters.join('\n')}
<p class="footer">FiubaLog · Manual de usuario · ${esc(VERSION)}. Generado desde el código de la app: la referencia de módulos, el glosario y los mnemónicos salen del registro, así que coinciden con la versión que lo generó.</p>
</div>
</main>
</div>
<script>${js}</script>
</body>
</html>`;

if (missingShots.length) {
  console.error(`Faltan capturas: ${missingShots.join(', ')}`);
  process.exitCode = 1;
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, page);
console.log(`manual: ${chapters.length} capítulos, ${(page.length / 1e6).toFixed(1)} MB → ${path.relative(root, OUT)}`);
