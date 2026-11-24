# Validación de la réplica del TP

## Referencias

El [PR #104](https://github.com/lgarciav1/interpretaci-n-pozo/pull/104) se incorporó en `d487a78`. La revisión de referencia del plan es `f8f6861b3c8b`. Ambos commits contienen los mismos datos para este recorrido. Los identificadores de los blobs permiten comprobar la versión de cada entrada con `git ls-files -s`.

| Entrada | Cobertura | Blob |
|---|---|---|
| `datos/pozo_tp_perfiles.csv` | 5.810 muestras de perfil, zonas A–E | `15d84fbeb34981626aac994a4ef902d3d183ca9c` |
| `src/modules/mdt/tpData.ts` | 58 pruebas MDT en B, C y D | `e3b90d50501f24c3b5d2bc441dceecdfa9e8d4f2` |
| `src/modules/core/tpData.ts` | 90 plugs de corona 1 y 61 de corona 2, con MD de la hoja PB | `0c9699856bc559e0c898cacfe3015e5cab6896b2` |
| `src/modules/swi-pc/tpScal.ts` | 8 muestras emparejadas entre las tablas SCAL | `41cae53d444ad9e0c241389633f80165d874f21e` |

El [caso reproducible](../../tests/tp-replica.test.ts) usa el importador de perfiles y el motor de la app. Los parámetros de A y B están en la [entrada de prueba](../../tests/fixtures/tp-replica.ts).

| Control | Resultado del control |
|---|---|
| A8, 7.633,2588 m MD | PHIE 0,191435715 y Archie recortado a 1. En la planilla se recorta a 0,999. |
| B608, 7.724,5464 m MD | VCL 0,09112, PHIE 0,205168148 y Sw 0,255091027, con AT90 y Rw fija de 0,020 Ω·m. Banderas de arena, reservorio y pay de 1 / 1 / 1. |
| MDT 3, 7.748,0831 m MD | Presión 19.149,09 psi y drawdown 66,59 psi. |
| Calidad de pozo en A | `IND_WASHOUT=1` a 7.646,0604 m MD (calibre 9,544 in y trépano 8,5 in) y `IND_WASHOUT=0` en A8 (calibre 9,033 in). |
| Agua de formación | 140.000 ppm de NaCl equivalente a 240 °F arrojan aproximadamente 0,01879 Ω·m. |

Los tests existentes conservan proyectos [v6](../../tests/fixtures/projects/v6.pozo.json) y [v7](../../tests/fixtures/archive/v7.pozo.json), y el [CSV MDT sin drawdown](../../tests/fixtures/mdt_es.csv). El [caso del modelo exponencial](../../tests/perm-core.test.ts) controla su evaluación y sus parámetros admitidos. La corrida inicial de los siete archivos de referencia pasó 162 pruebas.
