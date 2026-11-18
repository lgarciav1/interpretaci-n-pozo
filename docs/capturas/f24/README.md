# F24 · Recorrido en la sarta 3D

## Repetir con el TP

1. Desde la raíz, ejecutar `npm ci` y `npm run build`. Usar `dist/index.html?inicio=no` con una ventana de contenido de 1366 × 768 y zoom del navegador al 100 %. Elegir tema claro u oscuro en Preferencias.
2. En **Cargar pozo**, pulsar **Cargar datos del TP**, **Siguiente: control de calidad** y **Cargar**. Esperar el estado **Listo**. Plegar los laterales y el panel inferior para reproducir el encuadre.
3. Pulsar el **intervalo de profundidad** del visor. Introducir tope y base de una fila, pulsar **Mostrar tramo** y abrir **Sarta**. La sarta utiliza el centro del intervalo. Su longitud determina cuántos metros de formación se dibujan.
4. Enfocar la escena y pulsar `=` cinco veces para acercarla. Abrir el detalle de la leyenda de pared e invasión para consultar los tramos MD. En la captura de invasión, dejar ese detalle abierto. Las flechas giran la vista. **Vista inicial** restablece la cámara y **Volver al perfil** permite elegir el intervalo siguiente.

| Escena | Tope y base del visor (m MD) | Qué comprobar |
| --- | --- | --- |
| Estable | 7975,7412 a 7999,7412 | La pared cambia poco. En los 37,5 m de formación alrededor del centro, el CSV tiene CAL entre 8,371 y 8,422 in. |
| Derrumbe | 7696,392 a 7720,392 | A 7708,392 m el CAL llega a 12,96 in frente al trépano de 8,5 in. El radio de pared llega a 16,46 cm. |
| Invasión | 8077,392 a 8101,392 | La inversión del TP tiene 137 muestras consecutivas válidas desde 8088,0204 m. A 8089,392 m el CAL de 8,137 in y el DI de 30,093 in corresponden a radios de 10,33 y 38,22 cm desde el eje. RXO vale 6,795 Ω·m en esa muestra. |

## Radios y respaldos

`npm test -- tests/tool-string-radial.test.ts tests/tool-string-scene.test.ts` reproduce el caso sintético y los contrastes con el CSV del TP. Para CAL de 10 in y DI de 20 in, la pared queda a 12,7 cm y el límite lavado a 25,4 cm del eje. Las pruebas alternan ambas curvas por separado, abren un hueco en MD y comprueban el respaldo cuando DI coincide con el calibre o queda dentro de la pared. También comparan la referencia de investigación de la inducción y de la microrresistividad durante un derrumbe.

## Apertura sin conexión

Chromium administrado 156.0.8078.79 devolvió el siguiente error al abrir el archivo con la red deshabilitada.

```text
Page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR at file:///workspace/repo/dist/index.html?inicio=no
```

Para repetir la comprobación alternativa, servir el build con `python3 -m http.server 4184 --bind 127.0.0.1 --directory dist`, abrir `http://127.0.0.1:4184/index.html?inicio=no` y activar **Offline** en la pestaña Red de las herramientas del navegador antes de cargar el TP. Queda pendiente la apertura por doble clic en un navegador que permita archivos locales.

El recorrido por HTTP local pasó en ambos temas con el mismo `dist/index.html` de 8.585.308 bytes. Chromium solicitó únicamente la página de entrada. Con la red deshabilitada cargó el TP, calculó las curvas y permitió navegar a los tres intervalos, girar, acercar, restaurar la cámara y regresar al perfil. Las seis capturas tienen 1366 × 768 píxeles. La captura de invasión muestra 6,8 Ω·m en el centro del tramo.

| Tramo | Claro | Oscuro |
| --- | --- | --- |
| Estable | [Ver captura](tp-estable-claro.png) | [Ver captura](tp-estable-oscuro.png) |
| Derrumbe | [Ver captura](tp-derrumbe-claro.png) | [Ver captura](tp-derrumbe-oscuro.png) |
| Invasión | [Ver captura](tp-invasion-claro.png) | [Ver captura](tp-invasion-oscuro.png) |

La verificación final pasó `npm run typecheck`, `npm test` (3868 pruebas en 245 archivos) y `npm run build`. El revisor independiente comprobó las correcciones de selección de calibre y referencia de investigación al centro de la herramienta, y examinó las seis capturas.
