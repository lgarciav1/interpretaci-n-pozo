# Recorrido completo del pozo del TP (cronometrado)

Guion: `scripts/qa/recorrido-tp.cjs`. Capturas y `resumen.json` en `docs/capturas/recorrido-tp/`. Se ejecuta sobre el HTML construido (`npm run build`), abierto por `file://` en Chromium sin red, con los datos reales del TP embebidos. Objetivo: comprobar la prioridad 3 («un pozo interpretado de punta a punta en menos de 5 minutos») y que los seis módulos obligatorios del profesor se alcanzan y responden.

## Resultado

10 pasos, 0 fallas, 0 errores de página. **37 clics y unos 30 s de tiempo de máquina** (29–30 s en dos corridas).

| Paso | Clics | Qué se comprueba |
|---|---|---|
| Cargar los datos del TP | 4 | Asistente Archivo → Columnas → Control de calidad → Cargar |
| Recorrer los 10 pasos restantes del flujo | 10 | Cada paso responde; el flujo queda en 11/11 |
| MDT: cargar presiones del TP | 2 | 58 pruebas incluidas |
| MDT: gradiente de agua (zona D) | 3 | Arrastre sobre el visor: gradiente, densidad, R² y n |
| Corona: cargar plugs del TP | 2 | 151 plugs; modelo k–φ ajustado |
| Crossplot: GR contra AT90 | 5 | Ejes elegidos en dos clics cada uno (selectores nativos) |
| Crossplot: escala log en Y y capa D | 2 | Filtro por capa y escala logarítmica |
| Crossplot: agregar cutoff | 1 | |
| Histograma: cutoff y capas B y D superpuestas | 4 | |
| Tendencia sobre el sónico (DT) | 4 | Ajuste lineal con ecuación, R² y n |

## Cómo leerlo

- Mide **tiempo de máquina y número de acciones**, no el tiempo de una persona decidiendo parámetros. Con unos 5 s por acción, 37 clics son ~3 min, dentro del objetivo; no es una medición con usuarios.
- El recorrido **no interpreta**: usa los parámetros por defecto del flujo. No valida la petrofísica, que se valida contra ejemplos de libro en los tests del motor.
- Las capturas se tomaron en un viewport de 1600 × 1000.

## Observaciones para revisar (no son fallas del guion)

- **Gradiente MDT de «agua» en la zona D: 0,77–0,79 psi/ft, ρ ≈ 1,77–1,81 g/cm³** (R² 0,984, n 28–29, 7.988–8.250 m). Esa densidad es demasiado alta para agua de formación. El guion arrastra un tramo amplio de la zona D, que puede mezclar fluidos o reflejar una zona sobrepresionada; el resultado depende del tramo elegido (0,767 y 0,786 psi/ft en dos corridas con distinto arrastre). Conviene revisar con la cátedra qué fluido y qué tramo corresponden antes de dar un gradiente por válido.
- **Tendencia DT sobre todo el pozo: R² 0,056** (n 4.648). Es esperable para un sónico sin separar por zona ni litología; el guion verifica que el ajuste se calcula, no que sea una tendencia de compactación útil.
- **Los pasos del flujo mueven el visor** (ampliación a la zona o a un tramo). El guion vuelve a «Ver todo el pozo» antes de la tendencia; quien use la app a mano puede encontrar el visor ampliado después de recorrer los pasos.

## Límites

- Un guion de clics no reemplaza una revisión visual: se miraron las capturas del MDT, el crossplot y la tendencia; las demás no se revisaron una por una.
- La posición de los arrastres en el visor depende del ancho del viewport (1600 px).
- No incluye la prueba por `file://` en el navegador de la usuaria, que sigue pendiente (ver P8 en el masterplan).
