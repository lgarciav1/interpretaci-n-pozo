/**
 * Vuelca el registro de módulos, el flujo guiado, las categorías y los roles a `build/registry.json`.
 * Usa el cargador SSR de Vite para importar el TypeScript de `src/` tal cual lo ve la app.
 */
import { createServer } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { registry } = await server.ssrLoadModule('/src/modules/index.ts');
  const { FLOWS } = await server.ssrLoadModule('/src/app/flow/flow.ts');
  const { WORKSPACES } = await server.ssrLoadModule('/src/core/workspaces.ts');
  const { unitLabel } = await server.ssrLoadModule('/src/core/units.ts');
  const ul = (u) => (u ? unitLabel(u) : null);
  const roleLabel = (id) => {
    const r = registry.roles.get(id);
    return r ? { id, label: r.label, unit: ul(r.unit) } : { id, label: id, unit: null };
  };
  const port = (spec) => (spec.kind === 'curve' ? spec.role : spec.port);
  const modules = registry.modules.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description ?? null,
    category: m.category,
    categoryLabel: registry.categoryLabel(m.category),
    workspace: Array.isArray(m.workspace) ? m.workspace : [m.workspace],
    inputs: Object.entries(m.inputs).map(([key, s]) => ({ key, kind: s.kind, port: port(s), optional: !!s.optional, label: s.label ?? null, role: s.kind === 'curve' ? roleLabel(s.role) : null })),
    inputGroups: (m.inputGroups ?? []).map((g) => ({ inputs: [...g.inputs], min: g.min ?? 1, label: g.label ?? null })),
    params: Object.entries(m.params).map(([key, s]) => ({ key, ...JSON.parse(JSON.stringify(s)), unitLabel: ul(s.unit) })),
    outputs: Object.entries(m.outputs).map(([key, s]) => ({ key, kind: s.kind, port: port(s), label: s.label ?? null, unit: ul(s.unit), hidden: !!s.hidden, role: s.kind === 'curve' ? roleLabel(s.role) : null })),
    docs: JSON.parse(JSON.stringify(m.docs)),
  }));
  const roles = registry.roles.all().map((r) => ({ id: r.id, label: r.label, unit: ul(r.unit), family: r.family, origin: r.origin, description: r.description ?? null, color: r.display?.color ?? null }));
  // Tabla de mnemónicos: se lee del fuente (la tabla es privada del lector).
  const mnemonics = [];
  const src = readFileSync(path.join(root, 'src/io/mnemonics.ts'), 'utf8');
  for (const m of src.matchAll(/^add\((?:'([^']+)'|null), '([^']+)', '(\w+)', \[([^\]]+)\]\);/gm)) {
    mnemonics.push({ role: m[1] ?? null, unit: ul(m[2]), confidence: m[3], aliases: [...m[4].matchAll(/'([^']+)'/g)].map((a) => a[1]) });
  }
  const out = {
    generated: new Date().toISOString(),
    workspaces: WORKSPACES,
    categories: registry.categories,
    flows: JSON.parse(JSON.stringify(FLOWS)),
    modules,
    roles,
    mnemonics,
  };
  mkdirSync(path.join(here, 'build'), { recursive: true });
  writeFileSync(path.join(here, 'build', 'registry.json'), JSON.stringify(out, null, 2));
  console.log(`registro: ${modules.length} módulos, ${registry.categories.length} categorías`);
} finally {
  await server.close();
}
