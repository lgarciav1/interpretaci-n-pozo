# 0047 — P5: cutoff de Vsh con evidencia independiente de la calibración GR

Estado: implementado en rama de revisión sobre #53. Cierra el entregable de software P5 del [masterplan, secciones 9.4–9.6 y puerta de fase 13](https://github.com/lgarciav1/interpretaci-n-pozo/blob/codex/masterplan-preparacion-drx/docs/masterplan-preparacion-y-drx.md). No implica integración de la cadena en main.

## Decisión y alcance

La calibración GR estima extremos y método bajo hipótesis físicas declaradas; un cutoff es una decisión de clasificación. Aceptar GR sigue sin modificar umbrales. Una sección separada en Preparar datos → DRX permite elegir **Vsh máxima por zona**, contrastarla con laboratorio y aceptar su propia justificación/impacto con una entrada de deshacer.

Se requiere zona no solapada, cutoff dentro del rango/paso canónico (sin redondeo implícito), extremos composicionales, relación física y alcance del proxy, justificación, referencia de facies/plugs/criterio operativo y declaración de clasificación. Las referencias son declaraciones del usuario: no se certifica su autenticidad ni se infiere permeabilidad a partir de DRX. Cuando falten φ/k/facies independientes, la justificación debe explicitar esa limitación. No se inventan etiquetas de reservorio/pay para las muestras.

Los controles de sensibilidad existentes siguen disponibles para explorar el barrido completo. El nuevo panel contrasta muestras DRX y muestra el efecto exacto del cutoff elegido con los otros dos cortes vigentes; no busca un umbral óptimo ni duplica los algoritmos de netos.

## Cantidades y soporte

Solo roca completa y arcillas en volumen de sólidos: volumen nativo o masa convertida con todas las densidades/referencias explícitas. Fracción arcilla, masa sin convertir, composición incompleta/censurada y valores fuera de la relación declarada quedan bloqueados o excluidos con motivo. No se completan con ceros ni se recortan a dominio.

El proxy es `(C_sólidos − C_limpio)/(C_lutítico − C_limpio)`, bajo la relación constitutiva declarada. Este paso no demuestra una equivalencia universal entre arcillas y volumen de lutita. El contraste usa la **fuente VSH activa**, original/preparada o calculada, del resultado completo y del mismo contexto del pozo. No usa un Vsh inactivo ni convierte el GR promedio de un intervalo mediante una función no lineal. Una proyección efímera permite reutilizar el emparejado/huellas DRX existentes sin guardar la curva calculada como medición.

Se conservan interpolación puntual con distancia máxima, integración por intervalo, cobertura mínima, desplazamientos/exclusiones compartidos, huecos y fronteras. Solo se admiten soportes estrictamente interiores a la zona. Cada réplica se muestra como muestra; los recuentos no se presentan como localizaciones independientes ni validación estadística. Tope 2.048 filas, sin truncación; la tabla muestra las primeras 200 y la evidencia conserva todas.

Se informa cuántas muestras pasan el mismo umbral inclusivo en laboratorio y perfil y en cuántas coincide la clasificación. No son probabilidades ni validación de calidad de reservorio. Incertidumbres/LOD permanecen en el laboratorio y la huella; no se inventan distribuciones, correlaciones o intervalos de confianza. Para Vsh calculado, el QC del emparejado no pretende propagar una incertidumbre de sus entradas.

## Preview y aceptación

El preview usa el coordinador aislado de snapshots y la misma frontera de preparación/identidad que GR. No modifica el Project ni solicita corridas al motor principal. Cambiar controles, laboratorio, inclusión, preparación, zona, fuente, parámetros o revisión invalida/cancela la propuesta.

El impacto se lee de la fila `current=1`, variable Vsh, de `CUTOFF_SWEEP` del módulo existente `cutoff-sensitivity`, en ambos contextos completos. No interpola sobre su grilla. Guarda reservorio/pay, reservorio sin Sw y volúmenes disponibles. Si faltan entradas o la sensibilidad está desactivada, se muestra/guarda desconocido, nunca cero inventado. Aceptar esa decisión manual sigue siendo posible con el contraste Vsh vigente y la limitación visible.

La receta exige el mismo Project, revisión, laboratorio/ids, decisiones del motor, zona y resultados actual/propuesto. Actualiza únicamente `vshCutoff` de esa zona y `xrd:cutoff:<zona>` del ensayo. Conserva GR limpio/lutítico, método, φ/Sw cutoffs, fuentes, otras zonas y originales. El recálculo e historial se reutilizan sin cambios.

## Persistencia y compatibilidad

Recibo `version: 1`, `method: xrd-cutoff-v1`: configuración, referencia/justificación/relación, cutoff previo, fuente Vsh, decisiones, comparación con huellas de entradas/resultados, todas las filas/exclusiones y efecto exacto antes/después. Es JSON string en settings; Project sigue v7 y preparación esquema 4. No se serializan buffers derivados del tamaño del pozo.

Guardar/abrir, undo/redo y snapshots recuperan parámetros y recibo. El historial se rotula como contexto de aceptación, sin presentarlo como verificado contra decisiones actuales. Versiones desconocidas se preservan y diagnostican sin ejecutarse. Aplicaciones anteriores conservan el parámetro compartido y el setting genérico; no se promete que interpreten el recibo nuevo.

## Cierre de P5 y límites posteriores

P5 cubre los cinco métodos GR con puertas de identificabilidad, bloques separados, extremos externos opcionales, preview/contexto obsoleto, aplicación zonal atómica y **cutoffs con su propia evidencia**. [Matriz y pruebas de cierre](../validacion/2026-10-31-cierre-p5.md).

Las notas de avance de P5a/P5b llamaron «pendientes de P5» a propagación estadística, ajuste conjunto entre zonas y campaña real. Esa formulación amplió la puerta original sin un contrato de implementación. Este ADR corrige el alcance explícitamente: propagación estadística y ajuste conjunto quedan como **extensiones fuera de la puerta P5**, no funciones implementadas. Necesitan su propio contrato científico (semántica/covarianzas de incertidumbre, parámetros compartidos e identificabilidad). La campaña real con referencias contrastables queda en la puerta **P8**, que exige flujo completo real y sintético. Su ausencia impide declarar validación de campo o cerrar la entrega completa, pero no la puerta de software P5. No se cierra #31 ni se mergean PRs por este cambio.
