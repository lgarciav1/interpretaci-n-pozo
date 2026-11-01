import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";
const out = process.argv[2];
if (!out)
  throw new Error("Uso: node scripts/qa/delivery-seed.mjs /tmp/p8-seed");
await mkdir(out, { recursive: true });
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  server: { middlewareMode: true, watch: null, ws: false },
  appType: "custom",
});
try {
  const { readWellFile } = await server.ssrLoadModule("/src/io/index.ts");
  const { addWell, createProject } = await server.ssrLoadModule(
    "/src/core/state/project.ts",
  );
  const { serializeProject } = await server.ssrLoadModule(
    "/src/core/state/serialize.ts",
  );
  const { enableProjectInputRevisions } = await server.ssrLoadModule(
    "/src/core/state/inputRevisions.ts",
  );
  const { deliveryFixture } = await server.ssrLoadModule(
    "/tests/fixtures/delivery.ts",
  );
  const { well, zones } = readWellFile(
    await readFile("datos/pozo_tp_perfiles.csv", "utf8"),
    "pozo_tp_perfiles.csv",
  );
  const tp = addWell(
    createProject(
      "TP base: datos originales, interpretación inicial sin validar",
    ),
    well,
    zones,
  );
  const nphi = well.curves.find((c) => c.role === "NPHI");
  const bad = nphi.data.findIndex((v) => v > 1);
  await writeFile(`${out}/TP-legado-v6.pozo.json`, await serializeProject(tp));
  await writeFile(
    `${out}/TP-base.pozo.json`,
    await serializeProject(enableProjectInputRevisions(tp)),
  );
  await writeFile(
    `${out}/Ejemplo-sintetico.pozo.json`,
    await serializeProject(await deliveryFixture()),
  );
  await writeFile(
    `${out}/meta.json`,
    JSON.stringify(
      {
        tp: {
          samples: well.depth.values.length,
          nphiId: nphi.id,
          reviewDepth: well.depth.values[bad],
          originalValue: nphi.data[bad],
        },
        synthetic: {
          samples: 201,
          locations: 18,
          grClean: 25,
          grShale: 135,
          cutoff: 0.5,
        },
        warning:
          "TP base sin interpretación académica final; el otro ejemplo es explícitamente sintético.",
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
