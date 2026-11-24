# 0085 · Permeabilidad potencial de corona

## Contexto

El TP calibra la permeabilidad con un ajuste potencial de los plugs de corona. El módulo `perm-core` aplica actualmente la ley exponencial al perfil de porosidad efectiva y guarda parámetros globales y por zona. Los archivos anteriores pueden tener uno solo de los dos coeficientes exponenciales en una zona.

## Decisión

El ajuste potencial reutiliza la regresión de Tendencias con φ en v/v y k en mD. Guarda `perm-core.kphiMethod = "power"`, `perm-core.powerLogA` y `perm-core.powerB` a precisión completa. El modelo evalúa la potencia en el dominio logarítmico para aplicar el recorte de permeabilidad sin multiplicar números intermedios de magnitudes incompatibles. Los rangos de los coeficientes potenciales se declaran en el esquema del módulo.

La resolución de parámetros de este módulo maneja la familia y sus coeficientes como un conjunto. Un potencial local completo tiene prioridad sobre el global. Una zona con coeficientes exponenciales legados conserva la exponencial; el coeficiente faltante se toma de la configuración exponencial global o de su valor por defecto. Un modelo explícito inválido emite un aviso y toma el modelo global válido o la exponencial predeterminada según su alcance. La ley exponencial conserva sus claves y su redondeo al aplicar desde Corona. El recorte conserva su herencia por parámetro. El motor y el informe usan la misma resolución.

Se registra por alcance el origen del ajuste potencial, los plugs usados con su MD corregida, el rango y los coeficientes. La porosidad efectiva ausente o no positiva queda sin estimación. Se avisa si hay muestras calculadas fuera del dominio de calibración. La elección de `PERM` abarca el pozo y el panel muestra la cobertura antes de activar la fuente. El ajuste y la elección de fuente se guardan como una sola operación con deshacer.

Los parámetros nuevos son opcionales y JSON puro. Los proyectos en formato v6 y v7 conservan su comportamiento anterior. Un proyecto con ley potencial requiere el HTML que implementa esta decisión.

## Alternativas evaluadas

Reutilizar los coeficientes exponenciales para la ley potencial haría ambiguo el significado de los overrides anteriores. Resolver sus claves por separado podría combinar coeficientes de familias o alcances distintos. Guardar el ajuste completo como texto dentro de un único parámetro ocultaría sus valores del contrato numérico del motor.
