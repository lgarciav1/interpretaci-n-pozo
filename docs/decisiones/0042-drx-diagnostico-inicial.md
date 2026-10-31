# 0042 — P4a: carga DRX y comparación diagnóstica

Estado: implementado en rama de revisión, sobre cierre funcional P3. No integrado en main. No implementa P5 ni declara completa toda P4.

## Datos y persistencia

`src/io/xrd.ts` construye PointSet de kind xrd desde RawTable CSV/xlsx, con mapeo explícito de profundidad puntual o tope/base, id, corrida y minerales. Unidad MD m/ft, base masa/volumen de sólidos, escala porcentaje/fracción, roca completa/fracción arcilla, clasificación mineral, informe, referencia de pozo y datum son explícitos. Cada conjunto es homogéneo; bases distintas requieren conjuntos separados. La UI exige confirmar el mismo MD/datum y rechaza contradicciones con el datum conocido. La declaración no transforma un datum de adquisición desconocido en conocido.

`preserveRawCells` es optativo para los lectores generales y obligatorio para construir DRX. Conserva estados incluso en columnas mayormente numéricas y evita convertir sentinelas negativos a faltantes sin revisión. Sin esa opción se rechaza la construcción. No cambia por defecto la importación de perfiles/plugs/MDT.

Se conservan valores originales, unidades, duplicados de profundidad e ids únicos. Los estados measured/not-measured/not-detected/below-detection se mantienen separados. ND y BLD/LD no se convierten en cero; otros textos se rechazan para que se revisen. Los minerales desconocidos requieren nombre y clasificación explícitos; no se asignan por inferencia. No se importa aún el límite numérico de detección ni incertidumbre por muestra.

El contrato versionado se conserva en una columna de texto `xrd:contract`; minerales y estados tienen columnas propias y los intervalos una base opcional. Reutiliza el contenedor genérico PointSet y v7, sin cambiar el serializer. Importar acepta revisión de entradas y laboratorio en una sola receta. Los snapshots previos conservan su laboratorio histórico. No se convierte DRX en una curva continua medida.

## Composición

Por muestra se verifica 0–100/0–1 y cierre con tolerancia declarada en fracción (0–0,1). No se renormaliza una composición incompleta. Una celda censurada o no medida bloquea el total. Fracción arcilla permite conservar/inspeccionar el ensayo pero no determina contenido total de arcillas de roca.

Base nativa devuelve la suma declarada de minerales arcillosos. Masa→volumen requiere composición de roca completa con cierre admitido y todas las densidades positivas declaradas en g/cm³. La conversión es `v_i = (w_i/rho_i) / sum(w_j/rho_j)`. Se rechazan conversiones numéricamente no finitas. No hay densidades por defecto ni se incluyen poros/fluidos como minerales.

Contenido de minerales arcillosos en masa, contenido en volumen de sólidos y volumen de lutita Vsh no son equivalentes. No existe aquí botón para aplicar a Vsh, calibrar GR o modificar cutoffs.

## Pares con perfiles

Se elige explícitamente una original o preparada del contexto central, respetando elegibilidad de herramientas. Si la preparación vigente no está publicada, la comparación queda bloqueada; no cae al original. La tabla se invalida al cambiar proyecto o controles y no modifica petrofísica. Las decisiones de exclusión y desplazamientos por corrida/conjunto se respetan; el offset diagnóstico adicional es transitorio.

Puntos: interpolación lineal en MD con máximo entre anclajes, sin extrapolar ni cruzar faltantes o fronteras zonales. Intervalos: integración trapezoidal de segmentos adyacentes finitos cuya separación no supera el máximo. El promedio y segundo momento se ponderan por espesor realmente cubierto, nunca por número de filas; huecos no se asignan a vecinos. Se muestran cobertura, dispersión, flags del soporte y motivo de exclusión. Cruces de zona se señalan como comparación global, fuera de un futuro ajuste zonal.

Las réplicas se conservan; no se realiza un ajuste ni se cuentan como localizaciones independientes. Cálculo cooperativo cancelable; se rechazan más de 2 millones de visitas a segmentos, sin publicar tablas truncadas. La tabla visual muestra hasta 200 filas, declarando total y límite. Es un primer diagnóstico acotado, no una promesa de rendimiento para grandes campañas. No utiliza un Worker nuevo.

## Pendiente de P4

Actualización P4b: la configuración/evidencia persistente, procedencia de densidades y exportación se implementan en [ADR 0043](0043-evidencia-persistente-drx.md). El inventario siguiente describe lo pendiente al entregar P4a.

Límites de detección e incertidumbres numéricas, bases heterogéneas por fila, densidades con procedencia e incertidumbre persistidas, configuración/evidencia de emparejado persistente, exportación específica de la tabla y campañas reales de laboratorio. La clasificación arcillosa y las densidades deben venir del ensayo o una referencia explícita del usuario. No se declara validación con DRX real ni calibración científica de GR. P5 conserva sus puertas de identificabilidad, evidencia, ajuste por zona y cutoffs separados.
