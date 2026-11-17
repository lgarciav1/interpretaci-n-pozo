# 0076 — Notas ancladas a profundidad (F05)

Estado: implementada en rama de revisión; pendiente de integración.

## Contrato

- Campo opcional `Interpretation.notes`: lista de `{id, text, top, base?}`. Profundidades en metros MD;
  sin base es una nota puntual. Texto plano de hasta 500 caracteres, sin HTML ejecutable.
- Crear/editar/borrar y mover pasan por recetas puras y el historial existente. Las entradas del motor se
  mantienen por referencia: no hay recálculo ni cambio de fuente científica. Los snapshots incluyen las notas.
- Las operaciones nuevas rechazan texto vacío, números no finitos, bases anteriores al tope y posiciones fuera
  del pozo. Trasladar conserva el espesor y se detiene en los extremos. No se ajusta a una muestra: son anotaciones
  de profundidad, no mediciones.
- Los proyectos sin notas siguen abriendo. v6 sanea notas corruptas con aviso; v7 valida estrictamente el campo
  opcional, también dentro de snapshots, como el resto del archivo con revisiones. No hay migración de arrays.
- Menú contextual del perfil → «Notas de profundidad…» (clic derecho o Shift+F10). El editor permite punto/tramo,
  listado, nueva nota, edición y borrado. Las notas son objetivos de Tab; ↑/↓ traslada y Escape cancela un arrastre.
- Una superposición compartida dibuja texto y profundidades en pantalla y en figuras PNG/SVG. Separa rótulos próximos
  y los conecta con su anclaje. Pantalla y exportación usan instancias distintas; las vistas previas no se guardan.
- El informe contiene una tabla con el texto completo, saltos de línea, tope y base. Escapa caracteres HTML.

## Alternativas

No guardar notas en el estado de UI: se perderían al cerrar y no entrarían en snapshots.
No usar módulos de cálculo: una observación editorial no produce curvas ni alimenta el grafo.
No dibujar solamente una capa DOM: las figuras exportadas deben contener el mismo dibujo que el perfil.

## Validación y límites

Ver [evidencia F05](../validacion/2026-11-17-notas.md). La apertura `file://` está bloqueada por la política del
Chromium disponible; no se presenta como verificada. La revisión independiente y esa prueba siguen pendientes.
