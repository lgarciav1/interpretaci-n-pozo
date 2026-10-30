# ADR 0035: proyección efectiva y contexto de laboratorio

Fecha: 2026-10-30. Estado: P2b, continuación de ADR 0034 sobre PR #43. No habilita un editor ni métodos de corrección.

## Una proyección, originales intactos

`resolveDataContext` recibe el Well importado, interpretación, registro y revisión explícita. Sin artefactos conserva el Well, lista de curvas, arrays y claves del motor anteriores. El puente principal y el pedido aislado de snapshots usan este servicio; el motor y los selectores del visor/plots/figuras usan su filtro `selectDataCurves`. La disponibilidad de módulos conserva el mismo criterio de fuentes y herramientas.

La API también acepta un lote de `PreparedArtifact` **ya evaluados**, todavía sin productor en la UI. Valida ids únicos, colisiones, revisión, índice, unidades/dimensiones, largos de datos/calidad, padres/versiones y ciclos. Resuelve dependencias topológicamente aunque el lote venga en otro orden; conserva el orden del lote para presentación. Publica el lote completo o lanza un error sin alterar el proyecto. No aplica fórmulas ni admite métodos científicos por recibir un artefacto.

Cada artefacto contiene firma de receta/método/alcance suministrada por el evaluador, referencias versionadas a padres, Float64Array y Uint16Array de calidad alineados al índice maestro. La semántica de los flags, el ledger de efectos y el evaluador de recetas pertenecen a P3. Esta API no sustituye esa validación científica. Los arrays prestados son inmutables por contrato, igual que los originales; no impide escrituras que eludan las APIs.

La proyección contiene originales y alternativas preparadas; no los inserta en Well.curves del proyecto. CurveOrigin y los adaptadores reconocen `prepared`, sin moduleId ficticio. El guardado rechaza una proyección como si fueran datos originales; v7 además conserva su validador estricto de entradas. No cambia el esquema de archivo ni escribe buffers derivados. Un proyecto antiguo continúa usando sus datos y decisiones.

## Fuentes y herramientas

SourceRef conserva `{kind:'curve', curveId}`. Los artefactos reservan `prep:<nodeId>:<outputKey>` con componentes alfanuméricos, guion y guion bajo. Nuevos imports remapean ids con prefijo `prep:` a `import:prep:...`, aplicando luego la deduplicación vigente; conservan mnemónico y descripción originales. Un original legado que ya usa ese prefijo sigue siendo original. Una colisión entre un original existente y un artefacto se rechaza; no se renombra una fuente histórica.

Las alternativas preparadas no se eligen por defecto. Si se elige una explícitamente y falta, está excluida o su unidad es inválida, el puerto queda bloqueado y no vuelve a un original o módulo. Se bloquean también los consumidores con esa entrada opcional: no se descarta una elección preparada fallida para ejecutar otro modelo. Se propaga el bloqueo por el grafo y la disponibilidad. Para regresar se debe cambiar la selección. Las reglas anteriores para originales y módulos siguen vigentes.

La ascendencia de originales se atribuye con el ToolCatalog vigente; es una clasificación por rol/mnemónico, no una declaración de fabricante, modelo ni corrección adquirida. Una salida preparada hereda la unión de herramientas de todos sus padres. Su rol/mnemónico de salida no puede cambiar esa ascendencia. Apagar cualquier ancestro, o dejarlo fuera del plan, excluye el artefacto del motor, visor y plots. Las curvas sin herramienta atribuible mantienen ascendencia vacía, sin afirmar independencia física. El wire legado de originales puede conservar ascendencia vacía; la preparación obtiene sus padres del mapa atribuido del contexto, no de una afirmación externa de ascendencia.

El visor identifica preparadas, conserva acceso explícito al original y sigue la elegida para rellenos. Las series por rol respetan una selección preparada sin fallback; las series por id mantienen comparación explícita. LAS, CSV/XLSX y los modelos de informe aceptan la proyección y sus resultados coherentes; las columnas preparadas se distinguen de las medidas. Los exportadores de datos conservan el acceso existente a los originales, incluso si la sarta los oculta. ML recibe la misma fuente resuelta por el grafo, sin modificar modelos ni ecuaciones. Aún no hay publicación de artefactos hacia los stores de la aplicación: esa conexión requiere el evaluador y su paquete atómico en P3.

## Identidad y laboratorio

El caso identidad mantiene las claves de ADR 0034. Con preparación, preparationKey y engineKey incluyen receta, padres/versiones, arrays, calidad, metadatos e interpretación. Un no-op con la misma interpretación y contenido reutiliza la proyección/contexto por referencia; no compara ni hashea muestras. La caché conserva solo la última proyección por Well con WeakMap, sin intermediarios de evaluación. El cliente rechaza una proyección preparada con contexto de originales, de otras curvas o de otra interpretación antes de sincronizar/ejecutar. El servidor rechaza artefactos preparados bajo contexto de identidad. Al cambiar de preparación, el cliente sincroniza profundidad completa y abre generación nueva; no consume el presupuesto de resync para un cambio válido de dominio.

`calibrationKey` identifica evidencia pendiente por contexto físico, conjuntos seleccionados (profundidad, ids de puntos, valores/unidades, textos y marca sintética), decisiones, versión de método, ventana MD, agregación y configuración científica. Rechaza conjuntos ausentes, ventana inválida y contexto de cálculo obsoleto. Excluye nombres, encabezado y etiquetas de columnas; cambiar esos textos no invalida evidencia. Las claves son de sesión, no hashes persistentes. Cambiar laboratorio o decisiones invalida la calibración sin modificar engineKey; sigue siendo válido reutilizar petrofísica sin consumidores de laboratorio.

No se agrega un ajuste DRX ni un botón de aceptación. P3 debe consumir estas claves y comprobarlas antes de aceptar una propuesta. Si un futuro método de preparación consume laboratorio, ese dato deberá formar parte de su firma de receta y versiones antes de habilitarlo.

## Trabajo siguiente

P3: unión tipada/versionada de recetas, semántica de calidad, evaluación de exclusión/restauración no destructiva, previsualización aislada, publicación de artefactos con resultados, persistencia de decisiones, undo/redo y comparación original/preparada. Debe completar límites de memoria/cancelación y validación del método antes de habilitarlo. Después: alineación/limpieza adicionales, carga/emparejado/calibración DRX y correcciones físicas según datos disponibles. No se declaran resueltos #31 ni #32.
