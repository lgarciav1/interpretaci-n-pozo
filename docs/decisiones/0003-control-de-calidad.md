# 0003 — Control de calidad de perfiles

- Estado: aceptada (fase 2b)
- Alcance: `src/io/qc.ts` (puro) y su uso en `src/app/` (asistente de carga y panel del pozo).

## Decisiones

- **Puro y sin modificar datos.** `runQc(pozo, opciones)` devuelve un `QcReport`; nunca toca los arrays del pozo. Las marcas
  por muestra viven en `CurveQc.flags` (bits `QC_FLAGS`) y `unreliableMask(reporte, curva)` devuelve un `Uint8Array` nuevo
  (1 = no confiable) para que el visor y los módulos decidan qué hacer. El reporte es derivado: la app lo guarda en un store
  propio (`src/app/store/qc.ts`), no en el proyecto serializado, y lo invalida por identidad del objeto `Well`.
- **Todas las curvas, con rol o sin él.** El rango físico sale del rol (`PHYSICAL_RANGES`, en la unidad canónica: la curva se
  convierte antes de comparar); una curva sin rol con unidad de resistividad (AT10, AT30) usa el rango de RT.
- **Semáforo por curva** = peor severidad de sus razones (`info` no cambia el color). Razones en español con cifras.
- **Picos aislados.** Residuo contra la mediana de los ±3 vecinos (sin la propia muestra; un pico de hasta 3 muestras sigue
  siendo aislado). Es pico si supera 8 × el ruido local robusto (1,4826·MAD de los residuos) **y** 4 × la dispersión de la
  curva (1,4826·MAD de los valores): lo primero evita marcar ruido, lo segundo evita marcar capas finas reales en curvas muy
  suaves (el caliper en calibre tiene ruido local casi nulo). Resistividades y permeabilidad en log10. Las muestras ya
  marcadas (fuera de rango, caliper inválido) no participan.
- **Rachas constantes.** 25 muestras (≈ 3,8 m) de valor idéntico. En el TP las curvas cuantizadas (POTA cada 0,1 %) repiten
  valores en rachas de hasta ~13 muestras sin ser errores. BS (constante por definición), banderas y clases se excluyen.
- **Nulos.** ≤ 5 %: informativo (empalmes, tope/base de herramienta). > 5 %: revisar. > 50 %: mala.
- **Fracciones para 'bad'.** > 5 % de las muestras válidas fuera de rango, > 1 % picos, > 20 % en rachas constantes o con
  caliper inválido.
- **Estado del pozo.** Derrumbe: CALI − BS > 1 in (BS por muestra si existe la curva; si no, 8,5 in configurable). Caliper
  inválido: CALI < 5 in. Los tramos se devuelven como intervalos `[topM, baseM]` (huecos de hasta 2 muestras se unen). Las
  curvas de patín (`PAD_ROLES`: RHOB, PEF, DRHO) quedan marcadas como no confiables en ambos tipos de tramo, porque si el
  caliper es inválido no hay forma de saber si el patín apoyaba.

## Resultado sobre `datos/pozo_tp_perfiles.csv`

| Curva | Semáforo | Por qué |
|---|---|---|
| SP | mala | 12 muestras con dato (0,21 %) |
| CAL | revisar | 189 muestras < 5 in (mínimo 1,098 in) en 2 tramos; rachas constantes de 1,104 y 1,315 in; 71 muestras con derrumbe en 8 tramos |
| NPHI | revisar | 2 muestras de 3,317 v/v fuera de rango; picos; racha de −0,0394 al fondo |
| AT10 | revisar | 2 picos aislados (el mayor 110 ohm·m; P99 6,75) |
| ZDEN, PE | revisar | no confiables en 260 muestras por derrumbe o caliper inválido; PE con 72 muestras > 20 b/e |
| GR, DT, URAN, THOR, POTA, CMR | revisar | rachas de valor constante, todas en el fondo del pozo (8488–8518,55 m): las curvas repiten el último valor en los últimos 4–30 m (fin de registro rellenado) |
| BS, AT30, AT60, AT90 | bien | — |

`datos/README.md` dice que las 189 lecturas inválidas de CAL tienen "un valor constante de 1,098 in"; en el archivo son casi
constantes (1,098 a 1,315 in, mínimo 1,098). Los tests verifican las 189 muestras y el mínimo.
