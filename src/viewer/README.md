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
| `overlay.ts` | **contrato de superposiciones** | no |
| `overlays/zones.ts`, `overlays/qc.ts` | superposiciones incorporadas: zonas y calidad del pozo | no |
| `render.ts` | dibujo en canvas 2D (base y cursor) | no |
| `WellViewer.tsx`, `viewer.css` | componente: encabezados, dos canvas, interacción, accesibilidad | sí |

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
- Rellenos (`FILL_PALETTE`): `edge` (curva ↔ borde), `between` (curva ↔ curva, por posición en pantalla),
  `baseline` (curva ↔ valor). `style: { wrap: true }` dibuja la curva de respaldo (GR).
- Overrides del usuario: `Project.display.roles[rol]` y `Project.display.curves[pozo][curva]` (escala, rango,
  inversión, color, trazo, respaldo, ocultar). Precedencia: curva → rol → plantilla → paleta.

## Superposiciones (para módulos)

Un módulo dibuja sobre el perfil con `src/modules/<id>/overlay.ts` (se descubre solo; el worker no lo importa):

```ts
import type { ViewerOverlay } from '../../viewer/overlay';
import { useMdt } from './store'; // estado propio del módulo, si hace falta

export const overlays: ViewerOverlay[] = [
  {
    id: 'mdt-points',
    label: 'Presiones MDT',
    layer: 'over',                                   // 'under' = antes de rellenos y curvas
    draw({ ctx, viewport, tracks, theme }) {
      const t = tracks.find((tr) => tr.kind === 'depth');
      if (!t) return;
      ctx.fillStyle = theme.color.accent;
      for (const p of useMdt.getState().points) {
        const y = viewport.yOf(p.depth);
        if (y < 0 || y > viewport.height) continue;
        ctx.beginPath();
        ctx.arc(t.x + t.width - 6, y, 3, 0, 2 * Math.PI);
        ctx.fill();
      }
    },
    hit(frame, p) {                                  // tooltip, clic (activate), doble clic (range)
      const q = useMdt.getState().points.find((pt) => Math.abs(frame.viewport.yOf(pt.depth) - p.y) < 4);
      return q ? { label: `MDT ${q.depth} m: ${q.pressure} psi`, cursor: 'pointer' } : null;
    },
    subscribe: (invalidate) => useMdt.subscribe(invalidate), // redibujar cuando cambia su estado
  },
];
```

- `tracks[i].xOf(rolOClave, valor)` da la x dentro de la pista con la escala de esa curva (plugs de φ sobre PHIE).
- `frame.data` trae profundidad, zonas, zona seleccionada y el reporte de calidad.
- Las incorporadas (`overlays/zones.ts`, `overlays/qc.ts`) usan el mismo contrato; `ViewerSlot` las compone.

## Interacción y accesibilidad

| Acción | Mouse / táctil | Teclado (visor enfocado) |
|---|---|---|
| Desplazar | rueda, arrastre | Re Pág / Av Pág; Inicio / Fin |
| Zoom | Ctrl+rueda o pinza (centrado en el puntero); doble clic = ×2 | + / − (sobre el cursor); 0 = ver todo |
| Cursor | mover el puntero | ↑ / ↓ una muestra (Mayús ×10); Esc lo oculta |
| Zona | clic en la franja de zonas o en un rótulo = editar sus parámetros; doble clic = verla entera | — |

La lectura del cursor se escribe en los encabezados (4 cifras significativas, unidad canónica) y, con teclado, se
anuncia en una región `aria-live`. La profundidad del cursor y el tramo visible se publican en `useViewer`
(`src/app/store/viewer.ts`).

## Rendimiento

- Un cuadro solo se dibuja dentro de `requestAnimationFrame` y solo si algo cambió; mover el cursor redibuja solo el
  canvas de cursor y escribe las lecturas en el DOM (sin re-render de React).
- Fracciones por curva y resumen por bloques en caché por identidad de array; límites de fila compartidos por todas
  las curvas; rellenos como un polígono por tramo; la superposición de calidad usa un recorte por pista.
- Medición (Chromium sin GPU, 1600 × 1000, `deviceScaleFactor` 1; script en el scratchpad de la fase): tiempo de
  `drawBase` por cuadro durante zoom con Ctrl+rueda, scroll y arrastre (110 cuadros):

  | Pozo | media | p95 | máx |
  |---|---|---|---|
  | TP, 5 810 muestras | 3,6 ms | 5,8 ms | 7,4 ms |
  | sintético, 50 000 muestras (`?muestras=50000`) | 5,4 ms | 8,5 ms | 13 ms |

  El primer cuadro de un pozo nuevo calcula las cachés (≈ 15–20 ms una vez).
- `data-frame-ms`, `data-frame-avg` y `data-frame-p95` en `.wv` exponen las últimas mediciones.
- `?muestras=N` en la URL arranca con un pozo sintético de N muestras (pruebas de rendimiento).
