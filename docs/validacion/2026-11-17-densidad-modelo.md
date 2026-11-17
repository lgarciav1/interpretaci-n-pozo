# F20 — Evidencia numérica, 2026-11-17

ADR [0077](../decisiones/0077-reconstruccion-densidad.md) escrito antes de código/evaluación. El bosque de clasificación existente se confirmó inadecuado para regresión. Modelo ExtraTrees propio determinista y revisión científica independiente.

## TP real

Ejecución Node24 con `--experimental-strip-types`, importando `reconstructDensity`, leyendo directamente `datos/pozo_tp_perfiles.csv` y sin navegador ni benchmarks simultáneos. Selección explícita exploratoria: buen pozo CAL entre BS−.5 y BS+.5in; derrumbe CAL>BS+1in; invalidación e intervalo intermedio excluidos. La selección se materializó en intervalos cerrados exactos en [densidad-tp-modelo.json](2026-11-17-densidad-tp-modelo.json), no en notas ni etiquetas interpretadas. CAL inválido1.098in no es buen pozo ni derrumbe. Predictores GR, DT y AT90 con confianza explícita **exploratoria**, rangos físicos del ADR y exclusión de faltantes; no implica conocimiento de herramienta/lodo. NPHI excluido por afectación potencial en derrumbe.

Resultado: RMSE **.0503332423g/cm³**, R² **.6345867691**, validación **5314 pares**, cobertura de validación **99.0494%** de objetivos sanos medidos finitos. Cobertura empírica de banda nominal90%: **89.8946%**; semiancho conservador final **.0857614966g/cm³**. Ajuste final3975 muestras, calibración1062. **43/71** muestras seleccionadas como derrumbe reconstruibles; las restantes se señalan sin reconstrucción por entrada/soporte insuficiente; el adaptador de preparación las publica como nulos, conservando la medición en la curva original. Tiempo de ejecución **1085.65ms** en esta máquina, no benchmark contractual.

Estas métricas validan exclusivamente buen pozo retenido por bloques: **no existe verdad de ZDEN en derrumbes** y no prueban exactitud allí. La banda no garantiza cobertura en cada intervalo. La selección de confianza es una hipótesis exploratoria revisable; no una corrección ambiental física validada.

## Sintéticos y revisión

`tests/density-reconstruction.test.ts`: ocho pruebas focalizadas pasan (2.71s primera ejecución): métricas manuales, cuantiles finitos, recuperación de bloque190–200m borrado, invariancia a objetivo oculto adversarial, faltantes/extrapolación, soporte/fiabilidad NPHI, modelo no predictivo y denominador de cobertura.

Pozo:2000muestras cada.2m; GR=80+50sin(.7z), DT=90+30cos(.47z), densidad=2.2+.003GR+.001DT+.006sin(11z). Borrado190≤z<200m, entrenamiento resto:50muestras reconstruidas con RMSE<.08 prefijado.

El revisor independiente aportó otro sintético modular (`tests/density-independent.test.ts`). Su RMSE oculto **.00884643** cumple el umbral y el CV R² **.98909**, RMSE **.00617112**, cobertura de banda global **89.04%**, pero cobertura en su bloque oculto es **65%**. Esto confirma un límite efectivo de la banda global frente a un bloque particular. La revisión conservadora documentada en ADR toma envolvente de todas las bandas de calibración, sin usar residuos de prueba/ocultos; tampoco garantiza cobertura local. No se retocaron hiperparámetros ni umbrales para hacer pasar ese ejemplo. La disposición final de este hallazgo debe registrarla el revisor independiente.
