# 0005 — Visor multipista

- Estado: aceptada (fase 4a)
- Alcance: `src/viewer/` (modelo, cálculos, dibujo y componente), `src/core/display.ts` (configuración guardada),
  `src/app/shell/ViewerSlot.tsx` (conexión con los stores) y `src/app/store/viewer.ts` (cursor publicado).
- Lo heredan: la fase 4b (pista volumétrica, encabezado de pozo, minimapa, editor de escalas, edición de zonas),
  las superposiciones de presiones MDT y corona (fase 6), histograma y crossplot conectados (fase 7) y las pistas
  armables (fase 7).

## Contexto

El visor es la pantalla principal: tiene que dibujar decenas de miles de muestras por curva a 60 cuadros por
segundo, verse mejor que Techlog/IP/Geolog sin romper las convenciones de lectura (colores por curva, log para
resistividad, rellenos de cruce, derrumbe) y aceptar que otros módulos dibujen encima sin tocar su núcleo.

## D1. Un canvas para el cuerpo de todas las pistas + un canvas de cursor encima; encabezados en HTML

```
┌ barra del visor (rango visible, escala 1:N, zoom, ver todo) ─────────────────────┐
├ encabezados HTML (CurveLegend + lectura del cursor), grilla con anchos en px ─────┤
├ canvas base: fondo, grilla, zonas, rellenos, curvas, superposiciones   ┐ mismo    │
│ canvas de cursor: línea, puntos sobre las curvas, etiqueta de prof.    ┘ tamaño   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- El paneo y el zoom cambian **todas** las pistas a la vez, así que redibujar por pista no ahorra nada; lo que sí
  cambia solo es el cursor, que va en su propio canvas (mover el mouse no redibuja curvas).
- Los anchos de pista se calculan una vez (`layoutTracks`, puro) y se usan igual para la grilla HTML de
  encabezados y para el canvas: no hay que alinear N elementos.
- Lo que cruza pistas (topes de zona, cursor, futuras líneas de tendencia) se dibuja una sola vez.

Descartado:
- **Un canvas por pista.** N contextos y N buffers por `devicePixelRatio`, elementos que cruzan pistas
  duplicados y sincronización de N redibujos por cuadro. La ventaja (redibujo parcial) no aplica al paneo.
- **Más capas (grilla cacheada en un bitmap aparte).** La grilla depende del viewport; cachearla no ahorra nada
  medible (< 0,2 ms).
- **WebGL.** Rendimiento sobrado, pero texto, trazos rayados y rellenos con transparencia hay que reimplementarlos;
  el canvas 2D alcanza (ver mediciones en `src/viewer/README.md`).
- **OffscreenCanvas en un worker.** Saca el dibujo del hilo principal, pero complica eventos, tema y lectura del
  cursor. Se reconsidera solo si un cuadro pasa de ~8 ms en hardware modesto.

## D2. Reducción de muestras por fila de píxel (M4) sobre fracciones precalculadas

- Cada curva se transforma **una vez** a fracción del ancho de pista (`0` = borde izquierdo, `1` = derecho; log,
  inversión y unidad ya aplicadas) y se guarda en caché por identidad del array y firma de la escala
  (`fractionArray`). En cada cuadro no se calcula ningún logaritmo.
- Si hay más de 1,5 muestras por fila de píxel (eje de profundidad), `decimateRows` recorre las muestras visibles y
  guarda por fila **primera, mínima, máxima, última y media** (algoritmo M4): la línea pasa por primera → mín → máx →
  última de cada fila, así que el dibujo reducido es idéntico píxel a píxel al completo y no se pierde ningún pico
  (importante para el control de calidad). Los rellenos usan la media de la fila.
- **Huecos NaN:** una fila cuyas muestras son todas NaN es hueco y corta la línea; una fila sin muestras (muestreo
  irregular) no corta. Un hueco menor a un píxel no se ve a esa escala (se ve al acercar).
- Con pocas muestras por fila se dibuja la polilínea de las muestras.

- Los límites de fila (qué índices caen en cada fila) se calculan una vez por cuadro con búsqueda binaria y los
  comparten todas las curvas; cada array tiene además un resumen por bloques de 32 muestras (mín, máx, suma,
  cantidad, primera, última) en caché, así una fila de cientos de muestras se recorre por bloques.

Costo por cuadro: O(filas · (log n + muestras por fila / 32)) por curva, sin asignar memoria (buffers reusados).
Medido: 3,6 ms de media por cuadro con el pozo del TP y 5,4 ms con 50 000 muestras (detalle en `src/viewer/README.md`).

Descartado:
- **Saltear muestras (stride).** Pierde picos: un AT10 de 110 ohm·m desaparecería a ciertos zoom.
- **LTTB.** No es exacto al píxel y es más caro por cuadro.
- **Pirámide min/max completa (varios niveles).** O(filas · log n), pero un solo nivel de bloques ya deja la
  reducción por debajo de 0,1 ms por curva con 50 000 muestras; el resto del cuadro es rasterizado. Queda como
  mejora si aparecen pozos de millones de muestras.

**Rellenos:** un polígono por tramo continuo del mismo lado (ida por una curva, vuelta por la otra; en un cruce se
cierra en el punto interpolado y se abre otro), todos los de un color en un `Path2D` con un solo `fill()`. La
primera versión (un cuadrilátero por muestra) costaba 4–5 ms por cuadro solo en rellenos.

## D3. Dónde vive la configuración de pistas

| Qué | Dónde | Por qué |
|---|---|---|
| Plantillas de fábrica por espacio de trabajo | código: `src/viewer/templates.ts` | son parte de la app; se mejoran con cada versión |
| Pistas del usuario por espacio de trabajo (fase 7: pistas armables) | **proyecto**: `Project.display.layouts[espacio]` | es trabajo del usuario sobre ese estudio; tiene que viajar con el archivo |
| Overrides por rol (p. ej. GR 0–200 en todo el proyecto) | proyecto: `Project.display.roles[rol]` | idem |
| Overrides por curva (p. ej. AT10 en azul) | proyecto: `Project.display.curves[pozo][curva]` | los ids de curva son por pozo |
| Viewport, cursor, zona bajo el puntero | estado de interfaz (`useViewer`) | efímero |

- El formato del proyecto pasa a **v3** (migración v2 → v3: `display` vacío). Recetas puras en
  `src/core/state/project.ts`: `setTrackLayout`, `setRoleDisplay`, `setCurveDisplay`. Cuando exista quitar un pozo
  (hoy no hay receta), tiene que borrar también `display.curves[pozo]`. Todo es JSON puro, en `src/core/display.ts`
  (el núcleo no importa del visor).
- `display` vive **fuera de `Interpretation`**: cambiar un color no recalcula el motor ni aparece en los snapshots
  ni en sus diferencias.
- Precedencia de estilo: override de curva → override de rol → opciones de la plantilla → `curveStyle()` (paleta
  del sistema de diseño + `RoleDef.display` del catálogo).

Descartado:
- **`localStorage`.** Se pierde al abrir el proyecto en otra computadora o entregarlo. Sí puede servir en la fase 7
  para una *biblioteca personal* de plantillas reutilizable entre proyectos (copiada al proyecto al usarla).
- **Estado de UI.** Se pierde al cerrar.
- **Dentro de `Interpretation`.** Dispararía cálculos y ensuciaría snapshots y comparaciones.

## D4. Cómo se encuentran las curvas (medidas y calculadas) por rol

`resolveTracks(plantilla, fuentes, overrides)` (puro) arma las pistas a dibujar. Selectores de una pista:

- `{ role }` → las curvas medidas con ese rol **y** la salida activa del módulo que produce ese puerto (si el
  usuario eligió un módulo para `VSH`, se ve la `VSH` calculada; la del archivo también, con su mnemónico).
- `{ curveId }` → una curva puntual del pozo (para plantillas propias).
- `{ unassigned: dimensión }` → curvas medidas **sin rol** de esa magnitud (AT10 y AT30 del TP en la pista de
  resistividad, con la escala de la pista).
- `collect: 'computed' | 'flags'` → la pista se queda con toda curva calculada (o bandera) que no haya ubicado
  ninguna otra pista. Así **un módulo nuevo se ve en el visor sin tocar nada**: VSH, PHIE, SW y PERM ya tienen
  lugar en la plantilla; cualquier rol nuevo cae en «Interpretación» y las banderas (`family: 'flag'`) en su franja.
- Las curvas medidas se convierten a la unidad canónica de su rol (caché por identidad), así los rangos de
  `RoleDef.display` valen para cualquier archivo (NPHI en %, densidad en kg/m³…).
- Pistas con `hideWhenEmpty` (permeabilidad, banderas) no ocupan lugar hasta que exista algo que mostrar; el resto
  muestra un estado vacío que dice qué falta.

## D5. Coordenadas

- `Viewport = { top (m), pxPerM, height (px CSS) }`; `y = (prof − top)·pxPerM`. Profundidad siempre en metros.
- Límites: alejar hasta ver el pozo entero en el alto disponible; acercar hasta 32 px por muestra. `top` se acota
  a `[profMín, profMáx − alto/pxPerM]`. La escala de impresión se informa como `1:N` a 96 ppp.
- En x, cada curva tiene una fracción `f` (D2); `x = xPista + f·anchoPista`. Grilla lineal de 10 divisiones; grilla
  log por décadas (líneas en m·10ᵏ, mayores en 10ᵏ).
- Ticks de profundidad "lindos": paso 1-2-5 × 10ᵏ con al menos 56 px entre rótulos y subdivisiones si quedan a más
  de 7 px.

## D6. Valores fuera de escala: recorte + curva de respaldo opcional

- Las curvas se recortan a su pista (`clip`); los rellenos se acotan al borde. Nada se dibuja sobre la pista vecina.
- `wrap: true` (en la plantilla o como override) dibuja la **curva de respaldo** como en la industria: lo que excede
  el máximo vuelve a entrar por la izquierda corrido un ancho de escala (GR 0–150 → respaldo 150–300), más fina y
  translúcida. Está activa por defecto solo en GR (el TP llega a 180 gAPI). En log no se usa: 0,2–2000 cubre las
  resistividades reales; lo que sale se recorta.

## D7. Superposiciones: contrato abierto para otros módulos

`ViewerOverlay` (`src/viewer/overlay.ts`): `{ id, label, layer: 'under' | 'over', draw(frame), hit?(frame, p),
subscribe?(invalidar) }`. `draw` recibe el contexto 2D, el tema, el viewport (`yOf`, `depthOf`), las pistas con
`xOf(rol, valor)` y los datos comunes (profundidad, zonas, zona seleccionada, QC). `hit` permite tooltips y clics
(`activate()`); `subscribe` permite que una superposición que lee su propio store (selección del crossplot) pida
redibujo.

- Incorporadas y usadas por la app: **zonas** (bandas, topes con nombre, franja de zonas clicable) y **calidad**
  (tramos con derrumbe o caliper inválido rayados en las pistas con curvas de patín).
- Módulos: `src/modules/<id>/overlay.ts` que exporte `overlays: ViewerOverlay[]`, descubierto solo
  (`src/app/viewerOverlays.ts`, como los paneles a medida). El worker nunca lo importa.

Descartado:
- **Que cada módulo agregue pistas o capas tocando `render.ts`.** Viola "un módulo = una carpeta".
- **Superposiciones como componentes React (SVG/DOM sobre el canvas).** Simples de escribir, pero miles de puntos
  (plugs, selección del crossplot) en DOM no escalan y no comparten el viewport sin re-render.

## D8. Cursor, lectura y accesibilidad

- El cursor vive en el canvas de cursor; los valores se escriben directo en los encabezados (sin re-render de
  React) con `formatNumber` (4 cifras significativas) y la unidad canónica. La profundidad del cursor se publica en
  `useViewer` (`cursorDepth`) para el perfil radial y el crossplot conectado.
- Teclado (visor enfocado): ↑/↓ mueven el cursor una muestra (Mayús ×10) y desplazan si sale de la vista;
  Re Pág/Av Pág desplazan una pantalla; Inicio/Fin van al tope/base; +/− acercan/alejan sobre el cursor; 0 = ver
  todo. Una región `aria-live` anuncia (con demora) profundidad y valores.
- Mouse: rueda = desplazar; Ctrl+rueda o pinza = zoom centrado en el puntero; arrastre = paneo; clic en la franja
  de zonas (o en el nombre de un tope) = seleccionar la zona (`useUi.editingZoneId`), otro clic la deselecciona.

## Consecuencias

- 4b agrega pistas nuevas como `kind` de pista con su dibujante (volumétrica), el minimapa como otro consumidor
  del viewport publicado, el editor de escalas escribiendo en `Project.display` y la edición de topes como una
  superposición con `hit` + arrastre.
- `src/app/shell/trackTemplates.ts` desaparece: las plantillas viven en `src/viewer/templates.ts`.
