# 0022 — Informe automático (fase 8, función H)

## Alcance

Informe del pozo activo con encabezado, métodos y fuentes elegidos, parámetros efectivos (globales y por zona),
sumario, volumen in situ, avisos y figuras del perfil y de los gráficos disponibles. La salida se imprime con el
navegador: elegir «Guardar como PDF» en el diálogo del sistema. No agrega librerías ni servicios y funciona en el
HTML autocontenido.

## Decisiones

- Se integra a «Exportar» como una tercera opción junto a datos y figuras. El usuario puede revisar una vista previa
  antes de abrir la impresión y elegir las secciones del informe.
- Los resultados se toman del motor existente: el informe no implementa una segunda versión de los cálculos.
  Las fuentes se toman del grafo resuelto, no solamente de la elección explícita guardada en el proyecto.
- La generación necesita un resultado del pozo activo y el motor sin cálculos pendientes ni errores del puente.
  Si el proyecto cambia mientras se dibujan las figuras, se descarta la generación y se pide generar de nuevo.
- Los textos y tablas se copian al generar. Una vista previa conserva el estado del momento de generación, aun si
  el usuario sigue interpretando después. Para incorporar cambios se genera un informe nuevo.
- Los parámetros usan `resolveModuleParams`: valores de fábrica, globales y ajustes por zona siguen las mismas
  reglas que el motor. No se incluyen ecuaciones en esta interfaz.
- Las figuras reutilizan el dibujo de publicación existente, con tema claro. Los gráficos disponibles son los
  publicados por los paneles; un gráfico cerrado puede no estar disponible y la interfaz lo aclara.
- El sumario ancho se divide en grupos de columnas legibles, repitiendo la identificación de zona. Las tablas
  repiten encabezados al imprimir y las figuras ocupan sus propias páginas.
- Las pistas densas se dividen en partes de hasta seis curvas, agrupadas en páginas de hasta seis pistas.
  Se repite la profundidad; los rellenos entre partes conservan ambos extremos en una pista adicional.
  Esto evita perder curvas o desbordar el encabezado con todas las salidas calculadas del TP.
- Los textos procedentes del pozo o del proyecto se escapan al producir HTML. No se cargan imágenes, fuentes ni
  scripts remotos.

## Límites

- «Guardar como PDF» depende del diálogo de impresión del navegador. El usuario elige destino, papel y márgenes.
- El informe conserva las aproximaciones y avisos de los módulos; no convierte estimaciones en datos confirmados.
- El Monte Carlo guarda su resultado en el panel, fuera del proyecto; su distribución no forma parte de H.
- No es una nueva exportación LAS/Excel de puntos MDT, plugs o tendencias.

## Verificación

- Pruebas del informe: parámetros heredados y por zona, copia estable, resultado de otro pozo, texto escapado,
  secciones opcionales, SVG incrustado y pistas densas con rellenos entre partes.
- Prueba en navegador con el pozo del TP: las cinco zonas, todas las pistas, crossplot y descarga del HTML.
- El diálogo nativo de impresión no se pudo validar desde el navegador integrado de pruebas; queda comprobar
  «Guardar como PDF» en el navegador habitual. El informe usa la impresión estándar del navegador.
