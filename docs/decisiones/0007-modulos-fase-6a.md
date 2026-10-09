# 0007 — Módulos de la fase 6a: arcilla, porosidad, Rw, saturación, permeabilidad, cutoffs, sumario y volumétrico

- Estado: aceptada (fase 6a). La parte de núcleo (N1–N5) ya está implementada y testeada; el catálogo (C1–C22) y
  los agregados a `src/petro/` (P1–P7) los implementan otros agentes a partir de este documento.
- Alcance: `src/core/` (contrato, registro, grafo, motor, roles, unidades, categorías), `src/modules/sharedParams.ts`,
  `src/app/flow/flow.ts`, `src/app/shell/dockPanels.tsx`; especificación de 24 módulos y de las funciones puras nuevas.

## Contexto

El motor petrofísico de la fase 5 (`src/petro/`: vsh, porosity, temperature, rw, saturation, permeability, stats,
flags) está hecho y validado. La fase 6a lo envuelve en módulos con sliders, agrega cutoffs, sensibilidad, sumario
por zona y volumétrico. El sumario y el volumétrico necesitaban dos cosas que el núcleo no tenía: consumir tablas y
pasar valores por zona sin parsear filas (pendiente de `docs/arquitectura.md`), y saber el tipo de cada zona.

---

## Parte 1 — Núcleo (implementado)

### N1. Tablas como entrada y escalares por zona

- Entradas nuevas: `input.table(port)`, `input.optionalTable(port)`, `input.zoneScalar(port)`,
  `input.optionalZoneScalar(port)`. En `compute` llegan como `ReadonlyTableValue` y `ReadonlyZoneScalarValue`
  (`Readonly<Record<zoneId, number>>`).
- Salida nueva: `output.zoneScalar(port, { label, unit? })`, valor `ZoneScalarValue = Record<zoneId, number>`.
  **Contrato:** exactamente una clave por cada zona de `ctx.zones` (incluidas las zonas sin muestras), cada valor
  `number`; `NaN` = sin dato. El motor rechaza claves de más, de menos o no numéricas (`invalid-output`). Sin zonas,
  el valor válido es `{}`.
- El registro valida que productores y consumidores de un puerto usen el mismo tipo (`curve`, `scalar`, `table`,
  `zoneScalar`), que los requeridos tengan productor y que una entrada no-curva no pida un rol de curva.
- **Inmutabilidad:** el motor congela (`Object.freeze`) tablas (y cada fila) y valores por zona al guardarlos en
  caché. Un consumidor que escriba en ellos falla con `compute-error` en vez de corromper la caché (las curvas
  siguen protegidas por `ReadonlyCurve` + `checkInputs`).
- Firma, protocolo del worker, cliente y store no cambian: los valores son clonables y se reenvían solo si cambió
  la versión. `activeOutput(outputs, port)` (en `engine.ts`) devuelve la salida que alimenta la cadena para un puerto.
- Resultados (dock): los `zoneScalar` se muestran juntos en una tabla «Valores por zona» (fila = zona, columna =
  salida).

### N2. Tipo de zona en `ZoneSpan` y en la firma

`ZoneSpan.kind` (`formation | reservoir | seal | other`) llega en `ctx.zones`. La firma de cada módulo incluye id,
nombre, **tipo**, inicio y fin de cada zona: cambiar el tipo recalcula; cambiar el color no.

### N3. Fuente por defecto: el primer candidato que puede correr; las opcionales no bloquean

El catálogo tiene varios productores por puerto y pozos a los que les faltan perfiles. Con la regla anterior
(«primer módulo registrado») un pozo sin neutrón dejaba PHIT sin calcular hasta que el usuario eligiera otro método.

- **Viabilidad estática** (en `planGraph`): un módulo puede correr si cada entrada requerida tiene alguna candidata
  que pueda correr y no sea él mismo (menor punto fijo: un módulo de corrección no se justifica a sí mismo).
- **Regla por defecto:** curva medida con ese rol → primer módulo registrado que pueda correr → primer candidato
  (que informa qué le falta). Una elección explícita se respeta siempre.
- **Entradas opcionales:** si su fuente no puede correr (estático) o falla al calcular (ejecución), el módulo corre
  sin ella (`undefined`), con un diagnóstico `info`/`warning`. Una requerida sigue bloqueando.
- Límite conocido: la viabilidad es optimista respecto de las fuentes elegidas; un ciclo armado por elecciones por
  defecto entre productores cruzados se sigue informando como ciclo (como antes).

### N4. Tablas ocultas

`output.table(port, { ..., hidden: true })`: la tabla es un puerto normal pero no se lista en Resultados (la consume
un panel a medida; p. ej. el barrido de sensibilidad). `OutputRecord.hidden = true`.

### N5. Catálogos

- **Roles nuevos** (`BUILTIN_ROLES` + paleta): `RW` (Rw a temperatura de formación, Ω·m, log), `RWA` (Ω·m, log),
  `SH` (saturación de hidrocarburos, v/v). `TEMP` ya existía (°C).
- **Unidades nuevas:** `Mm3`, `MMm3`, `Mbbl`, `MMbbl`, `MMscf`, `Bcf` (volumen); `m3/m3` (dimensión
  `volumeRatio`, para Bo y Bg); `degC/100m`, `degF/100ft` (dimensión `temperatureGradient`, sin offset).
- **Categoría nueva conocida:** `volumetrics` («Volumétrico»), después de `summary`.
- **Parámetros compartidos nuevos** en `src/modules/sharedParams.ts` (spec canónico, ya cargado): `dtMa`, `a`, `m`,
  `n`, `rsh`, `rmf`, `tRmf`, `vshCutoff`, `phiCutoff`, `swCutoff`, `area`, `fluid`, `bo`, `bg`. Los módulos los
  toman de ahí (`SHARED_PARAMS.a`), nunca los copian.
- **Flujo guiado:** pasos nuevos «Permeabilidad» (categoría `permeability`, objetivo `PERM`) y «Volumen»
  (`volumetrics`, objetivos `OOIP`/`OGIP`); «Rw» pasa a «Temperatura y Rw» (puertos `RW`, `RWA`, `TEMP`); «Sumario»
  tiene objetivo `ZONE_SUMMARY`.

---

## Parte 2 — Reglas del catálogo

### D1. ¿Un módulo con `param.enum` o un módulo por método?

**Regla:** enum por zona cuando los métodos producen lo mismo, no tienen parámetros propios y la elección cambia de
zona a zona; módulos distintos cuando difieren las entradas o los parámetros (D2 de 0001).

- **Vsh: un módulo con `method` enum por zona.** Los cinco métodos leen IGR y no tienen parámetros propios, y la
  elección depende de la edad de la roca, que cambia por zona (terciario arriba, rocas antiguas abajo); `sources` es
  por pozo, así que con un módulo por método no se podría. Se pierde «comparar» entre métodos de Vsh: lo cubre el
  panel (gráfico de las cinco transformadas).
- **PHIT: un módulo con `method` enum por zona** (automático, D–N, D–N con gas, densidad, neutrón, sónico): el gas y
  los derrumbes (densidad inválida → sónico) son por zona. Sus entradas PHID, PHIN y PHIS son opcionales (N3).
- **PHIE, Rw, Sw, k: un módulo por método** (entradas o parámetros distintos). Elegir método por zona para estos
  puertos queda abierto (necesita `sources` por zona en el núcleo).

### D2. Rw es una curva (`RW`) a temperatura de formación

Rw cambia con la temperatura: en el intervalo del TP (885 m, ~27 °C con 3 °C/100 m) varía ~10 %, que se traslada a
Sw. Alternativas: (a) escalar Rw ya a temperatura de formación (el usuario corrige a mano por zona; error fácil);
(b) escalar + temperatura de referencia y que **cada** modelo de Sw lea TEMP y aplique Arps (repite la corrección en
tres módulos y les agrega una entrada). **Elegida (c):** los módulos de agua producen la curva `RW` ya corregida por
Arps muestra a muestra; los modelos de Sw la consumen como entrada (`input.curve('RW')`) y quedan simples. Cualquier
método futuro (Pickett, fase 7) produce el mismo puerto. El visor la muestra sin trabajo extra.

- La temperatura es la curva `TEMP` (°C): medida si existe (ojo: un perfil de temperatura de lodo lee menos que la
  formación; el usuario puede elegir `temp-gradient`) o calculada por gradiente. `temp-gradient` no tiene entradas,
  así que `TEMP` siempre está disponible y los módulos de agua la piden como requerida.
- Rw de referencia, Rmf y temperaturas de referencia son parámetros; los módulos convierten °C → °F para las
  funciones de `rw.ts` (`celsiusToFahrenheit`) y usan `arpsResistivityC` para la corrección.
- Los modelos de Sw llaman las funciones escalares (`archieSw`, `simandouxSw`, `indonesiaSw`) en un bucle por
  segmento, porque las variantes `*Into` suponen Rw constante.

### D3. El sumario consume curvas, no tablas

Los promedios ponderados sobre neto necesitan las muestras (no se reconstruyen desde filas), y una pasada O(n) cuesta
< 1 ms con el TP. Consume `NET_RES`, `NET_PAY`, `PHIE`, `SW` (y opcionales `VSH`, `PERM`), así que funciona con
cualquier módulo que produzca las banderas. Publica una tabla para leer y **valores por zona** para el volumétrico.

### D4. Volumétrico: unidades

Los puertos van en SI canónico: `OOIP`/`OGIP` por zona y sus totales en **m³ a condiciones de superficie** (estándar)
(sirve para encadenar y para Monte Carlo). La tabla para leer trae cada volumen en SI y en unidades de campo:
petróleo en Mm³ y MMbbl (STB), gas en MMm³ y Bcf. Parámetros: área en km² (log), Bo y Bg en m³/m³ (= bbl/STB y
ft³/scf). Conversiones con `convert()` de `units.ts`, nunca constantes sueltas. Verificación de libro:
1 acre · 1 ft · φSh = 1 / Bo = 1 → 7758 bbl.

### D5. Sensibilidad: un módulo que produce una tabla oculta

Alternativa: calcular el barrido en el panel sobre las curvas del store de resultados. Descartada: si `PHIE` o `SW`
vienen de una curva medida no están en el store (habría que convertir unidades en la interfaz) y el barrido no
estaría disponible para exportar ni para Monte Carlo. **Elegida:** `cutoff-sensitivity` lee VSH, PHIE, SW y los
cutoffs compartidos (`vshCutoff`, `phiCutoff`, `swCutoff`), más los parámetros volumétricos compartidos, y produce
`CUTOFF_SWEEP` (tabla `hidden`). Costo: O(n + zonas · pasos) por variable con binning y sumas acumuladas (P5), ~1 ms
con el TP; se recalcula solo cuando cambian sus entradas o parámetros. El panel a medida dibuja las curvas y arrastra
el cutoff actual (cambia el parámetro compartido → se recalculan banderas, sumario, volumétrico y barrido).

### D6. Intervalos, totales y datos faltantes (común a cutoffs, sumario, volumétrico y sensibilidad)

- **Intervalos:** las zonas de `ctx.zones` en orden. Sin zonas: un único intervalo «Pozo completo» `[0, n)` con
  parámetros globales (solo para tablas; los `zoneScalar` quedan `{}` y el volumétrico avisa que hacen falta zonas).
- **Total:** suma sobre las zonas (las muestras fuera de toda zona no cuentan). Los promedios del total se recalculan
  desde las sumas, no promediando promedios.
- **Banderas:** `NET_RES = 0` si alguna curva **conocida** no pasa su corte (`Vsh > vshCutoff` o `φ < phiCutoff`), aunque
  falte la otra (descarte seguro: Vsh 0,9 con φ NaN da 0); si ninguna conocida la descarta, `1` si ambas pasan y `NaN`
  («sin dato») si falta alguna. `NET_PAY = NaN` si `NET_RES` es NaN; `0` si `NET_RES = 0`; si `NET_RES = 1`: `1` si
  `Sw ≤ swCutoff`, `0` si no, `NaN` si falta Sw (reservorio «sin dato de pay»; no se cuenta en silencio como no pay,
  el sumario lo informa en `noDataPay`). Comparaciones inclusivas. *(Reglas 1 y 2 de datos faltantes, ver Parte 6.)*
- **Promedios:** φ̄ = Σhφ/Σh; **S̄w ponderada por volumen poral** = Σhφ·Sw / Σhφ (así h·φ̄·(1 − S̄w) = Σhφ(1 − Sw)
  exacto); V̄sh y k̄ = Σh·x/Σh; kh = Σh·k. Solo muestras con dato en la variable promediada. Neto cero → promedios NaN,
  sumas 0. Excepción: reservorio sin ningún Sw → el pay es NaN, no 0 (Parte 6).
- **Zonas de tipo `seal`:** aparecen en el sumario, pero el volumétrico y la sensibilidad les asignan volumen 0.

---

## Parte 3 — Catálogo

Orden de registro en `src/modules/index.ts` (fija el orden de paneles y el desempate por defecto, N3). Se **retira
`shale-flag`** del registro (ejemplo de fase 1 que ensucia el paso Cutoffs): borrar la carpeta y ajustar
`tests/flow.test.ts` («los módulos reales del registro caen en sus pasos») y `tests/modules.test.ts`, que lo usan como
ejemplo real (pasar ese test de encadenamiento a `igr` → `vsh` → … o a módulos de prueba de `tests/helpers.ts`). Los
usos de `SHALE_FLAG` en `tests/viewer/resolve.test.ts` y en la muestra del sistema de diseño son sintéticos y quedan.

| # | id | Nombre | Categoría | Produce |
|---|---|---|---|---|
| — | `igr` (existe) | Índice de rayos gamma | shale | IGR |
| C1 | `vsh` | Volumen de arcilla | shale | VSH |
| C2 | `phi-density` | Porosidad por densidad | porosity | PHID |
| C3 | `phi-neutron` | Porosidad neutrónica | porosity | PHIN |
| C4 | `phi-sonic-wyllie` | Porosidad sónica — Wyllie | porosity | PHIS |
| C5 | `phi-sonic-raymer` | Porosidad sónica — Raymer-Hunt-Gardner | porosity | PHIS |
| C6 | `phit` | Porosidad total | porosity | PHIT |
| C7 | `phie-vsh` | Porosidad efectiva — φt·(1 − Vsh) | porosity | PHIE |
| C8 | `phie-shale-corrected` | Porosidad efectiva — corrección por arcilla | porosity | PHIE |
| C9 | `temp-gradient` | Temperatura de formación (gradiente) | water | TEMP |
| C10 | `rw-manual` | Rw conocida | water | RW |
| C11 | `rw-sp` | Rw desde el SP | water | RW, RW_SP_BY_ZONE |
| C12 | `rw-rwa` | Rw por Rwa mínima | water | RWA, RW, RW_RWA_BY_ZONE |
| C13 | `sw-archie` | Sw — Archie | saturation | SW |
| C14 | `sw-simandoux` | Sw — Simandoux | saturation | SW |
| C15 | `sw-indonesia` | Sw — Indonesia | saturation | SW |
| C16 | `bvw-sh` | Volumen de agua y saturación de hidrocarburos | saturation | BVW, SH |
| C17 | `perm-timur` | Permeabilidad — Timur | permeability | PERM |
| C18 | `perm-coates` | Permeabilidad — Timur–Coates (RMN) | permeability | PERM |
| C19 | `cutoffs` | Cutoffs de reservorio y pay | cutoffs | NET_RES, NET_PAY |
| C20 | `cutoff-sensitivity` | Sensibilidad a los cutoffs | cutoffs | CUTOFF_SWEEP (oculta) |
| C21 | `zone-summary` | Sumario por zona | summary | ZONE_SUMMARY, NET_PAY_H, HPHISH_PAY, NET_PAY_TOTAL, HPHISH_TOTAL |
| C22 | `volumetrics` | Volumen in situ | volumetrics | OOIP, OGIP, OOIP_TOTAL, OGIP_TOTAL, VOLUMETRICS |

Todos en `workspace: 'petrophysics'` salvo `vsh` (`['petrophysics', 'geology']`). Ningún módulo declara roles
propios (los necesarios ya están en el núcleo, N5).

**Convenciones de las fichas.** «Zona» = `scope: 'zone'`; «global» = `scope: 'global'`. «Compartido» = se toma de
`SHARED_PARAMS` (spec en `src/modules/sharedParams.ts`; no repetir los valores acá es intencional). Unidades de
curvas: las canónicas del rol (φ, Vsh, Sw en v/v; T en °C; R en Ω·m; k en mD). Avisos con `ctx.warn`, en español y
sin ecuaciones, nombrando la zona. Cada ficha lista la(s) función(es) de `src/petro/` a usar; P# remite a la Parte 4.

### C1. `vsh` — Volumen de arcilla

- Entradas: `igr: input.curve('IGR')`. Salidas: `vsh: output.curve('VSH')`.
- Parámetros: `method` enum, zona, default `'linear'`; opciones en el orden de `VSH_METHODS`: `linear` «Lineal
  (IGR)», `larionovTertiary` «Larionov — rocas terciarias», `larionovOlder` «Larionov — rocas antiguas», `clavier`
  «Clavier», `steiber` «Steiber».
- Cálculo: por segmento, `vshFromIgrInto(igr, out, s.params.method, s.start, s.end)` (`vsh.ts`).
- Panel opcional: las cinco transformadas Vsh(IGR) con el método de la zona resaltado.

### C2. `phi-density` — Porosidad por densidad

- Entradas: `rhob: input.curve('RHOB')`. Salidas: `phid: output.curve('PHID')`.
- Parámetros (zona, propios): `rhoMa` «Densidad de la matriz» 2,65 g/cm³ [2,0–3,2, paso 0,01]; `rhoFl` «Densidad del
  fluido» 1,0 g/cm³ [0,6–1,3, paso 0,01].
- Cálculo: `densityPorosityInto(rhob, out, rhoMa, rhoFl, start, end)`. Aviso si `rhoMa ≤ rhoFl`.

### C3. `phi-neutron` — Porosidad neutrónica

- Entradas: `nphi: input.curve('NPHI')`. Salidas: `phin: output.curve('PHIN')`.
- Parámetros: `matrixOffset` «Corrección de matriz» 0 v/v [−0,10–0,10, paso 0,005], zona (NPHI en unidades de caliza
  leído en arenisca: ≈ +0,04).
- Cálculo: `neutronPorosityInto(nphi, out, matrixOffset, start, end)`.

### C4. `phi-sonic-wyllie` — Porosidad sónica (Wyllie)

- Entradas: `dt: input.curve('DT')`. Salidas: `phis: output.curve('PHIS')`.
- Parámetros: `dtMa` compartido; `dtFl` «Δt del fluido» 189 µs/ft [150–240, paso 1], zona; `cp` «Factor de
  compactación (Cp)» 1 [1–2, paso 0,01], zona.
- Cálculo: bucle con `sonicPorosityWyllie(dt[i], dtMa, dtFl, cp)` (P7 agrega `cp`).

### C5. `phi-sonic-raymer` — Porosidad sónica (Raymer-Hunt-Gardner)

- Entradas: `dt: input.curve('DT')`. Salidas: `phis: output.curve('PHIS')`. Parámetros: `dtMa` compartido.
- Cálculo: `sonicPorosityRaymerInto(dt, out, dtMa, start, end)`.

### C6. `phit` — Porosidad total

- Entradas: `phid: input.optionalCurve('PHID')`, `phin: input.optionalCurve('PHIN')`,
  `phis: input.optionalCurve('PHIS')`. Salidas: `phit: output.curve('PHIT')`.
- Parámetros: `method` enum, zona, default `'auto'`: `auto` «Automático», `densityNeutron` «Densidad–neutrón»,
  `densityNeutronGas` «Densidad–neutrón (gas)», `density` «Densidad», `neutron` «Neutrón», `sonic` «Sónico».
- Cálculo por muestra: `densityNeutron` → `densityNeutronPorosity(phid, phin)`; `densityNeutronGas` →
  `densityNeutronGasPorosity`; `density`/`neutron`/`sonic` → copia de PHID/PHIN/PHIS. `auto`: D–N si PHID y PHIN
  tienen dato en la muestra; si no PHID; si no PHIS; si no NaN (llena huecos muestra a muestra).
- Avisos: método de una zona que necesita una curva ausente («En la zona B el método sónico necesita PHIS…»; ese tramo
  queda NaN); ninguna de las tres entradas presente.

### C7. `phie-vsh` — Porosidad efectiva φt·(1 − Vsh)

- Entradas: `phit: input.curve('PHIT')`, `vsh: input.curve('VSH')`. Salidas: `phie: output.curve('PHIE')`. Sin
  parámetros. Cálculo: `effectivePorosityInto(phit, vsh, out, start, end)`.

### C8. `phie-shale-corrected` — Porosidad efectiva con corrección por arcilla

- Entradas: como C7. Salidas: `phie: output.curve('PHIE')`.
- Parámetros: `phiSh` «Porosidad aparente de la arcilla» 0,20 v/v [0–0,5, paso 0,005], zona (lectura de PHIT en las
  arcillas vecinas).
- Cálculo: `shaleCorrectedPorosityInto(phit, vsh, out, phiSh, start, end)`.

### C9. `temp-gradient` — Temperatura de formación

- Entradas: ninguna. Salidas: `temp: output.curve('TEMP')`.
- Parámetros (globales, propios): `tSurface` «Temperatura de superficie» 20 °C [−10–60, paso 0,5]; `gradient`
  «Gradiente geotérmico» 3 °C/100 m (`degC/100m`) [0,5–8, paso 0,05]; `datum` «Profundidad de la temperatura de
  superficie» 0 m [−500–5000, paso 1] (p. ej. fondo marino o mesa rotary).
- Cálculo: `formationTemperature(depth[i] − datum, tSurface, gradient / 100)` (`temperature.ts`).
- Panel opcional: «gradiente desde BHT» (BHT y profundidad final, del encabezado si están) que escribe `gradient`.

### C10. `rw-manual` — Rw conocida

- Entradas: `temp: input.curve('TEMP')`. Salidas: `rw: output.curve('RW')`.
- Parámetros (zona, propios): `rwRef` «Rw» 0,05 Ω·m [0,005–5, log, paso 0,001]; `tRef` «Temperatura de Rw» 24 °C
  [0–200, paso 0,5]; `correct` boolean «Corregir por temperatura» `true`.
- Cálculo: `correct` → `RW[i] = arpsResistivityC(rwRef, tRef, temp[i])`; si no, `RW[i] = rwRef`.
- Es el primero de `RW` en el registro: la fuente por defecto (siempre puede correr).

### C11. `rw-sp` — Rw desde el SP

- Entradas: `sp: input.curve('SP')`, `temp: input.curve('TEMP')`. Salidas: `rw: output.curve('RW')`,
  `byZone: output.table('RW_SP_BY_ZONE', …)` con columnas `zone` (texto), `temp` (°C), `rmfT` «Rmf a T» (Ω·m),
  `rmfe` (Ω·m), `ssp` (mV), `k` «K del SP» (mV), `rw` «Rw a T» (Ω·m).
- Parámetros: `spShale` «Línea base de arcillas» 0 mV [−200–200, paso 0,5], zona; `spClean` «SP de arena limpia con
  agua» −60 mV [−250–100, paso 0,5], zona; `rmf`, `tRmf` compartidos.
- Cálculo, por segmento: `T` = media de TEMP en el segmento ponderada por espesor (`intervalStats`); `rmfT =
  arpsResistivityC(rmf, tRmf, T)`; `rmf75 = arpsResistivityC(rmf, tRmf, 23.889)` (75 °F); `rmfe =
  equivalentMudFiltrateResistivity(rmfT, rmf75)` (P6); `SSP = spClean − spShale`; `RwT =
  waterResistivityFromSp(SSP, rmfe, celsiusToFahrenheit(T))`; luego `RW[i] = arpsResistivityC(RwT, T, temp[i])`.
  El SP solo identifica el método (y lo usa el panel); no entra en el cálculo.
- Avisos: `SSP ≥ 0` (no hay deflexión de arena); `rmf75 ≤ 0,1` (se usó Rmfe ≈ Rmf, sin la carta SP-2); SP sin datos en
  la zona (el TP: 12 muestras).
- Overlay opcional (`overlay.ts`): líneas arrastrables de `spShale` y `spClean` sobre la pista del SP.

### C12. `rw-rwa` — Rw por Rwa mínima

- Entradas: `rt: input.curve('RT')`, `phi: input.curve('PHIE')`, `temp: input.curve('TEMP')`,
  `vsh: input.optionalCurve('VSH')`. Salidas: `rwa: output.curve('RWA')`, `rw: output.curve('RW')`,
  `byZone: output.table('RW_RWA_BY_ZONE', …)` con `zone`, `temp` (°C), `rw` «Rw a T» (Ω·m), `count` «Muestras usadas».
- Parámetros: `a`, `m` compartidos; `mode` enum global `'well'` «Un Rw para todo el pozo» | `'zone'` «Un Rw por
  zona», default `'well'`; `percentile` «Percentil de Rwa» 0,10 v/v [0,01–0,5, paso 0,01], global; `vshMax`
  «Vsh máxima de las muestras» 0,2 v/v [0–1, paso 0,01], global.
- Cálculo: `RWA[i] = apparentWaterResistivity(rt[i], phi[i], a, m)` por segmento (a, m de la zona). Rwa de
  referencia a 24 °C: `arpsResistivityC(RWA[i], temp[i], 24)` sobre las muestras con `vsh ≤ vshMax` (todas si no hay
  VSH). `'well'`: `rwRef = percentile(…)` (P4) sobre todo el pozo; `'zone'`: uno por segmento. Después
  `RW[i] = arpsResistivityC(rwRef, 24, temp[i])`. La tabla informa Rw a la temperatura media de cada zona.
- Avisos: ninguna muestra cumple el filtro (tramo NaN); `'zone'` en una zona con hidrocarburo da Rw alto (texto fijo
  en el tooltip de `mode`, no aviso).
- No hay ciclo: RWA/RW dependen de RT, PHIE y TEMP; SW depende de RW.

### C13–C15. Saturación de agua

| Módulo | Entradas (curvas) | Parámetros (todos compartidos) | Función por muestra |
|---|---|---|---|
| `sw-archie` | `rt` RT, `phi` PHIE, `rw` RW | `a`, `m`, `n` | `archieSw(rt, phi, rw, a, m, n)` |
| `sw-simandoux` | `rt` RT, `phi` PHIE, `vsh` VSH, `rw` RW | `a`, `m`, `rsh` | `simandouxSw(rt, phi, vsh, rw, rsh, a, m)` (n = 2 fijo: la doc lo dice y el panel no muestra `n`) |
| `sw-indonesia` | `rt` RT, `phi` PHIE, `vsh` VSH, `rw` RW | `a`, `m`, `n`, `rsh` | `indonesiaSw(rt, phi, vsh, rw, rsh, a, m, n)` |

Salida: `sw: output.curve('SW')`. Bucle por segmento con los parámetros de la zona y `rw[i]` por muestra (D2).

### C16. `bvw-sh` — Volumen de agua y saturación de hidrocarburos

- Entradas: `phi: input.curve('PHIE')`, `sw: input.curve('SW')`. Salidas: `bvw: output.curve('BVW')`,
  `sh: output.curve('SH')`. Sin parámetros.
- Cálculo: `bulkVolumeWaterInto(phi, sw, bvw)`, `hydrocarbonSaturationInto(sw, sh)`.

### C17. `perm-timur` — Permeabilidad de Timur

- Entradas: `phi: input.curve('PHIE')`, `sw: input.optionalCurve('SW')`. Salidas: `k: output.curve('PERM')`.
- Parámetros (zona, propios): `swirrFrom` enum `'param'` «Valor fijo» | `'sw'` «Sw calculada (zona a saturación
  irreducible)», default `'param'`; `swirr` «Saturación de agua irreducible» 0,25 v/v [0,05–0,9, paso 0,01].
- Cálculo: `'param'` → `timurPermeabilityInto(phi, out, swirr, start, end)`; `'sw'` → `timurPermeability(phi[i],
  sw[i])`. Si `'sw'` y no hay SW: aviso y se usa `swirr`.

### C18. `perm-coates` — Permeabilidad de Timur–Coates (RMN)

- Entradas: `phiNmr: input.optionalCurve('PHIE_NMR')`, `phie: input.optionalCurve('PHIE')`,
  `bvi: input.curve('BVI_NMR')`. Salidas: `k: output.curve('PERM')`.
- Parámetros (zona, propios): `porosity` enum `'nmr'` «Porosidad RMN» | `'phie'` «Porosidad efectiva de perfiles»,
  default `'nmr'`; `c` «Constante C» 10 [1–50, paso 0,1].
- Cálculo: `timurCoatesPermeabilityInto(φ, bvi, out, c, start, end)` con φ según `porosity`; si la elegida falta,
  usa la otra con aviso; si faltan las dos, NaN y aviso. La forma original usa la porosidad RMN (BVI y φ de la misma
  herramienta); `'phie'` mezcla herramientas (tooltip).

### C19. `cutoffs` — Cutoffs de reservorio y pay

- Entradas: `vsh: input.curve('VSH')`, `phi: input.curve('PHIE')`, `sw: input.curve('SW')`.
  Salidas: `netRes: output.curve('NET_RES')`, `netPay: output.curve('NET_PAY')`.
- Parámetros: `vshCutoff`, `phiCutoff`, `swCutoff` compartidos (zona).
- Cálculo: `netFlagsInto(vsh, phi, sw, netRes, netPay, { vshMax, phiMin, swMax }, start, end)` por segmento (P1).
- Overlay opcional: líneas verticales arrastrables de los tres cortes en las pistas de VSH, PHIE y SW.

### C20. `cutoff-sensitivity` — Sensibilidad a los cutoffs

- Entradas: `vsh: input.curve('VSH')`, `phi: input.curve('PHIE')`, `sw: input.curve('SW')`.
- Parámetros: `vshCutoff`, `phiCutoff`, `swCutoff`, `area`, `fluid`, `bo`, `bg` compartidos; `steps` «Puntos del
  barrido» 41 [11–201, paso 1], global, propio.
- Salida: `sweep: output.table('CUTOFF_SWEEP', { hidden: true, … })`, columnas: `variable` (texto: `vsh`|`phi`|`sw`),
  `zoneId` (texto; `''` = total), `zone` (texto), `threshold` (v/v), `netRes` (m), `netPay` (m), `hphiSh` (m),
  `ooip` (m3), `ogip` (m3). Filas: para cada variable, para cada intervalo (D6) y el total, `steps` umbrales.
- Grillas fijas: Vsh [0, 1], φ [0, 0,4], Sw [0, 1].
- Cálculo: por variable y por zona, `cutoffSweep(…)` (P5) con los cutoffs de **esa zona** (`paramsFor`) y el de la
  variable reemplazado por cada umbral; volúmenes con `zoneInPlace(fluid, area·1e6, hphiSh, bo, bg)` (P3); zonas
  `seal` → volumen 0. Total = suma de zonas en cada umbral. Sin zonas: una sola serie «Pozo completo» con cutoffs
  globales y `ooip`/`ogip` en `null` (como el volumétrico, el volumen necesita zonas).
- Panel a medida (`panel.tsx`, obligatorio para que sirva): tres gráficos chicos (uno por cutoff) de espesor neto pay
  y volumen contra el umbral, filtro por zona, marcador del cutoff actual arrastrable (escribe el parámetro
  compartido con `setParam`, etiqueta «Cambiar Vsh máxima»…).

### C21. `zone-summary` — Sumario por zona

- Entradas: `netRes: input.curve('NET_RES')`, `netPay: input.curve('NET_PAY')`, `phi: input.curve('PHIE')`,
  `sw: input.curve('SW')`, `vsh: input.optionalCurve('VSH')`, `k: input.optionalCurve('PERM')`. Sin parámetros.
- Salidas:
  - `table: output.table('ZONE_SUMMARY', …)`, una fila por intervalo (D6) y una fila «Total». Columnas (clave · etiqueta
    · unidad): `zone` Zona (texto) · `kind` Tipo (texto: «Formación», «Reservorio», «Sello», «Otro») · `top` Tope m ·
    `base` Base m · `gross` Bruto m · `netRes` Neto reservorio m · `netPay` Neto pay m · `ntgRes` N/G reservorio v/v ·
    `ntgPay` N/G pay v/v · `phiRes` φ reservorio v/v · `swRes` Sw reservorio v/v · `phiPay` φ pay v/v · `swPay` Sw pay
    v/v · `vshPay` Vsh pay v/v · `kPay` k pay mD · `khPay` kh pay (unidad `unitless`, etiqueta «kh pay (mD·m)») ·
    `hphiPay` h·φ pay m · `hphiShPay` h·φ·Sh pay m · `noData` Sin dato m · `noDataPay` Sin dato pay m. Celdas sin valor → `null`.
  - `netPayH: output.zoneScalar('NET_PAY_H', { label: 'Neto pay', unit: 'm' })`.
  - `hphiSh: output.zoneScalar('HPHISH_PAY', { label: 'h·φ·Sh pay', unit: 'm' })` (lo consume el volumétrico).
  - `netPayTotal: output.scalar('NET_PAY_TOTAL', { label: 'Neto pay total', unit: 'm' })`,
    `hphiShTotal: output.scalar('HPHISH_TOTAL', { label: 'h·φ·Sh total', unit: 'm' })`.
- Cálculo: `summarizeRanges(input, [{ start, end }])` por intervalo y `summarizeRanges(input, todasLasZonas)` para el
  total (P2).

### C22. `volumetrics` — Volumen in situ

- Entradas: `hphiSh: input.zoneScalar('HPHISH_PAY')`. Parámetros: `area`, `fluid`, `bo`, `bg` compartidos (zona).
- Salidas: `ooip: output.zoneScalar('OOIP', { label: 'Petróleo in situ', unit: 'm3' })`,
  `ogip: output.zoneScalar('OGIP', { label: 'Gas in situ', unit: 'm3' })`,
  `ooipTotal: output.scalar('OOIP_TOTAL', { label: 'Petróleo in situ total', unit: 'm3' })`,
  `ogipTotal: output.scalar('OGIP_TOTAL', { label: 'Gas in situ total', unit: 'm3' })`,
  `table: output.table('VOLUMETRICS', …)` con `zone` (texto), `fluid` (texto: «Petróleo», «Gas», «Sin hidrocarburo»,
  «Sello»), `area` (km2), `hphiSh` (m), `b` «Factor de volumen» (m3/m3: Bo o Bg según el fluido), `ooipSi` (Mm3),
  `ooipField` (MMbbl), `ogipSi` (MMm3), `ogipField` (Bcf), y fila «Total».
- Cálculo: por zona de `ctx.zones`, `zoneInPlace(fluid, area · 1e6, hphiSh[z.id], bo, bg)` (P3) con `paramsFor(z.id)`;
  `kind === 'seal'` → 0. Conversión de la tabla con `convert(v, 'm3', 'Mm3')`, etc. `hphiSh` NaN → volumen NaN.
- Avisos: sin zonas («Definí zonas para calcular el volumen»); zona con fluido petróleo y Bo = 1 exacto no avisa.

---

## Parte 4 — Agregados a `src/petro/` (funciones puras, con tests Vitest)

Convenciones de `src/petro/`: escalares y `ArrayLike<number>`, rangos `[start, end)`, NaN = sin dato, sin unidades
implícitas (cada firma dice en qué unidad recibe), comentario de cabecera con ecuaciones y referencias.

### P1. `src/petro/cutoffs.ts`

```ts
export interface Cutoffs { vshMax: number; phiMin: number; swMax: number }

/** 0 si una curva conocida no pasa su corte (aunque la otra sea NaN); 1 si ambas pasan; NaN si falta alguna y ninguna conocida descarta. */
export function netReservoirFlag(vsh: number, phi: number, vshMax: number, phiMin: number): number;
/** NaN si netRes es NaN; 0 si netRes = 0; si netRes = 1: 1 si sw ≤ swMax, 0 si no, NaN si sw es NaN. */
export function netPayFlag(netRes: number, sw: number, swMax: number): number;
export function netFlagsInto(
  vsh: ArrayLike<number>, phi: ArrayLike<number>, sw: ArrayLike<number>,
  outRes: Float64Array, outPay: Float64Array, cutoffs: Cutoffs, start?: number, end?: number,
): void;
```

Tests: bordes inclusivos (vsh = vshMax pasa), NaN en cada entrada, pay ⊆ res.

### P2. `src/petro/summary.ts`

```ts
export interface SummaryInput {
  thickness: ArrayLike<number>;   // m por muestra (ctx.thickness)
  netRes: ArrayLike<number>; netPay: ArrayLike<number>;   // banderas 0/1/NaN
  phi: ArrayLike<number>; sw: ArrayLike<number>;          // v/v
  vsh?: ArrayLike<number>; perm?: ArrayLike<number>;      // v/v, mD
}
export interface IntervalSummary {
  gross: number; noData: number; noDataPay: number; netRes: number; netPay: number;   // m (noDataPay: reservorio sin Sw)
  ntgRes: number; ntgPay: number;                                      // v/v (NaN si gross = 0)
  phiRes: number; swRes: number; vshRes: number;                       // promedios sobre neto reservorio
  phiPay: number; swPay: number; vshPay: number; kPay: number;         // promedios sobre neto pay
  khPay: number;                                                       // mD·m
  hphiRes: number; hphiShRes: number; hphiPay: number; hphiShPay: number; // m
}
export function summarizeRanges(input: SummaryInput, ranges: readonly { start: number; end: number }[]): IntervalSummary;
```

Definiciones en D6. `vshRes`/`vshPay` NaN si no hay `vsh`; `kPay`/`khPay` NaN si no hay `perm`. Tests: caso a mano de
6–10 muestras con espesores distintos; identidad h·φ̄·(1 − S̄w) = hphiSh; el total de dos rangos coincide con
`summarizeRanges` de la unión.

### P3. `src/petro/volumetrics.ts`

```ts
export type FluidKind = 'oil' | 'gas' | 'none';
/** Volumen in situ a condiciones de superficie (m³): A·hφSh/B. A en m², hphiSh en m, B en m³/m³ > 0 (si no → NaN). */
export function inPlaceVolume(areaM2: number, hphiSh: number, b: number): number;
export interface InPlace { ooip: number; ogip: number }   // m³ estándar
/** 'oil' → { ooip: V(bo), ogip: 0 }; 'gas' → { ooip: 0, ogip: V(bg) }; 'none' → { 0, 0 }. */
export function zoneInPlace(fluid: FluidKind, areaM2: number, hphiSh: number, bo: number, bg: number): InPlace;
```

Test de libro: A = 1 acre (4046,8564224 m²), hφSh = 0,3048 m (1 ft), Bo = 1 → 1233,48 m³ = 7758,4 bbl
(`convert(v, 'm3', 'bbl')`); OGIP con 43 560 ft³/(acre·ft).

### P4. `src/petro/stats.ts` (agregado)

```ts
/**
 * Percentil p ∈ [0, 1] de los valores finitos de [start, end) que cumplen `include` (todos si se omite), con
 * interpolación lineal entre estadísticos de orden (tipo 7: el de NumPy por defecto). Sin valores → NaN.
 */
export function percentile(values: ArrayLike<number>, p: number, start?: number, end?: number, include?: (i: number) => boolean): number;
```

### P5. `src/petro/sensitivity.ts`

```ts
import type { Cutoffs } from './cutoffs';
export type SweepVariable = 'vsh' | 'phi' | 'sw';
/** Umbrales t_j = min + j·(max − min)/(steps − 1), j = 0…steps−1 (steps ≥ 2). */
export interface SweepGrid { min: number; max: number; steps: number }
export interface SweepCurves {
  thresholds: Float64Array;   // t_j
  netRes: Float64Array;       // m, neto reservorio con el cutoff de `variable` = t_j
  netPay: Float64Array;       // m
  hphiShPay: Float64Array;    // m, Σ h·φ·(1 − Sw) sobre pay
}
export function sweepThresholds(grid: SweepGrid): Float64Array;
export function cutoffSweep(
  vsh: ArrayLike<number>, phi: ArrayLike<number>, sw: ArrayLike<number>, thickness: ArrayLike<number>,
  cutoffs: Cutoffs, variable: SweepVariable, grid: SweepGrid, ranges: readonly { start: number; end: number }[],
): SweepCurves;
```

Semántica: en cada `t_j`, idéntico a sumar `netFlagsInto` con el cutoff de `variable` reemplazado por `t_j`.
Algoritmo O(muestras + steps): las muestras que pasan los otros dos cortes se asignan al primer umbral desde el que
pasan (comparando contra el mismo `t_j` de `sweepThresholds`, no con una división, para que el borde sea exacto) y se
acumulan con sumas prefijas (≤ para Vsh y Sw, ≥ para φ). Tests: contra fuerza bruta en todos los umbrales (tolerancia
1e-9), muestras exactamente sobre un umbral, NaN, monotonía (netPay no crece al endurecer un corte).

### P6. `src/petro/rw.ts` (agregado)

```ts
/**
 * Rmfe desde Rmf a temperatura de formación (Asquith y Krygowski 2004, cap. SP): si Rmf a 75 °F > 0,1 Ω·m,
 * Rmfe = 0,85·Rmf(Tf); si no, Rmfe ≈ Rmf(Tf) (la carta SP-2 no está implementada: aproximación, el módulo avisa).
 * Rmf ≤ 0 o no finito → NaN.
 */
export function equivalentMudFiltrateResistivity(rmfAtTf: number, rmfAt75F: number): number;
```

### P7. `src/petro/porosity.ts` (cambio compatible)

`sonicPorosityWyllie(dt, dtMa, dtF, cp = 1)`: φ = (Δt − Δtma)/(Δtf − Δtma)/Cp, recortada a [0, 0,5]; Cp ≤ 0 o no
finito → NaN. `sonicPorosityWyllieInto` no cambia (Cp = 1). Test: Cp = 1 reproduce los casos existentes; Cp = 1,2
divide.

---

## Parte 5 — Interfaz y verificación

- Sin panel a medida, el panel se genera del esquema (alcanza para C1–C19, C21, C22). Paneles a medida: C20
  (obligatorio); C1 y C9 opcionales. Overlays opcionales: C11 (líneas de SP) y C19 (cortes en las pistas). Los
  overlays del visor ya existentes de `igr` no cambian.
- El visor muestra solas las curvas nuevas (TEMP, RW, RWA, PHID, PHIN, PHIS, PHIT, PHIE, SW, BVW, SH, PERM, NET_RES,
  NET_PAY) por rol; la pista volumétrica (fase 4b) ya apila VSH/PHIE/BVW.
- Tests por módulo (`tests/modules-6a.test.ts` o uno por familia), con `new Engine(registry, { checkInputs: true })`:
  cadena completa sobre un pozo sintético de 3 zonas (una `seal`); valores por muestra contra la función de petro;
  override por zona de un parámetro compartido; avisos; sumario y volumétrico contra cuentas a mano; la sensibilidad
  en el cutoff actual coincide con el sumario (netPay y h·φ·Sh) y el volumétrico.
- Cadena completa sobre `datos/pozo_tp_perfiles.csv` (zonas A–E): todos los módulos por defecto en `ok` y el tiempo
  de un cambio de cutoff < 20 ms en el motor.
- Criterio de terminado: `npm run typecheck`, `npm test`, `npm run build`; flujo Petrofísica de punta a punta con el
  pozo del TP sin tocar fuentes (las elige N3).

## Parte 6 — Precisiones al implementar P1–P7 y C4, C11, C12, C19, C21, C22

No se encontró ningún error matemático ni de unidades en las ecuaciones del documento (se recalcularon a mano los
casos de los tests). Cambios y precisiones de las firmas y fichas:

- **P2 (`summarizeRanges`):** `noData` = espesor con `netRes` NaN (falta Vsh o φ). Cada promedio usa solo las muestras
  netas con dato en sus variables, así que `hphiShRes` suma solo las muestras con Sw y la identidad
  h·φ̄·(1 − S̄w) = h·φ·Sh es exacta en el pay (siempre tiene φ y Sw) pero en el reservorio solo si todas las muestras
  netas tienen Sw. Los rangos no deben solaparse.
- **P3:** `inPlaceVolume` también devuelve NaN con área < 0 o h·φ·Sh < 0 (rango físico), además de B ≤ 0 o no finito.
  `zoneInPlace('oil', …)` con h·φ·Sh NaN da `{ ooip: NaN, ogip: 0 }`.
- **P5:** `sweepThresholds` fuerza el último umbral a `max` exacto (la suma `min + j·dx` puede errar en el último ulp) y
  lanza `RangeError` si `steps` no es un entero ≥ 2 o no se cumple `min < max`. La búsqueda del bin usa los mismos
  `t_j` con una estimación inicial por división corregida por comparación (O(1) por muestra).
- **P6:** además de la función se exportan `RMFE_THRESHOLD_75F = 0,1` y `RMFE_FACTOR = 0,85`. Si `rmfAt75F` es NaN,
  el resultado es NaN. El umbral es estricto (`> 0,1`).
- **P7:** Cp ≤ 0, NaN o Infinity → NaN; el recorte a [0; 0,5] se aplica después de dividir por Cp.
- **C11 (`rw-sp`):** la tabla `RW_SP_BY_ZONE` tiene una fila por tramo con muestras (zona, «Fuera de zonas» o «Pozo
  completo» sin zonas). El 75 °F se calcula como `fahrenheitToCelsius(75)` (23,8889 °C). Overlay de las líneas de SP:
  pendiente (opcional).
- **C12 (`rw-rwa`):** el modo `'well'` informa en `count` las muestras usadas en todo el pozo. Con VSH presente, las
  muestras con Vsh NaN se excluyen; sin VSH se usan todas.
- **C19 (`cutoffs`):** solo cambian las reglas de datos faltantes (ver abajo). Overlay de cortes: pendiente (opcional).
- **C21 (`zone-summary`):** los valores por zona (`NET_PAY_H`, `HPHISH_PAY`) y los totales son **NaN (sin dato)** cuando
  la zona no tiene muestras o ninguna es clasificable (falta Vsh o φ en todas); con muestras clasificables y sin pay
  valen 0. La fila de la tabla conserva las sumas (0). El `top`/`base` del «Total» son el menor tope y la mayor base.
  Sin zonas, el intervalo «Pozo completo» tiene `kind` nulo y `top`/`base` de la primera y la última profundidad.
- **C22 (`volumetrics`):** una zona con h·φ·Sh NaN da volumen NaN y no entra en el total (la suma ignora NaN; si todas
  son NaN, el total es NaN). En la tabla, las celdas del fluido que no corresponde son `null` (petróleo: gas `null`;
  gas: petróleo `null`); sello y «Sin hidrocarburo» muestran 0 en ambos. El sello no muestra área, h·φ·Sh ni factor
  de volumen. La fila «Total» no suma áreas (zonas apiladas comparten mapa).
- **C20 (`cutoff-sensitivity`):** además de los `steps` umbrales de la grilla, cada serie (variable × intervalo) lleva
  una fila con `current = 1` (columna nueva `current`) evaluada exactamente en el cutoff vigente del intervalo (en el
  Total, cada zona con el suyo; el `threshold` del Total es el global). Así coincide con el sumario y el volumétrico
  aunque el cutoff no caiga sobre la grilla (p. ej. 24 · 0,025 = 0,6000000000000001). Zonas sin muestras
  clasificables: filas en `null`, como el sumario. El panel es `mode: 'replace'`: zona o Total (usa la zona en edición
  de la interfaz), tres gráficos con la línea del cutoff arrastrable (`setParam` al soltar, «Cambiar Sw máxima»…) y
  «Puntos del barrido»; el volumen va en Mm³ o MMm³ según la magnitud.
- **Orden de registro:** `phi-sonic-wyllie` (C4) va antes que `phi-sonic-raymer` (C5), así que Wyllie es la fuente por
  defecto de `PHIS` (regla N3). `rw-sp`, aunque no sea la fuente de `RW`, corre igual y en pozos sin curva SP informa
  `missing-input` como error (es el caso de «Abierto» sobre módulos que no pueden correr).

### Reglas de datos faltantes en los cutoffs (aprobadas después de la primera entrega)

1. **Descarte seguro (P1).** Si alguna curva conocida ya no pasa su corte, la muestra es no reservorio (`NET_RES = 0`)
   aunque falte otra: Vsh 0,9 con φ NaN da 0. Solo es NaN cuando ninguna curva conocida la descarta y falta alguna.
   Efecto: `noData` del sumario cuenta únicamente las muestras realmente sin clasificar.
2. **Sw faltante en reservorio (P1, P2, P5).** `NET_RES = 1` con Sw NaN da `NET_PAY = NaN` («sin dato de pay»).
   - `summarizeRanges` agrega `noDataPay` = Σh donde `netRes = 1` y `netPay` es NaN. Si hay reservorio y **ninguna**
     muestra de reservorio tiene dato de pay, `netPay`, `ntgPay`, `hphiPay`, `hphiShPay` y `khPay` son NaN (no 0), y
     `hphiShRes` también si ninguna tiene Sw. Si falta solo parte del Sw se suma lo conocido y el faltante queda en
     `noDataPay`. Sin reservorio el pay es 0 (no hay nada que no se pueda decidir).
   - `cutoffSweep` agrega `noDataPay` a `SweepCurves` y devuelve NaN en `netPay` y `hphiShPay` en los umbrales con
     reservorio y sin ningún Sw: coincide con la fuerza bruta (`netFlagsInto` + reglas del sumario) y con el sumario.
   - C21: columna nueva `noDataPay` («Sin dato pay», m) por zona y en el total; `NET_PAY_H`, `HPHISH_PAY` y los
     escalares totales son NaN cuando el pay de la zona (o del total) es «sin dato»; el total suma lo conocido de las
     demás zonas. `warn` si el faltante de una zona (que no sea sello) supera el 5 % de su neto de reservorio.
   - C22: el volumen de una zona con h·φ·Sh NaN es NaN, avisa (salvo sello y fluido «Sin hidrocarburo») y el total suma
     las demás zonas.
   - C20: columna `noDataPay` en `CUTOFF_SWEEP`; zona «sin dato» = ninguna muestra clasificada (0 o 1) con sus cortes
     vigentes; el Total es nulo en el pay solo si hay reservorio y ninguna zona con pay conocido (igual que el sumario
     sobre la unión). Las zonas selladas sin clasificar conservan volumen 0.
   - Paneles de sumario y volumétrico: «Sin dato pay» se muestra solo si hay faltante, en la zona que lo tiene (nunca
     el sello), con una nota.
   - Pozo del TP (15 muestras sin Sw, todas en lutitas con Vsh = 1 y φ = 0): con los cutoffs por defecto las descarta
     Vsh, así que `noDataPay` es 0 en A–E. Con los cortes al máximo (Vsh ≤ 1, φ ≥ 0) quedan B 1,219 m, D 0,457 m y
     E 0,610 m (2,286 m en total, 0,7 % del reservorio de B): bajo el umbral de aviso.

## Reparto sugerido

1. `analista-numerico`: P1–P7 con tests (revisa otro agente).
2. `desarrollador-ui`: C1–C19 y C21–C22 sobre el contrato (fichas de arriba), registro, retiro de `shale-flag`.
3. `desarrollador-ui` o `arquitecto`: C20 con su panel y los overlays opcionales.

## Abierto

- **Profundidades del TP:** 7633–8518 m con 3 °C/100 m dan ~250 °C. El paso de 0,1524 m sugiere que el archivo
  original estaba en pies; confirmar con la cátedra antes de fijar los defaults de temperatura.
- **Método por zona para puertos con módulos distintos** (Archie en arenas limpias, Simandoux en arcillosas):
  necesita `sources` por zona en el núcleo; hoy la elección es por pozo.
- Los módulos que son fuente por defecto de un puerto que nadie consume siguen corriendo y, si les falta una curva,
  informan un error (p. ej. sónico sin DT). Podría bajarse a `info` cuando el puerto no tiene consumidores.
- Rwe → Rw (carta SP-2) y Rmfe para Rmf ≤ 0,1 Ω·m quedan aproximados (ver `rw.ts`).
- Monte Carlo (fase posterior) puede usar directamente `OOIP_TOTAL`/`OGIP_TOTAL` y los parámetros compartidos.
