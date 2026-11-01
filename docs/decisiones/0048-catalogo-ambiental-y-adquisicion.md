# 0048 — P6a: catálogo ambiental y declaraciones de adquisición

Estado: implementado en revisión sobre #54, sin integrar main. Primera parte de P6; **no cierra la fase ni admite un método numérico**.

## Alcance

Preparar datos ofrece un catálogo de relevamiento para la curva seleccionada: GR, densidad/PE, neutrón, inducción, laterolog/microrresistividad y sónico. Una entrada es una **candidata**, no una fórmula. Declara familia, magnitudes/unidades relevadas, efectos potenciales, datos a buscar, limitaciones y referencia descriptiva. Algoritmo/carta, dominio, permiso de redistribución y casos independientes permanecen desconocidos; `executable` es siempre false. No hay botón de aplicar ni evaluador ambiental conectado al worker.

El relevamiento se filtra por rol, sin elegir una física por compartir RT: inducción y laterolog pueden aparecer con el mismo rol. La atribución del catálogo por mnemónico se rotula como tal; no confirma instrumento físico, modelo ni procesado. Curvas auxiliares importadas se listan con sus unidades, sin afirmar que sus datos/calidad sean suficientes. Los requisitos definitivos pertenecen al método específico todavía no admitido.

El preflight informa falta de corrida, familia/modelo declarados, origen/unidad incompatibles, estado adquirido desconocido, efectos ya aplicados o sin correspondencia conocida y puerta científica pendiente. Un estado declarado sin efectos tampoco prueba que la curva esté cruda. Los ids de efectos conocidos se muestran con rótulos del usuario; los desconocidos se conservan y se diagnostican.

## Declaraciones reversibles

Una corrida registrada admite editar familia del catálogo, fabricante/modelo y efectos adquiridos con método, versión opcional y referencia. Se exige confirmar el alcance a **todas las curvas** de esa asignación; cualquier edición reinicia la confirmación. Una corrida que mezcle herramientas/procesados no queda certificada por completar un solo modelo: debe revisarse su asignación antes de una futura admisión. No se crean pertenencias automáticamente.

Se conserva adquisición esquema 1: `tool` y `corrections` existentes. No se agregan campos ni se reinterpretan archivos antiguos. Los tres valores existentes de lodo se muestran sin editar/convertir: salinidad equivalente NaCl, Rm y temperatura. Este esquema no informa base completa de concentración, tipo/composición del lodo, Rmf/Rmc, temperaturas separadas ni procedencia del ensayo. Por ello no bastan para admitir un cálculo ambiental ni sustituyen Rw. Su ampliación versionada queda pendiente.

`updateRunAcquisition` exige el mismo Project y corrida vigente, valida el contrato completo y rechaza efectos duplicados, referencia vacía o estado desconocido con efectos aplicados. Admite preservar un id de catálogo importado desconocido, pero no crear uno nuevo desde este editor. No descarta efectos desconocidos ni valores de lodo. Un no-op por contenido no agrega revisión.

Aceptar crea una revisión de adquisición en una entrada de historial. Conserva el mismo Well/arrays, fuentes, interpretación, preparación, muestras y demás corridas. El contexto incluye la revisión nueva, por lo que propuestas anteriores quedan obsoletas aunque los valores numéricos no cambien. Una preparación vinculada a la revisión anterior sigue resolviendo los mismos datos/calidad; no se añade un efecto ambiental a su ledger vacío.

Guardar/abrir conserva las declaraciones; snapshots fijados restauran la adquisición anterior incluso después de modificar modelo/quitar efectos en otra revisión. Las versiones de Project v7, adquisición 1 y preparación 4 permanecen iguales. No se certifica la veracidad de una declaración por guardarla.

## Evidencia y referencias

El CSV del TP contiene ZDEN/PE/AT10/30/60/90, pero **no DRHO**; su existencia en el catálogo de roles no es disponibilidad en el pozo. Faltan modelos confirmados, propiedades del lodo y estado del procesado. El inventario P0 sigue siendo la base, sin inventar condiciones por mnemónico.

Fuentes primarias consultadas el 2026-10-31, enlazadas sin copiar cartas/datasets:

- [SLB, Energy Glossary: delta rho](https://glossary.slb.com/terms/d/delta_rho): describe DRHO como magnitud de una compensación aplicada y como indicador cualitativo de rugosidad. Su presencia no autoriza la suma automática a RHOB. No se implementa aquí un umbral QC universal.
- [SLB, Energy Glossary: environmental corrections](https://glossary.slb.com/en/terms/e/environmental_corrections): distingue correcciones según medición y condiciones; no proporciona por sí sola un contrato numérico para nuestro pozo.
- [SLB, Energy Glossary: induction](https://glossary.slb.com/en/terms/i/induction): referencia descriptiva de la familia; no acredita el modelo de las curvas AT ni entrega un evaluador validado.

Estas referencias no tienen edición/página de una carta admitida, licencia de redistribución confirmada ni casos numéricos independientes para el método. No se usa un glosario como sustituto de esos requisitos. Los enlaces requieren red para consultar el documento externo; el catálogo/declaraciones funcionan offline.

## Puerta restante de P6

Seleccionar una herramienta/modelo concreto y procedimiento aplicable; declarar versión, dominio, interpolación/fuera de dominio, condiciones de adquisición/lodo, efectos/incompatibilidades, incertidumbre publicada o limitación, referencia con edición/página, redistribución y casos independientes. Solo entonces incorporar evaluador puro y preview/aceptación con ledger para esa corrección. P6 exige un primer método admitido: este PR no afirma cumplir esa puerta. Tampoco admite métodos de rugosidad, invasión o salinidad de P7 ni cierra #32.
