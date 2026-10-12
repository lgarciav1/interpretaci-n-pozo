# 0023 — Calibración con corona (fase 8, función N)

- Estado: aceptada (fase 8).
- Alcance: carpeta `src/modules/core-calibration/` (módulo del motor `core-calibration`: curva `RHOMAA`, tabla y valor
  por zona; `model.ts` puro del panel; `dock.tsx` con el panel «Calibración»), rol `RHOMAA` en `src/core/roles.ts` y su
  color en `src/ui/curves.ts`, columna opcional `ff` (factor de formación) de los plugs en `src/io/core.ts` y en el
  ejemplo sintético (`src/modules/core/example.ts`).
- Se apoya en el motor puro ya revisado `src/petro/coreCalibration.ts` (sin cambios de API), en 0010 (plugs como
  conjunto de puntos, `shiftedDepth`, «Aplicar al pozo») y en 0015 (`PLOT_PARAMS`, alcance y redondeo de un parámetro
  elegido fuera del inspector). Sin cambios en el núcleo ni en el formato del proyecto.

## Contexto

El plan pide «ajuste de las curvas de perfil contra corona (φ perfil vs. φ corona, densidad de matriz, exponente m),
sobre la base del módulo obligatorio de datos de corona; incluye la densidad de matriz aparente (ρmaa) por muestra con
su histograma y valor por zona». Las preguntas: dónde vive cada cálculo (el motor no ve los plugs, 0009 D1), qué
porosidad entra en ρmaa, cómo se ubica cada plug contra el perfil sin duplicar la puesta en profundidad y cómo llega
lo calibrado a la cadena (ρma de `phi-density`, m de Archie y sus variantes).

## D1. Una carpeta: módulo del motor para ρmaa, panel del dock para lo que usa plugs

- **`RHOMAA` es una curva del motor** (módulo `core-calibration`, categoría Porosidad): por muestra, con su tabla por
  zona y su valor por zona. Así la ven el visor (pista recolectora «Interpretación» y el catálogo de «Armar pistas»),
  el histograma y el crossplot libres, la exportación y Resultados, sin código nuevo en ninguno.
- **Lo que necesita plugs se calcula en el panel** (el worker no tiene puntos ni tendencias). Igual que el modelo k–φ
  de 0010 D4: el panel muestra y el usuario aplica parámetros al motor con un botón (una receta, un Ctrl+Z).
- Alternativa descartada: un módulo del motor que reciba los plugs como tabla. Obligaría a sincronizar los conjuntos de
  puntos con el worker (0009 lo evitó a propósito) y a recalcular la cadena con cada plug que se incluye o descarta.

## D2. Porosidad de ρmaa: PHIT (densidad–neutrón), con aviso de circularidad

ρmaa = (ρb − φ·ρf)/(1 − φ) es la matriz que haría coincidir la porosidad densidad con una porosidad INDEPENDIENTE φ.

- **PHIT y no PHIE.** La definición de libro usa la porosidad del crossplot densidad–neutrón, que es total (Asquith y
  Krygowski 2004, cap. 4; Clavier y Rust 1976 para el MID plot). Con PHIE el agua ligada de la arcilla contaría como
  matriz y ρmaa saldría corrida en todo tramo arcilloso. Por eso la entrada es el rol `PHIT` y, para leer «la matriz»,
  el valor por zona solo usa muestras limpias (D3).
- **Circularidad.** Si en un tramo PHIT sale solo de la densidad (método «Densidad», o «Automático» sin neutrón), ρmaa
  devuelve la ρma de `phi-density` y no informa nada. El módulo toma `PHID` como entrada opcional y avisa por zona si
  PHIT ≡ PHID en todas las muestras con dato.
- **ρf es un parámetro propio** (`core-calibration.rhoFl`, por zona, 1,00 g/cm³) y no el de `phi-density`: compartirlo
  cambiaría la clave guardada de ese módulo (proyectos ya guardados). El panel avisa si los dos difieren.

## D3. Valor por zona: mediana y P10–P90 de las muestras limpias

`summarizeByRanges` sobre las zonas con la máscara `VSH ≤ Vsh máx.` (parámetro por zona, 0,30 por defecto; sin VSH se
usan todas y se avisa). Mediana y no media: ρmaa tiene colas largas en derrumbes, carbones y gas. Tabla
`RHOMAA_ZONES` (n, mediana, P10, P90, media, desvío, una fila «Pozo completo») y valor por zona `RHOMAA_ZONE`
(mediana). P10 = percentil 10 de la distribución (no la convención de reservas).

## D4. Plug contra perfil: profundidad corregida del núcleo y ventana ±h

- Cada plug se ubica con `shiftedDepth(set, decisiones)`: la puesta en profundidad es la del panel «Corona». El
  panel de calibración nunca recalcula ni guarda desplazamientos; muestra el de cada corona y, si ninguno se aplicó,
  avisa que la calibración se hace sobre la profundidad del archivo.
- Solo plugs incluidos (`plugStatuses`). Valor del perfil con `matchLogToPlugs`: ventana ±h (por defecto 0,15 m, ≈ la
  resolución vertical de densidad–neutrón; 0 = interpolación lineal), guardada en los ajustes del conjunto
  (`calibWindow`) junto con la curva elegida (`calibCurve`; por defecto la de la puesta en profundidad,
  `MATCH_CURVE_SETTING`).

## D5. φ perfil vs. φ corona: 1:1, RMA y OLS con sesgo, RMSE y R²

Crossplot del gráfico x–y base (perfil en x, corona en y) con la recta 1:1, la RMA (eje mayor reducido, la que
preserva la dispersión: ambas variables tienen error) y la OLS (la de mínimo error para predecir), n, sesgo
perfil − corona, RMSE y R². R² mide la correlación lineal, no la cercanía a la 1:1: por eso se muestran el sesgo y el
RMSE juntos. Es diagnóstico: no se aplica una corrección de φ a la cadena (eso sería un módulo nuevo; queda abierto).

## D6. Densidad de matriz: tres estimaciones, un botón

- Densidad de grano de los plugs incluidos (mediana, P10–P90): grano ≈ matriz en areniscas limpias.
- ρma que iguala φD con φ corona en mínimos cuadrados (`matrixDensityMatchingCore`, solución cerrada) con la ρb del
  perfil en los plugs y la ρf vigente de `phi-density` (la que usará esa ρma), acotada a 2,5–3,0 g/cm³ con aviso.
- ρmaa del perfil por zona (la tabla del motor) e histograma de ρmaa de la zona con las otras dos como guías.
- «Aplicar ρma»: elige la estimación y el alcance (todo el pozo o una zona) y escribe `phi-density.rhoMa` redondeado al
  paso del slider (`normalizeParam`). Una sola receta. Indicador «aplicado» si el valor vigente coincide.

## D7. Exponente m: desde F de los plugs o desde Rt en una zona acuífera

- **Con F en los plugs** (columna `ff`, nueva y opcional en el lector: FF, «factor de formación»…): `fitCementationExponent`
  con a fija (la a vigente de Archie) y con a libre (n ≥ 3). «Aplicar m» escribe m; «Aplicar a y m» escribe las dos.
- **Desde el perfil**, en una zona que el usuario declara acuífera (por defecto las zonas acuíferas del Pickett,
  `pickettWaterZones`, 0021): m por muestra = ln(a·Rw/Rt)/ln φ con la Rt y la Rw vigentes (curvas activas: Rw ya
  corregida por temperatura) y PHIE, solo en muestras limpias (Vsh ≤ Vsh máx.), con mediana y P10–P90; además el ajuste
  por mínimos cuadrados de F = Rt/Rw. Se aplica la mediana (robusta: el error de Rt y φ se amplifica por 1/ln φ).
- Gráfico log–log de F contra φ: plugs, nube de la zona acuífera, la recta vigente y las ajustadas.
- Alternativa descartada: ajustar m sobre el Pickett. Ya existe (0021) y estima m y Rw a la vez; acá Rw es la vigente y
  solo se calibra m, que es lo que pide la función N.

## D8. Ejemplo sintético

Los plugs de ejemplo suman la columna `ff` con F = 1/φ^1,85 y ruido log-normal (σ = 0,03 en log10) generado con OTRA
semilla, de modo que φ, k, ρg y las profundidades del ejemplo no cambian. Así el panel muestra las dos vías de m con
el pozo de demostración, y la de plugs recupera m ≈ 1,85.

## Abierto

- Corrección de φ perfil → corona aplicada a la cadena (un módulo `PHIE` alternativo con la RMA por zona).
- ρma por litofacies o por capa (hoy global o por zona).
- Ensayo de Ro con salmuera distinta de la de formación (hoy se carga F ya calculado).
