# 0056 — Datos reales de corona del TP embebidos

Fecha: 2026-11-01. Rama de trabajo del agente, sin integrar.

## Decisión

Los datos de laboratorio de corona del TP quedan dentro del HTML de la app y se cargan con un clic, sin el Excel de la cátedra. Conviven con los ejemplos sintéticos (0010, 0023, 0053), que no cambian.

- **Qué se embebe.** `src/modules/core/tpData.ts`, generado por `scripts/qa/tp-lab-data.py` desde `TP_interpretacion_de_Pozo.xlsx` (el Excel no está en el repo). No se edita a mano. Contiene:
  - `TP_CORE_PLUGS`: 151 plugs de las dos coronas (hoja PB): 90 en la corona 1 y 61 en la corona 2, con φ (v/v), k (mD) y densidad de grano (g/cm³). 12 de ellos llevan además el factor de formación F (hoja FF Summary) y el código del laboratorio como id («1-6R2», «2-29E»…). El resto se numera «C1-01»…
  - `TP_RI_COMPOSITE`: los 586 pares Sw–RI compuestos de la hoja IRSummary (todos los plugs juntos, sin identificar).
  - `TP_RI_PLUGS`: el punto final de desaturación de cada uno de los 12 plugs.
- **Conjuntos.** `tpCoreSet` (`src/modules/core/tp.ts`, kind `core`) y `tpRiSet` (`src/modules/core-calibration/tpRi.ts`, kind `core-ri`), funciones puras. Son datos reales: no llevan `synthetic`; el origen va en `source` (la hoja del Excel), que también los identifica para no cargarlos dos veces (un segundo clic avisa y no duplica). La interfaz los rotula «Datos del TP».
- **Profundidad.** Se usa la columna «Sample Depth, m» del Excel, que ya está puesta en profundidad contra el perfil (la profundidad original del laboratorio ×0,3048 menos 4,2 a 4,9 m). El desplazamiento inicial de cada corona es 0 y no se inventa ninguno; el usuario igual puede probar «Usar sugerido» (con PHIE el sugerido da +0,20 m en la corona 1, r 0,37, y −0,05 m en la corona 2, r 0,50). Para que el panel Calibración no diga «Sin poner en profundidad», la carga guarda en las decisiones del conjunto el ajuste `depthOnLog` del módulo Corona (`DEPTH_ON_LOG_SETTING`): con él, desplazamiento 0 cuenta como puesta hecha. La profundidad original en pies queda en la descripción de cada plug.
- **Calidad.** Las reglas automáticas de siempre se aplican a los plugs reales: no proponen descartar ninguno (φ 0,12–0,25, k 0,04–330 mD, ρg 2,65–2,76 g/cm³, todo dentro de rango).
- **Índice de resistividad: compuesto incluido, plugs excluidos.** El conjunto RI tiene dos tipos de «plug»: «Compuesto (hoja IRSummary)» con los 586 pares y los 12 plugs con su punto final. Los puntos finales ya están dentro del compuesto, así que al cargar se guardan como descartados (decisión `exclude`, la misma casilla por plug de la sección de n): por defecto el ajuste usa solo el compuesto y da n = 2,2109 por el origen, el «valor compuesto» de la cátedra. El compuesto no tiene profundidad (0 m, `md` sin dato, como manda `src/io/coreRi.ts`); los 12 llevan la de su plug.
- **Archie desde corona.** Con todo el pozo como alcance, a y m salen de los 12 plugs con F: m = 1,90 con a = 1 (1,897 en el cálculo de la cátedra; la φ es la de la hoja PB, con 3 a 5 decimales, no la de la hoja FF) y a = 0,59 · m = 2,22 con a libre. El alcance por defecto del panel sigue siendo la zona con más plugs (la B, corona 1), donde entran 8 de los 12 plugs con F.

## Interfaz

- Panel Corona: «Cargar corona del TP» en el estado vacío y en el diálogo de carga (junto a «Usar plugs de ejemplo»). Muestra el tramo de la corona 1 en el visor (7806–7848 m) con los plugs encima, como el ejemplo.
- Panel Calibración: «Cargar RI del TP» en la sección de n y en su diálogo; en el estado vacío del panel, «Cargar datos del TP» carga plugs y ensayo en una sola receta.
- Cada carga es una receta (un Ctrl+Z) y avisa con un toast que son datos reales del laboratorio.

## Verificación

- `tests/tp-datos-corona.test.ts`: 151 plugs (90 y 61), los 12 códigos con F, rangos, descripción, calidad sin propuestas; carga con marca de profundidad y deshacer; RI 586 + 12 con los 12 descartados por defecto; n compuesto = 2,210858 (1e-4), m(a = 1) ≈ 1,897 (0,02), a libre ≈ 0,594 y m libre ≈ 2,22 (0,05) contra `tests/fixtures/tp-corona-electrica-scal.json`; guardar/abrir v7 y snapshot.
- Prueba en el navegador sobre el HTML construido: capturas en `docs/capturas/datos-tp/`.
- Tamaño del HTML: 5.854.232 bytes antes de los datos del TP y 5.885.692 después (+31 kB), sigue siendo un único archivo.
