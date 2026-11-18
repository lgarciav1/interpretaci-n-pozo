# 0080 · Entrenador con respuesta conocida

## Contexto

F14 requiere un caso reproducible que recorra la interpretación ordinaria y permita
compararla con valores sembrados. El pozo de demostración de semilla 2026 se conserva.

## Decisión

La receta JSON v1 conserva semilla entera sin signo de 32 bits y modo de ruido.
La versión fija el algoritmo, el tamaño, el muestreo, las zonas iniciales y los
parámetros. V1 usa Mulberry32 y 1.200 muestras de MD desde 2.500 m cada 0,25 m.
Hay tres zonas de 400 muestras y lechos de 20 muestras. Cada propiedad combina
85 % de un valor uniforme por lecho y 15 % de un valor uniforme por muestra.
Sw usa las bandas 0,68–0,95, 0,25–0,55 y 0,45–0,75 en A, B y C.
Una semilla nueva se obtiene de Web Crypto. Inicio acepta una semilla
anterior para repetir el ejercicio. La receta se guarda con el proyecto, ligada
al pozo original. La verdad se regenera bajo demanda y vive solo en la corrección
de la sesión. El archivo local y el código permiten reconstruir el ejercicio:
el ocultamiento es pedagógico dentro de la interfaz.

Se siembran por muestra porosidad efectiva φ (v/v, 0,12–0,26), Vsh (v/v, 0,03–0,25)
y Sw (v/v, 0,25–0,95), con intervalos de distinta saturación. La porosidad total
equivalente es la que produce la φ efectiva sembrada al aplicar la corrección por
Vsh. GR usa extremos 32 y 117 gAPI. Densidad usa matriz 2,65 y fluido 1 g/cm³;
el neutrón lee la porosidad total equivalente en v/v. Rt usa Archie ideal
(a = 1, m = 2, n = 2, Rw = 0,05 Ω·m, constante a temperatura de formación).
El uso con Vsh distinto de cero es una idealización didáctica sin conducción
de arcilla. Las ecuaciones y referencias se ofrecen en Ecuaciones.

Se suman perturbaciones uniformes independientes y centradas con máximos
0,34 gAPI, 0,0033 g/cm³ y 0,002 v/v para GR, densidad y neutrón.
Rt tiene perturbación multiplicativa logarítmica uniforme con semiancho 0,02
(adimensional). El modo sin ruido usa amplitudes cero y conserva las mismas
verdades para la misma semilla.

Criterio previo a las pruebas: la cadena del motor con IGR, Vsh lineal,
densidad–neutrón, corrección por Vsh, Rw conocida sin corrección térmica y Archie
debe entregar el 100 % de pares de φ y Sw en cada zona. Sin ruido, error absoluto
máximo de 1e-12 v/v para ambos. Con ruido, máximo de 0,004 v/v (φ) y 0,05 v/v (Sw).
El promedio densidad–neutrón tiene perturbación máxima de 0,002 v/v y el Vsh de
0,004 v/v. Con porosidad total equivalente de hasta 0,347 v/v, la propagación
queda por debajo de 0,004 v/v. Con φ de al menos 0,12 v/v, el peor desvío relativo
de φ y el factor de Rt limitan el error de Sw a menos de 0,05 v/v, incluyendo
el recorte físico de la inversión.

La corrección explícita abre una vista dedicada que superpone φ, Vsh y Sw de las fuentes
activas y las sembradas contra MD. Reporta MAE, RMSE, pares finitos y cobertura por
zona y variable en puntos porcentuales, con denominador de muestras de esa zona.
Se usa la corrida vigente del motor y su segmentación. Los valores ausentes
quedan sin par. La verdad permanece fuera de originales, fuentes, preparación,
resultados del motor, catálogos, exportaciones y snapshots. Los parámetros de
generación se muestran después de corregir.

## Alternativas descartadas

Modificar el demo alteraría casos existentes. Añadir curvas verdaderas con una
bandera de visibilidad obligaría a controlar todos los consumidores de curvas.
Guardar series de verdad en el proyecto duplicaría datos derivables de la receta.
