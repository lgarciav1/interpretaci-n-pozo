/** Ejecuta el validador real de P6a: conserva esquemas anteriores y rechaza explícitamente el nuevo. */
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
const out = process.argv[2];
if (!out)
  throw new Error("Uso: node scripts/qa/mgt-compat.mjs /tmp/mgt-browser");
const path = "src/core/preparation/__qa_mgt_legacy_state.ts";
try {
  await readFile(path);
  throw new Error(
    "El temporal de compatibilidad ya existe; no se sobrescribe.",
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const legacySource = execFileSync(
  "git",
  ["show", "25f9dd2:src/core/preparation/state.ts"],
  { encoding: "utf8" },
);
await writeFile(path, legacySource);
let server;
try {
  server = await createServer({
    root: process.cwd(),
    configFile: false,
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
  });
  const [legacy, fixture, state, preparation] = await Promise.all(
    [
      "/src/core/preparation/__qa_mgt_legacy_state.ts",
      "/tests/fixtures/mgt.ts",
      "/src/core/state/mgt.ts",
      "/src/core/state/preparation.ts",
    ].map((p) => server.ssrLoadModule(p)),
  );
  const p = fixture.mgtFixture(),
    masked = preparation.addMaskInterval(
      p,
      "w",
      "gr",
      { id: "bad", top: 106, base: 106 },
      "mask",
    );
  legacy.validatePreparation(masked.wells[0].interpretation.preparation);
  const corrected = state.setMgtCorrection(
    p,
    p,
    "w",
    "gr",
    fixture.mgtConfig,
    "mgt",
  );
  let error = "";
  try {
    legacy.validatePreparation(corrected.wells[0].interpretation.preparation);
  } catch (e) {
    error = String(e);
  }
  if (!error.includes("no admitida"))
    throw new Error("El lector P6a no rechazó explícitamente preparación 5.");
  await mkdir(out, { recursive: true });
  await writeFile(
    `${out}/compatibility.json`,
    JSON.stringify(
      {
        legacyCommit: "25f9dd2",
        legacyMaskAccepted: true,
        newMgtRejectedExplicitly: true,
        error,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  if (server) await server.close();
  await unlink(path);
}
