# 0084 — Reparación integral de UI/UX y alineación al sistema de diseño (P0 + P1 + P2)

- Estado: aceptada.
- Fecha: 2026-11-18.
- Base: `main` (`582782d`).
- Amplía: [0004 — Sistema de diseño](0004-sistema-de-diseno.md), [0013 — Tamaño de interfaz](0013-tamano-de-interfaz.md),
  [0067 — Perfil clásico](0067-perfil-clasico.md) y [0069 — Revisión de UX en notebook](0069-revision-de-ux-en-notebook.md).

## Contexto

Tras integrar las funciones `F01` a `F26`, una auditoría visual y de código a `1366 × 768` (resolución de notebook y
proyector de defensa) y `1920 × 1080` detectó tres grupos de problemas:

1. **Colisiones visuales a `1366 × 768` (P0):**
   - En la pista combinada «Porosidad · Sw», los dos botones `.wv-head__band` (`φ ↔` y `Sw ↔`, introducidos en `F15`)
     comparten `.wv-head__top` sin `flex-wrap`. Con el modo clásico (`overflow: visible; white-space: normal` en
     `.wv-head__title`), el título se queda sin ancho, se parte letra por letra y queda tapado debajo de los botones.
     Además, `.wv-head__band` usa `border: 1px solid currentColor; border-radius: 4px; font: inherit`, desentonando con
     `.wv-head__hidden` y `.wv-head__collapse`.
   - En `CurveLegend` clásico (`.ui-curve-legend--classic`), cuando una pista angosta tiene extremos con signos o varios
     dígitos (p. ej. `-0,00684` a `0,144` en `F06`), el mnemónico centrado con `overflow: visible` invade los extremos
     `lo` y `hi`.
   - En `FlowBar`, al sumarse el contador `11 · 2 rev.` (`F08`) y el cronómetro (`F19`), a `1366 × 768` la etapa `short`
     de `Stepper` no entra por pocos píxeles y `fitStepper` salta a `done`, ocultando los rótulos de todos los pasos
     completados (quedan 11 círculos verdes sin texto).

2. **Desvíos del sistema de diseño `src/ui/` en funciones recientes (P1):**
   - `src/ui/` no tenía un componente `<TextArea>`, por lo que `NotesDialog.tsx` (`F05`) y `saturation-height/dock.tsx`
     (`F21`) estilizaron `<textarea>` nativos con CSS y medidas en píxeles fijos (`notes.css`, `height.css`).
   - `NotesDialog.tsx` usaba `<input type="number">` con `Number()` (no aceptaba coma decimal con `parseDecimal`),
     `<label>` sueltos y `<p role="alert">`.
   - `TrainerStart.tsx` y `TrainerCorrection.tsx` (`F14`) usaban `<input>` y `<input type="checkbox">` nativos en vez de
     `<Field>`, `<TextField>` y `<Checkbox>`, y `<table>` nativa en lugar de `<DataTable dense>`.
   - `saturation-height/dock.tsx` (`F21`) usaba `<table>` nativa y `@media (max-width: 820px)` en vez de `@container`,
     por lo que en el panel lateral (`368 px` de ancho) quedaba en dos columnas aplastadas.
   - `FormulaEditor.tsx` (`F06`) listaba las fórmulas como botones sueltos sin mostrar la expresión ni permitir borrar
     una fórmula creada.

3. **Ergonomía y descubribilidad en paneles (P2):**
   - En `CrossplotPanel.tsx` (`F11`), los cuatro campos numéricos (`Mínimo` y `Máximo` de X e Y) estaban siempre
     desplegados aun cuando ambos ejes estaban en rango `Automático`, ocupando ~160 px verticales en la columna `EJES`
     y empujando `Zonas`, `Plantilla`, `Cutoffs` y `Tendencias` fuera de vista a `1366 × 768`.
   - En `SidePanel.tsx`, el menú `Más` acumulaba 12+ paneles en una lista plana sin agrupación temática.

## Decisión

1. **P0 — Visor, leyendas y barra del flujo a `1366 × 768`:**
   - `.wv-head__top` permite `flex-wrap: wrap` y `.wv-head__band` adopta la familia visual de `.wv-head__hidden`
     (`height: calc(16px * var(--ui-scale))`, `font-size: calc(10px * var(--ui-scale))`, `border-radius: var(--radius-xs)`,
     `background: var(--color-surface-active)`, `color: var(--color-text-muted)`, y `var(--color-accent-soft)` /
     `var(--color-accent-text)` cuando `aria-pressed="true"`).
   - En `.wv-head--curves`, una consulta `@container (max-width: 11.5em)` sobre `.ui-curve-legend--classic` ubica
     `.ui-curve-legend__label` en una primera línea a todo el ancho (`grid-column: 1 / -1; grid-row: 1`) y deja `lo` y
     `hi` en la segunda línea (`grid-row: 2`), eliminando toda superposición con mnemónicos o unidades.
   - `Stepper` incorpora la etapa `'compact'` entre `'short'` y `'done'` en `STEPPER_FITS` (`['full', 'tight', 'short', 'compact', 'done', 'markers']`). En `compact` se conservan las abreviaturas visibles con menor padding, menor tamaño de marcador (`18px`) y conectores de `6px`, de modo que a `1366 × 768` los 11 pasos siguen mostrando su nombre abreviado junto al contador y al cronómetro.

2. **P1 — Componente `<TextArea>` y migración de `F05`, `F06`, `F14` y `F21` a `src/ui/`:**
   - Se agrega `TextArea` en `src/ui/components/Fields.tsx` (y se exporta en `src/ui/index.ts`), con soporte para
     `mono`, `rows`, `invalid` y tokens de `.ui-input`.
   - `NotesDialog` (`F05`) usa `<Field>`, `<TextArea>`, `<NumberField>` (con `parseDecimal` y coma decimal), `<Callout tone="error">` y tokens del sistema en `notes.css`.
   - `TrainerStart` y `TrainerCorrection` (`F14`) usan `<Field>`, `<TextField>`, `<Checkbox>` y `<DataTable dense>`.
   - `SaturationHeightPanel` (`F21`) usa `<DataTable dense>`, `<TextArea mono>`, tokens de espaciado/radio en
     `height.css`, `container-type: inline-size` con `@container (max-width: 48em)` para colapsar a una columna en el
     panel lateral, y mueve el bloque JSON del escenario a una sección plegable cuando no está en edición activa.
   - `FormulaEditor` (`F06`) muestra cada curva por fórmula en una fila con `MNEMÓNICO = expresión`, botón de edición y
     acción para eliminar la fórmula (validando con el grafo que ninguna otra fórmula dependa de ella).

3. **P2 — Ergonomía en Crossplot y menú «Más paneles»:**
   - En `CrossplotPanel` (`F11`), `AxisRangeEditor` compacta su huella vertical (`.plot-axis-editor` con `gap: var(--space-0-5)`, cabecera compacta y `.plot-axis-limits` en grilla de dos columnas con `gap: var(--space-1-5)` y etiquetas de `calc(10px * var(--ui-scale))`), manteniendo los `<NumberField>` de `Mínimo` y `Máximo` montados y accesibles en el DOM para preservar el flujo directo de `scripts/qa/rangos-crossplot.cjs` mientras libera espacio vertical en la columna `EJES` a `1366 × 768`.
   - En `SidePanel`, el menú `Más` agrupa los paneles adicionales bajo tres rótulos temáticos (`Interpretación y laboratorio`, `Datos y validación`, `Consulta y sistema`) sin alterar `RAIL_PINNED` ni los `data-testid`.

## Alternativas descartadas

- **Poner los botones `φ ↔` y `Sw ↔` dentro del popover de edición de curva:** obligaría a dos clics para encender o
  apagar las bandas de incertidumbre, perdiendo el contraste inmediato en el encabezado de pista que pide `F15`.
- **Ocultar el contador de revisados o el cronómetro a `1366 × 768`:** ambos son funciones clave para la defensa (`F08`
  y `F19`); la etapa `compact` en `Stepper` permite que convivan los tres elementos sin ocultar los nombres de los pasos.
