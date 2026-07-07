/**
 * Perf audit — parsing bench (docs/PERF-AUDIT-2026-07-08.md, item 2).
 *
 * Measures `parseLoga` (raw .loga text -> LogSession) and the RC3/.nmea
 * export path (LogSession -> RaceChrono .nmea text) for a small and a large
 * real-world log. Rerun with:
 *
 *   npx vite-node scripts/perf/bench-parse.ts
 *
 * To reproduce the report's exact numbers, point at real logs (never commit
 * them — they're read-only user data):
 *
 *   BENCH_SMALL_LOGA=/path/small.loga BENCH_LARGE_LOGA=/path/large.loga \
 *     npx vite-node scripts/perf/bench-parse.ts
 */
import { parseLoga } from '../../src/domain/parsing/LogaParser'
import { Rc3NmeaExporter } from '../../src/domain/export/rc3Nmea/Rc3NmeaExporter'
import { loadFixture, timeit, fmtMs, fmtBytes, fmtMem, section } from './_util'

const RUNS = 7
const exporter = new Rc3NmeaExporter()

for (const label of ['small', 'large'] as const) {
  const fixture = loadFixture(label)
  section(`${label} — ${fixture.path} (${fmtBytes(fixture.bytes)})`)

  const parseStats = timeit(() => {
    parseLoga(fixture.text)
  }, RUNS)
  console.log(
    `parseLoga: median=${fmtMs(parseStats.medianMs)} min=${fmtMs(parseStats.minMs)} max=${fmtMs(parseStats.maxMs)} (n=${RUNS} runs)`,
  )
  console.log(`  all runs: ${parseStats.allMs.map((m) => m.toFixed(0)).join(', ')} ms`)

  const session = parseLoga(fixture.text)
  console.log(`  rowCount=${session.rowCount} channels=${session.channels.length}`)

  const exportStats = timeit(() => {
    exporter.export(session)
  }, RUNS)
  console.log(
    `Rc3NmeaExporter.export: median=${fmtMs(exportStats.medianMs)} min=${fmtMs(exportStats.minMs)} max=${fmtMs(exportStats.maxMs)}`,
  )

  console.log(`  memory after parse: ${fmtMem()}`)
}
