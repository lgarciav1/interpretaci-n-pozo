/** Proyecto del CSV real, con metadatos desconocidos, y variante con caliper ambiguo. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";
const output = process.argv[2];
if (!output)
  throw new Error(
    "Uso: node scripts/qa/environment-diagnostics-seed.mjs /tmp/environment-seed",
  );
await mkdir(output, { recursive: true });
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  server: { middlewareMode: true, watch: null, ws: false },
  appType: "custom",
});
try {
  const { readWellFile } = await server.ssrLoadModule("/src/io/index.ts");
  const { createProject, addWell } = await server.ssrLoadModule(
    "/src/core/state/project.ts",
  );
  const { serializeProject } = await server.ssrLoadModule(
    "/src/core/state/serialize.ts",
  );
  const csv = await readFile("datos/pozo_tp_perfiles.csv", "utf8");
  for (const kind of ["tp", "ambiguous"]) {
    const { well, zones } = readWellFile(csv, "pozo_tp_perfiles.csv");
    if (kind === "ambiguous") {
      const caliper = well.curves.find((c) => c.role === "CALI");
      well.curves.push({
        ...caliper,
        id: "qa-caliper-duplicate",
        mnemonic: "CAL alternativo QA",
      });
    }
    const project = addWell(
      createProject("TP · diagnóstico con datos disponibles"),
      well,
      zones,
    );
    await writeFile(
      `${output}/${kind}.pozo.json`,
      await serializeProject(project),
    );
  }
} finally {
  await server.close();
}
