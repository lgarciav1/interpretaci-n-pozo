# 0053 — Exponente de saturación n desde el índice de resistividad de corona

- Estado: aceptada.
- Alcance: motor puro `src/petro/coreCalibration.ts` (`resistivityIndex`, `fitSaturationExponent`,
  `saturationExponentPerPlug`), lector `src/io/coreRi.ts`, carpeta `src/modules/core-calibration/` (`saturation.ts`,
  `riExample.ts`, `LoadRiDialog.tsx`, `saturationSection.tsx`, recetas `applySaturation` y `applyArchie` en
  `model.ts`). Sin cambios en el núcleo, el contrato de módulo ni el formato del proyecto.
- Se apoya en 0009 (conjuntos de puntos), 0010 (plugs de corona) y 0023 (calibración con corona: F → a y m).

## Qué

La consigna del TP pide «a, m, n: calcularlo con los datos de FF e IR de corona». La app ya ajustaba a y m con el
factor de formación de los plugs (0023); ahora también lee el ensayo de índice de resistividad (pasos de desaturación
RI–Sw por plug), ajusta n y lo aplica, junto con a y m si se quiere, a los modelos de Sw.

- **Motor**: Archie, RI = Rt/Ro = Sw^(−n) ⇒ ln RI = −n·ln Sw. Dos ajustes: por el origen (RI = 1 en Sw = 1,
  n = −Σxy/Σx²), el recomendado, y libre con ordenada (count ≥ 3 y varianza de ln Sw > 0). Devuelven n, R², RMSE en
  log10 RI y cantidad de puntos, o null si no se puede. Puntos válidos: Sw ∈ (0, 1] y RI > 0 finito. El n puntual de un
  plug es −ln RI / ln Sw (Sw < 1). Validado contra los datos de la cátedra (`tests/fixtures/tp-corona-electrica-scal.json`,
  esperados calculados con numpy fuera del código): 1-6R2 con 2 y 4 terminales, los 586 pares compuestos y la media del
  n puntual de los 12 plugs.
- **Datos**: un conjunto de puntos de tipo propio `core-ri`, un punto por paso, columnas `sw` (v/v), `ri`, `plug`
  (texto) y opcionales `md` (profundidad del archivo) y `nLab`. Lector con mapeo por nombre (Sw, «Water Saturation»,
  «Saturación», «Sw fraction pv»; RI, IR, «Resistivity Index», «Índice de resistividad», «Rt/Ro»; o Rt y Ro), mapeo
  manual y Sw en fracción o % (se detecta por el máximo). Ejemplo sintético con los ids y profundidades de los plugs de
  ejemplo y n de diseño 2,1, rotulado siempre «ejemplo sintético».
- **Panel**: sección «Exponente de saturación n» en «Calibración»: gráfico log–log RI–Sw con la recta por el origen, la
  libre y la vigente; n, R², pasos y plugs; media por plug; tabla de n por plug con casilla para descartar el plug
  (decisión `exclude` sobre todos sus pasos, en la interpretación: entra en snapshots y se deshace); «Aplicar n» y el
  resumen «Archie desde corona» (a y m del F con a fija o libre, n del RI) con «Aplicar a, m y n» en UNA receta (un
  Ctrl+Z). Global o de una zona, con el «Aplicar en» del panel. Sin plugs pero con ensayo RI, el panel muestra solo n.

## Por qué así

- **Conjunto propio y no columnas del de plugs**: cada plug tiene muchos pasos de desaturación; mezclarlos con las filas
  de plugs rompería el modelo de «una fila por plug» (calidad, k–φ, puesta en profundidad, superposición en el visor).
  El tipo nuevo viaja sin cambios en guardar/abrir (v6 y v7), snapshots y deshacer, porque la serialización de los
  `PointSet` es genérica; hay tests que lo demuestran.
- **Profundidad opcional**: el núcleo exige una profundidad finita por punto. Sin dato se guarda 0 m y la profundidad
  conocida va en la columna `md`; ningún consumidor ubica los puntos `core-ri` en el visor y el ajuste de n no depende
  de la zona: «Aplicar en» solo elige dónde se escribe n. No se cambió el contrato de `PointSet`.
- **Por el origen como recomendado**: RI = 1 en Sw = 1 es la definición del ensayo; una ordenada ≠ 1 indica error en
  Ro, conducción por arcillas o mojabilidad mixta, no otro n. El libre se muestra para diagnosticar (aviso si su RI en
  Sw = 1 se aparta más de 15 %).

## Alternativas descartadas

- Agregar columnas RI y Sw al conjunto de plugs (una por paso): ancho variable y mezcla de granularidades.
- Un módulo del motor que reciba los pasos: obligaría a sincronizar conjuntos de puntos con el worker (0009 lo evita) y
  recalcular la cadena con cada plug descartado; igual que m (0023), el panel calcula y el usuario aplica.
- Subir la versión del formato: no hizo falta.

## Convención de signo

El laboratorio informa m y n con signo negativo (la pendiente de log F contra log φ y de log RI contra log Sw). La app
usa valores positivos. n se calcula desde RI y Sw, así que el signo del laboratorio no interviene; si la tabla trae una
columna n, se lee como `nLab` en valor absoluto (con aviso) y se muestra solo para comparar.
