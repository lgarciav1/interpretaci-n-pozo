/**
 * Módulo PERM — modelo k–φ de corona (docs/decisiones/0010-datos-de-corona.md, D4).
 * Definición PURA (la ejecuta el Web Worker).
 *
 * El motor no ve los plugs (viven en el pozo como conjunto de puntos y la regresión es una tendencia de la
 * interfaz): el panel «Corona» escribe a y b desde el ajuste k–φ con «Aplicar al pozo», y este módulo aplica el
 * modelo a la PHIE de todo el pozo. Registrado DESPUÉS de Timur y Coates: no cambia la fuente por defecto de PERM.
 * Las claves son `kphiA`/`kphiB` (no `a`/`b`): `a` ya es el factor de tortuosidad compartido de Archie.
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { logLinearPermeabilityInto } from '../../petro/permeability';

export const PERM_CORE_ID = 'perm-core';

export default defineModule({
  id: PERM_CORE_ID,
  name: 'Permeabilidad — modelo k–φ de corona',
  description: 'Permeabilidad a partir de la porosidad efectiva con la regresión de los plugs de corona (se aplica desde el panel Corona).',
  category: 'permeability',
  workspace: 'petrophysics',
  inputs: {
    phi: input.curve('PHIE'),
  },
  params: {
    kphiA: param.number({
      label: 'Coeficiente a (ordenada)',
      tooltip: 'Logaritmo decimal de la permeabilidad extrapolada a porosidad nula. Lo escribe «Aplicar al pozo» desde el ajuste k–φ de la corona.',
      default: -2,
      min: -10,
      max: 5,
      step: 0.01,
      scope: 'zone',
      group: 'Modelo k–φ',
    }),
    kphiB: param.number({
      label: 'Coeficiente b (pendiente)',
      tooltip: 'Cuántas décadas de permeabilidad sube por cada unidad de porosidad (v/v). Lo escribe «Aplicar al pozo» desde el ajuste k–φ de la corona.',
      default: 20,
      min: -50,
      max: 150,
      step: 0.1,
      scope: 'zone',
      group: 'Modelo k–φ',
    }),
    kMin: param.number({
      label: 'Permeabilidad mínima',
      tooltip: 'Recorte inferior: en arcillas y capas cerradas la exponencial da valores sin sentido físico.',
      default: 0.001,
      min: 0.000001,
      max: 1,
      unit: 'mD',
      scale: 'log',
      scope: 'zone',
      group: 'Recorte',
    }),
    kMax: param.number({
      label: 'Permeabilidad máxima',
      tooltip: 'Recorte superior: fuera del rango de porosidad de los plugs (derrumbes, φ alta espuria) la exponencial crece sin límite.',
      default: 20000,
      min: 10,
      max: 1000000,
      unit: 'mD',
      scale: 'log',
      scope: 'zone',
      group: 'Recorte',
    }),
  },
  outputs: {
    k: output.curve('PERM'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      let { kMin, kMax } = s.params;
      if (!(kMin < kMax)) {
        const where = s.zoneId ? `En la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'Fuera de las zonas';
        warn(`${where} la permeabilidad mínima no es menor que la máxima: se usan sin recorte superior.`, { zoneId: s.zoneId ?? undefined });
        kMax = Infinity;
        kMin = Math.min(kMin, s.params.kMax);
      }
      logLinearPermeabilityInto(inputs.phi, out, s.params.kphiA, s.params.kphiB, kMin, kMax, s.start, s.end);
    }
    return { k: out };
  },
  docs: {
    summary:
      'Modelo k–φ de corona: regresión de log k contra la porosidad de los plugs, aplicada a la porosidad efectiva del perfil en todo el pozo (globales con ajuste por zona). Se recorta a un rango de permeabilidad razonable porque la exponencial extrapola mal fuera del rango de porosidad de los plugs.',
    equations: [
      { latex: '\\log_{10} k = a + b\\,\\phi_e', description: 'k en mD, φe en v/v; a y b de la regresión de los plugs.' },
      { latex: 'k = A\\,e^{B\\phi} \\;\\Rightarrow\\; a = \\log_{10} A,\\quad b = B/\\ln 10', description: 'Conversión desde el ajuste exponencial del crossplot.' },
      { latex: 'k_{\\min} \\le k \\le k_{\\max}', description: 'Recorte.' },
    ],
    references: [
      'Nelson, P.H. (1994). Permeability-porosity relationships in sedimentary rocks. The Log Analyst 35(3).',
      'Tiab, D. y Donaldson, E.C. (2015). Petrophysics, 4.ª ed. Gulf Professional Publishing, cap. 3.',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
  },
});
