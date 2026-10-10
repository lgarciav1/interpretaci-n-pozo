# src/viewer — visor multipista

Visor de perfiles en canvas. Decisiones y alternativas: [`docs/decisiones/0005-visor-multipista.md`](../../docs/decisiones/0005-visor-multipista.md).
Lo monta `src/app/shell/ViewerSlot.tsx`, que conecta los stores; el componente no conoce stores.

## Archivos

| Archivo | Qué hace | React |
|---|---|---|
| `templates.ts` | plantillas de fábrica por espacio de trabajo (`BUILTIN_LAYOUTS`) y `layoutFor` (las del proyecto ganan) | no |
| `resolve.ts` | plantilla + curvas medidas + calculadas + overrides → `ResolvedTrack[]` (curvas en unidad canónica, escala, estilo por tema, rellenos) | no |
| `viewport.ts` | viewport (tope, px/m, alto), límites, zoom centrado, scroll, ver todo, `showRange`, escala 1:N | no |
| `ticks.ts` | ticks de profundidad 1-2-5 × 10ᵏ, grilla lineal y logarítmica por décadas | no |
| `scale.ts` | valor ↔ fracción del ancho (lin/log, invertida); `fractionArray` y curva de respaldo en caché | no |
| `decimate.ts` | reducción M4 por fila de píxel (primera/mín/máx/última/media) con resumen por bloques en caché | no |
| `fills.ts` | geometría de rellenos entre curvas, borde o línea base (un polígono por tramo, cruces interpolados) | no |
| `readout.ts` | muestra más cercana y formato de la lectura del cursor | no |
| `layout.ts` | anchos de pista en px (los mismos para encabezados y canvas) | no |
| `overlay.ts` | **contrato de superposiciones** (dibujo, tooltip, clic, arrastre, teclado, pista propia) y `guard` | no |
| `interaction.ts` | gestos del puntero sin DOM: paneo, arrastre de superposiciones con desplazamiento automático, Escape, elemento activo para ↑/↓ | no |
| `overlays/zones.ts`, `overlays/qc.ts` | superposiciones incorporadas: zonas (con edición de topes, marcar zona y teclado) y calidad del pozo | no |
| `stack.ts` | pila de componentes que cierra a 1 (pista volumétrica, mineralogía): capas, leyenda, faltantes | no |
| `curveEdit.ts` | validación y alcance del editor de escalas y colores | no |
| `catalog.ts` | catálogo para armar pistas: herramientas (pistas de fábrica), curvas por grupo con estilo y rellenos propios, pistas especiales, búsqueda | no |
| `layoutEdit.tsx`, `layoutEdit.css` | modo «Armar pistas»: destinos del arrastre (`data-drop-*`, `dropTargetAt`), borde de ancho | sí |
| `animation.ts` | animación de carga (duración, curva de los tokens) | no |
| `minimap.ts`, `wellHeader.ts` | geometría del minimapa y campos del encabezado de pozo | no |
| `render.ts` | dibujo en canvas 2D (base y cursor; pilas; frente de la animación) | no |
| `figure.ts`, `figureInput.ts` | figura de publicación del perfil (marco, encabezados de pista, zonas, sumario, créditos) y armado del pedido | no |
| `WellViewer.tsx`, `viewer.css` | componente: encabezados (editables), dos canvas, interacción, elementos del teclado, accesibilidad | sí |
| `Minimap.tsx`, `WellHeader.tsx` | minimapa navegable y encabezado de pozo | sí |

Tests: `tests/viewer/` (geometría, resolución con el pozo del TP, configuración guardada, superposiciones). Un test
exige que los `.ts` de esta carpeta no importen React, zustand ni `src/app`.

## Pistas

Una pista es un `TrackSpec` (`src/core/display.ts`, JSON puro que se guarda en el proyecto):

```ts
{ id: 'porosity', title: 'Densidad · neutrón', kind: 'curves', width: 1.1,
  curves: [{ select: { role: 'NPHI' } }, { select: { role: 'RHOB' } }],          // la última queda encima
  fills: [{ kind: 'between', a: 'RHOB', b: 'NPHI', aLeft: 'gasCrossover', bLeft: 'shaleCrossover' }] }
```

- Selectores: `{ role }` (medidas con ese rol + salida activa del módulo de ese puerto), `{ curveId }`,
  `{ unassigned: 'resistivity' }` (medidas sin rol de esa magnitud).
- `collect: 'computed' | 'flags'`: la pista se queda con las calculadas (o banderas) que nadie ubicó. Un módulo nuevo
  se ve sin tocar el visor.
- Rellenos (`FILL_PALETTE`): `edge` (curva ↔ borde), `between` (curva ↔ curva; `compare: 'screen'` por posición
  en pantalla —densidad–neutrón— o `'value'` por valor —caliper vs. trépano—), `baseline` (curva ↔ valor). GR:
  arcilla del borde izquierdo a la curva, arena de la curva al borde derecho. `style: { wrap: true }` dibuja la
  curva de respaldo (GR). Si en la pista hay una medida y una calculada del mismo rol, el relleno usa la calculada.
- `{ kind: 'overlay', overlayId }`: pista propia de una superposición (la agregan solas las que declaran `track`).
- `{ kind: 'stack', stack }`: columna apilada que cierra a 1 (D9). Componentes por rol, de izquierda a derecha:

  ```ts
  { id: 'volumetric', title: 'Litología', kind: 'stack', stack: { components: [
      { id: 'shale', label: 'Arcilla', fill: 'shale', factors: [{ role: 'VSH' }] },
      { id: 'matrix', label: 'Matriz', fill: 'sand', rest: true, partialLabel: 'Resto sin partir', partialFill: 'undivided' },
      { id: 'pore', label: 'Porosidad', fill: 'pore', factors: [{ role: 'PHIE' }], children: [
          { id: 'water', label: 'Agua', fill: 'water', factors: [{ role: 'SW' }] },
          { id: 'hydrocarbon', label: 'Hidrocarburo', fill: 'hydrocarbon', factors: [{ role: 'SW', complement: true }] } ] } ] } }
  ```

  Factores recortados a [0, 1]; un nivel que suma más de 1 se normaliza; NaN = hueco; si falta una entrada el resto
  se rotula «sin partir». Sin nada calculable, el estado vacío dice qué falta.
- Salidas en comparación (`active: false`): en la pista de su rol, rayadas, al 60 % y con la etiqueta «alternativa».
- La grilla sigue la escala efectiva de la curva de arriba de la pista. Un override log con mínimo ≤ 0 conserva el
  log con un mínimo válido.
- Overrides del usuario: `Project.display.roles[rol]` y `Project.display.curves[pozo][curva]` (escala, rango,
  inversión, color, trazo, respaldo, ocultar). Precedencia: curva → rol → plantilla → paleta.

## Pistas armables (fase 7b)

Decisión: [`docs/decisiones/0016-pistas-armables.md`](../../docs/decisiones/0016-pistas-armables.md). Con la prop
`layoutEdit` el visor entra en modo edición; sin ella se comporta como siempre.

- Encabezados: manija con menú (mover, ancho, renombrar, quitar; Alt+←/→, Alt+Mayús+←/→, Supr), filas de curva
  arrastrables con su menú (subir, bajar, mover a otra pista o a una nueva, quitar; Alt+flechas) y borde derecho para
  el ancho (vista previa mientras se arrastra, se guarda al soltar; ←/→ con el foco). Se ven todas las filas (sin
  «+N») y las pistas `hideWhenEmpty` vacías (`resolveTracks(…, { keepEmpty: true })` → `latent`).
- Mientras la app avisa que hay un arrastre (`layoutEdit.drag`), `DropLayer` pinta columnas (agregar a la pista,
  rayadas si no la aceptan) y espacios entre pistas (pista nueva). Arrastrando una pista, la columna entera lleva al
  espacio más cercano. El visor no conoce el catálogo: la app lee el destino con `dropTargetAt` y decide.
- Anchos: con pistas que no entran (desplazamiento horizontal), `layoutTracks(…, { weightedMin: true })` da a una
  pista de ancho k > 1 un mínimo de k × el mínimo, así ensanchar se sigue viendo. Las figuras no usan la opción.
- Pistas ocultas (`hidden`, las de superposición quitadas) no se resuelven ni se vuelven a agregar.

## Superposiciones (para módulos)


Un módulo dibuja sobre el perfil con `src/modules/<id>/overlay.ts` (se descubre solo; el worker no lo importa).
Ejemplo ilustrativo de puntos **arrastrables** en una **pista propia**, con vista previa en vivo, Escape para cancelar
y ↑/↓ para ajustar el punto activo. La implementación real de presiones MDT (puntos que se incluyen o descartan con un
clic, escala automática, contactos que cruzan todas las pistas) está en `src/modules/mdt/overlay.ts`.

```ts
import type { ViewerOverlay } from '../../viewer/overlay';
import { useMdt } from './store'; // estado propio del módulo (puntos de presión)

let preview: { i: number; depth: number; psi: number } | null = null;

export const overlays: ViewerOverlay[] = [
  {
    id: 'mdt',
    label: 'Presiones MDT',
    layer: 'over',
    // Pista propia: el visor la agrega después de la de profundidad, con grilla y encabezado de esta escala.
    track: { title: 'Presión', scale: { kind: 'linear', min: 3000, max: 5000 }, unit: 'psi', after: 'depth' },
    draw({ ctx, viewport, tracks, theme }) {
      const t = tracks.find((tr) => tr.overlayId === 'mdt');
      if (!t) return;
      useMdt.getState().points.forEach((pt, i) => {
        const q = preview?.i === i ? preview : pt;
        ctx.beginPath();
        ctx.arc(t.x + t.xOf(null, q.psi)!, viewport.yOf(q.depth), 4, 0, 2 * Math.PI); // null = escala de la pista
        ctx.fillStyle = theme.color.accent;
        ctx.fill();
      });
    },
    hit(frame, p) {
      const t = frame.tracks.find((tr) => tr.overlayId === 'mdt');
      if (!t || p.track?.id !== t.id) return null;
      const points = useMdt.getState().points;
      const i = points.findIndex((pt) => Math.hypot(t.x + t.xOf(null, pt.psi)! - p.x, frame.viewport.yOf(pt.depth) - p.y) < 7);
      if (i < 0) return null;
      return {
        label: `MDT ${points[i]!.depth} m · ${points[i]!.psi} psi`,
        cursor: 'grab',
        drag: {
          move(q) {
            preview = { i, depth: q.depth, psi: t.valueOf(null, q.x - t.x)! }; // valueOf = inversa de xOf
            frame.invalidate(); // vista previa
          },
          end() {
            if (preview) useMdt.getState().movePoint(i, preview.depth, preview.psi); // el cambio real, en su store
            preview = null;
          },
          cancel() {
            preview = null; // Escape
            frame.invalidate();
          },
        },
        nudge: (dm) => useMdt.getState().movePoint(i, points[i]!.depth + dm, points[i]!.psi), // ↑/↓ con el punto activo
      };
    },
    subscribe: (invalidate) => useMdt.subscribe(invalidate), // redibujar cuando cambia su estado
  },
];
```

- `tracks[i].xOf(rolOClave, valor)` da la x dentro de la pista con la escala de esa curva (plugs de φ sobre PHIE;
  la calculada activa gana a la medida); `xOf(null, v)` usa la escala de la pista; `valueOf` es la inversa.
- **Elegir un tramo** (tendencias, histograma por tramo): en modo selección, `hit` devuelve un `drag` en cualquier
  punto; `move(p, start)` recibe los dos extremos (`start.depth`, `p.depth`).
- `frame.data` trae profundidad, zonas, zona seleccionada, QC y, en solo lectura, el pozo, la interpretación y las
  curvas calculadas activos. Para cambiar el proyecto, una receta pura por `frame.data.commit(etiqueta, receta)` (la
  misma vía que `useProject.getState().commit`, sin importar los stores; se deshace con Ctrl+Z).
- **Pista propia dinámica** (6b-2): `track.resolve({ well, settings })` devuelve escala, unidad y título según los
  datos del pozo y los ajustes que eligió el usuario (`project.display.overlays[id]`, p. ej. `{ unit: 'bar' }`);
  null oculta la pista (el pozo no tiene esos datos). `track.scale` queda de respaldo. `tracks[i].unit` dice la unidad
  de la escala: quien dibuja datos en otra unidad los convierte (las tendencias lo hacen solas).
- **Prioridad del puntero**: primero la capa 'over' y, dentro de cada capa, el `order` más alto. Con tendencias y
  MDT: herramienta «elegir tramo» y manijas (`trends`, 20) > puntos MDT (`mdt`, 10) > líneas de tendencia
  (`trends-lines`, 5). Así un punto sobre su gradiente responde al punto y la herramienta nunca queda tapada.
- Cualquier error de una superposición queda aislado (`guard`) y se registra en la consola. Los ids son únicos.
- **Teclado** (fase 4b): `targets(frame)` devuelve `{ depth, hit }` por elemento (con `hit.key`). El visor crea un
  botón accesible por cada uno: Tab los recorre, al enfocarlo queda activo (↑/↓ → `nudge`, Enter → `activate`) y
  `frame.active` dice cuál es para resaltarlo. Así se llega a un tope o a un plug sin mouse.
- Las incorporadas (`overlays/zones.ts`, `overlays/qc.ts`) usan el mismo contrato; `ViewerSlot` las compone, junto
  con las de **tendencias** (`src/plots/trend/overlay.ts`, docs/decisiones/0008): elegir un tramo con ajuste en vivo,
  dibujar a mano, manijas arrastrables con ↑/↓ y Tab, excluir muestras con un clic.
- El tooltip (`hit.label`) admite varias líneas con `\n`.
- Probado en `tests/viewer/interaction.test.ts` (plug arrastrable, tramo, borde, Escape, teclado) y
  `tests/viewer/review.test.ts` (pista propia).

## Exportar como figura (fase 6c-2)

Decisión: [`docs/decisiones/0012-exportacion-de-figuras.md`](../../docs/decisiones/0012-exportacion-de-figuras.md).
`drawViewerFigure(ctx, input)` dibuja el perfil con el MISMO `ViewerRenderer.drawBase` de la pantalla sobre cualquier
contexto 2D: un canvas fuera de pantalla (PNG, PDF) o el grabador SVG (`src/io/export/figures/svg.ts`, que exige
`withSvgPath2D` porque el dibujo hace `new Path2D()`). Siempre tema claro, sin cursor, sin `reveal` y sin manijas
(las superposiciones de tendencias aceptan `presentation: true`). `buildViewerFigure(pedido, contexto)` arma el
`ViewerFigureInput` (tramo, escala 1:N → px/m a 96 ppp, pistas sin las vacías, título, créditos); `layoutViewerFigure`
da el tamaño antes de dibujar. Para que una superposición propia se vea bien en una figura: dibujar solo con `frame` (sin
estado de puntero), y no depender de `frame.active`.

```ts
const input = buildViewerFigure(request, context);              // request: plantilla, tramo, escala, ancho, pistas
const layout = layoutViewerFigure(input);
const svg = new SvgContext2D({ width: layout.width, height: layout.height, measure });
withSvgPath2D(() => drawViewerFigure(svg.asCanvas(), input, layout));
const text = svg.toSvg('#ffffff');
```

Tests: `tests/figures/`.

## Interacción y accesibilidad

| Acción | Mouse / táctil | Teclado (visor enfocado) |
|---|---|---|
| Desplazar | rueda, arrastre (fuera de elementos arrastrables) | Re Pág / Av Pág; Inicio / Fin |
| Zoom | Ctrl+rueda o pinza (centrado en el puntero); doble clic = ×2 | + / − (sobre el cursor); 0 = ver todo |
| Cursor | mover el puntero | ↑ / ↓ una muestra, o las necesarias para avanzar 2 px (Mayús ×10); queda sobre una muestra; Esc lo oculta |
| Elemento de una superposición | arrastrar (con desplazamiento automático en los bordes); Esc cancela | después de un clic o arrastre queda activo: ↑ / ↓ lo mueven; Esc lo suelta |
| Zona | clic en la franja de zonas o en un rótulo = editar sus parámetros; doble clic = verla entera; clic en una zona del encabezado = verla | — |
| Tope, base o contacto | arrastrar la línea (±5 px): vista previa, ajuste a la muestra, frena en la vecina; Esc cancela | Tab llega a cada borde; ↑ / ↓ lo mueven (una muestra o 2 px; Mayús ×10); Esc vuelve al perfil |
| Marcar zona | botón «Marcar zona» y arrastrar un tramo; Esc sale | — |
| Escala y color | clic en el encabezado de una curva (popover); «+N» abre las curvas agrupadas | Tab hasta el encabezado, Enter |
| Minimapa | arrastrar la ventana; clic = centrar ahí | ↑ / ↓ un décimo de ventana; Re Pág / Av Pág; Inicio / Fin |

La lectura del cursor se escribe en los encabezados (4 cifras significativas, unidad canónica) y, con teclado, se
anuncia en una región `aria-live`. El cursor de teclado aparece al enfocar con Tab, no con un clic. La profundidad del cursor y el tramo visible se publican en `useViewer`
(`src/app/store/viewer.ts`).

## Rendimiento

- Un cuadro solo se dibuja dentro de `requestAnimationFrame` y solo si algo cambió; mover el cursor redibuja solo el
  canvas de cursor y escribe las lecturas en el DOM (sin re-render de React).
- Fracciones por curva (LRU de 4 escalas por array) y resumen por bloques en caché por identidad de array; buffers de
  fila que un cuadro no usó se descartan; límites de fila compartidos por todas
  las curvas; rellenos como un polígono por tramo; la superposición de calidad usa un recorte por pista.
- Medición (Chromium sin GPU, 1600 × 1000, `deviceScaleFactor` 1; script en el scratchpad de la fase): tiempo de
  `drawBase` por cuadro durante zoom con Ctrl+rueda, scroll y arrastre (110 cuadros):

  | Pozo | media | p95 | máx |
  |---|---|---|---|
  | TP, 5 810 muestras (4a) | 4,0 ms | 6,5 ms | 9,3 ms |
  | sintético, 50 000 muestras (`?muestras=50000`, 4a) | 5,8 ms | 8,9 ms | 11,9 ms |
  | TP, 5 810 muestras (4b: + litología, minimapa, encabezado) | 3,5 ms | 4,9 ms | 6,2 ms |
  | sintético, 50 000 muestras (4b, tres corridas) | 5,6–5,9 ms | 8,2–9,0 ms | 12–16 ms |

  La animación de carga y el minimapa no suman costo a un cuadro normal: la animación es un recorte que solo existe
  mientras dura y el minimapa se redibuja solo si cambian sus datos (la ventana se mueve por estilos).

  El primer cuadro de un pozo nuevo calcula las cachés (≈ 15–20 ms una vez).
- `data-frame-ms`, `data-frame-avg` y `data-frame-p95` en `.wv` exponen las últimas mediciones.
- `?muestras=N` en la URL arranca con un pozo sintético de N muestras (pruebas de rendimiento).
