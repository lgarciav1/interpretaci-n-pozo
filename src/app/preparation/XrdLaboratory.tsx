import { pointNumbers, pointTexts, type PointSet } from "../../core/pointSets";
import { xrdContract } from "../../core/preparation/xrd";
export function XrdLaboratory({ set }: { set: PointSet }) {
  try {
    const c = xrdContract(set);
    return (
      <details>
        <summary>Ver datos originales del ensayo DRX</summary>
        <p>
          {c.report}. {c.basis === "mass" ? "Masa" : "Volumen de sólidos"};{" "}
          {c.scale === "percent" ? "porcentajes" : "fracciones"}.{" "}
          {c.uncertaintyNote ??
            "Sin descripción de incertidumbre en el ensayo."}{" "}
          Los límites no se convierten en valores medidos ni en ceros. La
          incertidumbre no se propaga automáticamente.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="prep-editor__table">
            <caption>Laboratorio original · primeras 200 muestras</caption>
            <thead>
              <tr>
                <th>Muestra</th>
                <th>Mineral</th>
                <th>Valor</th>
                <th>Estado</th>
                <th>Incertidumbre absoluta</th>
                <th>Límite de detección</th>
              </tr>
            </thead>
            <tbody>
              {set.pointIds.slice(0, 200).flatMap((id, i) =>
                c.minerals.map((m) => (
                  <tr key={id + ":" + m.id}>
                    <td>{id}</td>
                    <td>{m.name}</td>
                    {[`mineral:${m.id}`].map((k) => (
                      <td key={k}>
                        {Number.isFinite(pointNumbers(set, k)?.[i])
                          ? pointNumbers(set, k)![i]
                          : "—"}
                      </td>
                    ))}
                    <td>{pointTexts(set, `status:${m.id}`)?.[i]}</td>
                    {[`uncertainty:${m.id}`, `limit:${m.id}`].map((k) => (
                      <td key={k}>
                        {Number.isFinite(pointNumbers(set, k)?.[i])
                          ? pointNumbers(set, k)![i]
                          : "—"}
                      </td>
                    ))}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    );
  } catch (e) {
    return <p role="alert">{String(e)}</p>;
  }
}
