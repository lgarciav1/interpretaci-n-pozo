/** Adquisición QA sintética; no admite ninguna corrección numérica. */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
const out = process.argv[2];
if (!out)
  throw new Error("Uso: node scripts/qa/environment-seed.mjs /tmp/p6a-seed");
await mkdir(out, { recursive: true });
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  server: { middlewareMode: true, watch: null, ws: false },
  appType: "custom",
});
try {
  const fixture = await server.ssrLoadModule("/tests/fixtures/environment.ts");
  const { serializeProject } = await server.ssrLoadModule(
    "/src/core/state/serialize.ts",
  );
  await writeFile(
    `${out}/unknown.pozo.json`,
    await serializeProject(fixture.environmentFixture()),
  );
} finally {
  await server.close();
}
