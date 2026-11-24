# 0024 — Tipos de roca (fase 8, función P)

- Estado: aceptada (fase 8).
- Alcance: carpeta `src/modules/rock-typing/` (módulo del motor `rock-typing`: curvas `FZI`, `R35` y `ROCK_TYPE`, tabla
  `ROCK_TYPES`; `model.ts` puro del panel; `draw.ts` con los colores de clase; `overlay.ts` con la pista «Tipo de
  roca»; `dock.tsx` con el panel «Tipos de roca»), roles `FZI`, `R35` y `ROCK_TYPE` en `src/core/roles.ts` y sus
  colores en `src/ui/curves.ts`, unidad `um` (µm, longitud) con sus alias en `src/core/units.ts`.
- Se apoya en el motor puro ya revisado `src/petro/rockTyping.ts` (sin cambios de API), en 0010 (plugs como conjunto
  de puntos, `shiftedDepth`, modelo k–φ y «Aplicar al pozo»), en 0005 D7 (superposiciones con pista propia) y en 0023
  (misma organización: módulo del motor para lo que sale del perfil, panel para lo que usa plugs). Sin cambios en el
  núcleo del visor, en el contrato de módulo ni en el formato del proyecto.

## Contexto

El plan pide «familias de roca a partir de ensayos capilares (MICP) y gargantas porales: Winland R35 y Pittman,
unidades de flujo por FZI/RQI, distribución de tamaño de gargantas y función J de Leverett. Cada familia se lleva al
pozo como pista de colores usando el modelo k–φ». No hay MICP del pozo: Winland, Pittman y FZI/RQI salen de k y φ de
los plugs; la J y la distribución de gargantas usan un ejemplo de libro.

## D1. Módulo del motor para el perfil, panel para los plugs

- **`rock-typing`** (categoría Permeabilidad, registrado detrás de `perm-core`) recibe `PHIE` y `PERM` (la fuente
  vigente) y produce por muestra `FZI` (µm), `R35` de Winland (µm) y `ROCK_TYPE` (índice de clase, NaN sin dato), más
  la tabla `ROCK_TYPES` (muestras, espesor, φ media y k media geométrica por clase) para Resultados.
- **Parámetros globales**: método (`fzi` | `winland`), número de unidades (2–6) y cinco límites de FZI (`fzi1…fzi5`,
  escala log 0,01–100 µm, de fábrica 0,25 · 0,6 · 1,5 · 3,5 · 8); con n unidades se usan los n − 1 primeros. Un
  límite fuera de orden se ordena con aviso. Globales y no por zona: una familia de roca es la misma en todo el pozo.
- **El motor no ve los plugs** (0009 D1): la clasificación se arma en el panel y «Llevar al pozo» escribe método,
  número de unidades y límites redondeados a 3 cifras en una sola receta (un Ctrl+Z), como «Aplicar» del k–φ.
- Clase 0 = peor roca (FZI más bajo, o nano). «UF 1» es la unidad de FZI más bajo.

## D2. Permeabilidad del perfil: la vigente, con aviso si no es la de corona

El plan dice «usando el modelo k–φ». El módulo pide `PERM` por rol y no un módulo concreto (el contrato no lo
permite y no hace falta): la barra del panel dice de dónde sale k y, si no es `perm-core`, ofrece «Usar el modelo
k–φ de corona» (cambia la fuente de PERM, un Ctrl+Z) o lleva a Corona a ajustarlo. Con el k–φ de corona, log k es
lineal en φ y por lo tanto el FZI del perfil es función de φ sola: las unidades del pozo quedan como bandas de
porosidad. Es la consecuencia esperable de llevar las familias con un único modelo k–φ (Amaefule et al. 1993
proponen un k–φ por unidad, que es circular sin la unidad ya conocida); queda anotado como abierto.

## D3. Panel «Tipos de roca» (tres pestañas)

- **Winland · Pittman**: k (log) contra φ con isolíneas de 0,1 · 0,5 · 2 · 10 µm (los límites de Martin et al. 1997)
  para el radio elegido (Winland R35, Pittman R25/R35/R50, guardado en los ajustes del conjunto), plugs coloreados por
  clase de garganta, nube del perfil (PHIE, PERM) como contexto y cuentas por clase. En el pozo siempre se usa el R35
  de Winland («Llevar al pozo» cambia solo el método).
- **Unidades de flujo · FZI**: log RQI contra log φz con una recta de pendiente 1 por unidad (FZI medio geométrico) y
  los límites rayados; 2–6 unidades automáticas (`autoFlowUnits`, Fisher–Jenks exacto sobre log FZI: es instantáneo
  con decenas de plugs) o límites manuales (campos numéricos; al pasar a manual se parte de los automáticos); GVF;
  tabla (n, rango, FZI medio, φ mediana, k media geométrica); avisos con unidades de < 3 plugs o de φ mediana < 0,05
  (el FZI se infla en rocas muy cerradas). Modo, número y límites se guardan en los ajustes del conjunto de plugs.
- **Presión capilar**: Pc–Sw mercurio–aire, J de Leverett y distribución de gargantas de Washburn del ejemplo de
  libro (`EXAMPLE_PC_CLASSES`, Brooks–Corey con Pd por Leverett), rotulado siempre «Ejemplo de libro: no son datos del
  pozo» (insignia en la pestaña, aviso y fuente). Cada curva se colorea con la unidad de flujo en la que caería su
  FZI con los límites de los plugs.
- Plugs: solo incluidos (`plugStatuses`) y en su profundidad corregida (`shiftedDepth`); clic en un plug lo muestra
  en el visor. Estados vacíos: sin pozo, sin plugs (con «Ir a Corona» y «Usar plugs de ejemplo»), plugs sin φ o k,
  pozo sin permeabilidad.

## D4. Preparado para Pc–Sw digitalizado

El panel dibuja `PcCurve[]` (`source: 'book' | 'measured'`, k, φ, Sw, Pc creciente, σ y θ). `pcCurvesFromPointSet`
ya arma esas curvas desde un conjunto de puntos `kind: 'capillary'` (columnas `sample`, `sw`, `pc` y opcionales `k`,
`phi`); `capillaryCurves` usa las del pozo si existen y si no el ejemplo. Falta solo el lector (un mapeo de columnas
como el de plugs en `src/io/core.ts`), que no se construyó.

## D5. Pista «Tipo de roca»: superposición con pista propia

El visor no tiene pistas de clases (las banderas son binarias). En vez de agregar un tipo de pista al núcleo, el
módulo aporta una superposición con pista propia (contrato `ViewerOverlay.track`, 0005 D7), en Petrofísica después
de Permeabilidad y solo si el pozo tiene plugs. Escala log 0,01–100 µm (FZI y R35 viven en ese rango): fondo tenue
del color de la clase a todo el ancho, relleno opaco hasta el valor que clasifica (FZI o R35), esa curva encima,
límites de clase rayados y rótulo («UF 3», «Meso») en los bloques altos; tooltip con clase, rango, FZI y R35. El rol
`ROCK_TYPE` se pinta como `band`, así la pista recolectora «Interpretación» no la dibuja como línea; `FZI` y `R35`
sí entran ahí y en el catálogo, el histograma y el crossplot libres, como `RHOMAA` en 0023.

## D6. Colores de clase

Rampa viridis del sistema de diseño (`SEQUENTIAL_PALETTE`, la de «color por curva» del crossplot), muestreada en n
clases: violeta = peor, amarillo = mejor; legible para daltonismo y en escala de grises. Una sola función
(`draw.ts`, `classColor`) para la pista, los plugs, las rectas, la tabla y las curvas capilares; en los gráficos los
puntos pasan por `ensureContrast` contra el fondo.

## Abierto

- Lector de Pc–Sw digitalizado (CSV) hacia un conjunto `capillary`. Las curvas MICP del TP ya se cargan embebidas
  (0087); falta el lector genérico para otros pozos.
- Un k–φ por unidad de flujo (permeabilidad por FZI) como módulo alternativo de PERM, para que las unidades no
  sean bandas de φ.
- Límites arrastrables sobre el gráfico RQI–φz y clasificación de Pittman en el pozo.
