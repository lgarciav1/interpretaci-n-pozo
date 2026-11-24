# 0055 — Swi desde datos SCAL de presión capilar (tarea 8 de la consigna)

Fecha: 2026-11-01. Rama de trabajo del agente, sin integrar. Consigna: «Analizar los datos de SCAL, para ajustar Swi y k».

## Decisión

Se agrega el módulo `swi-pc` («Swi desde presión capilar (SCAL)», categoría Saturación, espacio Petrofísica) sobre el motor puro `src/petro/swiPc.ts`. Calcula una curva `SWI` en el pozo con la ley de potencia de la planilla de la cátedra,

Swi = A · (√(k/φ%))^B / 100,  con k en mD, φ en porcentaje y Swi en fracción,

con uno de los seis niveles de presión capilar de la hoja SCAL o con A y B manuales, y la compara con la Sw calculada.

- **Entradas:** `PERM` y `PHIE` obligatorias, `SW` opcional. Sin Sw se calcula Swi igual; la bandera queda sin dato y el módulo avisa.
- **Parámetros (todos por zona):** nivel (seis niveles de la cátedra y «Manual»), A y B manuales, tolerancia de la bandera. El nivel por defecto es el 6 (mayor presión capilar, menor Swi): es la cota inferior, y por debajo de ella una Sw es sospechosa con cualquier nivel.
- **Salidas:** curva `SWI` (rol nuevo, v/v, paleta de los roles de saturación, escala 1 → 0 como `SW`), curva bandera `SW_LT_SWI` (1 si Sw < Swi − tolerancia, 0 si no, sin dato si falta Sw o Swi; tolerancia de fábrica 0,02 v/v, del orden de la incertidumbre de Sw) y tabla `SWI_ZONES` por zona: nivel y coeficientes, muestras con Swi, Swi medio, Sw medio, porcentaje de muestras con Sw < Swi y porcentaje fuera del rango de las muestras de la cátedra.
- **Visor:** `SWI` se dibuja punteada sobre `SW` en la pista «Porosidad · Sw» de fábrica (`BUILTIN_LAYOUTS.petrophysics`); la bandera queda como curva calculada disponible en el catálogo de pistas, sin pista propia.
- **Motor `src/petro/swiPc.ts`:** `rootKOverPhi`, `swiPowerLawRaw`, `swiPowerLaw`, `swiFromPermPhiInto`, `SWI_CATEDRA_LEVELS`, `SWI_SCAL_ROOT_RANGE`, `fitSwiPowerLaw` (regresión log–log, reutiliza `fitTrend` potencial: A, B, R², n, RMSE; `null` con menos de 3 puntos o varianza cero), `fitDisplacementPressure` (Pd = c·x^−d sobre la tabla de presión de desplazamiento) y `swBelowSwiFlag`.

### Criterios

- **Dominio y recorte.** `rootKOverPhi` da NaN con k ≤ 0 o φ fuera de (0, 1]. `swiPowerLaw` da NaN fuera de dominio (x ≤ 0, A ≤ 0, parámetros no finitos: no hay dato) pero RECORTA a [0, 1] un resultado mayor que 1: una roca muy cerrada tiene Swi → 1 (toda el agua irreducible) y ese es el valor físico límite, no un dato faltante. El módulo avisa cuántas muestras se recortaron por zona.
- **Unidad de x.** La planilla calcula √(k/φ) con φ en porcentaje. La tabla de presión de desplazamiento del mismo archivo trae una «raíz» 10 veces mayor (φ en fracción): se verificó muestra por muestra (`tests/petro-swi-pc.test.ts`). Por eso el ajuste de Pd es genérico en x y no comparable con A.
- **Coeficientes.** Los seis (A, B) se toman como dato. *Corregido en la 0087:* las celdas no traen las curvas de presión capilar por muestra, pero los gráficos de la hoja sí (copia guardada en el gráfico). Con ellas se reconstruyó la presión mercurio–aire de cada nivel (28 · 70 · 123 · 246 · 352 · 700 kg/cm²), que ahora va en el rótulo. Las alturas siguen sin calcularse.
- **Rango de validez.** Los coeficientes están respaldados por las 8 muestras de la cátedra (√(k/φ%) de 0,366 a 1,9955). Fuera de ese rango son extrapolación; la tabla informa el porcentaje de muestras fuera, sin avisar (el módulo corre por defecto en cualquier pozo con PERM y PHIE).
- **La planilla.** La celda de √(k/φ) tiene una referencia rota (`#REF!`); la fórmula de Swi es válida y es la implementada.

## Qué cubre la tarea 8

- Curva Swi en el pozo desde PERM y PHIE (los k y φ del perfil) con los seis niveles de la cátedra o coeficientes propios.
- Comparación con la Sw calculada: bandera por muestra y tabla por zona (Swi medio, Sw medio, % con Sw < Swi).
- Ajuste de ley de potencia (log–log) con A, B, R², n y RMSE, disponible en el motor para Swi y para la presión de desplazamiento.
- Análisis de la presión de desplazamiento de la cátedra contra √(k/φ): Pd = 27,96·x^−1,189 (x con φ en fracción; n = 8, R² log–log = 0,43, RMSE 1,09 kg/cm²; numpy, `scripts/qa/swi-pc-reference.py`). El R² bajo es una propiedad de los datos: hay valores de Pd repetidos entre pares de muestras y mucha dispersión a igual x.
- Casos de prueba: valores de mano y de numpy, ida y vuelta del ajuste (±1e-9), dominio, recorte, el módulo con el motor (bandera, zonas, Sw ausente, valores fuera de dominio) y el pozo del TP.

## Qué NO cubre

- No hay en la interfaz un ajuste de coeficientes desde curvas de presión capilar propias ni desde puntos Swi–√(k/φ) cargados por el usuario: `fitSwiPowerLaw` existe en el motor pero ninguna pantalla lo invoca. La salida de la tarea 8 en la interfaz es la curva Swi con coeficientes dados.
- «Ajustar k» (la otra mitad de la consigna) se resuelve con el modelo k–φ de corona (módulo `perm-core` y panel «Corona»), no con este módulo; Swi no recalibra la permeabilidad.
- No se calcula altura sobre el agua libre ni se convierte presión capilar de laboratorio a condiciones de reservorio (Leverett, Washburn): los niveles no tienen presión asociada.
- No se muestra el análisis de la presión de desplazamiento en un panel: queda en el motor y en el test.
- La bandera Sw < Swi es un indicador de control de calidad, no un corte: no entra en NET_RES ni NET_PAY.

## Verificación en el pozo del TP

`datos/pozo_tp_perfiles.csv` con los módulos de fábrica (PHIE de `phie-vsh`, PERM de Timur, SW de Archie con los parámetros por defecto), 5795 muestras con Swi:

| Nivel | Swi mínimo | P10 | Mediana | P90 | % Sw < Swi (tol. 0,02) |
|---|---|---|---|---|---|
| 1 (menor presión capilar) | 0,209 | 0,266 | 0,365 | 0,676 | 0,3 |
| 2 | 0,155 | 0,195 | 0,265 | 0,481 | 0,1 |
| 3 | 0,102 | 0,136 | 0,200 | 0,422 | 0,0 |
| 4 | 0,057 | 0,079 | 0,120 | 0,272 | 0,0 |
| 5 | 0,040 | 0,056 | 0,087 | 0,205 | 0,0 |
| 6 (mayor presión capilar) | 0,016 | 0,024 | 0,042 | 0,123 | 0,0 |

(El máximo es 1,0 en todos los niveles por el recorte de la roca muy cerrada; en el nivel 1 son 93 muestras.) Entre el 18 % (zona A) y el 74 % (zona C) de las muestras cae fuera del rango √(k/φ%) de las muestras de la cátedra: la mayor parte de la curva en C y E es extrapolación. La Sw de Archie con los parámetros por defecto es 1,0 en la mediana del pozo, así que la comparación dice poco sobre la calidad de Sw hasta que Rw y los exponentes estén calibrados.

## Archivos

`src/petro/swiPc.ts`, `src/modules/swi-pc/index.ts` (registro en `src/modules/index.ts`), `src/viewer/templates.ts` (SWI en la pista de saturación), `tests/petro-swi-pc.test.ts`, `tests/modules-swi-pc.test.ts`, `tests/fixtures/tp-corona-electrica-scal.json`, `scripts/qa/swi-pc-reference.py`, `docs/capturas/swi-pc/swi-pc-panel.png`.
