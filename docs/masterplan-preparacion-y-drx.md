# Masterplan: preparación de datos, correcciones y calibración con DRX

> **Condición de avance (2026-10-28): preservar funcionalidad, proyectos y resultados existentes.** La nueva interfaz se incorpora primero como preset opcional; los cambios visuales y científicos se entregan en PR separados, con comparación contra una base fijada y criterios de regresión. Ver sección 19. Esta condición prevalece sobre cualquier sugerencia anterior de cambiar automáticamente los presets existentes.

- Estado: arquitectura y secuencia de implementación, con avances en ramas de revisión detallados al final. **No implica que las funciones nuevas estén disponibles en main; ningún PR de esta secuencia fue integrado.**

- **Avance actual (2026-10-31): P5 implementada y validada en la cadena de revisión hasta [PR #54](https://github.com/lgarciav1/interpretaci-n-pozo/pull/54), sin integrar main.** GR y cutoffs tienen aceptación/evidencia separadas. La sección 39 precisa el cierre y corrige la caracterización de extensiones como bloqueantes en las secciones 37–38; campaña real sigue en la puerta P8.


- **P6 en curso:** [PR #55](https://github.com/lgarciav1/interpretaci-n-pozo/pull/55) agrega catálogo de relevamiento y declaraciones reversibles de adquisición. Ningún método numérico admitido todavía; la puerta P6 permanece abierta. Ver sección 40.


- **Bloqueo actual de P6:** [PR #56](https://github.com/lgarciav1/interpretaci-n-pozo/pull/56) documenta la evaluación de admisión y la evidencia faltante del primer método; no hay evaluador numérico admitido. Ver sección 41.

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


## 17. Dirección visual del visor: claridad y separación de pistas

Requisito incorporado a partir de la referencia fotográfica compartida por la usuaria: **un visor más vistoso y claro, con perfiles que no se empasten**. Seguimiento: [#34, rediseño del visor](https://github.com/lgarciav1/interpretaci-n-pozo/issues/34).

La foto permite apreciar fondo claro, pistas delimitadas, encabezados propios y rellenos localizados. No permite inferir con certeza producto, escalas o controles. No se adjuntó la foto al repo; esta descripción conserva la intención observable.

### Decisiones de presentación

- Dar al perfil la mayor superficie útil, con inspector y dock colapsables y modo de lectura amplio.
- Definir un ancho mínimo por tipo de pista. Cuando no entren, usar desplazamiento horizontal o un preset elegido; no comprimir todas las pistas indefinidamente.
- Jerarquía visual: curva principal nítida, alternativas distinguibles por patrón/color, grilla secundaria tenue y rellenos con opacidad contenida.
- Encabezados con nombre, unidades, escalas y límites sin colisiones; profundidad y encabezados accesibles al desplazarse.
- Mantener las superposiciones que aportan interpretación (densidad–neutrón/cruce de gas, resistividades); dividir pistas cuando la mezcla no aporte lectura.
- Original/preparada por alternancia o lado a lado. No superponer todas las versiones automáticamente.
- Ofrecer vistas de lectura general, petrofísica, preparación/QC y geología. Cambiar vista afecta solo display, nunca parámetros, fuentes ni resultados.
- Preservar picos, huecos, escala log y avisos fuera de escala. La claridad no se obtiene con suavizado científico implícito.
- Mantener claro/oscuro, acceso por teclado y leyendas sin dependencia exclusiva del color.
- Reutilizar renderer, tokens y contratos de pistas existentes; el rediseño no justifica un segundo visor con semántica distinta.

### Entrega visual independiente

| Paso | Resultado verificable |
|---|---|
| V0 | Capturas actuales del TP con rango, fuentes, escalas y tamaño fijados. |
| V1 | Dos propuestas con los mismos datos: lectura amplia y trabajo con inspector; revisión visual antes de extender el estilo. |
| V2 | Implementación de jerarquía, anchos/presets y comparación de versiones; capturas antes/después y exportación verificada. |

Este frente puede comenzar sobre el visor actual sin esperar P6/P7. La comparación original/preparada se conecta a P3 cuando esté disponible. La implementación visual mantiene el planificador de fuentes y el contexto común de I11.

Aceptación: capturas a 1366×768 y 1920×1080, DPR 1/2 y temas claro/oscuro; sin colisiones de encabezados ni pistas por debajo de su ancho mínimo; curvas densidad–neutrón y resistividades legibles; mismos valores y extremos; scroll y controles accesibles; figura exportada coherente. Comparar versiones con idéntico rango de profundidad para no atribuir a diseño una mejora causada solo por zoom.

**Estado V0–V2: pendiente.** Este agregado documenta la dirección visual, no modifica la aplicación.


## 18. Revisión visual ejecutada sobre la aplicación

Revisión del 2026-10-27 sobre main 4f187f6a8d585475efc79b18ed89194b432a2116, pozo TP incluido (5.810 muestras), tamaño de interfaz Normal y presets de fábrica. Se reconstruyó el código desde GitHub, se ejecutó npm ci/npm run build y se abrió el build con Chromium/Playwright por HTTP local. El navegador administrado bloqueó file://; por ello no se verificó apertura por doble clic. No se modificó código funcional ni configuración científica.

Se inspeccionaron capturas a 1920×1080 y 1366×768, temas claro/oscuro, paneles abiertos/colapsados, zoom y Geología. No se detectaron excepciones de página en esos recorridos; esto no sustituye tests de regresión ni una revisión de todas las funciones.

### Hallazgos medidos

| Prioridad | Evidencia | Acción de diseño |
|---|---|---|
| Alta | La pista Interpretación tiene 47 curvas asignadas: tres filas y un botón +44. Mezcla VSH/IGR con salidas como impedancia, TOC, tiempo, mineralogía y alternativas. Visualmente aparece como una franja casi opaca. | Sustituir el recolector automático como vista principal por pistas elegidas por tarea. Detectar nuevas salidas y ofrecerlas en catálogo; no dibujarlas todas automáticamente. |
| Alta | A 1366×768, paneles abiertos: visor externo ≈653 px de ancho, ventana horizontal de curvas ≈604 px y dibujo de solo ≈184 px de alto. El canvas total es de 1250 px y se desplaza horizontalmente. | Modo de lectura accesible en una acción, dock contextual y jerarquía que priorice área útil de curvas. |
| Alta | Con ambos laterales y dock colapsados, la ventana horizontal pasa a ≈1199 px y el dibujo a ≈348 px de alto, pero las pistas mantienen sus anchos mínimos y la franja de Interpretación sigue saturada. | Reorganizar contenido y definir anchos según complejidad; colapsar paneles por sí solo no resuelve el problema. |
| Media | Se abre el intervalo completo 7633,3–8518,6 m: ≈885 m en 184 px de dibujo en notebook. Tras seis pasos de zoom, 7959,9–8191,9 m se distingue mejor, aunque persiste el solapamiento de Interpretación. | Separar vista panorámica y vista de trabajo por intervalo; conservar un minimapa de todo el pozo. No suavizar datos para simular claridad. |
| Media | Títulos truncados (Densidad · ne…, Interpretac…, Permeabilid…) y leyendas largas de Banderas/Indicadores se aproximan o invaden pistas vecinas. | Encabezados compactos legibles, clipping por pista y leyendas extensas en panel controlado. |
| Media | Densidad–neutrón incorpora PE/DRHO; Porosidad–Sw tiene curvas y relleno dominantes. | Preset simple con RHOB/NPHI y detalles PE/DRHO a demanda o en pista auxiliar; mantener significado del cruce de gas. Revisar opacidades y jerarquía de líneas. |

### Corrección del diagnóstico preliminar

Ya existen mínimo de ancho y scroll horizontal en src/viewer/layout.ts (MIN_TRACK_WIDTH = 104 en escala base), además de paneles colapsables y modos de tema. No corresponde implementarlos nuevamente como si faltaran. Con tamaño Normal, varias pistas quedan en ≈117 px y la de densidad–neutrón en ≈129 px. El problema comprobado es la selección automática excesiva de contenido, la jerarquía y el área útil inicial.

La causa del recolector se localiza en src/viewer/templates.ts (collect: computed) y src/viewer/resolve.ts (agrega salidas no ubicadas en otras pistas). En Geología también se observó ese recolector y un conjunto mayor de pistas. La solución debe preservar descubrimiento de módulos nuevos mediante catálogo, sin convertir cada salida nueva en una superposición visible por defecto.

### Ajuste de prioridades de V1/V2

1. Diseñar un preset Petrofísica esencial con GR, profundidad, resistividades seleccionadas, RHOB/NPHI, Vsh, porosidad/Sw y resultados relevantes. Herramientas avanzadas y alternativas permanecen recuperables.
2. Comparar contra fábrica con el MISMO intervalo, escala y fuentes; cualquier cambio de contenido queda listado.
3. Separar vista general de interpretación detallada y ofrecer modo amplio en una acción.
4. Corregir encabezados/leyendas y revisar trazos/rellenos.
5. Verificar datos, interacciones y figura exportada antes de integrar.

La revisión parcial de build y navegador aporta evidencia a V0, pero no completa P0 ni V0–V2: faltan la caracterización completa, DPR 2, verificación de exportación y las propuestas de rediseño. Los resultados científicos obtenidos con parámetros de fábrica no se consideran calibrados por esta revisión.


## 19. Condición de avance: compatibilidad y prevención de regresiones

Incorporada el 2026-10-28 por pedido explícito de la usuaria: avanzar sin romper el software ni producir un retroceso. Es una condición de aceptación del trabajo, no una garantía imposible de cero defectos.

Esta sección precisa y, en caso de conflicto, prevalece sobre las recomendaciones anteriores de reemplazar la selección automática o los presets de fábrica.

### 19.1 Conservar lo existente y añadir una alternativa comprobable

- El primer rediseño se entrega como preset opcional “Petrofísica esencial”, reutilizando el mismo renderer y motor.
- Mantener el preset anterior como “Clásico” para comparar y volver en una acción. No mantener dos renderers con reglas científicas diferentes.
- Abrir un proyecto existente conserva pistas, orden, anchos, colores, escalas, unidades, curvas visibles, fuentes y parámetros guardados. No aplicar el preset nuevo durante la migración.
- Si un proyecto antiguo no tiene una configuración explícita de pistas, materializar la configuración efectiva de su versión al migrarlo; no interpretar “ausente” como permiso para sustituirla por el preset nuevo.
- Todas las curvas, módulos, alternativas y herramientas siguen disponibles desde el catálogo y los controles existentes. Reducir curvas visibles en el preset opcional no elimina resultados ni módulos.
- El recolector y el descubrimiento de módulos se revisan separando disponibilidad de presentación. El preset Clásico conserva la posibilidad de ver las salidas anteriores.
- Paneles y dock permanecen accesibles. El modo amplio cambia solo disposición de UI; no toca el proyecto ni fuerza guardar otra vista.
- Cambiar el preset por defecto para proyectos nuevos se trata como decisión de entrega posterior, sustentada por la comparación visual y las regresiones. Nunca modifica silenciosamente proyectos guardados.

### 19.2 Separar entregas para atribuir cada cambio

Orden de integración:
1. PR de caracterización: fijar commit base, fixtures, resultados y capturas; identificar defectos previos.
2. PR visual: preset opcional y distribución de espacio, sin nuevas fórmulas, limpieza automática, cambios de fuentes ni migraciones científicas.
3. PR de correcciones de encabezados/leyendas y estilo, con mismas entradas y comparación.
4. PR de infraestructura de preparación: revisiones, persistencia y protocolo, con preparación vacía equivalente al flujo anterior.
5. PR de limpieza/alineación y luego DRX/correcciones según P3–P8, cada método con su validación.

Los ajustes visuales pueden adelantarse a P1–P7 porque no dependen del nuevo formato; no deben arrastrar una migración de datos innecesaria. El orden P1–P8 sigue vigente para la infraestructura científica.

Cada PR es pequeño, tiene una responsabilidad y puede revertirse aisladamente. Evitar mezclar refactor amplio, cambios de interfaz y ecuaciones en una misma entrega. Un cambio científico justificado se presenta como tal, con antes/después y fuente independiente; no se disfraza como ajuste visual.

### 19.3 Puertas de integración

| Área | Evidencia necesaria para aceptar |
|---|---|
| Cálculos | El PR visual produce los mismos arrays, nulos, flags, fuentes y sumarios para el mismo contexto. La preparación vacía también conserva los resultados anteriores. |
| Funcionalidad | Carga CSV/LAS/xlsx; visor y pistas; QC; zonas; tendencias; MDT; corona; histograma/crossplot; módulos; sarta; snapshots; undo/redo; guardado/apertura y exportaciones siguen operativos en los recorridos afectados y el smoke test general. |
| Proyectos | Fixtures de formatos anteriores abren con la configuración efectiva conservada. Guardar/abrir no pierde datos, decisiones, módulos ni referencias. |
| Gráficos | Mismos valores, picos, huecos, escalas lineal/log y superposiciones interpretativas necesarias. El cambio de vista no dispara una modificación científica. |
| Presentación | Comparación con igual pozo, rango, escalas y fuentes; cambios de curvas visibles listados. Capturas en notebook/pantalla amplia, claro/oscuro y DPR 1/2. |
| Exportación | Las columnas y resultados numéricos son equivalentes. La figura respeta la vista elegida, con unidades y leyendas correctas. |
| Robustez | Cambio de pozo, undo/redo, redimensionado y respuesta atrasada no mezclan estados. Probar recuperación del worker cuando lo modifique el PR. |
| Rendimiento | Medición comparable contra base en el mismo entorno, con memoria/tamaño de build. La tolerancia admisible se fija en P0 antes del cambio, no después de ver un deterioro. |
| Entrega | Typecheck, suite pertinente, regresión general acordada y build pasan, o los fallos anteriores están reproducidos en la base y claramente separados. No ajustar pruebas para ocultar una regresión nueva. |

Que un test pase no demuestra por sí solo que una interfaz sea más clara. La aceptación visual incluye inspección de capturas y recorridos reales; la aceptación científica incluye casos independientes.

Un fallo nuevo de corrección numérica, pérdida de datos, fuente incorrecta, exportación inconsistente o función inaccesible bloquea la integración. Un defecto previo se registra y no se atribuye a la nueva entrega; tampoco justifica añadir otro.

### 19.4 Reversión y formatos

- Mantener main sin cambios funcionales hasta que la entrega cumpla sus puertas; este PR de masterplan continúa siendo documental.
- El preset Clásico permanece seleccionable para revertir la presentación sin perder decisiones.
- Antes de una migración de archivo, conservar una copia del proyecto de entrada y verificar la nueva versión en fixtures. Nunca sobrescribir la única copia legible por la versión anterior.
- Revertir el código no convierte mágicamente v7 en v6. Definir compatibilidad de archivo por entrega y conservar el build anterior y su archivo compatible como punto de recuperación.
- No ofrecer “guardar como v6” si requiere descartar recetas, revisiones o evidencia sin representación. Rechazar la conversión o entregar una exportación explícitamente limitada; nunca llamarla copia íntegra.
- Operaciones nuevas permanecen inactivas hasta elección del usuario. Abrir un panel o seleccionar una muestra no aplica una corrección.

### 19.5 Estado verificable al incorporar esta condición

Existe masterplan, revisión de contratos y revisión visual sobre main 4f187f6. El build revisado pasó y los recorridos de navegador descritos en sección 18 no registraron excepciones de página. **La suite completa de regresión y la compatibilidad v7 todavía no fueron ejecutadas/implementadas.**

Por tanto, el siguiente paso de código es caracterizar y comprobar la base, seguido por un preset visual opcional. Este documento no afirma que las garantías de integración ya estén demostradas ni autoriza cerrar #31, #32 o #34 solo por completar documentación.


## 20. Avance preparado para revisión (2026-10-28)

Primera entrega de código, separada según sección 19:

1. [PR #35: línea base de compatibilidad](https://github.com/lgarciav1/interpretaci-n-pozo/pull/35). Dos pruebas nuevas de caracterización, sin modificar la app. Base aislada: 2.373 pruebas en 144 archivos, sin fallos ni omisiones con un worker.
2. [PR #36: Petrofísica esencial opcional](https://github.com/lgarciav1/interpretaci-n-pozo/pull/36), basado en la rama de #35. Cambia solo selección de pistas de display y su menú; conserva fábrica predeterminada, proyectos v6, curvas adicionales y renderer/motor existentes. Candidato: 2.386 pruebas en 145 archivos, typecheck y build aprobados.

Recorrido Chromium: vista clásica del candidato con iguales encabezados/geometría/rango que el build base; LAS exportados por UI idénticos por SHA-256; undo/redo, guardar/abrir y SVG comprobados; claro/oscuro, 1366×768/1920×1080 y DPR 1/2 inspeccionados. Se incluyen capturas comparables y verificador reproducible en #36. file:// permanece sin verificar por bloqueo del navegador administrado.

Orden de integración: revisar/integrar #35 primero y luego retargetear #36 a main. **Ninguno fue mergeado por el agente.** Las correcciones ambientales, DRX y la migración v7 siguen sin implementar. El espacio vertical, modo amplio en una acción y panorama/detalle siguen pendientes de #34.

Esto aporta evidencia a P0 y al primer tramo visual V0–V2; no declara completada toda P0 ni el masterplan.


## 21. Lectura amplia preparada para revisión (2026-10-28)

[PR #37](https://github.com/lgarciav1/interpretaci-n-pozo/pull/37), apilado sobre #36: botón de lectura amplia reversible y encabezados compactos limitados al modo. Conserva la disposición elegida sin escribir preferencias transitorias ni cambiar proyecto v6, historial, motor o datos. Abrir paneles/editores recupera la vista normal; recargar deja lectura desactivada.

Con el mismo TP, preset e intervalo completo, a 1366×768 el alto útil pasa de 183,56 a 474,86 px (2,59×). La vista normal conserva exactamente la geometría medida del padre. LAS del padre frente a lectura y SVG normal frente a lectura resultaron idénticos byte a byte. Las preferencias normales y personalizadas se recuperan; las 47 curvas de fábrica siguen accesibles por su popup.

Verificación final: **2.400 pruebas en 146 archivos**, sin fallos/omisiones; typecheck/build aprobados. Recorrido Chromium claro/oscuro, 1366×768 y 1920×1080, DPR 1/2, teclado, editores y Geología, sin excepciones de página. HTML +2.167 bytes, sin nuevas dependencias de producción. [Capturas, hashes, límites y script reproducible](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/lectura-amplia/docs/validacion/2026-10-28-lectura-amplia.md). file:// continúa sin verificar por bloqueo del navegador administrado.

Orden de integración: #35 → #36 → #37, revisando y retargeteando las ramas según se integren sus bases. Main permanece intacto; ninguno fue mergeado por el agente. Quedan panorama/detalle y refinamiento visual en #34, además de calibración DRX (#31), preparación/correcciones (#32) y la compatibilidad de los formatos futuros. Esta entrega no declara completo el masterplan.


## 22. Intervalos de profundidad sin integración (2026-10-28)

[PR #38](https://github.com/lgarciav1/interpretaci-n-pozo/pull/38) se basa en la rama de #37, respetando el pedido explícito de continuar sin integrar ni mergear PRs. Convierte el indicador del rango visible en un selector de tope/base con ventanas de 50/100 m, recorrido anterior/siguiente con 10 % de contexto compartido y vuelta al pozo completo. Reutiliza el viewport y el minimapa ya existentes; no agrega otro renderer.

El selector valida las entradas antes de aplicar, conserva precisión y solo modifica la vista temporal. Teclado, errores, bordes del pozo y sincronización del minimapa se comprobaron en Chromium, en Petrofísica y Geología, vista normal y lectura amplia. Las capturas muestran el mismo TP completo y el detalle 7800,5–7850,5 m.

Validación: **2.418 pruebas en 147 archivos**, sin fallos/omisiones; typecheck/build aprobados. El recorrido de regresión de #37 mantiene la geometría normal y preferencias. Proyecto, LAS completo y SVG de todo el pozo son idénticos antes/después de navegar; el SVG del tramo visible respeta el intervalo elegido. Claro/oscuro, 1366×768/1920×1080 y DPR 1/2, sin excepciones de página. HTML +4.803 bytes, sin dependencias nuevas de producción. [Capturas y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/intervalos-detalle/docs/validacion/2026-10-28-intervalos-detalle.md).

La selección explícita de detalle sobre el panorama existente queda preparada. Siguen pendientes refinamientos de presentación para otras combinaciones y la comparación original/preparada, además de DRX (#31), preparación/correcciones (#32) y formatos futuros. Estos PRs continúan abiertos; no se modifica main ni se declara terminado todo #34. Se puede seguir trabajando en ramas encadenadas. Su eventual integración tendrá que respetar las dependencias #35 → #36 → #37 → #38 y volver a validar contra la base elegida entonces.


## 23. Contratos y compatibilidad antes de P1 (2026-10-28)

[PR #39](https://github.com/lgarciav1/interpretaci-n-pozo/pull/39), encadenado sobre #38 sin integrar ningún PR: ADR 0033 de revisiones/adquisición, snapshots fijados, archivo v7 previsto, migración, integridad/límites y frontera del contexto P2. Seis fixtures v1–v6 reconstruidos sintéticamente y codificados fuera del serializer, con manifiesto de bytes/hashes; no son archivos históricos reales. Añade 33 pruebas y un medidor reproducible de persistencia/cálculo en Node, con inventario inicial de herramientas/datos del TP.

Resultado: **2.451 pruebas en 148 archivos**, sin fallos/omisiones, typecheck y build aprobados. HTML idéntico byte a byte al de #38: 5.415.233 bytes, SHA-256 feff041b73ab6c9f06c233ba4545cac992a49fc546f78b75536e49ca035999ef. No modifica src, dependencias, interfaz ni el formato vigente v6. [Contrato](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/contratos-revisiones-entradas/docs/decisiones/0033-revisiones-de-entradas-y-compatibilidad.md) y [validación/métricas](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/contratos-revisiones-entradas/docs/validacion/2026-10-28-contratos-revisiones.md).

Se documentó el límite actual: snapshots v1–v6 no conservan entradas históricas. La migración los asociará a los datos disponibles con inputBinding=legacy-current-inputs; snapshots nuevos fijarán su revisión. La corrección de ese límite aún requiere código P1, incluido runner aislado y pruebas tras cambiar laboratorio.

Esta entrega aporta contratos, corpus y métricas a P0, sin declarar completadas todas sus puertas: faltan archivos históricos reales, datos de adquisición y medición en navegador/equipo objetivo. La falta de modelo/lodo/correcciones adquiridas impide admitir correcciones físicas, pero no avanzar con revisiones y preparación básica. Próxima entrega: P1 (revisiones + snapshots fijados + guardar/abrir/migración), separada de limpieza/DRX/correcciones. Main permanece intacto y se mantiene el pedido de no mergear.


## 24. P1a: modelo aislado de revisiones (2026-10-29)

[PR #40](https://github.com/lgarciav1/interpretaci-n-pozo/pull/40), basado en #39 sin integrar ninguno: agrega src/core/inputs con adquisición declarada, revisiones iniciales/hijas y referencia activa por pozo en un modelo independiente de Project. Copia entradas externas, comparte arrays sin cambios por sus bytes, congela metadatos/contenedores y entrega una copia explícita para editar. Un no-op conserva la referencia del estado. El modelo rechaza dimensiones/referencias inválidas, ciclos y dos raíces por pozo antes de publicar; no repara silenciosamente los datos.

Verificación: **2.515 pruebas en 149 archivos**, sin fallos ni omisiones; incluye 64 pruebas nuevas, TP completo/demo y corpus v1–v6. Typecheck, build y diff check aprobados. Payloads NaN, ceros con signo, subarrays, buffers externos, adquisición, fuentes y serialización vigente comprobados. HTML idéntico byte a byte al de #39: 5.415.233 bytes, SHA-256 feff041b73ab6c9f06c233ba4545cac992a49fc546f78b75536e49ca035999ef. [Evidencia y límites](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/modelo-revisiones-entradas/docs/validacion/2026-10-29-modelo-revisiones.md).

P1a aún no se importa desde producción: no cambia Project, snapshots, motor, UI ni formato v6. Los Float64Array publicados son de lectura por contrato; no se promete impedir escrituras directas que eludan las APIs. Id/fecha se suministran explícitamente; solo se implementó el formateador de 16 bytes. La generación con fallback y la persistencia/integridad de blobs siguen pendientes.

Próxima entrega P1b: integrar revisiones y alias de Well en Project, fijar/restaurar snapshots con sus datos y resolver su revisión en el runner aislado, con pruebas tras importar/reemplazar laboratorio. Persistencia/migración v7 se mantiene en una entrega posterior. DRX y preparación/correcciones aún no están habilitados. Main permanece intacto y ningún PR fue mergeado.


## 25. P1b en borrador: Project y snapshots con revisiones (2026-10-29)

[PR #41](https://github.com/lgarciav1/interpretaci-n-pozo/pull/41), encadenado sobre #40, **borrador con validación de navegador pendiente**. Conecta el mapa de revisiones con los aliases Well de Project, activa revisiones solo mediante API explícita y fija snapshots nuevos a sus entradas. Restaurar recupera Well, revisión e interpretación juntos; comparar resuelve las curvas y profundidad propias de cada estado. La cortina rechaza grillas/laboratorio incompatibles. Se incluyen generación de identidad con fallback y validación antes de publicar cambios.

El formato vigente sigue en v6. Los proyectos normales no activan revisiones y conservan su guardado; las APIs experimentales rechazan guardar como v6 para impedir pérdida del historial. No existe activación desde la UI. El archivo/migración v7 sigue pendiente en P1c.

Verificación aprobada: **2.557 pruebas en 150 archivos**, sin fallos/omisiones; 42 nuevas, typecheck, build y diff check. El recorrido parcial de navegador mantiene geometría inicial, comparación inicial y exportaciones LAS/SVG iguales al padre. Medición Node/Vite SSR en TP legado: medianas guardar/abrir/calcular 37,04/6,09/782,14 → 34,22/7,37/782,15 ms; cocientes 0,924/1,210/1,000, bajo 1,25. Archivo TP idéntico (290.153 bytes y mismo SHA-256). No demuestra rendimiento en navegador ni persistencia de revisiones. HTML +17.063 bytes (~0,32 %), sin dependencias nuevas.

**Puerta no aprobada:** a 1366×768, después de restaurar por teclado y cerrar el diálogo, Chromium se bloqueó. Un control usando el build padre también como candidato reproduce el bloqueo; el encabezado de tabla además intercepta el clic en Restaurar a ese tamaño. No se declara resuelto el problema ni se atribuye al nuevo modelo. Restauración/undo/redo/cortina/exportaciones posteriores por UI y la matriz reading_viewer permanecen sin aprobación en esta entrega. Las operaciones de dominio sí están probadas. [Evidencia, métricas y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/snapshots-revisiones-proyecto/docs/validacion/2026-10-29-project-snapshots-revisiones.md).

Próximo paso inmediato: aislar/resolver el bloqueo y completar los recorridos de navegador antes de marcar #41 listo. Después, P1c (persistencia/migración v7, integridad y recuperación tras cerrar/abrir). P2, preparación básica, DRX y correcciones continúan pendientes. Main permanece intacto; ningún PR fue integrado/mergeado.


## 26. P1b validado: bloqueo resuelto y #41 listo para revisión (2026-10-29)

El [PR #41](https://github.com/lgarciav1/interpretaci-n-pozo/pull/41) deja de ser borrador tras completar la validación pendiente de la sección 25. Commit final de código/evidencia: 9df898ef2050f44e9219fc609e7daecc35b89cce. Sigue encadenado sobre #40, sin integrar ni mergear ningún PR.

El bloqueo del padre quedó aislado: aproximadamente 62.000 elementos y 21.939 animaciones de destello simultáneas al restaurar. La tabla FLOW_UNITS tiene 1.790 filas y 26.850 celdas en el TP. ResultsPanel conserva íntegros esos datos, pero solo anima tablas de hasta 200 celdas numéricas. La lista de snapshots conserva su alto y sus botones dejan de quedar bajo la cabecera fija al expandir la comparación. No cambia fórmulas, curvas ni exportación.

Recorridos completos aprobados: project_snapshots a 1366×768 con clics reales (comparar, guardar/abrir v6, cambiar GR limpio, restaurar, guardar, undo/redo, cortina y exportaciones posteriores), y regresión reading_viewer (geometría normal idéntica al padre, lectura reversible, teclado, paneles/editores, preferencias/recarga, 47 curvas, Geología, claro/oscuro, 1920×1080 y DPR 2 según la matriz documentada). Sin excepciones de página. Todas las filas y el contenido de FLOW_UNITS coinciden por hash entre padre/candidato/restaurado; LAS/SVG coinciden por bytes. El diagnóstico adicional por teclado pasa de 1/2/2 a 59/120/181 frames acumulados en tres lecturas de aproximadamente un segundo y cero animaciones pendientes; no es una garantía universal de FPS.

Verificación final: **2.557 pruebas en 150 archivos**, sin fallos ni omisiones; typecheck, build y diff check aprobados. HTML final 5.432.496 bytes (+17.263 frente a #40, ~0,32 %), sin dependencias nuevas. [Evidencia y límites](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/snapshots-revisiones-proyecto/docs/validacion/2026-10-29-project-snapshots-revisiones.md). file:// continúa fuera del recorrido HTTP local.

P1b queda preparado en memoria con activación de dominio explícita. No se activa desde la UI y la persistencia normal sigue siendo v6. **Próximo paso: P1c**, archivo/migración v7, integridad/límites, y recuperar un snapshot con sus curvas/laboratorio tras guardar, cerrar y abrir; conservar compatibilidad v1–v6 y su marca legacy-current-inputs. Después continúan P2, preparación reversible y calibración DRX. Main permanece intacto.


## 27. P1c: archivo v7 y recuperación tras cerrar/abrir (2026-10-30)

[PR #42](https://github.com/lgarciav1/interpretaci-n-pozo/pull/42), encadenado sobre #41, commit f58f473b25fea2c81baf891a7ab399ddb09a58f2. Guarda referencias activas, todas las revisiones/adquisición y blobs f64 LE deduplicados por SHA-256. Al reabrir reconstruye aliases exactos y los snapshots restauran curvas, laboratorio e interpretación originales. No cambia fórmulas ni protocolo del motor.

La transición es explícita: los proyectos legados conservan escritura v6; upgradeInputs:true migra v1–v6 después de sus saneamientos vigentes. Snapshots antiguos quedan marcados legacy-current-inputs, con aviso al abrir/comparar; no se inventan entradas históricas. v7 se escribe cuando existen revisiones. Forzar v6 con ellas se rechaza. No hay botón de activación de preparación en esta entrega.

La apertura normal valida hashes, esquema, referencias, dimensiones y grafo antes de publicar. recoverProject ofrece recuperación independiente mediante API, con diagnóstico, sin reasignar referencias ni el pozo activo; no se agrega interfaz gráfica de recuperación. Se conservan los límites de archivo/total/array 64/512/128 MiB y descompresión incremental limitada. La UI usa un worker independiente con una tarea activa y hasta ocho blobs simultáneos; conserva los buffers activos y tiene alternativa sin Worker y hash offline.

Validación: **2.628 pruebas en 152 archivos**, sin fallos/omisiones; 71 nuevas, typecheck, build y diff check aprobados. Fixture v7 independiente del serializer y corpus sintético fijo v1–v6. TP completo: resultados científicos tras reabrir/restaurar iguales, y cambiar solo adquisición mantiene 21 blobs / 883.136 bytes únicos. Corrupción, referencias, ciclos, metadatos futuros y límites reales comprobados.

Navegador: guardar/reabrir en contexto nuevo, restaurar, undo/redo, cortina, corrupción sin cambiar el proyecto activo, avisos de migración, workers terminados y offline sin Worker/SubtleCrypto. Regresiones completas de snapshots legados y lectura amplia; geometría, preferencias, tabla completa y exportaciones conservadas. LAS/SVG restaurados idénticos al padre. Sin excepciones de página. file:// sigue fuera del recorrido HTTP local.

Medición Node alternada legado/v7: cocientes guardar/abrir 0,843/1,116. Frente al padre en modo legado, dos rondas en orden inverso dieron medianas agregadas guardar/abrir/calcular 0,832/1,158/0,969. Todas bajo 1,25; se conservan muestras y variación. Son mediciones del entorno, no garantía de hardware ni tiempos de UI. HTML final 5.507.660 bytes (+75.164, ~1,38 %), sin dependencias nuevas. [Evidencia y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/persistencia-revisiones-v7/docs/validacion/2026-10-30-persistencia-v7.md).

P1c queda preparado para revisión. Próximo paso: P2, contexto científico y protocolo de invalidación/resync antes de conectar preparación reversible; después calibración DRX y correcciones según sus datos disponibles. No se declara cerrado todo P0 ni los issues #31/#32/#34. Ningún PR fue integrado/mergeado; main permanece intacto.


## 28. P2a: contexto científico, publicación atómica y recuperación acotada (2026-10-30)

[PR #43](https://github.com/lgarciav1/interpretaci-n-pozo/pull/43), encadenado sobre #42, commit 0d452cc9701cbe5710033d103c34e362b873c1ba. Cada cálculo queda vinculado a pozo, revisión de entradas, profundidad, preparación y parámetros científicos. Restaurar entradas mientras hay una respuesta pendiente ya no permite publicar el resultado anterior, incluso si el pozo, la generación y la profundidad coinciden. Snapshots, cachés, exportaciones e informes verifican el contexto.

Los deltas se validan completos antes de reemplazar caché o resultados. Una inconsistencia provoca una resincronización completa; si persiste, un reinicio y un último intento completo. Después aparece un error visible, sin reintentos infinitos ni publicación parcial. Una solicitud nueva explícita permite recuperar el motor. Mientras cambia el cálculo se retiran sus salidas obsoletas; continúan disponibles las curvas medidas y la navegación. Una revisión que solo cambia metadatos de laboratorio puede reutilizar el resultado sin ejecutar otra vez el motor.

Validación: **2.657 pruebas en 153 archivos**, sin fallos ni omisiones; 29 nuevas, typecheck, build y diff check aprobados. Cuatro recorridos completos de navegador: protocolo con fallos inyectados, archivo v7, snapshots legados y lectura amplia, sin excepciones. Se comprobaron respuesta tardía dentro de la misma generación, recuperación completa única, reinicio acotado, error terminal y recuperación posterior; cambiar solo metadatos de laboratorio no dispara otro cálculo. Se mantienen geometría, preferencias, tabla completa y LAS/SVG iguales a la base. file:// sigue fuera del recorrido HTTP local.

La huella científica del ensayo de protocolo coincide con el padre. Medianas 65,67 → 67,81 ms (1,033×, umbral 1,25×), con buffers originales intactos. Es un ensayo MessageChannel de Node, no una medición de latencia de Worker de navegador ni garantía de hardware. HTML final 5.519.941 bytes (+12.281, ~0,22 %), sin dependencias nuevas. [Informe, métricas y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/contexto-cientifico-motor/docs/validacion/2026-10-30-contexto-motor.md).

Se completa **P2a**, sin modificar fórmulas ni formatos v6/v7. **P2b continúa pendiente**: planificador compartido de proyección efectiva, referencias a curvas preparadas, atribución de ascendencia de herramientas y contexto de calibración/laboratorio. La ascendencia vacía de originales significa desconocida; no prueba independencia de herramientas. Después se conecta preparación reversible y calibración DRX, y luego correcciones según datos y modelos disponibles. No se declara cerrado todo P2 ni los issues #31/#32/#34. PR #43 listo para revisión; ningún PR integrado/mergeado y main permanece intacto.


## 29. P2b: proyección efectiva, fuentes preparadas y laboratorio (2026-10-30)

[PR #44](https://github.com/lgarciav1/interpretaci-n-pozo/pull/44), encadenado sobre #43, commit 2316dcc198871334beaa9d642f9205af278b0515. resolveDataContext conserva el caso identidad y permite proyectar lotes de artefactos ya evaluados sin insertarlos en los originales del proyecto. Valida revisión, índice, unidades/dimensiones, datos/calidad, referencias versionadas, ids y ciclos; resuelve dependencias y hereda la unión de herramientas de todos los padres. El caso sin preparación mantiene referencias y resultados existentes.

Una preparada no se selecciona por defecto. Si la elegida falta, tiene unidad inválida o depende de cualquier herramienta apagada/fuera del plan, el puerto y sus consumidores quedan bloqueados, incluso si la entrada era opcional. No vuelve silenciosamente a un original. Motor, disponibilidad, visor/rellenos, series y adaptadores distinguen las fuentes; el original sigue accesible explícitamente. ML usa el mismo grafo sin modificar sus modelos. El cliente rechaza proyecciones preparadas con contexto de originales/otras curvas/otra interpretación; cambiar preparación sincroniza el dominio completo y un no-op reutiliza la proyección.

SourceRef conserva su forma de curva por id. Nuevos imports remapean el prefijo reservado prep: conservando el mnemónico; un original legado con ese prefijo mantiene su identidad. Se rechaza guardar/abrir una proyección como si fueran originales. No se cambian los formatos v6/v7 ni las fórmulas. calibrationKey separa las dependencias de laboratorio, decisiones, ventana MD, agregación y configuración del contexto petrofísico: cambiar esa evidencia invalida calibración sin ejecutar el motor cuando no la consume; nombres/encabezado/tendencias no invalidan evidencia científica.

Validación final: **2.693 pruebas en 154 archivos**, 36 nuevas, sin fallos ni omisiones; typecheck, build y diff check aprobados. Worker real con IGR preparado 0,4/NaN/0,6, rechazo de contexto mezclado, herencia GR+caliper, bloqueo sin fallback, regreso explícito al original y buffers intactos. Cuatro regresiones completas sobre el HTML final: protocolo con fallos inyectados, archivo v7, snapshots legados y lectura amplia; sin excepciones. Geometría, tabla completa y LAS/SVG coinciden con la base. file:// fue rechazado con ERR_BLOCKED_BY_ADMINISTRATOR por Chromium del entorno; no se cuenta como aprobado ni se modificó esa política.

Ensayo de proyección de identidad + motor completo/MessageChannel sobre TP, 1 warmup + 7 cambios secuenciales: medianas 64,56 → 59,06 ms (0,915×, umbral 1,25×), misma huella científica y buffers intactos. Es una medición Node sin suite/navegadores compitiendo, no latencia de Worker ni garantía de hardware o preparación pesada. HTML final 5.532.035 bytes (+12.094, ~0,22 %), sin dependencias nuevas. [Contrato](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/proyeccion-efectiva-p2b/docs/decisiones/0035-proyeccion-efectiva-y-laboratorio.md) y [validación/métricas/reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/proyeccion-efectiva-p2b/docs/validacion/2026-10-30-proyeccion-efectiva.md).

**Alcance disponible:** API de proyección para artefactos evaluados y consumidores, todavía sin productor hacia los stores ni editor en la UI. **Próximo paso P3:** recetas tipadas/versionadas, semántica de calidad, exclusión/restauración reversible, evaluación/previsualización aislada y publicación atómica de artefactos con resultados; persistencia de decisiones, undo/redo y comparación original/preparada. Completar límites de memoria/cancelación antes de habilitar métodos pesados. Después se avanza con otras limpiezas/alineación, DRX y correcciones admitidas según sus datos. No se cierran #31/#32/#34 ni se declara terminada toda la preparación. PR #44 abierto y listo para revisión; ningún PR integrado/mergeado, main intacto.


## 30. P3a: exclusión manual reversible y editor disponible (2026-10-30)

[PR #45](https://github.com/lgarciav1/interpretaci-n-pozo/pull/45), encadenado sobre #44, commit 7c1550d6fefa82b5719b17c614ff51a1b6e5445a. En esa rama, panel del pozo → Preparar datos permite elegir curva/tramo MD, previsualizar, aplicar y usar la preparada, comparar con original y restaurar exclusiones. Se entrega la primera operación útil del editor; no se declara completada toda la preparación P3.

La máscara v1 conserva filas e índice y usa intervalos MD cerrados. Distingue NaN original y exclusión con flags combinables 0–3. Las exclusiones solapadas mantienen identidad propia para restaurarlas separadamente. Las recetas JSON fijan revisión/curva de origen: datos/grilla/metadata diferentes bloquean el nodo; laboratorio/encabezado que comparten los mismos orígenes pueden conservar preparación y cálculo. No hay sustitución silenciosa de una preparada fallida.

El worker conserva originales separados, valida el plan, evalúa máscaras y ejecuta petrofísica sobre esa misma proyección. Devuelve un paquete completo de preparadas/calidad y outputs; el cliente valida todo antes de publicar, con full/reinicio/error acotados y reenvío de receta. Hay LRU de arrays de 128 MiB por evaluador, estimación previa y cancelación por bloques de 16.384 muestras. El runner aislado comparte cola con snapshots, prioriza el último preview y aplica también caché por bytes; las vistas en uso quedan fijadas. Esos límites no son un techo global del proceso: originales, migración, transferencias y vistas activas consumen memoria adicional.

La propuesta no modifica Project ni dispara el motor principal. Aplicar acepta migración de entradas, receta y fuente en una sola unidad de undo/redo; cancelar no migra. Legado sin preparación mantiene v6; aceptar la primera preparación activa revisiones/v7 y marca snapshots legados según ADR 0033. Guardar/reabrir persiste recetas y originales, sin curvas/blobs derivados. Nuevos snapshots fijan datos y receta y los reproducen al restaurar. Visor, plots, inspector, figuras, exportación/informe y claves de evidencia verifican el contexto. Los gráficos con selección por id conservan su original explícito; Fuente de interpretación sigue la preparada. QC de originales permanece para auditoría; la exportación agrega QC de preparación.

Validación final: **2.716 pruebas en 156 archivos**, 23 nuevas; sin fallos/omisiones, typecheck/build/diff check aprobados. Una corrida paralela excedió 5 s en una prueba preexistente de sarta; la corrida final aislada aprobó manteniendo el umbral. Cinco recorridos completos de navegador sobre el mismo HTML final, sin excepciones: P3, protocolo, archivo v7, snapshots legados y lectura amplia. P3 sobre TP excluye 65 mediciones de [7800,7810], conserva cada GR original y 5.810 filas, y verifica flags/valores preparados. Undo/restaurar devuelve el LAS base; redo/reabrir/restaurar snapshot devuelve el preparado. Se comprueban preview sin cambios, un paquete incompleto con recuperación única, receta futura sin modificar el proyecto y fallback offline sin Worker/SubtleCrypto. Se conserva geometría, preferencias, tabla completa y exportaciones de proyectos anteriores. file:// sigue sin verificar por la política del Chromium del entorno.

Ensayo Node/Vite SSR sin competencia de suite/navegadores: identidad 61,54 → 63,65 ms (1,034×, umbral 1,25×), misma huella científica. Máscara con caché caliente: 52,23 ms, con salidas idénticas a una GR enmascarada independientemente; bytes y buffers originales intactos. Se conservan warmup y siete muestras; no es latencia de UI/Worker ni garantía de hardware o métodos pesados. HTML final 5.566.981 bytes (+34.946, ~0,63 %), sin dependencias nuevas. [Contrato ADR 0036](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/preparacion-mascaras-p3/docs/decisiones/0036-exclusion-reversible-y-publicacion.md) y [validación/métricas/reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/preparacion-mascaras-p3/docs/validacion/2026-10-30-exclusion-reversible.md).

**Siguiente entrega:** ampliar preparación básica con propuestas de datos espurios y sus métodos validados, antes de filtros/interpolación y puesta en profundidad; luego carga/emparejado/calibración DRX y correcciones físicas admitidas según datos. P3a no implementa esas operaciones ni modifica ecuaciones o modelos ML. No se cierran #31/#32/#34. PR #45 abierto y listo para revisión; ningún PR integrado/mergeado y main intacto.


## 31. P3b: propuestas locales de espurios y exclusiones elegidas (2026-10-30)

[PR #46](https://github.com/lgarciav1/interpretaci-n-pozo/pull/46), apilado sobre #45, commit adf1b9049ec7a0cd67ea5d0e606e3f1afc12580e. Preparar datos permite buscar diferencias locales mediante mediana/MAD de tres vecinos a cada lado, revisar valor/mediana/umbral y elegir muestras individuales antes de previsualizar su exclusión. El piso de desviación y la separación máxima MD son positivos y explícitos. No cruza faltantes, máscaras ni saltos MD; requiere una ventana completa. No hay selección por defecto ni reemplazo automático de valores. Un candidato puede representar señal geológica real.

El diagnóstico es temporal y cooperativo por bloques, con cancelación y hasta 256 candidatos; un resultado truncado exige acotar tramo/ajustar límites antes de previsualizar. Se guardan exclusiones manuales de las muestras elegidas mediante máscara v1, no los parámetros de búsqueda ni una receta de detección reproducible. La UI explicita este límite. Aceptar el lote, migración optativa v7 y fuente es un solo undo/redo. Cambiar proyecto, controles o selección invalida el preview. Originales y filas se conservan; no cambia formato, protocolo, ecuaciones ni dependencias.

Validación: 2.722 pruebas en 157 archivos, seis nuevas; typecheck/build/diff check aprobados. Tras el ajuste final de comprobación de cancelación se repitieron seis pruebas y build. Chromium sobre TP: 14 candidatos en [7800,7900] m, elección explícita de una muestra, preview sin cambiar Project ni ejecutar el motor principal, invalidación por selección/límites, aplicación, undo/redo, guardar/reabrir en un contexto nuevo y restauración sin excepciones. Regresión P3a: 65 exclusiones en [7800,7810], originales/filas/QC conservados, LAS reproducido, full único por paquete incompleto, snapshots y fallback offline. No se repitió toda la matriz visual de pantallas/temas y file:// sigue sin verificar.

Ensayo Node/Vite SSR de identidad sin competencia de suite/navegadores: medianas 56,0792 → 56,0781 ms (0,99998×), misma huella científica y bytes/buffers originales intactos. No mide la velocidad del detector ni latencia de UI/Worker. HTML 5.573.231 bytes (+6.250; ~0,112 %). [Contrato ADR 0037](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/propuestas-espurios-p3b/docs/decisiones/0037-propuestas-locales-de-espurios.md) y [evidencia, captura y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/propuestas-espurios-p3b/docs/validacion/2026-10-30-propuestas-espurios.md).

P3b entrega diagnóstico asistido y decisiones manuales revisadas. No completa toda P3. Continúan pendientes filtros/interpolación, alineación y otros métodos con contratos propios; después carga/emparejado/calibración DRX y correcciones físicas admitidas. No se cierran #31/#32/#34. #46 abierto para revisión, ningún PR integrado/mergeado y main intacto.


## 32. P3c: interpolación lineal acotada y reproducible (2026-10-30)

[PR #47](https://github.com/lgarciav1/interpretaci-n-pozo/pull/47), apilado sobre #46, commit e37b164a8c9bca68cf365a40ea772d204edafe3f. Preparar datos permite estimar faltantes originales entre dos mediciones, con tramo MD y distancia máxima entre anclajes explícitos y preview antes de aceptar. Interpola en los valores de la curva y el MD real, sin extrapolar, cambiar finitos ni usar estimaciones como nuevos anclajes. Exclusiones y fronteras de zona bloquean el hueco entero. Cambiar límites de zona invalida la versión de preparación. Se restringe a roles incorporados de perfiles medidos (o de origen any) con unidades compatibles; banderas/categorías, roles computados y curvas sin significado reconocido quedan bloqueados. La asignación correcta del rol sigue siendo necesaria.

Una estimación conserva el faltante original con QC 9 = OriginallyMissing | Interpolated. Comparación, informe y exportación declaran su carácter estimado. Worker y cliente validan/publican preparación y petrofísica en el mismo contexto; se rechazan calidad/valor incoherentes, versiones mezcladas y límites alterados en tránsito. Se mantiene LRU por bytes, sin un tercer array del tamaño del pozo para interpolar y con cancelación por bloques también durante el rellenado. El presupuesto no es un techo global de memoria.

Preview aislado sin modificar Project ni ejecutar el motor principal. Cero elegibles bloquea Aplicar; cambiar límite, curva, tramo o proyecto invalida la propuesta. Aceptar método, migración optativa y fuente es un solo undo/redo. Se persisten originales + decisiones, sin blobs estimados. Quitar sólo interpolación conserva exclusiones e identidad de salida; restaurar una exclusión conserva el método y puede habilitar el hueco; restaurar original elimina la receta completa y vuelve explícitamente al original.

Compatibilidad: máscaras previas conservan esquema 1 y claves. La interpolación introduce esquema 2 de preparación dentro del mismo contenedor v7. Aplicaciones anteriores rechazan esos archivos nuevos por esquema desconocido; el lector del checkout #46 se ensayó contra un archivo nuevo y rechazó explícitamente. No se promete apertura hacia atrás de recetas 2. Proyectos antiguos y máscaras 1 se conservan; sin preparación/revisiones se mantiene escritura v6. Los snapshots guardan método, datos y zonas de interpretación reproducibles.

Validación final: **2.737 pruebas en 158 archivos**, quince nuevas; typecheck/build/diff check aprobados. Casos independientes en grilla irregular, máximos y bordes, exclusiones/zonas, caché, categorías/unidades, esquema y referencias, cancelación en un hueco grande, persistencia/snapshots, canal real y plan alterado. Chromium sobre TP con huecos sintéticos explícitos: dos estimaciones esperadas 14/18, 5.810 filas y todos los GR originales conservados, QC comprobado muestra a muestra, preview/cancelar, cero elegibles, invalidación, undo/redo, reabrir en otro contexto, snapshot, barrera por exclusión/zona, quitar etapa conservando máscara v1, rechazo atómico de esquema futuro y fallback offline sin Worker/SubtleCrypto. Regresiones P3a/P3b completas, sin excepciones de página. No se repitió toda la matriz visual de pantallas/tamaños/temas y file:// sigue sin verificar.

Ensayo Node/Vite SSR de identidad, sin suite/navegadores activos: medianas 59,66 → 52,85 ms (0,886×), misma huella científica y bytes/buffers originales intactos. No mide interpolación ni latencia UI/Worker, ni demuestra una mejora general. HTML 5.593.228 bytes (+19.997; ~0,359 %), sin dependencias nuevas. [Contrato ADR 0038](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/interpolacion-acotada-p3c/docs/decisiones/0038-interpolacion-lineal-acotada.md) y [evidencia, capturas y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/interpolacion-acotada-p3c/docs/validacion/2026-10-30-interpolacion-acotada.md).

**Próximo bloque P3:** filtros con soporte, bordes y barreras declarados; alineación constante y otros métodos con validación propia. Reemplazar espurios finitos o rellenar exclusiones no está habilitado por esta interpolación. Después continúan DRX diagnóstico/calibración y correcciones físicas admitidas. P3 completa permanece abierta; no se cierran #31/#32/#34. #47 listo para revisión, ningún PR integrado/mergeado y main intacto.


## 33. P3d: mediana física, calidad y composición de etapas (2026-10-30)

[PR #48](https://github.com/lgarciav1/interpretaci-n-pozo/pull/48), apilado sobre #47, commit d85c599b91043c7788724160f74de4c84609450f. Preparar datos permite aplicar mediana móvil con radio MD y separación máxima explícitos, sobre valores lineales e independientemente de la escala visual. Ventana física completa, mínimo tres muestras y vecinos de ambos lados; bordes sin soporte se conservan. NaN, exclusiones, fronteras de zona y saltos MD cortan segmentos. Soporte máximo 255: no se trunca un resultado ni se rellena automáticamente un hueco. Se mantienen las restricciones a roles incorporados de perfiles medidos (o any) con unidades compatibles; no se admiten categorías, banderas o significado desconocido.

Orden fijo: exclusiones → interpolación previamente aceptada, si existe → mediana. La etapa lee una copia fija de datos/calidad, evitando realimentar valores o influencia de estimaciones. QC 16 identifica filtrado; 24, un centro originalmente medido con soporte interpolado; 25, un faltante original interpolado y filtrado. OriginallyMissing sigue describiendo el centro, no se propaga como un faltante inventado desde un vecino. La influencia interpolada se señala conservadoramente desde el soporte. Comparación, informe y exportación distinguen esos casos y comparten el contexto científico.

Radio, separación, tramo, etapas y fronteras zonales forman parte de las versiones/cachés. Retirar filtro conserva interpolación/exclusiones; retirar interpolación conserva filtro/exclusiones; restaurar original elimina la receta y vuelve explícitamente al original. No hay reordenado arbitrario. Las recetas con filtro usan esquema 3 de preparación en el contenedor v7; sin filtro se conservan exactamente esquemas 1/2 y sus claves. Lectores anteriores rechazan esos archivos nuevos por esquema desconocido; se comprobó el serializer del checkout #47. Originales y decisiones se persisten, sin blobs derivados.

El plan reserva resultado + scratch (10 bytes/muestra adicionales) antes de asignar arrays; LRU por buffers completos y cancelación por bloques durante segmentación/filtrado. No es un techo global del proceso. Preview aislado, sin modificar Project ni ejecutar motor principal. Cero soporte bloquea Aplicar; cambiar controles o proyecto invalida la propuesta. Aceptar método, migración optativa y fuente es un undo/redo.

Validación final: **2.751 pruebas en 159 archivos**, catorce nuevas; typecheck/build/diff check aprobados. Referencia independiente por ventanas, grilla irregular, soporte par y casos sin realimentación; constantes diminutas/extremas y signos opuestos; barreras/caché, composición/QC, retirada de etapas, no-op, memoria/cancelación, archivo/snapshots, canal real y plan alterado. Chromium sobre TP con señales sintéticas explícitas: cinco centros filtrados, 5.810 filas y cada GR original conservados, valores y QC 16/24/25 comprobados muestra a muestra, preview/cancelar, cero soporte, undo/redo, reabrir/snapshot, retirada independiente, zonas, esquema futuro y fallback offline. Regresiones P3a/P3b/P3c completas, sin excepciones de página. Capturas clara/oscura revisadas. No se repitió toda la matriz visual y file:// sigue sin verificar.

Ensayos Node/Vite SSR secuenciales sin suite/navegadores activos: identidad 53,07 → 51,83 ms (0,977×), misma huella científica y buffers intactos. Filtro sobre 100.000 muestras sintéticas, ventanas de cinco puntos y versiones de radio nuevas sin hits de caché: mediana 73,50 ms; todas las salidas coinciden con una referencia directa independiente. No mide petrofísica/Worker/UI ni soporte máximo de 255 puntos y no garantiza tiempos universales. HTML 5.604.582 bytes (+11.354; ~0,203 %), sin dependencias nuevas. [Contrato ADR 0039](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/filtro-mediana-p3d/docs/decisiones/0039-mediana-fisica-y-composicion.md) y [evidencia, capturas y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/filtro-mediana-p3d/docs/validacion/2026-10-30-filtro-mediana.md).

**Siguiente bloque P3: alineación constante**, con signo/datum, remuestreo, máximos de hueco, calidad y evidencia propios. Otros filtros/dominios y métodos admitidos siguen sujetos a sus contratos; después DRX y correcciones físicas. P3 completa permanece abierta, no se cierran #31/#32/#34. #48 listo para revisión; ningún PR integrado/mergeado y main intacto.

## 34. P3e: alineación constante manual en MD (2026-10-30)

[PR #49](https://github.com/lgarciav1/interpretaci-n-pozo/pull/49), apilado sobre #48, commit 440455ff487c229ed838e311fffdf19eef75ee8a. Preparar datos permite desplazar una curva completa y remuestrearla al índice maestro, con signo explícito, referencia MD/datum y separación máxima entre anclajes. Positivo coloca el evento más profundo. Se conservan originales, índice, otras curvas y laboratorio; editar el desplazamiento reemplaza la etapa sin acumularlo. Es una entrega **manual por curva**, sin inferir ni mover toda una corrida.

La receta exige declarar referencia del mismo pozo y datum compartido. Los datums de adquisición conocidos incompatibles se rechazan; si son desconocidos permanecen desconocidos. La declaración del usuario no se convierte en evidencia de adquisición. No hay conversión MD/TVD/datum ni validación geológica automática. El eje transformado debe seguir finito y estrictamente creciente; se rechazan colapsos por redondeo/desbordamiento.

Orden fijo: exclusión → interpolación opcional → mediana opcional → alineación. Las etapas previas conservan tramos/zonas en MD de origen, aclarado en la UI. El remuestreo copia coincidencias o estima linealmente entre muestras adyacentes finitas dentro del máximo, sin atravesar NaN/exclusiones ni fronteras zonales destino. No extrapola ni usa el crudo destino como respaldo. La tolerancia de coincidencia decimal está limitada por separaciones vecinas y versionada como parte del método.

QC Shifted (32) permanece en toda la salida; Interpolated (8) señala soporte estimado y OutOfDomain (128) falta de soporte. Los flags heredados describen el soporte de origen, no el crudo de esa fila destino. Los conteos previos a alinear evitan duplicar centros de origen en UI/informe; comparación, informe y exportación declaran transformación/referencia/datum y parámetros de las otras etapas. No se atribuye una corrección ambiental.

Un solo scratch f64/u16 se comparte secuencialmente con mediana, con reserva antes de asignar buffers, LRU y cancelación sin publicar parciales. No es un techo global del proceso. Preview aislado, declaración previa, invalidación al cambiar controles/contexto y bloqueo de Aplicar sin cobertura finita; aceptación/migración/fuente en un undo/redo. Retirar o editar una etapa conserva las otras. Recetas alineadas usan **esquema 4 de preparación dentro de v7**; sin alineación se preservan esquemas 1/2/3 y claves. Se guardan originales/decisiones, sin resultados derivados. El lector de #48 rechazó un archivo nuevo por esquema desconocido.

Validación final: **2.766 pruebas en 160 archivos**, quince nuevas, typecheck/build/diff check aprobados. Tras la última aclaración de UI se repitieron las quince pruebas de alineación, typecheck y build. Referencias independientes exactas/fraccionarias, grillas irregular/decimal, signo/barreras/QC, composición/retirada, originales/laboratorio intactos, referencia/datum, presupuesto/cancelación, archivo/snapshots, informe/exportación, canal real y plan alterado. Chromium sobre TP con evento/laboratorio sintéticos explícitos: +0,3048 m mueve evento 1000→1002; las 5.810 filas, GR original, curva independiente, índice, laboratorio y QC se verifican muestra a muestra. Preview/cancelar, invalidación, undo/redo, reabrir/snapshot, signo inverso sin acumulación, retirada, rechazos atómicos y offline aprobados. Regresiones P3a/P3b/P3c/P3d sin excepciones de página; capturas clara/oscura revisadas. No se repitió toda la matriz visual ni file://.

Ensayos Node/Vite SSR secuenciales: identidad 57,85 → 62,50 ms (1,080×, bajo 1,25), misma huella científica y buffers intactos. Alineación de 100.000 muestras sin hits de caché: mediana 67,37 ms; una evaluación fraccionaria 78,37 ms; todas las salidas coinciden con referencias independientes. No mide petrofísica/Worker/UI ni garantiza otros tamaños/hardware. HTML 5.621.559 bytes (+16.977; ~0,303 %), sin dependencias nuevas. [Contrato ADR 0040](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/alineacion-constante-p3e/docs/decisiones/0040-alineacion-constante-md.md) y [evidencia, capturas, métricas y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/alineacion-constante-p3e/docs/validacion/2026-10-30-alineacion-constante.md).

**Pendiente P3:** agrupado y activación atómica por corrida registrada, correlación/validación independiente y puertas de cierre. Esta entrega por curva no completa toda P3. Después continúan DRX y correcciones físicas admitidas. No se cierran #31/#32/#34. #49 listo para revisión; ningún PR integrado/mergeado y main permanece intacto.


## 35. P3f: cierre funcional de preparación básica; P4a diagnóstico DRX (2026-10-31)

[PR #50](https://github.com/lgarciav1/interpretaci-n-pozo/pull/50), apilado sobre #49. Commits `65f13af` y `f123514`. Completa el alcance funcional inicial de P3 con registro explícito de corridas, preview de todos sus integrantes, alineación/activación y retirada atómicas con undo/redo. Conserva etapas previas, originales y laboratorio. La correlación diagnóstica presenta todos los candidatos, cobertura/pares, pico, borde y ambigüedad; usa una ventana reservada sin soporte compartido y no aplica desplazamientos automáticamente. Se mantienen v7 y preparación esquema 4. Deformación variable y métodos adicionales siguen fuera de esta primera entrega.

Inicia P4a con lectura DRX CSV/xlsx y mapeo explícito de minerales, unidades, masa/volumen, roca completa/fracción arcilla, escala, informe y referencia MD/datum. El lector optativo preserva celdas para no confundir ND/LD con faltantes. Conserva réplicas y valores, verifica cierre sin renormalización y exige densidades declaradas para masa→volumen de sólidos. Empareja puntos por interpolación acotada e intervalos por espesor realmente cubierto, mostrando cobertura, dispersión, QC y exclusiones. Usa originales o preparadas del contexto vigente, sin caída silenciosa al original. Arcilla y Vsh permanecen magnitudes distintas; no aplica calibración GR ni cutoffs.

Validación: **2.781 pruebas, 162 archivos**, sin fallos/omisiones. Tras ajustes finales de referencia/datum y retirada por corrida: quince pruebas nuevas repetidas, typecheck/build aprobados. Chromium en HTTP local: corrida de dos curvas, preview, aplicación por Enter/tap, undo/redo, guardar e importación/comparación DRX; regresión de alineación sobre 5.810 filas con originales/laboratorio/QC, snapshots y fallback sin Worker/SubtleCrypto conservados, sin excepciones. Ajuste final de tablas verificado en recorrido adicional. HTML 5.651.149 bytes (+0,53 % frente a #49), sin dependencias nuevas. No se repitió toda la matriz visual ni benchmark comparativo; file:// volvió a ser bloqueado por política del navegador.

[Contratos, capturas, evidencia y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/cierre-p3-inicio-p4/docs/validacion/2026-10-31-corridas-drx.md).

**P4 completa continúa abierta:** incertidumbre y límites de detección numéricos, bases heterogéneas por fila, procedencia/densidades y configuración/evidencia de pares persistentes, exportación específica y DRX real. P5 debe satisfacer sus puertas de identificabilidad/calibración y mantener cutoffs separados. El cierre es funcional para los métodos P3 admitidos, no habilita correcciones ambientales ni implica integración. #50 abierto para revisión; ningún PR mergeado y main intacto. No se cierran #31/#32/#34.


## 36. P4b: configuración/evidencia persistente y exportación DRX (2026-10-31)

[PR #51](https://github.com/lgarciav1/interpretaci-n-pozo/pull/51), apilado sobre #50, commits `f39fb83` y `fbab980`. Guarda configuración y evidencia de comparación en ajustes versionados de PointSetDecisions, con una receta de undo/redo y snapshots, sin persistir arrays derivados ni alterar parámetros/cutoffs. Las densidades exigen referencia, admiten incertidumbre declarada y edición textual con punto/coma decimal; no se propaga incertidumbre estadística.

Huella SHA-256 de entradas/configuración y resultados independiente de identidades en memoria: datos/revisión, fuente/calidad, laboratorio/contrato, preparación, sarta, zonas y decisiones. El registro no participa de su propia huella. Reabrir/restaurar exige recalcular para verificar; no presenta una tabla histórica como vigente. Cambiar contexto/borrador invalida aceptación/exportación. Versiones futuras se informan y conservan sin migración silenciosa. CSV de toda la tabla con configuración/procedencia, descriptor/unidad de fuente, profundidades originales/corregidas, composición/estados originales, soporte y exclusiones. Se bloquean resultados no finitos y arcilla nativa >1 sin recortar o renormalizar.

Validación: **2.792 pruebas, 163 archivos**, sin fallos/omisiones; once pruebas nuevas. Tras ajustes finales se repitieron 21 pruebas DRX y typecheck/build. Chromium: guardado/historial/exportación, reapertura en contexto nuevo, recuperación de parámetros, huellas verificadas, invalidez por cambio, versión futura preservada y decimales/incertidumbre declarada, sin excepciones. HTML final 5.661.745 bytes (+0,188 % sobre #50), sin dependencias nuevas; se mantienen v7 y preparación esquema 4. No se repitieron toda la matriz visual/benchmark ni doble clic, cuya limitación de política sigue documentada.

[Contrato, captura, evidencia y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/evidencia-drx-p4b/docs/validacion/2026-10-31-evidencia-drx.md).

**P4 completa sigue abierta:** incertidumbres/límites de detección numéricos importados por muestra/mineral y validación con DRX real. Bases distintas siguen en conjuntos homogéneos separados. No habilita calibración GR ni equivalencia arcilla–Vsh; P5 conserva sus puertas. #51 abierto para revisión, ningún PR mergeado y main intacto. No se cierran #31/#32/#34.


## 37. P4c → P5a: propuestas GR con evidencia DRX y aceptación zonal (2026-10-31)

[PR #52](https://github.com/lgarciav1/interpretaci-n-pozo/pull/52), apilado sobre #51, commits `e87408c` y `2e487cb`. P4c incorpora incertidumbre absoluta/nota, límites numéricos y censura `<valor`, con auxiliares revisables, validados, persistidos y exportados. No convierte censura en mediciones ni propaga una incertidumbre estadística no definida.

**Se alcanza P5 con una primera entrega funcional de calibración GR.** Propuestas zonales para lineal, Larionov terciario/antiguo, Clavier y Steiber usando funciones canónicas, parámetros de esquema y proxy volumétrico/independencia del ensayo declarados. Agrupa réplicas y soportes próximos; exige rango/asociación, soporte de extremos, bloques de profundidad separados, estabilidad y residuo/sesgo. Conserva parámetros sin redondear/aplicables y recalcula métricas. Fuentes calculadas/inactivas, masa nativa, fracción arcilla, soluciones no identificables o en cotas quedan bloqueadas.

Preview petrofísico aislado, sin modificar Project/motor principal. Aplicación de grClean/grShale y vsh.method solo en la zona elegida, con evidencia/hipótesis/política y parámetros previos en una receta de historial. Otras zonas, fuentes, originales y cutoffs conservados. Guardar/abrir, undo/redo y snapshots recuperan evidencia/parámetros; no se ejecutan propuestas históricas automáticamente. Las ecuaciones se documentan en Ecuaciones/ADR, fuera del flujo operativo.

Validación final: **2.814 pruebas en 165 archivos**, sin fallos/omisiones; typecheck/build/diff check aprobados. Fixture Python independiente recupera extremos para los cinco métodos. Chromium: auxiliares, 20 filas → 18 localizaciones, réplica/censura, recuperación 25/135 desde 50/160, preview Vsh 0,2720 → 0,4682 sin pedidos al motor principal, invalidación, Project intacto antes de aceptar, aplicación zonal y cutoffs/blobs/fuentes/otras zonas intactos, historial, otro contexto de navegador y snapshots. Extensión verifica restauración tras cambiar parámetros/eliminar evidencia y calibración completa offline sin Worker/SubtleCrypto. Sin excepciones finales.

El primer navegador detectó plan vacío en contexto identidad: se corrigió siguiendo el contrato de snapshots, se añadió prueba con cliente/motor reales (original/preparado) y se repitió la suite completa y el recorrido. No se relajó el protocolo. HTML 5.690.760 bytes (+0,512 % sobre #51), sin dependencias nuevas, mismo v7/preparación 4.

[Contratos, captura y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/calibracion-gr-drx-p5/docs/validacion/2026-10-31-calibracion-gr-drx.md).

P5 no se declara completa: quedan extremo externo fijo, propagación estadística y calibración conjunta entre zonas. Los cutoffs siguen siendo una decisión separada con herramientas existentes. La campaña DRX real y su relación constitutiva siguen pendientes: los fixtures sintéticos no se presentan como laboratorio real ni certifican equivalencia universal arcilla–Vsh. No se repitió toda la matriz visual/benchmark ni doble clic, cuya limitación de política permanece. PR #52 abierto para revisión; ningún PR mergeado y main intacto. No se cierran #31/#32/#34.


## 38. P5b: un extremo GR externo fijo y ajuste del extremo libre (2026-10-31)

[PR #53](https://github.com/lgarciav1/interpretaci-n-pozo/pull/53), apilado sobre #52, commit `61538da`. Permite declarar limpio o lutítico desde referencia externa aplicable a la zona y estimar solo el otro con los cinco métodos Vsh. El externo no se redondea/recorta: se rechaza fuera de rango/paso y se conserva exactamente en raw, aplicable y todos los folds. Se registran declaración, referencia e incertidumbre/nota opcionales; variación cero se explica como condición del modelo, no incertidumbre cero.

Se mantienen fuente activa, agrupado, soporte del extremo libre, rango/asociación, bloques separados, métricas y estabilidad. La política condicionada registra rango proxy 0,3/GR 10 gAPI; no cambia los umbrales 0,6/20 del modo de dos extremos. Incertidumbre externa que supera el umbral en gAPI bloquea aplicar. Preview aislado, invalidación por valor/referencia/controles, aceptación zonal en una receta, historial y snapshots; originales, fuentes, otras zonas y cutoffs conservados.

Compatibilidad explícita: modo de dos extremos predeterminado v1/xrd-gr-v1; solo la evidencia restringida usa v2/xrd-gr-fixed-v1, mismo Project v7/preparación 4. Lector nuevo acepta recibo v1 congelado del recorrido de #52. El lector original real de #52 acepta v1 y rechaza explícitamente v2: no se promete que una app vieja audite restricciones nuevas, aunque preserve ajustes y parámetros conocidos.

Validación: **2.832 pruebas en 166 archivos**, sin fallos/omisiones; typecheck/build/diff check aprobados. Diez combinaciones método × extremo con fixture Python independiente. Chromium: limpio/lutítico fijo y Clavier, bloqueo del ajuste libre sin soporte, fuera de paso y sin declaración, entrada decimal, exactitud de la restricción, preview sin motor principal, invalidación, aplicación/undo/redo/reapertura/snapshot y versión futura preservada; blobs/cutoffs/fuentes/otras zonas intactos. Regresión completa P5a también aprobada, sin excepciones. HTML 5.697.525 bytes (+0,119 % sobre #52), sin dependencias nuevas.

[Contrato, capturas y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/extremo-externo-gr-p5b/docs/validacion/2026-10-31-extremo-externo-gr.md).

P5 continúa pendiente de propagación estadística, calibración conjunta entre zonas y contraste con una campaña DRX real/referencias externas verificables. Los datos sintéticos no se presentan como laboratorio real. Cutoffs siguen como decisión separada. No se repitió toda la matriz visual/benchmark/fallback offline; file:// conserva su limitación de política. #53 abierto para revisión, sin mergear ningún PR y main intacto. No se cierran #31/#32/#34.


## 39. P5 cerrada en revisión: cutoff Vsh con evidencia separada (2026-10-31)

[PR #54](https://github.com/lgarciav1/interpretaci-n-pozo/pull/54), apilado sobre #53, commit `3f4cb7d`. Completa el entregable de software de las secciones 9.4–9.6 y la puerta original P5 de la sección 13. GR ya recupera extremos conocidos con los cinco métodos, bloquea ajustes no identificables, invalida propuestas obsoletas, ofrece extremo externo fijo y aplica por zona sin tocar cutoffs. Ahora la decisión de cutoff tiene panel, evidencia y aceptación propios.

Permite elegir Vsh máxima zonal, declarar proxy físico/justificación/referencia/limitaciones y contrastar muestras con la fuente VSH activa del contexto vigente. Conserva réplicas como muestras, sin llamarlas validación independiente; censura, huecos, exclusiones y fronteras tienen motivo. Usa soporte DRX existente y fila exacta de sensibilidad del motor para reservorio/pay, reservorio sin Sw y volúmenes disponibles. Faltantes quedan desconocidos. Preview aislado sin modificar Project ni correr el motor principal; aplicación del cutoff y recibo v1 en una entrada de historial, preservando GR/método, φ/Sw cutoffs, fuentes, otras zonas y originales. Guardar/abrir y snapshots recuperan parámetros/evidencia; versiones futuras se preservan sin ejecutar.

Validación: **2.850 pruebas en 167 archivos**, sin fallos/omisiones; typecheck/build/diff check aprobados. Dieciocho pruebas nuevas con cliente/motor real y Vsh medido/calculado/preparado. Chromium: diez muestras sintéticas, cinco válidas/cinco excluidas; corte inclusivo 0,4→0,5, reservorio 10→20 m, pay 10→19 m, 1 m nuevo sin Sw. Se verificaron declaración, paso/decimal, invalidación, preview intacto, aplicación zonal, undo/redo, nuevo navegador, snapshot tras modificar umbral/borrar recibo y futuro preservado. Offline sin Worker/SubtleCrypto aplica criterio manual con impacto null cuando faltan PHIE/Sw. Regresiones completas GR dos extremos y extremo fijo sobre el mismo HTML aprobadas, sin excepciones de página. HTML 5.712.235 bytes (+0,258 % sobre #53), sin dependencias nuevas, mismo Project v7/preparación 4.

[ADR 0047](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/cierre-p5-cutoffs-evidencia/docs/decisiones/0047-cierre-p5-cutoffs-con-evidencia.md) y [matriz, capturas y reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/cierre-p5-cutoffs-evidencia/docs/validacion/2026-10-31-cierre-p5.md).

**Precisión de alcance respecto a secciones 37–38:** esos avances llamaron pendientes de P5 a propagación estadística, calibración conjunta entre zonas y campaña real, ampliando la puerta original sin contrato científico. Propagación estadística y ajuste conjunto quedan como extensiones posteriores fuera de esta puerta; requieren semántica/covarianzas de incertidumbre y modelo compartido/identificabilidad explícitos. No se afirma haberlos implementado. El contraste con campaña DRX real/referencias externas verificables corresponde a la puerta **P8**, que exige flujo completo real y sintético: sigue pendiente y no hay certificación de campo. Se cierra el software P5, no la entrega completa ni #31/#32/#34.

No se repite toda la matriz visual/DPR/temas ni benchmark. Offline se prueba por HTTP local tras cortar la red; file:// conserva su limitación de política. PR #54 queda abierto para revisión; ningún PR mergeado y main permanece en `4f187f6`.


## 40. P6a: catálogo ambiental y declaraciones de adquisición (2026-10-31)

[PR #55](https://github.com/lgarciav1/interpretaci-n-pozo/pull/55), apilado sobre #54, commit `25f9dd2`. En Preparar datos, la curva seleccionada permite relevar seis familias ambientales con magnitudes/unidades, datos a buscar, referencias descriptivas y límites. Distingue atribución por rol/mnemónico de instrumento/modelo confirmado. Informa falta de corrida/modelo, origen/unidad/familia incompatibles, procesado desconocido, efecto ya aplicado o no reconocido y admisión científica pendiente. Todas las candidatas son no ejecutables; no hay evaluador ambiental ni fórmula genérica ni botón de aplicar.

La corrida registrada admite declarar herramienta, fabricante/modelo y efectos adquiridos con método, versión opcional y referencia. Confirmación explícita para todas sus curvas, reiniciada al editar. Actualizar exige el mismo Project/contexto, valida adquisición y rechaza efectos duplicados/contradictorios o sin referencia. Preserva ids/efectos desconocidos importados, otras corridas y datos de lodo existentes. Crea una revisión y una entrada de historial, sin cambiar Well/arrays, fuentes, parámetros, recetas o calidad preparada; no-op por contenido no agrega revisión. Archivo/snapshots recuperan la adquisición fijada. Mismos Project v7/adquisición 1/preparación 4.

Verificación: **2.860 pruebas en 168 archivos**, sin fallos/omisiones; typecheck/build/diff check aprobados. Diez pruebas nuevas cubren catálogo siempre bloqueado aun con declaraciones, físicas diferentes con RT, DRHO ausente, unidades/origen/herramienta incompatibles, estados desconocidos/vacíos/previos, preservación de ids/efectos/lodo, contexto obsoleto, revisión/no-op/historial/archivo/snapshot y máscara previa con valores/calidad idénticos. Chromium del HTML final: borrador intacto, confirmación reiniciada, revisión sin cambiar blobs/interpretación/otra corrida, undo/redo exactos, nuevo navegador con referencias, snapshot tras cambiar modelo/quitar efecto y offline sin Worker/SubtleCrypto. Sin excepciones de página. HTML 5.726.030 bytes (+0,241 % sobre #54), sin dependencias nuevas.

[Contrato ADR 0048](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/catalogo-ambiental-p6a/docs/decisiones/0048-catalogo-ambiental-y-adquisicion.md) y [evidencia/capturas/reproducción](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/catalogo-ambiental-p6a/docs/validacion/2026-10-31-catalogo-ambiental.md).

**P6 sigue abierta.** El CSV del TP no incluye DRHO y no confirma modelos, lodo ni estado de procesado. Las referencias primarias descriptivas de SLB se consultan sin redistribuir cartas; explican que DRHO corresponde a una compensación aplicada, no autorizan sumarla a RHOB ni reemplazan una admisión numérica. Falta elegir herramienta/modelo y método concretos con referencia/edición/página, dominio, interpolación/fuera de dominio, condiciones, efectos/incompatibilidades, incertidumbre o limitación publicada, permiso de redistribución y casos independientes; luego evaluador puro y ledger/preview/aceptación. Ampliar propiedades del lodo (tipo/composición, base de concentración, Rmf/Rmc, temperaturas y procedencia) requiere su contrato versionado: los campos antiguos se muestran sin convertir ni equiparar a Rw.

No se repiten toda la matriz visual/DPR/temas ni benchmark. Offline se recorre por HTTP local y corte de red; no se prueba file://. No se cierra #32 ni se declara admisión ambiental o avance numérico de P7. PR #55 abierto, sin mergear la cadena; main permanece en `4f187f6`.


## 41. P6: evaluación de admisión y bloqueo científico (2026-10-31)

[PR #56](https://github.com/lgarciav1/interpretaci-n-pozo/pull/56), apilado sobre #55, commit `13f026a`. [ADR 0049](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/admision-cientifica-p6/docs/decisiones/0049-admision-cientifica-p6-pendiente.md) registra candidatas, fuentes, brechas y material requerido. **P6 no está terminada: sigue sin primer método numérico admitido.**

Se evaluaron MGT/ODP (publicación completa accesible, evidencia de dominio/caso ambiental por completar) y Comprobe/USGS 78-515 (resumen disponible; informe con algoritmo devuelve HTTP 403). No se extrapolan fórmulas genéricas ni se usa Arps de fluidos para sustituir la puerta de una herramienta. La falta de modelo del TP limita aplicar al TP; no impediría implementar un método de otra herramienta si tuviera su contrato y casos verificables. La validación real de P8 sigue separada.

Para desbloquear hace falta una fuente accesible que permita fijar herramienta/modelo, unidades/condiciones, dominio, política fuera de dominio, efectos/estado previo, incertidumbre o limitación, tratamiento de redistribución y caso independiente de entrada/salida con tolerancia. Puede ser material adicional MGT, el informe completo Comprobe u otra herramienta con evidencia equivalente. Después faltan evaluador puro, ledger y preview/aceptación/persistencia del método. Ninguna declaración de adquisición ni cálculo sintético de una fórmula sin contrato suple esa admisión.

Entrega solo documental: diff check aprobado; sin cambios en src/datos/dependencias/formatos o catálogo ejecutable. No se repite la suite ni se atribuye un nuevo build: se conserva la evidencia de P6a (2.860 pruebas/168 archivos, navegador/offline). No se reproducen cartas/datasets/PDF de terceros. PR #56 abierto; ningún PR mergeado, main en `4f187f6`, #32 permanece abierto.
