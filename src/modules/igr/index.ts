/**
 * Módulo IGR — índice de rayos gamma.
 *
 * EJEMPLO DE FASE 1: demuestra el contrato de módulo (entradas por rol, parámetros por zona, salida de curva).
 * La petrofísica real (y su validación contra ejemplos de libro) es la fase 5.
 *
 * Definición PURA: no importar React ni nada de la interfaz (la ejecuta el Web Worker).
 */
import { defineModule, input, output } from "../../core/module";
import { gammaRayIndexInto } from "../../petro/igr";
import { SHARED_PARAMS } from "../sharedParams";

export default defineModule({
  id: "igr",
  name: "Índice de rayos gamma",
  description:
    "Normaliza el perfil de rayos gamma entre la línea de arena limpia y la de arcilla.",
  category: "shale",
  workspace: "petrophysics",
  inputs: {
    gr: input.curve("GR"),
  },
  params: {
    // Compartidos: los usan también otros métodos de arcillosidad (ver sharedParams.ts).
    grClean: SHARED_PARAMS.grClean,
    grShale: SHARED_PARAMS.grShale,
  },
  outputs: {
    igr: output.curve("IGR"),
  },
  compute({ n, inputs, segments, zones, warn }) {
    const out = new Float64Array(n);
    for (const s of segments) {
      if (s.params.grShale <= s.params.grClean) {
        const where = s.zoneId
          ? `en la zona ${zones.find((z) => z.id === s.zoneId)?.name ?? s.zoneId}`
          : "fuera de las zonas";
        warn(
          `${where}, el GR de arcilla no supera al de arena limpia: el índice queda sin dato.`,
        );
      }
      gammaRayIndexInto(
        inputs.gr,
        out,
        s.params.grClean,
        s.params.grShale,
        s.start,
        s.end,
      );
    }
    return { igr: out };
  },
  docs: {
    summary:
      "Índice de rayos gamma: posición relativa de la lectura de GR entre la arena limpia y la arcilla.",
    equations: [
      {
        latex: "t=1.316D-3.5,\\quad GR_c=CF(t)GR",
        description: "Preparación ambiental opcional y específica LDEO MGT: agua de mar, pozo abierto, profundidad ambiente máxima declarada 5000 m. No se aplica a GR genérico. D en pulgadas; guarda operativa >3,375 in y ≤42 cm, sin extrapolación. Incertidumbre empírica no cuantificada (ADR 0050).",
      },
      {
        latex: "CF_c=0.82-0.00131t+0.00559t^2-0.000245t^3+0.0000047t^4,\\quad CF_e=0.812+0.0244t+0.000136t^2-0.00000822t^3",
        description: "MGT centrado (c) o excéntrico (e), posición declarada. Ecuaciones publicadas 2–4, no una carta universal. Las guardas de implementación no son un dominio experimental certificado.",
      },
      {
        latex: "I_{GR} = \\frac{GR - GR_{limpia}}{GR_{arcilla} - GR_{limpia}}",
        description: "Se recorta al intervalo [0, 1].",
      },
      {
        latex: "GR = a + b\\,C, \\qquad GR_{limpia}=a,\\quad GR_{lutita}=a+b",
        description:
          "Calibración lineal opcional con DRX: C es un proxy volumétrico de Vsh declarado por el usuario, nunca una equivalencia universal entre arcillas y lutita. Mínimos cuadrados GR–C con pendiente positiva, pesos iguales por localización y validación por bloques.",
      },
      {
        latex:
          "\\min_{GR_{limpia},GR_{lutita}}\\sum_k \\left[f_{Vsh}(I_{GR,k})-C_k\\right]^2",
        description:
          "Métodos no lineales: búsqueda acotada con la función real de Vsh y el IGR recortado del motor. Se aplican dominio/step del esquema y se recalculan métricas tras redondear. No cambia cutoffs.",
      },
      {
        latex: "GR_k = c + (s-c)\\,C_k",
        description:
          "Con extremo limpio c externo fijo, el lineal estima solo s por mínimos cuadrados con intercepto fijado; con s externo, estima solo c. La referencia externa se conserva exactamente y no se confunde con un extremo identificado por el ensayo. Para métodos no lineales se restringe la búsqueda a un solo parámetro con la función real de Vsh (ADR 0046).",
      },
    ],
    references: [
      "Goldberg, D., Meltser, A., Myers, G. y Masterson, W. (2004). Comparison of Multi-Sensor Spectral Gamma Ray Tool (MGT) and conventional spectral gamma ray logs, ODP Site 1179. Proc. ODP Sci. Results 191, cap. 6, pp.5,10,18; ecuaciones 2–4. https://www-odp.tamu.edu/publications/191_SR/VOLUME/CHAPTERS/004.PDF",
      "Asquith, G. y Krygowski, D. (2004). Basic Well Log Analysis, 2.ª ed. AAPG Methods in Exploration 16.",
      "Draper, N. R. y Smith, H. (1998). Applied Regression Analysis, 3.ª ed. Wiley. La admisión por bloques y sus umbrales operativos se documentan en ADR 0045.",
    ],
  },
});
