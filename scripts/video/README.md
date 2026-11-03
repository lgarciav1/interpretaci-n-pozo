# Video de presentación de fiubaLog

Brief cinematográfico de ~3–4 min para mostrar la herramienta a gente no especialista. El primer minuto ya está
renderizado (apertura, Inicio, carga, entrada al pozo, visor y cierre); el resto está guionado y en parte probado.

## Cómo funciona

Nada se graba en tiempo real: este contenedor no tiene GPU y la app dibuja lento, así que una grabación de pantalla
sale trabada. Todo se captura **cuadro por cuadro a 30 fps** y después se compone.

| Pieza | Qué hace |
|---|---|
| `opening/index.html` | Apertura en three.js: la herramienta sube desde el fondo, el GR real del TP se dibuja y la cámara se acuesta hasta que la pista es una ruta. Función pura del tiempo (`renderAt(t)`). |
| `frames.cjs` | Renderiza una escena determinista como la apertura, cuadro por cuadro. |
| `director.cjs` | Filma la app real (`dist/index.html`) cuadro por cuadro: reloj de Playwright congelado y avanzado 1/30 s por cuadro, animaciones CSS pausadas por CDP y llevadas al mismo tiempo virtual, cursor propio con trayectorias suavizadas. Las esperas reales (carga, motor) no se ven en el video. `DRY=1` recorre todo sin capturas, para validar selectores en minutos. |
| `seg1.cjs` | Segmento 1: Inicio con la sarta 3D, fichas de herramientas, carga con control de calidad, entrada al pozo. |
| `segments.cjs` | Segmentos 2–6: `visor` (visor, snapshot, slider en vivo, cortina), `mdt` (presiones y corona), `graficos` (crossplot, histograma, tendencias), `digitizer`, `extras` (Geología, perfil radial, tipos de roca, Ecuaciones, tema oscuro, informe, cierre en Inicio). |
| `comp/index.html` + `comp-render.cjs` | Compositor: clips con velocidad propia, cámara virtual (zoom y paneos con suavizado), transiciones, rótulos animados, tarjetas y frase central. Lee una línea de tiempo JSON. |
| `timeline60.py` | Arma la línea de tiempo del primer minuto desde las marcas de cada segmento, con los cortes sobre el compás. |
| `music.py`, `music60.py` | Música original sintetizada (numpy, 100 BPM, compás = 2,4 s). `music60.py` es el arreglo del primer minuto. |
| `motion.py` | Control de calidad del movimiento: diferencia entre cuadros consecutivos; lista los saltos. |

Los archivos de servicio se interceptan con Playwright bajo un origen ficticio (`http://local.video/`): no se abre
ningún puerto.

## Pasos (primer minuto)

```bash
npm ci && npm run build
W=/ruta/de/trabajo                       # fuera del repo: los cuadros pesan cientos de MB
scripts/video/preparar.sh $W
cd scripts/video
node frames.cjs $W/opening $W/opening/frames 30                    # apertura (~4 min)
node seg1.cjs $W/seg1 "$(git rev-parse --show-toplevel)"           # ~15 min
STOP_AT=snapshot node segments.cjs visor $W/seg2 "$(git rev-parse --show-toplevel)" $W/scan
python3 -I timeline60.py $W
cp -r comp $W/                                                      # si se cambió el compositor
node comp-render.cjs $W $W/timeline60.json $W/comp60 0 30 &         # dos mitades en paralelo
node comp-render.cjs $W $W/timeline60.json $W/comp60 30 60
python3 -I music60.py $W/musica60.wav 60
ffmpeg -framerate 30 -i $W/comp60/c%05d.jpg -i $W/musica60.wav -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 17 -tune film -pix_fmt yuv420p -af loudnorm=I=-16:TP=-1.5 \
  -c:a aac -b:a 192k -shortest -movflags +faststart fiubaLog-primer-minuto.mp4
```

Ritmo: ~1 cuadro/s para la app y ~0,4 s/cuadro para el compositor. Más de dos capturas en paralelo con 4 núcleos
hace fallar las capturas por tiempo (el motor recalcula en cada movimiento de slider).

## Pendiente para el video completo

- `digitizer`: en la prueba en seco, la esquina inferior derecha del marco (`[902, 2688]`) queda fuera de la vista;
  hay que desplazar la vista antes de marcarla (el guion de QA lo hace con barra espaciadora + arrastre).
- `extras`: falta la prueba en seco.
- `visor` completo (slider, cortina): validado en seco; renderizar sin `STOP_AT`.
- Línea de tiempo completa (~3:30) siguiendo el guion acordado y reestructurar la música (`music.py`) a esa duración.
- Siempre: revisar el movimiento con `motion.py` antes de entregar (no alcanza con mirar cuadros sueltos).

## Lecciones

- `locator.click()` espera cuadros de animación y con el reloj congelado nunca vuelven: se hace clic con el mouse en el
  centro del elemento (`selectOption` con `force`).
- Arrastrar la sarta en Inicio en horizontal la deja apuntando a la cámara: mejor mostrar herramientas con clics.
- Las sombras de los rótulos tienen que fundirse en su propia ventana de tiempo, no solo mientras el rótulo está activo.
