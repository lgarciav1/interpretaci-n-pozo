# 0045 — P5a: propuestas GR–DRX identificables, preview y aceptación por zona

Estado: implementado en revisión sobre P4c/P4b. Primera entrega funcional de P5; no implica integración de la cadena ni certificación con laboratorio real.

## Dominio admitido y separación física

Se usa el GR medido/preparado que alimenta efectivamente la cadena IGR → Vsh. El planificador común debe resolver esos dos módulos y la curva elegida; fuentes calculadas, alternativas inactivas, unidades distintas de gAPI, puertos desactivados o Vsh importado quedan bloqueados. No se cambia la selección de fuentes al aplicar.

El ensayo debe describir roca completa y contenido de minerales arcillosos en volumen de sólidos: base volumen nativa o conversión masa→volumen con densidades declaradas de P4. Masa nativa y fracción arcilla solo sirven al diagnóstico. El usuario debe declarar el contenido de arcillas de los extremos limpio/lutítico y la relación constitutiva/alcance del proxy, además de la referencia y declaración de independencia del laboratorio respecto del GR. No se rellenan por defecto los extremos composicionales ni se infiere que arcilla sea lutita.

La normalización declarada es `Cproxy = (Csolidos − Climpio) / (Clutitico − Climpio)`. Fuera de [0,1] se excluye la muestra, sin recorte. Se registra la hipótesis completa. Esta relación condicionada no acredita porosidad/permeabilidad/pay ni es una conversión universal DRX–Vsh. La aplicación está limitada al interior de una zona explícita, sin zonas superpuestas ni muestras que crucen sus fronteras.

## Datos, réplicas y errores informados

Se recalcula el emparejado y su evidencia P4 sobre el contexto vigente. Censura, falta de cierre, soporte/cobertura insuficiente, decisiones de exclusión y muestras fuera del dominio se excluyen con causa. GR interpolado/resampleado requiere admisión explícita; la selección de una preparación conserva procedencia y calidad. Originales y laboratorio permanecen inmutables.

Muestras con soportes solapados o separación ≤1 m se agrupan transitivamente como una localización. Se promedian GR/proxy y cada localización tiene peso uno, sin contar réplicas como información adicional. Si los proxies del grupo difieren >0,15 se excluye el grupo completo. Independencia geométrica no demuestra independencia causal ni ausencia de sesgo de adquisición.

La suma de incertidumbres absolutas informadas se compara con 0,05 en fracción de la base original. Incertidumbre relativa de densidad >0,1 bloquea aplicación. Son filtros operativos, no propagación probabilística: no se inventa sigma ni un intervalo de confianza a partir de notas de laboratorio. Un dato sin incertidumbre informada sigue desconocido; no se guarda un cero inventado. Los límites censurados no se convierten en observaciones puntuales.

## Ajuste, dominio y redondeo

- Lineal: mínimos cuadrados `GR = a + b·Cproxy`, con pendiente positiva; extremos sin redondear `a` y `a+b`.
- Larionov terciario/antiguo, Clavier y Steiber: inicialización mediante inversión monótona/OLS y minimización de error cuadrático del proxy utilizando **gammaRayIndex/vshFromIgr reales**, incluyendo sus recortes. Se explora toda la caja canónica con malla 21×21 y cinco refinamientos locales adicionales. No se declara un óptimo global matemático para datos arbitrarios.
- Los límites y pasos se leen del registro canónico: grClean [0,150], grShale [20,300], paso 0,5 gAPI y orden estricto. No se recortan endpoints fuera de rango para hacerlos aplicables. Soluciones a un paso de una cota se bloquean.
- Se conservan parámetros sin redondear y realmente aplicables; RMSE/sesgo del proxy y residuo GR se recalculan con estos últimos. La función empírica de Larionov no llega exactamente a uno: objetivos por encima de su máximo se rechazan, no se renormaliza la ecuación.

La implementación coopera por etapas/bloques y permite cancelación; máximo 2048 muestras de ensayo y 512 localizaciones, con rechazo explícito y sin truncamiento. No se promete rendimiento universal ni se añade un Worker por método. El preview petrofísico usa el runner aislado existente.

## Puertas de admisión v1

La política completa se persiste en la propuesta y se presenta en la UI. Defaults versionados:

- ≥12 localizaciones, rango de proxy ≥0,6, soporte mínimo ≤0,2 y máximo ≥0,8.
- Rango de GR ≥20 gAPI y correlación positiva GR–proxy ≥0,6. Un bajo RMSE agregado no acredita extremos con GR casi constante.
- Tres bloques contiguos en profundidad, ≥6 localizaciones de entrenamiento y ≥2 de validación por bloque. El bloque de validación no participa de su ajuste. Se separa el entrenamiento por una guarda de dos veces el hueco máximo + separación de agrupado + máxima longitud de soporte, para evitar compartir muestras originales.
- Cada entrenamiento debe conservar rango de proxy ≥0,6 y endpoints válidos. Si falta soporte en un bloque se declara «sin validación independiente suficiente» y se bloquea aplicar ambos extremos.
- RMSE del proxy ≤0,1 y sesgo absoluto ≤0,05, tanto en ajuste redondeado como en validación. Variación de cada extremo al retirar bloques ≤20 gAPI.

Estos umbrales son admisión operativa conservadora, no constantes universales de geología ni probabilidades de cobertura. Se fijan con fixtures independientes y quedan archivados para revisar resultados. No se usa un reparto aleatorio de réplicas/vecinos. No se publican parámetros no identificables por tener correlación alta o un ajuste superficialmente pequeño.

## Preview, aceptación y evidencia

La propuesta no modifica Project ni ejecuta el motor principal. Si pasa admisión, construye un Project temporal y ejecuta el mismo motor con el runner aislado de snapshots/previews. Se presentan extremos, métricas, exclusiones y efecto en Vsh/porosidad efectiva/Sw disponibles. Aplicar exige resultado del contexto exacto y módulos IGR/Vsh sin error; cambiar proyecto o controles invalida/cancela la propuesta.

Aceptar publica una receta: grClean/grShale compartidos y vsh.method **solo para la zona elegida**, con evidencia JSON versionada por ensayo/zona en `settings['xrd:gr-calibration:<zoneId>']`. Conserva parámetros previos, política/hipótesis, revisión/huellas, método, agrupado/exclusiones y métricas. No sobrescribe evidencia de otras zonas. Se mantiene Project v7/preparación esquema 4; no se guardan curvas ni buffers derivados del tamaño del pozo. Los resúmenes por localización se conservan como evidencia JSON; las propuestas históricas no se ejecutan automáticamente. La evidencia serializada se limita a 200.000 caracteres, con rechazo explícito.

Otras zonas, fuentes y cutoffs numéricos se conservan. Los resultados y clasificaciones pueden cambiar por el nuevo Vsh, sin alterar los umbrales. Una acción posterior sobre cutoffs usa los controles/sensibilidad existentes y su propio historial; no forma parte de aceptar calibración. Undo/redo, guardar/abrir y snapshots recuperan parámetros/evidencia. Registros futuros se conservan y se informan sin ejecutarlos.

## Referencias y límites

Ecuaciones Vsh/IGR: funciones y referencias canónicas existentes de Asquith/Krygowski (2004), Larionov (1969), Clavier et al. (1971) y Steiber (1973). OLS: Draper/Smith (1998), *Applied Regression Analysis*, 3.ª ed. Las ecuaciones se incorporan a la documentación de IGR en Ecuaciones; la UI operativa muestra resultados y alcance.

El fixture Python independiente conserva valores numéricos esperados para los cinco métodos; no usa funciones de producción ni se presenta como DRX real. Falta contrastar una campaña real y su relación constitutiva. No se implementa aún ajuste con un extremo externo fijo, propagación estadística de incertidumbre o calibración conjunta entre zonas. Son extensiones posteriores de P5, no resultados implícitos de esta entrega.
