# Herramientas de perfilaje de pozo abierto: fichas para el configurador de sarta (fase 11b)

Estado: borrador de investigación. Sin commit.

## Cómo leer este documento (limitaciones de la investigación)

- **No pude abrir ninguna página.** El entorno bloquea la salida a internet salvo el buscador (WebFetch y curl fallan). Todo lo «verificado» viene de **extractos de resultados de búsqueda** que cito con su URL; no leí las páginas completas. Tratalo como verificado de segunda mano.
- **Etiquetas:** «(fuente)» = el dato aparece en un extracto que cito; «aproximado» = sale de memoria o de una fuente secundaria débil (Scribd, apuntes sin autor); «vacío» (`null` en el JSON) = no lo encontré y no lo invento.
- Ningún libro de referencia (Ellis & Singer, Asquith & Krygowski, Rider & Kennedy, SLB 1989) pudo verificarse con capítulo o página. No los uso como fuente de ningún número.
- Casi todos los datos de geometría provienen de herramientas de **Schlumberger/SLB** (catálogos del Columbia BRG/IODP) y son orientativos; HAL y BHI tienen equivalentes con otras dimensiones.
- La profundidad de investigación (DOI) no es un número fijo: depende de la resistividad/densidad de la formación, el lodo, el diámetro del pozo y la definición (50 % o 90 % de la respuesta geométrica). Para dibujar cáscaras, usar `typical` y mostrar `min`–`max` como banda difusa.

## Tabla resumen

| Herramienta | Roles de la app | Prof. de investigación (in / cm) | Resolución vertical (in) | Longitud (m) | Diámetro (in) | Posición |
|---|---|---|---|---|---|---|
| GR | GR | ~4 / ~10 (aprox., una fuente) | ~16 (aprox.) | vacío | ~3,6 (aprox.) | centralizado o excentrado; arriba de la sarta |
| GR espectral | URAN, THOR, POTA, CGR | ~24 / ~61 (HNGS) | 12 (HNGS) / ~18 (NGT) | ~2,6 (HNGS, 8,5 ft) | 3,75 (HNGS) | excentrado; arriba |
| SP | SP | no definida | no definida (≈ espesor de capa) | no aplica | no aplica | electrodo en otra herramienta |
| Calibre de patín | CALI | 0 (contacto) | vacío | integrado | integrado | brazo de la herramienta de densidad |
| Calibre multibrazo | CALI (promedio) | 0 (contacto) | vacío | 1,5 (40 brazos, entubado) | 2,9 (40 brazos, entubado) | centralizado |
| Densidad / litodensidad | RHOB, DRHO, PEF | ~4 / ~10 (rango 6–24) | ~15–16 | vacío | ~4,5 (aprox.) | patín excentrado; medio |
| Neutrón compensado | NPHI | ~8–12 / ~20–30 | ~10–24 | vacío | ~3,6 (aprox.) | excentrado; medio |
| Sónico (BHC/DSI) | DT, DTS | ~5–39 / 12–100 (depende de la velocidad) | ~24 | vacío | ~3,6 (aprox.) | centralizado (resortes); medio |
| Doble laterolog | RT (LLD), RS (LLS) | LLS ~25 / ~64; LLD >80 / >200 | ~24 | vacío (HRLA: 7,35) | 3,625 (HRLA) | centralizado; abajo |
| Inducción de arreglo | RA10, RA20, RA30, RM, RT | 10, 20, 30, 60, 90 | 12, 24 o 48 | vacío | vacío | centralizado; abajo |
| Microrresistividad (MSFL) | RXO | ~1–2 / ~3–5 | ~2 (genérico, aprox.) | vacío | vacío | patín contra la pared |
| Resonancia magnética | PHIT_NMR, PHIE_NMR, BVI_NMR | ~2–4 / ~5–10 | 6 (CMR, aprox.) a 24 (MRIL) | ~16 (MRIL-Prime) | 6 (MRIL-Prime) | excentrado; abajo o corrida aparte |

## 1. Rayos gamma (GR)

- **Qué mide:** la radiactividad natural total de la roca (uranio, torio y potasio sumados). Las arcillas suelen ser más radiactivas que las arenas y carbonatos limpios, por eso se usa para distinguir capas arcillosas.
- **Curvas:** GR, GRC, GAMMA, GAM, GR_EDTC. Rol de la app: `GR` (gAPI, confianza alta en `src/io/mnemonics.ts`).
- **Profundidad de investigación:** ~4 in (~10 cm) para una herramienta promedio en pozo promedio (fuente: diapositiva WGCG, 2025; no pude confirmar que provenga de Rider & Kennedy). Depende de la densidad del lodo y de la formación y del diámetro del pozo. Rango min/max: vacío.
- **Resolución vertical:** ~16 in (~40 cm) (misma fuente WGCG). Un estudio de cinco pozos estimó ~61 cm efectivos (fuente: extracto de EarthDoc/SBGF); la resolución real depende de la velocidad de registro.
- **Geometría:** longitud vacía (se suele montar como cartucho corto); diámetro ~3,6 in (aproximado). Va centralizada o excentrada según la herramienta que la acompaña.
- **Posición:** arriba de la sarta, para poder correlacionar en profundidad con las demás corridas (criterio aproximado, de memoria).
- **Limitaciones:** atenuada por el lodo pesado (barita, KCl) y el pozo grande; no aporta información de entubado vs. abierto por sí sola.

## 2. Rayos gamma espectral (K, Th, U)

- **Qué mide:** separa la radiactividad natural en sus tres fuentes (potasio, torio, uranio) según la energía de los rayos gamma. Sirve para identificar tipo de arcilla, materia orgánica (uranio) y minerales radiactivos.
- **Curvas:** SGR (total), CGR (sin uranio), URAN/UR, THOR/TH, POTA/KPOT. Roles de la app: `URAN`, `THOR`, `POTA`, `CGR`; el SGR total se mapea a `GR` con confianza media.
- **Profundidad de investigación:** 24 in (~61 cm) para la HNGS (fuente: IODP, https://web.iodp.tamu.edu/tools/logging/MULT/hngs.html). NGT: variable (depende de hueco, lodo, densidad y energía del gamma).
- **Resolución vertical:** 12 in para la HNGS (fuente IODP); ~1,5 ft (46 cm) para la NGT (fuente: Columbia BRG).
- **Geometría:** HNGS 3,75 in de diámetro y 8,5 ft (~2,6 m) de longitud (fuente IODP; el mismo extracto muestra una conversión métrica inconsistente, así que la longitud queda a confirmar). Excentrada (pegada a la pared).
- **Posición:** arriba de la sarta (correlación). En la triple combo del IODP la HNGS va arriba de todo (fuente).
- **Limitaciones:** poca estadística de conteo para U y Th a velocidad alta; los lodos con KCl falsean el potasio.

## 3. Potencial espontáneo (SP)

- **Aclaración:** el SP **no es una herramienta propia**. Es una diferencia de potencial continua (mV) entre un electrodo móvil en el pozo, que va montado en otra herramienta de la sarta (típicamente la de resistividad), y un electrodo fijo en superficie.
- **Qué mide:** la tensión espontánea que aparece por la diferencia de salinidad entre el filtrado del lodo y el agua de formación frente a capas permeables. Se usa para detectar permeabilidad y estimar Rw (fuente: apuntes UiO, https://uio.no/studier/emner/matnat/geofag/GEO4250/v08/undervisningsmateriale/Lectures/BWLA%20-%20Spontaneous%20Potential%20-%20Gamma%20Ray.pdf).
- **Curvas:** SP, SPONT. Rol de la app: `SP` (mV).
- **Profundidad de investigación y resolución vertical:** no están definidas de forma útil (vacío). Para el dibujo, mostrar solo el electrodo sobre la herramienta que lo aloja, sin cáscaras.
- **Geometría:** un anillo/electrodo pequeño; sin longitud ni diámetro propios.
- **Limitaciones:** necesita lodo conductivo (no sirve con lodo base aceite) y contraste de salinidad; se deforma con corrientes parásitas y en capas finas.

## 4. Calibre (patín y multibrazo)

- **Qué mide:** el diámetro del pozo. Un calibre de patín mide un solo diámetro con el brazo que empuja el patín de densidad; uno multibrazo mide muchos radios (30 o más) y permite ver forma, ovalización y derrumbes.
- **Curvas:** CALI, CAL, HCAL, CALS, CALX, CALA (de patín o promedio); en multibrazo, además, calibres individuales y promedios. Rol de la app: `CALI` (in). `BS` (diámetro de trépano) es un dato del pozo, no una curva de esta herramienta.
- **Profundidad de investigación:** 0 (contacto con la pared). Resolución vertical: vacía.
- **Geometría:** el de patín va integrado a la herramienta de densidad. Ejemplo multibrazo (de **pozo entubado**): 40 brazos, 2,875 in (73 mm) y 60 in (1,52 m) (fuente: Nine Energy, https://nineenergyservice.com/assets/files/Old-Tech-Sheets/Multi-Finger-Caliper-Tech-Sheet-1.0.pdf); 60 brazos Hunting MCT43: 4,0 in y 60,5 in (fuente: https://hunting-intl.com/products-services/perforating-logging-systems/logging-and-perforating-instruments/mct-multi-finger-caliper-tools). No encontré una ficha de multibrazo para pozo abierto.
- **Posición:** el multibrazo va centralizado; el calibre de patín queda donde esté la herramienta de densidad.
- **Limitaciones:** el patín solo ve un eje y puede resbalar a una ranura de llave; los brazos no distinguen derrumbes por debajo de su alcance.

## 5. Densidad / litodensidad (RHOB, PEF)

- **Qué mide:** una fuente de cesio-137 emite rayos gamma que se dispersan en la roca; la cantidad que llega a los detectores indica la densidad de electrones (densidad volumétrica). La herramienta litodensidad agrega el factor fotoeléctrico (PEF), que ayuda a distinguir la litología (fuente: extracto IODP, https://iodp.tamu.edu/tools/logging/TRIPLE/hlds.html).
- **Curvas:** RHOB, RHOZ, ZDEN, DEN; DRHO, ZCOR; PEF, PEFZ. Roles de la app: `RHOB`, `DRHO`, `PEF`.
- **Profundidad de investigación:** ~4 in (~10 cm) para una herramienta promedio (fuente WGCG); la tabla ODP Leg 177 da 15–60 cm (6–24 in) para el litodensidad. Muy somera: depende de la densidad de la roca.
- **Resolución vertical:** 16 in (38 cm) (fuente IODP); 1,25 ft (38 cm) para la HLDT (fuente Columbia BRG, https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/hostile-environment-lithodensity-tool-hldt).
- **Geometría:** fuente y dos detectores en un patín blindado, empujado contra la pared por un brazo excéntrico hidráulico (fuente IODP). Longitud: vacía. Diámetro ~4,5 in (aproximado, de memoria).
- **Posición:** medio de la sarta, excentrada, de modo que el patín tenga buen contacto; suele ir junto con el neutrón.
- **Limitaciones:** muy sensible a la rugosidad y al revoque (el DRHO avisa); el lodo con barita falsea el PEF.

## 6. Neutrón compensado (termal)

- **Qué mide:** una fuente emite neutrones que pierden energía sobre todo al chocar con hidrógeno. Contar los neutrones térmicos que llegan a dos detectores da el índice de hidrógeno, que se lee como porosidad neutrónica (NPHI) en una matriz dada.
- **Curvas:** NPHI, NPOR, TNPH, CNL, SNP (confianza media para CNL, NEU). Rol de la app: `NPHI` (v/v).
- **Profundidad de investigación:** discrepancia entre fuentes: 12 in (apuntes TIU, https://lecture-notes.tiu.edu.iq/wp-content/uploads/2022/12/Lecture-7-Neutron-Log.pdf); ~20 cm = 8 in (diapositiva WGCG). Depende de la porosidad (mayor DOI en baja porosidad).
- **Resolución vertical:** ~2 ft (glosario SLB, https://glossary.slb.com/en/terms/c/compensated_neutron_log); 10 in (apuntes TIU); 40 cm (WGCG). Valor usado: 24 in.
- **Geometría:** excentrada contra la pared (fuente: glosario SLB). Longitud: vacía. Diámetro: ~3,6 in (aproximado; las compactas de Weatherford miden 2,75 y 2,25 in según su ficha, https://weatherford.com/documents/technical-specification-sheet/products-and-services/formation-evaluation/wireline/compensated-neutron-tool).
- **Posición:** medio de la sarta, junto a densidad.
- **Limitaciones:** afectada por el diámetro del pozo, la salinidad y el tipo de matriz; efecto de gas (excavación) y arcilla.

## 7. Sónico compensado y dipolar (DT, DTS)

- **Qué mide:** el tiempo que tarda una onda acústica en recorrer un pie de formación (lentitud). El sónico compensado da la onda compresional (DT); el dipolar excita ondas de flexión que dan también la onda de corte (DTS), incluso en formaciones lentas.
- **Curvas:** DT, DTC, DTCO, DTP; DTS, DTSM, DT4S. Roles de la app: `DT`, `DTS` (µs/ft).
- **Profundidad de investigación:** depende de la velocidad y la frecuencia; una fuente débil (Scribd, no confiable) da 12 cm a 1 m (aproximado); WGCG da ~20 cm (8 in).
- **Resolución vertical:** ~2 ft (60 cm), aproximada a la separación entre pares de receptores (misma fuente débil y WGCG). Un estudio de cinco pozos halló ~61 cm.
- **Geometría:** el DSI-2 tiene 8 estaciones de receptor separadas 6 in y abarcan 3,5 ft; un transmisor monopolar y dos dipolares perpendiculares (fuente Columbia BRG, https://mlp.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/dipole-sonic-imager-tool-dsi-2). Longitud total y diámetro: vacíos.
- **Posición:** centralizada con resortes (de memoria, aproximado), en medio de la sarta, separada de las herramientas de patín.
- **Limitaciones:** salta ciclos (cycle skipping) en gas y fracturas; el dipolar necesita pozo de buena calidad.

## 8. Doble laterolog (LLD / LLS)

- **Qué mide:** fuerza una corriente eléctrica enfocada en una capa fina hacia la formación y mide la tensión. Con dos configuraciones, una profunda (LLD) y otra somera (LLS), da dos lecturas de resistividad en lodos salados.
- **Curvas:** LLD, RLLD, LLDC, RDEP, ILD (deep); LLS/RLLS (somera); LLM (media). Roles de la app: `RT` (LLD), `RM` (LLM). **LLS no está en la tabla de mnemónicos**: se sugiere agregarla como `RS` (ver «Contradicciones»).
- **Profundidad de investigación:** LLS ~25 in (~64 cm); LLD >80 in (>200 cm) en una herramienta típica (extracto de un resultado de búsqueda sin fuente clara). Depende de la resistividad de la roca y del contraste entre la zona invadida y la virgen (fuente: Columbia BRG, https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/dual-laterolog-dll). Un trabajo austríaco da un máximo de 2,5 m.
- **Resolución vertical:** ~2 ft (61 cm), fijada por la geometría de los electrodos (fuente Columbia BRG).
- **Geometría:** DLL: longitud y diámetro vacíos. HRLA (laterolog de arreglo): 3,625 in y 24,1 ft = 7,35 m (fuente: https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/hrla). Centralizada.
- **Posición:** abajo de la sarta, centralizada (de memoria; en la triple combo del IODP se pone abajo con la herramienta de telemetría de fondo).
- **Limitaciones:** necesita lodo conductivo (no sirve con lodo base aceite ni aire); efecto Groningen y de capas finas.

## 9. Inducción de arreglo (10, 20, 30, 60, 90 in)

- **Qué mide:** una bobina transmisora crea un campo que induce corrientes en la formación; los receptores miden la señal que generan. Varios arreglos de bobinas se procesan para dar cinco curvas con distinta profundidad (de la zona invadida a la virgen). Funciona con lodo base aceite o no conductivo.
- **Curvas:** AT10, AT20, AT30, AT60, AT90 (y AHT10…AHT90, AF10…AF90). Roles de la app: `RA10`, `RA20`, `RA30`, `RM` (AT60), `RT` (AT90).
- **Profundidad de investigación:** 10, 20, 30, 60 y 90 in (25,4, 50,8, 76,2, 152,4 y 228,6 cm) (fuente: OSTI, https://www.osti.gov/biblio/207288, y Columbia BRG, https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/slimxtreme-array-induction-imager-tool-qait). Son profundidades **nominales**; la real varía con la conductividad de la formación.
- **Resolución vertical:** 1, 2 y 4 ft según el procesamiento, definida al 90 % (misma fuente OSTI). Valor usado: 2 ft = 24 in.
- **Geometría:** longitud y diámetro: vacíos (no encontré las dimensiones). Centralizada con standoffs (de memoria, aproximado; existe un mnemónico de «standoff» del arreglo en el diccionario de SLB: https://www.apps.slb.com/cmd/ParameterItem.aspx?code=AHSTA).
- **Posición:** abajo de la sarta, centralizada, lejos de masas metálicas (aproximado).
- **Limitaciones:** poco precisa en resistividades altas (>100 ohm.m); se degrada con pozo muy grande y con el efecto de piel.

## 10. Microrresistividad (MSFL / Rxo)

- **Qué mide:** un patín con electrodos pequeños pegado a la pared inyecta corriente enfocada en una zona muy somera. Mide Rxo, la resistividad de la zona lavada por el filtrado del lodo.
- **Curvas:** MSFL, RMSFL, MCFL, RXOZ, MLL, PROX. Rol de la app: `RXO`.
- **Profundidad de investigación:** muy somera, del orden de 1–2 in (fuente genérica de patines de microrresistividad, https://petrowiki.spe.org/Microresistivity_logs; el valor específico del MSFL no está confirmado, aproximado).
- **Resolución vertical:** del orden de 1–2 in (genérico, aproximado).
- **Geometría:** patín contra la pared del pozo, empujado por brazo. Longitud y diámetro: vacíos.
- **Posición:** suele ir con la herramienta de patín (densidad/neutrón), no centralizada.
- **Limitaciones:** necesita lodo conductivo; el revoque y la separación (standoff) afectan la lectura; el MSFL es fiable si Rxo/Rm < 10 000 (fuente: patente US 7046010, https://patents.google.com/patent/US7046010).

## 11. Resonancia magnética (CMR / MRIL)

- **Qué mide:** un imán polariza los protones del agua e hidrocarburos de los poros y un pulso de radio los hace «sonar»; el decaimiento de ese eco (T2) indica el tamaño de poro y el volumen de fluido libre y ligado, sin depender de la matriz.
- **Curvas:** PHIT_CMR/TCMR, PHIE_CMR/CMRP_3MS, BVI/PHI_BVI (porosidad total, efectiva y fluido irreducible). Roles de la app: `PHIT_NMR`, `PHIE_NMR`, `BVI_NMR`. La distribución T2, T2LM y la permeabilidad (KSDR, KTIM) no tienen rol medido en la app.
- **Profundidad de investigación:** Baker Hughes MReX: zona de medición entre 2,1 y 3,8 in (5,3 a 9,7 cm) delante de la antena (fuente: https://dam.bakerhughes.com/m/6fa387fd752509ff/original/MR-eXplorer-magnetic-resonance-logging-service-bro-pdf.pdf). MRIL-Prime: ~4 in en un pozo de 8 in; las nueve capas varían en total ~1 in (patentes). CMR de SLB: no verifiqué su DOI.
- **Resolución vertical:** ~2 ft de la antena MRIL; con movimiento a 900 ft/h el efecto sube a ~7 ft (patente US 6541969, https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6541969). CMR: ~6 in (aproximado, de memoria).
- **Geometría:** MRIL-Prime estándar ~6 in de diámetro y ~53 ft (~16 m), versión delgada 4 7/8 in y ~50 ft (documento de diseño citado en el resultado); el CMR es mucho más corto (vacío). Las herramientas de SLB/BHI son excentradas con imán en un mandril (fuente).
- **Posición:** excentrada; por su longitud suele ir abajo o en una corrida separada (aproximado).
- **Limitaciones:** se degrada con velocidad alta y pozo rugoso; la zona medida es somera; lodo con magnetita altera la señal.

## 12. Cabeza de cable y telemetría

- **Función:** conecta la sarta al cable de perfilaje; aloja la tensión, el cartucho de telemetría y el acondicionamiento de las señales de todas las herramientas.
- **Dibujo:** cilindro corto en el extremo superior; longitud y diámetro: vacíos (no encontré datos). No tiene profundidad de investigación.

## 13. Centralizador y excentralizador

- **Función:** el centralizador (resortes tipo arco) mantiene una herramienta en el eje del pozo (inducción, laterolog, sónico). El excentralizador empuja la herramienta contra la pared (densidad, neutrón, RMN) con un brazo de resorte o hidráulico (fuente: IODP para densidad).
- **Dibujo:** arcos de resorte (centralizador) o brazo lateral (excentralizador); dimensiones: vacías.

## Orden típico de la sarta (referencia para el dibujo)

Triple combo del IODP, de arriba a abajo: gamma natural (HNGS), densidad (HLDS), neutrón (APS), resistividad (DLL o DIT) y telemetría de fondo (TAP) (fuente: https://publications.iodp.org/proceedings/304_305/102/102_9.htm). Esto es la práctica científica del IODP; en el perfilaje petrolero el orden puede cambiar. FMS–sónico: imagen de resistividad con el DSI.

## Contradicciones y huecos con la app

- `LLS` (laterolog somero) **no está** en `src/io/mnemonics.ts`; `LLD` y `LLM` sí (`RT`, `RM`). Sugerido: `LLS`/`RLLS` → `RS`.
- Los roles `RA10/RA20/RA30` existen; AT60/AT90 coinciden con `RM` y `RT` (según `datos/README.md`).
- No existen roles medidos para la distribución T2, T2LM, la permeabilidad RMN ni los calibres individuales del multibrazo; el SP no es herramienta.
- La app no tiene un rol de «posición» de herramienta. La longitud, el diámetro y la posición no están en `src/core/roles.ts`.

## Fuentes

Todas las citas provienen de extractos de búsqueda; no abrí las páginas completas.

- https://web.iodp.tamu.edu/tools/logging/MULT/hngs.html (HNGS)
- https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/natural-gamma-ray-spectrometry-tool-ngt (NGT)
- https://iodp.tamu.edu/tools/logging/TRIPLE/hlds.html (HLDS)
- https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/hostile-environment-lithodensity-tool-hldt (HLDT)
- https://glossary.slb.com/en/terms/c/compensated_neutron_log (glosario SLB, CNL)
- https://lecture-notes.tiu.edu.iq/wp-content/uploads/2022/12/Lecture-7-Neutron-Log.pdf (apuntes)
- https://weatherford.com/documents/technical-specification-sheet/products-and-services/formation-evaluation/wireline/compensated-neutron-tool (Weatherford)
- https://mlp.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/dipole-sonic-imager-tool-dsi-2 (DSI-2)
- https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/dual-laterolog-dll (DLL)
- https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/hrla (HRLA)
- https://www.osti.gov/biblio/207288 (Platform Express, inducción de arreglo)
- https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/slimxtreme-array-induction-imager-tool-qait (QAIT)
- https://www.apps.slb.com/cmd/ParameterItem.aspx?code=AHSTA (diccionario de mnemónicos SLB)
- https://petrowiki.spe.org/Microresistivity_logs (PetroWiki)
- https://patents.google.com/patent/US7046010 (patente MSFL)
- https://dam.bakerhughes.com/m/6fa387fd752509ff/original/MR-eXplorer-magnetic-resonance-logging-service-bro-pdf.pdf (Baker Hughes MReX)
- https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6541969 (patente RMN)
- https://nineenergyservice.com/assets/files/Old-Tech-Sheets/Multi-Finger-Caliper-Tech-Sheet-1.0.pdf (calibre multibrazo, entubado)
- https://hunting-intl.com/products-services/perforating-logging-systems/logging-and-perforating-instruments/mct-multi-finger-caliper-tools (Hunting)
- https://uio.no/studier/emner/matnat/geofag/GEO4250/v08/undervisningsmateriale/Lectures/BWLA%20-%20Spontaneous%20Potential%20-%20Gamma%20Ray.pdf (SP, GR)
- https://www.wgcg.co.uk/wp-content/uploads/2025/02/03-Integration-of-core-data-with-borehole-geophysical-logs.pdf (WGCG: tabla de resolución y DOI promedio)
- https://publications.iodp.org/proceedings/304_305/102/102_9.htm (sartas IODP)

## Datos para TypeScript

Campos extra respecto del pedido: `shells` (DOI por curva, para dibujar cada cáscara) y `unverified` (campos aproximados). `null` = vacío. `mounting`: `pad` | `eccentralized` | `centralized` | `contact` | `none`. `stringPosition`: `top` | `middle` | `bottom` | `any`.

```json
[
  {"id":"gr","name":"Rayos gamma (GR)","measures":"Mide la radiactividad natural total de la roca; las arcillas suelen ser más radiactivas que arenas y carbonatos limpios.","roles":["GR"],"doiIn":{"typical":4,"min":null,"max":null},"verticalResolutionIn":16,"lengthM":null,"odIn":3.6,"mounting":"eccentralized","stringPosition":"top","limitations":"Atenuado por lodo pesado y pozo grande.","shells":[{"role":"GR","doiIn":4}],"unverified":["doiIn","verticalResolutionIn","odIn","mounting","stringPosition"],"sources":["https://www.wgcg.co.uk/wp-content/uploads/2025/02/03-Integration-of-core-data-with-borehole-geophysical-logs.pdf"]},
  {"id":"gr-spectral","name":"Rayos gamma espectral (K, Th, U)","measures":"Separa la radiactividad natural en potasio, torio y uranio según la energía de los rayos gamma.","roles":["URAN","THOR","POTA","CGR"],"doiIn":{"typical":24,"min":null,"max":null},"verticalResolutionIn":12,"lengthM":2.6,"odIn":3.75,"mounting":"eccentralized","stringPosition":"top","limitations":"Pocos conteos a velocidad alta; el lodo con KCl falsea el potasio.","shells":[{"role":"URAN","doiIn":24},{"role":"THOR","doiIn":24},{"role":"POTA","doiIn":24}],"unverified":["lengthM"],"sources":["https://web.iodp.tamu.edu/tools/logging/MULT/hngs.html","https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/natural-gamma-ray-spectrometry-tool-ngt"]},
  {"id":"sp","name":"Potencial espontáneo (SP)","measures":"Tensión natural entre un electrodo en el pozo y otro en superficie, por la diferencia de salinidad entre filtrado y agua de formación; marca capas permeables. No es una herramienta propia.","roles":["SP"],"doiIn":{"typical":null,"min":null,"max":null},"verticalResolutionIn":null,"lengthM":null,"odIn":null,"mounting":"none","stringPosition":"any","limitations":"Requiere lodo conductivo y contraste de salinidad; no sirve con lodo base aceite.","shells":[],"unverified":[],"sources":["https://uio.no/studier/emner/matnat/geofag/GEO4250/v08/undervisningsmateriale/Lectures/BWLA%20-%20Spontaneous%20Potential%20-%20Gamma%20Ray.pdf"]},
  {"id":"caliper-pad","name":"Calibre de patín","measures":"Mide el diámetro del pozo con el brazo que empuja el patín de densidad.","roles":["CALI"],"doiIn":{"typical":0,"min":0,"max":0},"verticalResolutionIn":null,"lengthM":null,"odIn":null,"mounting":"contact","stringPosition":"middle","limitations":"Mide un solo diámetro; puede caer en una ranura de llave.","shells":[],"unverified":["stringPosition"],"sources":["https://glossary.slb.com/en/terms/c/compensated_neutron_log"]},
  {"id":"caliper-multiarm","name":"Calibre multibrazo","measures":"Mide muchos radios del pozo para ver su forma, ovalización y derrumbes.","roles":["CALI"],"doiIn":{"typical":0,"min":0,"max":0},"verticalResolutionIn":null,"lengthM":1.52,"odIn":2.875,"mounting":"centralized","stringPosition":"any","limitations":"Datos de longitud y diámetro de una herramienta de 40 brazos para pozo entubado; no encontré una de pozo abierto.","shells":[],"unverified":["stringPosition","mounting"],"sources":["https://nineenergyservice.com/assets/files/Old-Tech-Sheets/Multi-Finger-Caliper-Tech-Sheet-1.0.pdf","https://hunting-intl.com/products-services/perforating-logging-systems/logging-and-perforating-instruments/mct-multi-finger-caliper-tools"]},
  {"id":"density","name":"Densidad / litodensidad","measures":"Una fuente de cesio-137 emite rayos gamma; los que llegan a los detectores indican la densidad de la roca y, con el PEF, ayudan a identificar la litología.","roles":["RHOB","DRHO","PEF"],"doiIn":{"typical":4,"min":null,"max":24},"verticalResolutionIn":16,"lengthM":null,"odIn":4.5,"mounting":"pad","stringPosition":"middle","limitations":"Muy sensible a rugosidad y revoque; la barita falsea el PEF.","shells":[{"role":"RHOB","doiIn":4}],"unverified":["odIn","stringPosition","doiIn"],"sources":["https://iodp.tamu.edu/tools/logging/TRIPLE/hlds.html","https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/hostile-environment-lithodensity-tool-hldt"]},
  {"id":"neutron","name":"Neutrón compensado","measures":"Una fuente emite neutrones que pierden energía sobre todo al chocar con hidrógeno; los detectores dan el índice de hidrógeno, que se lee como porosidad.","roles":["NPHI"],"doiIn":{"typical":10,"min":8,"max":12},"verticalResolutionIn":24,"lengthM":null,"odIn":3.6,"mounting":"eccentralized","stringPosition":"middle","limitations":"Afectado por diámetro del pozo, salinidad, matriz, gas y arcilla.","shells":[{"role":"NPHI","doiIn":10}],"unverified":["odIn","doiIn","stringPosition"],"sources":["https://glossary.slb.com/en/terms/c/compensated_neutron_log","https://lecture-notes.tiu.edu.iq/wp-content/uploads/2022/12/Lecture-7-Neutron-Log.pdf"]},
  {"id":"sonic","name":"Sónico compensado y dipolar","measures":"Mide el tiempo que tarda una onda acústica en recorrer un pie de formación; el dipolar entrega también la onda de corte.","roles":["DT","DTS"],"doiIn":{"typical":8,"min":5,"max":39},"verticalResolutionIn":24,"lengthM":null,"odIn":3.6,"mounting":"centralized","stringPosition":"middle","limitations":"Salto de ciclo en gas y fracturas; el dipolar necesita buen pozo.","shells":[{"role":"DT","doiIn":8},{"role":"DTS","doiIn":8}],"unverified":["doiIn","verticalResolutionIn","odIn","mounting","stringPosition"],"sources":["https://mlp.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/dipole-sonic-imager-tool-dsi-2"]},
  {"id":"dll","name":"Doble laterolog (LLD/LLS)","measures":"Fuerza una corriente enfocada hacia la formación y mide la tensión; da una resistividad profunda y otra somera en lodos salados.","roles":["RT","RS"],"doiIn":{"typical":80,"min":25,"max":98},"verticalResolutionIn":24,"lengthM":7.35,"odIn":3.625,"mounting":"centralized","stringPosition":"bottom","limitations":"Necesita lodo conductivo; sensible a capas finas y contrastes altos.","shells":[{"role":"RS","doiIn":25},{"role":"RT","doiIn":80}],"unverified":["doiIn","mounting","stringPosition"],"sources":["https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/dual-laterolog-dll","https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/hrla"]},
  {"id":"induction-array","name":"Inducción de arreglo","measures":"Una bobina induce corrientes en la formación y arreglos de receptores dan cinco curvas con distinta profundidad, de la zona invadida a la virgen.","roles":["RA10","RA20","RA30","RM","RT"],"doiIn":{"typical":90,"min":10,"max":90},"verticalResolutionIn":24,"lengthM":null,"odIn":null,"mounting":"centralized","stringPosition":"bottom","limitations":"Menos precisa en resistividades altas; la profundidad real varía con la conductividad.","shells":[{"role":"RA10","doiIn":10},{"role":"RA20","doiIn":20},{"role":"RA30","doiIn":30},{"role":"RM","doiIn":60},{"role":"RT","doiIn":90}],"unverified":["mounting","stringPosition"],"sources":["https://www.osti.gov/biblio/207288","https://brg.ldeo.columbia.edu/logdb/technology/schlumberger-wireline-tools/slimxtreme-array-induction-imager-tool-qait"]},
  {"id":"msfl","name":"Microrresistividad (MSFL / Rxo)","measures":"Un patín con electrodos pequeños pegado a la pared mide la resistividad de la zona lavada por el filtrado (Rxo).","roles":["RXO"],"doiIn":{"typical":2,"min":1,"max":null},"verticalResolutionIn":2,"lengthM":null,"odIn":null,"mounting":"pad","stringPosition":"middle","limitations":"Necesita lodo conductivo; el revoque y la separación del patín afectan la lectura.","shells":[{"role":"RXO","doiIn":2}],"unverified":["doiIn","verticalResolutionIn","stringPosition"],"sources":["https://petrowiki.spe.org/Microresistivity_logs","https://patents.google.com/patent/US7046010"]},
  {"id":"nmr","name":"Resonancia magnética (CMR/MRIL)","measures":"Polariza los protones de los fluidos de los poros y mide el decaimiento de su eco (T2) para estimar el volumen de fluido libre y ligado, sin depender de la matriz.","roles":["PHIT_NMR","PHIE_NMR","BVI_NMR"],"doiIn":{"typical":3,"min":2.1,"max":4},"verticalResolutionIn":24,"lengthM":16,"odIn":6,"mounting":"eccentralized","stringPosition":"bottom","limitations":"Zona medida somera; se degrada con velocidad alta y pozo rugoso; longitud y diámetro corresponden al MRIL-Prime, el CMR es mucho más corto.","shells":[{"role":"PHIT_NMR","doiIn":3}],"unverified":["stringPosition","mounting"],"sources":["https://dam.bakerhughes.com/m/6fa387fd752509ff/original/MR-eXplorer-magnetic-resonance-logging-service-bro-pdf.pdf","https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6541969"]},
  {"id":"head","name":"Cabeza de cable y telemetría","measures":"Conecta la sarta al cable y transmite las señales de todas las herramientas.","roles":[],"doiIn":{"typical":null,"min":null,"max":null},"verticalResolutionIn":null,"lengthM":null,"odIn":null,"mounting":"none","stringPosition":"top","limitations":"Sin datos de dimensiones.","shells":[],"unverified":[],"sources":[]},
  {"id":"centralizer","name":"Centralizador / excentralizador","measures":"Mantiene la herramienta en el eje del pozo (centralizador) o la empuja contra la pared (excentralizador).","roles":[],"doiIn":{"typical":null,"min":null,"max":null},"verticalResolutionIn":null,"lengthM":null,"odIn":null,"mounting":"none","stringPosition":"any","limitations":"Sin datos de dimensiones.","shells":[],"unverified":[],"sources":["https://iodp.tamu.edu/tools/logging/TRIPLE/hlds.html"]}
]
```
