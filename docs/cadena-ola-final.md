# Cadena Ola Final — Protocolo para Sesiones con Orchestrator (Neon)

Este documento rige la ejecución encadenada de [`docs/masterplan-ola-final.md`](masterplan-ola-final.md) en Antigravity usando **`gemini-pro-orchestrator-neon` (Orchestrator Neon)** como orquestador de cada sesión, cumpliendo estrictamente [`CLAUDE.md`](../CLAUDE.md) y [`AGENTS.md`](../AGENTS.md) con **máxima economía de tokens**.

---

## 1. Cola y protocolo de relevo en el pizarrón (costo 0 en espera)

Todas las sesiones comparten el repositorio local `C:\Users\Usuario\.gemini\antigravity\scratch\interpretaci-n-pozo`. **Nunca pueden correr dos sesiones a la vez sobre el mismo árbol Git ni ejecutar Vitest/Playwright simultáneamente.**

| Orden | Worker del Swarm | ID | Función | Despierta al terminar a |
|---|---|---|---|---|
| 1 | `g01-regla-pay` | G01 | Regla viva de Pay al medir un intervalo | `@g02-lazo-accion` |
| 2 | `g02-lazo-accion` | G02 | Del Lazo a la Acción (exclusión QC y bandera) | `@g03-smlp-lorenz` |
| 3 | `g03-smlp-lorenz` | G03 | Unidades hidráulicas interactivas en SMLP | `@g04-carta-mid` |
| 4 | `g04-carta-mid` | G04 | Carta MID (`ρ_maa` vs. `Δt_maa`) sin PE | `@g05-mdt-exceso` |
| 5 | `g05-mdt-exceso` | G05 | Exceso de presión y EMW en MDT | `@g06-cgr-espectral` |
| 6 | `g06-cgr-espectral` | G06 | Rayos Gamma sin Uranio (`CGR`) → `IGR` | `@g07-movilidad-sxo` |
| 7 | `g07-movilidad-sxo` | G07 | Hidrocarburo Móvil vs. Residual (`Sxo`, `MOS`) | `@g08-coherencia` |
| 8 | `g08-coherencia` | G08 | Panel de Coherencia Cruzada entre Herramientas | `@coordinator` (cierre final) |

### Regla de guardia al despertar
1. Si tu brief inicial dice `MODO EN ESPERA` y todavía **no** recibiste en el pizarrón un mensaje explícito `@<tu-nombre> ADELANTE`, **NO llames a ninguna herramienta** (`read_file`, `run_command`, etc.): respondé en una sola oración (`«Listo en espera de @<tu-nombre> ADELANTE.»`) y terminá tu turno inmediatamente. En estado `waiting` consumís **0 tokens**.
2. Cuando recibas `@<tu-nombre> ADELANTE`, verificá primero en `docs/masterplan-ola-final.md` (líneas 28–42) que tu función siga `pendiente`. Si ya estuviera `hecha`, pasá la posta al siguiente sin repetir trabajo.

---

## 2. Reglas duras de optimización de tokens

1. **Lectura quirúrgica (prohibido leer archivos enteros largos sin necesidad):**
   - Leé `CLAUDE.md` (75 líneas) y **solo las líneas de tu ficha** en `docs/masterplan-ola-final.md` usando `StartLine` y `EndLine`:
     - `G01`: líneas 49–58 · `G02`: 61–71 · `G03`: 74–85 · `G04`: 88–96 · `G05`: 99–109 · `G06`: 112–123 · `G07`: 126–140 · `G08`: 143–155.
   - **No leas `docs/arquitectura.md` entero** (supera 1.000 líneas). Cada ficha ya incluye su **Mapa confirmado en código**.
2. **Entorno Windows ya resuelto (0 intentos fallidos de consola):**
   - Directorio del repo: `C:\Users\Usuario\.gemini\antigravity\scratch\interpretaci-n-pozo`.
   - En cada `run_command` que use Node/npm/npx, anteponé exactamente:
     ```powershell
     Set-Location "C:\Users\Usuario\.gemini\antigravity\scratch\interpretaci-n-pozo"
     $env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:PATH"
     ```
   - Usá siempre **`npm.cmd`** y **`npx.cmd`** (nunca `npm` ni `npx` a secas, porque PowerShell bloquea `.ps1` por ExecutionPolicy).
3. **Uso eficiente de subagentes (`define_subagent` + `invoke_subagent`):**
   - Antes de cada lanzamiento escribí en español: `tarea → rol (modelo) → motivo`.
   - **Tareas mecánicas y corridas de verificación (`typecheck`, suite `test`, `build`, capturas)** → delegá en un subagente rol `explorador` con **`Model: "flash_lite"`** (siguiendo `.claude/agents/explorador.md`: devuelve solo cifras, estado y errores textuales, evitando volcar cientos de líneas de logs en la ventana de Neon).
   - **Redacción auxiliar o fixtures simples** → rol `investigador` con **`Model: "flash"`**.
   - **Autoría de código:**
     - En funciones **C** o **M** acotadas (`G01`–`G05`, `G08`), el propio orquestador Neon puede escribir directamente tras leer los pocos archivos del alcance (evitando duplicar todo el contexto en otro subagente pesado), **o** delegar en un único subagente del rol indicado (`Model: "inherit"`).
     - En funciones con motor numérico extenso o tamaño **G** (`G06`, `G07`), delegá el motor puro a `analista-numerico` (`Model: "inherit"`) con un brief autocontenido y exacto.
   - **Revisión independiente obligatoria (`AGENTS.md` § «Brief y revisión independiente»):**
     - Siempre la ejecuta **un subagente nuevo y distinto del autor** (`Model: "inherit"`, `EnableWriteTools: false` o modo solo lectura/cálculo), que **no** vio el razonamiento interno del autor.
     - Si hay petrofísica (`src/petro/`), el revisor debe recalcular los casos de prueba de forma independiente y revisar bordes (`NaN`, unidades, ceros, límites físicos, inmutabilidad de originales).
     - Resolvé todo hallazgo real y hacé que el mismo revisor (`send_message` a su `conversationId`) compruebe el arreglo.
4. **Tests focalizados durante la iteración:**
   - Mientras desarrollás, corré solo el archivo de test afectado: `npx.cmd vitest run tests/<tu-test>.test.ts`.
   - Ejecutá la suite completa (`npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`) **una única vez al cierre** (y una más solo si hubo que corregir algo tras la revisión o rebase).

---

## 3. Pasos exactos de cada sesión

1. **Preparar rama limpia:**
   - Verificá `git status -s` vacío, hacé `git checkout main`, `git pull --ff-only` y creá tu rama `git checkout -b feat/<id>-<slug>` (p. ej. `feat/g01-regla-viva-pay`).
   - Confirmá autor: `git config user.name "Lucas"` y `git config user.email "lgarciav@fi.uba.ar"`.
2. **ADR antes del código (cuando la ficha dice `ADR: sí`):**
   - Listá `docs/decisiones/` para tomar el próximo número libre (`0088`, `0089`…) y escribí una decisión concisa con contexto, decisión, límites científicos y alternativas descartadas.
3. **Implementación + tests puros:**
   - Respetá estrictamente el sistema de diseño (`src/ui/`), identificadores en inglés, textos de UI/commits/PR en español y ecuaciones exclusivamente en `docs` del módulo.
4. **Revisión independiente y corrección:**
   - Lanzá el subagente revisor independiente, corregí cualquier bug/regresión/violación de contrato y re-verificá con ese mismo revisor.
5. **Verificación de cierre y capturas (nunca en paralelo con Vitest):**
   - Ejecutá secuencialmente `npm.cmd run typecheck`, `npm.cmd test` y `npm.cmd run build` (verifica el HTML único `dist/index.html`).
   - Generá capturas `1366 × 768` en tema claro y oscuro en `docs/capturas/<id>/` sirviendo `dist/index.html` localmente con red deshabilitada tras cargar. Si Chromium administrado bloquea `file://` (`ERR_BLOCKED_BY_ADMINISTRATOR`), dejalo registrado honestamente en el PR sin declarar aprobada la apertura por doble clic (`AGENTS.md` línea 57).
6. **Actualizar documentación, PR y squash merge:**
   - Marcá tu fila en `docs/masterplan-ola-final.md` como `hecha` (con enlace al ADR si hubo) y actualizá `docs/arquitectura.md` brevemente al final solo si agregaste un módulo o contrato nuevo.
   - Commiteá en español, hacé `git push -u origin HEAD`, creá el PR con `gh pr create` (título y cuerpo en español detallando cambios, verificaciones y límites) y, con todo en verde, integralo con `gh pr merge --squash --delete-branch --subject "<Función> (<ID>) (#<n>)"` (o `--auto` / merge directo).
   - **Dejá el workspace limpio en `main` actualizado** antes de pasar la posta:
     `git checkout main && git pull --ff-only && git status -s` (debe quedar limpio para el siguiente eslabón).
7. **Pase de posta en el pizarrón:**
   - Publicá un mensaje breve mencionando al siguiente worker de la tabla:
     `@<siguiente-worker> ADELANTE — <ID> integrada en main (<sha>, PR #<n>).`
   - No menciones a `@coordinator` en los pasos intermedios (así no despertás innecesariamente al coordinador); solo **`g08-coherencia`** al terminar toda la cola (o cualquier sesión si debe frenar por bloqueo real) menciona a `@coordinator`.

---

## 4. Cuándo frenar sin mergear ni pasar la posta

Frená, dejá el PR en borrador (o la rama subida sin mergear), volvé `git checkout main` limpio para no dejar el árbol roto y avisá a `@coordinator` si:
- falla una verificación obligatoria y no podés resolverla sin relajar tests ni umbrales;
- queda un bug científico o de contrato abierto tras la revisión;
- aparece un conflicto en `main` que afecta otra función y requiere criterio de la usuaria.
