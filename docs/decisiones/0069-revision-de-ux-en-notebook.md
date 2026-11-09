# 0069 — Revisión de UX: el perfil y los parámetros primero en una notebook

- Estado: aceptada (la usuaria pidió aplicar los siete puntos de la revisión).
- Alcance: `src/app/store/ui.ts`, `src/app/shell/` (`SidePanel.tsx`, `TopBar.tsx`, `FlowBar.tsx`, `Inspector.tsx`,
  `SmallScreenNotice.tsx`, `ViewerSlot.tsx`, `commands.ts`, `shell.css`), `src/app/components/ModulePanelView.tsx`,
  `src/viewer/` (`WellViewer.tsx`, `viewer.css`), `src/ui/components/CurveLegend.tsx`, `src/ui/tokens.ts`.
  Amplía la 0068 (panel lateral) y la 0067 (perfil clásico). Capturas antes/después: `docs/capturas/revision-ux/`.

## Contexto

A 1920 × 1080 la app se lee bien. A 1366 × 768 (notebook o proyector) el visor ocupaba 607 de 1366 px: entraban 5
pistas y las de interpretación quedaban fuera de vista, así que al mover un slider no se veía la curva que recalcula.
El primer slider del paso Cutoffs empezaba en y ≈ 690 de 768. La barra del panel lateral eran ~20 íconos sin rótulo.

## Decisión

1. **Columna del pozo plegada de fábrica en ventanas de menos de 1600 px** (`defaultLeftCollapsed`). Lo guardado antes
   conserva sus medidas pero retoma este valor una vez (`pozo.ui.layout.v` = 2). A 1366 px el visor pasa a 876 px y
   entran las pistas de interpretación, porosidad·Sw y litología.
2. **Parámetros primero en el paso**: la lista de métodos es una fila por método (los puertos a la derecha, la
   descripción en el `title`); la descripción del módulo pasa a un tooltip (ⓘ) y el estado va en una línea chica. En
   Cutoffs el primer slider sube de y ≈ 690 a y ≈ 480 y se ven tres.
3. **Barra del panel lateral con rótulos y grupos**: Paso · Resumen, Tablas, Avisos · los módulos obligatorios
   (Crossplot, Histograma, MDT, Corona, Tendencias) · **Más** (el resto, en un menú con nombre). `RAIL_PINNED` fija el
   orden; un panel de «Más» abierto se suma a la barra mientras se usa (`splitRail`). Ningún módulo se registra acá:
   uno nuevo aparece solo en «Más». La barra mide 54 px (antes 40).
4. **La barra del flujo no marca un paso activo cuando el panel muestra un gráfico o una tabla**, y baja de 52 a 44 px.
5. **Tamaño de interfaz y tema en «Preferencias»** (un botón con un popover) en vez de siete botones fijos. A 1366 px
   el nombre del pozo se lee entero.
6. **Encabezados de pista compactos, a pedido** (`layout.compactHeads`, botón en el encabezado de la pista de
   profundidad y comando en la paleta): título y mnemónicos con su color y trazo; la escala y la unidad van al tooltip
   de cada curva y al editor. A 1366 × 768 los encabezados bajan de ~200 a ~117 px. No es el valor de fábrica: el
   encabezado clásico con escalas (0067) sigue siéndolo.
7. **Aviso en pantallas de menos de 760 px**: el espacio de trabajo necesita ~1024 px; en un teléfono se explica y se
   ofrece volver al Inicio o seguir igual (dura la sesión). El Inicio no cambia.

## Alternativas descartadas

- **Sacar la columna del pozo o moverla a una pestaña del panel derecho**: competiría con el paso por el mismo lugar
  justo al asignar roles; plegada vuelve con un clic y en pantallas anchas sigue abierta.
- **Método en un desplegable**: se pierde el semáforo de todos los métodos de un vistazo.
- **Campo `pinned` en `DockPanelDef`**: el orden de los obligatorios es una decisión del armazón, no de cada módulo.
- **Encabezados compactos de fábrica**: sin escalas a la vista el perfil no se puede leer en una figura ni en una
  defensa; queda como opción.

## Verificación

`npm run typecheck`, `npm test` (incluye `tests/ui/panel-placement.test.ts`: barra, plegado de fábrica y pantalla
chica) y recorrido con Playwright a 1366 × 768, 1920 × 1080 (oscuro) y 390 × 844 sin errores de página.

## Scripts de QA (seguimiento)

- La franja de la columna del pozo plegada conserva «Preparar datos» y «Digitalizar registro» (mismos nombre accesible
  y `data-testid` que en la columna), así los accesos no dependen del ancho de la ventana.
- `side-tab-<id>` existe solo para las pestañas fijas y para el panel de «Más» que esté abierto; el resto se abre desde
  `side-more`. `scripts/qa/panel-lateral.cjs` lo hace con `openTab` (vuelve a cubrir Distribuciones).
- `thomas-stieber.cjs`, `normalization-panel.cjs` y `preparation-panel.cjs` recorren el dock de abajo y fallaban desde
  la 0068: ahora fijan `panels: 'bottom'` al empezar y vuelven a pasar.
- Sin tocar: `panel-lateral.cjs` sigue marcando la descripción de los plugs de Corona como texto cortado (es una elipsis
  con tooltip, anterior a esta revisión); `inicio.cjs` falla por rendimiento sin GPU; `log-digitizer.cjs` necesita un
  registro de entrada que no está en el repositorio; los scripts `.py` no se corrieron (falta Playwright para Python).
