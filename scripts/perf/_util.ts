/**
 * Shared helpers for the perf-audit bench scripts (docs/journal/PERF-AUDIT-2026-07-08.md).
 * Not part of the app build — run standalone via `npx vite-node scripts/perf/<name>.ts`
 * (vite-node resolves the `@/` alias from vite.config.ts, so these scripts can
 * import straight from `src/domain/...` exactly like the app / vitest do).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface LogaFixture {
  label: 'small' | 'large'
  path: string
  text: string
  bytes: number
}

/**
 * Resolve the small/large `.loga` sample used for this audit. Real user logs
 * are NOT committed to the repo (read-only source data) — point these env
 * vars at your own copies to reproduce the exact numbers in the report:
 *
 *   BENCH_SMALL_LOGA=/path/to/small.loga BENCH_LARGE_LOGA=/path/to/large.loga \
 *     npx vite-node scripts/perf/bench-parse.ts
 *
 * Without the env vars, falls back to the repo's own `test/fixtures/*.loga`
 * (small, synthetic-ish samples) so the script still runs for anyone — just
 * with much smaller "large" numbers than the report's real-log figures.
 */
export function loadFixture(label: 'small' | 'large'): LogaFixture {
  const envVar = label === 'small' ? 'BENCH_SMALL_LOGA' : 'BENCH_LARGE_LOGA'
  const fromEnv = process.env[envVar]
  const fallback =
    label === 'small'
      ? resolve('test/fixtures/mxApp.loga')
      : resolve('test/fixtures/super2.loga')
  const path = fromEnv && existsSync(fromEnv) ? fromEnv : fallback
  if (fromEnv && !existsSync(fromEnv)) {
    console.warn(`[bench] ${envVar}=${fromEnv} not found, falling back to ${fallback}`)
  }
  const text = readFileSync(path, 'utf-8')
  return { label, path, text, bytes: Buffer.byteLength(text, 'utf-8') }
}

/** Median of an array of numbers (sorted copy; doesn't mutate input). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Run `fn` `runs` times, return { median, min, max, all } of elapsed ms. */
export function timeit(
  fn: () => void,
  runs = 5,
): { medianMs: number; minMs: number; maxMs: number; allMs: number[] } {
  const all: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    all.push(performance.now() - t0)
  }
  return { medianMs: median(all), minMs: Math.min(...all), maxMs: Math.max(...all), allMs: all }
}

export function fmtMs(ms: number): string {
  return `${ms.toFixed(1)}ms`
}

export function fmtBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`
}

export function fmtMem(): string {
  const m = process.memoryUsage()
  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)}MB`
  return `rss=${mb(m.rss)} heapUsed=${mb(m.heapUsed)} heapTotal=${mb(m.heapTotal)} arrayBuffers=${mb(m.arrayBuffers)}`
}

export function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}
