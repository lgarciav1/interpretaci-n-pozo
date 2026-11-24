# 0087 — Curvas MICP del TP: presión capilar medida, R35 medido y presión de los niveles de Swi

Fecha: 2026-11-24. Sigue a la 0024 (tipos de roca), la 0055 (Swi desde SCAL) y la 0057 (MDT y SCAL embebidos).

## Contexto

La 0055 dice que la hoja SCAL «no trae las curvas de presión capilar por muestra». Es incorrecto. Las celdas no las
traen, pero sí los cinco gráficos de la hoja. Sus series apuntan a un libro externo del laboratorio
(`Jorge-Pcapilar OCS-G-169.xls`, que no viene con el Excel), y Excel guarda una copia de cada punto dentro del gráfico
(`c:numCache` del XML). openpyxl no lee gráficos, por eso la extracción de la 0057 no las vio.

Los cinco gráficos son de las mismas 8 muestras (1-2, 1-2L, 1-32, 1-33CK, 1-33, 2-15, 2-17, 2-6L):

| Gráfico | Qué muestra |
|---|---|
| Presiones capilares · método de inyección de mercurio | Pc (kg/cm², log) contra saturación de la fase mojante (%). 37 escalones de 0,044 a 700 kg/cm² (la 2-15, 22: se corta en 21 kg/cm²) |
| Distribución de tamaños de gargantas porales | % del volumen poral invadido por escalón contra diámetro de garganta (µm, log) |
| Distribución de diámetro de garganta · Reservorio 1 y Reservorio 2 | Saturación de mercurio contra diámetro de garganta, muestras 1-x y 2-x |
| Correlación presión de desplazamiento vs √(k/φ) | La tabla de la 0057, con ajuste potencial |

Controles de los datos extraídos: Pc estrictamente creciente y Sw no creciente en las 8 muestras; la presión a la que
entra el mercurio en cada una coincide con su presión de desplazamiento de la tabla de la hoja; el incremental de
volumen invadido suma 97–99 %. Los diámetros del laboratorio implican σ|cosθ| ≈ 380 dyn/cm, un 3 % más que el par
estándar de la app (480 dyn/cm, 140°: 367,7); la app usa el estándar para que R35 sea comparable con Winland.

## Decisión

1. **Datos.** `scripts/qa/tp-micp-data.py` lee la caché del gráfico de presión capilar y genera
   `src/modules/rock-typing/tpMicp.ts` (no se edita a mano), con k de gas y φ de la tabla «diámetro de garganta
   poral» de la hoja. `tpMicpSet` (`src/modules/rock-typing/tp.ts`) arma un conjunto de puntos `capillary` (Pc en
   psi, Sw en v/v, k, φ): el formato que la pestaña «Presión capilar» ya dibujaba (0024 D4). Es dato real, sin
   `synthetic`; `source` evita cargarlo dos veces.
2. **Profundidad aproximada.** Cada muestra se ubica con el plug de corona del mismo número (1-32 → C1-32; 1-2 y
   1-2L → C1-02; 2-6L → C2-06): corona 1 en 7814–7828 m, corona 2 en 8016–8020 m. Las «L» y «CK» son subplugs del
   mismo nivel. k y φ de SCAL no son las del plug (p. ej. 1-32: 92,4 mD y 23,2 % contra 108 mD y 21,9 %), así que la
   cota es por nombre, no por medición: alcanza para el visor y para filtrar por zona, no para calibrar. La revisión
   encontró plugs hermanos más parecidos en k y φ para 1-2, 1-2L y 2-6L a menos de 0,9 m: la incertidumbre es de ±1 m
   (unas 6 muestras del perfil).
3. **Motor.** `wettingSaturationAtPc` y `pcAtWettingSaturation` (interpolación lineal en Sw y logarítmica en Pc, sin
   extrapolar) y `measuredR35` (Washburn a SHg = 35 %) en `src/petro/rockTyping.ts`; `swiLevelFits` y
   `matchSwiLevel` en `src/petro/swiPc.ts`. Tests: `tests/petro-micp.test.ts`, contra cuentas a mano y numpy.
4. **Presión de los niveles de Swi.** A cada escalón del ensayo se ajusta Swi = A·x^B/100 con las muestras ya
   invadidas y sin saturar (0 < Sw < 1). Cada uno de los seis (A, B) de la cátedra coincide con un escalón:

   | Nivel | A · B de la cátedra | Pc (kg/cm²) | Diferencia RMS de Swi |
   |---|---|---|---|
   | 1 | 28,93 · −0,333 | 28,2 | 0,0031 |
   | 2 | 21,155 · −0,322 | 70,0 | 0,0018 |
   | 3 | 15,102 · −0,403 | 122,6 | 0,0006 |
   | 4 | 8,8036 · −0,442 | 245,7 | 0,0010 |
   | 5 | 6,3007 · −0,463 | 351,9 | 0,0013 |
   | 6 | 2,7807 · −0,582 | 700,4 | 0,0013 |

   La presión queda en `SWI_CATEDRA_LEVELS[i].pcKgCm2` y en el rótulo («Nivel 3 · Pc ≈ 123 kg/cm²»). Los coeficientes
   siguen siendo los de la cátedra; la reconstrucción los respalda pero no es exacta (A dentro del 5 %, B dentro de
   0,015; ningún subconjunto de muestras los reproduce exactos). La asignación es robusta: el segundo mejor escalón
   queda entre 5 y 40 veces más lejos. A presiones bajas, por debajo de la presión de desplazamiento de las rocas
   pobres, el ajuste se sesga hacia las rocas buenas (las no invadidas quedan afuera); los niveles están todos por
   encima.
5. **R35 medido contra Winland.** El R35 de Winland desde k y φ coincide con el medido dentro del 10 % en 7 de las 8
   muestras. La 1-32 es la excepción: 3,79 µm medido contra 5,10 estimado (Winland la sobreestima un 35 %; las dos caen
   en la clase macro de todas formas). El acuerdo depende de σ|cosθ|: con el del laboratorio (380,2 dyn/cm, d·Pc
   constante en los gráficos de diámetro) los radios medidos suben un 3,4 % y quedan 5 de 8 dentro del 10 %.

   | Muestra | R35 medido (µm) | R35 Winland (µm) |
   |---|---|---|
   | 1-2 | 1,58 | 1,60 |
   | 1-2L | 2,03 | 2,09 |
   | 1-32 | 3,79 | 5,10 |
   | 1-33CK | 2,39 | 2,21 |
   | 1-33 | 3,78 | 3,75 |
   | 2-15 | 2,43 | 2,42 |
   | 2-17 | 1,96 | 1,81 |
   | 2-6L | 0,82 | 0,78 |

## Interfaz

- Pestaña «Presión capilar» de Tipos de roca: «Cargar curvas MICP del TP»; con las curvas cargadas, Pc–Sw, J de
  Leverett y gargantas de Washburn son del pozo y desaparece el rótulo de ejemplo de libro. Tabla de R35 medido
  contra Winland.
- Panel «SCAL»: los niveles muestran su presión y una sección compara los (A, B) de la cátedra con los reconstruidos.

## Usos de las curvas (motor `src/petro/micp.ts`)

Funciones puras con tests contra scipy (`scripts/qa/micp-usos-reference.py`), revisadas por un segundo analista:
ajustes de Thomeer (Pd, G, Bv∞) y de Brooks–Corey, k de Swanson y de Thomeer, conversión de laboratorio a reservorio
y altura sobre el FWL, altura de entrada, kr de Brooks–Corey–Burdine, flujo fraccional y cutoff de Sw, y comparación
con el CMR. Lo que salió de los datos del TP:

- **La «k de gas» de la tabla SCAL no es una medición.** Swanson (399·(Sb/Pc)^1,691) la reproduce dentro del 0,7 % en
  6 de 8 muestras (1-2L +4,7 %, 1-32 −13 %). Contra una k medida eso es imposible: Swanson dispersa un factor 2. Casi
  seguro el laboratorio la calculó con Swanson sobre estas mismas curvas. La k medida del TP es la de los plugs de la
  hoja PB, que difiere de la de SCAL entre ×0,33 y ×4,4 (son otros tapones, a ±1 m). Thomeer da 0,48–0,88 veces esa k.
- **El Swirr de Brooks–Corey no es identificable** con estas curvas (entrada abrupta y cola larga hasta 700 kg/cm²):
  el ajuste libre da Swirr = 0 en 7 de 8. Para kr y cutoff se toma el Swirr de la curva a la altura del tope de la
  columna (`fitBrooksCorey` con `swirr` fijo).
- **El cutoff de Sw a fw = 0,5 depende sobre todo de μw/μo**, no de Swirr ni de λ: 0,63–0,73 con μw/μo = 0,5, y
  0,61–0,79 con μw/μo entre 0,25 y 2. Se muestra como banda.
- **El FWL no se puede fijar con las presiones MDT del TP.** Zona B: 0,412 psi/ft (0,95 g/cm³: crudo pesado de unos
  17 °API o agua dulce, no salmuera). Zona D: 0,731 psi/ft (1,69 g/cm³, no es un fluido). Las presiones están
  sobrepresionadas (≈ 0,75 psi/ft absoluto) y los gradientes cambian según el tramo. El FWL y Δρ son supuestos del
  usuario y así se rotulan.
- **CMR.** A la profundidad de las muestras (±1 m), BVI/PHIE da 0,68–0,82. La Sw de las curvas a la presión estándar
  de calibración del corte de T2 (100 psi aire–salmuera ≈ 511 psi mercurio) es 0,21–0,36 (la 2-15 no llega). El CMR
  marca entre 2 y 3,5 veces más agua ligada: con el corte de 33 ms sobreestima el BVI en estas rocas. Esta comparación
  no necesita FWL.

## Qué NO cubre

- Lector genérico de Pc–Sw (CSV o Excel de otros pozos): sigue abierto (0024).
- El módulo «Saturación por altura» (0079) sigue con su escenario propio; el panel «Análisis MICP» hace la versión
  directa con las curvas medidas y un FWL supuesto.
