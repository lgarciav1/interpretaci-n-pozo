# 0025 — Pantalla «Ecuaciones» (fase 9a, tarea K)

- Estado: aceptada (fase 9a).
- Alcance: carpeta `src/app/ecuaciones/` (`EquationsDialog.tsx`, `ecuaciones.css`, `model.ts` puro, `render.ts` con
  KaTeX, `extras.ts` con la documentación de paneles que no son módulos, `open.ts` con `openEquations(moduleId?)` y
  `commands.ts` para la paleta), bandera `equations` en `src/app/store/ui.ts`, montaje en `App.tsx`, botón Σ en la barra
  superior y en el encabezado del panel de módulo, dependencia `katex` (versión fija) y un plugin chico en
  `vite.config.ts`. Sin cambios en el contrato de módulo (`ModuleDocs` ya existía), en el núcleo ni en el visor.

## Contexto

Las ecuaciones no se muestran en la interfaz salvo en el módulo Ecuaciones (CLAUDE.md). Cada módulo ya declara
`docs` (summary, ecuaciones en LaTeX, referencias y notas) y la calculadora de agua de formación tiene su
`FORMATION_WATER_DOCS`. Faltaba la pantalla que las muestre.

## D1. KaTeX, empaquetado e incrustado

- **KaTeX** (`katex` 0.16.47, versión fija) y no MathJax: render síncrono a HTML (`renderToString`), sin DOM ni
  configuración global, ~270 kB y CSS propio. Corre también en Node, así los tests validan el LaTeX de todos los módulos.
- **Offline**: el CSS se importa del paquete (`katex/dist/katex.min.css`) y Vite incrusta las fuentes; nada de CDN.
- **Solo woff2**: KaTeX declara cada fuente en woff2, woff y ttf; en el HTML único se incrustarían las tres (≈ 1,6 MB
  en base64) aunque el navegador use la primera. El plugin `katex-woff2-only` (`vite.config.ts`) quita las otras dos de
  `katex.css`. Todos los navegadores actuales leen woff2. Build único: 2,35 MB → 2,99 MB (sin el plugin, 4,08 MB).
- `renderToString(latex, { throwOnError: false, displayMode: true })`, cacheado por texto. Si KaTeX devuelve un
  `katex-error` (o falla), se muestra el LaTeX crudo en monoespaciado: nunca rompe la pantalla.
- Test (`tests/equations.test.ts`): cada módulo y cada extra tiene summary, ≥ 1 ecuación y ≥ 1 referencia, y las 89
  ecuaciones renderizan con `throwOnError: true` y `strict: 'error'`.

## D2. Ubicación: diálogo fuera del flujo guiado

- Diálogo `xl` (como el informe de calidad), no un paso del flujo ni una pestaña del dock: es consulta, no trabajo
  sobre el pozo, y funciona sin pozo cargado.
- Se abre desde el botón Σ de la barra superior, desde la paleta («Abrir las ecuaciones de los métodos», grupo Ayuda;
  palabras clave ecuaciones, fórmulas, métodos, referencias) y desde el botón Σ del encabezado del panel de módulo.
- **Enlace directo**: `openEquations(moduleId?)`; sin id abre en el módulo activo del inspector o, si no hay, en la
  pestaña abierta del dock si tiene entrada (agua de formación); si no, en el primero.

## D3. Contenido

- Izquierda: módulos agrupados con las categorías del registro (mismas etiquetas y orden que el selector de módulos)
  y buscador que filtra por nombre, categoría, summary, notas, descripciones y texto LaTeX, sin distinguir tildes ni
  mayúsculas. Derecha: categoría, nombre, summary, ecuaciones numeradas con su descripción, tabla de parámetros
  generada del esquema (nombre, «por zona», unidad, por defecto y rango; enum y booleanos con sus opciones), notas y
  referencias numeradas.
- Teclado: ↑/↓ cambian de módulo desde el buscador o la lista; Esc cierra (del `Dialog`). Sin resultados: estado vacío
  con «Limpiar búsqueda».
- Paneles que no son módulos del motor: se agregan en `extras.ts` con una categoría conocida.

## Abierto

- Enlace a la sección «Ecuaciones» desde la ayuda de cada panel del dock (hoy solo agua de formación, por la pestaña).
- Copiar el LaTeX de una ecuación al portapapeles.
