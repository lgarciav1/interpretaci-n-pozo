# 0028 — Columna sedimentológica (fase 9e, función Geo-5)

- Estado: implementada, pendiente de revisión para integrar.
- Alcance: módulo `sed-column`, motor puro `src/petro/sedColumn.ts`, pista
  «Columna» de Geología, leyenda, espesores por litología y zona e integración
  con las figuras y el informe imprimible.
- Base: fases 9b–9d, con volúmenes de `mineral-inversion`, Vsh petrofísica,
  indicadores y la tabla `ELECTROSEQUENCES` disponibles.

## Contexto

Una columna de campo combina litología, tamaño de grano y geometría de las
capas. Los perfiles permiten construir una **estimación**, pero no sustituyen
una descripción de testigo. El grano inferido de GR/Vsh puede confundirse con
composición, arcillosidad o respuesta de herramienta; en carbonatos el ancho
no representa textura de Dunham ni un diámetro de grano medido.

La pista debe compartir el resultado del motor con el panel y las
exportaciones. Se publican dos tablas ocultas al panel genérico de Resultados:
`SED_COLUMN_LAYERS` y `SED_COLUMN_SUMMARY`. No se recalculan la clasificación
ni la segmentación de electrosecuencias dentro del visor.

## D1. Clasificación y respaldo sin inversión

La bandera `IND_COAL = 1` tiene prioridad. Con los cuatro volúmenes minerales
finitos y entre cero y uno, `V_CLAY` **mayor** al corte da lutita. Si la arcilla
no supera el corte, el mayor de cuarzo, calcita y dolomita da arenisca, caliza
o dolomía; los empates se resuelven en ese orden. No se asigna un mineral
dominante si los tres volúmenes no arcillosos son cero.

La clase clástica pasa a limolita si Vsh está entre el inicio de limolita y el
corte de arcilla, incluidos los extremos. Esa regla no cambia caliza ni
dolomía a limolita. Dominancia simple, desempate y cortes son criterios
operativos **SIN VERIFICAR**, no una clasificación petrográfica calibrada.

Si falta una inversión válida, se usa Vsh. Sin Vsh válida, se usa GR
normalizado entre extremos configurables y recortado a 0–1. Por encima del
corte de arcilla da lutita; desde el corte de limo hasta ese límite da
limolita; por debajo da arenisca. Si tampoco hay Vsh/GR pero la bandera
`IND_SHALE` vale uno, se conserva la clasificación de lutita. Sin evidencia
suficiente la muestra queda sin clasificación. Entradas ausentes no se
convierten en ceros ni generan NaN numéricos en las tablas: los promedios
faltantes se publican como `null`.

Anhidrita forma parte del catálogo y de la leyenda, pero **no se infiere
automáticamente**: la inversión actual no tiene ese componente. No hay
evidencia suficiente para identificarla a partir de los volúmenes disponibles.

## D2. Cobertura y bloqueo en dos pasadas

Cada muestra representa una celda entre los puntos medios de profundidades
vecinas. Los extremos se prolongan medio paso local, como la convención de
`sampleThickness` del repositorio. El sumario respeta la asignación de zona
por muestra del motor; un límite de capa puede quedar en el punto medio
entre muestras y no coincidir exactamente con el tope nominal de la zona.

Un salto de profundidad mayor a tres veces la mediana del paso delimita un
hueco de cobertura. A ambos lados se conserva medio paso representativo; no
se extiende la roca hasta llenar el salto. El factor tres es **SIN VERIFICAR**,
una decisión numérica que requiere revisión para otros muestreos.

Se separan primero los tramos por zona, hueco de cobertura, carbón y
muestras sin clasificación. Dentro de cada tramo compatible:

1. Se aplica una moda móvil de litología ponderada por espesor, con una
   ventana del espesor mínimo centrada en cada muestra. Los empates
   conservan la clase original.
2. Se agrupan clases contiguas. Se fusiona la capa menor al mínimo más
   delgada con su vecino más grueso; si hay empate se elige el superior.
   Se repite hasta satisfacer el mínimo o quedar un único tramo aislado.
3. Dentro de cada litología ya bloqueada se aplica el mismo procedimiento
   por clase de grano. Esta segunda pasada conserva cambios del contorno
   en paquetes de litología uniforme sin cambiar su litología ni cobertura.

El grano y el ancho finales salen de la clase **bloqueada**; no se vuelven a
clasificar desde el Vsh medio. Los volúmenes y Vsh medios se ponderan por el
espesor de sus muestras válidas. La suma de espesores se conserva; el
bloqueo cambia los rótulos y la partición, no los límites exteriores.

El carbón nunca se suaviza ni se fusiona con vecinos: una capa de 0,3 m
se conserva con mínimo de 0,5 m. También se preservan los huecos desconocidos
y los límites de zona. Un tramo no carbonoso aislado más fino que el mínimo
se mantiene y marca `belowMinimum`: imponer el mínimo ahí exigiría borrar
carbón, mezclar zonas o inventar cobertura. El motor avisa esa excepción.
Moda, ventana, orden de fusión y dos pasadas son decisiones **SIN VERIFICAR**
como método sedimentológico; se explicitan y prueban, sin atribuirlas a una
fuente bibliográfica.

## D3. Proxy de grano y eje ordinal

El proxy interpola en logaritmo de diámetro entre 1/512 mm para el extremo
arcilloso y 1 mm para el limpio con escala de fábrica. La escala configurable
permite llegar a grava; el cálculo se limita a 1/512–4 mm. **La relación entre
Vsh/GR y diámetro es SIN VERIFICAR** y no constituye una calibración con
corona. La firma acepta observaciones de grano de corona para una extensión
futura, pero todavía no las utiliza.

Los límites de clase sí corresponden a Wentworth y a las tablas de USGS:

| Clase del encabezado | Intervalo de diámetro |
| --- | --- |
| Arcilla (`arc`) | < 1/256 mm |
| Limo (`lim`) | 1/256–1/16 mm |
| Arena muy fina (`mf`) | 1/16–1/8 mm |
| Arena fina (`f`) | 1/8–1/4 mm |
| Arena media (`m`) | 1/4–1/2 mm |
| Arena gruesa (`g`) | 1/2–2 mm, incluye muy gruesa |
| Grava (`gr`) | ≥ 2 mm |

Cada frontera pertenece a la clase más gruesa. «Gruesa» reúne las clases
gruesa y muy gruesa para respetar las siete marcas pedidas. El ancho
normalizado es ordinal: índices 0–6 divididos por seis, no una escala lineal
de diámetro. La pista reserva un ancho visible para arcilla y una banda
lateral para los íconos de electrosecuencia. El panel y los tooltips aclaran
que es una estimación desde perfiles, también para carbonatos.

## D4. Tramas y dibujo compartido

Se cotejó la sección 37 de FGDC/USGS, láminas A–37–1 y A–37–2. Los mosaicos
son adaptaciones geométricas simplificadas para el visor: conservan el motivo,
sin afirmar que reproducen exactamente el arte del estándar.

| Litología | Referencia | Motivo |
| --- | --- | --- |
| Arenisca | FGDC 607 | Puntos |
| Limolita | FGDC 616 | Puntos y trazos cortos |
| Lutita | FGDC 620 | Trazos horizontales cortos |
| Caliza | FGDC 627 | Ladrillos |
| Dolomía | FGDC 642 | Ladrillos oblicuos |
| Carbón | FGDC 658 | Negro sólido |
| Anhidrita | Trama propia, SIN VERIFICAR | Cruces |
| Sin clasificación | Trama propia del visor | Rayado neutro |

La sección 37 no enumera un patrón específico de anhidrita. El patrón 667
es yeso y **no se atribuye a anhidrita**. La trama provisional se identifica
como SIN VERIFICAR en el código y la interfaz.

`TilePattern` y `fillPatternRect` extienden `src/viewer/fills.ts` de forma
genérica. Se crea un `CanvasPattern` repetible desde un lienzo fuera de
pantalla, con resolución según la transformación real del contexto (DPR o
exportación a alta densidad). El mosaico mantiene tamaño y origen en
coordenadas de dibujo; cambiar el ancho de una capa recorta el relleno, no
deforma sus puntos o ladrillos. La caché por contexto tiene una cota para
no crecer indefinidamente.

Fondos y trazos usan los tokens de los temas claro y oscuro. El carbón
subpíxel se representa con un mínimo gráfico de 1,5 px; esa exageración no
modifica su espesor calculado y se informa al usuario. El contorno conecta
solo contactos contiguos: deja abiertos los saltos de cobertura.

## D5. Integración y exportación

Una carpeta `src/modules/sed-column/` y un registro en `src/modules/index.ts`.
La pista se aporta mediante `overlay.ts` y aparece en Geología junto a la
columna mineral. El visor y el núcleo no importan el módulo.

Ampliaciones genéricas fuera de la carpeta:

- `ViewerData.tables` lleva tablas de solo lectura de la misma corrida que
  las curvas, con módulo, puerto y estado activo. `computedTables` filtra
  por pozo vigente; tanto el visor como las figuras reciben esos datos.
- `OverlayTrackDecl.axisLabels` y `headerLabel` permiten encabezados
  categóricos y se respetan en pantalla y figuras.
- `OverlayFrame.purpose` distingue interacción de exportación. El dibujo
  exportado omite el foco y la selección transitoria de la capa.
- `PatternPainter` permite que el grabador SVG conserve los mosaicos como
  patrones vectoriales. PNG, SVG, PDF y el informe imprimible reutilizan
  la superposición y el dibujo de la pista.

La superposición lee `SED_COLUMN_LAYERS` y `ELECTROSEQUENCES` activos. Cachea
la decodificación por identidad de tabla; no reclasifica perfiles ni ejecuta
una segunda segmentación. Los tooltips muestran litología, grano, origen,
espesor y volúmenes medios disponibles. El clic o el teclado seleccionan
una capa y el panel permite llevarla al tramo visible. Esa selección es
estado transitorio de interfaz; no cambia el proyecto.

La leyenda comparte los mosaicos de la pista y permite desglosar espesores
por zona. Los controles se declaran en el esquema del módulo y utilizan el
historial existente para cambios de parámetros. No se agregan ecuaciones
a la interfaz: quedan en `ModuleDocs` y Ecuaciones.

## D6. Valores SIN VERIFICAR y parámetros de fábrica

| Parámetro | Valor | Condición |
| --- | ---: | --- |
| Umbral de arcilla | 0,45 v/v | Lutita solo por encima |
| Inicio de limolita | 0,20 v/v | Debe ser menor que el corte de arcilla |
| Espesor mínimo | 0,5 m | Con excepciones explícitas por barreras |
| Escala del proxy de grano | 1 | Limpio equivale a 1 mm en la hipótesis |
| GR limpio del respaldo | 25 gAPI | Extremo configurable |
| GR arcilloso del respaldo | 125 gAPI | Debe superar al limpio |

Los seis valores y sus rangos de control son **SIN VERIFICAR** como valores
universales. También lo son la dominancia mineral simple y su desempate,
el proxy logarítmico, la moda/fusión en dos pasadas, el factor de hueco tres
y la trama propia de anhidrita. Los límites granulométricos de Wentworth
no verifican la relación propuesta entre grano y respuesta de perfiles.

## Resultados del TP con parámetros de fábrica

Con la cadena mineral activa se obtienen 346 capas, sin capas bajo el mínimo,
y seis clases del proxy: arcilla, limo, arena muy fina, fina, media y gruesa.
No aparecen números no finitos en las tablas de capas. La suma de espesores
coincide con la cobertura por muestras del motor.

| Zona | Litología clasificada | Espesor (m) | Capas |
| --- | --- | ---: | ---: |
| A | Caliza | 91,2876 | 46 |
| B | Caliza | 181,6608 | 75 |
| C | Caliza | 63,8556 | 14 |
| D | Caliza | 277,0632 | 150 |
| E | Caliza | 271,5768 | 61 |
| Pozo completo | Caliza | 885,4440 | 346 |

Las otras siete clases tienen espesor cero en esta corrida. **Este resultado
no confirma caliza en el TP ni constituye una interpretación independiente.**
Hereda los volúmenes de calcita dominantes y los residuos altos de la
inversión de 9c (ver 0026). Antes de usarlo geológicamente deben revisarse
PE, barita/lodo, derrumbes, escala de neutrón y calibración mineral. El
módulo emite un aviso explícito de esa dependencia. El respaldo con GR/Vsh
está probado por separado y permite trabajar cuando falta la inversión.

## Fuentes

- Wentworth, C. K. (1922). A scale of grade and class terms for clastic
  sediments. Journal of Geology 30(5), 377–392.
  DOI: [10.1086/622910](https://doi.org/10.1086/622910).
- USGS, nomenclatura de sedimentos: [límites de grava, arena, limo y
  arcilla](https://pubs.usgs.gov/of/2003/of03-001/htmldocs/nomenclature.htm).
- USGS, Data Series 350, tabla 2: [subdivisiones del tamaño de
  arena](https://pubs.usgs.gov/ds/350/ds350.pdf).
- FGDC/USGS, Digital Cartographic Standard for Geologic Map Symbolization:
  [sección 37, patrones litológicos](https://ngmdb.usgs.gov/fgdc_gds/geolsymstd/fgdc-geolsym-sec37.pdf).
- Rider y Kennedy (2011), The Geological Interpretation of Well Logs,
  3.ª ed.: contexto y limitaciones de interpretación; no fuente de los
  umbrales operativos elegidos.

## Verificación

- Motor y módulo: 14 pruebas enfocadas aprobadas. Incluyen minerales puros,
  corte estricto de arcilla, carbonatos frente a Vsh intermedio, respaldo,
  carbón fino, fusión, conservación de cobertura y promedios, barreras,
  mínimos imposibles, grano monotónico y subbloqueo dentro de caliza uniforme.
- Integración y dibujo: 48 pruebas enfocadas aprobadas, incluidos patrones,
  exportaciones, geometría y suministro de tablas vigentes.
- Suite completa: **2141 pruebas en 128 archivos aprobadas** con
  `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=20000`.
  La corrida con valores por defecto falló por tiempos/rendimiento en cinco
  pruebas previas; con un worker quedaron dos timeouts de 5 s. La corrida
  final amplía solo el timeout de ejecución a 20 s, sin cambiar pruebas ni
  sus umbrales de rendimiento. No se ocultan los fallos de las corridas previas.
- `npm run typecheck` sin errores y `npm run build` generó un único
  `dist/index.html` de 3.254,06 kB (1.198,35 kB comprimido).
- Playwright con Microsoft Edge (Chromium instalado) abrió ese HTML vía
  `file://`, cargó el CSV real del TP desde el asistente y no registró errores
  de consola. Capturas a 1920 × 1200 CSS px, DPR 1,5; detalle 7649,7–7708,0 m.
- Se descargaron e inspeccionaron visualmente una figura SVG de GR + Columna
  (mosaico vectorial reutilizado en 33 rectángulos visibles) y el informe HTML
  autónomo con su imagen del perfil correctamente cargada. La revisión
  independiente examinó las cuatro capturas y la regresión de selección
  transitoria excluida de la exportación.
- Capturas en `docs/capturas/9e/`: `claro-general.png`,
  `claro-detalle.png`, `oscuro-general.png` y `oscuro-detalle.png`.

## Abierto

Edición manual de litología con persistencia y deshacer/rehacer; incorporación
de grano de corona y calibración del proxy; componente mineral y simbología
verificada de anhidrita. Los patrones son simplificados, no una reproducción
cartográfica exacta de FGDC. No se ha validado esta fase en Safari/Firefox
ni mediante interacción táctil.
