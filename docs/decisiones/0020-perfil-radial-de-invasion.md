# 0020 — Perfil radial de invasión escalonada desde la inducción de arreglo (fase 8b, función V)

- Estado: aceptada la parte del motor y del módulo (fase 8b); la sección «Vista» está pendiente.
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
  pelicular (Doll 1949; Moran y Kunz 1962), `g(ρ, z) ∝ ρ²/(ρT³ρR³)`, en `z` y acumulado en `ρ`. Resulta `r50 ≈ 0,378·L` y una
  cola `1 − J ∝ 1/ρ²`. La logística con **p = 1,5** minimiza el error máximo (0,040 en J; con p = 1 da 0,13; con p = 2, 0,082;
  con p = 1,4 y 1,6, 0,056 y 0,044). El test `tests/petro-invasion.test.ts` repite esa integración con código propio y exige
  menos de 0,045. Cuantiles del J de dos bobinas en unidades de r50: J = 0,10 en 0,17; 0,25 en 0,47; 0,75 en 1,94; 0,90 en 3,37;
  0,95 en 4,93 (la logística da 0,067; 0,244; 0,73; 0,86; 0,92).
- **Límite.** Las cinco curvas de la AIT se sintetizan por enfoque por software, así que sus respuestas radiales reales no son las
  de una sonda simple de dos bobinas (se espera que sean más angostas; sin las curvas del fabricante no se puede acotar). El sesgo
  recae sobre `di` y `Rxo`; `Rt` es lo más robusto. Los números son estimaciones de orden de magnitud con buena consistencia
  relativa entre muestras, no una inversión calibrada.
- **Profundidades 10, 20, 30, 60, 90 in: radio, no diámetro.** Se toman como **profundidad mediana de investigación radial**
  (`J = 0,5`), desde el eje de la herramienta. Es lo que dice la documentación pública de la familia AIT («depth of investigation:
  10, 20, 30, 60, 90 in», consultada en búsqueda web), pero ese texto no define si es radio o diámetro y no se pudo abrir el manual
  del fabricante. Si fuera diámetro, `r50` sería la mitad y el `di` estimado saldría ≈ 2 veces mayor, con `Rt` y la forma del
  ajuste casi iguales. **Pendiente de confirmar** contra un manual de la herramienta.
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
   tener más de un mínimo cuando las lecturas son incoherentes. 5810 muestras con 4 curvas tardan ≈ 0,25 s.
4. Salida: `Rxo = 1/σxo`, `Rt = 1/σt`, `di = 2·ri`, `misfit`, más `status`, `separation`, `nCurves` y `atBound`.

### Casos borde

| Caso | `status` | Rxo | Rt | di | misfit |
|---|---|---|---|---|---|
| < 3 lecturas válidas (NaN, ≤ 0, no finitas) | `insufficient` | sin dato | sin dato | sin dato | sin dato |
| `Rmax/Rmin − 1 <` umbral (0,10 por defecto) | `no-invasion` | sin dato | lectura de la curva más profunda | sin dato | sin dato |
| resto | `ok` | ajustada | ajustada | ajustado | RMS relativo |

- **Sin invasión visible:** con lecturas iguales cualquier `ri` ajusta, así que `di` es indeterminado y no se inventa un valor. `Rt` es
  la lectura más profunda (la menos afectada). El umbral es el parámetro `minSeparation` (por zona).
- **Resistiva** (Rxo > Rt): las lecturas bajan con la profundidad. **Conductiva** (Rxo < Rt): suben. Las dos se recuperan.
- **`atBound`:** `min` (di = trépano: la invasión es más somera de lo que resuelve la herramienta) o `max` (di ≥ 300 in: `Rt` poco
  determinada). El módulo avisa por zona cuando más del 10 % de los ajustes están en el máximo.
- **Grados de libertad:** 3 incógnitas (`ri`, σxo, σt). Con 3 curvas el ajuste es casi exacto y el misfit no informa; con 4 hay 1
  grado y con 5 hay 2. El misfit mide cuánto se aparta el perfil escalonado de las lecturas, no la incertidumbre de los parámetros.
- **Pico aislado:** no se filtra. En las pruebas (AT10 de 110 ohm·m sobre ≈ 1) el misfit sale entre 0,2 y 0,6 (contra < 10⁻⁴ del
  caso limpio), pero con 4 curvas el `Rt` de esa muestra se desvía 30-60 %: **misfit alto = Rxo, di y Rt de esa muestra no son
  confiables**. Probar pisos de peso mayores (0,1 a 0,5) no mejora `Rt` y baja el misfit del pico (0,19 con 0,5), por eso se dejó 0,05.
  Una robustez real (descartar la curva que más empeora el ajuste) necesita ≥ 5 curvas y no se hizo.

## 4. Módulo `invasion-step`

- **Entradas por rol:** `RA10`, `RA20`, `RA30`, `RM` (opcionales) y `RT` (requerida). El módulo supone que `RM` es AT60 y `RT` es AT90
  (inducción de arreglo): **no puede comprobarlo**, solo documentarlo (`docs.notes`). Con otras herramientas (ILD/ILM de doble
  inducción, laterolog) las profundidades de 60 y 90 in no valen.
- **Salidas:** `RXO`, `RT`, `DI` (pulgadas) e `INV_MISFIT`. El motor prefiere la **curva medida** con el mismo rol: `RT` y `RXO`
  del módulo quedan como fuente alternativa (no activa) mientras exista AT90 / un Rxo medido; `DI` e `INV_MISFIT` no tienen otra
  fuente y activan el módulo.
- **Categoría nueva** `resistivity` / «Resistividad», espacio de petrofísica.
- **Parámetros** (por zona, con tooltip): `minSeparation` (0,10), `maxMisfit` (0,15: solo cuenta los ajustes pobres para el aviso) y
  `bitSize` (8,5 in, cota inferior de `di`).
- **Avisos por zona** (`ctx.warn`): menos de 3 curvas (global); más del 10 % de ajustes con desajuste alto; más del 90 % sin invasión
  (solo con ≥ 5 muestras: las lutitas no invaden y avisar siempre sería ruido); más del 10 % de ajustes pidiendo más de 300 in; muestras
  con < 3 curvas válidas.

### Roles y mnemónicos

- `RA10`, `RA20`, `RA30`: resistividad, medidos, escala log 0,2-2000 como `RT`; paleta ocre / verde oliva / violeta (de somero a
  profundo, entre el naranja de `RS` y el azul de `RM`); AT60 sigue siendo `RM` (azul) y AT90 `RT` (rojo).
- `DI` (in) e `INV_MISFIT` (sin unidad): calculados, quedan en el grupo «Curvas calculadas» del catálogo de pistas.
- Mnemónicos con **confianza alta** (antes `null`, baja): AT10/AHT10/AF10/M2R1 → `RA10`, …20/M2R2 → `RA20`, …30/M2R3 → `RA30`.
- **Consecuencia en el visor:** AT10/AT30 dejaron de ser «curvas sin rol» y la pista «Resistividad» de fábrica las toma por rol
  (entradas `RA10`, `RA20`, `RA30` agregadas **después** del grupo `{ unassigned: 'resistivity' }`, para no mover su índice).
  Las pistas sin personalizar no se guardan en el proyecto, así que toman la de fábrica nueva y se ven igual; una pista
  personalizada que guardó el grupo `unassigned` ya no recoge AT10/AT30 (ahora tienen rol) y hay que agregarlas por rol o por curva.

## 5. Pozo de demostración

`AT10` pasa a `RA10`; se agregan `AT30` (`RA30`) y `AT60` (`RM`); `AT90` (`RT`) es la lectura de 90 in del mismo modelo. Se generan
con `forwardStepProfile` a partir de la Rt anterior del demo y de un perfil por zona: Rxo/Rt = 3,0 / 2,5 / 2,0 / 2,0 / 1,8 y
di = 30 / 36 / 48 / 28 / 22 in (zonas A-E) en la arena pura, con Rxo = 0,3·Rt (invasión conductiva) donde hay hidrocarburo en la
zona C; la arcilla no invade (Rxo = Rt, di = trépano) y se interpola en log según el volumen de arena. Sin ruido: el ajuste
reproduce las cuatro curvas con misfit < 10⁻³. Cambios que dependían del demo: el rol `RS` ya no existe en él (nadie lo consumía
salvo la pista de resistividad); `AT90` cambió de valor (antes era la Rt verdadera, ahora lee algo de zona lavada). Los tests
`tracks-builder` y `tracks-review` ajustaron su pozo de prueba (el demo ahora trae AT30/AT60) y las listas de entradas de la pista
de resistividad (+ `RA10`, `RA20`, `RA30`; `RT` pasó del índice 4 al 7): consecuencia directa de lo anterior.

## 6. Qué se verificó y contra qué

| Qué | Contra qué |
|---|---|
| `J(0) = 0`, `J(∞) = 1`, `J(r50) = 0,5`, monotonía, valores de J en 30 in (0,83861 y 0,16139) | propiedades y aritmética a mano |
| forma de J y `p = 1,5` | integración numérica independiente del factor geométrico de dos bobinas (Doll 1949), error máx. < 0,045 |
| modelo directo (Ra a 10, 30 y 90 in para di = 60, Rxo = 10, Rt = 1: 4,0774; 1,8182; 1,1700) | cálculo a mano |
| inversión ida y vuelta | 6 perfiles (resistivos y conductivos) × 3, 4 y 5 curvas: Rxo, di y Rt a < 0,1 %, misfit < 10⁻⁴ |
| mínimo global | búsqueda exhaustiva independiente en `(ri, σxo, σt)`: el objetivo de la inversión nunca es peor |
| TP completo | cotas físicas, `Rt` = AT90 donde no hay invasión, misfit recalculado con código propio coincide a 9 decimales |

**No verificado contra libro.** No hay caso de libro: no se pudo consultar a Asquith y Krygowski (2004) ni las cartas «tornado» o
de la AIT de Schlumberger en el entorno de trabajo, y los valores de memoria no son confiables. Con las J aproximadas, de todos
modos no se esperaría coincidencia exacta con una carta (tolerancia razonable: un 15-20 % en `di` y 10 % en `Rt`, por la diferencia
de J, que alcanza 0,04). Queda pendiente reproducir un ejemplo de carta cuando se tenga el libro, y confirmar si 10-90 in son radios.

## 7. Resultados sobre el pozo del TP (4 curvas: AT10, AT30, AT60, AT90; umbral 0,10; trépano 8,5 in)

Medianas por zona (sobre las muestras con valor): Rxo, Rt y di.

| Zona | Rxo (ohm·m) | Rt (ohm·m) | AT90 (ohm·m) | di (in) |
|---|---|---|---|---|
| A | 1,30 | 0,86 | 0,87 | 32 |
| B | 2,58 | 2,24 | 2,33 | 70 |
| C | 1,49 | 1,12 | 1,16 | 60 |
| D | 2,66 | 1,10 | 1,15 | 35 |
| E | 2,15 | 1,21 | 1,22 | 39 |

- 33 % de las 5810 muestras sin invasión visible (1928); las 3882 restantes se ajustan.
- 0,4 % de los ajustes con desajuste > 0,15 (14 muestras), entre ellas los picos de AT10 del README (hasta 110 ohm·m).
- 9,7 % de los ajustes con di en el mínimo (376) y 8,5 % en el máximo de 300 in (330): con separaciones de 10-20 % entre curvas
  la profundidad de invasión está poco determinada; lo esperable con contraste débil. El módulo avisa en A, B y E.
- La invasión es resistiva en todo el pozo (Rxo > Rt): el lodo es más resistivo que el agua de formación.

## 8. Vista

Pendiente. (La completa quien haga la interfaz: perfil radial a la profundidad del cursor con `invasionProfileAtDepth`,
`radialResponseSamples` y los cortes pozo / zona lavada / virgen.)

## Consecuencias

- Nuevos roles en `BUILTIN_ROLES`: el catálogo, la paleta (`tests/ui/tokens-curves.test.ts` exige una entrada por rol) y el rango
  físico de la QC se ampliaron. Cualquier lista fija de roles resistivos (`RT/RM/RS/RXO`) debería sumar `RA10/RA20/RA30`.
- La tabla de mnemónicos ya no tiene entradas con rol `null` para la inducción de arreglo; los proyectos guardados con AT10/AT30 sin
  rol conservan su asignación (la elección del usuario manda).
- Pendientes: confirmar radio/diámetro; reemplazar la logística por las respuestas radiales de la herramienta; un ajuste robusto que
  descarte una curva incoherente cuando haya 5; incorporar el efecto de la zona de transición si se consiguen más curvas.
