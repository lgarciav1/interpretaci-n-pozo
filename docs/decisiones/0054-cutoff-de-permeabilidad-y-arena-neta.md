# 0054 — Corte de permeabilidad y arena neta

Estado: implementado. Cubre la tarea 7 de la consigna del TP («Obtener los espesores de reservorio Hk – Hu»).

## Contexto

La planilla de la cátedra informa tres espesores anidados: **espesor arena** (Vsh ≤ corte), **permeable** (además
φ ≥ corte) y **útil** (además Sw ≤ corte); cortes de ejemplo Vsh 0,3, φ 0,08 y Sw 0,5. La app tenía solo reservorio
neto (`NET_RES`) y pay neto (`NET_PAY`) y no admitía un corte de permeabilidad, habitual en la práctica (Worthington,
2010: arena neta → reservorio neto → pay neto, con k como criterio de reservorio).

## Decisión

1. **Arena neta.** El módulo `cutoffs` publica una tercera bandera, `NET_SAND` (1 si Vsh ≤ Vsh máx., 0 si no, NaN sin
   Vsh). El rol lo declara el propio módulo (`roles`), sin tocar el catálogo del núcleo; su color curado (tostado de
   arena, distinto del oro del reservorio y del rojo del pay) está en `src/ui/curves.ts`. Aparece sola en la pista
   «Banderas», que reúne todo rol de familia `flag`. Por construcción pay ⊆ reservorio ⊆ arena.
2. **Corte de k opcional, apagado por defecto.** Dos parámetros compartidos nuevos en `SHARED_PARAMS`, por zona como
   los otros cortes: `permCutoffOn` (interruptor, `false`) y `permCutoff` (mD, 0,001–1000, slider log sin paso: 3
   cifras significativas, defecto 1 mD). Se eligió interruptor + valor en lugar de un valor «mínimo = apagado» porque
   así el valor elegido no se pierde al apagarlo, el apagado es explícito y por zona, y los proyectos guardados (sin
   ninguna de las dos claves) resuelven a «apagado»: dan exactamente los mismos `NET_RES`, `NET_PAY` y sumario.
3. **Entrada `PERM` opcional** en `cutoffs` (y en `cutoff-sensitivity`). Con el corte apagado la permeabilidad no
   interviene: el motor usa la misma función de tres curvas que antes (`netReservoirFlag`).
4. **Permeabilidad faltante con el corte activo** = la regla de curva faltante de 0007 (D6): si Vsh o φ (o una k
   conocida) ya descartan la muestra, es 0; si no, NaN («sin dato»). Si el pozo no tiene ninguna curva `PERM` (ni
   medida ni calculada por Timur, Coates o corona), todo lo que Vsh y φ no descartan queda sin dato y el módulo avisa
   nombrando las zonas. No se ignora el corte en silencio: el sumario lo muestra en «Sin dato».
5. **Sumario.** `ZONE_SUMMARY` suma `netSand` («Arena neta») y `ntgSand` («N/G arena») AL FINAL de la tabla, para no correr de lugar las columnas de los CSV/XLSX exportados; las columnas existentes
   conservan sus claves y su orden relativo, y cambian sus rótulos a «Reservorio neto (permeable)» y «Pay neto
   (útil)». `NET_SAND` es entrada opcional del sumario: un `NET_RES` que no venga del módulo de cutoffs sigue sirviendo
   (la arena queda en blanco). Las fichas de zona, la comparación de snapshots, el informe y las exportaciones leen la
   tabla por columnas declaradas, así que la arena aparece sin código propio salvo en la ficha y en la comparación.
6. **Sensibilidad.** El corte de k activo es un corte fijo más (no se barre): la fila del cutoff vigente sigue
   coincidiendo con el sumario.
7. **Gráficos.** `src/plots/cutoffs.ts` ya era genérico: el rol `PERM` se vincula a `permCutoff` (pasa por arriba,
   k ≥ mínimo). Con el corte apagado la línea se dibuja gris y punteada («inactivo») y arrastrarla lo activa en el mismo
   alcance (global o la zona filtrada) y en la misma entrada de deshacer. En eje log, las flechas mueven la guía un 1 %
   del eje (no un paso aditivo).

## Fuera de alcance

- El Monte Carlo de `uncertainty` sigue sin el corte de k (perturba Vsh, φ y Sw con sus cortes; no conoce k).
- El slider de `permCutoff` se ve aunque el corte esté apagado: el panel de parámetros no tiene visibilidad
  condicional y agregarla sería tocar el contrato de parámetros.

## Referencias

- Worthington, P. F. (2010). Net pay — what is it? What does it do? How do we quantify it? How do we use it? SPE
  Reservoir Evaluation & Engineering 13(5).
- Worthington, P. F. y Cosentino, L. (2005). The role of cut-offs in integrated reservoir studies. SPE Reservoir
  Evaluation & Engineering 8(4).
- Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.

Capturas: [`docs/capturas/cutoff-permeabilidad/`](../capturas/cutoff-permeabilidad/).
