# Másterplan para reproducir el TP de pozo en FIUBALog

**Base de trabajo:** `main` en `f8f6861b3c8b`. **Objetivo:** terminar en FIUBALog el gráfico de presiones MDT coloreado por *drawdown* y aplicar la ley potencial de corona como fuente de permeabilidad del perfil. La prueba final va desde los datos embebidos del TP hasta las figuras y el sumario exportados.

El núcleo del ejercicio ya corre en la app. La comprobación con la grabación del 18 de noviembre reprodujo VCL, porosidad efectiva y Archie en dos filas. En la zona B también coincidieron los tres indicadores de espesor. Los apuntes de clase agregan controles de calibración con corona, calidad de pozo, Rw y escenarios volumétricos al recorrido final. [Recorrido del TP](validacion/2026-11-03-recorrido-tp.md) · [Commit de referencia](https://github.com/lgarciav1/interpretaci-n-pozo/commit/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d)

## Orden de ejecución

| Fase | Entrega | Dependencia | Tamaño previsto |
|---|---|---|---|
| 0 · Referencias | Fijar entradas, filas de control y pruebas de compatibilidad. | Revisión del commit base. | Chico |
| 1 · MDT | Drawdown visible e importable, leyenda y figura exportable con el mismo color. | Fase 0. | Mediano |
| 2 · Corona | Ley potencial por zona, aplicada a `PERM` y consumida por SCAL y el sumario. | Fase 0. Puede avanzar en paralelo con MDT. | Mediano a grande |
| 3 · Recorrido del TP | Ejecutar B y D, guardar, reabrir y exportar. Documentar el recorrido y sus resultados. | Fases 1 y 2. | Mediano |

La línea de corte para la entrega funcional es cerrar las dos funciones y pasar el recorrido de integración. Las decisiones de interpretación, como los puntos de un gradiente o el ajuste de cada corona, quedan a cargo de quien ejecuta el TP.

## Fase 0 · Fijar las referencias

1. Registrar el commit y la versión de los datos embebidos. Reusar el CSV de perfiles, los 58 puntos MDT, los plugs PB y los datos SCAL que ya trae la app. Comparar por profundidad MD y zona. Los números de fila de Excel sirven como referencia de la grabación.
2. Registrar los parámetros usados en la comprobación. Para A8, usar GR limpio/sucio 60/110 gAPI, densidad de matriz y fluido de 2,65 y 1 g/cm³, y la combinación cuadrática disponible como **Densidad–neutrón (gas)**. Para B608, usar 45/95 gAPI y Wyllie con Δt de matriz 54 µs/ft, Δt de fluido 189 µs/ft y Cp = 1. En ambos casos usar porosidad aparente de arcilla 0,25, Rw fija 0,020 Ω·m y Archie con a = 1, m = 2,22 y n = 2,059. Para las banderas de B usar cutoffs de 0,15 / 0,12 / 0,50.
3. Conservar dos casos de control para el motor y un proyecto guardado con la ley exponencial. Registrar además un conjunto MDT sin columna de *drawdown* para comprobar que se pueda seguir trabajando con archivos anteriores.

| Control | Resultado de referencia |
|---|---|
| B608 · 7.724,5464 m MD | VCL 0,09112, PHIE 0,205168148, Sw Archie 0,255091027 y banderas de arena, reservorio y pay en 1 / 1 / 1. |
| A8 · 7.633,2588 m MD | PHIE 0,191435715 y Archie sin recorte 1,127715081. La salida se recorta a 0,999 en Excel y a 1 en FIUBALog. |
| PB · corona 1 de B | Ajuste de 90 plugs con φ en v/v y k en mD. Da 16,169330448 mD en B608. El Excel muestra 16,16902543 mD. |
| MDT · prueba 3 de B | A 7.748,0831 m MD, presión de formación 19.149,09 psi y *drawdown* 66,59 psi. |

En el caso de k, conservar la cifra del video y la del ajuste como dos referencias distintas. Para la comparación visual en B608 usar una tolerancia absoluta de 0,001 mD, que cubre la diferencia observada de 0,000305 mD. Para las pruebas del motor, usar además casos analíticos y un ajuste independiente con los puntos seleccionados. [Datos del pozo](https://github.com/lgarciav1/interpretaci-n-pozo/blob/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d/datos/pozo_tp_perfiles.csv) · [Datos MDT y SCAL embebidos](https://github.com/lgarciav1/interpretaci-n-pozo/blob/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d/docs/decisiones/0057-mdt-y-scal-del-tp-embebidos.md)

## Fase 1 · MDT coloreado por drawdown

### Implementación

1. **Datos e importación.** Usar la columna opcional `drawdown` de `PointSet` con el mismo identificador que el conjunto embebido. Agregar el campo de mapeo en `src/io/pressures.ts` y `LoadPressuresDialog.tsx`. Reconocer encabezados como `Drawdown` y `Caída de presión` antes del mapeo genérico de presión. Confirmar la unidad de origen y convertir a psi canónico. Mantener disponibles presión, profundidad, ID y estado de inclusión aunque falte drawdown.
2. **Panel y pista.** Agregar una columna de drawdown en la tabla y una opción **Color de puntos → Drawdown**. En la pista de presión, usar presión en X y MD creciente hacia abajo. Mostrar leyenda con unidad y rango, y un tratamiento visible para «Sin dato». Usar la misma escala del conjunto al alternar B y D para que los colores sean comparables. Identificar inclusión y descarte con el estilo del marcador y cada fluido con el color de su recta. El ajuste se rige por los criterios existentes de inclusión y tramo.
3. **Zona y contacto.** Reusar la selección por intervalo y los gradientes existentes. Cuando se muestre la zona de la hoja, mantenerla identificada como dato de origen. Si la vista filtra por topes editados, aplicar ese filtro con la profundidad del punto y rotular la zona interpretada. Conservar el cálculo de intersección existente y el aviso cuando la profundidad del ajuste sea MD. Mostrar el contacto de los gradientes seleccionados y permitir cotejarlo con Sw en el visor.
4. **Guardar y exportar.** Reusar `project.display.overlays` con un campo opcional para el modo de color. Pasar esa configuración al contexto de dibujo del visor y al de exportación. La pista y la figura exportada deben leer la misma función de escala y leyenda. Dibujar la leyenda en la figura para que pueda interpretarse fuera de la app. Usar la exportación del visor en un tramo MDT como salida principal.

### Criterios de aceptación

- **Datos reales.** Cargar las 58 pruebas embebidas. Ver las 25 pruebas de B, 2 de C y 31 de D según el rótulo de origen. Confirmar el rango 0,18–66,59 psi y los 66,59 psi de la prueba de control. Al cambiar de unidad, tooltip, tabla y leyenda muestran valores consistentes.
- **Valores incompletos.** Importar un archivo con valores válidos, cero y celdas vacías. Cero aparece como valor numérico. Las celdas vacías aparecen como «Sin dato». Un proyecto anterior sin esa columna sigue mostrando sus pruebas y permite ajustar gradientes.
- **Misma interpretación.** Para las mismas pruebas incluidas, alternar el color conserva el gradiente, la densidad calculada y el contacto. Comprobar la intersección con el conjunto sintético MDT ya versionado. En el pozo del TP, el contacto se registra solo si los tramos elegidos lo respaldan.
- **Figura y persistencia.** Guardar, reabrir y exportar la pista en PNG, SVG y PDF con los mismos colores, leyenda y unidades. Confirmar que la figura permite reconocer el drawdown y distinguir los fluidos. Revisar en tema claro y oscuro.

**Puntos de enganche.** Importador de presiones, `tpMdtSet`, `mdt/dock.tsx`, `mdt/overlay.ts` y el exportador de figuras del visor. Mantener el cálculo de gradientes en las funciones existentes. [Importador](https://github.com/lgarciav1/interpretaci-n-pozo/blob/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d/src/io/pressures.ts) · [Superposición MDT](https://github.com/lgarciav1/interpretaci-n-pozo/blob/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d/src/modules/mdt/overlay.ts) · [Fuentes de figuras](https://github.com/lgarciav1/interpretaci-n-pozo/blob/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d/src/app/export/figureSources.ts)

## Fase 2 · Permeabilidad potencial de corona

### Implementación

1. **Ajustar desde Corona.** Usar el ajuste `power` existente en `fitTrend`. Agregar **Exponencial / Potencial** en el modelo k–φ del panel. Trabajar con φ en fracción y k en mD. Tomar puntos incluidos con φ y k finitas y positivas para el modelo potencial. Usar la profundidad corregida cuando la selección sea por zona y mostrar cuántos plugs entraron al ajuste, su rango de φ y R². El modelo puede ajustarse con todos los datos elegidos o por zona. La ecuación se documenta en la pantalla Ecuaciones según la convención del repo.
2. **Aplicar al perfil.** Extender `kphiModelOf`, `kphiSync` y `applyKPhiModel` para ambas familias. Aplicar guarda método y coeficientes juntos por zona o globalmente y puede activar `perm-core` como fuente de `PERM` en una sola operación con deshacer. El worker evalúa k sobre `PHIE` en el mismo módulo. Mantener la precisión de cálculo al guardar y redondear solo para mostrar el ajuste potencial.
3. **Decisión de persistencia antes del PR.** Mantener los parámetros exponenciales y su redondeo actual. Para la ley potencial, incorporar un método explícito y coeficientes propios en el contrato de parámetros que usa el worker. Guardar `log10(A)` y el exponente b con rangos propios para evaluar k = A·φᵇ. La resolución por zona toma un modelo completo de su ámbito y usa el global cuando corresponde. Un override exponencial guardado antes del cambio conserva esa familia, incluso si el global pasa a potencial. Los proyectos con potencial requieren el HTML que implementa este modelo.
4. **Dominio y trazabilidad.** Para la ley potencial, φ no positiva o ausente queda sin estimación. Aplicar `kMin` y `kMax` a los resultados válidos con el criterio del módulo. Informar cuándo hay extrapolación fuera del rango de los plugs. Si cambia la selección, el desplazamiento o el modelo, señalar que la curva aplicada proviene del ajuste anterior hasta que se reaplique. Registrar conjunto, zona objetivo, método, puntos y coeficientes para poder repetir la comprobación.
5. **Consumo de `PERM`.** La fuente activa se elige por pozo. Antes de activarla, mostrar qué tramos tienen modelo local y cuáles usarían el global. Para el TP, definir el modelo de B, el de D y el tratamiento de los tramos restantes antes de activar `perm-core` para todo el pozo. Verificar que la fuente llegue al visor, al Excel exportado, a SCAL, al sumario y a capacidad de flujo. El TP de la clase usa el corte por k apagado. Un caso dedicado con el corte activado comprueba que lee la fuente seleccionada.

### Criterios de aceptación

- **Réplica numérica.** Ajustar «Potencial» a los 90 plugs de corona 1/B y aplicarlo en B. En B608, con PHIE 0,205168148, obtener 16,169330448 mD dentro de la precisión de cálculo y quedar a menos de 0,001 mD del valor visible en Excel. Probar el caso usando la interfaz y verificar la curva activa en la exportación.
- **Conexión real.** En un fixture con φ, k y SCAL conocidas, cambiar la fuente de `PERM` y comprobar el cambio en Swi, k promedio y kh. En la entrada SCAL de B608, verificar el término √(16,169330448 / 20,5168148), con k en mD y φ en %. El recálculo tiene que usar los mismos valores de `PERM` que ve el visor. Verificar que las banderas del ejemplo se conservan con el corte de k apagado.
- **Zonas y guardado.** Aplicar el potencial en B con la exponencial en una segunda zona. Comprobar que modificar y reaplicar B afecta su tramo, que deshacer restaura la selección y el cálculo anterior y que reabrir el proyecto conserva ambos métodos.
- **Compatibilidad.** Repetir las pruebas de la ley exponencial y abrir proyectos legados v6 y v7. Probar puntos descartados, φ cero y ausente, cambios de tramo, coeficientes inválidos y límites de permeabilidad. El botón Aplicar se habilita cuando el ajuste es válido.

**Puntos de enganche.** Serie de plugs de `src/modules/core/series.ts`, aplicación en `src/modules/core/model.ts` y `dock.tsx`, evaluación pura en `src/petro/`, módulo `src/modules/perm-core/index.ts` y consumidores del rol `PERM`. La separación de coeficientes se documenta en una decisión de arquitectura antes de implementar. [Modelo de corona](https://github.com/lgarciav1/interpretaci-n-pozo/blob/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d/src/modules/core/model.ts) · [Permeabilidad de corona](https://github.com/lgarciav1/interpretaci-n-pozo/blob/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d/src/modules/perm-core/index.ts) · [Motor de regresión](https://github.com/lgarciav1/interpretaci-n-pozo/blob/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d/src/petro/regression.ts)

## Fase 3 · Recorrido de entrega

1. Cargar el pozo del TP desde la app. Reproducir el flujo de B con los parámetros de control y revisar D con sus parámetros y selección de corona. Volver a comprobar las filas A8 y B608 al final del recorrido.
2. Cargar MDT, activar drawdown, exportar la pista y revisar contactos frente a Sw. Cargar corona, revisar la calibración de PHIE y ajustar y aplicar la ley potencial por zona. Activar `PERM` de corona y comprobar SCAL y sumario.
3. Completar los controles de los apuntes con las herramientas de calibración, calidad, Rw y snapshots. Guardar un snapshot de referencia y uno alternativo para comparar el efecto de la fuente de porosidad sobre el volumen in situ.
4. Guardar el proyecto, abrirlo de nuevo y exportar figura y Excel. En la evidencia registrar commit, zonas, conjunto de plugs, ajustes, fuente de permeabilidad, cutoffs y convención de espesores.
5. Ejecutar `npm run typecheck`, `npm test` y `npm run build`. Verificar el HTML único abierto por doble clic sin internet. Si Chromium administrado bloquea `file://`, dejar registrada esa limitación y correr la prueba de interfaz con el mismo HTML servido localmente y sin red después de cargar. La verificación por doble clic queda pendiente hasta ejecutarla en un navegador que la permita.

Cerrar cada función en su propia rama y PR con pruebas y capturas. El trabajo de interfaz MDT lo puede tomar el rol `desarrollador-ui`. La ley potencial requiere `analista-numerico` y revisión independiente de motor y persistencia. Para el cierre, agregar las dos funciones al másterplan del repositorio y actualizar arquitectura donde cambie un contrato. [Reglas de ejecución del repo](https://github.com/lgarciav1/interpretaci-n-pozo/blob/f8f6861b3c8bd944b07680df15bb4a942a8b3a9d/docs/masterplan-funciones-nuevas.md#2-reglas-de-ejecución)

### Controles que aportan los apuntes

| Tema | Qué pedir en el recorrido | Criterio de revisión |
|---|---|---|
| VCL y porosidad efectiva | Revisar GR limpio/sucio y la porosidad aparente de arcilla por zona. En el escenario de réplica usar VCL lineal de GR y la corrección de PHIE por arcilla. | Registrar la fuente de porosidad (densidad, sónico o densidad–neutrón), los parámetros de matriz y el valor aplicado por zona. Verificar A8 y B608 con las fuentes del video. |
| Calibración de PHIE con corona | En **Calibración → Porosidad · perfil vs. corona**, probar B y D por separado. Emparejar por MD corregida del plug, con interpolación o una ventana registrada. El clic en el crossplot lleva al tramo del perfil. | Mostrar el gráfico con recta 1:1 y registrar número de pares, sesgo y RMSE. Si se corrige por zona o por litología, declarar el criterio y comprobar el resultado en pares reservados para validación cuando haya soporte. R² informa correlación y el sesgo y RMSE miden cercanía a la referencia. |
| Calidad y banderas de pozo | Revisar calibre contra tamaño de trépano y mostrar `IND_WASHOUT` en el visor. Para exclusiones adicionales, usar una máscara de preparación con motivo e intervalo registrados. | Mostrar un tramo sospechoso y uno sano. Documentar qué se excluyó del contraste con corona, y comparar la curva original con la que se usa en el cálculo. |
| Rw y Archie | Para la réplica usar Rw fija de 0,020 Ω·m. Contrastar con **Agua de formación**, que para 140.000 ppm de NaCl equivalente y 240 °F da aproximadamente 0,01879 Ω·m, o con **Pickett** sobre arena limpia con evidencia de saturación de agua. Usar SP solo donde haya una deflexión representativa, datos del filtrado de lodo y temperatura. | Registrar la fuente de Rw y la temperatura. En Pickett validar la línea de agua, la pendiente asociada a m y el producto a·Rw del intercepto. Para separar Rw hace falta fijar a. El SP del TP tiene cobertura escasa, por lo que la estimación depende del soporte del tramo. |
| FF, IR y Swi | En **Calibración**, revisar FF para a y m e IR para n. En **SCAL**, distinguir Swi, saturación de agua irreducible, de la Sw calculada por Archie. | Verificar la asignación de a, m, n, Rw y Rt = AT90 en B608. Registrar el nivel SCAL y contrastar Swi con la Sw del perfil. El parámetro n de Archie se calibra con IR, mientras que la línea de agua de Pickett sirve para m y a·Rw. |
| Escenarios de POIS y GOIS | Usar **Volumen** y **Comparar snapshots** para evaluar dos fuentes o métodos de porosidad. Fijar zona, área, fluido, factores volumétricos y cutoffs si la prueba busca aislar el efecto de la porosidad. | Guardar ambos escenarios y comparar Hk, Hu, PHIE, Sw y OOIP/OGIP por zona y total. Configurar un caso con pay y volumen calculado para ver las columnas volumétricas. Si cambiar PHIE modifica Sw o net pay, registrar su efecto en cadena sobre el volumen. |

El crossplot de calibración ya se puede exportar como figura. Si la entrega exige reproducir el cruce de la planilla identificado en los apuntes como `INDEX`, agregar la descarga de pares a partir del mismo cálculo del crossplot. Incluir ID del conjunto y del plug, MD original y corregida, zona, ventana, fuente de porosidad y ambas mediciones. Distinguir pares válidos, faltantes y excluidos. Verificar que las filas comparables coincidan con los puntos del gráfico, incluso con desplazamientos y cerca de límites de zona. [Calibración con corona](decisiones/0023-calibracion-con-corona.md) · [Comparación de snapshots](decisiones/0026-comparacion-de-snapshots.md)

Si hacen falta banderas de mala calidad más amplias que `IND_WASHOUT`, definir primero los eventos y si la marca será informativa o excluirá datos. La propuesta es una bandera por intervalos con motivos, separada de la clasificación de derrumbe. Para correcciones por porcentaje litológico, predefinir clasificación, método de mezcla, parámetro a calibrar y evidencia mínima por clase. Si se decide aplicar una regresión perfil–corona, evaluar la rutina pura `applyCalibration` y guardar la curva resultante como alternativa, con validación independiente antes de elegirla como fuente. Son candidatos posteriores al recorrido con las herramientas actuales.

## Si se exige reproducir la planilla celda por celda

- **Crossplot filtrado.** La réplica exacta de la nube densidad–neutrón necesita el mismo filtro por VCL y zona. Si la cátedra lo pide, agregar un filtro por una tercera curva y probar el mismo conjunto de muestras, incluidos los valores exactamente en el umbral.
- **Recortes y espesor.** Excel usa cortes estrictos y algunos recortes interiores. FIUBALog actualmente admite la igualdad en los cutoffs y limita Archie a 1. Si deben coincidir las banderas en esos bordes, especificar las reglas mediante pruebas antes de introducir un modo de compatibilidad. Para cotejar los totales de Hk y Hu por zona hace falta la planilla final con las fórmulas, los datos y el criterio de espesor por muestra.
- **Simandoux.** La clase sigue con Archie. Si la entrega pide reproducir la columna Simandoux, primero recuperar su fórmula y sus referencias de celda. La comparación anterior mostró un valor distinto con la variante n = 2 de FIUBALog.

Completar las fases 1 a 3 permite entregar las dos funciones anotadas con evidencia sobre los datos del TP. La coincidencia de toda la planilla es una validación adicional con su propio archivo de referencia.
