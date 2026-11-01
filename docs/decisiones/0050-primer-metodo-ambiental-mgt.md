# 0050 — P6: modelo ambiental GR para LDEO MGT

Estado: implementado en revisión sobre #56. Cierra el entregable de software P6: catálogo más un método específico con evaluador puro, referencia y casos independientes. No modifica main ni certifica el TP.

## Referencia y contrato

Goldberg, D., Meltser, A., Myers, G. y Masterson, W. (2004), *Comparison of Multi-Sensor Spectral Gamma Ray Tool (MGT) and conventional spectral gamma ray logs, ODP Site 1179*, Proc. ODP, Sci. Results 191, cap. 6, pp.5,10,18. [Artículo completo](https://www-odp.tamu.edu/publications/191_SR/VOLUME/CHAPTERS/004.PDF).

Se implementan las ecuaciones 2–4 del apéndice B: GR total calibrado MGT, agua de mar y posición centrada o excéntrica. Se conserva la limitación empírica: no se publica incertidumbre cuantificada y la precisión depende de caliper/calibración. No se usan las ecuaciones K/U/Th ni se deduce un modelo genérico. La especificación de la herramienta y las condiciones publicadas acotan la implementación; no se reemplaza caliper por su máxima extensión.

Definición `odp-mgt-seawater-gr`, algoritmo `goldberg-2004-eq2-4-v1`, método 1. Código propio, evaluación analítica sin carta interpolada. No se incorporan cartas, PDF, tablas, figuras ni datasets ajenos; fixtures sintéticos generados independientemente, con atribución. No se afirma una licencia sobre material del fabricante ni se requiere redistribuirlo para evaluar las ecuaciones.

## Dominio operativo declarado

| Magnitud/condición | Contrato de esta versión |
|---|---|
| Instrumento | Corrida declarada GR/espectral, fabricante LDEO (o nombre completo), modelo MGT. No se infiere de mnemónico. |
| GR | Original importado y calibrado, rol GR total, gAPI; valor finito ≥0. No es CPS crudo ni GR de otra herramienta. |
| Caliper | Original con rol CALI y unidad reconocida de longitud; mismo índice/datum MD. Conversión explícita de in/cm/m/ft a pulgadas. |
| Geometría | Pozo abierto, agua de mar sin aditivos; posición conocida centrada/excéntrica. |
| Guardas de diámetro | Mayor que OD 3,375 in y hasta 42 cm. Son **guardas operativas de implementación**, derivadas de geometría y límite de lectura descritos; no se presentan como un intervalo experimental certificado. |
| Condiciones máximas declaradas | Profundidad ambiente bajo nivel del mar ≤5000 m, temperatura 0–100 °C, presión 0–10000 psi. Se documentan para todo el intervalo; no se deducen de MD. La referencia no define un datum para su límite de profundidad: esta versión usa una restricción conservadora explícita bajo nivel del mar. |
| Estado previo | Adquisición revisada y referencia explícita de GR calibrado sin corrección ambiental previa; lista vacía de efectos no es prueba por sí sola. Esta primera versión bloquea cualquier efecto ambiental adquirido, incluidos temperatura/presión, porque no admite su composición. |
| Incertidumbre | No cuantificada en la referencia; limitación publicada y supuestos conservados en UI, ledger, informe y manifiesto. No se ofrecen intervalos de confianza ni precisión garantizada. |

Fuera de las guardas, GR negativo o caliper ausente/inválido: NaN y QC128, sin sustituir por original ni extender un diámetro válido vecino. GR originalmente ausente: NaN/QC1. Salida finita corregida: QC64. Infinitos en GR original provocan el mismo error contextual que las preparaciones anteriores. Se admite únicamente una tolerancia de 32 eps × diámetro máximo para equivalencia de representación en los bordes tras convertir unidades; no es extrapolación física.

La ecuación general 1 tiene parámetros/convenciones propios. No se la reconstruye desde dimensiones de herramienta ni se «corrige» su impresión para derivar la aproximación 2: se evalúa directamente la forma publicada elegida y se restringe su uso.

La [ficha original LDEO de noviembre de 2001, p.1](https://mlp.ldeo.columbia.edu/BRG/ODP/LEGACY/PDF/MGT.pdf) especifica 10000 psi, frente a 20000 en la tabla del artículo: esta versión aplica el valor más restrictivo. La [ficha institucional del instrumento](https://mlp.ldeo.columbia.edu/logdb/technology/third-party-tools-equipment/multi-sensor-spectral-gamma-ray-tool-mgt/) confirma desarrollo LDEO-BRG y límites. El [informe de procesamiento del Hole 1257A, paso de calidad](https://mlp.ldeo.columbia.edu/data/odp/leg207/1257A/documents/207-1257A_info-mgt.html) declara que no corrigió el efecto del pozo por desconocer posición: es un caso documental independiente que respalda el bloqueo de posición desconocida, no un caso numérico inventado.

## Receta, dependencia y ejecución

Preparación esquema 5, nodo `mgt-borehole`, método 1. Fija revisión, GR original, caliper original, posición, condiciones máximas, referencias y declaración. Adquisición 1/Project v7 permanecen iguales: condiciones específicas se conservan en la receta, sin reinterpretar los tres campos antiguos de lodo como Rw ni como un ensayo completo.

El editor permite registrar el datum MD de adquisición que antes permanecía desconocido, junto con herramienta y procesado. El dato alcanza todas las corridas del pozo y requiere una confirmación adicional cuando cambia; no transforma ni convierte profundidades. Se guarda en una revisión reversible y puede invalidar la preparación previa. El recorrido de navegador arranca también con adquisición desconocida y completa esos datos desde la UI, sin depender de un fixture ya declarado.

Esta primera versión no combina MGT con máscara/interpolación/filtro/alineación sobre GR ni con caliper preparado activo. Rechaza intentos de composición para no descartar etapas ni aplicar el factor dos veces. Repetir una receta idéntica es no-op; cambiar posición vuelve a calcular desde el original. Desactivar conserva receta y selecciona original; reactivar revalida adquisición; retirar quita receta y vuelve a original. Se conserva el resto de curvas/fuentes/parámetros y cutoffs.

Bindings fijan versión del caliper y adquisición además del GR. Cambiar sus datos, unidades o adquisición invalida la derivada; una fuente preparada explícita inválida bloquea descendientes y no cae al original. Una modificación de laboratorio puede compartir entradas válidas, pero genera su nuevo contexto. Snapshots resuelven la revisión fijada.

El coordinador existente ejecuta el evaluador en bloques cancelables con LRU/presupuesto de memoria. El preview usa el supervisor aislado de snapshots y no corre el motor principal ni modifica Project. Cambios de controles o Project invalidan la propuesta. Se muestra original/corregida/diferencia, QC e impacto disponible en Vsh/PHIE/Sw y netos exactos del módulo de sensibilidad. Aceptar activa la fuente GR preparada y deja una entrada de historial.

El ledger lleva definición/versiones, unidades, guardas, efecto de pozo, referencias, incertidumbre, revisión y condiciones. CSV/LAS/xlsx con resultados preparados se empaquetan con manifiesto JSON de procedencia y selección; columnas originales y preparadas se distinguen, QC mantiene sus valores. El informe autocontenido conserva la advertencia y evidencia. El visor existente permite contrastar original y preparada después de aceptar.

## Validación y cierre de P6

Casos numéricos literales para ambas posiciones en cinco diámetros, calculados con Python Decimal(50) independiente del evaluador TypeScript. [Generador](../../scripts/qa/mgt-reference.py) y [fixture](../../tests/fixtures/mgt-known.json). Verifican la reproducción matemática de la referencia, **no son ensayos de campo**. Pruebas adicionales verifican unidades, guardas, adquisición/efectos previos, calidad, invalidación, motor/cliente reales, cancelación/memoria, persistencia/snapshot, exportación/informe y rechazo explícito del lector anterior.

El cierre conserva la puerta original: método para una herramienta concreta con referencia/casos independientes, y las demás familias bloqueadas. El artículo aporta el modelo científico publicado; los casos verifican el port numérico. La evaluación anterior no agotó esta ruta de implementación y contraste independiente. Esta entrega realiza ese trabajo y mantiene las limitaciones sin inventar precisión. [ADR 0049](0049-admision-cientifica-p6-pendiente.md) queda superado por esta implementación, no borrado.

El TP sigue sin modelo/procesado confirmados: no se habilita aplicar MGT a sus curvas genéricas. El contraste con un proyecto real, límites ambientales adicionales e integración de entrega permanecen donde el masterplan los ubica (P7/P8). [Evidencia de cierre](../validacion/2026-10-31-cierre-p6.md).
