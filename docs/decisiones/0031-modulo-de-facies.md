# 0031 — Módulo de facies: litología sugerida por random forest y electrofacies (fase 10c)

- Estado: implementada (10c-1 y 10c-2), pendiente de revisión para integrar.
- Alcance: módulos `lithology-facies`, `electrofacies` y `electrofacies-scan`; pistas «Litología (ML)» y
  «Electrofacies» del espacio Geología; paneles de importancia y de elección de k; plugin de build `workerOnlyFiles`.
- Base: fase 10b (`src/ml/`, decisión 0030): random forest FORCE 2020 embebido en dos variantes (con y sin PE),
  electrofacies por k-means y mezcla gaussiana, importancia MDI.

## Contexto

La 10b dejó el modelo entrenado y testeado, pero sin interfaz. Faltaba llevarlo al flujo con el contrato de módulo, con
el cálculo en el Web Worker, y mostrar la salida como lo que es: una **sugerencia con probabilidad** de un modelo
entrenado en otra cuenca (Mar del Norte), no una litología medida (0030, D10). El pozo del TP tiene el PE sospechoso de
baritina (0029), así que el modo automático usa el modelo sin PE.

Dos restricciones técnicas condicionan el diseño: el modelo embebido pesa ~1,36 MB de texto, y `compute` es sincrónico
y se ejecuta también en el hilo principal (el registro lo importan unas veinte pantallas, y el motor en proceso es el
respaldo si el worker no arranca).

## D1. Módulos y categoría

- `lithology-facies`: entradas por rol, todas opcionales (GR, RHOB, NPHI, PEF, DT, RT; sin caliper, que ninguna variante del modelo usa). Parámetros «Uso del PE»
  (automático / usar siempre / ignorar, misma regla que la inversión mineral) y «Probabilidad mínima». Salidas: clase
  ganadora como índice FORCE 0–11 (`LITH_ML`), su probabilidad (`LITH_ML_P`), la segunda y tercera clase con sus
  probabilidades (`LITH_ML_2`, `LITH_ML_P2`, `LITH_ML_3`, `LITH_ML_P3`), resumen por clase (`LITH_ML_SUMMARY`) e
  importancia (`LITH_ML_IMPORTANCE`, oculta). Avisos: motivo de la variante, advertencia de transferencia de cuenca,
  curvas que el modelo usa y faltan, fracción sin dato.
- `electrofacies`: método (mezcla gaussiana / k-means) y k (automático o 2–8). Salidas `EF`, `EF_P` y la tabla de
  grupos con su centro en unidades de campo.
- `electrofacies-scan`: sin parámetros; BIC e inercia para k = 2…8 (`EF_SCAN`, oculta). Va aparte para que cambiar k o
  el método no repita el barrido (el motor cachea por módulo) y para que `electrofacies` en modo automático tome el k
  sugerido como entrada de tabla.
- Categoría `lithology`, espacio Geología: entran en el paso «Litología y mineralogía», que estaba vacío. Aceptado por
  la usuaria frente a la alternativa `geology` (paso «Lectura geológica», junto a la columna).

Las clases se publican por índice FORCE canónico, no por columna del modelo: la pista y el panel resuelven colores y
rótulos sin conocer el modelo.

## D2. El modelo solo en el worker (`*.worker-only.ts`)

El módulo importa `./predict.worker-only`. En el build, el plugin `workerOnlyFiles` de `vite.config.ts` reemplaza en el
bundle del hilo principal todo `<x>.worker-only(.ts)` por `<x>.main-thread.ts` (misma API, sin el modelo). Los plugins
de `plugins` no se aplican al bundle del worker (ese usa `worker.plugins`), así que el worker recibe el archivo real.
En desarrollo y en Vitest se usa el archivo real en los dos lados. El plugin compara el archivo resuelto (no el texto
del import) y la convención, genérica para otros módulos, está en `docs/arquitectura.md` («Archivos solo-worker»);
`tests/worker-only.test.ts` exige el par con la misma API y que el modelo solo se importe detrás de un `*.worker-only.ts`.

Respaldo: si el worker no arranca y el motor corre en proceso, el sustituto devuelve `null`; el módulo avisa
(«recargá la página») y la pista muestra «Sin litología sugerida». La importancia sale del mismo par
(`faciesImportance`), por eso viaja como tabla del motor y no como constante del hilo principal.

| Build (`dist/index.html`) | Total | Hilo principal | Worker incrustado |
|---|---|---|---|
| Antes de la 10c | 3.245 kB | 2.974 kB | 261 kB |
| 10c-1 con el plugin | 4.632 kB | 2.987 kB | 1.636 kB |
| 10c-1 sin el plugin | 5.996 kB | modelo duplicado | — |
| 10c-2 | 4.682 kB | +≈50 kB entre los dos (paneles, pista y módulos de electrofacies); el modelo sigue solo en el worker | |

Descartado: `import()` dinámico dentro de `compute` (el contrato es sincrónico y el build de archivo único incrusta los
chunks dinámicos igual); inyectar el modelo desde `engine.worker.ts` (un módulo nuevo tendría que tocar un segundo
punto de composición); una constante `__WORKER__` con tree-shaking (frágil: depende de que el empaquetador elimine el
módulo del modelo).

## D3. Pista «Litología (ML)»

Escala horizontal de probabilidad 0–1. Por muestra se apilan desde la izquierda la clase ganadora (ancho = su
probabilidad, opaca), la segunda (42 % de opacidad) y la tercera (22 %). Se lee igual que un relleno de perfil: el
color dice qué, el ancho dice cuánta confianza. Una vertical rayada marca la probabilidad mínima.

- **Atenuación por umbral:** si la ganadora está bajo la probabilidad mínima se dibuja al 50 %.
- **Atenuación por clase:** Arenisca/Lutita, Marga, Dolomía, Creta, Toba y Basamento (F1 < 0,25 en leave-one-well-out
  sin PE, 0030-métricas) se atenúan siempre y el tooltip lo dice. No se ocultan: la probabilidad sigue a la vista.
- **Sin dato:** gris de grilla a todo el ancho, nunca una clase.
- **Escala de pozo:** si cada muestra mide menos de 1 px, una fila por píxel con la probabilidad media de las muestras
  (sumando las tres clases publicadas). El borde de la ganadora se traza como curva fina solo con ≥ 2 px por muestra:
  más comprimida serruchaba y tapaba los colores (10c-1).
- **Rótulos y tooltip:** pastilla con el nombre en bloques de ≥ 20 px; tooltip con las tres clases más probables y
  «sugerencia del modelo, no medida».
- **Colores:** de `FILL_PALETTE`, los mismos de la columna sedimentológica (arenisca amarilla, lutita gris parda, caliza
  azul, dolomía violeta, anhidrita rosa, sal celeste, carbón negro). Se sumaron al sistema de diseño marga
  (verde-gris), creta (casi blanca), toba (naranja) y basamento (rojo); Arenisca/Lutita es la mezcla. Contraste mínimo
  1,25 contra el fondo de pista en los dos temas. La lutita queda en el gris pardo de la paleta (no gris verdoso) para
  coincidir con la columna de al lado; aceptado.
- **Ubicación:** tras «Litología»; por el orden alfabético de inserción quedan Mineralogía, Columna, Litología (ML) y
  Electrofacies.

## D4. Probabilidad mínima por defecto: 0,4

Con 12 clases, la probabilidad media de la ganadora en el TP es 0,556. Con 0,5 quedaba marcado como incierto el 38 %
del pozo y la pista se veía casi toda atenuada, lo que diluye la señal. 0,4 marca lo que de verdad está repartido entre
dos o tres clases (típicamente Arenisca/Lutita y los carbonatos) y deja legible el resto. Es un parámetro: el usuario lo
sube si quiere ser más estricto.

## D5. Importancia

Panel con barras horizontales de la importancia por impureza (MDI) guardada en el modelo de la variante usada, con la
variante y su motivo. Se rotula como «cuánto usa el bosque cada curva, no cuánto acierta en este pozo».

La importancia por permutación sobre el pozo quedó fuera: sin litología medida del TP no hay verdad contra la cual
medir exactitud, y una «estabilidad de la predicción» (cuánto cambia la clase al permutar cada curva) costaría una
predicción completa por curva y repetición en el worker para una lectura muy parecida a la MDI. Se puede sumar como
botón bajo demanda si la cátedra aporta corona o interpretación del TP.

## D6. Electrofacies

- Agrupamiento sin etiquetas con GR, densidad, neutrón, sónico y log10 de la resistividad (sin PE, por baritina, ni
  caliper), semilla fija (resultado reproducible). Grupos numerados de menor a mayor GR del centro.
- **k sugerido:** mínimo interior del BIC si existe; si no, el codo («kneedle»: punto más alejado por debajo de la cuerda
  con los ejes normalizados). En el TP el BIC baja hasta k = 8 sin mínimo, por eso el codo. Con k-means se aplica solo el
  codo a la inercia (un mínimo interior sería un óptimo local de k-means, no una señal).
- **Costo:** el barrido completo (GMM + k-means, 7 k cada uno) sobre 5810 muestras llevaba 1,7 + 0,5 s y demoraba el
  primer cálculo del pozo. Se ajusta sobre ~2000 muestras equiespaciadas (≈ 0,7 s); con todas, el codo del GMM se corre
  de 4 a 5 en el TP: el sugerido es orientativo.
- **Pista «Electrofacies»:** color categórico del sistema de diseño (`CATEGORICAL`) en orden fijo, a propósito no
  litológico; opacidad en cuatro niveles según la pertenencia; tooltip con el centro del grupo y «grupo de respuesta, no
  litología».
- **Panel:** barras por k (alto = cuánto baja el BIC o la inercia respecto del peor k), el sugerido rotulado, el k en uso
  resaltado; tocar una barra fija k, «Usar el sugerido» vuelve a automático. Tabla de grupos con proporción,
  pertenencia media y centro.

## Resultados en el pozo del TP

- Variante: sin PE (PE sospechoso en el 96 % de las muestras). 5810 de 5810 muestras con predicción. Cómputo del módulo
  ≈ 120–140 ms en el worker.
- Litología sugerida: Arenisca 46,7 % (probabilidad media 0,59), Lutita 37,8 % (0,58), Arenisca/Lutita 12,0 % (0,39),
  Caliza 2,2 % (0,39), Marga 1,3 % (0,35). Probabilidad media de la ganadora 0,556.
- Importancia MDI (sin PE): GR 0,33, neutrón 0,18, sónico 0,18, densidad 0,17, log10 resistividad 0,13.
- Electrofacies: k sugerido 4 con GMM y 5 con k-means. GMM, k = 4: EF 1 58 % (GR 65, ρb 2,39), EF 2 2 % (φN −0,04:
  neutrón anómalo, coincide con un problema de calidad conocido del TP), EF 3 8 % (GR 85, φN 0,29), EF 4 32 % (GR 97,
  ρb 2,51). Pertenencia media > 0,96.
- Motor completo con el pozo del TP: «Listo · ≈ 1,8 s» en el navegador (antes ≈ 0,5 s; la diferencia es casi toda el
  barrido de k y se paga una vez por pozo).

## Límites

- **Transferencia de cuenca:** las métricas de 0030 son del Mar del Norte; la transferencia al TP no está medida.
- **Probabilidades no calibradas:** miden acuerdo entre árboles, no frecuencia real; el umbral es de lectura, no de
  decisión.
- Las electrofacies dependen de las curvas y de su calidad: un tramo con una curva mala forma su propio grupo (EF 2).

## Pendiente

- Permutación bajo demanda (D5) y calibración isotónica de probabilidades (0030, punto 4) cuando haya datos del TP.
- Comparar litología sugerida, electrofacies y columna por zona en una sola tabla.
- Los títulos de pista largos se recortan con el ancho mínimo de pista del visor (afecta a todas las pistas propias).
