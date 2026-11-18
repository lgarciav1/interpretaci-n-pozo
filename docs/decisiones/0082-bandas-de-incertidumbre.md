# ADR 0082 · Bandas de incertidumbre de Sw y porosidad efectiva

## Contexto

El visor muestra las curvas activas y permite comparar modelos de Sw. Esa comparación representa diferencias entre
métodos. El módulo Incertidumbre del volumen ya define distribuciones para errores relativos de porosidad y Sw,
con independencia entre los dos multiplicadores. F15 necesita mostrar sus efectos locales sin retrasar los sliders.

## Decisión

Usamos propagación analítica exacta para el modelo multiplicativo. φ es la porosidad efectiva PHIE de la fuente activa.
Sw es la saturación SW de la fuente activa, calculada o cargada según la interpretación. Tomamos las dos curvas en v/v.
A cada muestra le aplicamos un único multiplicador positivo con moda (o media en la normal) en 1. Para cada curva se
usan sus controles mínimo y máximo en **Incertidumbre del volumen** (por defecto 0,9 y 1,1), con la distribución
global elegida allí (triangular por defecto, uniforme o normal truncada). La normal tiene desvío previo al truncado
igual a un sexto del rango. Los ajustes se usan aunque el Monte Carlo de volumen esté apagado. Un límite cargado
fuera del rango de su control usa su valor de fábrica para la banda.

Cada multiplicador representa un error sistemático relativo y es común a todas las profundidades y zonas. Los dos
multiplicadores son independientes entre sí. El de PHIE resume la incertidumbre de matriz y calibración. El de Sw
resume la de Rw y los parámetros de saturación (por ejemplo, a, m y n). La banda de Sw condiciona sobre la PHIE que ya
se usó para calcular la curva base. No se vuelve a ejecutar la cadena con una PHIE perturbada ni se cuantifica ruido
local, error de modelo o incertidumbre conjunta de las dos salidas. Área, B y cutoffs no entran en estas bandas. Un
cruce con un cutoff vigente indica que el intervalo marginal abarca ambos lados del umbral.

Se reutiliza la inversa de las distribuciones de incertidumbre existentes para los cuantiles acumulados 0,10 y 0,90.
Por monotonía, basta multiplicar la muestra nominal por esos factores y limitar a [0, 1] v/v. Se sigue la convención
de excedencia del volumétrico, P90 abajo y P10 arriba. Con ambos multiplicadores fijados en 1 los dos bordes son
exactamente la curva nominal, incluso si una fuente cargada contiene valores fuera del rango físico. Las muestras
no finitas se llevan a NaN en ambos bordes y cortan el relleno, sin interpolar faltantes. La amplitud depende del
valor nominal y de los límites físicos, sin atribuir mayor error a un tramo por la calidad de su registro.

## Integración

Un worker inline propio calcula ambos pares de bordes tras estabilizarse las entradas del visor. Al cambiar las
entradas se marca la banda visible como desactualizada y se retira el relleno hasta recibir el resultado vigente.
Los toggles por pista y magnitud son preferencias de UI y quedan apagados al inicio. No se guardan en el archivo ni
entran en el historial o en el motor. El visor dibuja los pares como rellenos tenues detrás de las curvas activas.

## Alternativas

Una aproximación de primer orden con desviaciones estándar agrega error en las colas y en los límites físicos.
El Monte Carlo por muestra agrega ruido de muestreo y costo para obtener los mismos cuantiles marginales de este
modelo monótono. Un Monte Carlo que vuelva a ejecutar petrofísica permitiría modelar dependencias físicas entre
parámetros y curvas, pero necesitaría distribuciones y correlaciones calibradas para esos parámetros y datos.
