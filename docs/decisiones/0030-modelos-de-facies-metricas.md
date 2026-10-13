# 0030 — Métricas de entrenamiento y validación (generado por tools/ml/train.mjs)

Salida cruda del script de entrenamiento, con la configuración por defecto (48 árboles, muestra de 120 000 filas por
árbol, profundidad 16, hoja mínima 60, 64 bins, 6 clases por hoja más resto repartido, class-power 0,25, pesos de confianza 1/0,5/0,25,
semilla 20201). La validación usa exactamente la configuración del modelo final. Tres comandos (ver `src/ml/README.md`):
`--final --eval-csv hidden_test.csv`, y `--cv random,blocks,lowo` una vez por variante. La interpretación está en
`0030-modelos-de-facies.md`.

## A. Modelos finales y evaluación externa

### Modelos finales (árboles 48, muestra/árbol 120000, profundidad 16, hoja mínima 60, bins 64, semilla 20201)

- **withPe** (GR, RHOB, NPHI, PEF, DTC, LOG_RDEP): entrenamiento 10 s; binario 1197 KB; texto embebido (zlib+base64) 662 KB; 122254 nodos, 61151 hojas; inferencia de 5810 muestras 105 ms.
  Importancia MDI: GR 0.319, RHOB 0.154, NPHI 0.159, PEF 0.081, DTC 0.168, LOG_RDEP 0.119.
  Importancia por permutación en 14 pozos retenidos (41780 muestras; métrica f1Macro, línea base 0.295; positivo = la curva ayuda; caída de F1 macro): GR 0.082 ± 0.001, RHOB 0.081 ± 0.003, NPHI 0.059 ± 0.004, PEF 0.012 ± 0.002, DTC 0.025 ± 0.005, LOG_RDEP 0.045 ± 0.002.
  Importancia por permutación en 14 pozos retenidos (41780 muestras; métrica penalty, línea base 0.896; positivo = la curva ayuda; caída = aumento de la penalización): GR 0.312 ± 0.004, RHOB 0.109 ± 0.001, NPHI 0.166 ± 0.002, PEF 0.001 ± 0.002, DTC 0.002 ± 0.003, LOG_RDEP 0.009 ± 0.002.
- **noPe** (GR, RHOB, NPHI, DTC, LOG_RDEP): entrenamiento 8 s; binario 1194 KB; texto embebido (zlib+base64) 662 KB; 122050 nodos, 61049 hojas; inferencia de 5810 muestras 63 ms.
  Importancia MDI: GR 0.334, RHOB 0.171, NPHI 0.183, DTC 0.179, LOG_RDEP 0.134.
  Importancia por permutación en 14 pozos retenidos (41780 muestras; métrica f1Macro, línea base 0.272; positivo = la curva ayuda; caída de F1 macro): GR 0.066 ± 0.005, RHOB 0.076 ± 0.002, NPHI 0.044 ± 0.003, DTC 0.028 ± 0.002, LOG_RDEP 0.041 ± 0.001.
  Importancia por permutación en 14 pozos retenidos (41780 muestras; métrica penalty, línea base 0.902; positivo = la curva ayuda; caída = aumento de la penalización): GR 0.285 ± 0.005, RHOB 0.119 ± 0.001, NPHI 0.181 ± 0.001, DTC 0.025 ± 0.001, LOG_RDEP 0.030 ± 0.004.

### Evaluación externa: test oculto de FORCE 2020 (122397 muestras, 10 pozos que no están en train.csv)

| Variante | Exactitud | F1 macro | Penalización FORCE (puntuación = −penalización) | Exactitud (confianza 1) | Penalización (confianza 1) |
|---|---|---|---|---|---|
| withPe | 0.754 | 0.449 | 0.651 | 0.792 | 0.555 |
| noPe | 0.745 | 0.436 | 0.674 | 0.781 | 0.585 |

## B. Validación cruzada, variante sin PE

### Validación cruzada (árboles 48, muestra/árbol 120000, profundidad 16, hoja mínima 60, class-power 0.25)
Bloques de 200 m, buffer 30 m, 5 folds; leave-one-well-out con 1 pozo(s) por fold.

#### random · noPe (5 folds, 46 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.769 | 0.769 ± 0.002 | 0.797 |
| F1 macro | 0.528 | 0.529 ± 0.006 | 0.541 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.613 | 0.613 ± 0.005 | 0.539 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.710 | 0.716 | 0.713 |
| Arenisca/Lutita | 150455 | 0.505 | 0.371 | 0.427 |
| Lutita | 720803 | 0.832 | 0.920 | 0.874 |
| Marga | 33329 | 0.493 | 0.356 | 0.413 |
| Dolomía | 1688 | 0.000 | 0.000 | 0.000 |
| Caliza | 56320 | 0.658 | 0.561 | 0.606 |
| Creta | 10513 | 0.771 | 0.483 | 0.594 |
| Halita | 8213 | 0.958 | 0.993 | 0.975 |
| Anhidrita | 1085 | 0.700 | 0.810 | 0.751 |
| Toba | 15245 | 0.878 | 0.065 | 0.121 |
| Carbón | 3820 | 0.668 | 0.447 | 0.536 |
| Basamento | 103 | 0.265 | 0.437 | 0.330 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 120979  13681  27006   1335      0   5057    282     78    219     10    216     74
  20561  55754  70902   1801      0   1255     33      2     21     34     84      8
  16161  31441 663182   5938      0   3269     35    203     15     32    520      7
   2190   3762  12582  11861      0   2735    178      0      0      3      5     13
    307    171    869     65      0    242      8      4     18      1      0      3
   6381   3330  10934   2921      2  31620    962      7     76     58     20      9
   1345     52    268     24      0   3748   5075      1      0      0      0      0
     28      0      4      0      0      3      0   8155     21      0      2      0
     61     11     13      1      0     65      2     42    879      0      0     11
   1616   2072  10438    105      0     18      5      0      0    991      0      0
    639    110   1306     10      0     21      4     22      0      0   1708      0
     14      3     14      0      0     20      0      0      7      0      0     45
```

#### blocks · noPe (5 folds, 50 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.728 | 0.728 ± 0.015 | 0.756 |
| F1 macro | 0.416 | 0.425 ± 0.027 | 0.426 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.723 | 0.723 ± 0.045 | 0.649 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.640 | 0.674 | 0.657 |
| Arenisca/Lutita | 150455 | 0.395 | 0.275 | 0.324 |
| Lutita | 720803 | 0.810 | 0.901 | 0.853 |
| Marga | 33329 | 0.352 | 0.237 | 0.283 |
| Dolomía | 1688 | 0.000 | 0.000 | 0.000 |
| Caliza | 56320 | 0.611 | 0.491 | 0.545 |
| Creta | 10513 | 0.350 | 0.180 | 0.238 |
| Halita | 8213 | 0.967 | 0.992 | 0.979 |
| Anhidrita | 1085 | 0.714 | 0.629 | 0.669 |
| Toba | 15245 | 0.552 | 0.006 | 0.012 |
| Carbón | 3820 | 0.491 | 0.379 | 0.428 |
| Basamento | 103 | 0.000 | 0.000 | 0.000 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 113864  13927  33373   1421      0   5255    543     66    160     22    299      7
  24104  41322  80142   3213      0   1460     43      2      5     27    135      2
  20552  39839 649498   6991      0   2682     50    142     13      7   1024      5
   3161   3823  14967   7909      0   3367     95      0      0      0      4      3
    292    156    889     54      0    272      7      2     11      0      2      3
   8811   3132  11143   2822      0  27676   2616      7     54     20     35      4
   3528    236    452     14      0   4389   1893      0      0      1      0      0
     41      0      5      0      0      2      0   8147     14      0      4      0
    119      6     13      7      0     57    141     52    683      0      0      7
   2428   2066  10571     59      0     15     11      0      0     95      0      0
    836    167   1249      8      0     93      9      9      0      0   1449      0
     49      0     15      0      0     23      0      0     16      0      0      0
```

#### lowo · noPe (98 folds, 823 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.676 | 0.680 ± 0.146 | 0.706 |
| F1 macro | 0.351 | 0.357 ± 0.100 | 0.391 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.871 | 0.852 ± 0.399 | 0.787 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.576 | 0.656 | 0.613 |
| Arenisca/Lutita | 150455 | 0.228 | 0.154 | 0.184 |
| Lutita | 720803 | 0.783 | 0.856 | 0.818 |
| Marga | 33329 | 0.244 | 0.175 | 0.204 |
| Dolomía | 1688 | 0.000 | 0.000 | 0.000 |
| Caliza | 56320 | 0.538 | 0.476 | 0.505 |
| Creta | 10513 | 0.148 | 0.075 | 0.100 |
| Halita | 8213 | 0.963 | 0.448 | 0.612 |
| Anhidrita | 1085 | 0.697 | 0.716 | 0.706 |
| Toba | 15245 | 0.743 | 0.024 | 0.047 |
| Carbón | 3820 | 0.491 | 0.378 | 0.427 |
| Basamento | 103 | 0.000 | 0.000 | 0.000 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 110804  12209  36928   1328      0   5560   1461     59    219     34    318     17
  26117  23187  94696   4762      0   1457     53      1      6     51    122      3
  33732  56758 617257   8963      0   2687    345     11     28     11   1008      3
   3553   3960  16455   5826      0   3346    183      0      0      0      4      2
    329    161    863     60      0    258      3      1      9      1      2      1
  10255   3066  10714   2829      0  26821   2467     19     72     30     32     15
   3717     63    525     15      0   5393    793      2      0      1      4      0
    386      0      2      0      0   4130      6   3681      4      0      4      0
    152      8     15      5      0     80      7     40    777      0      0      1
   2591   2164  10046     52      0     16      6      0      0    370      0      0
    832    158   1285      5      0     67     20     10      0      0   1443      0
     59      5     16      0      0     23      0      0      0      0      0      0
```

## C. Validación cruzada, variante con PE

### Validación cruzada (árboles 48, muestra/árbol 120000, profundidad 16, hoja mínima 60, class-power 0.25)
Bloques de 200 m, buffer 30 m, 5 folds; leave-one-well-out con 1 pozo(s) por fold.

#### random · withPe (5 folds, 48 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.782 | 0.782 ± 0.001 | 0.810 |
| F1 macro | 0.549 | 0.548 ± 0.003 | 0.567 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.578 | 0.578 ± 0.004 | 0.503 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.727 | 0.742 | 0.734 |
| Arenisca/Lutita | 150455 | 0.539 | 0.389 | 0.452 |
| Lutita | 720803 | 0.838 | 0.927 | 0.880 |
| Marga | 33329 | 0.544 | 0.385 | 0.451 |
| Dolomía | 1688 | 0.000 | 0.000 | 0.000 |
| Caliza | 56320 | 0.697 | 0.585 | 0.636 |
| Creta | 10513 | 0.840 | 0.587 | 0.691 |
| Halita | 8213 | 0.962 | 0.993 | 0.977 |
| Anhidrita | 1085 | 0.704 | 0.820 | 0.757 |
| Toba | 15245 | 0.957 | 0.045 | 0.086 |
| Carbón | 3820 | 0.707 | 0.451 | 0.550 |
| Basamento | 103 | 0.299 | 0.476 | 0.367 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 125322  13339  23958   1063      0   4352    328     76    210      1    237     51
  19418  58593  69839   1416      0    999     70      2     26      4     79      9
  14876  28319 668358   5489      0   3080     78    181     25      6    378     13
   2205   3380  11728  12843      0   2994    157      0      3      2      3     14
    368    128    871     58      0    215     19      2     22      1      0      4
   5891   3289  10913   2649      1  32959    508      6     60     17     15     12
   1403     38    316     23      0   2559   6173      1      0      0      0      0
     30      0      7      0      0      1      0   8152     22      0      1      0
     62     13     13      1      0     53      3     38    890      0      0     12
   2268   1561  10652     60      0     10     11      0      0    683      0      0
    598    111   1342     10      0     16      4     18      0      0   1721      0
     14      1     14      0      0     18      0      0      7      0      0     49
```

#### blocks · withPe (5 folds, 51 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.741 | 0.741 ± 0.016 | 0.769 |
| F1 macro | 0.433 | 0.441 ± 0.028 | 0.443 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.692 | 0.692 ± 0.050 | 0.617 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.655 | 0.699 | 0.676 |
| Arenisca/Lutita | 150455 | 0.425 | 0.288 | 0.343 |
| Lutita | 720803 | 0.813 | 0.910 | 0.859 |
| Marga | 33329 | 0.401 | 0.240 | 0.300 |
| Dolomía | 1688 | 0.000 | 0.000 | 0.000 |
| Caliza | 56320 | 0.660 | 0.510 | 0.575 |
| Creta | 10513 | 0.467 | 0.243 | 0.319 |
| Halita | 8213 | 0.969 | 0.989 | 0.979 |
| Anhidrita | 1085 | 0.718 | 0.641 | 0.678 |
| Toba | 15245 | 0.626 | 0.005 | 0.011 |
| Carbón | 3820 | 0.574 | 0.382 | 0.459 |
| Basamento | 103 | 0.000 | 0.000 | 0.000 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 118057  13067  31495   1205      0   4119    597     29    156     15    177     20
  22600  43309  80021   3030      0   1275     80      2     13     17    102      6
  19291  36744 656069   5177      0   2473     54    170     17     14    782     12
   3270   3738  14731   7999      0   3403    169      0      3      0      6     10
    392    145    907     26      0    181      6      0     18      0      2     11
   8868   3097  11258   2448      0  28718   1856      2     30      3     14     26
   3734    452    535      8      0   3227   2552      0      5      0      0      0
     60      0      7      0      0      3      1   8126     15      0      1      0
    111     17     14      4      0     42    139     51    696      0      0     11
   3036   1236  10822     55      0     10      4      0      0     82      0      0
    833    164   1329     10      0     16      4      4      0      0   1460      0
     36     12     16      0      0     23      0      0     16      0      0      0
```

#### lowo · withPe (98 folds, 867 s)

| Métrica | Todas las muestras (agrupado) | Media de folds ± desvío | Solo confianza 1 |
|---|---|---|---|
| Exactitud | 0.681 | 0.685 ± 0.143 | 0.712 |
| F1 macro | 0.359 | 0.354 ± 0.100 | 0.405 |
| Penalización FORCE (menor es mejor; puntuación = −penalización) | 0.862 | 0.844 ± 0.396 | 0.777 |

| Clase | Soporte | Precisión | Recall | F1 |
|---|---|---|---|---|
| Arenisca | 168937 | 0.573 | 0.675 | 0.620 |
| Arenisca/Lutita | 150455 | 0.228 | 0.150 | 0.181 |
| Lutita | 720803 | 0.784 | 0.861 | 0.821 |
| Marga | 33329 | 0.232 | 0.148 | 0.181 |
| Dolomía | 1688 | 0.000 | 0.000 | 0.000 |
| Caliza | 56320 | 0.579 | 0.482 | 0.526 |
| Creta | 10513 | 0.304 | 0.145 | 0.196 |
| Halita | 8213 | 0.959 | 0.451 | 0.613 |
| Anhidrita | 1085 | 0.720 | 0.710 | 0.715 |
| Toba | 15245 | 0.921 | 0.010 | 0.020 |
| Carbón | 3820 | 0.508 | 0.378 | 0.433 |
| Basamento | 103 | 0.000 | 0.000 | 0.000 |

Matriz de confusión (filas = verdad, columnas = predicción; orden de clases como arriba):

```
 114101  12419  35162   1205      0   4302   1033     59    215      3    385     53
  25765  22571  95743   4917      0   1250     77      0     11      2    110      9
  34520  53846 620465   7673      0   3208    164     11     22      1    882     11
   4034   4726  16054   4930      0   3376    196      0      1      0      2     10
    447    128    864     36      0    187     10      1      7      0      1      7
  10590   3388  10691   2393      0  27168   1986     37     39      7     17      4
   4829    233    591     10      0   3322   1524      3      0      0      1      0
    516      0      4      0      0   3978      4   3704      4      0      3      0
    150     14     14      5      0     80      7     41    770      0      0      4
   3263   1503  10267     36      0     17      8      0      0    151      0      0
    865    166   1304      7      0     19      9      6      0      0   1444      0
     63     12     16      0      0     12      0      0      0      0      0      0
```
