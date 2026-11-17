# 0078 — Torneo exploratorio de modelos contra corona (F22)

## Contexto

F22 sigue pendiente en main al 17/11/2026. La base incluye F20 (65e0089), cuyas curvas preparadas, calidad ML, bandas y activación explícita se preservan. Se confirmaron `coreCalibration`, `includedPlugs`, `tpCoreSet`, `tpRi`, módulos Vsh, PHIT y Sw, `computeOnce`, preparación central y snapshots con revisiones.

El TP aporta 151 plugs con porosidad de laboratorio en v/v, profundidad MD ya alineada al perfil y dos coronas. No se conocen todas las condiciones de confinamiento. Los pares Sw–RI del ensayo eléctrico no tienen profundidad representativa de Sw in situ: sirven para ajustar n, no para validar SW del perfil. DRX composicional no equivale automáticamente a Vsh volumétrico.

## Decisión previa al código

Ejecutar una tarea dedicada en worker inline, sin esperar slots de cálculo. Preparar las entradas mediante el evaluador central y ejecutar el mismo motor puro y registro del proyecto para cada combinación: cinco transformadas Vsh, cinco métodos PHIT explícitos (sin auto) y tres modelos Sw. Conservar parámetros restantes, fuentes explícitas, PHIE y recetas preparadas; forzar únicamente métodos/fuentes del candidato, también en zonas para evitar overrides invisibles. Nunca modificar originales ni realimentar salidas como mediciones.

Comparar PHIT con φ de plugs incluidos mediante su profundidad corregida (`shiftedDepth`, MD metros), interpolación lineal sin extrapolación ni vecinos faltantes. No interpretar φ laboratorio como PHIE sin contrato. Dominio exploratorio de φ de referencia y predicción: [0, 0,5] v/v. Nulos, infinitos y referencias fuera de dominio se excluyen con denominador y causa visibles; no se imputan. Porosidad, Vsh y Sw se expresan en v/v. Vsh y Sw figuran **no evaluables** cuando faltan observaciones compatibles. No se inventan referencias desde curvas calculadas, RI, permeabilidad o DRX.

Informar por variable n, cobertura, sesgo, MAE y RMSE, sin sumar errores entre variables. El soporte mínimo exploratorio es cinco plugs y 80% de referencias elegibles; menos de diez pares exige advertencia de soporte escaso. Comparar orden de φ sobre pares comunes a candidatos soportados para no premiar pérdidas de cobertura. El conjunto común debe cumplir también cinco pares y 80% de referencias elegibles antes de ordenar o permitir aplicar; soporte individual no basta. Mantener además cobertura propia por candidato. Empates no autorizan proclamar ganador integral, especialmente sin Sw/Vsh observados. Aplicar es selección del usuario informada por φ; no certifica los otros métodos.

El torneo no ajusta parámetros. La procedencia del ajuste previo puede ser desconocida: por defecto toda evaluación se etiqueta **exploratoria**, nunca validación independiente. Los datos usados para ajustar parámetros no cuentan como evaluación independiente; IDs de ajuste declarados se excluyen del conjunto de evaluación y deben conservarse en evidencia. El uso repetido de los mismos plugs para seleccionar método también introduce optimismo. No ofrecer un modo de validación independiente sin separación verificable. Distinguir sintéticos de mediciones reales.

Aplicar exige contexto idéntico de pozo, revisión, interpretación y recetas al evaluado. Una receta atómica fija revisiones de entrada, aplica la interpretación exacta del candidato, conserva evidencia JSON opcional y crea snapshot comparable con entradas fijadas. Un único commit al store permite deshacer/rehacer todo; rechazar resultados obsoletos sin modificar proyecto. Los arrays derivados se recalculan, no se serializan como mediciones. Ecuaciones y referencias solo en Ecuaciones.

## Alternativas descartadas

Puntuación agregada φ/Sw: unidades conceptuales y soporte distintos. Ganador global con Sw no observado: falsa seguridad. Comparar Sw de desaturación contra SW a profundidad inventada: físicamente inválido. Ajustar parámetros y reportar su error como validación: fuga de información. Motor simplificado separado: riesgo de discrepancia al aplicar. Reemplazar curvas preparadas por originales: viola I04 y contratos F20.

## Verificación requerida

Casos sintéticos de métricas conocidas, faltantes, soporte, empate, exclusión de ajuste y equivalencia candidato/motor tras aplicar; TP real con limitaciones explícitas. Revisión científica y recálculo por otro agente. Typecheck, suite completa y HTML único; recorrido reproducible y capturas 1366×768 claro/oscuro; sin internet. Si file:// queda bloqueado, registrar error y prueba HTTP separada, mantener PR borrador sin extender excepción F20. Preservar I01–I12 del masterplan de preparación y DRX.

## Ajuste de ejecución tras primer recorrido

El primer HTML mantuvo el worker ocupado más de 15 segundos: ejecutar 75 cadenas completas incluye consumidores ajenos al torneo. Se añade al motor una selección opcional de módulos objetivo que recorta **solo la ejecución** a la clausura de dependencias del plan completo ya resuelto. No se reconstruye un registro reducido ni se cambian defaults/fuentes. El torneo solicita Vsh, PHIT y el Sw candidato; todas sus dependencias efectivas se mantienen. La interpretación aplicable sigue siendo la completa original con los métodos elegidos; esta opción no se persiste como decisión científica ni cambia el motor habitual. Verificar equivalencia con ejecución completa y ausencia de ejecución de consumidores ajenos. La revisión independiente y el recorrido final deben verificar esta optimización antes de atribuir rendimiento.

### Refinamiento de ejecución tras recorrido

El torneo calcula la clausura de dependencias de VSH, PHIT y el modelo SW elegido mediante `EngineOptions.targetModuleIds`. El grafo se resuelve primero con el registro completo y todas las fuentes productivas; solo se filtra después su orden de ejecución. Así no se ejecutan consumidores ajenos costosos ni se alteran defaults por reducir el registro. Se reutiliza un motor con caché por modelo Sw. La interpretación aplicada sigue siendo la original del candidato, sin restricciones de ejecución. Pruebas comparan motor completo y subgrafo con fuente PHIE explícita y secuencia de candidatos A/B/A.
