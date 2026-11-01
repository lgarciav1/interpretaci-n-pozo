# 0052 — P8: paquete de entrega, manual e informe trazable

Fecha: 2026-11-01. Base P7a/PR #58, commit `041096c37893db0d8041ff79a1162a233d9aac8b`. Implementación en revisión, sin integrar main. La apertura por file:// del HTML tiene una verificación pendiente por bloqueo administrativo del navegador de ejecución; no se declara pasada esa puerta.

## Alcance

Se aplica la instrucción del usuario: resolver el TP con los datos disponibles. El CSV real es la base del recorrido de entrega; DRX real y condiciones de adquisición no disponibles se declaran ausentes/desconocidas. Los casos de laboratorio conocidos se verifican en un proyecto separado y explícitamente sintético. No se presentan parámetros de fábrica del programa como una interpretación académica final ni se aplican métodos ambientales sin sus requisitos.

P8 agrega documentación de uso y un paquete local revisable, integra evidencia de preparación/laboratorio en el informe y verifica el flujo de proyecto real y sintético, exportación reproducible y regresión de módulos. No admite nuevas fórmulas científicas ni cambia formatos de proyecto, adquisición o preparación.

## Informe

La sección opcional «Preparación, laboratorio y alcance» se incluye por defecto. Captura textos/valores de una sola generación y contiene:

- Revisión de entradas, datum y adquisición declarada; faltantes explícitos, efectos anteriores y referencias conservados.
- Diagnóstico de originales para todo el pozo con criterios predeterminados de P7a, entradas/unidades, soportes y zonas. No afirma reproducir los controles temporales del panel; el manual indica adjuntar su JSON si se exploró otra configuración o hipótesis radial.
- Conjuntos DRX, cantidad de muestras, base, alcance composicional y referencia del ensayo.
- Registros históricos de calibración GR y cutoff: zona, versión validada por su lector, relación adoptada, referencias, revisión/huella, extremos/métricas de validación o decisión/impacto.
- Distinción entre coincidencia de parámetros/revisión y revalidación científica: el informe no recalcula la admisión ni certifica que una evidencia histórica siga vigente. Cambios de datos/decisiones requieren volver al panel.
- Registros corruptos o de versiones futuras rotulados como no interpretables; no se ejecutan ni se eliminan del proyecto. Todos los textos se escapan al generar HTML.

El informe existente ya preserva recetas de limpieza/MGT, QC, fuentes efectivas, parámetros, sumario/volumen y figuras incrustadas. Se conservan esos consumidores y sus validaciones. Se corrige además la carrera de adquisición durante la generación: cambiar solo `inputRevisionId` invalida la copia aunque Well y decisiones del motor compartan sus referencias. Una prueba fuerza ese caso.

## Manual y paquete

[Manual HTML autónomo](../manual-entrega.html), disponible además en «Exportar → Informe → Descargar manual de entrega», incrustado en el build para que la descarga funcione sin red. Explica carga, unidades/calidad del TP, guardado, snapshots, exclusión/interpolación/filtro/alineación, DRX, GR/cutoffs, MGT opcional, diagnóstico ambiental, exportaciones, informe/PDF, limitaciones y resolución de problemas.

`scripts/qa/delivery-seed.mjs` genera TP base con originales/revisiones y un ejemplo sintético con 18 localizaciones, GR 25/135 gAPI y cutoff 0,5 aceptados mediante las funciones reales. Conserva también un archivo TP legado v6 para comprobaciones de compatibilidad. Ningún ejemplo es una interpretación final de cátedra.

`scripts/build-delivery.py` empaqueta el HTML de producción, manual, CSV real, ambos proyectos y LEEME. Incluye un manifiesto de tamaños/SHA-256, commit de origen y estado de trabajo sucio. No agrega claves ni servicios. Orden y marcas temporales ZIP son fijos: con los mismos archivos de entrada y entorno se generan bytes idénticos. Las semillas usan ids/fechas de proyecto normales; generar nuevas semillas puede cambiar el ZIP. El manifiesto comprueba integridad, no es una firma digital.

El ZIP se genera en `dist/`, fuera del control de versiones, con comandos reproducibles. La evidencia versionada registra el HTML probado y el recorrido; el masterplan/PR identifican el commit de entrega. Se conserva la separación entre fuente revisable y binarios generados.

## Puerta offline y file://

La prueba automatizada carga producción por HTTP local y corta la red. Verifica también otro contexto sin Worker/SubtleCrypto: guardado/apertura, preparación y exportación/informe/manual. La ejecución de aprendizaje automático puede indicar que necesita worker; se conservan las advertencias, sin inventar resultados de ese módulo.

La navegación ordinaria a `file:///workspace/interpretacion/dist/index.html` devuelve **`net::ERR_BLOCKED_BY_ADMINISTRATOR` antes de cargar el documento**. No se usan flags, cambios de política ni otra vía para eludir ese bloqueo. Se conserva el resultado en la evidencia. La condición original de file:// de la sección 16 del masterplan permanece pendiente hasta verificar el mismo HTML por doble clic en un navegador de destino que permita archivos locales. Esta limitación del entorno no se reetiqueta como prueba aprobada ni se exige información de adquisición inaccesible al alumno.

No se cierran #31/#32 ni se integra main con este PR. Las ampliaciones científicas fuera de alcance y la interpretación académica final del usuario siguen separadas de la entrega de software.
