# 0046 — P5b: estimar un extremo GR con el otro fijado externamente

Estado: implementado sobre P5a (#52), en rama de revisión sin integrar main. Conserva las hipótesis físicas y la separación de cutoffs de [ADR 0045](0045-calibracion-gr-drx-con-evidencia.md).

## Alcance e hipótesis

P5a bloquea estimar dos extremos cuando falta soporte composicional de uno. Este modo permite declarar ese extremo desde evidencia externa aplicable a la zona y estimar **solo el otro**. El usuario elige limpio o lutítico, ingresa valor gAPI/referencia y confirma su aplicabilidad externa. No se copian automáticamente los parámetros actuales como si fueran evidencia independiente.

El valor externo debe pertenecer al dominio y paso canónicos de su parámetro; un valor fuera de rango o fuera del paso se rechaza, sin recortarlo ni redondearlo. Se conserva exactamente en parámetros sin redondear/aplicables y en cada ajuste de validación. Puede estar en una cota canónica si viene explícitamente de referencia externa; el extremo estimado sigue bloqueado cerca de una cota.

Se conserva incertidumbre absoluta informada opcional con descripción de su significado. No informada permanece desconocida; una incertidumbre explícita exige nota y valor no negativo. Si supera `maxEndpointSpread` (20 gAPI por defecto), se bloquea aplicar. Es un filtro operativo, no propagación estadística. Variación cero del extremo fijo significa que estuvo condicionado por construcción; no acredita incertidumbre cero ni autenticidad de la referencia.

## Ajuste restringido

Mismos pesos iguales por localización, agrupado/exclusiones, funciones IGR/Vsh y límites de P5a. Para lineal, con `x=Cproxy`:

- Limpio `c` fijo: `d = sum[x·(GR−c)] / sum[x²]`, `s=c+d`.
- Lutítico `s` fijo: `d = sum[(1−x)·(s−GR)] / sum[(1−x)²]`, `c=s−d`.

Es mínimos cuadrados GR–proxy con un parámetro. No se estima el otro y luego se lo sobrescribe. Para los cuatro métodos no lineales se inicializa con la inversa monótona del método y se minimiza el error cuadrático del proxy con la **función Vsh real**, manteniendo el extremo externo constante. Se explora toda la caja libre en 81 puntos y cinco refinamientos adicionales. No se promete óptimo global para datos arbitrarios.

Se redondea únicamente el extremo libre al paso del esquema. Se recalculan sesgo/RMSE/residuo con el par aplicable. El contrato comprueba la igualdad del externo con raw/aplicable/folds y su variación cero; rechaza un registro alterado que viole esa vinculación.

## Admisión condicionada, no dispensa de evidencia

Se requiere soporte del extremo **libre**: proxy ≥0,8 si se fija limpio, o ≤0,2 si se fija lutítico. No se exige observar el extremo que se declaró externo. La política por defecto del modo restringido registra rango proxy ≥0,3 y rango GR ≥10 gAPI, frente a 0,6/20 del modo de dos extremos. No cambia la política original de P5a.

Siguen ≥12 localizaciones, correlación positiva ≥0,6, los tres bloques separados, ≥6 entrenamientos/≥2 validaciones por bloque, guardas de soporte, rango de entrenamiento, métricas de ajuste/validación, variación máxima del extremo libre, dominio, incertidumbres y fuente GR activa. En validación se ajusta solo el extremo libre sobre entrenamiento; el externo no se reestima con el bloque reservado. Datos sin señal/rango, con soporte libre insuficiente o sin bloques separados siguen bloqueados. Las pruebas incluyen referencias incompatibles con los datos; no se fuerza su aceptación.

## UI, aceptación e historia

El modo predeterminado continúa estimando dos extremos. Cambiar modo/valor/referencia/nota/confirmación invalida el preview y cancela el ajuste en curso. Referencia o valor nuevos exigen confirmar de nuevo su aplicabilidad. Se muestra qué extremo es externo y se separa su incertidumbre declarada de la variación de ajustes. No se muestran ecuaciones en el flujo operativo; van en Ecuaciones/documentación.

Se reutilizan coordinador aislado, validación del contexto, aplicación zonal y un undo/redo de P5a. Originales, fuentes, otras zonas y cutoffs se conservan. Guardar/abrir y snapshots recuperan la restricción/procedencia completa. No se habilita ejecutar una propuesta histórica como si fuera vigente.

## Compatibilidad

El modo de dos extremos mantiene evidencia/configuración **v1 / xrd-gr-v1**. Solo una propuesta restringida usa **v2 / xrd-gr-fixed-v1**, con `config.fixed` explícito y atestación externa. El lector actual acepta v1 y v2; hay un recibo v1 real del recorrido sintético de #52, no regenerado con el constructor nuevo.

El lector original de #52 se ejecutó contra ambos tipos: acepta su v1 y rechaza explícitamente la evidencia v2. El contenedor de proyecto sigue v7, preparación esquema 4. Sus parámetros conocidos y el ajuste JSON se conservan en aplicaciones anteriores, pero estas no interpretan/auditan la restricción nueva. No se promete que un lector viejo entienda v2 ni se rebaja silenciosamente a dos extremos. Versiones futuras se informan y preservan.

## Límites

El ajuste queda condicionado a que la referencia externa sea válida para el pozo/zona/escala. Las métricas no lo certifican. No hay propagación estadística, combinación de referencias externas ni ajuste conjunto entre zonas. La validación usa fixtures independientes y recorridos sintéticos, no una campaña DRX real. Referencias de regresión y funciones canónicas: ADR 0045 y módulo IGR/Ecuaciones.
