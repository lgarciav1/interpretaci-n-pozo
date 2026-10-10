# 0013 — Tamaño de interfaz (Compacto, Normal, Grande)

- Estado: aceptada (fase 7-0).
- Alcance: `src/ui/tokens.ts` (niveles y tokens escalados), `src/ui/uiScale.ts` (preferencia y suscripción),
  `src/ui/canvas.ts` (`useCanvas` pasa el factor), los CSS de `src/` (medidas sueltas con `--ui-scale`), el visor y sus
  superposiciones (`FrameInput.uiScale`, `OverlayFrame.uiScale`), los gráficos x–y (`drawXYScene(…, ui)`), el armazón
  (`src/app/App.tsx`, `src/app/store/ui.ts`, barra superior y barra de pasos). No cambia el formato de proyecto, la
  petrofísica ni las figuras exportadas.

## Contexto

La app se diseñó densa (texto base de 13 px). En una notebook los paneles se ven chicos. Hace falta un selector de
tamaño que agrande texto, espaciados, controles, paneles y también los rótulos que se dibujan en canvas (visor y
gráficos), sin romper las interacciones ni el ancho mínimo, y sin que las figuras exportadas cambien según lo que eligió
cada usuario.

## Decisiones

### D1. Tres niveles con un factor; el tamaño original pasa a ser Compacto

| Nivel | Factor | Texto xs/sm/md/lg/xl (px) | Control md | Barra superior | Laterales (izq./der.) | Dock |
|---|---|---|---|---|---|---|
| Compacto | 1 | 11 / 12 / 13 / 14 / 16 | 30 | 52 | 292 / 368 | 260 |
| **Normal** (por defecto) | 1,125 | 12 / 14 / 15 / 16 / 18 | 34 | 59 | 329 / 414 | 293 |
| Grande | 1,25 | 14 / 15 / 16 / 18 / 20 | 38 | 65 | 365 / 460 | 325 |

`BASE_TOKENS` sigue siendo la fuente de verdad y vale para Compacto. `scaledTokens(nivel)` multiplica `text`, `space` y
`size` por el factor y redondea a px enteros (texto y bordes nítidos). No escalan radios, capas, movimiento, bordes de
1–2 px, sombras ni barras de desplazamiento. Las medidas de laterales y dock son las de fábrica: ver D5 para el tope
por ventana.

- Descartado: **tablas de texto a mano por nivel.** Con el factor y el redondeo la escala queda pareja y no hay que
  mantener tres tablas; si un nivel necesita un ajuste fino, se cambia el factor.
- Descartado: **más niveles o un slider continuo.** Tres niveles se prueban con capturas; un valor continuo genera
  medidas fraccionarias y combinaciones sin revisar.

### D2. Escalar por tokens y `--ui-scale`, no con `zoom` ni `transform`

El CSS generado (`tokensToCss`) tiene la base en `:root` (Compacto, con `--ui-scale: 1`) y un bloque por nivel en
`:root[data-ui-scale="normal" | "large"]` con texto, espaciado, medidas y `--ui-scale`. Las medidas sueltas que deben
escalar (alturas de chips, anchos de columnas, mínimos de grillas, tamaños de letra de 10 px) se escriben
`calc(18px * var(--ui-scale))`; con Compacto dan exactamente lo de antes. Los tamaños que llegan por props (íconos,
`Spinner`, ancho de `Popover`, `maxHeight` de `DataTable`, ancho de `NumberField`, alto de `XYPlot`) se interpretan
como px de Compacto y se aplican con `scaledCss(n)` = `calc(npx * var(--ui-scale, 1))`: ningún componente se re-renderiza
al cambiar de nivel. Un test falla si un `.css` fija `font-size` en px sin tokens ni `--ui-scale`.

- Descartado: **`zoom` CSS en la raíz.** Es lo más corto, pero mezcla sistemas de coordenadas: `getBoundingClientRect`
  y `clientX` quedan en px escalados mientras `clientWidth` y el tamaño del canvas no, así que el visor (puntero,
  arrastre, zoom), los popovers con `position: fixed` y la nitidez del canvas (habría que multiplicar el
  `devicePixelRatio`) se rompen o difieren entre navegadores.
- Descartado: **`transform: scale()`.** Mismo problema de coordenadas y además texto borroso.
- Descartado: **pasar todo a `rem`.** Habría que reescribir todos los CSS a valores ilegibles (0,8125rem) y el canvas
  igual necesitaría el factor.

### D3. Preferencia del usuario, como el tema

`src/ui/uiScale.ts` copia el patrón de `theme.ts`: preferencia en `localStorage['pozo.ui.scale']` (siempre dentro de
`try/catch`; sin almacenamiento dura la sesión), nunca en el proyecto; nivel aplicado en `<html data-ui-scale>` antes
del primer render (`initUiScale()` en `main.tsx`); `subscribeUiScale` para canvas y `useUiScale()` /
`useUiScaleFactor()` para React. `resolveUiScale` (pura) lleva cualquier valor desconocido a Normal. El selector
(`UiScaleToggle`) va en la barra superior junto al del tema, con el mismo componente (`SegmentedControl`: `radiogroup`
con `aria-checked`, flechas, tooltip y nombre accesible «Tamaño compacto / normal / grande»), y en la página de muestra.

### D4. Canvas: el factor es un parámetro del dibujo, nunca un estado global leído adentro

- `useCanvas(draw)` llama a `draw(ctx, tamaño, tema, uiScale)` y se redibuja al cambiar el nivel.
- Visor: `FrameInput.uiScale` (rótulos de profundidad, notas, rótulo del cursor) y `OverlayFrame.uiScale` para las
  superposiciones (rótulos y cajas de zonas, siglas de corona, contactos MDT, etiquetas de tendencias y **tolerancias
  de puntero**, que crecen con el factor). Los anchos fijos de pista (profundidad, banderas) y el mínimo de pista se
  multiplican en `WellViewer`, que es quien conoce el nivel.
- Gráficos x–y: `drawXYScene(…, compact, ui)` y `plotRectFor(…, ui)` (márgenes de ejes), `drawTrendLabel` con
  `style.ui`. Los puntos y líneas de datos no cambian de tamaño.
- **Exportación (0012) intacta**: `drawViewerFigure` y `drawXYFigure` no pasan el factor (vale 1), así que la figura
  sale idéntica con cualquier nivel. Verificado: el SVG del perfil del TP tiene el mismo hash antes y después de este
  cambio, y un test compara el SVG del perfil y de un crossplot en los tres niveles. Con factor 1 las cadenas de fuente
  y las cajas son exactamente las de antes (`scalePx(n, 1) = n`, sin redondeo).
- Contrato para módulos nuevos: rótulos con `scalePx(BASE_TOKENS.text.xs, frame.uiScale ?? 1)`; nunca posiciones de
  datos.

### D5. Paneles: medidas guardadas en px de Compacto y tope automático por ventana

`ShellLayout` guarda anchos y alto en px de Compacto; el CSS los multiplica (`--shell-left: calc(Wpx * var(--ui-scale))`)
y el separador trabaja en px de pantalla (× factor), así cambiar de nivel agranda los paneles en proporción. Hasta que
el usuario arrastra un separador, la medida es **automática**: la de fábrica × factor, pero sin pasar del 24 % (columna
del pozo) y 26 % (inspector) del ancho de la ventana, ni del 28 % del alto (dock). En 1366 × 768 con Normal el perfil
conserva ~680 px de ancho y el dock no lo aplasta; en pantallas grandes no hay tope efectivo. Al arrastrar, la medida
pasa a ser exactamente la elegida (`leftAuto`/`rightAuto`/`dockAuto = false`). Las medidas guardadas antes de esta
versión son automáticas si eran las de fábrica. `shellSize` y `shellSizeCss` son puras y están testeadas.

- Descartado: **no escalar los paneles.** El texto más grande en el mismo ancho corta más rótulos.
- Descartado: **tope fijo para todo valor.** Impediría a quien quiere un dock alto agrandarlo en una pantalla baja.

### D6. Barras que se compactan por etapas en vez de cortar

- **Barra superior**: es un contenedor (`container: topbar / inline-size`) y se compacta con consultas de contenedor en
  `em`, que siguen al tamaño del texto (1 em = 13 px en Compacto): < 135 em se oculta el nombre de la app; < 104 em
  Snapshots, Exportar, Proyecto y el estado del motor quedan en ícono; < 86 em también los espacios de trabajo y
  «Cargar pozo». Los rótulos se ocultan solo a la vista (nombre accesible y `title` siguen). El nombre del pozo se recorta
  con puntos suspensivos. Al ser contenedor, su contenido ya no puede ensanchar la página.
- **Barra de pasos** (`Stepper`): mide y elige la primera etapa que entra: completa → conectores cortos → abreviaturas
  (`FlowStepDef.short`: «Poros.», «Sat.», «Perm.», «Sum.», «Vol.») → pasos resueltos solo con su marca → solo marcas.
  El paso activo conserva su rótulo y todos tienen nombre accesible y tooltip. Arregla además el corte de «Vol…» que ya
  existía a 1440 px.
- **Barra del visor**: contenedor `wvbar`; < 51 em «Tendencia» y «Marcar zona» quedan en ícono, < 40 em se oculta la
  escala 1:N; el inicio recorta en vez de superponerse.
- El encabezado de curvas angosto (`@container … 12.9em`) pasó de px a em por la misma razón.

## Verificación

- `npm run typecheck`, `npm test` (incluye `tests/ui/ui-scale.test.ts` y `tests/figures/ui-scale.test.ts`) y
  `npx vite build`.
- Capturas con Chromium a 1366 × 768 y 1440 × 900 en los tres niveles, con el pozo de demostración y el dock abierto
  (también con los plugs de ejemplo para ver el crossplot k–φ): sin cortes nuevos ni solapamientos, texto del canvas
  nítido, `document.documentElement.scrollHeight` igual al alto de la ventana y sin desplazamiento horizontal de página.
- Interacciones en los tres niveles: zoom con Ctrl+rueda, paneo arrastrando, tooltip y clic en la franja de zonas
  (mismo resultado en los tres).

## Pendiente

- Con Grande en 1366 × 768 el perfil queda bajo (~190 px de cuerpo con el dock abierto): es la concesión del nivel; se
  recupera colapsando el dock o los laterales.
- Las medidas en px que se pasan como props quedan en px de Compacto por convención (documentada en `src/ui/README.md`);
  un componente nuevo que use `style={{ width: 120 }}` sin `scaledCss` no escala.
- No verificado en Firefox ni Safari (las consultas de contenedor y `clip-path` son estándar desde 2023).
