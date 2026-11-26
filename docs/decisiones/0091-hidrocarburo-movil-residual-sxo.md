# 0091 — Hidrocarburo móvil vs. residual (`Sxo`, `MOS`, `Rt–Rxo` y pista volumétrica)

Fecha: 2026-11-26. Sigue a la 0007 (módulos de saturación), la 0015 (parámetros arrastrables en crossplots), la 0020 (inversión de invasión escalonada `invasion-step`, que publica `RXO`) y la 0005 D9 (pila volumétrica jerárquica).

## Contexto

La evaluación convencional de saturación (`SW`, `SH = 1 − SW`) informa cuánto hidrocarburo hay en el espacio poral, pero no distingue cuánto puede ser desplazado (móvil) de cuánto queda entrampado por fuerzas capilares (residual). Con `invasion-step` (o una curva medida de microresistividad `RXO`) la aplicación ya cuenta con resistividad de la zona lavada (`RXO`) junto con `RT`, `PHIE` y `SW`. Falta cerrar la cadena de resistividad con:

1. un motor petrofísico puro (`src/petro/movability.ts`) validado contra casos de libro (Asquith y Krygowski, cap. 6);
2. el módulo `movable-hc` (`SXO`, `MOS`, `SHR`, `MHI` y tabla `MOVABLE_SUMMARY`);
3. una plantilla de crossplot «Movilidad Rt–Rxo (Ratio Plot)» con recta de agua arrastrable para calibrar `Rmf / Rw`;
4. una partición compatible de `hydrocarbon` en `VOLUMETRIC_STACK` que no altere pozos sin `RXO` ni genere huecos falsos cuando `RXO = NaN`.

## Decisión

### 1. Ecuaciones del motor (`src/petro/movability.ts`)

Con `SW ∈ [0, 1]`, `RXO > 0`, `RT > 0`, `PHIE > 0`, exponente de saturación `n > 0` y parámetros de Archie `a > 0, m > 0`:

1. **Método de cocientes (`ratio`, por defecto, independiente de la porosidad):**
   $$r = \left(\frac{R_{xo} / R_t}{R_{mf} / R_w}\right)^{1/n}, \qquad S_{xo,\text{bruto}} = \frac{S_w}{r}$$
   Requiere `RT` y el cociente empírico `rmfOverRw = Rmf / Rw = (Rxo / Rt)_agua > 0` (por zona, calibrable en el gráfico `Rt–Rxo`; valor por defecto `10`, coherente con `Rmf = 0,5 Ω·m` y `Rw = 0,05 Ω·m` de los valores de fábrica).

2. **Archie en zona lavada (`archie` / `archie-rxo`):**
   $$S_{xo,\text{bruto}} = \operatorname{clip}_{[0,1]}\!\left(\left(\frac{a\,R_{mf}(T)}{\phi_e^m\,R_{xo}}\right)^{1/n}\right)$$
   Usa los parámetros compartidos `a, m, n, rmf, tRmf` de `SHARED_PARAMS`. Si `correctRmfTemp` está activo (por defecto `true`) y existe curva `TEMP`, `Rmf` se lleva muestra a muestra a temperatura de formación con Arps (`arpsResistivityC`); si falta `TEMP` se avisa y se usa `Rmf` sin corregir.

3. **Recorte físico (`SXO ∈ [SW, 1]`) y magnitudes derivadas:**
   Cuando el filtrado acuoso de un lodo base agua desplaza hidrocarburo en la zona lavada, físicamente se cumple $S_w \le S_{xo} \le 1$:
   - Si $S_{xo,\text{bruto}} < S_w - 10^{-6}$, se cuenta como anomalía (`belowSw`) y se avisa por zona (puede indicar `Rmf/Rw` o `Rmf` subestimado, lodo base aceite, invasión invertida o ruido de `Rxo`).
   - Se recorta $S_{xo} = \operatorname{clip}_{[S_w,\, 1]}(S_{xo,\text{bruto}})$ cuando $S_w$ es finito (si en modo `archie` falta $S_w$, $S_{xo} \in [0,1]$ y `SHR = 1 − Sxo` siguen siendo válidos mientras `MOS` y `MHI` quedan `NaN`).
   - **Saturación de hidrocarburo móvil:** $\text{MOS} = \max(0,\, S_{xo} - S_w) = S_{xo} - S_w$.
   - **Saturación de hidrocarburo residual:** $\text{SHR} = 1 - S_{xo}$.
   - **Conservación del espacio poral:** con el recorte a $[S_w, 1]$ se cumple exactamente $\text{MOS} + \text{SHR} = 1 - S_w = S_h$ y $S_w + \text{MOS} + \text{SHR} = 1$ en toda muestra válida.
   - **Índice de movilidad de hidrocarburos:** $\text{MHI} = S_w / S_{xo}$ (si $S_{xo} > 0$, si no `NaN`). Referencia clásica (Schlumberger; Asquith y Krygowski cap. 6): `< 0,7` hidrocarburo móvil típico en areniscas (`< 0,6` en carbonatos), `≈ 1` sin desplazamiento.
   - Las funciones escalares `ratioMhi` y `archieSxo` exponen además el cociente y la saturación sin recorte contra `Sw` para pruebas de libro y diagnóstico directo.

4. **Resumen por zona (`MOVABLE_SUMMARY`):**
   Sobre las muestras de cada zona con `SXO` y `SW` finitos (ponderando por volumen poral $w_i = h_i\,\phi_{e,i}$, igual que `ZONE_SUMMARY` en `src/petro/summary.ts`, con respaldo por espesor $h_i$ si el volumen poral resuelto es nulo):
   - `% muestras con invasión resuelta` = $100 \cdot n_{\text{resueltas}} / n_{\text{zona}}$;
   - $\overline{S_w}$, $\overline{S_{xo}}$, $\overline{\text{MOS}} = \overline{S_{xo}} - \overline{S_w}$, $\overline{\text{SHR}} = 1 - \overline{S_{xo}}$, $\overline{\text{MHI}}$;
   - **Fracción móvil del hidrocarburo:** $\overline{\text{MOS}} / (1 - \overline{S_w}) = \sum w_i \text{MOS}_i / \sum w_i (1 - S_{w,i})$ (`NaN` si $\overline{S_w} = 1$).

### 2. Módulo `src/modules/movable-hc/`

- Categoría `saturation`, espacio `petrophysics`, registrado después de `bvw-sh` y `swi-pc`. No modifica ni compite con ningún puerto existente (`SW`, `PHIE`, `VSH`, `PERM`, `NET_PAY`, `ZONE_SUMMARY`, `OOIP/OGIP`), por lo que la réplica por defecto del TP conserva todos sus valores sin cambios.
- Consume `SW`, `PHIE`, `RXO` (resuelto desde curva medida o desde `invasion-step`) y opcionalmente `RT` y `TEMP`.
- Publica `SXO` (rol incorporado), los roles declarados por el módulo `MOS`, `SHR`, `MHI` (con paleta curada en `src/ui/curves.ts`, contraste `≥ 3:1` en claro/oscuro) y la tabla `MOVABLE_SUMMARY`.
- Incluye un panel propio (`src/modules/movable-hc/panel.tsx`) con la tabla resumen y botón directo para abrir el crossplot «Movilidad Rt–Rxo». Las ecuaciones viven exclusivamente en `docs` del módulo.

### 3. Plantilla de Crossplot «Movilidad Rt–Rxo (Ratio Plot)» (`rt-rxo`)

- Ejes: `RT` en X (log) y `RXO` en Y (log); color por defecto `SW` (cambiables por el usuario, p. ej. a `GR`).
- Recta de agua ($S_w / S_{xo} = 1$): $R_{xo} = (R_{mf} / R_w)\,R_t$ (pendiente `+1` en log–log), **arrastrable** mediante `XYHandle` (`grabPath` en toda la recta + manija circular, y flechas de teclado) usando el mecanismo de `src/plots/crossplot/drag.ts` y `commitPlotParams` (`src/app/plots/connect.tsx`): cada arrastre recalcula en vivo y se agrupa en **un único `commit` deshacible** que actualiza `movable-hc.rmfOverRw` en el alcance del gráfico (zona única filtrada o global).
- Líneas guía paralelas de movilidad constante: $R_{xo} = (R_{mf} / R_w)\,(S_w / S_{xo})^n\,R_t$ para `Sw/Sxo = 0,7` (umbral móvil en areniscas) y `Sw/Sxo = 0,5` (movilidad alta), usando el exponente `n` del alcance.

### 4. Partición jerárquica compatible en `VOLUMETRIC_STACK`

Se extiende `StackComponentSpec` (JSON puro, dos campos opcionales) y `computeStack` (`src/viewer/stack.ts`):

- `optional?: boolean`: marca hijos de refinamiento opcional. Sus roles **no** se incluyen en `missing` (evita avisos «Falta MOS/SHR» en pozos sin `RXO`) y solo se activan si existen con al menos una muestra finita.
- `childrenMode?: 'fraction' | 'proportional'` (por defecto `'fraction'`): en modo `'proportional'`, las fracciones de los hijos se normalizan a su suma `f_j / Σf` para repartir el ancho del padre (`MOS / (MOS + SHR) = MOS / (1 − SW)` ⇒ ancho `PHIE · MOS`, y `SHR / (1 − SW)` ⇒ ancho `PHIE · (1 − SXO)`).
- `computeStack` pasa a soportar recursivamente profundidad arbitraria (`level: 0, 1, 2…`), manteniendo el orden de dibujo por nivel (`hydrocarbon` en nivel 1 debajo de `movable-hc` y `residual-hc` en nivel 2).
- Donde `RXO = NaN` (y por tanto `MOS`/`SHR = NaN`), los nietos quedan `NaN` en esa muestra y el padre `hydrocarbon` se dibuja entero sin huecos falsos; si hay muestras que caen al padre, `Hidrocarburo` permanece en la leyenda junto a `HC móvil` y `HC resid.` para que el color y la lectura del cursor sean siempre legibles.
- En pozos sin `RXO` (o con `MOS`/`SHR` completamente vacíos), `VOLUMETRIC_STACK` produce exactamente las mismas capas, leyenda y `missing` que antes.

## Límites científicos

- El método de cocientes supone igual porosidad y geometría de poro (`a, m, n`) en la zona lavada y la virgen, y asume que la arcillosidad afecta en forma proporcional a `Rxo` y `Rt` (en arenas muy arcillosas la aproximación se degrada).
- En lodos base aceite (`OBM`) o invasión con filtrado menos resistivo sin desplazamiento acuoso, la condición `SXO ≥ SW` no describe el proceso físico: el aviso de `SXO < SW` alerta al intérprete para no sobreinterpretar `MOS`.
- Cuando `RXO` proviene de `invasion-step`, solo existe donde el perfil escalonado está bien resuelto; en el resto del pozo las curvas de movilidad quedan `NaN` (honestidad de datos) y la pila volumétrica conserva el hidrocarburo total sin inventar partición.
- El cociente `Rmf / Rw` en la recta de agua depende levemente de la temperatura si el lodo y el agua tienen salinidades muy distintas; calibrarlo por zona acota ese desvío.

## Alternativas descartadas

- **Dejar `SXO` sin recortar a `[SW, 1]`:** produciría `MOS + SHR > 1 − SW` y violaría el cierre volumétrico de la porosidad en `VOLUMETRIC_STACK`. Se prefiere recortar a `[SW, 1]`, emitir un aviso explícito por zona con el porcentaje afectado y conservar `ratioMhi` / `archieSxo` sin recorte contra `SW` en el motor puro.
- **Crear una pista volumétrica separada en vez de extender `VOLUMETRIC_STACK`:** duplicaría ancho de visor y obligaría al usuario a mantener dos columnas de litología. El soporte jerárquico con `optional: true` resuelve el caso sin costo en pozos sin `RXO`.
- **Publicar una curva auxiliar `MOV_HC_FRAC` solo para la pila:** ensuciaría el catálogo de curvas del visor; el modo `'proportional'` en `stack.ts` es genérico y reutiliza directamente `MOS` y `SHR`.

## Referencias

- Asquith, G. y Krygowski, D. (2004). *Basic Well Log Analysis*, 2.ª ed. AAPG Methods in Exploration 16, cap. 6 (Ratio Method, `Sxo`, `MOS`, índice de movilidad `Sw/Sxo`).
- Schlumberger (1989). *Log Interpretation Principles/Applications*, cap. 8 (saturación en zona lavada, hidrocarburo móvil y residual).
- Archie, G. E. (1942). The electrical resistivity log as an aid in determining some reservoir characteristics. *Trans. AIME* 146.
