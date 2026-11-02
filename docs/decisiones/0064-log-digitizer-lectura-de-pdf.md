# 0064 — Log Digitizer: lectura de PDF (fase futura)

- Estado: **propuesta, no implementada**. Se anota como fase futura; no está en el MVP obligatorio del profesor.
- Parte de: [0062](0062-log-digitizer-motor.md) (motor, límite «PDF y TIFF no se leen») y
  [0063](0063-log-digitizer-interfaz.md) (mesa de digitalización).
- Alcance previsto: la etapa de entrada de `src/modules/digitizer/` (`actions.tsx`, `ui/Desk.tsx`). El motor
  `src/digitizer/` **no cambia**: ya trabaja con `RasterImage` (RGBA).

## Contexto

Hoy la mesa acepta solo JPG, PNG y WebP. Si se le pasa un PDF avisa «Los PDF no se leen: exportá la página como PNG o
JPG». Muchos registros de pozo circulan como PDF (escaneos y registros de las operadoras), así que es una limitación
que se nota en el uso real.

## Propuesta

1. **Biblioteca:** pdf.js, que corre en el navegador y no necesita servidor. Debe quedar empaquetada con su worker
   dentro del HTML único: la app tiene que funcionar sin internet (regla del proyecto).
2. **Flujo:** elegir el PDF → selector de páginas con miniaturas → rasterizar la página elegida a canvas con
   resolución configurable (200–300 dpi alcanzan para digitalizar) → `ImageData` → `RasterImage` → pipeline actual,
   como si fuera una imagen cargada.
3. **Una página por vez.** La unión de tramos de un registro de varias páginas queda como un paso aparte.
4. **Carga bajo demanda** de pdf.js (import dinámico) para no engordar el arranque, y medir cuánto suma al HTML único
   antes de decidir si va incluida o como pieza opcional.
5. **Huella de la sesión:** la sesión se liga a la imagen por huella (`sessionMatchesImage`); para un PDF la huella
   debe incluir el archivo, el número de página y los dpi, para que «Abrir sesión» no confunda páginas.

## Cuidados

- **PDF vectorial:** si las curvas vienen como trazados vectoriales y no como imagen, rasterizar pierde precisión.
  Leer el vector directamente daría mucha más exactitud, pero es un proyecto distinto (otro motor de entrada), no una
  mejora de la carga. Fuera de esta propuesta.
- **Peso del build:** pdf.js suma tamaño al HTML único (ver punto 4).
- **Memoria:** una página a 300 dpi de un registro largo puede ser enorme; limitar el tamaño de la página rasterizada
  y avisar, en la línea de los límites que ya tiene la mesa.
- **PDF con varias páginas continuas:** la curva puede continuar de una página a otra (punto 3).
- **TIFF:** caso parecido (también común en escaneos de registros) pero con otra biblioteca de decodificación. Se
  puede tratar en la misma fase o en otra.

## Criterio de terminado (cuando se haga)

- Cargar un PDF de una página y de varias, elegir página y dpi, y llegar a una curva digitalizada sin pasos manuales
  fuera de la app.
- Pruebas: rasterizado de un PDF sintético con verdad conocida (la misma figura de `tests/digitizer/`), error de
  digitalización comparable al de la imagen original; mensaje claro con PDF dañado, protegido con contraseña o vacío.
- Guion de navegador (`scripts/qa/log-digitizer.cjs`) ampliado y capturas nuevas en `docs/capturas/log-digitizer/`.
- Build de un solo HTML verificado sin red, con el tamaño final documentado.
- Actualizar los límites de 0062/0063 y el texto del mensaje de error de `actions.tsx`.
