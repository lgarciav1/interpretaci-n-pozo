# 0029 — PE sospechoso (baritina) e inversión mineral sin PE

- Estado: implementada.
- Alcance: `src/petro/mineralogy.ts` (`detectSuspectPe`, opción `ignorePe` de la inversión) y el módulo
  `mineral-inversion` (parámetro «Uso del PE»). Corrige la entrada de la columna sedimentológica (decisión 0028).

## Contexto

En el pozo del TP el PE vale entre 5,4 y 9,5 b/e (percentiles 10 y 90) con densidad media de 2,44 g/cm³. Una
arenisca lee PE ≈ 1,8 y una arcilla entre 2 y 3,5; solo los carbonatos superan 5. Con esos datos la inversión de
cinco componentes devolvía 74–91 % de calcita en todas las zonas, y la columna sedimentológica salía 100 % caliza,
aunque el resto de los perfiles y la calibración del pozo de demo indican un pozo siliciclástico.

Un PE alto con densidad baja es la firma típica de baritina en el lodo o el revoque: la baritina tiene PE ≈ 267 b/e
(SLB 2013, Appendix B p. 279), así que muy poca cantidad infla el PE sin mover casi la densidad. No hay dato del
lodo en el archivo; falta confirmarlo con la cátedra.

## Decisión

1. **Detección.** `detectSuspectPe` cuenta la fracción de muestras válidas con PE > 4 b/e y ρb < 2,55 g/cm³. Si
   supera 0,5 el PE se considera sospechoso. Los tres umbrales son operativos (SIN VERIFICAR como norma). En el TP
   la fracción es 0,96.
2. **Inversión sin PE.** Con `ignorePe` la inversión usa ρb, φN y GR más el cierre, y resuelve cuatro componentes:
   cuarzo, calcita, arcilla y fluido. La dolomía se fija en 0, porque sin U no se separa de la mezcla
   cuarzo–calcita en densidad–neutrón (quedaría un sistema subdeterminado). Un PE ausente no invalida la muestra en
   este modo. El residuo fotoeléctrico se informa como NaN.
3. **Parámetro «Uso del PE»** en el módulo, con tres opciones: *Automático* (por defecto: ignora el PE si es
   sospechoso), *Usar siempre* e *Ignorar*. Cuando el PE es sospechoso se emite un aviso que dice qué se hizo.

## Resultado en el TP

Volúmenes medios por zona (cuarzo / calcita / dolomía / arcilla / φ):

| Zona | Con PE | Sin PE (automático) |
|---|---|---|
| A | 0,00 / 0,91 / 0,00 / 0,06 / 0,04 | 0,25 / 0,33 / 0,00 / 0,25 / 0,17 |
| B | 0,00 / 0,75 / 0,00 / 0,15 / 0,10 | 0,52 / 0,04 / 0,00 / 0,28 / 0,16 |
| C | 0,00 / 0,77 / 0,00 / 0,18 / 0,05 | 0,36 / 0,20 / 0,00 / 0,32 / 0,12 |
| D | 0,00 / 0,82 / 0,00 / 0,11 / 0,07 | 0,53 / 0,08 / 0,00 / 0,25 / 0,14 |
| E | 0,00 / 0,74 / 0,00 / 0,19 / 0,06 | 0,46 / 0,13 / 0,00 / 0,30 / 0,12 |

La zona A conserva algo de calcita también sin PE; puede ser real (cemento carbonático) o efecto de los extremos de
arcilla y neutrón, que se calibran desde el módulo.

## Alternativas descartadas

- **Corregir el PE por baritina** (restar un aporte del lodo): requiere el peso y la composición del lodo y el
  diámetro del pozo, que no están en los datos.
- **Bajar el peso del PE**: con el PE desplazado varios b/e, cualquier peso positivo sigue empujando hacia calcita.
