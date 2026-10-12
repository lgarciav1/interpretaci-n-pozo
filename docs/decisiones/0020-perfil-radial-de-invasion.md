# 0020 — Perfil radial de invasión escalonada desde la inducción de arreglo (fase 8b, función V)

- Estado: aceptada (fase 8b): motor y módulo, con las correcciones de la revisión numérica, y la vista (sección 8).
- Alcance: motor puro `src/petro/invasion.ts`; módulo `src/modules/invasion-step/`; roles nuevos `RA10`, `RA20`, `RA30`, `DI`
  e `INV_MISFIT` (`src/core/roles.ts`, `src/ui/curves.ts`, rango físico en `src/io/qc.ts`); mnemónicos AT10/AT20/AT30 (y AHT, AF,
  M2R1-3) en `src/io/mnemonics.ts`; pista de resistividad (`src/viewer/templates.ts`, `src/viewer/catalog.ts`); pozo de
  demostración (`src/app/demo/syntheticWell.ts`); tests `tests/petro-invasion.test.ts` y `tests/modules-8b-invasion.test.ts`.
- Parte de: 0002 (tabla de mnemónicos), 0003 (control de calidad), 0005 y 0016 (pistas), 0007 (contrato y registro de módulos).

## 1. Modelo

Perfil escalonado en **conductividad**. Zona lavada (σxo) hasta el radio de invasión `ri`, formación virgen (σt) más allá. Cada curva
de la inducción lee una mezcla ponderada por el factor geométrico radial integrado `J_k(r)` (fracción de la señal que viene de
adentro de `r`):

```
σa_k = J_k(ri)·σxo + (1 − J_k(ri))·σt          Ra_k = 1/σa_k          di = 2·ri
```

- La inducción responde en conductividad (las corrientes inducidas en anillos de formación se suman), por eso la mezcla es lineal
  en σ y no en R.
- **Pozo:** se supone que las lecturas ya están corregidas por pozo (así las entrega el procesamiento de la AIT). La región
  `r < ri` incluye el pozo y toma σxo; el pozo no se modela.
- **`di = 2·ri`** es el diámetro desde el eje de la herramienta, incluido el pozo: la convención de las cartas «tornado». Un `di`
  igual al trépano (8,5 in) significa invasión nula. El trépano es la cota inferior de la búsqueda (parámetro del módulo).
- Descartado: **perfil con zona de transición** (anillo con gradiente entre Rxo y Rt, Rxo/Rann/Rt). Agrega dos incógnitas (ancho y
  resistividad del anillo) a un problema de 3 con 4-5 datos: sería no identificable. El escalonado es el modelo del plan y el de
  las cartas más usadas.

## 2. Factor geométrico radial J(r): una aproximación

```
J(r) = 1 / (1 + (r50/r)^p)           p = 1,5         J(0) = 0, J(∞) = 1, J(r50) = 0,5, monótona
```

**No es la respuesta de Schlumberger**: no tenemos las curvas radiales del fabricante. Es una logística en `ln r`.

- **Origen de la forma.** Se integró numéricamente el factor geométrico de una sonda de dos bobinas en medio homogéneo sin efecto
  pelicular (Doll 1949; Moran y Kunz 1962). El factor de Doll es **por unidad de volumen**, `g ∝ ρ²/(ρT³ρR³)`, y un anillo de radio
  `ρ` y sección `dρ·dz` tiene volumen `2πρ dρ dz`: el peso que se integra en `z` y se acumula en `ρ` es `ρ³/(ρT³ρR³)` (la integral
  doble da `2/L²` exacto). Resulta `r50 ≈ 1,035·L` y una cola `1 − J ∝ 1/ρ`. La logística con **p = 1,5** queda a menos de
  **0,041** (en J) en todo el rango radial; el óptimo es p ≈ 1,54 (0,036); p = 1 da 0,13 y p = 2, 0,087. Se dejó 1,5 por ser un
  valor redondo y estar a 0,005 (en error máximo) del óptimo. El test `tests/petro-invasion.test.ts` repite esa integración con código propio y exige menos
  de 0,045. (La versión anterior de este documento usaba el peso `ρ²`, que omite el factor de volumen `ρ`; daba `r50 ≈ 0,38·L` y una
  cola `1/ρ²`. El valor de `p` no cambió, pero el error máximo sí: 0,040 → 0,041.)
- **La logística sobrestima J** respecto del de dos bobinas en la cola y cerca del pozo. Cuantiles del J de dos bobinas en unidades
  de r50: J = 0,10 en 0,31; 0,25 en 0,54; 0,75 en 2,21; 0,90 en 5,82; 0,95 en 11,6. La logística da en esos puntos 0,15; 0,28; 0,77;
  0,93; 0,98.
- **Límite.** Las cinco curvas de la AIT se sintetizan por enfoque por software (Barber y Rosthal 1991, SPE 22725), así que sus
  respuestas radiales reales no son las de una sonda simple de dos bobinas (se espera que sean más angostas; sin las curvas del
  fabricante no se puede acotar). Eso sesga `di` y `Rxo`.
- **Sensibilidad a la forma de J** (mediana de `di` por zona A-E en el TP): p = 1, 16 / 82 / 60 / 19 / 25 in; p = 1,5, 32 / 70 /
  60 / 35 / 39; p = 2, 40 / 66 / 60 / 42 / 45. `Rt` cambia menos del 5 %. **`di` es un orden de magnitud**, no una medida.
- **Profundidades 10, 20, 30, 60, 90 in: radio, no diámetro.** Fuente de las cinco profundidades: Hunka et al. (1990), SPE 20559
  (el sistema de resistividad de arreglo que dio origen a la AIT); el enfoque por software está en Barber y Rosthal (1991). Se
  toman como **profundidad mediana de investigación radial desde el eje de la herramienta** (certeza estimada ≈ 75-80 %). Argumentos:
  el glosario de SLB (`glossary.slb.com/terms/d/depth_of_investigation` y `glossary.slb.com/en/terms/d/deep_induction`) da para la
  inducción profunda ID un punto medio de la respuesta a **62 in de radio** en altas resistividades (45 in a 1 ohm·m) y 30 in de
  radio para la media; y AT90 (90 in) es más profunda que la ID, lo que solo cierra si 90 in es un radio (como diámetro serían
  45 in, menos que la ID). Si fuera diámetro, `r50` sería la mitad y el `di` estimado saldría ≈ 2 veces mayor, con `Rt` y la forma
  del ajuste casi iguales. Los `r50` son **nominales**: a baja resistividad el efecto pelicular los acorta (sensibilidad de `di` ≲
  5 % según la revisión numérica).
- `p` es una constante exportada (`RADIAL_STEEPNESS`); `radialGeometricFactor(r, r50, steepness)` y las opciones del ajuste aceptan
  otro valor si se consigue una respuesta mejor.

## 3. Inversión por muestra

Para `ri` fijo el modelo es lineal en `(σxo, σt)`: mínimos cuadrados separables.

1. Residuo relativo (los errores de una inducción son proporcionales a la lectura), con piso en el peso:
   `r_k = (σa_k − σ_k)/máx(σ_k, 0,05·σmax)`, `misfit = √(Σ r_k²/n)`. El piso del 5 % de la mayor conductividad de la muestra evita que
   una lectura muy resistiva aislada (σ_k → 0) pese cientos de veces más que las otras. Con relación de resistividades hasta 20 la
   ponderación es exactamente proporcional.
2. Para cada `ri` se resuelve el sistema normal 2×2 con `σ ∈ [10⁻⁵, 100] S/m` (R de 100 000 a 0,01 ohm·m). Si la solución libre sale
   del rango se prueba cada cota y se elige la de menor residuo (exacto, porque es convexo en 2D).
3. `ri` se barre en una grilla **logarítmica** de 48 puntos (de trépano/2 a 150 in) y se refina por **sección áurea** (40 iteraciones)
   entre los vecinos del mínimo de la grilla. Se prefirió grilla + refinamiento a un método local porque el residuo en `ri` puede
   tener más de un mínimo cuando las lecturas son incoherentes. 5810 muestras con 4 curvas tardan ≈ 0,4 s (incluye el intervalo de `di`).
4. **Intervalo de `di` compatible** (`diLow`, `diHigh`): los `ri` con `misfit(ri) ≤ √(misfit² + δ²)`, **δ = 0,02** (un 2 % de
   desajuste relativo adicional; es del orden de la repetibilidad de una inducción y fija «qué tan plano es el valle»), recorridos
   desde el óptimo hasta el primer cruce por bisección sobre el barrido. δ es una convención del módulo (`DI_MISFIT_TOLERANCE`), no
   una medida de la incertidumbre estadística.
5. Salida: `Rxo = 1/σxo`, `Rt = 1/σt`, `di = 2·ri`, `misfit`, `diLow`, `diHigh`, `status`, `reason`, `separation`, `nCurves`,
   `atBound`, `rxoAtBound`.

### Estados por muestra

| `status` | Cuándo | Rxo | Rt | di | misfit |
|---|---|---|---|---|---|
| `insufficient` | < 3 lecturas válidas (NaN, ≤ 0, no finitas) | sin dato | sin dato | sin dato | sin dato |
| `no-invasion` | `Rmax/Rmin − 1 <` umbral (0,10 por defecto) | sin dato | lectura más profunda | sin dato | sin dato |
| `unresolved` | `ri` óptimo en un borde de la grilla (`reason`: `deep` = máximo, `shallow` = trépano) o σt en una cota de σ (`sigma`) | sin dato | lectura más profunda | sin dato | del ajuste |
| `poorly-resolved` | `diHigh/diLow > 2` o el intervalo toca un borde de la grilla | **API:** del ajuste · **curvas:** sin dato | del ajuste | **API:** del ajuste · **curvas:** sin dato | del ajuste |
| `ok` | resto | ajustada (sin dato si `rxoAtBound`) | ajustada | ajustado | del ajuste |

- **Por qué estos estados.** Con contrastes débiles (separación 10-30 %) el `misfit` es bajo pero `ri` casi no está determinado: el
  óptimo se pega al trépano o al máximo de la grilla, o el valle es tan ancho que `di` abarca un factor 5-10. Una revisión numérica
  mostró que 371 muestras (9,6 % de los ajustes) devolvían `Rxo = 10⁵ ohm·m` (σxo pegado a su cota) y que, en el borde de la grilla, la
  `Rt` del ajuste no es confiable. Se decidió **no emitir** lo que el ajuste no determina: en las curvas de salida, `Rxo` y `di`
  quedan sin dato salvo en `ok`. La API de una profundidad (`invertStepProfile`, `invasionProfileAtDepth`) sí devuelve `rxo`, `di`,
  `diLow` y `diHigh` en `poorly-resolved`, para que la vista muestre «di entre X y Y in».
- **`Rxo` en la cota de σ** (`rxoAtBound`): el ajuste pide una zona lavada «infinitamente» resistiva (o conductiva), lo que solo
  indica que las lecturas no la determinan. `Rxo` queda sin dato; `di` y `Rt` del ajuste se mantienen (si el estado lo permite).
- **Robustez de `Rt`.** Vale **solo para los ajustes interiores** (`ok` y `poorly-resolved`): la mediana por zona de `Rt/AT90` es
  0,95-0,97 y el 95 % de esas muestras cae entre 0,6 y 1,1 veces AT90 (la corrección baja `Rt` hasta un 35 % donde la invasión es
  profunda, porque AT90 lee algo de zona lavada). En `unresolved` no hay corrección: se devuelve la lectura más profunda.
- **Sin invasión visible:** con lecturas iguales cualquier `ri` ajusta, así que `di` es indeterminado y no se inventa un valor. El
  umbral es el parámetro `minSeparation` (por zona).
- **Resistiva** (Rxo > Rt): las lecturas bajan con la profundidad. **Conductiva** (Rxo < Rt): suben. Las dos se recuperan.
- **Grados de libertad y significado del misfit.** 3 incógnitas (`ri`, σxo, σt). Con 3 curvas el ajuste es casi exacto y el misfit no
  informa; con 4 hay 1 grado y con 5 hay 2. El misfit es el RMS **sobre n** (no sobre n − 3): con 4 curvas **subestima el ruido por
  curva en un factor 2** (√(4/1)); con 5, ≈ 1,6. El umbral 0,15 del módulo equivale entonces a ≈ 30 % de error por curva con 4 curvas:
  una incoherencia grosera (picos, curvas de otra herramienta), no ruido normal de una inducción (unos pocos %).
- **Pico aislado:** no se filtra. En las pruebas (AT10 de 110 ohm·m sobre ≈ 1) el misfit sale entre 0,2 y 0,6 (contra < 10⁻⁴ del
  caso limpio) con 4 y con 5 curvas, pero el `Rt` del ajuste de esa muestra se desvía 30-60 % con 4 curvas: **misfit alto = Rxo, di y Rt
  de esa muestra no son confiables**. Probar pisos de peso mayores (0,1 a 0,5) no mejora `Rt` y baja el misfit del pico (0,19 con 0,5),
  por eso se dejó 0,05.

## 4. Módulo `invasion-step`

- **Entradas por rol:** `RA10`, `RA20`, `RA30`, `RM` y `BS` (opcionales) y `RT` (requerida). El módulo supone que `RM` es AT60 y `RT`
  es AT90 (inducción de arreglo): **no puede comprobarlo**, solo documentarlo (`docs.notes`). Con otras herramientas (ILD/ILM de doble
  inducción, laterolog) las profundidades de 60 y 90 in no valen. `BS` (rol del diámetro de trépano) es la cota inferior de `di` por
  muestra; donde no hay curva o no tiene dato rige el parámetro `bitSize`.
- **Salidas:** `RXO`, `RT`, `DI` (pulgadas) e `INV_MISFIT`. El motor prefiere la **curva medida** con el mismo rol: `RT` y `RXO`
  del módulo quedan como fuente alternativa (no activa) mientras exista AT90 / un Rxo medido; `DI` e `INV_MISFIT` no tienen otra
  fuente y activan el módulo. Qué sale en cada estado: tabla de la sección 3.
- **Categoría nueva** `resistivity` / «Resistividad», espacio de petrofísica.
- **Parámetros** (por zona, con tooltip): `minSeparation` (0,10), `maxMisfit` (0,15: solo cuenta los ajustes pobres para el aviso) y
  `bitSize` (8,5 in, cota inferior de `di`).
- **Avisos por zona** (`ctx.warn`, con mayúscula inicial): menos de 3 curvas (global, con las curvas que se usan); más del 10 % de
  los ajustes con desajuste alto; más del 10 % con `di` mal resuelto; más del 10 % pidiendo más de 300 in (`deep`); más del 10 %
  pegados al trépano (`shallow`); más del 10 % con σt en el límite; más del 10 % con `Rxo` en el límite; más del 90 % de las muestras sin
  invasión (solo con ≥ 5 muestras: las lutitas no invaden y avisar siempre sería ruido); muestras con < 3 curvas válidas.

### Roles y mnemónicos

- `RA10`, `RA20`, `RA30`: resistividad, medidos, escala log 0,2-2000 como `RT`; paleta ocre / verde oliva / violeta (de somero a
  profundo, entre el naranja de `RS` y el azul de `RM`); AT60 sigue siendo `RM` (azul) y AT90 `RT` (rojo).
- `DI` (in, escala 0-200) e `INV_MISFIT` (sin unidad): calculados, quedan en el grupo «Curvas calculadas» del catálogo de pistas.
- Mnemónicos con **confianza alta** (antes `null`, baja): AT10/AHT10/AF10/M2R1 → `RA10`, …20/M2R2 → `RA20`, …30/M2R3 → `RA30`.
- **Consecuencia en el visor:** AT10/AT30 dejaron de ser «curvas sin rol» y la pista «Resistividad» de fábrica las toma por rol
  (entradas `RA10`, `RA20`, `RA30` agregadas **después** del grupo `{ unassigned: 'resistivity' }`, para no mover su índice).
  Las pistas sin personalizar no se guardan en el proyecto, así que toman la de fábrica nueva y se ven igual; una pista
  personalizada que guardó el grupo `unassigned` ya no recoge AT10/AT30 (ahora tienen rol) y hay que agregarlas por rol o por curva.

## 5. Pozo de demostración

`AT10` pasa a `RA10`; se agregan `AT30` (`RA30`) y `AT60` (`RM`); `AT90` (`RT`) es la lectura de 90 in del mismo modelo. Se generan
con `forwardStepProfile` a partir de la Rt anterior del demo y de un perfil por zona: Rxo/Rt = 5,0 / 4,0 / 2,5 / 4,0 / 3,5 y
di = 40 / 50 / 60 / 45 / 40 in (zonas A-E) en la arena pura, con Rxo = 0,25·Rt (invasión conductiva) donde hay hidrocarburo en la
zona C; la arcilla no invade (Rxo = Rt, di = trépano) y se interpola en log según el volumen de arena. Los contrastes y diámetros
se eligieron para que el ajuste los resuelva (con Rxo/Rt ≈ 2 y di ≈ 30 in el diámetro queda mal resuelto, ver sección 3). Sin
ruido: el ajuste reproduce las cuatro curvas con misfit < 10⁻³; las muestras con arena parcial siguen saliendo `poorly-resolved`.
Cambios que dependían del demo: el rol `RS` ya no existe en él (nadie lo consumía salvo la pista de resistividad); `AT90` cambió de
valor (antes era la Rt verdadera, ahora lee algo de zona lavada). Los tests `tracks-builder` y `tracks-review` ajustaron su pozo de
prueba (el demo ahora trae AT30/AT60) y las listas de entradas de la pista de resistividad (+ `RA10`, `RA20`, `RA30`; `RT` pasó del
índice 4 al 7): consecuencia directa de lo anterior.

## 6. Qué se verificó y contra qué

| Qué | Contra qué |
|---|---|
| `J(0) = 0`, `J(∞) = 1`, `J(r50) = 0,5`, monotonía, valores de J en 30 in (0,83861 y 0,16139) | propiedades y aritmética a mano |
| forma de J y `p = 1,5` | integración numérica independiente del factor geométrico de dos bobinas (Doll 1949, peso `ρ³`), error máx. < 0,045; la logística sobrestima J en la cola |
| modelo directo (Ra a 10, 30 y 90 in para di = 60, Rxo = 10, Rt = 1: 4,0774; 1,8182; 1,1700) | cálculo a mano |
| inversión ida y vuelta | 6 perfiles (resistivos y conductivos) × 3, 4 y 5 curvas: Rxo, di y Rt a < 0,1 %, misfit < 10⁻⁴; el intervalo de di contiene al verdadero |
| intervalo de di | misfit recalculado con código propio en `diLow` y `diHigh`: ≈ δ = 0,02 |
| mínimo global | búsqueda exhaustiva independiente en `(ri, σxo, σt)`: el objetivo de la inversión nunca es peor |
| TP completo | cotas físicas (ningún Rxo emitido ≥ 10⁴), `Rt` = AT90 donde no hay invasión o no se resuelve, misfit recalculado con código propio coincide a 9 decimales |
| 5 filas del TP calculadas por una revisión independiente (filas 0, 1000, 3000, 4000, 5809) | di, Rxo y Rt a 0,5 %, misfit a 10⁻⁴; las filas 400, 2500, 4500 y 5000 salen «sin invasión» |

**No verificado contra libro.** No hay caso de libro: no se pudo consultar a Asquith y Krygowski (2004) ni las cartas «tornado» o
de la AIT de Schlumberger en el entorno de trabajo, y los valores de memoria no son confiables. Con las J aproximadas, de todos
modos no se esperaría coincidencia exacta con una carta (tolerancia razonable: un 15-20 % en `di` y 10 % en `Rt`, por la diferencia
de J, que alcanza 0,04). Queda pendiente reproducir un ejemplo de carta cuando se tenga el libro, y confirmar contra un manual de la
herramienta que 10-90 in son radios (la certeza actual es ≈ 75-80 %).

## 7. Resultados sobre el pozo del TP (4 curvas: AT10, AT30, AT60, AT90; umbral 0,10; δ = 0,02; trépano 8,5 in)

Estados sobre las 5810 muestras: **33,2 %** sin invasión visible; **12,3 %** `ok` (de ellas 7,6 % emiten Rxo y di, y 4,7 % tienen
`Rxo` en la cota de σ: `Rxo` sin dato); **42,3 %** `poorly-resolved`; **12,3 %** `unresolved` (6,5 % pegado al trépano, 5,7 % en
el máximo de 300 in, 0,1 % con σt en el límite). Sobre las 3171 muestras con ajuste interior (`ok` + `poorly-resolved`), 369 (11,6 %)
tienen `Rxo` en la cota. Desajuste > 0,15: 14 de 3882 ajustes (0,4 %), entre ellos los picos de AT10 del README (hasta 110 ohm·m).

**En todas las zonas (A-E) la mayoría de los `di` no son interpretables:** de los ajustes de cada zona, el 65 % (A), 63 % (B),
88 % (C), 63 % (D) y 54 % (E) son `poorly-resolved`, y otro 7-35 % está sin resolver. Solo D y E tienen una
cantidad apreciable de ajustes con `Rxo` y `di` emitidos; la zona C no tiene ninguno. Con contrastes de 10-30 % entre las curvas la
profundidad de invasión no se puede acotar mejor que un factor 2 con las J disponibles: el módulo lo dice en vez de inventar un número.

Medianas por zona, **solo de los ajustes que emiten Rxo y di** (`ok` sin Rxo en la cota):

| Zona | n | Rxo (ohm·m) | Rt (ohm·m) | AT90 (ohm·m) | di (in) |
|---|---|---|---|---|---|
| A | 4 | 1,13 | 0,44 | 0,54 | 27,5 |
| B | 11 | 24,6 | 3,78 | 5,47 | 99 |
| C | 0 | sin dato | sin dato | sin dato | sin dato |
| D | 271 | 5,04 | 0,45 | 0,48 | 33,9 |
| E | 155 | 9,35 | 0,46 | 0,62 | 104 |

(A y B tienen muy pocas muestras: no sacar conclusiones.) Para una idea del conjunto, `Rt` mediana de todos los ajustes interiores
por zona: 0,65 / 1,94 / 1,10 / 0,95 / 0,84 ohm·m para A-E, contra una AT90 de 0,68 / 2,08 / 1,15 / 1,00 / 0,90. Y el `di` mediano de
los `poorly-resolved` que devuelve la API (no sale en las curvas): 36 / 68 / 59 / 40 / 40 in.

- La invasión es en general resistiva (Rxo > Rt, el lodo es más resistivo que el agua de formación); hay 102 ajustes interiores
  (3,2 %) con Rxo < Rt, mayormente ruido en muestras con separación ≈ 0,2.

## 8. Vista

Pestaña «Perfil radial» del dock, aportada por el módulo (función V del plan): a la profundidad del cursor del visor, las
lecturas de la inducción de arreglo en función de la distancia al pozo sobre un corte con pozo, zona lavada y formación virgen.
Capturas: `docs/capturas/8b-perfil-radial-*.png`.

### Archivos

| Archivo | Qué hace |
|---|---|
| `src/modules/invasion-step/radial.ts` | puro (lo cubre la regla de pureza de `tests/modules.test.ts`): curvas que el motor le pasa al módulo, muestra más cercana, zona y parámetros vigentes, ajuste de una muestra (`radialViewAt`), estados y textos, sensibilidad radial, corte, perfil escalonado y curva de guía |
| `src/modules/invasion-step/draw.ts` | dibujo en canvas (sin React; usa `ui/` y `plots/xy`): ejes, reparto del lienzo, corte, campanas, banda de di, datos y rótulos. Lo usan el panel y la figura exportada |
| `src/modules/invasion-step/dock.tsx`, `radial.css` | pestaña del dock (se descubre sola) |
| `src/modules/invasion-step/pin.ts` | estado de interfaz sin React: última profundidad del cursor y profundidad fijada |
| `src/modules/invasion-step/overlay.ts` | línea «Perfil radial» en el visor a la profundidad fijada |
| `src/modules/invasion-step/commands.ts` | paleta: «Ver perfil radial de invasión» y «Fijar / Soltar la profundidad del perfil radial» |
| `src/plots/xy/figures.ts`, `figure.ts` | **aditivo**: `XYFigureSource.plot`, dibujo propio del área del gráfico en la figura (ver abajo) |
| `src/ui/components/Icon.tsx` | íconos `radial` (pestaña) y `pin` (fijar) |
| `tests/modules.test.ts` | `draw.ts` de un módulo queda fuera de la regla de pureza, como `overlay.ts` (fila de la tabla de carpetas de `docs/arquitectura.md`) |
| `tests/modules-8b-radial.test.ts` | 27 tests: entradas = las del motor (también DI muestra a muestra), muestra, zona, parámetros, estados, geometría, fijar, dibujo y figura SVG |

### Decisiones

1. **Eje radial logarítmico, fijo de 2 a 200 in.** Las medianas 10-90 in están en progresión casi geométrica y la búsqueda de di va de
   8,5 a 300 in (× 35): en lineal AT10, AT20 y AT30 quedarían en el primer décimo del ancho y la zona virgen ocuparía casi todo. Además J
   es una logística en ln r: en log cada curva lee una campana del mismo ancho centrada en su r50, que es exactamente lo que se quiere
   mostrar («a qué escala lee cada herramienta»). Rango fijo para que el gráfico no salte al mover el cursor; desde 2 in el pozo
   (≈ 4,25 in de radio) ocupa ≈ 15 % del ancho, lo justo para que se vea. Descartado: lineal (amontona las curvas someras); log desde
   1 in (el pozo ocupaba un 27 %).
2. **Resistividad en log**, convención de la industria, en décadas enteras que contienen lecturas, modelo, Rxo y Rt (cambia solo al
   cruzar una década).
3. **Corte arriba, perfil abajo, mismo eje x.** Una franja angosta («Corte») con el pozo (lodo, azul grisáceo), la zona lavada (tinte
   del color de Rxo), la formación virgen (arena tenue), la pared con revoque (línea marrón) y el frente de invasión (rayado); debajo
   el gráfico de resistividad, con un tinte más tenue de las mismas bandas detrás de los datos. Arriba y no abajo porque así el eje x
   y su título quedan al pie del gráfico como en cualquier otro (`drawFrame` sin cambios). Descartado: dibujar el corte en planta con
   círculos (en escala log los anillos no se pueden dibujar concéntricos sin mentir) y ponerlo solo «detrás» del gráfico (las campanas
   y los rótulos de zona competían con los datos).
4. **«A qué escala lee cada curva»: campanas de sensibilidad radial** en la franja del corte, una por curva en su color: dJ/d(ln r)
   normalizada a 1 en la mediana (= 4·J·(1 − J) con la logística), con una marca en r50. El área entre dos radios es la fracción de la
   señal de ese anillo; sobre el corte se ve de un vistazo qué curva lee la zona lavada y cuál la virgen. Una curva sin dato en la
   muestra se dibuja rayada y sin relleno. Descartado: J(r) acumulada (cinco sigmoides casi paralelas, no se distinguen) y bandas
   r10-r90 (cortan la cola, que es justamente lo que hace que AT90 «vea» algo de zona lavada).
5. **Datos**: lecturas medidas (puntos llenos, color de la curva, rótulo con el mnemónico) en su r50; modelo (círculo vacío) unido a la
   medida por un trazo fino (el residuo); el perfil escalonado ajustado en trazo grueso neutro (Rxo de la pared al frente, salto, Rt
   hasta el borde) con los valores rotulados; una guía punteada con la lectura que daría una curva según su profundidad de
   investigación (por ahí pasan las lecturas modeladas). Los colores de curva vienen de `curveStyle` con contraste ≥ 3:1. Rótulos con
   placa translúcida y búsqueda de lugar libre (sin `strokeText`, para que la figura SVG sea la misma).
6. **Incertidumbre de di como protagonista.** En el TP el estado más común con perfil es `poorly-resolved` (42 % de las muestras),
   así que el intervalo `diLow`–`diHigh` no es un detalle: se dibuja como banda rayada en el corte y en el gráfico, el rótulo dice
   «di 41 in (8,5–125)» y el resumen lo muestra en su propia línea («di plausible»). También en los ajustes buenos (allí es angosto).
7. **Estados** (`RadialStatus`, todos con texto propio y tono en el resumen): «Ajuste bueno»; «Ajuste dudoso» (`ok` con desajuste
   mayor que `maxMisfit` de la zona); «di mal determinado» (`poorly-resolved`: se dibuja el frente con su banda y se avisa que el
   módulo deja Rxo y di sin dato en esa muestra); «Invasión no resuelta» (`unresolved`, con el motivo `deep` / `shallow` / `sigma` en
   palabras; sin frente, Rt = lectura más profunda en línea rayada); «Sin invasión visible» (con la separación y el umbral);
   «Datos insuficientes» (menos de 3 lecturas); y dentro de un ajuste bueno, «di en el trépano», «di en el máximo» y «Rxo fuera de
   rango» (`rxoAtBound`: solo se dibuja el tramo de Rt desde el frente). Sin curvas de arreglo suficientes en el pozo, un estado vacío
   que dice cuáles hay y qué asignar.
8. **Mismas curvas y parámetros que el módulo, sin recalcular la cadena.** Las entradas se resuelven con la regla de `sourceFor` del
   grafo (fuente elegida; si es el propio módulo —su Rt corregida—, la curva medida), en la unidad canónica; los parámetros con
   `resolveModuleParams` para la zona de la muestra (`layoutZones`, la misma regla del motor), y el trépano por muestra de la curva
   BS si la hay. Un test compara con el motor muestra a muestra (di idéntico a 10⁻⁶) y en el demo coincide en todas las profundidades
   probadas. El pozo se dibuja con el caliper si tiene dato (la cota del ajuste sigue siendo el trépano).
9. **Profundidad: sigue al cursor; al salir del visor conserva la última; «Fijar» la congela.** El botón con chincheta (o la paleta)
   fija la profundidad, que pasa a ser un campo numérico (↑/↓ de a una muestra) y aparece en el visor como una línea rayada con la
   etiqueta «Perfil radial». Sin cursor todavía: la mitad del tramo visible. Cambiar de pozo suelta lo fijado. Estado de interfaz
   (`pin.ts`), no se guarda en el proyecto. «Ver en el visor» (ojo) lleva el visor a esa profundidad. Descartado: fijar con un clic en
   el visor (los gestos del visor los estaba cambiando otra tarea en paralelo) y arrastrar la línea fijada (queda pendiente).
10. **Fluidez.** La pestaña escucha el cursor aunque esté oculta (sin re-render: guarda la profundidad redondeada a la muestra, cambia
    una vez por muestra y no por píxel) y monta el panel solo a la vista. Una muestra cuesta ≈ 0,25 ms de ajuste (con el intervalo de di)
    y ≈ 1-3 ms de dibujo; nada recorre el pozo. Medido en Chromium sin GPU con el TP y el build de producción, 240 movimientos del cursor:
    cuadro medio 46,5 ms con el panel contra 42,0 ms sin él (p95 61,8 contra 54,6); el resto es el propio visor en ese entorno lento.
11. **Figura exportable** («Exportar → Figuras → Crossplot con leyenda», PNG/SVG/PDF) mientras la pestaña está a la vista, con título
    «Perfil radial de invasión · pozo · profundidad». El registro de figuras solo sabía dibujar capas x–y; se agregó un campo opcional
    `plot` a `XYFigureSource` que reemplaza `drawXYScene` en la caja del gráfico (tema claro, factor 1): el panel le pasa el mismo
    `drawRadialProfile` de la pantalla y capas con nombre solo para la leyenda (curvas y perfil ajustado). Cambio aditivo de 2 archivos;
    descartado: un registro de figuras paralelo (había que tocar el diálogo de exportación) y expresar el corte como capas x–y (barras
    sobre un eje derecho ficticio).
12. **Pista del visor con Rxo, Rt corregida y di: no se agregó.** La pista «Resistividad» de fábrica ya muestra RXO (salida activa del
    módulo si no hay Rxo medida) y la Rt corregida como «alternativa» junto a AT90; DI e INV_MISFIT caen en «Interpretación» y en el grupo
    «Curvas calculadas» del catálogo de «Armar pistas». Una herramienta más sería redundante y di (in) no comparte escala con las
    resistividades. Se puede sumar al catálogo si el uso lo pide.

### Cómo se lee

Arriba, el corte: a la izquierda el pozo, la zona lavada hasta la línea rayada (frente de invasión, di/2) y la formación virgen; la banda
rayada es el intervalo plausible del frente. Las campanas dicen de dónde viene la señal de cada curva: la de AT10 vive en la zona lavada,
la de AT90 casi toda en la virgen. Abajo, los puntos son las lecturas en su profundidad de investigación, los círculos vacíos lo que el
perfil ajustado predice, y la línea gruesa el perfil: si las lecturas bajan con la profundidad de investigación, la invasión es resistiva
(Rxo > Rt). A la derecha, la profundidad y la zona, el estado del ajuste, Rxo, Rt, di (con su intervalo), Rxo/Rt, desajuste, separación,
la tabla de lecturas (medida, modelo y diferencia) y los parámetros con que se calculó (trépano y su origen, umbrales, zona).

### Verificado

- `tests/modules-8b-radial.test.ts` (27): entradas iguales a las del motor (fuente elegida, fuente = el propio módulo, curva con otro
  rol, otro módulo, BS); di de la vista = DI del módulo en un pozo sintético de 40 muestras; muestra más cercana, zona con la regla del
  motor y parámetros zona → global → fábrica; estados ok / sin invasión / insuficiente / dudoso / `poorly-resolved` / `unresolved`
  (`sigma`, y los textos de `deep` y `shallow`) / Rxo en la cota; geometría (campana = 1 en r50 y simétrica en log, bandas del corte,
  perfil escalonado, guía por las lecturas modeladas, eje, reparto del lienzo sin solapes); fijar profundidad; dibujo sobre el contexto
  SVG (claro y oscuro) y figura SVG completa por `renderFigure`.
- Chromium real (Playwright, build de producción y servidor de desarrollo): demo y TP; claro y oscuro; Compacto, Normal y Grande sin
  desplazamiento de página (`scrollWidth = clientWidth`, `scrollHeight = clientHeight`); sin errores de consola; el gráfico aparece en
  «Exportar → Figuras»; la línea fijada se ve en el visor.

### No verificado / pendiente

- Lectores de pantalla: el lienzo tiene `role="img"` con un resumen (profundidad, estado y lecturas) y el resumen es HTML; no se probó
  con un lector real.
- Exportar a PNG y PDF desde el diálogo en el navegador: se probó el SVG por `renderFigure`; PNG y PDF usan el mismo dibujo.
- Arrastrar la línea fijada en el visor para mover la profundidad; tooltip sobre el lienzo con la lectura bajo el puntero.
- Con 3 curvas el desajuste es ≈ 0 siempre (3 incógnitas): la vista lo muestra igual; podría decir «no informa».

## Consecuencias

- Nuevos roles en `BUILTIN_ROLES`: el catálogo, la paleta (`tests/ui/tokens-curves.test.ts` exige una entrada por rol) y el rango
  físico de la QC se ampliaron. Cualquier lista fija de roles resistivos (`RT/RM/RS/RXO`) debería sumar `RA10/RA20/RA30`.
- La tabla de mnemónicos ya no tiene entradas con rol `null` para la inducción de arreglo; los proyectos guardados con AT10/AT30 sin
  rol conservan su asignación (la elección del usuario manda).
- Pendientes: confirmar radio/diámetro con un manual de la herramienta; reemplazar la logística por las respuestas radiales de la herramienta; un ajuste robusto que
  descarte una curva incoherente cuando haya 5; incorporar el efecto de la zona de transición si se consiguen más curvas.
