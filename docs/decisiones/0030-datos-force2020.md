# 0030 — Datos FORCE 2020 para el clasificador de litologías (fase 10a)

- Estado: aceptada (fase 10a). La fase 10b entrena con estos datos.
- Alcance: `scripts/ml/preparar-force2020.mjs` (preparación), `scripts/ml/analizar-force2020.mjs` (informe de
  comparabilidad), `datos/force2020-preparado/` (datos, `manifest.json`, `LEEME.md`) y `tests/force2020-preparacion.test.ts`.
  Nada en `src/`: el bundle no cambia. No se toca el pozo del TP.

## Contexto

El módulo de litología de la ola 4 es un random forest entrenado con perfiles etiquetados. El dataset público de la
competencia FORCE 2020 (Bormann et al., Zenodo 4351156) trae 98 pozos del Mar del Norte con 1.170.511 muestras y 12
litologías. Pesa 280 MB: no puede ir al repo ni al HTML único; se deja un derivado de 4,4 MB y un guion para
regenerarlo. La licencia (NOLD 2.0, según el encargo) no pudo verificarse (ver `LEEME.md`).

## D1. Códigos de litología

El diccionario código → nombre sale del notebook `lithology_competition/code/DapoA/litho_pred-final.ipynb` (rama
`force2020`), cuyos recuentos (p. ej. 65030: 150.455) coinciden con los del `train.csv`: 30000 Sandstone, 65030
Sandstone/Shale, 65000 Shale, 80000 Marl, 74000 Dolomite, 70000 Limestone, 70032 Chalk, 88000 Halite, 86000
Anhydrite, 99000 Tuff, 90000 Coal, 93000 Basement. Coincide con lo recordado. El diccionario no está en el readme de
la competencia: viene del código de un participante (verificado, pero no es documentación oficial).

## D2. Agrupación en 9 clases

Recuentos con las seis curvas exigidas completas y sin derrumbe (antes de submuestrear):

| Clase | Códigos | Filas | Pozos con datos |
|---|---|---|---|
| SANDSTONE | 30000 | 102.777 | 96 |
| SANDSTONE_SHALE | 65030 | 83.491 | 93 |
| SHALE | 65000 | 378.577 | 96 |
| MARL | 80000 | 22.848 | 62 |
| CARBONATE | 70000 + 70032 + 74000 | 42.440 | 92 |
| EVAPORITE | 88000 + 86000 | 290 | 3 |
| COAL | 90000 | 2.504 | 48 |
| TUFF | 99000 | 6.759 | 29 |
| BASEMENT | 93000 | 90 | 1 |

- **Caliza, creta y dolomía en una clase.** Con curvas sin PEF utilizable no se separa dolomía de caliza (la propia
  inversión mineral del TP lo hace sin PE, decisión 0029) y por separado quedan muy pocos ejemplos: la creta es
  5.233 filas en 10 pozos y la dolomía 841 filas en 23 pozos (conteos sin la regla de rango físico, de una corrida
  exploratoria). La distinción caliza/dolomía se deja a la inversión mineral.
- **Halita y anhidrita juntas.** Quedan 290 filas completas en 3 pozos (la halita tiene solo 3
  filas completas). Es una clase que el modelo apenas aprenderá; se conserva porque el pedido es no perder clases
  raras.
- **Carbón, toba y basamento sueltos.** Carbón (48 pozos) y toba (29) tienen pozos suficientes para validación por
  pozos. Basamento son 90 filas de un solo pozo: no se puede validar por pozos; la 10b puede decidir descartarla
  (la columna `LITHO` y la tabla de clases permiten hacerlo sin regenerar).
- **Arenisca/Arcilita (65030) separada.** Es la tercera clase por volumen (83.491) y es la categoría «intermedia» que
  los participantes de FORCE más confunden; fusionarla con arcilita o arenisca esconde esa incertidumbre. Queda a
  decisión de la 10b fusionarla si el TP no la necesita.
- La agrupación vive en la tabla `CLASS_GROUPS` del guion, no en la lógica.

## D3. Curvas de entrada

| Canónico | FORCE | TP | Notas |
|---|---|---|---|
| GR | GR | GR | gAPI |
| RHOB | RHOB | ZDEN | g/cm³ |
| NPHI | NPHI | NPHI | v/v |
| DT | DTC | DT | µs/ft |
| RT | RDEP | AT90 | ohm·m |
| RM | RMED | AT30 | ver abajo |
| PEF | PEF | PE | **opcional**, ver abajo |

CALI solo para el control de calidad. SGR, RSHA, RXO, DRHO etc. quedan fuera.

**PEF opcional, y recomendado no usarlo en el TP.** PEF es la curva más escasa de FORCE: exigirla deja 407.117 filas de
67 pozos (con ≥ 500 filas) contra 639.776 filas de 96 pozos sin exigirla, y pierde el basamento (0 filas) y casi todo
el resto de raras (creta 1.733 contra 5.233, anhidrita 75 contra 287, toba 2.645 contra 6.759; conteos de la corrida
exploratoria). Además en el TP el PE es sospechoso (baritina, decisión 0029): su mediana es 6,41 b/e y cae en el
percentil 84 de FORCE (p1 del TP en el percentil 65, p99 en el 99), un desplazamiento hacia valores altos. Se
conserva la columna (vacía donde falta) para que la 10b pueda entrenar las dos variantes, pero la recomendada para
aplicar al TP es **sin PEF**.

**RM del TP = AT30, no AT60.** La profundidad de investigación de RMED no está documentada en el dataset, así que se
compara con datos: la relación log10(RDEP/RMED) de FORCE tiene mediana −0,018 (p5 −0,216, p95 0,136); en el TP
log10(AT90/AT30) da −0,024 (p5 −0,108, p95 0,028) y log10(AT90/AT60) da −0,006 (p5 −0,045, p95 0,040). La distancia
de Kolmogorov–Smirnov de log10(RMED) contra el TP es 0,268 con AT30 y 0,296 con AT60 (la de RDEP contra AT90, que es
la equivalencia segura, ya vale 0,257: la diferencia entre pozos de por sí explica casi todo). Hay una ventaja
pequeña para AT30, no una prueba. Es contraria al mapeo de `src/io/mnemonics.ts` (AT60 → RM); como la elección
afecta el resultado en el TP, **la 10b debe correr el modelo con AT30 y con AT60 y reportar la diferencia**. El
manifest registra AT30 y `TP_alternative_for_RM: AT60`.

## D4. Comparabilidad FORCE ↔ TP (con las seis curvas exigidas, FORCE tras filtros)

Unidades idénticas en las siete curvas (gAPI, g/cm³, v/v, b/e, µs/ft, ohm·m); no hace falta convertir nada.

| Curva | FORCE p1 / p50 / p99 | TP p1 / p50 / p99 | TP dentro de FORCE [p1, p99] |
|---|---|---|---|
| GR | 13,1 / 76,0 / 177,7 | 37,7 / 76,1 / 113,2 | 100 % |
| RHOB | 1,79 / 2,384 / 2,705 | 2,26 / 2,443 / 2,593 | 100 % |
| NPHI | 0,068 / 0,327 / 0,654 | −0,039 / 0,206 / 0,374 | 97,4 % |
| PEF | 2,05 / 4,16 / 22,3 | 4,80 / 6,41 / 21,4 | 99,1 % |
| DT | 60,2 / 97,7 / 165,4 | 70,4 / 84,6 / 112,9 | 99,7 % |
| RT (AT90) | 0,402 / 1,71 / 47,3 | 0,411 / 1,25 / 6,44 | 99,3 % |
| RM (AT30) | 0,459 / 1,84 / 45,0 | 0,466 / 1,33 / 6,68 | 99,1 % |

- **El TP cae dentro del dominio de entrenamiento.** El 97,2 % de las muestras del TP (5.575 de 5.738) está dentro de
  [p1, p99] de FORCE en las seis curvas a la vez; el 97,8 % cae en celdas RHOB–NPHI (0,05 g/cm³ × 0,02 v/v) con ≥ 50
  muestras de FORCE. Todo el rango (mín–máx) de GR, RHOB, DT, resistividades y PEF está cubierto.
- **Lo que no cubre:** el 2,62 % de las muestras con NPHI por debajo del p1 de FORCE (y 3 por encima del p99; rocas de muy baja porosidad
  neutrónica, incluso negativa) y los picos imposibles del TP (NPHI hasta 3,3; hay 2 muestras sobre 1,0 que el rango
  físico descarta). El TP tiene una densidad estrecha (2,26–2,59) comparada con FORCE: el modelo verá pocos
  extremos (carbón, evaporitas) en el TP, que es lo esperable.
- **Desplazamiento de dominio real:** DT, NPHI y resistividades del TP son más bajos que la mediana de FORCE (DT
  cae en el percentil 26,5 de FORCE, NPHI en el 16); el PEF es más alto (percentil 84). El TP es una roca más
  compacta que el pozo típico de FORCE, mayormente arcillosa/compacta y con un PE distorsionado.
- **Resistividades a log10:** sí, recomendada. FORCE abarca 0,08–2000 ohm·m (más de cuatro décadas) y el TP 0,3–29.
  Para un random forest una transformación monótona de una sola curva no cambia los cortes; sirve para variables
  derivadas (log RT − log RM, contraste de invasión) y para cualquier modelo que no sea de árboles. Por eso el
  dataset guarda los **valores crudos** y la 10b aplica `log10` al armar las variables. Las resistividades del TP son
  siempre positivas; en FORCE el rango físico descarta las ≤ 0,01.
- **Normalización del GR por pozo, probada:** (GR − p5) / (p95 − p5) con los percentiles de cada pozo, sobre 94
  pozos que tienen arenisca y arcilita. Efecto: la diferencia de la mediana de GR arenisca→arcilita pasa de 1,75 a
  2,46 desvíos entre pozos (la dispersión de la mediana entre pozos es 19,6 / 22,3 gAPI crudo y 0,197 / 0,195 en
  escala normalizada), y el AUC arenisca contra arcilita sube de 0,847 a 0,858. Mejora real pero chica en
  separabilidad; reduce la diferencia entre pozos en términos relativos. **No se aplica al dataset**: para el TP exige
  percentiles de un pozo único de 885 m con zonas A–E (p5 = 47,3 y p95 = 106 gAPI), que dependen de qué tan arcilloso
  sea ese intervalo, y puede borrar información real. Se guardan los p5/p50/p95 de cada pozo en
  `manifest.json > grPercentilesPerWell` para que la 10b entrene las dos variantes y compare por validación cruzada
  por pozos.

## D5. Filtros y embudo

1.170.511 filas → falta alguna de las seis curvas: 465.111 → fuera de rango físico: 147 → derrumbe (CALI > calibre
+ 2 in): 63.990 → CALI inválido (< calibre − 2 in): 1.487 → **639.776** filas completas (96 pozos con ≥ 500 filas; los
otros dos son 34/10-33 con 0 y 16/11-1 ST3 con 3). Con PEF: 407.117 filas, 67 pozos. Por pozo la mediana es 5.210
filas y el máximo 18.462; la tabla completa está en `manifest.json > perWell` (columna `complete`).

- **Criterio de derrumbe:** diferencia CALI − calibre de más de 2 in. Calibre = BS de la fila; si falta, el BS más
  cercano del pozo (16 pozos tienen BS parcial); si el pozo no tiene BS (29 pozos), el percentil 10 del CALI en
  bloques de 500 muestras (≈ 76 m). Es simple y documentado; el borde de cambio de diámetro de pozo dentro de un
  bloque puede marcar de más unas pocas muestras en esos 29 pozos.
- **Costo en clases raras:** en una corrida exploratoria sobre todas las filas, el derrumbe a 2 in quita el 23 % del
  carbón y el 26 % de la creta (10 % de arenisca y arcilita). Se aceptó: los datos con derrumbe tienen densidad y
  neutrón sesgados. Si la 10b necesita más carbón, `CALIPER.washoutMargin` sube a 3 in (carbón 17 %, creta 7 %).
- Se conservan las filas sin CALI (87.877 en el crudo, 7,5 %): no se puede juzgar el derrumbe.

## D6. Submuestreo

Tope de 60.000 filas por clase. Las clases con más filas completas se adelgazan con paso k = ceil(n / tope) por
posición en la secuencia de cada pozo, con un desplazamiento fijado por hash(semilla 2020, pozo, clase): arenisca y
arenisca/arcilita k = 2, arcilita k = 7; el resto se conserva entero. Preserva el orden y la profundidad dentro de
cada pozo (necesarios para validar por tramos), es determinista y se cumple en el test. Resultado: 222.153 filas,
**4,4 MB** de `force2020.csv.gz` (+ 23 KB de manifest), muy por debajo de los 12 MB. Queda el 35 % de las filas
completas (222.153 de 639.776); la autocorrelación entre muestras vecinas sigue siendo alta (paso
de 0,152 m en el crudo, 99,99 % de los pasos): **la validación cruzada debe ser por pozos, y por tramos si se mezclan pozos**, nunca aleatoria por fila.

Desbalance tras el submuestreo (porcentaje de las 222.153 filas): arcilita 24 %, arenisca 23 %, arenisca/arcilita
19 %, carbonato 19 %, marga 10 %, toba 3 %, carbón 1,1 %, evaporita 0,13 %, basamento 0,04 %. Confianza: 85 % de las
filas con 1, 12 % con 2, 3 % con 3, 25 sin dato (el 3 se puede usar como peso).

## Alternativas descartadas

- **Incorporar el dataset crudo (280 MB) al repo o al HTML único:** rompe el límite de tamaño y el uso sin servidor.
- **Un muestreo aleatorio por fila:** destruye la secuencia por profundidad, que la validación por tramos necesita.
- **Exigir PEF en todas las filas:** pierde el 36 % de las filas, 31 pozos sin ninguna fila con PEF y el basamento, y el PEF del TP no es
  confiable (baritina).
- **Normalizar el GR o pasar resistividades a log10 dentro del dataset:** quedan como decisión de la 10b, con los
  datos crudos y los percentiles por pozo a mano.
- **Una clase por cada uno de los 12 códigos:** creta, dolomía, anhidrita y basamento no tienen ejemplos
  suficientes para generalizar entre pozos con curvas sin PEF.

## Riesgos que hereda la 10b

1. Desplazamiento de dominio FORCE ↔ TP (DT, NPHI y resistividades más bajas, PE alto): sensibilidad a calibrar con el
   modelo sin PEF; las etiquetas del TP no existen, así que solo se puede validar contra la interpretación visual y
   la columna sedimentológica (decisión 0028).
2. Etiquetas ruidosas: 12 % de las filas tienen confianza 2 y 3 % confianza 3.
3. **El TP es más profundo que todo FORCE:** DEPTH_MD de FORCE va de 136 a 5.437 m (mediana 2.077 m, p99 4.614 m);
   el TP está a 7.633–8.518 m. La profundidad no se debe usar como entrada, y la compactación explica en parte
   el desplazamiento de DT, NPHI y RHOB.
4. El diccionario de litologías viene del código de un participante, no de la documentación oficial.
5. Los NPHI espurios del TP (hasta 3,3 v/v) hay que limpiarlos con el mismo `validRange` antes de predecir.
6. **El crudo está en `main`:** `datos/FORCE2020/` (465 archivos, 1,3 GB) figura entre los archivos del `HEAD` de esta
   rama y de `main` (merge del PR #25), aunque la regla del proyecto es que el crudo NO se incorpora a `main`.
   No se tocó; conviene decidirlo antes de que engorde el repo.
