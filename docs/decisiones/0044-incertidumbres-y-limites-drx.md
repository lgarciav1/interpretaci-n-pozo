# 0044 — P4c: incertidumbre absoluta y censura numérica de DRX

Estado: implementado sobre P4b; revisión sin integrar main. No declara una campaña de DRX real validada.

El lector permite mapear columnas de incertidumbre absoluta y límite de detección por mineral, en la misma base/escala del valor original. Exige una descripción del significado de la incertidumbre en el informe: no presupone desviación estándar, nivel de confianza ni independencia. Vacío permanece desconocido; cero de incertidumbre solo se conserva si fue declarado. Auxiliares no numéricos, negativos, límites cero/fuera de escala o dos límites contradictorios se rechazan.

Se reconoce `<0,2`/`<0.2` como valor censurado con límite 0,2 y estado below-detection. No se estima 0,1 ni se reemplaza por cero. ND sin límite permanece ND con límite desconocido. La composición incompleta/censurada sigue bloqueando el total cuantitativo. Un dato medido puede conservar su incertidumbre y límite por separado; no se invalida por inferencia del lector.

El contrato opcional `uncertaintyNote` describe la incertidumbre del ensayo. Los valores se guardan en columnas PointSet `uncertainty:<mineral>` y `limit:<mineral>`, solo cuando hay información; filas sin auxiliar contienen NaN, no cero. Se validan también al consumir archivos reabiertos. Los conjuntos anteriores sin auxiliares conservan sus columnas y semántica. Se mantienen v7 y contratos DRX homogéneos por conjunto; no se mezclan bases por fila.

El editor permite revisar valores/estados/auxiliares originales. Hashes de P4b incluyen esas columnas; modificar incertidumbre/límite invalida la evidencia. CSV agrega ambas magnitudes por mineral. No se propaga automáticamente incertidumbre ni se transforma un límite de detección en una observación para calibrar.

Validación específica: cinco pruebas independientes de escala/semántica/contradicciones/textos/compatibilidad y round-trip v7; regresión de comparación/evidencia DRX. La evidencia final de la entrega y el recorrido de navegador se documentan junto con P5 en `docs/validacion/2026-10-31-calibracion-gr-drx.md`.

P4 dispone de carga, bases, soporte, calidad, auxiliares, persistencia y exportación para este dominio admitido. La validación con un informe DRX real sigue pendiente; no se suplanta con el fixture sintético. P5 utiliza propuestas condicionadas a evidencia y relación física declaradas, nunca equivalencia automática arcillas–Vsh.
