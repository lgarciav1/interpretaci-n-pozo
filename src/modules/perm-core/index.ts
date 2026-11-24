/**
 * Módulo PERM — modelo k–φ de corona (docs/decisiones/0010-datos-de-corona.md, D4).
 * Definición PURA (la ejecuta el Web Worker).
 *
 * El motor no ve los plugs (viven en el pozo como conjunto de puntos y la regresión es una tendencia de la
 * interfaz): el panel «Corona» escribe la familia y los coeficientes del ajuste k–φ con «Aplicar al pozo», y este módulo aplica el
 * modelo a la PHIE de todo el pozo. Registrado DESPUÉS de Timur y Coates: no cambia la fuente por defecto de PERM.
 * Las claves son `kphiA`/`kphiB` (no `a`/`b`): `a` ya es el factor de tortuosidad compartido de Archie.
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { logLinearPermeabilityInto, powerPermeabilityInto } from '../../petro/permeability';

import { PERM_CORE_ID, permCoreModelSchema, resolvePermCoreParams } from './params';

export { PERM_CORE_ID } from './params';

const params = {
  ...permCoreModelSchema,
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
};

const permCore = defineModule({
  id: PERM_CORE_ID,
  name: 'Permeabilidad — modelo k–φ de corona',
  description: 'Permeabilidad a partir de la porosidad efectiva con la regresión de los plugs de corona (se aplica desde el panel Corona).',
  category: 'permeability',
  workspace: 'petrophysics',
  inputs: {
    phi: input.curve('PHIE'),
  },
  params,
  resolveParams(state, zoneIds) {
    return resolvePermCoreParams(params, state, zoneIds);
  },
  outputs: {
    k: output.curve('PERM'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      const { kphiMethod, kphiA, kphiB, powerLogA, powerB, powerPhiMin, powerPhiMax } = s.params;
      const where = s.zoneId ? `En la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}` : 'Fuera de las zonas';
      let { kMin, kMax } = s.params;
      if (!(kMin < kMax)) {
        warn(`${where} la permeabilidad mínima no es menor que la máxima: se usan sin recorte superior.`, { zoneId: s.zoneId ?? undefined });
        kMax = Infinity;
        kMin = Math.min(kMin, s.params.kMax);
      }
      if (kphiMethod === 'power') {
        const extrapolated = powerPermeabilityInto(inputs.phi, out, {
          method: 'power', a: powerLogA, b: powerB,
          ...(powerPhiMin > 0 ? { phiMin: powerPhiMin, phiMax: powerPhiMax } : {}),
        }, kMin, kMax, s.start, s.end);
        if (extrapolated) warn(`${where} el modelo potencial extrapola el rango de porosidad de los plugs.`, { zoneId: s.zoneId ?? undefined });
      } else {
        logLinearPermeabilityInto(inputs.phi, out, kphiA, kphiB, kMin, kMax, s.start, s.end);
      }
    }
    return { k: out };
  },
  docs: {
    summary:
      'Modelo exponencial o potencial ajustado con plugs de corona y aplicado a la porosidad efectiva del perfil. Cada zona puede tener un modelo propio. El modelo potencial requiere porosidad positiva y su ajuste minimiza residuos en el espacio logarítmico.',
    equations: [
      { latex: '\\log_{10} k = a + b\\,\\phi_e', description: 'k en mD, φe en v/v; a y b de la regresión de los plugs.' },
      { latex: 'k = A\\,e^{B\\phi} \\;\\Rightarrow\\; a = \\log_{10} A,\\quad b = B/\\ln 10', description: 'Conversión desde el ajuste exponencial del crossplot.' },
      { latex: 'k = A\\,\\phi_e^{b} = 10^{\\log_{10} A + b\\,\\log_{10}\\phi_e}', description: 'Ley potencial: k en mD, φe en v/v; se guardan log10(A) y el exponente b.' },
      { latex: 'k_{\\min} \\le k \\le k_{\\max}', description: 'Recorte.' },
    ],
    references: [
      'Nelson, P.H. (1994). Permeability-porosity relationships in sedimentary rocks. The Log Analyst 35(3).',
      'Tiab, D. y Donaldson, E.C. (2015). Petrophysics, 4.ª ed. Gulf Professional Publishing, cap. 3.',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
  },
});

export default permCore;
