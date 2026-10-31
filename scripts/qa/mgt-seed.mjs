/** Fixture MGT explícitamente sintético; la variante desconocida nunca debe habilitarse. */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
const out = process.argv[2];
if (!out) throw new Error("Uso: node scripts/qa/mgt-seed.mjs /tmp/mgt-seed");
await mkdir(out, { recursive: true });
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  server: { middlewareMode: true, watch: null, ws: false },
  appType: "custom",
});
try {
  const { mgtFixture } = await server.ssrLoadModule("/tests/fixtures/mgt.ts");
  const { reviseProjectInputs } = await server.ssrLoadModule(
    "/src/core/state/inputRevisions.ts",
  );
  const { serializeProject } = await server.ssrLoadModule(
    "/src/core/state/serialize.ts",
  );
  const p = mgtFixture();
  await writeFile(`${out}/known.pozo.json`, await serializeProject(p));
  const e = p.wells[0];
  for (const kind of ["unknown", "prior", "setup"]) {
    const acquisition = structuredClone(
      p.inputRevisions[e.inputRevisionId].acquisition,
    );
    if (kind === "setup") {
      acquisition.depth.datum = null;
      acquisition.runs[0].tool = { catalogId: null, vendor: null, model: null };
      acquisition.runs[0].corrections.status = "unknown";
    } else if (kind === "unknown") acquisition.runs[0].tool.model = null;
    else
      acquisition.runs[0].corrections.effects = [
        {
          effect: "borehole",
          method: "Proveedor QA",
          version: "1",
          reference: "Informe sintético: efecto ya corregido",
        },
      ];
    await writeFile(
      `${out}/${kind}.pozo.json`,
      await serializeProject(reviseProjectInputs(p, "w", { acquisition })),
    );
  }
} finally {
  await server.close();
}
