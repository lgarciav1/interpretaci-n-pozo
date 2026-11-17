# 0073 — Estado «revisado» por paso del flujo

- Estado: aceptada (ficha F08 de `docs/masterplan-funciones-nuevas.md`).
- Alcance: `src/app/flow/flow.ts` (evaluación pura), `src/app/flow/useFlow.ts` (contexto desde los stores),
  `src/ui/components/Stepper.tsx` y `stepper.css`, `src/app/shell/FlowBar.tsx`, `src/app/shell/Inspector.tsx`.
  Tests: `tests/flow.test.ts`. Capturas: `docs/capturas/revisado/`.

## Contexto

Apenas se carga el pozo del TP la barra del flujo dice 11/11: todos los pasos de módulos se calculan con los valores de
fábrica y «Completo» no distingue un paso que la usuaria miró y ajustó de uno que el motor resolvió solo. En la defensa
del TP eso no deja ver qué se interpretó de verdad.

## Decisión

1. **Dos ejes independientes.** El estado de un paso (`done`, `partial`, `todo`, …) sigue igual: dice si hay resultado.
   Se suma `reviewed: boolean` y `reviewReason: string | null` en `StepState`: dice si hubo una decisión de la usuaria.
2. **Se deriva, no se guarda.** No hay un estado nuevo que mantener a mano. Un paso cuenta como revisado si:
   - tiene una marca manual (`FlowProgress.marks`: completo o saltado), o
   - **paso de módulos:** algún parámetro de sus módulos difiere del valor de fábrica, globalmente o como override de
     alguna zona que siga existiendo (en `ParamState` lo ausente es fábrica; un valor guardado igual al de fábrica no cuenta; números con
     tolerancia relativa 1e-9 para que volver un slider a su lugar lo «desrevise»; valores inválidos no cuentan), o
   - **paso de módulos:** se eligió una fuente (`Interpretation.sources`) para algún puerto que producen sus módulos o
     para alguno de sus `targets` (elegir método o curva medida es una decisión), o
   - **Cargar:** hay pozo (elegir el archivo es el acto de la usuaria).
   Zonas y Calidad solo por marca: las zonas vienen en el archivo del TP y Calidad ya se marca al terminar el diálogo
   de carga (el QC se revisa ahí).
3. **Parámetros compartidos cuentan para todos los pasos que los usan.** `a`, `m`, `n` y los cutoffs compartidos viven
   con una sola clave (`paramStorageKey` sin prefijo): cambiarlos es una decisión que afecta a cada paso que los lee, y
   así se muestra.
4. **El contador.** La barra pasa de «11/11» a «11 calculados · 4 revisados» si la barra mide más de 1560 px;
   por debajo (1366 incluido) se compacta a «11 · 4 rev.» para que los pasos conserven sus rótulos, con el texto largo
   en el `aria-label` (el contador es enfocable) y en el tooltip. La barrita de progreso muestra las dos
   capas: lo calculado en tono suave y lo revisado lleno. `flowProgress` conserva `resolved` y suma `reviewed`.
5. **En la barra de pasos.** Un paso completo sin revisar muestra el tilde verde sobre fondo vacío (anillo); revisado,
   el círculo verde lleno de siempre. El tooltip y el `aria-label` dicen «calculado con valores de fábrica» o
   «revisado» y por qué. El Inspector repite la razón bajo el estado. El `Stepper` es genérico: el estilo «sin revisar»
   solo se aplica si el ítem trae `reviewed: false` explícito, así otros usos no cambian.

## Alternativas descartadas

- **Guardar una marca «revisado» al tocar un parámetro.** Habría que mantenerla al deshacer, al cargar snapshots y al
  volver un parámetro a fábrica; la ficha pide no agregar estado a mano.
- **Contar como revisado abrir el paso en el Inspector.** Abrir no es decidir, y no persiste.
- **Revisado como un séptimo valor de `StepStatus`.** Mezcla «hay resultado» con «hubo decisión»: un paso puede estar
  en curso y revisado a la vez (p. ej. ajustaste la arcilla pero falta Vsh).
