/**
 * Módulo — invasión escalonada (Rxo, diámetro de invasión y Rt) a partir de la inducción de arreglo.
 * Ver 0020 y src/petro/invasion.ts. Definición PURA (la ejecuta el Web Worker).
 *
 * Las entradas se piden por rol: AT10/AT20/AT30 son RA10/RA20/RA30, AT60 es RM y AT90 es RT. Que `RM` provenga de
 * un AT60 no se puede comprobar: el módulo supone inducción de arreglo en RT y RM (si no, la profundidad de
 * investigación de 60 y 90 in no vale). `RT` de salida es una fuente alternativa: la curva medida sigue ganando por
 * defecto (el motor prefiere la curva con ese rol).
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import {
  ARRAY_INDUCTION_R50_IN,
  DEFAULT_BIT_SIZE_IN,
  DEFAULT_MAX_MISFIT,
  DEFAULT_MIN_SEPARATION,
  MAX_INVASION_DIAMETER_IN,
  emptyCounts,
  invertStepProfileInto,
  type InvasionCounts,
  type InvasionCurveInput,
} from '../../petro/invasion';

/** Muestras mínimas de una zona para avisar por la fracción sin invasión (las lutitas casi nunca invaden). */
const MIN_SAMPLES_FOR_WARNING = 5;

/** Fracción de ajustes problemáticos de una zona a partir de la cual se avisa. */
const WARN_FRACTION = 0.1;

/** «A», «A y B», «A, B y C». */
function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

const pct = (x: number, total: number): string => `${Math.round((100 * x) / Math.max(total, 1))} %`;

export default defineModule({
  id: 'invasion-step',
  name: 'Invasión escalonada — Rxo, di y Rt (inducción de arreglo)',
  description: 'Estima por muestra la resistividad de la zona lavada, el diámetro de invasión y la Rt corregida ajustando un perfil escalonado a las curvas de la inducción de arreglo.',
  category: 'resistivity',
  categoryLabel: 'Resistividad',
  workspace: 'petrophysics',
  inputs: {
    ra10: input.optionalCurve('RA10', { label: 'Inducción 10 in (AT10)' }),
    ra20: input.optionalCurve('RA20', { label: 'Inducción 20 in (AT20)' }),
    ra30: input.optionalCurve('RA30', { label: 'Inducción 30 in (AT30)' }),
    rm: input.optionalCurve('RM', { label: 'Inducción 60 in (AT60)' }),
    rt: input.curve('RT', { label: 'Inducción 90 in (AT90)' }),
    bs: input.optionalCurve('BS', { label: 'Diámetro de trépano (BS)' }),
  },
  params: {
    minSeparation: param.number({
      label: 'Separación mínima entre curvas',
      tooltip:
        'Si la más resistiva y la menos resistiva de las curvas difieren menos que esto (como fracción: 0,10 = 10 %), se considera que no hay invasión visible: no se calcula Rxo ni diámetro y la Rt es la lectura más profunda.',
      default: DEFAULT_MIN_SEPARATION,
      min: 0.01,
      max: 0.5,
      step: 0.01,
      scope: 'zone',
    }),
    maxMisfit: param.number({
      label: 'Desajuste máximo aceptable',
      tooltip:
        'Error relativo medio (fracción: 0,15 = 15 %) entre las lecturas y el perfil ajustado. Por encima de esto el ajuste se cuenta como pobre y se avisa; suele delatar picos aislados en una curva.',
      default: DEFAULT_MAX_MISFIT,
      min: 0.02,
      max: 1,
      step: 0.01,
      scope: 'zone',
    }),
    bitSize: param.number({
      label: 'Diámetro del trépano',
      tooltip: 'Cota inferior del diámetro de invasión: no puede ser menor que el pozo. Se usa donde no hay curva de trépano (BS) o no tiene dato.',
      default: DEFAULT_BIT_SIZE_IN,
      min: 4,
      max: 26,
      step: 0.125,
      unit: 'in',
      scope: 'zone',
    }),
  },
  outputs: {
    rxo: output.curve('RXO', { label: 'Rxo del perfil escalonado' }),
    rt: output.curve('RT', { label: 'Rt corregida por invasión' }),
    di: output.curve('DI'),
    misfit: output.curve('INV_MISFIT'),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const rxo = new Float64Array(n);
    const rt = new Float64Array(n);
    const di = new Float64Array(n);
    const misfit = new Float64Array(n);
    const curves: InvasionCurveInput[] = [];
    const used: string[] = [];
    const add = (role: string, data: ArrayLike<number> | undefined): void => {
      if (!data) return;
      curves.push({ r50: ARRAY_INDUCTION_R50_IN[role]!, data });
      used.push(role);
    };
    add('RA10', inputs.ra10);
    add('RA20', inputs.ra20);
    add('RA30', inputs.ra30);
    add('RM', inputs.rm);
    add('RT', inputs.rt);
    if (curves.length < 3) {
      warn(
        `Hay solo ${curves.length} curva${curves.length === 1 ? '' : 's'} de inducción de arreglo (se usan ${listAnd(used)}) y se necesitan al menos 3: no se calcula Rxo, diámetro de invasión ni Rt corregida.`,
      );
    }

    const byZone = new Map<string, { total: number; counts: InvasionCounts }>();
    const noZone = '';
    for (const s of segments) {
      const counts = invertStepProfileInto(
        curves,
        { rxo, rt, di, misfit },
        { bitSize: s.params.bitSize, bitSizes: inputs.bs, minSeparation: s.params.minSeparation },
        s.params.maxMisfit,
        s.start,
        s.end,
      );
      const key = s.zoneId ?? noZone;
      const acc = byZone.get(key) ?? { total: 0, counts: emptyCounts() };
      acc.total += s.end - s.start;
      for (const k of Object.keys(counts) as (keyof InvasionCounts)[]) acc.counts[k] += counts[k];
      byZone.set(key, acc);
    }

    if (curves.length >= 3) {
      for (const [key, { total, counts: c }] of byZone) {
        if (total === 0) continue;
        const where = key === noZone ? 'Fuera de las zonas' : `En la zona ${zones.find((z) => z.id === key)?.name ?? key}`;
        const fits = c.ok + c.poorlyResolved + c.unresolvedDeep + c.unresolvedShallow + c.unresolvedSigma;
        const valid = fits + c.noInvasion;
        const over = (x: number, of: number): boolean => of > 0 && x / of > WARN_FRACTION;
        if (over(c.highMisfit, fits)) {
          warn(
            `${where}, ${pct(c.highMisfit, fits)} de los ajustes tiene un desajuste alto: alguna curva puede tener picos o lecturas incoherentes con un perfil escalonado, y Rxo, di y Rt de esas muestras no son confiables.`,
            { zoneId: key || undefined },
          );
        }
        if (key !== noZone && valid >= MIN_SAMPLES_FOR_WARNING && c.noInvasion / valid > 0.9) {
          warn(`${where}, ${pct(c.noInvasion, valid)} de las muestras no muestra invasión (las curvas difieren menos que la separación mínima): ahí Rxo y el diámetro quedan sin dato.`, { zoneId: key || undefined });
        }
        if (over(c.poorlyResolved, fits)) {
          warn(
            `${where}, ${pct(c.poorlyResolved, fits)} de los ajustes no determina el diámetro de invasión (el intervalo compatible con las lecturas es más ancho que un factor 2): ahí Rxo y el diámetro quedan sin dato y se conserva Rt.`,
            { zoneId: key || undefined },
          );
        }
        if (over(c.unresolvedDeep, fits)) {
          warn(`${where}, ${pct(c.unresolvedDeep, fits)} de los ajustes pide una invasión más profunda que el máximo buscado (${MAX_INVASION_DIAMETER_IN} in): Rxo y el diámetro quedan sin dato y Rt es la lectura más profunda, que no es confiable.`, { zoneId: key || undefined });
        }
        if (over(c.unresolvedShallow, fits)) {
          warn(`${where}, ${pct(c.unresolvedShallow, fits)} de los ajustes pide una invasión tan somera como el pozo (diámetro igual al trépano): Rxo y el diámetro quedan sin dato y Rt es la lectura más profunda.`, { zoneId: key || undefined });
        }
        if (over(c.unresolvedSigma, fits)) {
          warn(`${where}, ${pct(c.unresolvedSigma, fits)} de los ajustes pide una Rt en el límite del rango físico: quedan sin resolver (Rt es la lectura más profunda).`, { zoneId: key || undefined });
        }
        if (over(c.rxoAtBound, fits)) {
          warn(`${where}, ${pct(c.rxoAtBound, fits)} de los ajustes pide una zona lavada de resistividad extrema (en el límite del rango físico): las lecturas no determinan Rxo y queda sin dato.`, { zoneId: key || undefined });
        }
        if (c.insufficient > 0) {
          warn(`${where}, ${c.insufficient} muestras tienen menos de 3 curvas válidas (sin dato o ≤ 0): quedan sin resultado.`, { zoneId: key || undefined });
        }
      }
    }
    return { rxo, rt, di, misfit };
  },
  docs: {
    summary:
      'Ajusta por muestra un perfil de invasión escalonado (zona lavada de resistividad Rxo hasta el radio de invasión, formación virgen de resistividad Rt más allá) a las curvas de la inducción de arreglo de distintas profundidades de investigación (10, 20, 30, 60 y 90 pulgadas). La inducción responde en conductividad, y cada curva lee una mezcla de las dos zonas que depende de su profundidad de investigación (factor geométrico radial). Para un radio de invasión dado, Rxo y Rt salen de un sistema lineal; el radio se busca sobre una grilla logarítmica y se refina. Devuelve Rxo, el diámetro de invasión (2·ri, como en las cartas tornado) y la Rt corregida, más el desajuste del ajuste para detectar lecturas incoherentes. Solo emite Rxo y diámetro donde el ajuste los determina: si el intervalo de diámetros compatible con las lecturas es más ancho que un factor 2, si el ajuste queda pegado a un borde de la búsqueda o si Rxo pide un valor extremo, esos valores quedan sin dato.',
    equations: [
      {
        latex: 'J_k(r) = \\frac{1}{1 + (r_{50,k}/r)^{p}}, \\quad p = 1{,}5',
        description: 'Factor geométrico radial integrado (aproximación paramétrica, no la respuesta del fabricante). r50 = 10, 20, 30, 60 y 90 in para AT10…AT90.',
      },
      {
        latex: '\\sigma_{a,k} = J_k(r_i)\\,\\sigma_{xo} + \\bigl(1 - J_k(r_i)\\bigr)\\,\\sigma_t, \\qquad \\sigma = 1/R',
        description: 'Modelo directo de perfil escalonado en conductividad.',
      },
      { latex: 'd_i = 2\\,r_i', description: 'Diámetro de invasión (incluye el pozo).' },
      {
        latex: '\\text{misfit} = \\sqrt{\\frac{1}{n}\\sum_k \\left(\\frac{\\sigma_{a,k}-\\sigma_k}{\\max(\\sigma_k,\\;0{,}05\\,\\sigma_{\\max})}\\right)^{2}}',
        description: 'Desajuste relativo (error proporcional a la lectura, con piso del 5 % de la mayor conductividad). Es el RMS sobre n lecturas: con 4 curvas y 3 incógnitas subestima el ruido por curva en un factor 2.',
      },
      {
        latex: '\\text{misfit}(r_i) \\le \\sqrt{\\text{misfit}_{\\min}^{2} + \\delta^{2}}, \\quad \\delta = 0{,}02',
        description: 'Intervalo de radios compatibles con el ajuste; si d_i,alto / d_i,bajo > 2 el diámetro se considera mal resuelto.',
      },
    ],
    references: [
      'Doll, H. G. (1949). Introduction to induction logging and application to logging of wells drilled with oil base mud. Trans. AIME 186.',
      'Moran, J. H. y Kunz, K. S. (1962). Basic theory of induction logging and application to study of two-coil sondes. Geophysics 27(6).',
      'Hunka, J. F. et al. (1990). A New Resistivity Measurement System for Deep Formation Imaging and High-Resolution Formation Evaluation. SPE 20559.',
      'Barber, T. D. y Rosthal, R. A. (1991). Using a multiarray induction tool to achieve high-resolution logs with minimum environmental effects. SPE 22725.',
      'Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.',
    ],
    notes:
      'Aproximación: las respuestas radiales reales de la herramienta no están disponibles; se usa una logística en ln r ajustada al factor geométrico de una sonda de dos bobinas (error máximo 0,04 en J; sobrestima J en la cola). Los diámetros son un orden de magnitud: cambiar la forma de J (p = 1 o p = 2) los mueve entre ≈ −50 % y +25 % en el TP, y Rt menos de 5 %. Se supone que RT es AT90 y RM es AT60 (inducción de arreglo; profundidades de 90 y 60 in como radio desde el eje); el módulo no puede comprobarlo. Las lecturas se suponen corregidas por pozo. Estados por muestra: sin invasión visible (curvas casi iguales: Rt es la lectura más profunda y Rxo, diámetro y desajuste quedan sin dato); sin resolver (el ajuste pide un diámetro igual al trépano o al máximo de 300 in, o Rt en el límite físico: Rxo y diámetro sin dato y Rt es la lectura más profunda, porque la Rt de un ajuste en el borde no es confiable); diámetro mal resuelto (el intervalo de diámetros compatible con las lecturas es más ancho que un factor 2: Rxo y diámetro sin dato, Rt del ajuste); Rxo en el límite del rango físico (Rxo sin dato, diámetro y Rt del ajuste). La robustez de Rt (en el TP, mediana de −3 % a −5 % respecto de AT90 en los ajustes interiores y hasta −35 % en los de invasión profunda, porque AT90 lee algo de zona lavada) vale solo para los ajustes interiores. Con 3 curvas el desajuste no informa; con 4, subestima el ruido por curva en un factor 2, y el umbral 0,15 equivale a ≈ 30 % de error por curva. Si hay curva de trépano (BS) se usa por muestra como cota inferior del diámetro; si no, el parámetro. La Rt de salida es una fuente alternativa: por defecto se usa la curva medida.',
  },
});
