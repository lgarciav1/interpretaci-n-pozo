# 0057 — Presiones MDT y datos SCAL del TP embebidos

Fecha: 2026-11-01. Rama de trabajo del agente, sin integrar. Sigue el patrón de la 0056 (corona del TP).

## Decisión

Las hojas MDT y SCAL del Excel de la cátedra quedan dentro del HTML y se usan sin el Excel. Los datos los genera
`scripts/qa/tp-mdt-scal-data.py` en `src/modules/mdt/tpData.ts` y `src/modules/swi-pc/tpScal.ts` (no se editan a mano).

- **Presiones MDT.** `tpMdtSet` (`src/modules/mdt/tp.ts`), función pura: conjunto `pressure` con las 58 pruebas
  (zona B 25, C 2, D 31), presión en psi, la caída de presión de la prueba (`drawdown`) y la zona de la hoja como columna
  de texto (`zone`, que el panel muestra como columna «Zona»). Profundidad: la de la hoja en metros, tal cual (7729–8121
  m, dentro del pozo; MD, sin TVD porque la hoja no la trae y el pozo es vertical). Cada prueba cae en la zona del pozo
  que dice la hoja. Es dato real: sin `synthetic`; el origen va en `source`, que también evita cargarlo dos veces.
- **Sin interpretación automática.** No se traza ningún gradiente ni se descarta ninguna prueba (la hoja no trae
  movilidad ni calidad: las reglas no proponen descartes). El usuario usa «Gradientes» del panel MDT o «Tendencias».
- **Panel «SCAL»** (`src/modules/swi-pc/dock.tsx`, lógica pura en `scal.ts`), panel del dock aportado por el módulo
  `swi-pc` (se descubre solo). Funciona sin cargar nada:
  - tabla de las 8 muestras (k de gas, φ, √(k/φ), presión de desplazamiento). Las dos tablas de la hoja se unen por
    nombre de muestra; √(k/φ) es la de la tabla de gargantas (k en mD, φ en %), la misma variable de las curvas Swi. La
    columna «RAIZ» de la tabla de desplazamiento (10 veces más grande, con φ en fracción) solo controla la unión;
  - presión de desplazamiento contra √(k/φ) en log–log con el ajuste potencial del motor (`fitDisplacementPressure`):
    R² 0,431 y n 8 (d = 1,189; con x en la unidad de la planilla, c = 1,809 kg/cm²). El ajuste es débil y el panel lo dice;
  - las seis curvas Swi–√(k/φ) de la cátedra con la banda del rango respaldado por datos (0,366–1,996), las muestras
    marcadas sobre el eje y el nivel vigente resaltado;
  - resumen: % de las muestras del pozo con Swi cuyo √(k/φ) cae fuera del rango SCAL, promedio ponderado de la columna
    «Fuera del rango SCAL» de la tabla `SWI_ZONES` del último cálculo (se lee del resultado, sin tocar el núcleo). En el
    pozo del TP con la cadena de fábrica: 42,8 %;
  - «Usar nivel N»: escribe el nivel global de `swi-pc` (`swi-pc.level`) con `commit` (un Ctrl+Z). Si una zona tiene
    nivel propio no se toca y se avisa.
  - Rótulo «Datos del TP (hoja SCAL)». Las ecuaciones siguen solo en la documentación del módulo.

## Interfaz

- Panel MDT: «Cargar presiones del TP» en el estado vacío y en el diálogo de carga (junto al ejemplo sintético, que no
  cambia). Badge «Datos del TP». Muestra el tramo 7715–8135 m. Un segundo clic avisa y no duplica.

## Verificación

- `tests/tp-datos-mdt-scal.test.ts`: 58 pruebas y reparto B 25, C 2, D 31; profundidad y zona; carga y deshacer;
  gradientes con la regresión de la app contra `numpy.polyfit` (profundidad en pies = m / 0,3048, tolerancia 5e-4):
  todos 0,5362 psi/ft, zona B 0,4121 psi/ft (R² 0,9977), zona D 0,7313 psi/ft; unión SCAL; ajuste de desplazamiento
  contra los valores numpy de `tests/petro-swi-pc.test.ts` (d y R² iguales, c reescalado por 10^−d); curvas de nivel;
  resumen; «Usar nivel» y deshacer; registro del panel; guardar/abrir v7 y snapshot.
- Prueba en el navegador sobre el HTML construido (`file://`): capturas en `docs/capturas/mdt-scal-tp/`.
- Tamaño del HTML: 5.885.692 bytes antes y 5.903.410 después (+17,7 kB).
