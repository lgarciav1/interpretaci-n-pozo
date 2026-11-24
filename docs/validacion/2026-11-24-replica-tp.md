# Validación de la réplica del TP

## Referencias

El [PR #104](https://github.com/lgarciav1/interpretaci-n-pozo/pull/104) se incorporó en `d487a78`. La revisión de referencia del plan es `f8f6861b3c8b`. Ambos commits contienen los mismos datos para este recorrido. Los identificadores de los blobs permiten comprobar la versión de cada entrada con `git ls-files -s`.

| Entrada | Cobertura | Blob |
|---|---|---|
| `datos/pozo_tp_perfiles.csv` | 5.810 muestras de perfil, zonas A–E | `15d84fbeb34981626aac994a4ef902d3d183ca9c` |
| `src/modules/mdt/tpData.ts` | 58 pruebas MDT en B, C y D | `e3b90d50501f24c3b5d2bc441dceecdfa9e8d4f2` |
| `src/modules/core/tpData.ts` | 90 plugs de corona 1 y 61 de corona 2, con MD de la hoja PB | `0c9699856bc559e0c898cacfe3015e5cab6896b2` |
| `src/modules/swi-pc/tpScal.ts` | 8 muestras emparejadas entre las tablas SCAL | `41cae53d444ad9e0c241389633f80165d874f21e` |

El [caso reproducible](../../tests/tp-replica.test.ts) usa el importador de perfiles y el motor de la app. Los parámetros de A y B están en la [entrada de prueba](../../tests/fixtures/tp-replica.ts).

| Control | Resultado del control |
|---|---|
| A8, 7.633,2588 m MD | PHIE 0,191435715 y Archie recortado a 1. En la planilla se recorta a 0,999. |
| B608, 7.724,5464 m MD | VCL 0,09112, PHIE 0,205168148 y Sw 0,255091027, con AT90 y Rw fija de 0,020 Ω·m. Banderas de arena, reservorio y pay de 1 / 1 / 1. |
| MDT 3, 7.748,0831 m MD | Presión 19.149,09 psi y drawdown 66,59 psi. |
| Calidad de pozo en A | `IND_WASHOUT=1` a 7.646,0604 m MD (calibre 9,544 in y trépano 8,5 in) y `IND_WASHOUT=0` en A8 (calibre 9,033 in). |
| Agua de formación | 140.000 ppm de NaCl equivalente a 240 °F arrojan aproximadamente 0,01879 Ω·m. |

Los tests existentes conservan proyectos [v6](../../tests/fixtures/projects/v6.pozo.json) y [v7](../../tests/fixtures/archive/v7.pozo.json), y el [CSV MDT sin drawdown](../../tests/fixtures/mdt_es.csv). El [caso del modelo exponencial](../../tests/perm-core.test.ts) controla su evaluación y sus parámetros admitidos. La corrida inicial de los siete archivos de referencia pasó 162 pruebas.

## Recorrido de integración

El [guion de Playwright](../../scripts/qa/replica-tp.cjs) carga el pozo embebido, abre una copia con los parámetros de referencia, aplica los modelos en la interfaz y vuelve a abrir el proyecto guardado. La base del código es `767f9ca`, que incorpora los PR #105 y #106 posteriores al plan. El guion comprueba que el cálculo y las descargas continúan sin red después de cargar el HTML.

### MDT

Se verificaron 25 pruebas en B, 2 en C y 31 en D al filtrar por zona de origen. La pista conservó el rango 0,18–66,59 psi. La prueba MDT-03 mostró 4,59 bar al cambiar la unidad y volvió a 66,59 psi al restaurarla. El modo Drawdown sobrevivió al guardado y a la reapertura. Se exportó la pista de B en PNG, SVG y PDF y se cotejaron los colores de la escala. Las pruebas automatizadas cubren los contactos con el conjunto sintético, la conservación del ajuste al cambiar el color y el caso importado con ceros y celdas vacías. El proyecto del pozo real queda sin un contacto seleccionado porque durante este recorrido no se adjudicaron fluidos a los tramos de presión.

### Corona, SCAL y sumario

Se aplicó un modelo potencial a cada zona después de elegir sus plugs por MD corregida. Los plugs PB ya están en profundidad de perfil y conservan un desplazamiento adicional de 0 m. D se comprobó como escenario de trabajo con el método de porosidad automático y los extremos de GR de fábrica 30/120 gAPI. A, C y E usan la exponencial predeterminada a = −2 y b = 20. Esa extrapolación al resto del pozo se registra como decisión del escenario de prueba.

| Zona | Corona | Plugs | log₁₀(A) | b | R² |
|---|---:|---:|---:|---:|---:|
| B | 1 | 90 | 10,3308777504 | 13,2611099135 | 0,75261 |
| D | 2 | 61 | 9,6145327556 | 11,6731779521 | 0,75322 |

El archivo reabierto y la hoja Curvas del Excel dieron `PERM` = 16,169330448 mD en B608, a 0,000305018 mD del valor de referencia de la planilla. El nivel SCAL 6 usa √(k/φ%) = 0,8877507525 y calcula Swi = 0,029802229 v/v. En la misma muestra, Sw Archie = 0,255091027 v/v. El sumario de B dio 5,46660 mD de k medio del pay y 2,49933 mD·m de kh, que coincide con Capacidad de flujo al usar su filtro de pay. El escenario real deja el corte de k apagado. Un caso sintético activa ese corte y comprueba que usa la misma fuente de permeabilidad.

La convención de espesores es la de `sampleThickness`, que asigna media separación MD de cada lado de cada muestra interior y el paso entero en los extremos. En B, los tres espesores de referencia fueron 2,8956 m de arena, 1,0668 m de reservorio y 0,4572 m de pay.

### Controles de interpretación

| Control | Comprobación |
|---|---|
| PHIE perfil–corona | Ventana ±0,15 m, recta 1:1 y 90 pares en B, sesgo −0,101 v/v y RMSE 0,108 v/v. En D, 61 pares, sesgo −0,107 v/v y RMSE 0,112 v/v. La selección de un plug en el gráfico centró el visor en ambas zonas. Se registró el diagnóstico y se conservó la PHIE de referencia. |
| FF e IR | Se consultó el ajuste de factor de formación por zona y se cargó el ensayo IR del TP. Archie conservó a = 1, m = 2,22, n = 2,059 y AT90 como Rt. |
| Calidad | Se revisó la pista Indicadores en el tramo de A que abarca el derrumbe a 7.646,0604 m y el punto sano en A8. El motor confirmó ambas banderas. El contraste con corona conserva los datos originales y los plugs incluidos. |
| Rw | La calculadora mostró 0,0188 Ω·m a 140.000 ppm y 240 °F. El escenario conservó la Rw fija de 0,020 Ω·m. |
| Snapshots | Se guardaron la referencia con Wyllie y la alternativa con densidad–neutrón (gas) en B. El proyecto final restaura la referencia. |

En el escenario volumétrico se fijaron en B 1 km², petróleo y Bo = 1,2. Son valores ilustrativos. Se conservaron los cutoffs de B, 0,15 / 0,12 / 0,50, y las otras zonas quedaron en sus valores de fábrica.

| Ámbito | Porosidad total en B | Reservorio (m) | Pay (m) | PHIE pay (v/v) | Sw pay (v/v) | OOIP (MMbbl) |
|---|---|---:|---:|---:|---:|---:|
| B | Wyllie | 1,0668 | 0,4572 | 0,15949 | 0,34738 | 0,24944 |
| B | Densidad–neutrón (gas) | 0,9144 | 0,3048 | 0,17373 | 0,44432 | 0,15423 |
| Total | Wyllie | 224,9424 | 6,2484 | 0,16958 | 0,52101 | 2,66024 |
| Total | Densidad–neutrón (gas) | 224,7900 | 6,0960 | 0,17054 | 0,52929 | 2,56504 |

La alternativa eleva la PHIE promedio del pay en B, pero sube también la Sw promedio de las muestras que pasan los cortes y reduce el espesor de pay. Los cambios se leen juntos en el volumen.

## Repetición y apertura local

El guion usa Playwright con Chromium o Firefox. Con el proyecto construido se ejecuta con `node scripts/qa/replica-tp.cjs <carpeta-de-salida>`. La ejecución con Chromium administrado desde `file://` devolvió `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Se sirvió exactamente el `dist/index.html` generado con `python -m http.server 4791 --bind 127.0.0.1 --directory dist` y se ejecutó el guion con `QA_URL=http://127.0.0.1:4791/index.html`. El guion desactiva la red tras la navegación inicial y falla si observa una solicitud adicional. Firefox 159.0 también completó el recorrido desde una URL `file://` con la red desactivada desde el inicio, incluidos el worker, el guardado y las exportaciones. La apertura directa se probó mediante navegación automatizada.

Para ejecutar Playwright sin modificar las dependencias de la app:

```sh
npm install --prefix /tmp/fiubalog-qa playwright
/tmp/fiubalog-qa/node_modules/.bin/playwright install firefox
NODE_PATH=/tmp/fiubalog-qa/node_modules QA_BROWSER=firefox \
  node scripts/qa/replica-tp.cjs tmp/replica-tp
```

La salida incluye el proyecto guardado, el Excel, las tres figuras, capturas a 1366 × 768 y `controles.json` con los valores observados. [Calidad](../capturas/replica-tp/calidad.png) · [Calibración B](../capturas/replica-tp/calibracion-B.png) · [Calibración D](../capturas/replica-tp/calibracion-D.png) · [SCAL](../capturas/replica-tp/scal.png) · [Snapshots](../capturas/replica-tp/snapshots.png).

Con ambas funciones integradas, `npm run typecheck`, `npm test -- --maxWorkers=2` y `npm run build` pasaron. La suite integrada completó 3.940 pruebas en 249 archivos y el build produjo un solo `dist/index.html`.
