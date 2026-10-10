# 0010 — Datos de corona: puesta en profundidad y modelo k–φ

- Estado: aceptada (fase 6b-3).
- Alcance: `PointSet` de `kind: 'core'`, `PointSetDecisions.depthShift` / `runShifts` y `shiftedDepth`
  (`src/core/pointSets.ts`), recetas de `src/core/state/pointSets.ts` (puesta en profundidad por corona, borrado en
  cascada de tendencias), `src/io/core.ts`, `src/petro/depthMatch.ts`, `src/petro/permeability.ts` (modelo log-lineal),
  módulo del motor `src/modules/perm-core/`, carpeta `src/modules/core/` (modelo, proveedor de series `core`,
  superposiciones del visor, panel del dock, asistente de carga, ejemplo sintético) y gráfico x–y base
  `src/plots/xy/`.
- Se apoya en 0009 (conjuntos de puntos, decisiones por punto, formato v5, paneles del dock aportados por módulos,
  `ViewerData.commit`) y en 0008 (tendencias, proveedores de series). No cambia el formato de proyecto: `runShifts` es
  un campo opcional nuevo dentro de `Interpretation.pointSets[conjunto]` que se sanea al abrir como los demás.

## Contexto

Módulo obligatorio del profesor: «Carga de datos de corona: plugs (φ, k, densidad de grano), puesta en profundidad
corona–perfil, puntos sobre el visualizador, modelo k–φ». La 6b-2 dejó la base: puntos con id estable en el pozo,
decisiones del usuario en la interpretación y proveedores de series para las tendencias. Las preguntas de esta fase:
cómo se corre una corona respecto del perfil sin que cada consumidor tenga que acordarse, cómo se sugiere el
desplazamiento, cómo llega al motor un modelo que se ajusta sobre puntos que el motor no ve, y qué gráfico usa el
crossplot k–φ sin atar la fase 7 (crossplot libre, histograma) a decisiones de esta.

## D1. Plugs como conjunto de puntos; desplazamiento por corona; profundidad corregida

- Los plugs son un `PointSet` con `kind: 'core'` y columnas `phi` (v/v), `k` (mD), `rhog` (g/cm³), y de texto `run`
  (corona o corrida) y `description`. Son datos medidos: viven en el pozo (0009, D1) y no se tocan nunca; excluir un
  plug malo es `status: 'exclude'` en la interpretación, como en MDT.
- **Desplazamiento por corona.** El archivo trae la profundidad del perforador; el perfil, la del cable, y cada
  corona se recupera con su propio desfasaje (la corona 1 puede estar 2,4 m arriba y la 2, 1,6 m). El núcleo define la
  convención `RUN_COLUMN = 'run'` (columna de texto con el n.º de corona o de corrida) y la decisión guarda
  `depthShift` (defecto del conjunto) y `runShifts` (por valor de la columna `run`, que REEMPLAZA al defecto para sus
  puntos). `shiftOf(decisiones, run)` resuelve el efectivo. Convención de signo: profundidad corregida = archivo + s
  (s > 0 baja la corona).
- **`shiftedDepth(set, decisiones)`** es la ÚNICA forma de ubicar un punto contra los perfiles: la usan el proveedor de
  series (filtro por zona o tramo), la superposición del visor, la sugerencia de desplazamiento y, desde esta fase,
  también MDT (que ya tenía `depthShift` en el modelo pero ningún consumidor lo aplicaba). Sin desplazamientos
  devuelve `set.depth` (misma identidad: no invalida los cachés por identidad); con ellos devuelve un arreglo nuevo,
  inmutable y en caché por conjunto y decisiones. Con desplazamientos distintos por corona el resultado puede NO quedar
  ordenado (dos coronas que se pisan): `depthOrder` da el orden estable para las series `xIsDepth`.
- Recetas: `setPointSetDepthShift(p, w, set, s, run?)`; 0 quita el defecto, `undefined` quita el de una corona (vuelve
  al del conjunto) y 0 con un defecto no nulo es un valor explícito. Una corona a mano se mueve con una sola receta
  (un solo Ctrl+Z).
- **Borrado en cascada de tendencias desde el núcleo.** `removePointSet` borra ahora también las tendencias cuya serie
  es `<conjunto>` o `<conjunto>:…` de cualquier proveedor que no sea `curve` (`isPointSetSeriesKey`). Es la convención
  que ya seguían MDT (`<conjunto>:gas|oil|water`) y corona (`<conjunto>:kphi`); antes la cascada la hacía el panel
  MDT y cada módulo nuevo la habría repetido. Las tendencias de curvas (`m:…`, `r:…`) nunca se tocan.

## D2. Lectura de plugs

`src/io/core.ts`, mismo esquema de dos etapas que las presiones (0009, D7): `parseTable(…, { requireDepth: false })` →
`suggestCoreMapping` → `buildCoreSet`. Excel, CSV y LAS.

- Columnas reconocidas por nombre sin tildes (token a token) y, si no alcanza, por unidad: profundidad (DEPTH, PROF,
  MD…), porosidad (PHI, POR, CPOR…), permeabilidad (K, PERM, KAIR, KLINK…), densidad de grano (RHOG, GD, «densidad de
  grano»), corona (CORE, CORONA, RUN, CORRIDA), id del plug y descripción. Cada campo va a una columna: la de mayor
  confianza (Klinkenberg antes que aire; la vertical se ignora salvo que el usuario la elija).
- Unidades canónicas del conjunto: m, v/v, mD, g/cm³. Una porosidad sin unidad cuyo máximo pasa de 1,5 se toma como %
  (las planillas de laboratorio la informan así); con unidad v/v declarada y valores > 1, el aviso pregunta si la
  columna está en %.
- Filas sin profundidad: se descartan con aviso. Sin φ ni k, o sin profundidad: error en español. Ids de plug: los de
  la columna o `P01…`; repetidos entre coronas se antepone la corona (`C1-A`), repetidos dentro de una: numerados.
- Unidades en el encabezado: entre paréntesis (`Profundidad (ft)`) o pegadas al nombre como último token
  (`Depth ft`, `DEPTH_FT`, `Perm mD`, `K/mD`), con el helper `splitUnitSuffix` de `src/io/pressures.ts` que comparten
  plugs y MDT. Un token de unidad no se toma como nombre de columna (`Perm mD` es permeabilidad); `MD` sola sigue siendo
  profundidad medida. El asistente deja corregir el mapeo y la unidad a mano.

## D3. Sugerencia de desplazamiento por correlación de Pearson con barrido

`suggestDepthShift` (`src/petro/depthMatch.ts`, pura) barre s en [−maxShift, +maxShift] (por defecto ±5 m, paso 0,05 m;
el panel usa ±6 m) y para cada s correlaciona la propiedad de los plugs (φ de corona) con la curva del perfil
(PHIE, PHIT, RMN o NPHI, a elección) interpolada linealmente a z_plug + s. Sugiere el s de máxima correlación.

- **Correlación y no diferencia cuadrática**: la φ de laboratorio difiere de la del perfil por presión de
  confinamiento, arcillas y volumen investigado; r es insensible a un sesgo y a una escala entre las dos y alinea la
  FORMA de la curva. Es el criterio habitual de la puesta en profundidad con corona (Bateman, 1985; Asquith y
  Krygowski, 2004).
- **Un desplazamiento solo cuenta si compara al menos el 70 % de los plugs válidos** (y no menos de `minPoints` = 5):
  los plugs que caen afuera del perfil o en un tramo sin dato no pueden inflar r con pocos puntos.
- **Advertencias en vez de falsa seguridad**: máximo en el borde del barrido (o junto a un tramo sin r): el verdadero
  puede estar más allá; máximo ambiguo (otro máximo local a menos de 0,02 de r y a más de 1 m); correlación débil
  (r < 0,5); sin sugerencia con menos de 5 plugs o si el perfil es constante. Empates: el de menor |s|.
- Se calcula por corona y solo con los plugs incluidos (profundidad del ARCHIVO, sin corregir). Es una sugerencia con
  «Usar sugerido»; el usuario decide, y también puede arrastrar la corona en el visor o escribir el valor. Se muestra
  la curva r(s) en el gráfico x–y para ver si el pico es nítido.
- Una serie constante en el perfil daba un r de ruido (±1e-16) porque la media redondeada deja una varianza ~1e-33 en
  vez de cero exacto; `pearson` compara ahora la varianza con una tolerancia relativa y devuelve NaN. Sin esto, un
  perfil sin variación sugería un desplazamiento arbitrario con la advertencia de correlación débil.

## D4. Modelo k–φ = tendencia exponencial sobre el proveedor `core`; «Aplicar al pozo» hacia `perm-core`

- **Proveedor `core`** (`src/modules/core/series.ts`): serie `<conjunto>:kphi`, x = φ (v/v, lineal), y = k (mD, log),
  `xIsDepth: false`, de los plugs INCLUIDOS con φ finito y k > 0; `depth` = profundidad corregida (para filtrar por
  zona o tramo: «usar zona como tramo» ajusta el modelo de una zona); clave de punto = id del plug.
- **El modelo es una tendencia normal** (`model: 'exp'`: k = A·e^(B·φ), una recta en ln k) con ecuación y R² de la capa
  de 6b-1; excluir plugs del ajuste (clic, rectángulo) es `selection.excluded`. Misma recta que log10 k = a + b·φ
  (Nelson, 1994; Tiab y Donaldson, 2015, cap. 3), con **a = log10 A, b = B / ln 10** (`expTrendToLogLinear`; A = 0,02007
  y B = 50,22 dan a ≈ −1,6975 y b ≈ 21,81). Solo el modelo exponencial se convierte: el potencial no es una recta en
  log k contra φ.
- **El motor no ve los plugs** (0009, D1: el worker no tiene puntos ni tendencias). Por eso el puente es un módulo del
  motor, `perm-core` (PERM a partir de PHIE: `log10 k = a + b·φ`, parámetros propios `kphiA`/`kphiB`, recorte
  `kMin`/`kMax`, todos con ajuste por zona), y el panel «Corona» escribe a y b con **«Aplicar al pozo»**
  (`applyKPhiModel`: globales, o de la zona si la tendencia usa una como tramo; con «y usarlo para PERM», también elige
  `perm-core` como fuente de PERM; una sola receta). Los coeficientes se guardan redondeados a 4 y 3 decimales, que es
  lo que muestra el panel.
- **Registrado después de Timur y Coates**: no cambia la fuente por defecto de PERM (sigue siendo `perm-timur`); elegirlo
  es explícito. Las claves son `kphiA`/`kphiB` y no `a`/`b` porque `a` ya es el factor de tortuosidad compartido de
  Archie.
- **Indicador de sincronización** (`kphiSync`): «sin aplicar» (nunca se escribió; valores por defecto), «sincronizado»
  o «desactualizado» (el ajuste cambió, o dejó de existir, y los parámetros del módulo no). No se aplica solo: aplicar
  recalcula toda la cadena aguas abajo y el usuario tiene que saber cuándo lo hace.
- **Recorte**: la exponencial extrapola mal fuera del rango de φ de los plugs; `kMin`/`kMax` por defecto 0,001 y
  20 000 mD, con aviso por zona si `kMin ≥ kMax`.

## D5. Plugs sobre el visor

Dos superposiciones como MDT (`core`, orden 15, atiende el puntero y dibuja la barra de cada corona en la pista de
profundidad; `core-points`, orden 31, dibuja los puntos encima de las tendencias). Prioridad del puntero: herramienta y
manijas de tendencias > puntos MDT > plugs > líneas de tendencia.

- Cada plug se dibuja en su profundidad corregida sobre la pista MÁS ESPECÍFICA que tiene la curva comparable: φ sobre
  la escala de PHIE (o PHIT, RMN), k sobre PERM (log), densidad de grano (rombo) sobre RHOB. «Más específica» = la de
  menos curvas, para no repetir los plugs en la pista recolectora «Interpretación».
- **Arrastrar un plug mueve su corona entera** (o el conjunto, si no hay columna de corona) con vista previa en vivo y
  un SOLO `commit` al soltar; Escape cancela sin commit. La receta suma el delta al valor ACTUAL del proyecto (no al del
  cuadro que la creó), así dos movimientos seguidos se acumulan. Con el plug activo, ↑/↓ corren la corona (Mayús ×10) y
  Tab recorre los plugs; el clic incluye o descarta (decisión explícita, que se borra al coincidir con la propuesta).
- Estado de cada plug: incluido (relleno translúcido con borde del color de su corona), descartado (vacío con ×),
  fuera de escala (triángulo en el borde). Colores por corona distintos de PHIE (azul), PERM (naranja) y RHOB (rojo).
- Reglas de calidad que PROPONEN descartar (decide el usuario): sin φ ni k, φ fuera de [0; 0,45], k ≤ 0, densidad de
  grano fuera de [2,5; 3,0] g/cm³ y descripción de plug fisurado o dañado (español e inglés).

## D6. Gráfico x–y base en `src/plots/xy/` (para la fase 7)

`axes.ts` (puro: ejes lineales o log, normales o invertidos, mapeo dato ↔ px, ticks «lindos» 1-2-5 o por décadas, rango
automático, área de dibujo, búsqueda de puntos), `draw.ts` (canvas: marco, grilla, rótulos, puntos, líneas y la capa de
tendencias de 6b-1 con `transpose: false`) y `XYPlot.tsx` (componente: capas de puntos, líneas, guías y tendencias;
tooltip, clic, selección por rectángulo y teclado). No sabe nada de plugs ni de curvas: lo usan el crossplot k–φ y la
curva r(s) de esta fase, y la fase 7 lo hereda para el crossplot libre (color por tercera curva = `color(i)`, cutoffs =
`guides`) y el histograma. Mapeo geométrico puro y testeado: valores ≤ 0 en eje log dan NaN (no se dibujan), los puntos
fuera de rango salen del área sin acotarse (el dibujo recorta).

## D7. Panel «Corona» en el dock

Panel del dock aportado por el módulo (`src/modules/core/dock.tsx`, 0009 D6): barra (conjunto, rótulo «Ejemplo
sintético», cargar otra tabla, borrar el conjunto con sus tendencias), tabla de plugs (incluir/descartar, motivo de la
propuesta), puesta en profundidad por corona (valor, «Usar sugerido», curva r(s), curva de correlación a elegir) y
crossplot k–φ con el modelo, su ecuación, R², zona como tramo, «Aplicar al pozo» y el indicador de sincronización. Estado
vacío con «Cargar plugs» y «Usar plugs de ejemplo». Todo por `commit`. Asistente de carga (`LoadCoreDialog.tsx`) con las
mismas piezas que el de presiones.

## D8. Datos de ejemplo sintéticos, rotulados

`src/modules/core/example.ts`: dos coronas en la zona D (7986–8008 m y 8100–8118 m, un plug por metro), φ = PHIE del
perfil a la profundidad verdadera + N(0; 0,008), k = 10^(−1,7 + 22·φ + ε) con ε ~ N(0; 0,22) en log10, ρg = 2,65 ± 0,02.
El archivo está corrido 2,4 m (corona 1) y 1,6 m (corona 2) respecto del perfil: la sugerencia debe recuperarlos. Dos
plugs malos (fisurado con k ×200, y desmoronado con φ = 0,47) que las reglas proponen descartar. `synthetic: true` y
nombre «Corona · ejemplo sintético»: la interfaz lo rotula siempre. Ruido con semilla fija; el ejemplo se arma con la
PHIE que calculó la app (si no hay PHIE en las coronas, no se arma).

## Alternativas descartadas

- **Un solo `depthShift` por conjunto.** Las coronas de un mismo pozo se desfasan distinto; habría que cargar un
  archivo por corona.
- **Que cada consumidor sume el desplazamiento.** Es lo que hacía falta antes de `shiftedDepth`: un consumidor
  olvidado deja los puntos en una profundidad y la serie en otra. Un único helper con caché por identidad.
- **Desplazar los datos del conjunto (reescribir `depth`).** Los datos medidos no se tocan; el desplazamiento es una
  decisión, entra en snapshots y se deshace.
- **Mínimos cuadrados (diferencia cuadrática) para la sugerencia.** Sensible al sesgo y la escala entre φ de laboratorio
  y φ de perfil.
- **Que el worker calcule el modelo k–φ.** No ve los plugs ni las tendencias; cada arrastre del ajuste pasaría por el
  worker. El ajuste es O(n) con n ≈ decenas en la interfaz; al motor solo viaja el par (a, b).
- **Aplicar el modelo al motor automáticamente en cada cambio del ajuste.** Cada clic sobre un plug recalcularía la
  cadena aguas abajo (Sw → sumario → volumétrico). Aplicar es una acción; el indicador avisa si quedó viejo.
- **Que `perm-core` sea la fuente por defecto de PERM cuando existen plugs.** Cambiaría resultados sin que el usuario
  lo pida; Timur sigue siéndolo.
- **Borrado en cascada en el panel de cada módulo.** Se repetía por módulo (MDT lo hacía); ahora la convención de
  clave y la receta del núcleo lo resuelven para cualquier conjunto.
- **Un gráfico propio del crossplot k–φ.** Habría que rehacerlo en la fase 7 para el crossplot libre y el histograma.

## Pendiente

- Corrección de Klinkenberg y de presión de confinamiento: el lector elige la columna (Klinkenberg antes que aire) pero
  no corrige.
- Modelo k–φ por litofacies o por capa (fase 7: crossplot libre con filtro por capa); hoy, por zona.
- La densidad de grano de los plugs se ve sobre RHOB pero no alimenta la densidad de matriz del módulo de porosidad por
  densidad.
- Pozos desviados: la puesta en profundidad es en MD.
- Ecuaciones (k–φ log-lineal, conversión exp ↔ log10, correlación de Pearson) para el futuro módulo Ecuaciones.
