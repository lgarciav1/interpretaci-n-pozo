# P7a — Diagnóstico ambiental con el CSV disponible del TP

Fecha: 2026-11-01. Base P6 `b8be8a1fa572e6ca0c564a119b4551dc553fcd06` (PR #57), rama apilada `codex/diagnostico-ambiental-tp-p7`, sin integrar main. [Contrato y alcance acordado](../decisiones/0051-diagnostico-ambiental-con-datos-del-tp.md).

## Objetivo y resultado

Se implementa la revisión integrada que los datos disponibles permiten, sin exigir al usuario metadatos de adquisición inaccesibles. Las declaraciones desconocidas se conservan. No se aplica MGT al TP ni se inventa una corrección de densidad, revoque, rugosidad o salinidad. La entrega corresponde al frente de diagnóstico de P7; los métodos numéricos adicionales quedan fuera del alcance actual del TP, conservando su puerta científica general.

El panel muestra recuentos por zona y tramo, soportes válidos, primera alerta, lecturas a una profundidad, selección explícita ante varias originales y sensibilidad a criterios operativos. Se revisan procesado adquirido, recetas y fuente explícita por separado. La hipótesis radial exige activación y reutiliza el evaluador existente de una sola muestra, con observadas/modeladas/residuos y sus estados de resolución. No publica nuevas curvas ni cambia fuentes/cutoffs.

## Datos del TP y contraste independiente

CSV `datos/pozo_tp_perfiles.csv`, SHA-256 `6e3a8d64fe6af0c8183080379bd8d3a3bbaaf5ed55ae918350df600fc818eab0`. Se conserva el archivo completo sin cambios. Los ocho roles disponibles son CALI, BS, PEF, RHOB y cuatro resistividades de arreglo. El proyecto QA se construye desde el lector real del CSV, sin corridas/modelos/datum inventados.

| Recuento | Resultado | Soporte/criterio |
|---|---:|---|
| Muestras | 5810 | Todo el CSV |
| Caliper bajo mínimo | 189 | CAL finito <5 in; fuera de los pares geométricos |
| Pares geométricos | 5621 | CAL válido y BS medido positivo |
| Ensanchamiento | 71 | CAL−BS >1 in, entre los pares geométricos |
| CAL menor que BS | 4550 | Diferencia observada negativa, sin inferir espesor de revoque |
| Pares PE/densidad | 5810 | Valores finitos y densidad positiva |
| PE sospechoso | 5559 | PE >4 b/e y densidad <2,55 g/cm³, criterio existente |
| Ternas resistivas válidas | 5810 | Al menos tres lecturas positivas finitas |
| Separación ≥10 % | 3882 | Máxima/mínima −1; no prueba invasión |

Un barrido independiente con `csv`/`math` de Python, sin importar código del producto, coincide en los nueve recuentos. Se conserva su [resultado con hash y criterios](2026-11-01-diagnostico-ambiental-tp/independent-csv-counts.json). Los tests también contrastan el criterio PE contra el detector existente. Las sumas de zonas coinciden con el total en cada indicador; los cocientes no confunden falta de soporte con ausencia de alertas.

En **7785,6588 m MD**, la hipótesis radial recibe AT10=2,121, AT30=1,772, AT60=1,548 y AT90=1,52 Ω·m. El modelo queda **mal determinado**, aunque el desajuste sea aproximadamente 0,0097: varios diámetros explican las lecturas. Se muestra el intervalo compatible del modelo, sin presentarlo como intervalo de confianza experimental ni adoptar un diámetro único. La advertencia se conserva en la exportación.

## Pruebas y navegador

Ocho pruebas nuevas cubren bordes estrictos/denominadores, nulos, tramo inclusivo/puntual/vacío, zonas/fuera de zonas, unidades equivalentes, BS ausente, ambigüedad, origen/rol/unidad incompatibles sin fallback, sensibilidad/criterios inválidos, arrays intactos, CSV real y conexión al evaluador radial existente.

Typecheck y build aprobados. Suite completa: **2885 pruebas / 170 archivos**, sin fallos (131,99 s). Incluye las pruebas de compatibilidad, rechazo de doble corrección MGT y preparaciones previas existentes.

Chromium, HTML de producción servido por HTTP local, viewport 1440×1000. Recorrido automatizado:

- Abrir proyecto construido del TP con adquisición desconocida; revisar resumen zonal y tabla de procesado.
- Inspeccionar una profundidad con decimal con coma; activar explícitamente la hipótesis radial y exportar lecturas/modelo/residuo.
- Cambiar mínimo de caliper de 5 a 1 in: las 189 muestras dejan de contarse bajo mínimo; la modificación se registra como criterio de vista.
- Entrada de criterio inválida: aviso y exportación no disponible, sin resultado anterior reutilizado.
- Tramo inclusivo y tramo fuera del pozo: cero muestras y ausencia de inspección/hipótesis obsoleta.
- Comparar el Project serializado antes/después de toda la revisión: **igualdad exacta**, incluidos parámetros, fuentes, revisiones, blobs y preparación.
- Variante con dos calipers originales: exige elegir, sin resolver ambigüedad por orden. Con solo dos resistividades, el soporte de ternas es cero.
- Nueva página offline, sin Worker/SubtleCrypto: mismos recuentos y modelo radial disponible.

[Resultado del navegador](2026-11-01-diagnostico-ambiental-tp/result.json), [captura zonal](2026-11-01-diagnostico-ambiental-tp/zonas.png), [captura radial](2026-11-01-diagnostico-ambiental-tp/radial.png), [diagnóstico completo](2026-11-01-diagnostico-ambiental-tp/tp-full.json), [hipótesis radial](2026-11-01-diagnostico-ambiental-tp/tp-radial.json), [tramo](2026-11-01-diagnostico-ambiental-tp/tp-range.json), [tramo vacío](2026-11-01-diagnostico-ambiental-tp/tp-empty.json), [offline](2026-11-01-diagnostico-ambiental-tp/offline.json). Se adjuntan además las variantes de selección ambigua y dos resistividades.

HTML: **5776176 bytes**, SHA-256 `a96c08ae2765dcb594096fddf066f53ef6a7cbf8fda41d6549d392b2c7917941`. Sin dependencias ni versiones de Project/adquisición/preparación nuevas.

## Reproducción y alcance restante

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
node scripts/qa/environment-diagnostics-seed.mjs /tmp/environment-seed
python -m http.server 4178 --directory dist
# Otra terminal, Playwright Python y Chromium instalados:
python scripts/qa/environment-diagnostics.py --seed /tmp/environment-seed --output /tmp/environment-browser
```

Los proyectos antes/después se generan con ese script; no se duplican aquí los arrays completos del CSV. Los JSON de diagnóstico deben acompañar al proyecto o CSV original para reproducir todos sus datos. Los controles locales se conservan en el JSON exportado; no forman parte de un snapshot de interpretación.

No se repite toda la matriz de temas/DPR/tacto ni benchmark: este PR agrega un panel de lectura con scroll horizontal y conserva los estilos existentes. La prueba offline carga el HTML por HTTP y corta la red; no verifica apertura file://. P8 sigue pendiente para el flujo completo de entrega, informe/manual y regresión final con el alcance disponible. Las correcciones que necesitan datos no verificables no condicionan terminar ese TP.
