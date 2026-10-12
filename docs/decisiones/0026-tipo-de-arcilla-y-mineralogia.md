# 0026 — Tipo de arcilla y mineralogía (fase 9c)

- Estado: implementada, pendiente de revisión para integrar.
- Alcance: Geo-2 (`clay-typing`) y Geo-3 (`mineral-inversion`), motor puro
  `src/petro/mineralogy.ts`, plantillas `th-k` y `pe-density`, polígonos x–y y
  columna mineral mediante el contrato existente de pila volumétrica.
- Base: `claude/fase-9b`, commit `14852415703a0d41961c834a6d43fbe078618168`;
  el PR #20 estaba abierto al comenzar. PR destinado a `main`.

## Contexto

El TP contiene POTA (wt%), THOR y URAN (ppm), PE (b/e), ZDEN (g/cm³),
NPHI (v/v) y GR (gAPI). Las regiones del GR espectral son afinidades, no
identificaciones inequívocas: CP-19 tiene campos superpuestos. El modelo de
cinco componentes tampoco cubre todas las litologías ni el lodo con barita.

## D1. Regiones Th–K y contexto Th/U

Se representan ocho regiones: caolinita, clorita, illita, esmectita, micas,
feldespato K, glauconita y capas mixtas. La carta de referencia es Schlumberger
2013 Lith-2, antes CP-19, p. 194. Los sectores de cocientes y manchas se
aproximaron geométricamente: **los vértices se marcan SIN VERIFICAR** hasta
una digitalización y revisión de la carta. Los rótulos y el panel advierten
esta limitación. Quirein et al. (1982), fig. 2, motiva la lectura conjunta,
pero no respalda ocho fronteras exactas excluyentes.

La clasificación conserva todos los candidatos de mínima distancia. Dentro
de campos superpuestos, devuelve como representante el de menor área; mantiene
la bandera de ambigüedad. Fuera de las regiones devuelve la más cercana y su
distancia euclídea normalizada a 6 wt% en K y 30 ppm en Th. El origen 0–0 y
entradas negativas o ausentes quedan sin clasificación. Clase 1–8; sin dato,
NaN. La tabla informa afinidad dominante, porcentaje ambiguo y exterior.

Th/U se interpreta por muestra: <2 compatible con medio marino/reductor,
2–7 transicional, >7 compatible con continental/oxidante. Adams y Weaver
(1958) es la referencia; **la página original de los límites 2 y 7 no se
cotejó**, y por eso se marcan SIN VERIFICAR. U≤0 no produce infinito: queda
sin cociente. Uranio >5 ppm es una alerta operativa ajustable por zona,
SIN VERIFICAR como límite bibliográfico; no diagnostica TOC ni MFS.

La pista U alto es una superposición autodescubierta de Geología. Los resúmenes
son tablas ocultas al panel genérico para evitar duplicar información.

## D2. PE–densidad y referencias minerales

Puntos de cuarzo, calcita, dolomita, anhidrita, yeso, halita, barita, siderita,
pirita, cuatro arcillas y carbón. Fuente: Schlumberger 2013, Appendix B,
pp. 279–280. Se emplean **respuestas de densidad del registro**, no densidades
físicas del mineral. Neutrón en escala CNL caliza; debe verificarse la escala
del registro importado. Las arcillas son endmembers variables.

El fluido por defecto es agua dulce. Las mezclas son lineales en densidad y
absorción volumétrica U = PE·ρe; al pasar a PE se dibujan curvas y marcas cada
0,1 v/v hasta 0,4. La densidad electrónica se calcula mediante la calibración
afinada ρe=(ρlog+0,1883)/1,0704, documentada por Yu et al. (2020), ec. (2).
Los U tabulados se conservan como `tabulatedU`, separados del U del modelo.
La conversión afín aproxima la densidad electrónica; para montmorillonita da
U≈4,313 frente a Utab=4,0. La diferencia no se atribuye a simple redondeo.
Forward e inverse usan la misma aproximación; se pueden calibrar rho y PE.

La plantilla tiene un rango principal y una acción «Ver todos los minerales»
para referencias con PE y densidad mayores, especialmente barita y pirita.

## D3. Inversión restringida y pesos

Incógnitas bulk: cuarzo, calcita, dolomita, arcilla y porosidad. Cuatro
observaciones: densidad, U fotoeléctrico, neutrón y GR. Se minimiza la suma
de residuos ponderados y normalizados, con no negatividad y cierre exacto.
Las escalas prácticas son 0,1 g/cm³, 1 unidad de U, 0,05 v/v y 20 gAPI;
no son errores de fabricante ni incertidumbres calibradas.

Se enumeran las 31 caras del simplex. En cada cara se resuelve el sistema KKT
por eliminación con pivoteo parcial; se descartan soluciones negativas y se
elige el objetivo mínimo. Se comprueba rango de las cuatro respuestas más
cierre; no se publica una solución subdeterminada si falta una herramienta o
un peso no es positivo. Las matrices de las caras se preparan una sola vez
por segmento de parámetros para mantener fluido el recálculo de 5.810 muestras.
No hay caché mutable global ni efectos en entradas.

Cada herramienta tiene un peso configurable por zona mediante el formulario
de sliders existente, con mínimo 0,1. Arcilla seleccionable: illita, caolinita,
clorita o esmectita. Densidad, PE, respuesta neutrónica y GR de cada arcilla son ajustables por
zona, con cuatro controles para la arcilla seleccionada y presets independientes.
Cambiar de arcilla conserva las calibraciones de las otras. GR limpio, densidad
y PE del fluido también son ajustables por zona. Por defecto: illita, GR 275 gAPI (punto medio del intervalo
250–300 de Appendix B), GR limpio 0, fluido ρ=1 y PE=0,36.

Se publica un residuo normalizado por muestra, además de los residuos por
herramienta en el motor puro. El umbral de aviso es operativo y ajustable;
se avisa sobre residuos altos y neutrón fuera del rango operativo. Un ajuste
con cierre y sin negativos **no garantiza compatibilidad con la geología**.

## D4. Integración mínima

Dos carpetas y registros en `src/modules/index.ts`. La pista mineral se registra
con `src/modules/mineral-inversion/overlay.ts`, descubierto por el glob de
superposiciones existente. El visor **no importa módulos**.

El punto de extensión genérico `OverlayTrackDecl.spec` permite aportar un
`TrackSpec` declarativo; `contributedTrack` lo resuelve y la pila nativa lo dibuja
con su leyenda, cursor y exportación. El catálogo recibe esas aportaciones
como datos desde la app, sin conocer nombres de módulos. Se evita duplicar
una pista aportada que ya está guardada y se respeta `track.resolve` sin entradas.
El botón «Ver columna mineral» utiliza la misma pista. Se conserva la columna
tradicional `special:volumetric` y las fuentes VSH/PHIE/Sw: no se altera pay ni
volumetría de reservas.

Única ampliación de `src/core`: dos ids en `CROSSPLOT_TEMPLATES`, necesarios
para guardar y sanear las plantillas nuevas. No cambia el formato de proyecto.
La extensión de pistas es genérica en `viewer/overlay.ts` y `viewer/templates.ts`;
no se modifica el renderizador ni el estado del núcleo. El import de un módulo
en `viewer/catalog.ts` se eliminó en la revisión.

XYPolygonLayer es una capa pequeña genérica de contorno y relleno, usada por
el mismo dibujo de pantalla y figuras SVG/PNG/PDF. Se dibuja detrás de los
puntos. No se agregan ecuaciones a los paneles: quedan en ModuleDocs.

## D5. Fuentes y valores pendientes

- Vértices Th–K, recorte y separación de campos superpuestos: SIN VERIFICAR.
- Límites Th/U 2 y7 respecto de la página original de Adams y Weaver: SIN VERIFICAR.
- Umbral de uranio 5 ppm: SIN VERIFICAR; criterio operativo, configurable.
- GR limpio 0 para minerales limpios: SIN VERIFICAR como respuesta universal;
  hipótesis ajustable, no valor atribuido al libro.
- PE agua 0,36 y NPHI agua 1: SIN VERIFICAR página primaria; hipótesis de fluido
  fresco. Densidad agua 1 está respaldada por Lith-3 p. 196.
- GR de arcillas: punto medio del intervalo de Appendix B, decisión de modelo.
- Matriz/escala exacta de NPHI del TP: no especificada en el CSV; CNL caliza
  es supuesto y se informa en las advertencias del motor.

Fuentes:

- Schlumberger (2013), Log Interpretation Charts, Lith-2 p. 194, Lith-3 p. 196,
  Appendix B pp. 279–280: https://www.spec2000.net/downloads/SLB%20Chartbook%202013.pdf
- Quirein, Gardner y Watson (1982), SPE 11143, fig. 2 y ecs. 6–16.
- Adams y Weaver (1958), AAPG Bulletin 42(2),387–430,
  DOI 10.1306/0BDA5A89-16BD-11D7-8645000102C1865D.
- Yu et al. (2020), Nuclear Science and Techniques 31:124, ec.2,
  DOI 10.1007/s41365-020-00826-2: https://www.nst.sinap.ac.cn/article/id/5292
- Lawson y Hanson (1974), Solving Least Squares Problems, cap. 23.

## Resultados del TP con parámetros de fábrica

| Zona | Afinidad Th–K | Th/U medio | Cuarzo % | Calcita % | Dolomita % | Arcilla % | Porosidad % | Residuo |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | Capas mixtas | 4.32 | 0.04 | 90.61 | 0.00 | 5.58 | 3.77 | 7.63 |
| B | Capas mixtas | 3.46 | 0.00 | 75.03 | 0.00 | 15.20 | 9.76 | 2.79 |
| C | Capas mixtas | 3.30 | 0.00 | 77.15 | 0.00 | 17.82 | 5.03 | 3.18 |
| D | Capas mixtas | 3.10 | 0.00 | 81.50 | 0.00 | 11.39 | 7.11 | 3.28 |
| E | Capas mixtas | 3.32 | 0.00 | 74.32 | 0.00 | 19.22 | 6.47 | 2.40 |

5.810 muestras con inversión finita y cierre; todos los volúmenes ≥0.
**Los residuos medios son altos:** la abundancia de calcita obtenida es el
mejor ajuste del modelo limitado, no una confirmación de caliza en el TP.
Revisar el PE (por ejemplo, 16,951 b/e en la primera fila), barita/lodo,
derrumbes y escala del neutrón antes de usar los volúmenes. No se corrigieron
ni ocultaron datos originales. Se mantienen los avisos y el residuo visible.

## Verificación

- Tests puros: extremos, tres mezclas resueltas a mano, cierre/no negatividad,
  cuatro arcillas, pesos, límites, superposición, exterior y CSV completo.
- Tests de integración: tablas por cinco zonas, overrides U por zona,
  columna apilada y exportación de polígonos SVG.
- Revisión independiente:8.000 observaciones contrastadas con el sistema KKT
  anterior; máximo Δvolúmenes 7,08×10⁻¹³. Comparación adicional con SciPy SLSQP;
  sin bloqueantes después de corregir el desempate de glauconita.
- `npx vitest run`: 117 archivos, 2.061 pruebas aprobadas.
- `npx tsc --noEmit`: sin errores.
- `npm run build`: un único `dist/index.html`, 2.479,03 kB sin comprimir.
- Capturas Chromium en `docs/capturas/9c/`, claro y oscuro, pozo del TP.

## Abierto

Digitalizar y revisar CP-19 con precisión, confirmar límites Th/U y PE del
fluido, comprobar matriz del neutrón del TP y calibrar extremos con corona.
El ajuste no incorpora gas, barita, evaporitas ni metales como componentes.
No se ha probado esta fase en Safari/Firefox ni con entrada táctil.


## Revisión de los cuatro puntos del PR #21

Se inspeccionó visualmente Appendix B, edición 2013, páginas impresas 279–280
(PDF 291–292). La columna es **ρlog**, dentro de «Logging Tool Response in
Sedimentary Minerals»; no densidad de grano seco. Por eso se mantienen los
extremos de esa edición y se fija su valor en tests.

| Mineral/fila | Valores del PR anterior → revisión | Fuente exacta |
| --- | --- | --- |
| Illite | ρ 2,77 →2,77; PE 2,33 →2,33; φCNL 0,30; Utab 6,45 agregado | SLB 2013 Appendix B p. 280, columnas ρlog, Pe, U, φCNL |
| Kaolinite | ρ 2,62 →2,62; PE1,48 →1,48; φCNL 0,37; Utab 3,87 agregado | Misma página y columnas |
| Montmorillonite | ρ 2,12 y PE 2,0 conservados; Utab 4,0 separado de Umodelo≈4,313 | Misma página, fila Montmorillonite |
| Anthracite | PE 0,16 →0,16; Utab 0,23 agregado; lignito tiene PE 0,20 | Misma página, filas Anthracite y Lignite |
| Orthoclase | Sin referencia →ρ 2,52, PE 2,9, Utab 7,2, φCNL−0,03, GR≈220 | SLB 2013 Appendix B p. 279, fila Orthoclase |

PE 2,9 es la precisión publicada para ortoclasa en la edición verificada; no
se inventan dos decimales para asignar 2,86 a esa fuente. Los valores clásicos
alternativos del brief no se atribuyen a esta página. Los controles nuevos
permiten adoptar y calibrar extremos diferentes con la fuente elegida por el
intérprete. GR es el centro del intervalo de arcilla; φCNL se convierte de p.u.
a v/v. La tabla avisa que las arcillas son valores medios variables por muestra.

La revisión independiente de los overrides comprobó 10.000 mezclas,
cuatro arcillas y 100 calibraciones: error máximo de volúmenes 2,65×10⁻¹³,
sin inválidas. `rhoE` se recalcula cuando cambia la densidad de arcilla;
`tabulatedU` es referencia documental y no entra en la matriz del ajuste.
