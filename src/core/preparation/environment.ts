/** P6a: relevamiento y barreras de admisión. No contiene evaluadores ambientales. */
import type {
  AcquisitionMetadata,
  AcquisitionRun,
} from "../inputs/acquisition";
import type { ToolCatalog } from "../tools";
import type { Curve, Well } from "../well";
import type { UnitId } from "../units";

export const ENVIRONMENT_EFFECTS = [
  { id: "borehole", label: "Efecto del pozo" },
  { id: "standoff", label: "Separación herramienta–pared" },
  { id: "mudcake", label: "Revoque" },
  { id: "invasion", label: "Invasión" },
  { id: "shoulder-bed", label: "Capas adyacentes" },
  { id: "temperature", label: "Temperatura" },
  { id: "pressure", label: "Presión" },
  { id: "mud-salinity", label: "Salinidad/conductividad del lodo" },
] as const;
export interface EnvironmentalCandidate {
  id: string;
  catalogVersion: 1;
  name: string;
  toolIds: readonly string[];
  targets: readonly { role: string; unit: UnitId }[];
  effects: readonly string[];
  survey: readonly { role: string; label: string; unit: UnitId }[];
  metadata: string;
  limitation: string;
  reference: { title: string; url: string };
  /** La bibliografía descriptiva no es un contrato numérico ni permiso de redistribuir cartas. */
  admission: {
    status: "not-admitted";
    algorithmVersion: null;
    chartVersion: null;
    domain: null;
    redistribution: null;
    independentCases: readonly [];
  };
}
const general = {
  title: "SLB · Environmental corrections (referencia descriptiva)",
  url: "https://glossary.slb.com/en/terms/e/environmental_corrections",
};
const pending = {
  status: "not-admitted" as const,
  algorithmVersion: null,
  chartVersion: null,
  domain: null,
  redistribution: null,
  independentCases: [] as const,
};
const geometry = [
  { role: "CALI", label: "Caliper", unit: "in" as const },
  { role: "BS", label: "Trépano", unit: "in" as const },
];
export const ENVIRONMENT_CANDIDATES: readonly EnvironmentalCandidate[] = [
  {
    id: "gamma-borehole",
    catalogVersion: 1,
    name: "GR · pozo y lodo",
    toolIds: ["gr", "spectral-gr"],
    targets: [
      { role: "GR", unit: "gAPI" },
      { role: "CGR", unit: "gAPI" },
    ],
    effects: ["borehole", "mud-salinity"],
    survey: geometry,
    metadata:
      "Modelo/calibración, geometría, densidad y composición del lodo según procedimiento de la herramienta.",
    limitation: "No hay un factor universal de GR por diámetro o lodo.",
    reference: general,
    admission: pending,
  },
  {
    id: "density-provider",
    catalogVersion: 1,
    name: "Densidad/PE · compensación del proveedor",
    toolIds: ["density"],
    targets: [
      { role: "RHOB", unit: "g/cm3" },
      { role: "PEF", unit: "b/e" },
    ],
    effects: ["borehole", "standoff", "mudcake"],
    survey: [
      ...geometry,
      {
        role: "DRHO",
        label: "Corrección de densidad del proveedor",
        unit: "g/cm3",
      },
    ],
    metadata:
      "Modelo, significado de RHOB/DRHO, estado del procesado, revoque, standoff y composición del lodo.",
    limitation:
      "DRHO describe una compensación aplicada; su presencia no autoriza sumarla a RHOB. Caliper no determina por sí solo standoff o revoque.",
    reference: {
      title: "SLB · Delta rho (referencia descriptiva)",
      url: "https://glossary.slb.com/terms/d/delta_rho",
    },
    admission: pending,
  },
  {
    id: "neutron-environment",
    catalogVersion: 1,
    name: "Neutrón · condiciones de adquisición",
    toolIds: ["neutron"],
    targets: [{ role: "NPHI", unit: "v/v" }],
    effects: ["borehole", "temperature", "pressure", "mud-salinity", "mudcake"],
    survey: geometry,
    metadata:
      "Modelo, escala litológica, lodo, salinidad y condiciones de temperatura/presión exigidas por su carta.",
    limitation:
      "Las cartas de modelos y escalas litológicas distintas no son intercambiables.",
    reference: general,
    admission: pending,
  },
  {
    id: "induction-environment",
    catalogVersion: 1,
    name: "Inducción · procesado ambiental",
    toolIds: ["induction"],
    targets: ["RT", "RM", "RS", "RA10", "RA20", "RA30"].map((role) => ({
      role,
      unit: "ohm.m",
    })),
    effects: ["borehole", "invasion", "shoulder-bed", "mud-salinity"],
    survey: geometry,
    metadata:
      "Modelo/respuesta, procesado aplicado, Rm/Rmf con temperaturas y geometría; condiciones según fabricante.",
    limitation:
      "AT90 no confirma modelo de herramienta ni demuestra Rt de formación virgen. No se corrige invasión solo por separación de curvas.",
    reference: {
      title: "SLB · Induction (referencia descriptiva)",
      url: "https://glossary.slb.com/en/terms/i/induction",
    },
    admission: pending,
  },
  {
    id: "laterolog-environment",
    catalogVersion: 1,
    name: "Laterolog · pozo y capas adyacentes",
    toolIds: ["laterolog", "microresistivity"],
    targets: ["RT", "RM", "RS", "RXO"].map((role) => ({ role, unit: "ohm.m" })),
    effects: [
      "borehole",
      "invasion",
      "shoulder-bed",
      "mud-salinity",
      "mudcake",
    ],
    survey: geometry,
    metadata:
      "Modelo, lodo conductor, Rm/Rmf/Rmc con temperatura y geometría según procedimiento.",
    limitation:
      "Una corrección de inducción no es una corrección de laterolog.",
    reference: general,
    admission: pending,
  },
  {
    id: "sonic-environment",
    catalogVersion: 1,
    name: "Sónico · calidad y condiciones del pozo",
    toolIds: ["sonic"],
    targets: [
      { role: "DT", unit: "us/ft" },
      { role: "DTS", unit: "us/ft" },
    ],
    effects: ["borehole"],
    survey: geometry,
    metadata:
      "Tipo de adquisición, modelo, indicadores de calidad/forma de onda y procedimiento documentado.",
    limitation:
      "No se corrigen saltos de ciclo ni ruido mediante caliper solamente.",
    reference: general,
    admission: pending,
  },
];
export interface EnvironmentalBlocker {
  code: string;
  message: string;
}
export interface EnvironmentalReview {
  candidate: EnvironmentalCandidate;
  executable: false;
  run: AcquisitionRun | null;
  attributedTool: string | null;
  blockers: EnvironmentalBlocker[];
  survey: {
    label: string;
    expectedUnit: UnitId;
    curves: { id: string; mnemonic: string; unit: UnitId }[];
  }[];
}
export function reviewEnvironment(
  well: Well,
  acquisition: AcquisitionMetadata,
  curve: Curve,
  tools: ToolCatalog,
): EnvironmentalReview[] {
  const run =
    acquisition.runs.find((r) => r.curveIds.includes(curve.id)) ?? null;
  const attributedTool = tools.ownerOf(curve)?.name ?? null;
  return ENVIRONMENT_CANDIDATES.filter((c) =>
    c.targets.some((t) => t.role === curve.role),
  ).map((candidate) => {
    const blockers: EnvironmentalBlocker[] = [];
    const block = (code: string, message: string) =>
      blockers.push({ code, message });
    block(
      "scientific-admission",
      "Falta admitir algoritmo/carta con versión, dominio, licencia, incertidumbre o limitación publicada y casos numéricos independientes. No ejecutable.",
    );
    if (curve.origin.kind !== "measured")
      block(
        "original",
        "Se requiere una medición original y su historia de procesado; una salida calculada no la reemplaza.",
      );
    if (
      candidate.targets.find((t) => t.role === curve.role)?.unit !== curve.unit
    )
      block(
        "unit",
        "Unidad distinta de la relevada; la futura admisión debe declarar su conversión.",
      );
    if (!run)
      block(
        "run",
        "Falta asignar esta curva a una corrida de adquisición conocida.",
      );
    else {
      if (!run.tool.catalogId)
        block(
          "tool",
          "Familia de herramienta sin declarar. La atribución por mnemónico no la confirma.",
        );
      else if (!candidate.toolIds.includes(run.tool.catalogId))
        block(
          "tool-mismatch",
          "La herramienta declarada no corresponde a esta familia de corrección.",
        );
      if (!run.tool.vendor || !run.tool.model)
        block(
          "model",
          "Faltan fabricante/modelo confirmados de la herramienta.",
        );
      if (run.corrections.status === "unknown")
        block(
          "processing-unknown",
          "Procesado adquirido desconocido: no se puede descartar una doble corrección.",
        );
      else if (!run.corrections.effects.length)
        block(
          "empty-history",
          "Sin efectos registrados no certifica que la curva esté cruda o libre de este efecto.",
        );
      for (const e of run.corrections.effects) {
        const label =
          ENVIRONMENT_EFFECTS.find((known) => known.id === e.effect)?.label ??
          e.effect;
        if (candidate.effects.includes(e.effect))
          block(
            "already-applied",
            `Efecto '${label}' ya declarado como aplicado (${e.method}); no reaplicar.`,
          );
        else if (!ENVIRONMENT_EFFECTS.some((known) => known.id === e.effect))
          block(
            "unclassified-effect",
            `Efecto adquirido '${e.effect}' sin correspondencia conocida; revisar compatibilidad.`,
          );
      }
    }
    block(
      "method-inputs",
      "Falta contrastar las condiciones y entradas definitivas del modelo específico; el relevamiento no es admisión.",
    );
    return {
      candidate,
      executable: false,
      run,
      attributedTool,
      blockers,
      survey: candidate.survey.map((input) => ({
        label: input.label,
        expectedUnit: input.unit,
        curves: well.curves
          .filter((c) => c.role === input.role)
          .map((c) => ({ id: c.id, mnemonic: c.mnemonic, unit: c.unit })),
      })),
    };
  });
}
