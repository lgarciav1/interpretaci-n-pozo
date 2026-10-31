/** Reusa el fixture sintético explícito de clasificación con φ y Sw conocidas. */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
const out = process.argv[2];
if (!out)
  throw new Error("Uso: node scripts/qa/xrd-cutoff-seed.mjs /tmp/p5c-seed");
await mkdir(out, { recursive: true });
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  server: { middlewareMode: true, watch: null, ws: false },
  appType: "custom",
});
try {
  const fixture = await server.ssrLoadModule("/tests/fixtures/xrd-cutoff.ts");
  const { serializeProject } = await server.ssrLoadModule(
    "/src/core/state/serialize.ts",
  );
  await writeFile(
    `${out}/full.pozo.json`,
    await serializeProject(fixture.cutoffFixture()),
  );
  await writeFile(
    `${out}/missing.pozo.json`,
    await serializeProject(
      fixture.cutoffFixture(fixture.cutoffContract, false),
    ),
  );
} finally {
  await server.close();
}
