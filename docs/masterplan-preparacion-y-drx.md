# Masterplan: preparación de datos, correcciones y calibración con DRX

- Estado: propuesta de arquitectura y secuencia de implementación; **no describe funcionalidades ya disponibles**.
- Fecha: 2026-10-27.
- Base inspeccionada: main, commit 4f187f6a8d585475efc79b18ed89194b432a2116.
- Requisitos: [#31, calibración DRX](https://github.com/lgarciav1/interpretaci-n-pozo/issues/31) y [#32, preparación de curvas](https://github.com/lgarciav1/interpretaci-n-pozo/issues/32).
- Lectura complementaria: [arquitectura vigente](arquitectura.md), decisiones [0003: QC](decisiones/0003-control-de-calidad.md), [0020: invasión](decisiones/0020-perfil-radial-de-invasion.md), [0023: calibración](decisiones/0023-calibracion-con-corona.md), [0026: snapshots](decisiones/0026-comparacion-de-snapshots.md) y [0032: sarta](decisiones/0032-sarta-de-perfilaje.md).
- El plan original completo está enlazado desde CLAUDE.md a un artefacto externo de Claude que no fue accesible durante esta revisión. Este documento integra los nuevos requisitos y los contratos verificables del repositorio; no declara una auditoría completa de aquel artefacto.

## 1. Resultado esperado y límites de la promesa

Un usuario podrá cargar perfiles y laboratorio, revisar calidad, limpiar y alinear mediciones, aplicar correcciones respaldadas para su herramienta, calibrar la respuesta de GR con DRX y ver el efecto en la interpretación. Podrá reproducir, comparar, guardar, exportar y deshacer cada decisión conservando las mediciones originales.

Ninguna arquitectura garantiza ausencia total de errores. La meta verificable es impedir estados ambiguos, bloquear operaciones sin fundamento, detectar resultados obsoletos y exigir evidencia numérica y funcional antes de publicar una corrección. Un método sin datos o validación seguirá como diagnóstico y no se presentará como corrección disponible.

Este masterplan fija decisiones transversales. Los contratos de cada método se detallarán en ADR y pruebas antes de implementarlo. Un cambio a una decisión normativa de este documento debe actualizar su matriz de aceptación y explicar su compatibilidad.

### Alcance comprometido

1. Edición no destructiva: exclusión/restauración, identificación de espurios, filtrado e interpolación explícitos.
2. Puesta en profundidad de curvas, corridas y muestras.
3. Correcciones ambientales por herramienta: condiciones del pozo, rugosidad, propiedades/salinidad del lodo.
4. Análisis del impacto de invasión y revoque; corrección solo cuando sea identificable y esté validada.
5. DRX: carga, bases composicionales, comparación con perfiles, propuestas de calibración GR–arcillosidad y evaluación de cutoffs.
6. Una misma procedencia y versión de resultados en visor, gráficos, interpretación, snapshots e informes.

Fuera de la primera entrega: reconstrucción multipozo, profundidad TVD sin trayectoria, inversión conjunta no identificable de todos los efectos, editor arbitrario de fórmulas ejecutables, cartas comerciales sin permiso de redistribución y una corrección ambiental universal.

## 2. Hallazgos concretos del código actual

| Contrato observado | Consecuencia para el diseño |
|---|---|
| Well.depth es MD en metros, estrictamente creciente; cada Curve.data tiene igual longitud. src/core/well.ts | Las curvas desplazadas deben remuestrearse al índice maestro; no se cambia el índice global por arrastrar una curva. |
| Well.curves guarda curvas importadas; los resultados del motor quedan fuera del proyecto. CurveOrigin solo distingue measured/computed. | Hace falta un origen preparado explícito y una proyección derivada; no guardar curvas editadas como mediciones originales. |
| Interpretation es JSON puro y se clona en snapshots. src/core/interpretation.ts | Las recetas, selecciones y evidencias de calibración deben ser JSON; los arrays derivados quedan en resultados. |
| sameEngineInputs y engineBridge ignoran pointSets y sus decisiones para el cálculo actual. | Añadir un conjunto DRX no debe recalcular toda la petrofísica, pero sí invalidar sus comparaciones y propuestas dependientes. |
| El protocolo usa gen/seq y salidas diferenciales; el cliente informa resultado incompleto sin resync. | Incorporar revisión de entradas/contexto y recuperación completa antes de añadir resultados de preparación. |
| Los snapshots actuales guardan interpretación, no una revisión del conjunto de datos. | Una importación posterior puede cambiar la evidencia histórica; fijar revisión de entradas por snapshot. |
| La sarta filtra por propiedad de herramientas y las fuentes explícitas se validan por separado. | Las curvas preparadas heredan procedencia de herramienta; no pueden eludir apagadas o disponibilidad. |
| IGR usa grClean/grShale compartidos; Vsh selecciona método por zona. | La calibración escribe esos parámetros existentes; no duplica un segundo conjunto de sliders. |
| El formato de proyecto actual es v6. src/core/state/serialize.ts | Los cambios de persistencia necesitan una migración real con fixtures antiguos. |
| La exportación consume arrays alineados y computedCurves usa cachés por identidad. | Todas las cachés y consumidores deben reconocer el nuevo contexto; solo comprobar wellId no alcanza. |

Estas son restricciones de la base inspeccionada, no instrucciones para reescribir el motor existente completo.

## 3. Invariantes normativas

| ID | Invariante | Control obligatorio |
|---|---|---|
| I01 | Los originales nunca se modifican en el lugar. | Tipos de solo lectura, hashes de entrada en desarrollo/pruebas y round-trip del archivo. |
| I02 | No se publica una curva con longitud, índice, dimensión o procedencia incompatibles. | Validador en importación, límite del worker y reconstrucción del cliente. |
| I03 | Todo resultado pertenece a un contexto exacto de entradas y recetas. | Clave de contexto en mensajes, cachés, selección y exportación. |
| I04 | Una selección explícita de curva preparada no se sustituye silenciosamente por otra fuente si falla. | Estado bloqueado con causa y acción manual para volver a original. |
| I05 | Cada corrección declara qué efectos ya están corregidos y cuáles agrega. | Ledger de efectos y comprobación de compatibilidad por método. |
| I06 | Datos estimados/excluidos/corregidos son distinguibles de mediciones. | Máscara de calidad y procedencia por muestra/artefacto. |
| I07 | Las ecuaciones científicas usadas tienen referencia, versión, dominio y casos numéricos independientes. | Registro de métodos con puerta de admisión. |
| I08 | Un snapshot reproduce sus entradas y decisiones, no las entradas más recientes. | Revisión inmutable de datos fijada por snapshot. |
| I09 | La puesta en profundidad nunca invierte el orden ni mezcla MD/TVD/datums. | Validación geométrica antes de remuestrear o emparejar. |
| I10 | Calibrar GR–arcillosidad y elegir cutoff de reservorio son acciones separadas. | Recetas y botones separados; ninguna modifica automáticamente la otra. |
| I11 | Visor, gráficos, motor, ML e informe comparten la misma selección efectiva. | Servicio central de contexto, pruebas de integración y rechazo de contexto obsoleto. |
| I12 | Aceptar, deshacer o restaurar es atómico. | Una receta de proyecto por operación aceptada; ninguna publicación parcial. |

Si se rompe una invariante, la operación se rechaza sin modificar el proyecto aceptado.

## 4. Arquitectura elegida

~~~text
Datos importados inmutables + metadatos de adquisición + revisión de entradas
                               |
Recetas aceptadas en Interpretation.preparation (JSON, versionadas)
                               |
                  planificador de preparación
                               |
              evaluador puro dentro del worker
                               |
               artefactos preparados + calidad
                               |
    contexto efectivo común: originales + artefactos + fuentes + sarta
                     /                 \
            motor petrofísico       emparejado DRX/laboratorio
                     \                 /
              resultados con contexto y evidencia
                               |
        visor / gráficos / comparación / exportación / informe

Borradores UI -> evaluación aislada -> propuesta con clave de evidencia
                                      |
                                aceptar explícito
                                      |
                           una receta de proyecto
~~~

### 4.1 Separación de responsabilidades

- Datos: perfiles, muestras y metadatos observados; inmutables.
- Decisiones: recetas de preparación, exclusiones, desplazamientos, propiedades ingresadas, fuentes y parámetros petrofísicos.
- Derivados: arrays preparados, máscaras, correlaciones, diagnósticos, ajustes y resultados petrofísicos. Recalculables.
- UI: borrador, herramienta activa, selección transitoria, panel y previsualización. No se serializa como decisión aceptada.

Las correcciones de medición viven antes del motor petrofísico. Los módulos de Vsh, porosidad, Sw y mineralogía no deben corregir otra vez las mismas mediciones.

### 4.2 Grafo acotado, sin ciclos científicos

La preparación usa solo datos importados, metadatos y resultados de otras operaciones de preparación declaradas. No puede consumir PHIE, SW, VSH ni una temperatura producida por el motor de interpretación.

Si una corrección necesita temperatura, usa una curva medida o un modelo de temperatura de adquisición declarado en preparación. Puede reutilizar la función pura existente, pero no depender de la salida del motor y formar un ciclo.

La calibración DRX lee curvas ya preparadas y muestras. Produce una propuesta; nunca modifica recetas mientras calcula. Aplicar modifica parámetros de IGR/Vsh. El diagnóstico de invasión puede leer el motor; convertirlo en corrección exige un evaluador previo independiente, con entradas explícitas y versión científica propia.

## 5. Modelo de datos y contratos propuestos

Los nombres siguientes son contratos de diseño propuestos, todavía no APIs existentes.

### 5.1 Revisión inmutable de entradas

Ampliar WellEntry con inputRevisionId y un archivo de revisiones accesible por id. Cada InputRevision contiene una referencia inmutable al Well importado y a los metadatos de adquisición asociados. El Well activo sigue accesible como entry.well durante la transición para limitar cambios de consumidores.

- Importar/borrar/reemplazar curvas o muestras, reasignar roles/unidades o editar metadatos de adquisición crea una revisión nueva, con parentRevisionId.
- Ajustar un slider, una exclusión o un desplazamiento cambia la interpretación, no duplica los originales.
- Se comparten arrays por identidad; al guardar se deduplican sus blobs por contenido.
- Un snapshot fija inputRevisionId además de Interpretation.
- Restaurar cambia atómicamente revisión activa, Well e interpretación. Comparar no cambia el estado activo.
- No se elimina una revisión referenciada por el pozo activo, un snapshot o el historial de deshacer. La limpieza explícita opera solo sobre revisiones inalcanzables.
- Los hashes de integridad se calculan fuera del hilo principal. El identificador persistente de revisión no se basa en la identidad de objeto ni en Date.now solamente.
- Si dos revisiones comparten un blob, no se permite que modificar una vista de typed array cambie a ambas.

Contrato de almacenamiento v7: Project.inputRevisions es un mapa de id a {wellId, parentRevisionId?, well, acquisition}. En el archivo, las entradas activas guardan inputRevisionId, interpretation y progress; el Well se serializa una sola vez dentro de la revisión. En memoria, entry.well es exactamente la misma referencia que inputRevisions[entry.inputRevisionId].well. Un validador rechaza discrepancias. El manifiesto de revisión identifica los blobs y sus hashes; la revisión incluye metadatos y no solo arrays.

Los snapshots agregan inputRevisionId. La carga, restoreSnapshot y el runner aislado resuelven el Well desde ese id. Importar crea un registro nuevo y cambia la referencia activa en una sola receta. Nunca mantener dos copias editables del mismo Well.

### 5.2 PreparationState y nodos

Agregar Interpretation.preparation, ausente equivalente a estado vacío para migraciones.

~~~text
PreparationState
  schemaVersion
  nodes: PreparationNode[]
  calibrations: CalibrationEvidence[]   // evidencia de propuestas ya aplicadas

PreparationNode
  id                         // estable, único
  kind + methodVersion       // unión discriminada, validación específica
  enabled
  inputs                     // referencias a original o salida de otro nodo
  scope                      // curva/corrida/intervalos, en MD y datum declarados
  settings                   // JSON tipado por kind; sin funciones ni arrays de datos

PreparationArtifact
  id                         // espacio reservado prep:<nodeId>:<outputKey>
  contentVersion
  contextKey
  role + unit + depthKey
  data                       // Float64Array alineado con índice maestro
  quality                    // Uint16Array; flags combinables
  lineage                    // padres, herramientas y revisión de datos
  correctionLedger
  diagnostics
~~~

La unión de nodos enumera mask, despike, filter, interpolate, depth-align y correcciones científicas registradas. No usar un Record libre de parámetros sin esquema de validación. Una resta/restauración de exclusiones se representa como nueva decisión reproducible sobre una entrada identificada; nunca recupera datos desde una salida ya sobrescrita.

El planificador valida referencias, tipos, dimensiones, ids, ciclos, orden y dominio antes de evaluar. Reordenar en pantalla solo se acepta si respeta dependencias. Si desactivar/eliminar un nodo deja descendientes sin entrada, se muestra el impacto y se bloquean esos descendientes; no se puentea el nodo en silencio. Duplicar un efecto no lo hace idempotente.

### 5.3 Selección efectiva y compatibilidad con el motor

Mantener SourceRef de curva por id para originales y artefactos virtuales. Reservar y validar el prefijo prep:; los importadores remapean cualquier colisión de ids y conservan el nombre original como metadato.

Agregar un origen prepared explícito a la representación de curvas derivadas; no inventar un moduleId petrofísico ni marcarla measured. La proyección efectiva incluye originales y artefactos, sin insertarlos en Well.curves serializado.

Un servicio puro resolveDataContext es el único que arma:
- curvas originales, preparadas, alternativas y fuentes activas;
- revisión/contexto, calidad y diagnósticos;
- elegibilidad por sarta, unidad y disponibilidad del artefacto.

Motor y validación de fuentes comparten este contrato. Si el usuario elige prep:X y X no está listo o es inválido, se bloquean ese puerto y sus consumidores. La regla por defecto vigente no puede disimular la falla. Sin preparación, los proyectos anteriores conservan su comportamiento.

Las curvas preparadas heredan las herramientas de sus ancestros originales. Apagar una herramienta impide usar los productos que dependen de ella. Los metadatos externos de laboratorio no se atribuyen arbitrariamente a una herramienta. Toda excepción futura para correcciones ya adquiridas debe documentarse; no inferirla del mnemónico.

ML, catálogo de pistas, histogramas, crossplots, MDT/corona, figuras y exportaciones usan el mismo contexto. Se conserva acceso explícito a la curva original para comparar.

### 5.4 Calidad y estados

Flags mínimos: originally-missing, excluded, suspect, interpolated, filtered, shifted, corrected, out-of-domain. Definir semántica exacta y combinación en quality.ts; un flag corrected no implica una exactitud garantizada.

Estados de operación: ready, needs-input, unsupported, out-of-domain, failed. Pending, stale y cancelled pertenecen a la ejecución/UI, no al resultado científico.

En una corrección por intervalo se conserva explícitamente la entrada fuera del alcance. Dentro del alcance, una muestra sin requisitos queda NaN con causa; nunca se presenta como corregida usando el original de respaldo sin señalarlo. Los artefactos publicados pueden contener huecos válidos; un fallo estructural invalida el artefacto entero.

La composición propaga flags. Al remuestrear, los flags se derivan de todos los contribuyentes; no se interpolan números de bitmask.

## 6. Ejecución, cachés y concurrencia

### 6.1 Unidad de ejecución

Extender el worker existente con un coordinador de dos etapas: preparación y motor petrofísico. Reutilizar supervisor, canal en proceso y sistema de registro; evitar un worker por operación. El comparador de snapshots usa su supervisor aislado con el mismo coordinador y revisiones fijadas.

La previsualización usa el supervisor aislado existente mediante una cola compartida con la comparación. Preview y snapshots llevan owner/token propios. Un preview no puede resetear el motor activo ni contaminar su caché. Solo una tarea aislada pesada en vuelo; la última solicitada tiene prioridad.

### 6.2 Identidad del contexto

Cada pedido contiene:
- wellId, inputRevisionId, depthKey;
- preparación canónica con versiones de métodos y parámetros efectivos;
- clave de interpretación para resultados petrofísicos;
- clave separada de laboratorio/decisiones/ventanas para calibración;
- gen, seq y un token de trabajo.

La firma por nodo incluye revisión y versión de cada entrada, unidades, índice, metadatos usados, alcance resuelto, versión del método y configuración. Una operación con alcance por zona incluye geometría de esa zona. No recalcular hashes de todos los arrays en cada frame.

Las dependencias de laboratorio no invalidan la petrofísica si ninguna operación activa las consume. Deben invalidar siempre los pares y propuestas que las usan. Cambiar nombre/tema/tamaño de UI no invalida cálculos.

Un ClientResult debe exponer la clave de contexto. La caché de curvas/tablas y los adaptadores del visor verifican esa clave, no solo wellId.

La firma de preparación no incluye fecha de creación ni historial de UI. Un no-op debe reutilizar la referencia del contexto. La clave de petrofísica incluye versiones de las curvas efectivamente elegidas; la clave de calibración incluye también PointSetDecisions, composición/densidades y emparejado. La evidencia archivada no debe provocar recálculos por sí sola.

La extensión del protocolo debe concretar WireCurve, toEngineWell y metadatos de artefactos: incluir unidad, profundidad, versión, linaje de herramientas y origen preparado, además de los campos existentes. El worker mantiene separado el almacén original del contexto preparado entregado a Engine.setWell; no realimentar una salida como original de la siguiente corrida. El modo en proceso ejecuta el mismo coordinador y validadores.

### 6.3 Publicación atómica y recuperación

1. El worker valida revisión y receta.
2. Evalúa el subgrafo afectado; prepara copias de arrays para transferencia.
3. Ejecuta petrofísica con las curvas/fuentes de ese mismo contexto.
4. Emite un paquete completo de manifiestos y resultados, o un error contextual.
5. El cliente reconstruye todos los datos y valida contexto, formas y versiones.
6. Solo entonces publica un contexto efectivo completo.

Nunca transferir buffers que pertenecen al proyecto o a la caché viva del worker: transferir copias de salida y comprobar que los originales no quedan detached.

Resultados de otra revisión, generación o pedido superado se descartan. Un error no permite exportar el resultado anterior bajo parámetros nuevos: se muestra el último válido como histórico y se bloquea exportar como vigente.

Implementar resync: ante un delta incompleto, pedir una respuesta completa del contexto aún vigente; vaciar el ledger de enviados del worker, reconstruir y publicar una vez. Un segundo fallo consecutivo reinicia el supervisor y reenvía entradas y receta. Si vuelve a fallar, terminar con error visible; prohibido un bucle infinito.

### 6.4 Cancelación y límites

Coalescer pedidos no cancela un cálculo síncrono ya en curso. Las operaciones largas deben trabajar por bloques con puntos de cesión al event loop; cancelar en esos puntos. Para algoritmos no interrumpibles, descartar resultados superados y reiniciar el worker aislado si hace falta. No depender de SharedArrayBuffer ni de cabeceras de servidor para file://.

Caché LRU por tamaño real de arrays; punto inicial configurable: 128 MiB por worker, con modo de memoria reducida. Un artefacto mayor al presupuesto puede calcularse sin retener intermediarios; si no cabe en memoria estimada, rechazar antes de iniciar y ofrecer reducir alcance. Medir y ajustar en P0.

## 7. Edición y profundidad: reglas numéricas

### 7.1 Limpieza

- La selección se fija a revisión/curva e intervalos físicos, no a índices de pantalla que puedan cambiar después.
- Remover significa máscara y NaN derivado, nunca borrar filas del índice maestro.
- Restaurar elimina/revierte la decisión correspondiente; no inventa un valor.
- Despike propone candidatos con umbral, ventana física y reporte; aceptación explícita.
- Filtrar e interpolar son pasos separados. No rellenar automáticamente después de excluir.
- Definir para cada filtro respuesta de borde, soporte mínimo, tratamiento de nulos y discontinuidades. El promedio en eje lineal y en log no son equivalentes.
- Nunca transformar banderas/categorías con interpolación lineal. Para resistividad, el espacio lineal o log se declara en el método y la UI.
- Fuera del dominio medido y en huecos superiores al máximo configurado: NaN. No extrapolar por defecto.
- Las fronteras de zona detienen el filtrado/relleno por defecto; atravesarlas requiere una opción explícita y persistida.

### 7.2 Puesta en profundidad

Convención común: z_corregida = z_original + desplazamiento. Un desplazamiento positivo coloca la muestra más profunda.

Para curvas:
1. Obtener la transformación monótona z' = f(z).
2. Verificar misma referencia MD/datum, pendientes positivas y orden.
3. Remuestrear valores desde z' al índice maestro sin cambiar la profundidad de las demás curvas.
4. Conservar transformación, método de remuestreo, máximos de hueco y flags.
5. Invalidar emparejamientos de laboratorio ligados a la curva desplazada.

La entrega inicial acepta desplazamiento constante por corrida. Una deformación variable requiere anclas monótonas y un método validado en una fase posterior; no habilitar un editor libre antes de validarlo. En tramos con desplazamientos distintos, validar juntas y evitar superposición o inversión; no coser discontinuidades con una interpolación implícita.

Para muestras: usar shiftedDepth y runShifts existentes. Tope/base de una muestra intervalar se desplazan juntos. No desplazar dos veces la curva y la muestra respecto de una referencia que ya las puso en profundidad.

El modelo registra referenceId, MD/TVD y datum. Una diferencia de unidad se convierte; una diferencia de datum o MD/TVD requiere transformación física explícita. Sin trayectoria no se ofrece corrección TVD.

La correlación informa cobertura, número de pares, pico, proximidad al borde, picos competidores y ambigüedad. No desplazar automáticamente y no elegir por correlación el mismo desplazamiento que luego se usa como validación independiente sin declararlo.

## 8. Catálogo científico de correcciones

No se fija aquí una fórmula ambiental genérica: seleccionar las herramientas concretas y sus referencias es un entregable de admisión, no algo que el implementador de UI pueda improvisar.

Cada MethodDefinition debe declarar:
- id, versión de algoritmo y de carta/dataset, familia/modelo de herramienta;
- magnitudes de entrada y unidades canónicas;
- condiciones de lodo y adquisición admitidas;
- dominio numérico, interpolación de cartas y política fuera de dominio;
- efectos corregidos, incompatibilidades y estado de corrección esperado;
- incertidumbre publicada o, si no existe, limitación explícita;
- referencia con edición/página, permiso de redistribución y casos de verificación;
- evaluador puro, prueba de límites y fixtures independientes.

| Familia | Datos candidatos; requisitos definitivos según método | Entrega cuando faltan |
|---|---|---|
| GR y GR espectral | herramienta, diámetro, densidad/composición del lodo y geometría | Identificar disponibilidad; no aplicar factor universal. |
| Densidad/PE | herramienta, caliper, standoff, revoque, DRHO y estado del procesado proveedor | Señalar mal contacto/baritina; no sumar DRHO sin conocer si RHOB ya fue corregida. |
| Neutrón | herramienta/escala litológica, diámetro, lodo, salinidad, temperatura/presión según carta | Diagnóstico y requisitos faltantes. |
| Resistividad | inducción/laterolog/arreglo, diámetro, Rm/Rmf/Rmc y temperaturas, geometría | Curvas alternativas/diagnóstico; no convertir AT90 automáticamente en Rt virgen. |
| Sónico | tipo de adquisición y calidad, pozo/lodo según procedimiento documentado | Señalar saltos de ciclo/ruido; no corregir solo por caliper. |

Las entradas de la tabla son una guía de relevamiento, no una afirmación de que cada modelo necesite o permita todas ellas.

### 8.1 Propiedades del lodo y salinidad

Distinguir observación de laboratorio y valor ingresado: Rm (lodo), Rmf (filtrado), Rmc (revoque), temperatura de medición y composición; no tratarlos como Rw.

Registrar concentración, base (% masa/masa, mg/L, equivalente NaCl, etc.) y densidad necesaria para convertir entre bases. No convertir ppm↔mg/L universalmente. Los métodos de temperatura/salinidad especifican solución y dominio; no trasladar una relación de agua salina a lodo base aceite.

Un registro importado que ya está corregido declara efecto/método/proveedor o estado desconocido. Estado desconocido bloquea reaplicar ese efecto hasta que el usuario documente la información o una hipótesis explícita de uso; cualquier hipótesis queda en el ledger y en el informe.

### 8.2 Invasión y revoque

Reutilizar el diagnóstico radial actual, manteniendo su advertencia: usa sensibilidades aproximadas y el diámetro de invasión puede estar mal determinado. No elevarlo por interfaz a una corrección certificada del fabricante.

Mostrar lecturas, modelo, residuo y estados bien determinado/ambiguo/no resuelto/insuficiente. Caliper por sí solo no determina espesor de revoque ni standoff. Cuando varios modelos explican los datos, reportar no unicidad.

Una futura salida Rt/Rxo corregida debe declararse alternativa explícita, con sensibilidad e incertidumbre. Elegirla para la cadena petrofísica requiere aceptación, no ocurre por abrir el panel radial.

## 9. DRX y calibración GR–arcillosidad

### 9.1 Carga y contrato de laboratorio

Agregar lector src/io/xrd.ts reutilizando CSV/xlsx y el mapeo de columnas. Crear PointSet de kind xrd sin forzar sus columnas dentro del esquema core de plugs.

Datos por muestra: id, profundidad puntual o tope/base, corrida/corona, minerales, arcillas totales si están medidas, base composicional, incertidumbre disponible y referencia del informe. Campos numéricos con unidades explícitas. El PointSet conserva valores y metadatos del ensayo; la vista normalizada es derivada.

Las muestras puntuales y las intervalares se distinguen explícitamente. Si la base es uniforme por conjunto se declara en sus metadatos; bases distintas por muestra se representan y validan por fila. La implementación puede separar conjuntos homogéneos, conservando ids y procedencia.

Validar porcentajes 0–100, negativos, fracción vs porcentaje, mineral desconocido, cierres y duplicados. Diferenciar no detectado, bajo límite de detección y no medido: no convertir todos a cero. Los duplicados de profundidad son válidos y no se eliminan por defecto.

Una composición normalizada solo en fracción arcilla describe proporciones entre arcillas; no proporciona arcillas totales de roca. Permitir verla, pero bloquear calibrar cantidad total con ella si falta esa cantidad.

Las tolerancias de cierre se declaran según el ensayo y su precisión. No renormalizar silenciosamente una composición incompleta para llevarla a 100 %.

### 9.2 Base de comparación física

DRX suele entregar fracción másica mineral. Para convertir una composición de roca completa y compatible a fracción volumétrica de sólidos:

~~~text
v_i = (w_i / rho_i) / suma_j(w_j / rho_j)
~~~

Densidades y componentes incluidos quedan registrados. Si falta una parte relevante de la composición, no aplicar esta normalización como si la roca estuviera completa. Porosidad/fluido no se suman como minerales DRX.

La fracción volumétrica de minerales arcillosos en sólidos, la fracción de arcilla en roca total y Vsh como volumen de lutita son cantidades diferentes. El asistente exige un objetivo de calibración:
- contenido de minerales arcillosos en sólidos; o
- un proxy de Vsh con relación constitutiva/normalización declarada.

Por defecto, ofrecer comparación diagnóstica con contenido de arcillas. **Aplicar a Vsh queda deshabilitado hasta declarar la equivalencia adoptada y su alcance.** No inventar una conversión universal entre arcilla y lutita. La relación puede requerir mineralogía del extremo lutítico y porosidad independiente; debe figurar como hipótesis en el informe.

### 9.3 Emparejado profundidad–perfil

Construir una PairTable derivada con muestra, profundidad corregida/intervalo, curva/artefacto, valores representativos, cobertura, dispersión, zona, flags e inclusión.

- Muestra puntual: ventana física elegida o interpolación declarada, sin extrapolación; no tomar “fila más cercana” sin límite de distancia.
- Muestra intervalar: ponderar por espesor representado de los tramos válidos sobre el intervalo. Registrar regla de soporte de la malla y evitar que el espesor total de un hueco se asigne a una muestra vecina.
- Registrar el mínimo de cobertura y soporte máximo entre vecinos; si no se cumplen, excluir el par con motivo.
- No convertir DRX puntual en una curva continua de verdad medida.
- Si una muestra cruza una frontera de zona, excluir por defecto del ajuste zonal y permitir comparación global; una alternativa de asignación debe ser explícita.
- Duplicados técnicos se agrupan o ponderan como una misma localización para ajuste/validación; no contar réplicas como información independiente.

### 9.4 Estimación y propuesta

1. Construir pares con GR de la versión seleccionada y objetivo de laboratorio físicamente declarado.
2. En el caso lineal, ajustar GR = a + b·C con b > 0; extremos propuestos a y a+b. No usar correlación alta como prueba de causalidad.
3. Para cada método Vsh existente, usar su función pura real en una optimización acotada de grClean/grShale. Imponer grShale > grClean y los límites de parámetros vigentes. La implementación debe declarar pérdida, pesos y tolerancias.
4. No calibrar usando como objetivo un Vsh previamente calculado desde el mismo GR. Rechazar esa circularidad.
5. Mostrar número de localizaciones independientes, rango del objetivo, residuo, sesgo, RMSE, dispersión y estabilidad de extremos.
6. Validar mediante bloques de profundidad/corridas si hay soporte suficiente; no usar un reparto aleatorio de muestras vecinas como validación independiente. Con pocos datos se muestra “sin validación independiente”.
7. Si faltan muestras de extremos, hay rango insuficiente, solución en cota o incertidumbre excesiva, marcar ajuste no determinado y bloquear aplicación automática de ambos extremos. Se puede fijar un extremo externo y ajustar el otro con esa hipótesis.
8. Persistir configuraciones y umbrales de admisión; sus valores se fijan con fixtures en la fase DRX, no quedan como constantes ocultas de UI.

La propuesta contiene clave de evidencia, versión del método, parámetros sin redondear, parámetros realmente aplicables con el paso del esquema y métricas recalculadas tras ese redondeo. No recortar silenciosamente parámetros fuera de rango.

### 9.5 Aplicar y auditar

La evidencia fija revisión, selección de GR, preparación, muestras incluidas, profundidad, ventanas, densidades, objetivo, zonas, método y versiones.

Antes de aplicar, comparar esa clave con el contexto vigente. Si cambió, mostrar propuesta obsoleta y exigir recalcular; nunca aplicar un ajuste de otra revisión.

Aplicar es una receta atómica:
- escribe igr.grClean/grShale compartidos y vsh.method en el alcance escogido;
- conserva evidencia de calibración como JSON;
- conserva overrides de otras zonas;
- recalcula la cadena;
- deja una entrada de deshacer.

El preview permite ver impacto en Vsh y resultados disponibles antes de aceptar. Ecuaciones y referencias completas van al módulo Ecuaciones/documentación; la UI operativa muestra valores, alcance y consecuencias.

### 9.6 Cutoffs

Calibrar no cambia vshCutoff, phiCutoff o swCutoff. Un panel separado permite explorar sensibilidad y comparar muestras/facies/plugs. “Aplicar cutoff” tiene su propia receta y evidencia.

Mostrar que un umbral de arcillosidad es un criterio operativo de clasificación; DRX por sí solo no demuestra permeabilidad, calidad de reservorio o pay. Reutilizar sensibilidad existente y no duplicar el cálculo de netos.

## 10. Interfaz y flujo de trabajo

Agregar “Preparar datos” entre carga/QC e interpretación, con acceso posterior sin perder decisiones. Un usuario puede interpretar sin correcciones si lo decide; no marcar automáticamente todos los datos como malos.

Pantalla:
- izquierda: curvas y cadena de operaciones, estados y dependencias;
- centro: original/preparada, diferencia, muestras de laboratorio y máscaras;
- derecha: parámetros, dominio, procedencia, datos faltantes y alcance;
- pie/panel: comparación de calidad e impacto petrofísico del borrador.

Acciones: previsualizar, aceptar, cancelar, desactivar, volver a original y deshacer. Mostrar qué se conservará/modificará antes de aceptar una operación con descendientes. Teclado y tacto deben permitir seleccionar intervalos y operar controles sin depender exclusivamente del arrastre.

Los sliders usan un id de gesto desde pointerdown hasta pointerup/cancel y equivalentes de teclado. Una pausa no divide un arrastre en varias entradas de deshacer; Escape restaura el estado anterior.

La UI muestra términos del usuario: “Original”, “Preparada”, “Estimado”, “Faltan datos”, “Fuera del rango del método”. No mostrar hashes, nombres de worker o claves de caché en el flujo normal.

## 11. Persistencia, migración y exportación

### 11.1 Formato propuesto v7

Confirmar que v7 sigue libre al empezar la implementación; si otro PR lo usa, elegir la siguiente versión y actualizar este documento.

La migración v1–v6:
1. Ejecuta migraciones existentes.
2. Crea una revisión inmutable para el Well actual de cada pozo.
3. Agrega preparación vacía y metadatos de adquisición desconocidos.
4. Asocia snapshots antiguos a esa revisión, declarando que el formato anterior no preservaba revisiones históricas de datos; no puede reconstruirlas.
5. Mantiene números/NaN, unidades, fuentes y resultados previos sin preparación.

Guardar originales/revisiones, recetas y evidencias; no serializar arrays preparados ni resultados como si fueran mediciones. Deduplicar blobs y guardar codec, longitud e integridad. Reusar codec Float64; agregar codec tipado para máscaras solo si es necesario persistirlas como decisiones, nunca convertirlas accidentalmente a floats.

Abrir valida esquemas, ids, referencias, tamaños, límites de descompresión y versiones. Una operación desconocida se conserva como receta no ejecutable y bloquea solo sus descendientes; no eliminarla silenciosamente. Una revisión corrupta impide ejecutar sus dependencias sin destruir otras revisiones válidas. Ofrecer diagnóstico y exportar el proyecto para recuperación.

Cada método permanece versionado; abrir un proyecto con método antiguo no lo actualiza en silencio. Si ya no puede ejecutarse, informar incompatibilidad. Una actualización explícita crea una nueva decisión y permite comparar.

### 11.2 Exportar resultados consistentes

CSV/LAS/xlsx permiten elegir original, preparada y ambas con nombres distintos. Incluir unidades, transformaciones, efectos aplicados, método y revisión. En formatos con metadatos insuficientes, adjuntar manifiesto JSON legible enlazado por nombre/id; el informe HTML autocontenido embebe esa información.

Exportar desde un contexto fijado al pulsar el botón. Si el usuario cambia parámetros mientras se genera, terminar y rotular la versión fijada o cancelar; nunca mezclar arrays de dos contextos.

Separar equivalencia numérica y binaria: ida/vuelta de datos originales debe conservar su representación de archivo; derivados deben reproducirse con tolerancias declaradas por método y entorno, sin prometer igualdad de coma flotante bit a bit entre navegadores.

## 12. Mapa de archivos y límites de cambios

| Área propuesta | Responsabilidad |
|---|---|
| src/core/preparation/{types,registry,plan,quality,context}.ts | Contratos, referencias y validación pura. |
| src/core/state/{inputRevisions,preparation,calibration}.ts | Recetas atómicas y revisiones de entradas. |
| src/preparation/{evaluate,depth,cleaning,environment}.ts | Algoritmos puros; ninguna dependencia React/store. |
| src/preparation/methods/<id>/ | Evaluador, esquema, dominio, referencia y fixtures de cada corrección. |
| src/io/xrd.ts | Lectura y mapeo DRX; reutiliza tabla CSV/xlsx. |
| src/petro/xrdCalibration.ts | Emparejado/ajuste y métricas, reutilizando funciones IGR/Vsh existentes. |
| src/modules/xrd-calibration/ | Panel, superposición, documentación y comandos; sin lógica científica en JSX. |
| src/app/preparation/ | Editor, preview, comparación y conexión con stores. |
| tests/preparation/, tests/io/xrd.test.ts | Casos científicos y de integración. |
| docs/decisiones/ | ADR de contexto, persistencia, DRX y cada método científico. |

Cambios transversales previstos: well.ts (metadatos/origen), interpretation.ts, project.ts, serialize.ts, snapshots.ts y snapshotCompare.ts; protocol/client/serve/supervisor/engineBridge; graph/explicitSource; toolString y selectores; computed.ts, resolve del visor, plots/context, exportación, informe y snapshots/runner.

Cada PR debe enumerar qué consumidor fue migrado y cómo se probó. No implementar un filtro propio en cada panel. Los nombres de ADR se eligen revisando la numeración vigente para no colisionar.

## 13. Secuencia de implementación y puertas de salida

No estimar fechas antes de P0 y del inventario de herramientas. No ejecutar fases científicas en paralelo con contratos de datos todavía inestables.

| Fase | Entregable | Dependencias | Puerta de salida |
|---|---|---|---|
| P0 | Línea base, inventario de herramientas/datos, métricas, fixtures antiguos y ADR de contratos | ninguna | Reproducir build/typecheck/tests y documentar fallos previos; esquema y criterios medibles acordados en repo. |
| P1 | Revisiones de entradas, snapshot fijado y migración v7 | P0 | Restaurar un snapshot tras importar/modificar laboratorio reproduce la revisión anterior; round-trip antiguo sin preparación. |
| P2 | Grafo de preparación, contexto efectivo, protocolo y resync | P1 | Un nodo identidad reproduce el flujo anterior; no hay mezcla de revisiones ni fallback oculto. |
| P3 | Limpieza, calidad y alineación constante; editor y preview | P2 | Original intacto, huecos preservados, undo/redo y exportación coherentes; teclado/tacto. |
| P4 | DRX diagnóstico: carga, bases y pares | P3 | Casos masa/volumen/fracción arcilla/intervalos validados; comparación sin falsa equivalencia con Vsh. |
| P5 | Calibración GR y cutoffs con evidencia | P4 | Recuperar parámetros conocidos, rechazar no identificables, invalidar propuesta obsoleta y aplicar por zona sin tocar cutoffs automáticamente. |
| P6 | Catálogo ambiental y primer método científico validado | P3 + inventario P0 | Una herramienta concreta con referencia y casos independientes; métodos no admitidos siguen bloqueados. |
| P7 | Más correcciones de pozo/rugosidad/salinidad y diagnóstico invasión/revoque integrado | P6 | Matriz de compatibilidad y doble corrección cubierta; cada método tiene su propia puerta científica. |
| P8 | Cierre de entrega, informe/manual y prueba offline | P5 y alcance admitido de P7 | Flujo completo con proyecto real y sintético, exportación reproducible y regresión del resto de módulos. |

La geometría variable por anclas se incorpora después de P3 como subfase con sus propias pruebas; no condiciona la primera calibración DRX si bastan desplazamientos constantes.

### Primer PR de implementación

P0 solamente: fixtures y pruebas de caracterización, métricas en equipo documentado y ADR que concrete las estructuras serializadas/protocolo de este plan. No agregar sliders ambientales ni fórmulas sin cerrar las revisiones y el contexto.

### Integración con pendientes previos

| Pendiente anterior | Tratamiento |
|---|---|
| resync de resultados incompletos | Requisito de P2. |
| Agrupación de sliders por gesto y selección sin mouse | Requisito de P3; reutilizarlo en el inspector existente. |
| Prioridad de VSH/PHIE/SW importados | Resolver con diagnóstico explícito y política de importación en P2; sin reinterpretar proyectos antiguos silenciosamente. |
| Comparación en cascada de métodos | El preview aislado compara dos estados completos. Los slots múltiples del motor siguen como ampliación; no afirmar que compare actual ya propaga alternativas. |
| Elegir módulos diferentes por zona | Fuera del núcleo de este plan; no confundir parámetros zonales de IGR/Vsh con fuentes zonales Archie/Simandoux. |
| Pc–Sw real, check-shot en UI y corrección PHIE con corona | Backlog separado; la infraestructura nueva debe admitirlos sin fingir que este plan los implementa. |
| Manual/video/nombre FiubaLog, PR #30 | Coordinar documentación al integrar; no depender de que esté mergeado para implementar datos. |

## 14. Matriz mínima de verificación

| Caso | Resultado exigido | Nivel |
|---|---|---|
| Preparación vacía sobre proyecto v6 | Mismas fuentes, arrays y resultados que antes | Regresión de integración |
| Nodo identidad y cambio de unidad equivalente | Resultado equivalente y ningún cambio del original | Numérico |
| Picos junto a una capa delgada real | Candidatos revisables; no destruir la capa por defecto | Fixture geológico |
| Exclusión de un tramo y filtro | NaN conserva hueco salvo interpolación explícita admitida | Numérico |
| Desplazamiento +2 m | Evento/muestra aparece 2 m más profundo; signo coincide en curva y DRX | Numérico + UI |
| Desplazamiento que invierte anclas | Rechazo sin mutación | Validación |
| Reordenar dos operaciones no conmutativas | Vista previa distinta y procedencia correcta | Integración |
| Corregir RHOB ya procesada con DRHO | Bloqueo o hipótesis documentada según dominio, nunca doble suma silenciosa | Científico |
| Salinidad masa/volumen sin densidad | Conversión bloqueada con datos faltantes | Unidades |
| Método aplicado fuera de su carta | Estado fuera de dominio, sin extrapolación oculta | Científico |
| Invasión con múltiples soluciones | Ambigüedad/intervalo, no Rt “verdadera” garantizada | Científico |
| DRX fracción arcilla = 100 % | No interpretarlo como roca con 100 % arcilla | Laboratorio |
| Mezcla conocida con densidades distintas | Conversión masa→volumen recupera composición de referencia | Numérico |
| DRX puntual/intervalar junto a hueco o frontera | Cobertura y asignación correctas; par excluido si insuficiente | Numérico |
| GR=a+b·C sintético y b>0 | Recupera extremos en tolerancia; si no hay rango, no certifica extremos | Calibración |
| Cambiar desplazamiento/DRX después del ajuste | Propuesta obsoleta; Aplicar bloqueado hasta recalcular | Integración |
| Calibrar por zona | Solo escribe alcance elegido; no cambia cutoff | Estado |
| Apagar herramienta con descendiente preparado | Misma indisponibilidad en cálculo, UI y exportación | Integración |
| Recibir resultado viejo del mismo wellId | Se descarta por contexto | Protocolo |
| Perder un delta de salida | resync reconstruye o falla de forma acotada sin publicar mezcla | Inyección de fallo |
| Caída de worker/cancelación/importación concurrente | Proyecto intacto; replay del contexto actual o error visible | Inyección de fallo |
| Aceptar → undo → redo → guardar/abrir | Mismas recetas, entradas y fuentes; derivados equivalentes | Persistencia |
| Snapshot antes de borrar datos DRX | Snapshot recupera revisión y evidencia anteriores | Integración |
| Exportar mientras cambia un slider | Archivo de una sola versión identificable | Exportación |
| HTML único abierto por file:// sin red | Carga, preparación, DRX, gráficos y exportación funcionales | Navegador |

Los valores esperados de pruebas científicas deben proceder de cálculo independiente, publicación/carta o fixture analítico, no de llamar dos veces al mismo código.

Comandos vigentes a ejecutar en cada PR según alcance: npm run typecheck, npm test y npm run build. Si hay fallos previos, reproducir sobre la misma base y entorno, documentarlos y no ocultarlos ampliando tolerancias sin justificación.

### Rendimiento: presupuestos iniciales

En P0 registrar navegador, CPU, memoria y calentamiento; usar el mismo entorno para comparar. Son objetivos de admisión que deben medirse, no resultados ya obtenidos:
- fixture de 50.000 muestras × 20 curvas;
- respuesta visual a gestos p95 < 100 ms; ninguna transformación pesada en hilo principal;
- recomputación de un paso local p95 < 500 ms en equipo de referencia;
- métodos científicos más lentos: progreso visible y cancelación reconocida p95 < 250 ms en límites de bloque;
- medir memoria máxima incluyendo originales, caché y copias transferidas; respetar presupuesto LRU;
- HTML autocontenido sin descargas en runtime; registrar delta de tamaño por carta/dataset.

Pruebas de rendimiento separadas de la exactitud numérica; evitar que un contenedor lento produzca cambios científicos para satisfacer un tiempo arbitrario.

### Escenarios completos de aceptación

**A. Preparación + DRX:** abrir v6 → crear revisión inicial → excluir picos → desplazar GR +2 m → importar DRX → declarar base de roca total → emparejar → proponer calibración → inspeccionar impacto → aplicar por zona → guardar → cerrar/abrir → exportar. Verificar originales intactos, una única versión de profundidad y parámetros reproducidos; el cutoff no cambia.

**B. Evidencia histórica:** snapshot antes de importar DRX → importar laboratorio → calibrar → crear otro snapshot → borrar el conjunto activo → comparar ambos snapshots. Cada uno usa sus entradas fijadas; ninguno toma el laboratorio más reciente por wellId.

**C. Fallo durante un gesto:** iniciar preview de corrección → cambiar pozo → recibir resultado anterior → regresar → aceptar una nueva operación → simular caída del worker. El primer preview se descarta; la operación aceptada se reconstruye desde su receta; la UI no exporta resultados anteriores con el contexto actual.

## 15. Riesgos y decisiones que no se pueden improvisar

| Riesgo | Prevención y respuesta |
|---|---|
| Datos ambientales insuficientes | Estado needs-input; diagnóstico disponible; corrección deshabilitada. |
| Fabricante/modelo desconocido | Catálogo marca unsupported; seleccionar modelo con procedencia antes de calcular. |
| Mala equivalencia DRX–Vsh | Objetivo físico explícito, conversión auditada y Aplicar bloqueado si falta relación. |
| Snapshot con datos nuevos | Revisiones fijadas, sin resolver contra Well activo por conveniencia. |
| Pérdida de máscaras durante remuestreo | Propagación de contribuyentes probada con fixtures. |
| Corrección que mejora el ajuste pero distorsiona geología | Validación independiente por intervalos y comparación de capas/huecos. |
| Dependencia circular temperatura/corrección/interpretación | Grafo de preparación sin entradas del motor; rechazo de ciclo. |
| Uso de curvas preparadas ocultas por sarta | Linaje y resolución centralizada, sin inferir propietario por sufijo. |
| Memoria por revisiones y comparación | Blobs compartidos, LRU y límites de archivo; sin duplicar datos por cada slider. |
| Cartas no redistribuibles | No incrustarlas; buscar método autorizado o declarar no disponible. |
| Documento que diverge del código | Cada PR actualiza estado, ADR, matriz y evidencia del método implementado. |

Decisiones científicas pendientes de evidencia, con responsable de resolución dentro de la fase:
- P0/P6: identificar modelos reales de herramientas y si las curvas del TP ya traen correcciones.
- P4: conocer formato de DRX, base composicional, tipos de muestras y errores del laboratorio.
- P5: documentar la relación objetivo arcilla–lutita y criterios de identificabilidad.
- P6/P7: elegir referencias concretas y rangos de cada corrección ambiental.

Estas incertidumbres no impiden construir P1–P3. Sí impiden declarar científicamente disponibles métodos concretos sin resolverlas.

## 16. Definición de terminado

Una fase solo se marca implementada cuando:
1. Sus contratos y migraciones están escritos y validados.
2. Sus pruebas de la matriz pasan junto con las regresiones pertinentes.
3. El build autocontenido funciona offline y por file://.
4. Original/preparada, máscaras, fuentes y exportaciones coinciden en contexto.
5. Revisión numérica y revisión de integración registran evidencia y defectos resueltos antes del merge. Si trabajan varias personas/agentes, quien valida un método científico debe ser distinto de quien lo implementa.
6. El PR enumera herramientas/métodos admitidos, datos necesarios y limitaciones reales.
7. Documentación, manual y estado de los issues se actualizan sin cerrar requisitos pendientes.

**Estado de ejecución al crear este documento: todas las fases P0–P8 están pendientes.** La inspección del código para redactar el plan no sustituye la línea base ejecutada de P0. Este PR es documental y no implementa #31 ni #32.
