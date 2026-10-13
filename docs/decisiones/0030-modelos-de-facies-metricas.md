# 0030 — Métricas de entrenamiento y validación (generado por tools/ml/train.mjs)

Salida cruda del script de entrenamiento, con la configuración por defecto (48 árboles, muestra de 120 000 filas por
árbol, profundidad 16, hoja mínima 60, 64 bins, 3 clases por hoja, class-power 0,25, pesos de confianza 1/0,5/0,25,
semilla 20201). La validación usa exactamente la configuración del modelo final. Tres comandos (ver `src/ml/README.md`):
`--final --eval-csv hidden_test.csv`, y `--cv random,blocks,lowo` una vez por variante. La interpretación está en
`0030-modelos-de-facies.md`.

## A. Modelos finales y evaluación externa

### Modelos finales (árboles 48, muestra/árbol 120000, profundidad 16, hoja mínima 60, bins 64, semilla 20201)

- **withPe** (GR, RHOB, NPHI, PEF, DTC, LOG_RDEP): entrenamiento 9 s; binario 838 KB; texto embebido (zlib+base64) 448 KB; 122254 nodos, 61151 hojas; inferencia de 5810 muestras 67 ms.
  Importancia MDI: GR 0.319, RHOB 0.154, NPHI 0.159, PEF 0.081, DTC 0.168, LOG_RDEP 0.119.
  Importancia por permutación en 14 pozos retenidos (41780 muestras; métrica f1Macro, línea base 0.294; positivo = la curva ayuda; caída de F1 macro): GR 0.083 ± 0.001, RHOB 0.081 ± 0.003, NPHI 0.060 ± 0.003, PEF 0.012 ± 0.003, DTC 0.024 ± 0.005, LOG_RDEP 0.045 ± 0.002.
  Importancia por permutación en 14 pozos retenidos (41780 muestras; métrica penalty, línea base 0.899; positivo = la curva ayuda; caída = aumento de la penalización): GR 0.312 ± 0.004, RHOB 0.102 ± 0.001, NPHI 0.163 ± 0.002, PEF -0.002 ± 0.003, DTC -0.001 ± 0.002, LOG_RDEP 0.006 ± 0.002.
- **noPe** (GR, RHOB, NPHI, DTC, LOG_RDEP): entrenamiento 8 s; binario 837 KB; texto embebido (zlib+base64) 443 KB; 122050 nodos, 61049 hojas; inferencia de 5810 muestras 49 ms.
  Importancia MDI: GR 0.334, RHOB 0.171, NPHI 0.183, DTC 0.179, LOG_RDEP 0.134.
  Importancia por permutación en 14 pozos retenidos (41780 muestras; métrica f1Macro, línea base 0.271; positivo = la curva ayuda; caída de F1 macro): GR 0.067 ± 0.004, RHOB 0.076 ± 0.002, NPHI 0.045 ± 0.003, DTC 0.026 ± 0.002, LOG_RDEP 0.040 ± 0.001.
  Importancia por permutación en 14 pozos retenidos (41780 muestras; métrica penalty, línea base 0.903; positivo = la curva ayuda; caída = aumento de la penalización): GR 0.283 ± 0.005, RHOB 0.118 ± 0.002, NPHI 0.181 ± 0.001, DTC 0.022 ± 0.001, LOG_RDEP 0.028 ± 0.004.

### Evaluación externa: test oculto de FORCE 2020 (122397 muestras, 10 pozos que no están en train.csv)

| Variante | Exactitud | F1 macro | Penalización FORCE (puntuación = −penalización) | Exactitud (confianza 1) | Penalización (confianza 1) |
|---|---|---|---|---|---|
| withPe | 0.754 | 0.448 | 0.650 | 0.793 | 0.553 |
| noPe | 0.746 | 0.435 | 0.672 | 0.782 | 0.584 |

## B. Validación cruzada, variante sin PE

### Validación cruzada (árboles 48, muestra/árbol 120000, profundidad 16, hoja mínima 60, class-power 0.25)
Bloques de 200 m, buffer 30 m, 5 folds; leave-one-well-out con 1 pozo(s) por fold.

#### random · noPe (5 folds, 44 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.769 | 0.769 ± 0.002 | 0.797 |
| F1 macro | 0.527 | 0.527 ± 0.004 | 0.539 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.613 | 0.613 ± 0.005 | 0.539 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.711 | 0.716 | 0.713 |
| Arenisca/Lutita | 150455 | 0.506 | 0.371 | 0.428 |
| Lutita | 720803 | 0.831 | 0.921 | 0.874 |
| Marga | 33329 | 0.496 | 0.354 | 0.413 |
| Dolomía | 1688 | 0.333 | 0.001 | 0.001 |
| Caliza | 56320 | 0.659 | 0.562 | 0.607 |
| Creta | 10513 | 0.773 | 0.477 | 0.590 |
| Halita | 8213 | 0.960 | 0.993 | 0.976 |
| Anhidrita | 1085 | 0.711 | 0.806 | 0.755 |
| Toba | 15245 | 0.876 | 0.067 | 0.124 |
| Carbón | 3820 | 0.675 | 0.441 | 0.533 |
| Basamento | 103 | 0.240 | 0.427 | 0.308 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 120971  13687  27093   1307      0   5021    272     77    200     10    212     87
  20475  55783  71033   1765      0   1223     30      2     20     38     79      7
  16083  31255 663611   5846      0   3237     31    191     15     33    493      8
   2207   3776  12644  11783      0   2726    174      0      0      3      4     12
    316    175    867     64      1    232      8      3     17      1      1      3
   6422   3353  10944   2852      2  31637    944      6     76     58     20      6
   1365     52    278     25      0   3779   5012      1      0      1      0      0
     29      0      6      0      0      4      0   8152     21      0      1      0
     65     11     12      2      0     65      2     38    874      0      0     16
   1596   2060  10459     91      0     17      3      0      0   1019      0      0
    642    110   1327     10      0     22      4     22      0      0   1683      0
     17      2     14      0      0     20      0      0      6      0      0     44
```

#### blocks · noPe (5 folds, 44 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.729 | 0.729 ± 0.015 | 0.756 |
| F1 macro | 0.417 | 0.426 ± 0.027 | 0.426 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.722 | 0.722 ± 0.046 | 0.648 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.641 | 0.674 | 0.657 |
| Arenisca/Lutita | 150455 | 0.395 | 0.275 | 0.324 |
| Lutita | 720803 | 0.809 | 0.902 | 0.853 |
| Marga | 33329 | 0.352 | 0.235 | 0.282 |
| Dolomía | 1688 | 0.000 | 0.000 | 0.000 |
| Caliza | 56320 | 0.614 | 0.491 | 0.545 |
| Creta | 10513 | 0.353 | 0.179 | 0.238 |
| Halita | 8213 | 0.968 | 0.992 | 0.980 |
| Anhidrita | 1085 | 0.737 | 0.628 | 0.678 |
| Toba | 15245 | 0.539 | 0.007 | 0.013 |
| Carbón | 3820 | 0.502 | 0.373 | 0.428 |
| Basamento | 103 | 0.000 | 0.000 | 0.000 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 113825  14002  33486   1434      0   5143    520     61    152     23    282      9
  24073  41307  80247   3183      0   1432     43      2      4     30    132      2
  20458  39692 650057   6828      0   2602     44    137     12      7    961      5
   3173   3833  15041   7820      0   3365     92      0      0      0      2      3
    288    168    886     53      0    270      7      2      9      1      1      3
   8869   3146  11190   2778      0  27634   2594      3     44     25     33      4
   3525    242    460     14      0   4384   1885      0      0      3      0      0
     43      0      7      0      0      2      0   8147     12      0      2      0
    122      6     14      6      0     56    141     52    681      0      0      7
   2399   2040  10615     62      0     15     10      0      0    104      0      0
    848    168   1264      9      0     89      8      9      0      0   1425      0
     55      0     15      0      0     23      0      0     10      0      0      0
```

#### lowo · noPe (98 folds, 796 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.676 | 0.680 ± 0.146 | 0.707 |
| F1 macro | 0.352 | 0.356 ± 0.099 | 0.391 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.869 | 0.850 ± 0.398 | 0.785 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.577 | 0.656 | 0.614 |
| Arenisca/Lutita | 150455 | 0.228 | 0.154 | 0.184 |
| Lutita | 720803 | 0.782 | 0.857 | 0.818 |
| Marga | 33329 | 0.248 | 0.174 | 0.204 |
| Dolomía | 1688 | 0.000 | 0.000 | 0.000 |
| Caliza | 56320 | 0.539 | 0.477 | 0.506 |
| Creta | 10513 | 0.142 | 0.070 | 0.094 |
| Halita | 8213 | 0.963 | 0.448 | 0.611 |
| Anhidrita | 1085 | 0.710 | 0.716 | 0.713 |
| Toba | 15245 | 0.755 | 0.027 | 0.051 |
| Carbón | 3820 | 0.506 | 0.366 | 0.424 |
| Basamento | 103 | 0.000 | 0.000 | 0.000 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 110865  12177  37094   1305      0   5478   1441     59    205     33    259     21
  26100  23138  94887   4630      0   1470     53      0      4     52    119      2
  33218  56876 617977   8742      0   2645    347     10     28     11    946      3
   3539   3948  16479   5790      0   3387    180      0      0      0      4      2
    334    170    858     57      0    250      4      1      9      1      2      2
  10238   3072  10763   2768      0  26888   2428     19     67     33     28     16
   3718     62    531     16      0   5438    741      2      0      2      3      0
    391      0      2      0      0   4132      3   3677      4      0      4      0
    155      8     15      5      0     78      7     40    777      0      0      0
   2578   2093  10104     45      0     15      4      0      0    406      0      0
    838    154   1320      4      0     78     19     10      0      0   1397      0
     60      5     15      0      0     23      0      0      0      0      0      0
```

## C. Validación cruzada, variante con PE

### Validación cruzada (árboles 48, muestra/árbol 120000, profundidad 16, hoja mínima 60, class-power 0.25)
Bloques de 200 m, buffer 30 m, 5 folds; leave-one-well-out con 1 pozo(s) por fold.

#### random · withPe (5 folds, 46 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.783 | 0.783 ± 0.001 | 0.811 |
| F1 macro | 0.548 | 0.548 ± 0.004 | 0.567 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.577 | 0.577 ± 0.004 | 0.503 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.727 | 0.742 | 0.734 |
| Arenisca/Lutita | 150455 | 0.538 | 0.389 | 0.452 |
| Lutita | 720803 | 0.837 | 0.928 | 0.880 |
| Marga | 33329 | 0.546 | 0.383 | 0.450 |
| Dolomía | 1688 | 0.333 | 0.001 | 0.001 |
| Caliza | 56320 | 0.701 | 0.584 | 0.637 |
| Creta | 10513 | 0.843 | 0.584 | 0.690 |
| Halita | 8213 | 0.963 | 0.992 | 0.978 |
| Anhidrita | 1085 | 0.715 | 0.815 | 0.761 |
| Toba | 15245 | 0.943 | 0.049 | 0.093 |
| Carbón | 3820 | 0.715 | 0.447 | 0.550 |
| Basamento | 103 | 0.281 | 0.466 | 0.350 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 125324  13410  24045   1023      0   4261    311     75    198      1    228     61
  19348  58515  70023   1403      0    984     68      1     23      8     73      9
  14776  28204 668743   5453      2   2969     77    171     24     10    361     13
   2228   3421  11758  12775      0   2975    152      0      3      3      3     11
    380    130    871     58      1    199     22      2     21      1      0      3
   5934   3348  10914   2616      0  32907    491      5     58     22     13     12
   1410     35    326     24      0   2577   6141      0      0      0      0      0
     30      0      8      0      0      1      0   8151     22      0      1      0
     67     14     13      1      0     51      3     38    884      0      0     14
   2248   1511  10669     52      0      8     12      0      0    745      0      0
    601    112   1351     11      0     16      4     18      0      0   1707      0
     18      1     14      0      0     18      0      0      4      0      0     48
```

#### blocks · withPe (5 folds, 46 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.741 | 0.741 ± 0.016 | 0.769 |
| F1 macro | 0.433 | 0.440 ± 0.028 | 0.444 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.691 | 0.691 ± 0.050 | 0.616 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.656 | 0.699 | 0.677 |
| Arenisca/Lutita | 150455 | 0.424 | 0.288 | 0.343 |
| Lutita | 720803 | 0.813 | 0.911 | 0.859 |
| Marga | 33329 | 0.402 | 0.238 | 0.299 |
| Dolomía | 1688 | 1.000 | 0.001 | 0.001 |
| Caliza | 56320 | 0.662 | 0.509 | 0.576 |
| Creta | 10513 | 0.468 | 0.239 | 0.316 |
| Halita | 8213 | 0.974 | 0.989 | 0.981 |
| Anhidrita | 1085 | 0.731 | 0.635 | 0.680 |
| Toba | 15245 | 0.594 | 0.006 | 0.012 |
| Carbón | 3820 | 0.578 | 0.374 | 0.454 |
| Basamento | 103 | 0.000 | 0.000 | 0.000 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 118048  13121  31617   1174      0   4051    556     16    143     21    171     19
  22526  43387  80080   2997      0   1255     76      2     11     18     97      6
  19135  36751 656342   5101      0   2476     50    147     13     21    755     12
   3246   3811  14765   7943      0   3379    167      0      3      0      5     10
    414    140    907     26      1    167      6      0     17      0      1      9
   8875   3139  11267   2422      0  28693   1845      2     30      5     13     29
   3708    491    548      7      0   3245   2510      0      4      0      0      0
     61      0      8      0      0      3      1   8123     16      0      1      0
    121     17     14      4      0     44    139     47    689      0      0     10
   3012   1203  10867     53      0     11      4      0      0     95      0      0
    843    165   1350      9      0     16      4      4      0      0   1429      0
     37     12     16      0      0     22      0      0     16      0      0      0
```

#### lowo · withPe (98 folds, 829 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.681 | 0.686 ± 0.143 | 0.712 |
| F1 macro | 0.359 | 0.354 ± 0.100 | 0.405 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.860 | 0.842 ± 0.396 | 0.775 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.576 | 0.676 | 0.622 |
| Arenisca/Lutita | 150455 | 0.228 | 0.151 | 0.181 |
| Lutita | 720803 | 0.784 | 0.862 | 0.821 |
| Marga | 33329 | 0.237 | 0.148 | 0.182 |
| Dolomía | 1688 | 0.000 | 0.000 | 0.000 |
| Caliza | 56320 | 0.576 | 0.482 | 0.525 |
| Creta | 10513 | 0.311 | 0.141 | 0.194 |
| Halita | 8213 | 0.961 | 0.450 | 0.613 |
| Anhidrita | 1085 | 0.734 | 0.709 | 0.721 |
| Toba | 15245 | 0.926 | 0.011 | 0.021 |
| Carbón | 3820 | 0.514 | 0.371 | 0.431 |
| Basamento | 103 | 0.000 | 0.000 | 0.000 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 114203  12500  35222   1157      0   4294    845     59    206      2    374     75
  25624  22648  95889   4828      0   1273     71      0      9      1    102     10
  33565  54001 621155   7523      0   3499    170     11     15      2    845     17
   4047   4752  16034   4941      0   3355    188      0      0      0      2     10
    449    130    863     34      0    187      9      1      7      0      1      7
  10593   3458  10723   2348      0  27141   1962     30     38      8     15      4
   4892    233    595     11      0   3301   1479      2      0      0      0      0
    526      0      4      0      0   3978      4   3694      4      0      3      0
    154     13     14      5      0     79      6     41    769      0      0      4
   3247   1494  10291     33      0     12      6      0      0    162      0      0
    876    159   1325      8      0     20      9      6      0      0   1417      0
     64     12     16      0      0     11      0      0      0      0      0      0
```
