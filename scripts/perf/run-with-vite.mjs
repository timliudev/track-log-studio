// Tiny loader so the bench-*.ts scripts (which import straight from
// `src/domain/...` via the `@/` alias, exactly like the app and vitest do)
// can run under plain `node` without a dedicated TS-execution dependency.
// Node's own native TS type-stripping (stable since Node 23.6, no flag
// needed here on Node 26) handles the TS syntax fine, but plain ESM
// resolution can't follow the `@/` alias or extensionless relative
// specifiers that `src/` uses throughout — so this boots Vite's own dev
// server in middleware mode (no plugins, just the same `@/` alias
// vite.config.ts declares) and uses its SSR module runner to load the
// target file. Uses only `vite` itself, already a project devDependency —
// no new dependency (e.g. vite-node/tsx/ts-node) needed.
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

async function main() {
  const target = process.argv[2]
  if (!target) {
    console.error('usage: node scripts/perf/run-with-vite.mjs <script.ts>')
    process.exitCode = 1
    return
  }
  const server = await createServer({
    configFile: false,
    root,
    resolve: { alias: { '@': resolve(root, 'src') } },
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    logLevel: 'warn',
  })
  try {
    await server.ssrLoadModule(resolve(root, target))
  } finally {
    await server.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
