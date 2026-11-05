# 0068 — Paneles al costado del perfil (panel lateral)

- Estado: aceptada (la usuaria eligió los gráficos a la derecha como disposición de fábrica).
- Alcance: `src/app/shell/` (`SidePanel.tsx`, `PanelHost.tsx`, `Dock.tsx`, `App.tsx`), `src/app/store/ui.ts`,
  `src/app/glance/` (Resumen), `src/modules/zone-summary/` (k y RT geométricas, percentiles), `src/petro/summary.ts`
  (`statsRes.rt`). Capturas: `docs/capturas/panel-lateral/`.

## Decisión

1. **Un único panel derecho con dos vistas**, el paso del flujo (inspector) y los paneles (Resumen, Resultados, Avisos,
   Tendencias y los de los módulos), elegidas desde una barra vertical de pestañas pegada al borde. Plegado queda solo
   la barra. El perfil usa toda la altura (a 1366 × 768 pasa de ~180 a 622 px).
2. **Disposición persistente** `layout.panels: 'side' | 'bottom'` (localStorage). «Paneles abajo» vuelve al dock de
   siempre; un botón en cada disposición la cambia. La lista de paneles es una sola (`DOCK_PANELS`): ningún módulo
   pierde lugar y agregar uno sigue siendo una carpeta con `dock.tsx`.
3. **Navegación en el store**: `set({ dockTab })` muestra la pestaña (despliega el contenedor y, al costado, pasa a la
   vista de paneles); abrir un paso vuelve a la vista del paso. `panelVisible(s, id)` reemplaza los chequeos
   `dockTab === id && !dockCollapsed` de los módulos.
4. **⤢ Agrandar** no vuelve a montar: el mismo contenedor pasa a `position: fixed` (Escape lo restaura). Preparar datos
   se abre agrandado al costado. Los gráficos de dos columnas (histograma, crossplot, MDT, tendencias) apilan gráfico y
   controles con consultas de contenedor.
5. **Percentiles fuera del camino caliente**: el motor sigue con `distributions: false`. El panel del sumario calcula el
   sumario completo aparte (`zone-summary/stats.ts`, ~9 ms en el TP), una vez por resultado, solo a la vista y cuando el
   resultado se quedó quieto 220 ms (`useSettled`); el Resumen hace lo mismo con sus gráficos.

## Alternativas descartadas

- **Dos columnas a la derecha** (inspector + gráficos): a 1366 px dejaba el perfil en ~450 px de ancho.
- **Pestañas horizontales en el panel**: 19 pestañas no entran en ~355 px; la barra vertical sí (se desplaza si falta alto).
- **Percentiles en el worker del motor**: exige cambiar el protocolo del motor; con el cálculo diferido alcanza.
