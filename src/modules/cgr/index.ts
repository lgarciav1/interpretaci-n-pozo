/**
 * G06 — Rayos gamma sin uranio (CGR) desde el GR espectral (docs/decisiones/0090).
 *
 * Produce CGR, la fracción del GR modelado atribuible al uranio y la tabla de calibración. Registrado después de
 * `igr`: no cambia la fuente por defecto de IGR. Definición PURA (la ejecuta el Web Worker).
 */
import { defineModule, input, output, type TableCell } from '../../core/module';
import { param } from '../../core/params';
import {
  MIN_FIT_R2,
  STANDARD_SPECTRAL_COEFFS,
  cgrResidualInto,
  cgrThKInto,
  evaluateSpectralFit,
  fitSpectralGr,
  uraniumGrFractionInto,
  type SpectralCoeffs,
  type SpectralFit,
} from '../../petro/spectralGr';

export const CGR_CALIBRATION = 'CGR_CALIBRATION';
const cell = (x: number): TableCell => (Number.isFinite(x) ? x : null);
const fmt = (x: number, d = 2) => x.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

const STATUS_LABEL: Record<SpectralFit['status'], string> = {
  ok: 'Coherente',
  'low-r2': 'R² bajo',
  'non-positive': 'Coeficiente no positivo',
  insufficient: 'Muestras insuficientes',
  singular: 'No identificable',
};

export default defineModule({
  id: 'cgr',
  name: 'Rayos gamma sin uranio (CGR)',
  description: 'Separa la radiactividad del torio y el potasio de la del uranio a partir del GR espectral.',
  category: 'shale',
  workspace: 'petrophysics',
  roles: [
    {
      id: 'U_GR_FRAC',
      label: 'Fracción del GR por uranio',
      unit: 'unitless',
      family: 'spectral',
      origin: 'computed',
      display: { color: '#bcbd22', scale: 'linear', min: 0, max: 1 },
    },
  ],
  inputs: {
    th: input.curve('THOR'),
    k: input.curve('POTA'),
    gr: input.optionalCurve('GR'),
    u: input.optionalCurve('URAN'),
  },
  params: {
    mode: param.enum({
      label: 'Coeficientes',
      tooltip:
        'Ajustados en el pozo: regresión del GR total contra torio, potasio y uranio. Estándar: valores orientativos que dependen del fabricante de la herramienta.',
      options: [
        { value: 'auto', label: 'Automático' },
        { value: 'fit', label: 'Ajustado en el pozo' },
        { value: 'standard', label: 'Estándar orientativo' },
      ],
      default: 'auto',
    }),
    formula: param.enum({
      label: 'Definición de CGR',
      tooltip:
        'Torio + potasio reconstruye el GR sin uranio desde el espectral. GR menos uranio conserva el GR medido y le resta el aporte del uranio.',
      options: [
        { value: 'thk', label: 'Torio + potasio' },
        { value: 'residual', label: 'GR menos uranio' },
      ],
      default: 'thk',
    }),
  },
  outputs: {
    cgr: output.curve('CGR'),
    uFrac: output.curve('U_GR_FRAC'),
    calibration: output.table(CGR_CALIBRATION, {
      label: 'Calibración del GR espectral',
      columns: [
        { key: 'scope', label: 'Ámbito', kind: 'text' },
        { key: 'source', label: 'Coeficientes', kind: 'text' },
        { key: 'a', label: 'a (gAPI/ppm Th)' },
        { key: 'b', label: 'b (gAPI/% K)' },
        { key: 'c', label: 'c (gAPI/ppm U)' },
        { key: 'samples', label: 'Muestras' },
        { key: 'r2', label: 'R²' },
        { key: 'rmse', label: 'RMSE (gAPI)' },
        { key: 'status', label: 'Diagnóstico', kind: 'text' },
      ],
    }),
  },
  compute({ n, inputs, params, zones, warn }) {
    const { th, k, gr, u } = inputs;
    const haveAll = !!gr && !!u;
    let coeffs: SpectralCoeffs = STANDARD_SPECTRAL_COEFFS;
    let source: 'fit' | 'standard' = 'standard';
    let fit: SpectralFit | null = null;

    if (params.mode === 'fit' && !haveAll) {
      warn('El ajuste en el pozo necesita GR y uranio: se usan los coeficientes estándar orientativos.');
    }
    if (params.mode !== 'standard' && gr && u) {
      fit = fitSpectralGr(gr, th, k, u);
      if (fit.status === 'insufficient' || fit.status === 'singular') {
        warn(
          `El ajuste del GR contra torio, potasio y uranio no es identificable (${fit.n} muestras válidas): se usan los coeficientes estándar orientativos.`,
        );
      } else if (fit.status === 'non-positive') {
        warn(
          `El ajuste del GR dio un coeficiente no positivo (Th ${fmt(fit.a)}, K ${fmt(fit.b)}, U ${fmt(fit.c)}): es incoherente y se usan los coeficientes estándar orientativos. Revisá la puesta en profundidad y la calibración del espectral.`,
        );
      } else {
        coeffs = { a: fit.a, b: fit.b, c: fit.c };
        source = 'fit';
        if (fit.status === 'low-r2') {
          warn(
            Number.isFinite(fit.r2)
              ? `El GR total se explica mal con torio, potasio y uranio (R² = ${fmt(fit.r2)}, umbral ${fmt(MIN_FIT_R2)}): revisá la puesta en profundidad entre corridas y las correcciones ambientales.`
              : 'El GR total no tiene variación suficiente para calcular R²: revisá las lecturas de GR y del espectral.',
          );
        }
      }
    }
    if (source === 'standard') {
      warn('Coeficientes estándar orientativos (Th 4, K 16, U 8): dependen del fabricante y la calibración de la herramienta.');
    }

    const cgr = new Float64Array(n).fill(NaN);
    if (params.formula === 'residual') {
      if (gr && u) cgrResidualInto(gr, u, cgr, coeffs.c);
      else warn('GR menos uranio necesita GR y uranio: CGR queda sin dato.');
    } else {
      cgrThKInto(th, k, cgr, coeffs);
    }
    const uFrac = new Float64Array(n).fill(NaN);
    if (u) uraniumGrFractionInto(th, k, u, uFrac, coeffs);

    const srcLabel = source === 'fit' ? 'Ajustados en el pozo' : 'Estándar orientativos';
    const rows: Record<string, TableCell>[] = [];
    const wellEval = gr && u ? (fit && source === 'fit' ? fit : evaluateSpectralFit(gr, th, k, u, coeffs)) : null;
    const wellStatus = fit
      ? fit.status === 'low-r2' && !Number.isFinite(fit.r2)
        ? 'Sin varianza'
        : STATUS_LABEL[fit.status]
      : !wellEval
        ? 'Sin GR o uranio para evaluar'
        : wellEval.n === 0
          ? 'Sin muestras válidas'
          : Number.isFinite(wellEval.r2) && wellEval.r2 < MIN_FIT_R2
            ? 'Estándar · R² bajo'
            : 'Estándar orientativo';
    rows.push({
      zoneId: null,
      scope: 'Pozo',
      source: srcLabel,
      a: cell(coeffs.a),
      b: cell(coeffs.b),
      c: cell(coeffs.c),
      samples: wellEval ? wellEval.n : null,
      r2: wellEval ? cell(wellEval.r2) : null,
      rmse: wellEval ? cell(wellEval.rmse) : null,
      status: wellStatus,
    });
    if (gr && u) {
      for (const z of zones) {
        const e = evaluateSpectralFit(gr, th, k, u, coeffs, { start: z.start, end: z.end });
        rows.push({
          zoneId: z.id,
          scope: z.name,
          source: srcLabel,
          a: null,
          b: null,
          c: null,
          samples: e.n,
          r2: cell(e.r2),
          rmse: cell(e.rmse),
          status:
            e.n === 0
              ? 'Sin muestras'
              : !Number.isFinite(e.r2)
                ? 'Sin varianza'
                : e.r2 < MIN_FIT_R2
                  ? 'R² bajo'
                  : 'Coherente',
        });
      }
    }
    return { cgr, uFrac, calibration: { rows } };
  },
  docs: {
    summary:
      'GR sin uranio: separa la radiactividad del torio y el potasio (arcillas, feldespatos, micas) de la del uranio (materia orgánica, fracturas, precipitados diagenéticos). Los coeficientes se ajustan en el pozo o se toman de valores estándar orientativos.',
    equations: [
      {
        latex: 'GR \\approx a\\,Th + b\\,K + c\\,U',
        description:
          'Ajuste por mínimos cuadrados sin intercepto sobre las muestras válidas de todo el pozo (Th y U en ppm, K en %). Muestra válida: las cuatro curvas finitas, GR, Th y K no negativos. Menos de 30 muestras, sistema mal condicionado o algún coeficiente no positivo: se usan los coeficientes estándar.',
      },
      {
        latex: 'R^2 = 1 - \\frac{\\sum (GR - \\widehat{GR})^2}{\\sum (GR - \\overline{GR})^2}, \\qquad RMSE = \\sqrt{\\frac{1}{n}\\sum (GR - \\widehat{GR})^2}',
        description: 'R² centrado (más exigente que el no centrado de la regresión por el origen). Con R² < 0,85 se avisa incoherencia.',
      },
      {
        latex: 'a = 4,\\quad b = 16,\\quad c = 8',
        description: 'Coeficientes estándar orientativos de herramientas NGS: dependen del fabricante y la calibración.',
      },
      {
        latex: 'CGR = a\\,Th + b\\,K \\qquad \\text{o} \\qquad CGR = \\max(0,\\; GR - c\\,U)',
        description: 'Torio + potasio (por defecto) o GR menos uranio. Th y K negativos se recortan a 0.',
      },
      {
        latex: 'f_U = \\frac{c\\,U}{a\\,Th + b\\,K + c\\,U}',
        description: 'Fracción del GR modelado atribuible al uranio, recortada a [0, 1].',
      },
    ],
    references: [
      'Ellis, D. V. y Singer, J. M. (2007). Well Logging for Earth Scientists, 2.ª ed. Springer, cap. 7.',
      'Schlumberger (1989). Log Interpretation Principles/Applications, cap. 4 (NGS: SGR y CGR).',
      'Draper, N. R. y Smith, H. (1998). Applied Regression Analysis, 3.ª ed. Wiley (regresión por el origen).',
    ],
    notes:
      'CGR no es Vsh: el torio y el potasio también aparecen en feldespatos y micas. Para usarlo en el volumen de arcilla, elegí «Índice de rayos gamma desde CGR» como fuente de IGR (ADR 0090).',
  },
});
