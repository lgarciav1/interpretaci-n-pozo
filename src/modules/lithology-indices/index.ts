/**
 * Índices de litología (docs/decisiones/0059): M y N (Burke et al., 1969), Umaa (matriz aparente) y el cociente Th/K,
 * por muestra, para los crossplots de determinación de litologías (M–N, ρmaa–Umaa, PEF contra Th/K). ρmaa ya la
 * publica `core-calibration` (RHOMAA). Definición PURA (la ejecuta el Web Worker).
 *
 * Cada curva necesita sus propias entradas; las que faltan dejan su curva sin dato y un aviso (no un error): el resto
 * se calcula igual.
 */
import { defineModule, input, output } from '../../core/module';
import { param } from '../../core/params';
import { DEFAULT_DT_FLUID, DEFAULT_PHIN_FLUID, DEFAULT_RHO_FLUID, DEFAULT_U_FLUID, mIndex, nIndex, thkRatio, umaa } from '../../petro/lithologyIndices';

export const LITHOLOGY_INDEX_ROLES = { m: 'M', n: 'N', umaa: 'UMAA', thk: 'THK' } as const;

export default defineModule({
  id: 'lithology-indices',
  name: 'Índices de litología · M, N, Umaa y Th/K',
  description: 'Curvas derivadas de los crossplots de litología: M y N (sónico, neutrón y densidad), Umaa de matriz aparente y cociente Th/K.',
  category: 'geology',
  workspace: 'geology',
  roles: [
    { id: 'M', label: 'M (sónico–densidad)', unit: 'unitless', family: 'lithology', origin: 'computed', display: { color: '#7c3aed', scale: 'linear', min: 0.4, max: 1.1 }, description: 'Pendiente sónico–densidad de Burke et al. (1969), independiente de la porosidad.' },
    { id: 'N', label: 'N (neutrón–densidad)', unit: 'unitless', family: 'lithology', origin: 'computed', display: { color: '#1f5fd1', scale: 'linear', min: 0.3, max: 0.8 }, description: 'Pendiente neutrón–densidad de Burke et al. (1969), independiente de la porosidad.' },
    { id: 'UMAA', label: 'Umaa, U de matriz aparente (b/cm³)', unit: 'unitless', family: 'lithology', origin: 'computed', display: { color: '#c026d3', scale: 'linear', min: 2, max: 17 }, description: 'Sección eficaz fotoeléctrica volumétrica de la matriz aparente, en barn/cm³.' },
    { id: 'THK', label: 'Cociente Th/K', unit: 'unitless', family: 'spectral', origin: 'computed', display: { color: '#b45309', scale: 'log', min: 0.1, max: 100 }, description: 'Torio (ppm) sobre potasio (%).' },
  ],
  inputs: {
    rhob: input.optionalCurve('RHOB'),
    nphi: input.optionalCurve('NPHI'),
    dt: input.optionalCurve('DT'),
    pe: input.optionalCurve('PEF'),
    phit: input.optionalCurve('PHIT', { label: 'Porosidad total (densidad–neutrón)' }),
    th: input.optionalCurve('THOR'),
    k: input.optionalCurve('POTA'),
  },
  inputGroups: [{ inputs: ['rhob', 'k'], label: 'la densidad (para M, N y Umaa) o el potasio (para Th/K)' }],
  params: {
    dtFl: param.number({
      label: 'Δt del fluido',
      tooltip: 'Tiempo de tránsito del fluido de la zona investigada: 189 µs/ft para agua dulce (filtrado de lodo dulce), ~185 para lodo salado. Entra en M.',
      default: DEFAULT_DT_FLUID,
      min: 150,
      max: 240,
      step: 1,
      unit: 'us/ft',
      scope: 'zone',
    }),
    rhoFl: param.number({
      label: 'Densidad del fluido',
      tooltip: 'Agua dulce 1,0; salada hasta 1,15 g/cm³. Entra en M y N; con hidrocarburo liviano los puntos se corren hacia arriba en M–N.',
      default: DEFAULT_RHO_FLUID,
      min: 0.6,
      max: 1.3,
      step: 0.01,
      unit: 'g/cm3',
      scope: 'zone',
    }),
    phiNFl: param.number({
      label: 'Neutrón del fluido',
      tooltip: 'Porosidad neutrónica aparente del fluido (índice de hidrógeno): 1 para agua dulce, algo menos en agua muy salada. Entra en N.',
      default: DEFAULT_PHIN_FLUID,
      min: 0.5,
      max: 1.2,
      step: 0.01,
      unit: 'v/v',
      scope: 'zone',
    }),
    uFl: param.number({
      label: 'U del fluido',
      tooltip: 'Sección eficaz fotoeléctrica volumétrica del fluido: 0,398 b/cm³ para agua dulce; aumenta con la salinidad (≈ 1,36 con 200 000 ppm de NaCl). Entra en Umaa.',
      default: DEFAULT_U_FLUID,
      min: 0,
      max: 2,
      step: 0.001,
      unit: 'unitless',
      scope: 'zone',
    }),
  },
  outputs: {
    m: output.curve('M'),
    n: output.curve('N'),
    umaa: output.curve('UMAA'),
    thk: output.curve('THK'),
  },
  compute({ n, inputs, segments, warn }) {
    const { rhob, nphi, dt, pe, phit, th, k } = inputs;
    const m = new Float64Array(n).fill(NaN);
    const nn = new Float64Array(n).fill(NaN);
    const u = new Float64Array(n).fill(NaN);
    const r = new Float64Array(n).fill(NaN);
    for (const s of segments) {
      const { dtFl, rhoFl, phiNFl, uFl } = s.params;
      for (let i = s.start; i < s.end; i++) {
        if (rhob && dt) m[i] = mIndex(dt[i]!, rhob[i]!, dtFl, rhoFl);
        if (rhob && nphi) nn[i] = nIndex(nphi[i]!, rhob[i]!, phiNFl, rhoFl);
        if (rhob && pe && phit) u[i] = umaa(pe[i]!, rhob[i]!, phit[i]!, uFl);
        if (th && k) r[i] = thkRatio(th[i]!, k[i]!);
      }
    }
    const missing = (what: string, need: string) => warn(`${what} queda sin dato: falta ${need}.`);
    if (!rhob || !dt) missing('M', !rhob ? 'la densidad (RHOB)' : 'el sónico (DT)');
    if (!rhob || !nphi) missing('N', !rhob ? 'la densidad (RHOB)' : 'el neutrón (NPHI)');
    if (!rhob || !pe || !phit) missing('Umaa', !rhob ? 'la densidad (RHOB)' : !pe ? 'el factor fotoeléctrico (PEF)' : 'la porosidad total (PHIT)');
    if (!th || !k) missing('Th/K', !th ? 'el torio (THOR)' : 'el potasio (POTA)');
    return { m, n: nn, umaa: u, thk: r };
  },
  docs: {
    summary:
      'Curvas para identificar la litología en los crossplots de la cátedra. M y N son las pendientes de las rectas matriz–fluido en densidad–sónico y densidad–neutrón: no dependen de la porosidad, así que cada mineral cae en un punto del gráfico M–N (cuarzo, calcita, dolomita, anhidrita, yeso, sal). Umaa y ρmaa (de «Densidad de matriz aparente») sacan el fluido de la lectura del PEF y de la densidad con la porosidad total de densidad–neutrón y ubican la matriz en el triángulo cuarzo–calcita–dolomita, con la grilla de porcentajes. Th/K, contra el PEF, separa minerales arcillosos y micas (cajas de Lith-1, orientativas). Con lodo con baritina el PEF y Umaa quedan muy altos (corridos a la derecha en ρmaa–Umaa): no son de la matriz.',
    equations: [
      { latex: 'M = 0{,}01\\,\\frac{\\Delta t_f - \\Delta t}{\\rho_b - \\rho_f}', description: 'Pendiente sónico–densidad (Δt en µs/ft, densidades en g/cm³). Sin dato si ρb ≤ ρf.' },
      { latex: 'N = \\frac{\\phi_{Nf} - \\phi_N}{\\rho_b - \\rho_f}', description: 'Pendiente neutrón–densidad, con el neutrón en unidades de caliza. Sin dato si ρb ≤ ρf.' },
      { latex: 'U = P_e\\,\\rho_e,\\quad \\rho_e = \\frac{\\rho_b + 0{,}1883}{1{,}0704}', description: 'Sección eficaz fotoeléctrica volumétrica (b/cm³) con la densidad electrónica de la calibración del perfil. Sin dato si Pe ≤ 0.' },
      { latex: 'U_{maa} = \\frac{U - \\phi_t\\,U_f}{1 - \\phi_t}', description: 'U de matriz aparente con la porosidad total φt de densidad–neutrón (Uf = 0,398 b/cm³ para agua dulce). Sin dato si φt < 0 o φt ≥ 1.' },
      { latex: '\\rho_{maa} = \\frac{\\rho_b - \\phi_t\\,\\rho_f}{1 - \\phi_t}', description: 'Densidad de matriz aparente (la calcula el módulo «Densidad de matriz aparente», curva RHOMAA).' },
      { latex: 'Th/K = \\frac{Th\\,[\\mathrm{ppm}]}{K\\,[\\%]}', description: 'Cociente torio–potasio. Sin dato si K ≤ 0.' },
      { latex: '\\Delta t = \\Delta t_{ma} + \\phi\\,(\\Delta t_f - \\Delta t_{ma}),\\quad \\phi_N = \\phi_{N,ma}(1-\\phi) + \\phi_{Nf}\\,\\phi', description: 'Rectas de porosidad de las plantillas sónico–neutrón y densidad–sónico (Wyllie y mezcla lineal; matrices del Appendix B).' },
    ],
    references: [
      'Burke, J.A., Campbell, R.L. y Schmidt, A.W. (1969). The litho-porosity cross plot. SPWLA 10th Annual Logging Symposium.',
      'Schlumberger (1989). Log Interpretation Principles/Applications, caps. 5 y 7 (M–N, ρmaa–Umaa).',
      'Schlumberger (2013). Log Interpretation Charts, Appendix B, pp. 279–280; cartas Lith-1 (ex CP-18) y Lith-2 (ex CP-19).',
      'Wyllie, M.R.J., Gregory, A.R. y Gardner, L.W. (1956). Elastic wave velocities in heterogeneous and porous media. Geophysics 21(1).',
      'Cátedra de Interpretación de Perfiles (FIUBA), Clase 8: determinación de litologías (slides 17–33) y hoja CROSSPLOT del Excel del TP.',
    ],
    notes: 'Las cajas de minerales de PEF contra K y contra Th/K son orientativas (SIN VERIFICAR contra la carta original). Los índices suponen fluido de la zona lavada; gas, arcilla y porosidad secundaria corren los puntos.',
  },
});
