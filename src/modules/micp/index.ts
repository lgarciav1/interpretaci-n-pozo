/**
 * Módulo de panel «Análisis MICP» (docs/decisiones/0058, módulos de panel): sin puertos ni cálculo en el motor; el panel
 * está en `./dock.tsx` y el modelo puro en `./model.ts`. Las ecuaciones van solo acá, para el módulo Ecuaciones.
 */
import { definePanelModule } from '../../core/module';

export const MICP_ID = 'micp';

export default definePanelModule({
  id: MICP_ID,
  name: 'Análisis MICP',
  description: 'Usos de las curvas de inyección de mercurio: Thomeer, permeabilidad desde la curva, Sw por altura, permeabilidad relativa, cutoff de Sw y control del CMR.',
  category: 'saturation',
  workspace: 'petrophysics',
  docs: {
    summary:
      'Ajusta la hipérbola de Thomeer y Brooks–Corey a cada curva de inyección de mercurio, estima la permeabilidad desde la curva (Swanson, Thomeer), lleva la presión de laboratorio a altura sobre el nivel de agua libre, arma permeabilidades relativas de Brooks–Corey–Burdine y el flujo fraccional de agua (cutoff de Sw a fw = 0,5) y compara el agua ligada del CMR con la de la curva a la presión de calibración del corte de T2.',
    equations: [
      { latex: 'B_v = B_{v\\infty}\\,\\exp\\!\\left(-\\dfrac{G}{\\log_{10}(P_c/P_d)}\\right),\\quad P_c>P_d;\\qquad B_v=(1-S_w)\\,\\phi\\cdot 100', description: 'Hipérbola de Thomeer: Bv en % del volumen total, Pd presión de desplazamiento, G factor geométrico de poro.' },
      { latex: 'k_{Sw} = 399\\left[\\left(\\dfrac{S_b}{P_c}\\right)_{\\max}\\right]^{1{,}691}', description: 'Swanson (permeabilidad al aire, mD): ápice de Sb/Pc con Sb en % del volumen total y Pc en psi.' },
      { latex: 'k_{Th} = 3{,}8068\\,G^{-1{,}3334}\\left(\\dfrac{B_{v\\infty}}{P_d}\\right)^{2}', description: 'Thomeer (1983): k al aire en mD, Pd en psi.' },
      { latex: 'P_c = P_d\\,S_w^{*\\,-1/\\lambda},\\quad S_w^{*}=\\dfrac{S_w-S_{wirr}}{1-S_{wirr}}', description: 'Brooks–Corey en drenaje; λ índice de distribución de poros.' },
      { latex: 'P_{c,res}=P_{c,lab}\\,\\dfrac{(\\sigma\\cos\\theta)_{res}}{(\\sigma\\cos\\theta)_{lab}},\\qquad h=\\dfrac{P_{c,res}}{\\Delta\\rho\\,g}', description: 'Laboratorio (mercurio–aire, 480 dyn/cm, 140°) a reservorio y altura sobre el nivel de agua libre.' },
      { latex: 'k_{rw}=S_w^{*\\,(2+3\\lambda)/\\lambda},\\qquad k_{rnw}=(1-S_w^{*})^{2}\\left(1-S_w^{*\\,(2+\\lambda)/\\lambda}\\right)', description: 'Permeabilidades relativas de Brooks–Corey–Burdine.' },
      { latex: 'f_w=\\dfrac{1}{1+\\dfrac{k_{rnw}\\,\\mu_w}{k_{rw}\\,\\mu_{nw}}},\\qquad S_{w,cutoff}:\\ f_w=0{,}5', description: 'Flujo fraccional de agua (Buckley–Leverett, sin capilaridad ni gravedad) y cutoff de Sw.' },
      { latex: 'P_{c,Hg}=\\dfrac{100\\ \\text{psi}}{(\\sigma\\cos\\theta)_{aire-salmuera}/(\\sigma\\cos\\theta)_{Hg}}\\approx 511\\ \\text{psi}', description: 'Presión de la calibración estándar del corte de T2 del CMR llevada a mercurio–aire.' },
    ],
    references: [
      'Thomeer, J. H. M. (1960). Introduction of a pore geometrical factor defined by the capillary pressure curve. JPT 12(3): 73–77.',
      'Thomeer, J. H. M. (1983). Air permeability as a function of three pore-network parameters. JPT 35(4): 809–814.',
      'Swanson, B. F. (1981). A simple correlation between permeabilities and mercury capillary pressures. JPT 33(12): 2498–2504.',
      'Brooks, R. H. y Corey, A. T. (1964). Hydraulic properties of porous media. Hydrology Paper 3, Colorado State University.',
      'Burdine, N. T. (1953). Relative permeability calculations from pore size distribution data. Trans. AIME 198: 71–78.',
      'Buckley, S. E. y Leverett, M. C. (1942). Mechanism of fluid displacement in sands. Trans. AIME 146: 107–116.',
      'Purcell, W. R. (1949). Capillary pressures – their measurement using mercury and the calculation of permeability therefrom. Trans. AIME 186: 39–48.',
    ],
    notes: 'Motor: src/petro/micp.ts. Supuestos declarados en el panel: σ y θ de reservorio, densidades, viscosidades y profundidad del nivel de agua libre.',
  },
});
