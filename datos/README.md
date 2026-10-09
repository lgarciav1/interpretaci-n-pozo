# Datos del pozo del TP

`pozo_tp_perfiles.csv` contiene solo los perfiles medidos del pozo, extraídos de la hoja **Datos** de `TP_interpretacion_de_Pozo.xlsx`. No incluye ninguna curva interpretada.

- 5.810 muestras, de 7633,26 a 8518,55 m, cada 0,1524 m (medio pie).
- Separador: coma. Decimal: punto. Celda vacía = sin dato.

## Curvas

| Columna | Unidad | Descripción |
| --- | --- | --- |
| DEPTH | m | Profundidad |
| ZONA | — | Zonas A–E definidas en el Excel de la cátedra |
| BS | in | Diámetro de trépano (constante 8,5 in) |
| CAL | in | Caliper |
| GR | gAPI | Rayos gamma |
| SP | mV | Potencial espontáneo (solo 12 muestras con dato) |
| ZDEN | g/cm³ | Densidad volumétrica (RHOB) |
| PE | b/e | Factor fotoeléctrico |
| DT | µs/ft | Sónico compresional (70 muestras sin dato) |
| NPHI | v/v | Porosidad neutrónica |
| AT10, AT30, AT60, AT90 | ohm·m | Inducción de arreglo, 10 a 90 pulgadas de investigación (AT90 = Rt) |
| URAN | ppm | Uranio (GR espectral) |
| THOR | ppm | Torio (GR espectral) |
| POTA | % | Potasio (GR espectral) |
| PHI_BVI, PHIE_CMR, PHIT_CMR | v/v | Salidas de la herramienta de resonancia magnética (CMR) |

## Zonas

| Zona | Desde (m) | Hasta (m) |
| --- | --- | --- |
| A | 7633,26 | 7724,39 |
| B | 7724,55 | 7906,05 |
| C | 7906,21 | 7969,91 |
| D | 7970,06 | 8246,97 |
| E | 8247,13 | 8518,55 |

## Qué se dejó afuera

- **Curvas interpretadas:** VCL y parámetros de arcilla, DPHI, SPHI, N-D, VCLGR, PHIE, Sw (Archie, Simandoux), permeabilidad, espesores y columnas auxiliares.
- **ZDEN_sst y NPHI_sst:** son puntos de la línea de arenisca para el crossplot, no perfiles.
- **Bloque "zona F" (399 filas al final de la hoja):** es una copia de parte de la zona D, ordenada por GR y con las columnas corridas un lugar (por ejemplo, el DT aparece en la columna de SP). Usarlo duplicaría datos con valores mal asignados.

## Problemas de calidad detectados

Sirven como caso de prueba para el módulo de control de calidad:

- **CAL:** 189 muestras por debajo de 5 in, con un valor constante de 1,098 in. Es una lectura inválida, porque el trépano mide 8,5 in.
- **NPHI:** picos de hasta 3,3 v/v, que es físicamente imposible.
- **AT10:** valores aislados de hasta 110 ohm·m, cuando el percentil 99 es 6,7.
- **SP:** prácticamente no hay datos, así que Rw no se puede calcular desde SP.
