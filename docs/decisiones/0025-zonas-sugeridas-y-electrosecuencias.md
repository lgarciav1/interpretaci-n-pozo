# 0025 — Zonas sugeridas y electrosecuencias (fase 9b, funciones L y Geo-1)

- Estado: aceptada (fase 9b).
- Alcance: carpetas `src/modules/zone-suggestions/` (módulo `zone-suggestions`: tabla `ZONE_SUGGESTIONS`; `model.ts`
  puro con la lista, el filtro y la receta «aceptar límite»; `store.ts` con el estado de interfaz; `panel.tsx`;
  `overlay.ts` con las líneas sobre el visor) y `src/modules/electrosequences/` (módulo `electrosequences`: tablas
  `ELECTROSEQUENCES` y `ZONE_ELECTROSEQUENCES`; `model.ts`, `draw.ts`, `selection.ts`, `panel.tsx` y `overlay.ts` con
  la pista «Electrosec.» de Geología). Dos líneas en `src/modules/index.ts`.
- Se apoya en el motor puro ya revisado `src/petro/segmentation.ts` (sin cambios de API), en 0005 D7 (superposiciones
  con pista propia), D10 (convenciones de zonas) y 0006 (deshacer). Sin cambios en el núcleo, el visor, el contrato de
  módulo ni el formato del proyecto.

## Contexto

El plan pide proponer zonas a partir de los cambios del GR (L) y leer la forma del GR de cada tramo con su
interpretación depositacional (Geo-1). Las dos cosas son la misma segmentación: una vez partido el GR en tramos, los
límites son las zonas sugeridas y la forma de cada tramo es su electrosecuencia.

## D1. Por qué PELT con recta por tramo

- La segmentación es óptima (programación dinámica con poda, PELT; Killick et al. 2012) con una penalización tipo
  BIC por límite. La segmentación binaria depende del orden de los cortes y no encuentra juntos un escalón y un
  cambio de pendiente; PELT sí, y en el pozo del TP tarda ~20 ms (el motor busca en grilla y afina en bloques largos).
- El costo es el de una RECTA por tramo, no una media: una rampa (embudo o campana) es un solo tramo con tendencia, no
  una escalera de escalones. Eso es lo que permite clasificar la forma sobre los mismos tramos.
- Al usuario se le exponen solo los controles que entiende: penalización (granularidad), espesor mínimo, suavizado y
  salto mínimo de fusión. El resto queda en los valores del motor.

## D2. Por qué curvas adicionales

En el pozo del TP los topes de la cátedra casi no se ven en el GR (saltos de 0–24 gAPI): con solo GR casi ninguno
cae cerca de un límite propuesto. Sumando la densidad y el log10 de la resistividad profunda como curvas adicionales aparecen tres de
cuatro a ≤ 1,4 m (tests de `petro-segmentacion`). Por eso el módulo pide `RHOB` y `RT` como entradas OPCIONALES y dos
interruptores («Sumar la densidad», «Sumar la resistividad profunda (log)»), apagados por defecto: el GR solo es el
criterio clásico y el más rápido de leer; las curvas extra son la recomendación cuando los topes no aparecen. La
resistividad entra en log10 porque su variación es multiplicativa. La fuerza que se muestra es la relativa (salto de
medianas sobre el rango P10–P90 de cada curva), comparable entre curvas.

## D3. Cómo se acepta

- El motor solo propone (tabla); nunca escribe zonas. El panel acepta con una receta pura (`acceptBoundaries`) que
  pasa por `commit`: aceptar uno o «Aceptar visibles» es UNA entrada de deshacer.
- El límite cae entre dos muestras. Dentro de una zona la parte: arriba queda la original (id, nombre, color y
  parámetros) y abajo una nueva contigua con el nombre numerado («B» → «B 2»), el siguiente color de la paleta de
  zonas y los parámetros por zona de la original (misma roca hasta que se diga otra cosa, como al partir con «Marcar
  zona»). Fuera de toda zona (pozo sin zonas o hueco) el hueco se llena con dos zonas nuevas («Z1», «Z2»), así el primer
  «Aceptar» en un pozo sin zonas ya lo deja zonificado.
- Ninguna zona queda por debajo del espesor mínimo (0,5 m): un límite pegado a un tope no se acepta y se avisa.
  «Aceptar visibles» saltea las propuestas a ≤ 2 m de un tope existente (se marcan en la lista y van tenues en el visor).
- Antes de aceptar se puede editar la profundidad (campo numérico, arrastre de la línea o ↑/↓) o descartar. Descartes
  y ediciones son estado de interfaz (no se guardan en el proyecto) y se olvidan al cambiar de pozo.
- Las líneas propuestas son discontinuas y del color de acento, con la etiqueta «L3» (orden por fuerza) en la pista de
  profundidad; las zonas reales son continuas y del color de cada zona. Se dibujan solo mientras el panel está abierto.

## D4. Electrosecuencias: pista propia sobre la escala del GR

- La pista va al lado del GR en la plantilla de Geología (`after: 'spectral'`) con escala 0–150 gAPI. Cada tramo es una
  silueta anclada a la derecha cuyo borde izquierdo es el GR ajustado del tramo: el embudo es ancho arriba porque el GR
  baja hacia arriba, la campana al revés, el cilindro es un bloque al nivel del GR medio, el simétrico tiene un vértice
  en el medio y el serrado, dientes de la amplitud de su desvío. Así el ícono dice la forma y además el nivel, sin
  dibujar una escala ficticia. Colores: paleta categórica del sistema de diseño, uno por forma; opacidad por confianza
  (la baja con trazo discontinuo). El panel usa íconos normalizados con la misma lógica.
- La superposición no recibe tablas del motor (solo curvas), así que calcula los tramos con la MISMA función y los
  MISMOS parámetros guardados del módulo, en caché por curva y parámetros (~20 ms por cambio). Se eligió esto antes que
  codificar la forma en una curva de salida, que habría obligado a un rol nuevo sin significado físico y no lleva las
  descripciones. El GR es el que usa el motor (fuente explícita o la primera curva con rol GR).
- El panel clasifica además cada zona del usuario con `classifyInterval` y lista los tramos filtrables por forma.

## Abierto

- Las líneas propuestas no aparecen en las figuras exportadas (como otras superposiciones de solo pantalla).
- La pista asume la escala de GR 0–150 gAPI del rol; un GR fuera de ese rango se recorta en la silueta.
