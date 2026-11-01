# Línea base de compatibilidad del visor

Fecha: 2026-10-28. Base remota: main, 4f187f6a8d585475efc79b18ed89194b432a2116.

Primer paso de implementación del masterplan del PR #33 y del issue #34. Este cambio solo incorpora caracterización y evidencia: no modifica la aplicación, el renderer, los cálculos ni el formato de proyecto.

## Qué queda protegido

- El pozo TP incluido: 5.810 muestras y 18 curvas medidas.
- Guardado/apertura v6 sin pistas propias: conserva datos, fuentes y parámetros y sigue usando las plantillas de fábrica, tanto en Petrofísica como en Geología.
- Los once grupos de pistas clásicos del TP y las 47 curvas asignadas al recolector Interpretación.

La prueba del recolector caracteriza el comportamiento anterior para conservar la vista clásica durante el rediseño opcional. No lo recomienda como configuración de lectura. Una modificación científica posterior puede cambiar legítimamente la línea base, pero debe revisarse expresamente.

## Verificación ejecutada

Sobre una copia aislada de la base, con los fixtures del repo completos y las dos pruebas nuevas de caracterización:

~~~sh
npm test -- --maxWorkers=1 --reporter=json --outputFile=/tmp/pozo-baseline-complete.json
~~~

Resultado: **144 archivos, 2.373 pruebas aprobadas, 0 fallidas, 0 omitidas**. Las pruebas existentes incluyen validación petrofísica, lectores, exportaciones, snapshots, historial, gráficos y contratos de módulos.

Una primera ejecución con la concurrencia predeterminada, simultánea con typecheck, tuvo un timeout en la prueba de rendimiento de Monte Carlo. La misma prueba pasó aislada (49 pruebas del archivo) y en la suite completa con un worker. No se modificó la prueba, su límite de 5 segundos ni el criterio de rendimiento. Esta evidencia no demuestra rendimiento en todos los equipos; sí proporciona una configuración comparable para verificar la nueva vista sin contención artificial entre pruebas.

Typecheck de la base: aprobado. El build de la base ya fue generado e inspeccionado en la revisión visual previa; se conserva separado del candidato para comparar ambos en navegador. En el entorno administrado file:// está bloqueado; la inspección visual se hace por HTTP local y no certifica la apertura por doble clic.

## Condiciones para el siguiente cambio

1. Preset Petrofísica esencial optativo; la plantilla de fábrica permanece predeterminada.
2. Reutilizar pistas, renderer, historial y serialización existentes; no cambiar formato ni fuentes.
3. Conservar las configuraciones guardadas, los datos originales y todos los módulos/curvas en el catálogo.
4. Verificar resultados y exportaciones con las mismas entradas, probar undo/redo y guardar/abrir.
5. Registrar capturas comparables y ejecutar de nuevo la suite con un worker.

Este documento no declara implementados DRX, correcciones ambientales, migración v7, modo amplio en una acción ni todo el rediseño del visor.
