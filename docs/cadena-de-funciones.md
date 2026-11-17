# Cadena de funciones: cómo trabaja cada sesión

Este archivo lo lee cada sesión de la cadena que ejecuta `docs/masterplan-funciones-nuevas.md` hasta la línea de corte.
La usuaria decidió (2026-11-17):
- cada sesión hace **una** función;
- cada sesión mergea su propio PR cuando todo pasa;
- cuando termina, la sesión lanza la siguiente de la cola.

## Cola

En orden. La configuración es la que sugiere la sección 4 del masterplan.

| # | Función | Modelo · esfuerzo de la sesión |
|---|---|---|
| 1 | F02 — Avisos agrupados y navegables | Opus · medio |
| 2 | F08 — Estado «revisado» por paso | Opus · medio |
| 3 | F16 — Resistividad mojada (R0) en la pista | Opus · medio |
| 4 | F25 — Copiar contexto para un chat | Opus · medio |
| 5 | F19 — Cronómetro del recorrido | Opus · medio |
| 6 | F03 — «¿De dónde sale este número?» | Opus · alto |
| 7 | F04 — Capas de pay y punzados sugeridos | Opus · medio |
| 8 | F07 — Vistas guardadas y modo defensa | Opus · alto |
| 9 | F05 — Notas ancladas a profundidad | Opus · medio |
| 10 | F20 — Reparar la densidad en los derrumbes | Opus · medio |

F20 es la última. Esa sesión no lanza otra y escribe el resumen final (paso 7).

## Pasos de cada sesión

1. **Contexto.** Leé:
   - `CLAUDE.md`;
   - la sección 2 del masterplan (reglas de ejecución) y la ficha de tu función: la ficha es el alcance;
   - `docs/arquitectura.md`, lo que toque.

   Confirmá en el código los archivos que nombra la ficha antes de decidir. Mirá la tabla del masterplan: si tu función
   ya figura «hecha», no la repitas, saltá a la siguiente de la cola.
2. **Rama.** Usá la rama de la sesión, creada desde `main` actualizado. Configurá el autor antes del primer commit:
   `git config user.name "Lucas"` y `git config user.email "lgarciav@fi.uba.ar"`.
3. **Decisión antes que código**, si la ficha pide decidir algo: un archivo en `docs/decisiones/` con el próximo número
   libre. Verificá cuál es con `ls`; F01 usó el 0071.
4. **Implementación y revisión.** Seguí la orquestación de `CLAUDE.md`:
   - pocos subagentes;
   - antes de lanzar cada uno, una línea «tarea → subagente → motivo»;
   - el subagente que escribe es el que nombra la ficha;
   - la revisión la hace uno distinto. Corregí lo que encuentre y hacé que verifique los arreglos.

   Commiteá y subí a medida que la app queda funcionando, nunca a medio hacer.
5. **Terminado cuando:**
   - se cumple el «Terminado cuando» de la ficha;
   - pasan `npm run typecheck`, `npm test` y `npm run build`, y el HTML único sigue abriendo sin internet;
   - hay capturas en `docs/capturas/<función>/` a 1366 × 768, claro y oscuro (Chromium de Playwright);
   - la fila de la función en la tabla del masterplan dice «hecha», con enlace a su decisión si la hay;
   - `docs/arquitectura.md` está actualizado si cambió un contrato.
6. **PR y merge.** Abrí el PR contra `main` (título y descripción en español: qué cambia, qué se verificó, qué no se
   pudo probar). Si `main` avanzó, actualizá la rama y volvé a correr las verificaciones. Mergeá con *squash* y título
   `<Función> (<ID>) (#<n>)`.
7. **Siguiente sesión.** Lanzá la función siguiente de la cola con `create_session` (herramienta `claude-code-remote`):
   - repositorio: `https://github.com/lgarciav1/interpretaci-n-pozo`;
   - modelo y esfuerzo: los de la tabla;
   - título: «<ID> — <nombre>»;
   - prompt: «Sos la sesión de la cadena para <ID> — <nombre>. Seguí `docs/cadena-de-funciones.md` al pie de la letra.».

   Después terminá con un resumen corto para la usuaria: qué quedó hecho, qué se verificó, qué no, el enlace al PR y
   qué sesión lanzaste. La última sesión de la cola agrega un resumen de toda la cadena (funciones hechas, PRs, lo que
   quedó sin probar).

## Cuándo parar (sin mergear ni lanzar la siguiente)

Pará y explicale a la usuaria qué pasó, sin recortar el alcance por tu cuenta, si:
- la ficha resulta inviable o mucho más grande de lo previsto;
- una verificación no pasa y no lo podés resolver;
- la revisión deja un bug sin resolver;
- el merge tiene conflictos que tocan otra función;
- falla `create_session`.

La usuaria retoma la cadena cuando lo resuelva.
