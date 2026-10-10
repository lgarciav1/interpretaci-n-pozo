# src/ui — sistema de diseño

Tokens, tema claro/oscuro, paleta de curvas y componentes React propios (sin librerías). Decisiones y alternativas:
[`docs/decisiones/0004-sistema-de-diseno.md`](../../docs/decisiones/0004-sistema-de-diseno.md).
Página de muestra con todo: abrir la app con **`#ui`** al final de la URL (`dist/index.html#ui` o `npm run dev` → `/#ui`).

Importar siempre desde el índice: `import { Button, Slider, curveStyle } from '../ui'`.

## Reglas para quien construya pantallas

1. **Nada de colores, tamaños ni sombras sueltos.** En CSS, `var(--…)`; en TS/canvas, los objetos de `tokens.ts`.
   Un test falla si un `.css` usa una variable que no existe.
2. **Componentes antes que HTML suelto.** Botón = `<Button>`, selector = `<Select>`, número = `<NumberField>`,
   parámetro = `<SliderField>` dentro de `<Field>`, tabla = `<DataTable>`, mensaje = `<Callout>`, vacío =
   `<EmptyState>` (que diga qué hacer), modal = `<Dialog>`. Si falta algo, se agrega acá con su CSS, no en la pantalla.
3. **CSS de pantalla** en un archivo propio importado por el componente (como `src/app/shell/shell.css`), con
   prefijo propio. El prefijo `ui-` es de este sistema. `src/app/styles.css` tiene solo el error de arranque.
4. **Números**: `formatNumber` / `formatParamValue` (coma decimal) y clase `num` (cifras tabulares). Para leer lo
   que escribe el usuario, `parseDecimal` (acepta coma o punto).
5. **Curvas**: color, trazo y escala salen de `curveStyle(rol, tema, catálogo)`. Nunca de `RoleDef.display.color`.
6. **Accesibilidad**: todo control con nombre accesible (`aria-label` o `<Field label>`); `IconButton` exige
   `label`; los tooltips no reemplazan etiquetas. Foco visible siempre (no quitar `outline` sin reemplazo).
7. **Movimiento sobrio**: duraciones `--dur-*` y curvas `--ease-*`. Con movimiento reducido valen 0. Para
   destacar un valor que cambió, `useFlash(valor)` + clase `ui-flash`.
8. **Textos en español; identificadores en inglés.**
9. **Tamaño de interfaz** (abajo): las medidas sueltas que deben crecer con el nivel van como
   `calc(18px * var(--ui-scale))` en CSS o `scaledCss(18)` en un `style`; los rótulos de canvas, con el factor que
   recibe el dibujo. Bordes de 1–2 px, radios y sombras no escalan. Un test falla si un `font-size` está en px fijos.

## Tokens (`tokens.ts`)

| Grupo | CSS | TS | Notas |
|---|---|---|---|
| Color semántico | `--color-bg`, `--color-surface(-subtle/-raised/-hover/-active/-inverse)`, `--color-text(-muted/-subtle/-inverse/-on-accent)`, `--color-border(-subtle/-strong)`, `--color-accent(-hover/-active/-soft/-soft-hover/-border/-text)`, `--color-focus`, `--color-{ok,warn,error,info}(-text/-soft/-border)`, `--color-overlay`, `--color-selection` | `THEMES[tema].color.*` | `*-text` para texto (≥ 4,5:1), el resto para fondos y puntos |
| Visor (canvas) | `--viewer-track-bg`, `--viewer-grid-major/minor`, `--viewer-axis-text`, `--viewer-cursor`… | `THEMES[tema].viewer.*` | también `zoneAlpha` (opacidad de bandas de zona) |
| Sombras | `--shadow-xs/sm/md/lg` | `THEMES[tema].shadow.*` | dependen del tema |
| Tipografía | `--font-sans/mono`, `--text-xs…3xl` (11–26 px), `--leading-*`, `--weight-*`, `--tracking-*` | `BASE_TOKENS.text.md` (número en px) | cuerpo = 13 px |
| Espaciado | `--space-0`, `-0-5`, `-1`, `-1-5`, `-2`, `-2-5`, `-3`, `-4`, `-5`, `-6`, `-8`, `-10`, `-12` | `BASE_TOKENS.space['4']` | clave × 4 px |
| Radios | `--radius-xs/sm/md/lg/xl/full` | | 4, 6, 8, 12, 16 px |
| Capas | `--z-raised/sticky/dock/resizer/popover/tooltip/modal/toast` | | nunca números sueltos |
| Movimiento | `--dur-instant/fast/base/slow/flash`, `--ease-standard/enter/exit` | `prefersReducedMotion()` | |
| Medidas | `--size-control-sm/md/lg`, `--size-topbar`, `--size-flowbar`, `--size-sidebar-left/right`, `--size-dock` | | |
| Tamaño de interfaz | `--ui-scale` (1 · 1,125 · 1,25) y texto, espaciado y medidas por nivel en `:root[data-ui-scale]` | `UI_SCALES`, `scaledTokens(nivel)`, `scalePx(px, factor)`, `canvasFont(px, peso, factor)` | `BASE_TOKENS` = Compacto |

## Tema (`theme.ts`)

- `initTheme()` al arrancar (ya lo hace `main.tsx`); `setThemePreference('system' | 'light' | 'dark')`.
  La preferencia vive en `localStorage['pozo.ui.theme']`, nunca en el proyecto.
- React: `useResolvedTheme()`, `useThemeTokens()`, `useThemePreference()`.
- Canvas: `subscribeTheme(redibujar)` + `getThemeTokens()`, o directamente `useCanvas` (abajo).
- Un subárbol puede fijar tema con `data-theme="dark"` (la página de muestra lo usa para mostrar ambos).

## Tamaño de interfaz (`uiScale.ts`)

Decisión: [`docs/decisiones/0013-tamano-de-interfaz.md`](../../docs/decisiones/0013-tamano-de-interfaz.md).

- Niveles Compacto (la densidad original), **Normal** (por defecto) y Grande. `initUiScale()` al arrancar (ya lo hace
  `main.tsx`); `setUiScale('compact' | 'normal' | 'large')`; selector `UiScaleToggle` (barra superior, junto al tema).
  La preferencia vive en `localStorage['pozo.ui.scale']`, nunca en el proyecto.
- CSS: los tokens de texto, espaciado y medidas ya cambian con el nivel. Una medida suelta que deba crecer:
  `calc(18px * var(--ui-scale))`. Un umbral de consulta de contenedor que deba seguir al texto, en `em`.
- Props en px (íconos, `Spinner`, `Popover width`, `DataTable maxHeight`, `NumberField width`, `XYPlot height`): son px
  de Compacto y el componente los escala. En un `style` propio: `scaledCss(n)`.
- React: `useUiScale()`, `useUiScaleFactor()`. Canvas: el 4.º argumento de `useCanvas`, o `getUiScaleFactor()` +
  `subscribeUiScale(redibujar)`. Superposiciones del visor: `frame.uiScale`.
- **Lo que se exporta como figura dibuja con factor 1**: no leer `getUiScaleFactor()` dentro de funciones de dibujo
  compartidas con la exportación; recibir el factor como parámetro (por defecto 1).

## Canvas (`canvas.ts`)

```tsx
const ref = useCanvas((ctx, { width, height }, theme, ui) => {
  ctx.fillStyle = theme.viewer.trackBg;
  ctx.fillRect(0, 0, width, height);
  ctx.font = canvasFont(BASE_TOKENS.text.xs, 400, ui); // rótulos que siguen al tamaño de interfaz
  const s = curveStyle('GR', theme.name, registry.roles);
  ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.setLineDash(s.dash);
  // …
}, [datos]);
return <canvas ref={ref} style={{ width: '100%', height: 300 }} />;
```

Escala por `devicePixelRatio`, redibuja al cambiar el tamaño (ResizeObserver), el tema y el tamaño de interfaz. Ejemplo completo:
`showcase/SampleLog.tsx` (GR con relleno, resistividades en log, densidad–neutrón con cruce).

## Paleta de curvas (`curves.ts`)

- `curveStyle(rol, tema, catálogo?, claveDeRespaldo?)` → `{ color, line, dash, width, kind, scale, min, max, reversed, label }`.
  Color y trazo de `CURVE_PALETTE` (curada, claro y oscuro); escala, rango e inversión del catálogo de roles.
  Roles de módulos sin paleta: su `display.color` con contraste ≥ 3:1 garantizado; sin color, uno categórico estable.
- `FILL_PALETTE` + `fillColor(id, tema)`: cruce de gas, arcilla, arena, caliza, dolomía, fluidos, banderas,
  porosidad sin partir (`pore`) y resto sin partir (`undivided`, neutro) de la pista volumétrica…
- `CURVE_SWATCHES`: colores clásicos de perfiles (de la paleta) para elegir el color de una curva.
- `ZONE_PALETTE` / `zoneColor(i)`: colores para zonas nuevas.
- `SEQUENTIAL_PALETTE[tema]` + `rampColor(t, paradas)`: rampa viridis para colorear puntos por una tercera curva
  (crossplot libre); en oscuro arranca más clara.
- `dashPattern(línea, grosor)`: patrón para `setLineDash` / `stroke-dasharray`.

## Componentes

| Componente | Para qué |
|---|---|
| `Button` | Acción. `variant`: primary / secondary / ghost / danger; `size`: sm / md / lg; `icon`, `iconRight`, `loading`, `block`. |
| `IconButton` | Acción con ícono; `label` obligatorio (nombre accesible y tooltip); `pressed` para alternar. |
| `SegmentedControl` | Opciones excluyentes visibles (radiogroup, flechas). `block`, `wrap`, opciones solo-ícono con `title`. |
| `Tabs` + `TabPanel` | Pestañas con paneles (tablist, flechas, insignia por pestaña). El rótulo va en `.ui-tabs__label` (y en el `title`): una pantalla puede ocultarlo visualmente en las no elegidas cuando no entran (el dock lo hace por debajo de 74 em). |
| `Select` | Selector nativo estilizado; `options` o `groups` (optgroup). |
| `TextField` | Texto de una línea con ícono y sufijo. |
| `NumberField` | Número con coma o punto, unidad, Enter/Escape, ↑/↓ por paso (Mayús ×10; log proporcional); destella al cambiar desde afuera. |
| `Slider` | Lineal o log (`scale`), teclado propio, `aria-valuetext` con el valor real, marca opcional (`mark`, p. ej. el default). |
| `SliderField` | Slider + NumberField + unidad: el control estándar de un parámetro. |
| `Field` | Etiqueta + ayuda (ⓘ con tooltip) + control + pista/error; `aside` para insignias y "restablecer". |
| `Checkbox`, `Switch` | Casilla e interruptor (`role="switch"`), con descripción opcional. |
| `Badge` | Etiqueta de estado: `tone` neutral/accent/ok/warn/error/info, `variant` soft/outline/solid. |
| `Chip` | Ficha con muestra de color (zonas, curvas, filtros); seleccionable y removible. |
| `StatusDot` | Semáforo con nombre accesible; `pulse` para "en curso"; `nativeTitle={false}` si va dentro de un `Tooltip`. |
| `Callout` | Mensaje en un panel (info, ok, warn, error con `role="alert"`), con título y acciones. |
| `EmptyState` | Estado vacío: ícono, título, qué hacer y acciones. |
| `Spinner` | Actividad (anunciada si tiene `label`). |
| `Dialog` | Modal: foco atrapado, Escape/fondo cierran (salvo `dismissible={false}`), foco vuelve al disparador; `data-autofocus` para el foco inicial; `headerExtra`, `footer`, `size`. |
| `Popover` | Capa NO modal anclada a un elemento (`anchorRef`): `role="dialog"` con `label`, foco inicial en `[data-autofocus]` o el primer control, Tab circula adentro, Escape cierra y devuelve el foco al ancla, clic afuera cierra. Se reubica y gira si no entra. La usa el editor de escalas del visor. |
| `ColorPicker` | Muestras (radiogroup con flechas; por defecto `CURVE_SWATCHES`, o `swatches`, p. ej. `ZONE_PALETTE`) + «Otro» con el selector nativo del sistema. Devuelve `#rrggbb`. |
| `Menu` | Menú desplegable (flechas, letra inicial, Escape); ítems con ícono, descripción, atajo, separadores y rótulos. |
| `Tooltip` | Ayuda al pasar el mouse o llegar con teclado; `aria-describedby` (salvo `describe={false}`). |
| `toast()` + `Toaster` | Avisos efímeros en región `aria-live` (un `Toaster` en la raíz). |
| `Panel` | Tarjeta con encabezado (overline, título, acciones) y pie. |
| `Section` | Bloque con encabezado en versalitas, `meta`, acciones; `collapsible`. |
| `DataTable` | Tabla con cabecera fija (`maxHeight`), columnas `align: 'num'` (derecha + tabulares), filas seleccionables. |
| `ResizeHandle` | Separador redimensionable accesible (arrastre, flechas, Enter para colapsar). |
| `Stepper` | Barra de pasos navegable (flujo guiado): estados done / partial / todo / skipped / empty / locked, paso activo y sugerido. Si no entra, se compacta sola (conectores cortos → `shortLabel` → resueltos sin rótulo → solo marcas). |
| `WizardSteps` | Pasos de un asistente dentro de un diálogo (solo informa, no navega): número, check en los completos, actual resaltado. |
| `FileDrop` | Zona para soltar o elegir un archivo (arrastre, clic, Enter/Espacio); `accept`, `disabled`, `inputTestId`. |
| `ThemeToggle` | Sistema / claro / oscuro. |
| `UiScaleToggle` | Tamaño de interfaz: compacto / normal / grande. |
| `CurveLegend`, `CurveSwatch` | Encabezado de curva (nombre en su color, rango, log, unidad, muestra del trazo); `tag` agrega una etiqueta («alternativa»). |
| `Icon`, `BrandMark` | Íconos SVG propios (`ICON_NAMES`); para agregar uno, una entrada en `ICONS`. |

Puro y testeado (`tests/ui/`): `tokens.ts` (incluidos los niveles de tamaño), `uiScale.ts`, `color.ts`, `curves.ts`,
`format.ts`, `scale.ts`, `computePosition` de `components/layer.tsx`.

## Clases heredadas

Ya no quedan: `WellPanel`, `Qc` y `LoadWellDialog` usan componentes y su propio CSS (`well-panel.css`, `qc.css`,
`load-well.css`, prefijos `well-panel__`, `qc-`, `lw-`). `src/app/styles.css` solo tiene el error de arranque. No
agregar clases ahí.

## Contrato de panel a medida

`modulePanel.ts`: `src/modules/<id>/panel.tsx` exporta `panel: ModulePanel`; la app lo descubre sola.
