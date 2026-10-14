# Manual de usuario

Genera `docs/manual/FiubaLog-manual.html` (un solo archivo, funciona sin internet) y `docs/manual/FiubaLog-manual.pdf` (A4).
Estética limpia: fondo blanco, tipografía del sistema (SF en Mac), capturas reales de la app y ecuaciones con KaTeX.

## Cómo se arma

| Archivo | Qué hace |
|---|---|
| `chapters/NN-*.html` | Los capítulos, en orden. Convenciones: `«Rótulo»` para textos de la interfaz, `<figure data-shot="x">` para una captura (`class="wide"` o `"half"`; `data-marks="x%,y%;…"` agrega marcadores numerados), `<aside class="callout tip\|warn\|note\|ok" data-title="…">`. |
| `dump-registry.mjs` | Vuelca el registro de módulos, el flujo, los roles y los mnemónicos a `build/registry.json`. De ahí salen la **referencia de módulos**, las tablas del flujo, el glosario y los mnemónicos (marcadores `<!--modules-->`, `<!--flow:petrophysics-->`, `<!--glossary-->`, `<!--mnemonics-->`, `<!--stats-->`). |
| `capture.mjs` | Abre la app en `:5173`, carga el pozo del TP, recorre los pasos y saca cada captura a 2× en `build/raw/`. `node capture.mjs a,b` corre solo esas. |
| `shots.py` | Pasa las capturas a WebP en `build/shots/`. |
| `manual.css` | Estilos de pantalla e impresión (A4). |
| `build.mjs` | Arma el HTML único: capítulos, bloques generados, capturas incrustadas y KaTeX con sus fuentes. Falla si falta una captura. |
| `pdf.mjs` | Imprime el HTML a PDF con Chromium. |

## Regenerar

```bash
npx vite --port 5173 --strictPort &      # la app, para las capturas
node tools/manual/dump-registry.mjs
node tools/manual/capture.mjs            # PLAYWRIGHT_MODULE=… si Playwright no está en el proyecto
python3 tools/manual/shots.py
node tools/manual/build.mjs
node tools/manual/pdf.mjs
```

Si cambia la interfaz, alcanza con volver a sacar las capturas afectadas. Si cambia un módulo, la referencia se
actualiza sola con `dump-registry.mjs` + `build.mjs`.
