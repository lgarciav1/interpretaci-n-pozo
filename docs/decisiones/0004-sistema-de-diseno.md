# 0004 — Sistema de diseño, armazón de la app y flujo guiado

- Estado: aceptada (fase 3)
- Alcance: `src/ui/` (tokens, tema, paleta de curvas, componentes), `src/app/shell/` (armazón de tres zonas),
  `src/app/flow/` (flujo guiado) y el progreso del flujo en el proyecto (`src/core/state/`).
- Lo heredan: el visor multipista en canvas (fase 4), histogramas y crossplots (fase 7), todos los paneles de
  módulos y las pantallas que migre el desarrollador de interfaz.

## Contexto

La app tiene que verse más moderna que el software de la industria sin cambiar lo que un petrolero lee sin pensar
(colores por curva, escala log para resistividad, rellenos). El visor y los gráficos se dibujan en canvas: los
colores no pueden vivir solo en CSS. Todo se entrega en un único HTML que funciona sin internet, así que no hay
fuentes ni recursos remotos.

## Decisiones

### D1. Los tokens se definen en TypeScript y el CSS se genera a partir de ellos

`src/ui/tokens.ts` es la fuente de verdad: `BASE_TOKENS` (tipografía, espaciado, radios, z-index, movimiento,
medidas del armazón) y `THEMES.light` / `THEMES.dark` (colores semánticos, sombras y colores del visor). Al arrancar,
`installTokens()` genera las variables CSS (`--color-text-muted`, `--space-4`, `--dur-fast`…) y las inserta en un
`<style id="ui-tokens">`. Los componentes usan `var(--…)` en su CSS; el canvas lee los mismos valores como objetos
(`getThemeTokens().viewer.grid`).

- Descartado: **CSS como fuente y `getComputedStyle` desde el canvas.** Obliga a parsear cadenas, depende del DOM
  (no sirve en un worker ni en tests) y no da tipos.
- Descartado: **duplicar valores en CSS y en TS.** Se desincronizan.
- Descartado: **generarlos en el build (plugin de Vite).** Más maquinaria para ahorrar ~4 kB de texto y 1 ms.
- Red de seguridad: un test recorre todos los `.css` de `src/` y falla si alguno usa una variable `--…` que los
  tokens no definen, y otro exige que claro y oscuro tengan exactamente las mismas claves.

### D2. Tema: sigue al sistema, con selector manual; preferencia en `localStorage`

Preferencia `'system' | 'light' | 'dark'` (por defecto `system`) en `localStorage['pozo.ui.theme']`, siempre dentro
de `try/catch` (en `file://` o en modo privado puede fallar: la app sigue con `system`). Nunca va al proyecto: es
del usuario, no del pozo. El tema resuelto se escribe en `<html data-theme="light|dark">` y también se puede fijar
en un subárbol (`<div data-theme="dark">`), lo que permite mostrar ambos temas a la vez en la página de muestra.

`src/ui/theme.ts` expone `subscribeTheme(fn)` para el canvas (redibujar al cambiar de tema, también cuando cambia el
del sistema) y los hooks `useResolvedTheme()` / `useThemeTokens()` (con `useSyncExternalStore`, sin zustand).
`prefers-reduced-motion` pone todas las duraciones en 0 desde el CSS generado y `prefersReducedMotion()` lo expone a TS.

### D3. Fuente del sistema, sin fuente incrustada

Pila: Segoe UI Variable / Segoe UI (Windows), SF Pro (macOS), Inter si está instalada, Roboto, `system-ui`. Las
del sistema de Windows y macOS son excelentes en pantalla y tienen cifras tabulares (`font-variant-numeric:
tabular-nums`, aplicado a todo valor numérico con la clase/utilidad `num`).

- Descartado por ahora: **Inter incrustada** (subconjunto latino, variable): ~110 kB en woff2, ~150 kB en base64
  dentro del HTML, más el costo de decodificarla antes del primer render. La ganancia es uniformidad entre
  sistemas, no legibilidad. El token `--font-sans` permite incrustarla en la fase 12 si la revisión visual lo pide
  (una `@font-face` con `data:` y anteponerla en la pila), sin tocar componentes.

### D4. Paleta de curvas por rol en `src/ui/curves.ts`, con tema; rangos y escala desde el catálogo de roles

`curveStyle(rol, tema, catálogo)` devuelve `{ color, line, dash, width, scale, min, max, reversed, kind }`:

- **Color, trazo y grosor** salen de `CURVE_PALETTE` (curado, un color para claro y otro para oscuro). Convenciones:
  GR verde continuo; SP azul oscuro rayado; CALI negro/gris rayado y BS punteado fino; resistividad profunda roja
  continua y más gruesa, media azul rayada, somera naranja punteada, Rxo verde azulado raya-punto; RHOB roja
  continua; NPHI azul punteada (relleno de cruce amarillo para gas, gris-marrón para arcilla); DT violeta; PEF
  magenta rayado; VSH marrón; PHIE azul; SW azul con relleno de hidrocarburo; PERM naranja en log.
- **Escala sugerida, rango e inversión** salen de `RoleDef.display` del catálogo de `src/core/roles.ts`, que ya era
  la fuente de esos datos: no se duplican.
- **Roles nuevos de módulos** (no están en la paleta): se usa `display.color` del rol y, en oscuro, se aclara hasta
  llegar a contraste 3:1 contra el fondo de pista. Sin `display`: color estable por hash del id en una paleta
  categórica. Así un módulo nuevo se ve bien sin tocar `src/ui/`.
- `FILL_PALETTE` (cruce de gas, arcilla, arena, caliza, dolomía, carbón, anhidrita, agua, petróleo, gas,
  hidrocarburo, agua ligada, derrumbe, reservorio y pay netos) y `ZONE_PALETTE` (colores sugeridos para zonas nuevas).
- Tests: todos los roles incorporados tienen entrada en la paleta; toda curva de tipo línea tiene contraste ≥ 3:1
  contra el fondo de pista en su tema.

`RoleDisplay.color` del núcleo queda como color de respaldo (contextos sin tema, roles declarados por módulos). La
interfaz nunca lo lee directo: siempre `curveStyle()`.

### D5. Componentes propios, sin librería

Sin dependencias nuevas. Componentes en `src/ui/components/`, cada uno con su CSS (prefijo `ui-`, sin chocar con
las clases viejas), accesibles por teclado y con foco visible (`:focus-visible` con anillo de 2 px del acento).
Íconos SVG propios en línea (`<Icon name="…">`, trazo 1,75 px en grilla de 24).

- Descartado: **Radix/React Aria.** Accesibilidad resuelta, pero +40–80 kB y una capa de abstracción para ~20
  componentes simples. Los casos difíciles (diálogo con foco atrapado, menú con flechas, tooltip con
  `aria-describedby`) están implementados y probados a mano.
- Descartado: **Tailwind.** Mezcla estilo y estructura en el JSX y no resuelve la lectura de colores desde canvas.
- Los controles de formulario se basan en los nativos (`<select>`, `<input type="range">`): accesibles, rápidos y
  consistentes con el teclado; se estilizan, no se reimplementan.
- El slider log trabaja en posiciones 0–1000 sobre `ln(valor)` y anuncia el valor real con `aria-valuetext`. La
  conversión (`src/ui/scale.ts`) y el parseo de números con coma o punto (`src/ui/format.ts`) son puros y testeados.

### D6. Armazón de tres zonas

```
┌ barra superior: marca · proyecto/pozo · espacio de trabajo · estado del motor · Cargar · Snapshots · Proyecto · tema ┐
├ flujo guiado: Cargar → Calidad → Zonas → Arcilla → Porosidad → Rw → Saturación → Cutoffs → Sumario                  ┤
├ izquierda ┃ centro                                         ┃ derecha                                               ┤
│ pozo,     ┃ visor multipista (fase 4: ViewerSlot)          ┃ inspector: paso activo (estado, saltar/completar),  │
│ curvas,   ┃────────────────────────────────────────────────┃ métodos del paso y panel del módulo activo          │
│ calidad,  ┃ dock con pestañas: Resultados · Avisos · Motor ┃                                                      │
│ zonas     ┃ (fase 7: Histograma, Crossplot)                ┃                                                      │
└───────────┸────────────────────────────────────────────────┸──────────────────────────────────────────────────────┘
```

- Laterales redimensionables (separador con `role="separator"`, arrastre y flechas) y colapsables (botón o doble
  clic); el dock se redimensiona en alto y se colapsa. Medidas en `localStorage['pozo.ui.layout']` (comodidad por
  usuario; nunca en el proyecto).
- **Dock extensible**: `src/app/shell/dockPanels.tsx` es una lista de `{ id, title, icon, badge?, component }`.
  Histograma y crossplot (fase 7) son una entrada más. El visor ocupa `ViewerSlot` (fase 4) y recibe el tamaño
  disponible.
- Acciones de proyecto agrupadas: «Cargar pozo» como acción principal; snapshots en un diálogo propio; guardar/abrir
  en un menú «Proyecto». Los mensajes van a avisos efímeros (`toast`), no a texto suelto en la barra.

### D7. Flujo guiado: definición pura, estado derivado + marcas del usuario en el proyecto

Definición pura en `src/app/flow/flow.ts` (sin React; testeada): `FLOWS[espacio]` es una lista de pasos
`{ id, label, kind: 'load'|'qc'|'zones'|'modules', categories?, ports?, targets?, hint }`.

**Qué módulos tiene un paso** (sin tocar el núcleo al agregar un módulo): los de sus `categories` **o** los que
producen alguno de sus `ports`. Un módulo puede estar en dos pasos (un Pickett de categoría `saturation` que produce
`RW` aparece en Rw y en Saturación). Para Rw se agregó la categoría conocida `water` («Agua de formación») en
`src/core/workspaces.ts` y el paso además toma a todo productor de `RW`, `RWA` o `RMF`: un módulo «Rw desde SP»
puede declararse `category: 'water'` o en cualquier otra categoría y aparece igual. Los módulos que no están en
ningún paso (p. ej. permeabilidad, categorías nuevas) se eligen desde el selector de módulos del inspector.

**Estado de un paso** (en este orden de precedencia):

| Estado | Cuándo |
|---|---|
| `locked` | No hay pozo cargado (todos menos Cargar). |
| `done` | Derivado: hay pozo (Cargar), hay zonas (Zonas), algún puerto objetivo (`targets`) lo produce una fuente activa sin error (pasos de módulos; sin `targets`, cualquier salida de sus módulos). O marcado completo por el usuario. Calidad solo se completa marcándola (revisar es un acto humano; el asistente de carga la marca, porque su último paso es el control de calidad). |
| `skipped` | Marcado como saltado por el usuario. |
| `empty` | Paso de módulos sin módulos en este espacio de trabajo: «Sin módulos todavía», se puede saltar. |
| `partial` | Hay resultados de módulos del paso pero no del puerto objetivo (hoy: Arcilla con IGR y sin VSH). |
| `todo` | Pendiente. |

**Dónde vive el estado.** Lo derivado no se guarda. Las marcas del usuario (`done`/`skipped` por paso) son trabajo
del usuario sobre un pozo y se guardan en el proyecto, en `WellEntry.progress = { marks: Record<pasoId, 'done' |
'skipped'> }`, **fuera de `Interpretation`**: así no entran en los snapshots ni en sus diferencias, y marcar un paso
no dispara un cálculo del motor. El formato del proyecto pasa a la **versión 2**; la migración v1 → v2 agrega
`progress` vacío (test con un archivo v1). Receta pura: `setStepMark(proyecto, pozo, paso, marca | null)`.

El paso seleccionado es estado de interfaz (`useUi.activeStepId`); si no hay ninguno se muestra el sugerido (el
primero `todo`/`partial`). Elegir un paso abre su vista en el inspector y, si tiene módulos, el primero.

- Descartado: **marcas dentro de `Interpretation`.** Restaurar un snapshot cambiaría el progreso, aparecería en las
  diferencias y cada marca recalcularía.
- Descartado: **marcas en `localStorage`.** Se perderían al abrir el proyecto en otra computadora.
- Descartado: **un campo `step` en el contrato de módulo.** Ata módulos al flujo; categoría + puertos alcanza.

## Consecuencias

- Fase 4: el visor usa `curveStyle()`, `getThemeTokens().viewer` y `subscribeTheme()`; se monta en `ViewerSlot`.
- Fase 7: histograma y crossplot son entradas de `dockPanels.tsx` y usan los mismos tokens.
- El desarrollador de interfaz migra las pantallas que quedan con clases viejas (`src/app/styles.css`, sección
  «Clases heredadas»), que ya están mapeadas a los tokens nuevos y funcionan en ambos temas.

## Abierto

- Incrustar Inter si la revisión visual en Windows/macOS lo justifica (fase 12).
- Paneles de dock aportados por módulos (`src/modules/<id>/dock.tsx` descubierto como los paneles a medida).
- Historial de deshacer: cada movimiento de slider hace un `commit`; el historial tendrá que agrupar cambios
  consecutivos de un mismo parámetro.
- Recorrido guiado de 30 s la primera vez y paleta de comandos (Ctrl+K), sobre el mismo `Menu`/`Dialog`.
