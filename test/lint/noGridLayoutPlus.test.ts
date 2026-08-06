import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pkg from '../../package.json'

/**
 * F6 stage 4 — `grid-layout-plus` (and the `interactjs` it pulled in) powered
 * the dashboard until the CSS Grid renderer replaced it. The library
 * positioned every card `position: absolute`, which is mutually exclusive
 * with `position: sticky` and forced pinning to be faked by Teleporting a
 * pinned card out of the grid into a separate strip — the behaviour the user
 * rejected. Now that cards are ordinary in-flow CSS Grid items, pinning is a
 * plain `position: sticky` in the card's own slot.
 *
 * This guard keeps the dependency from creeping back: an accidental
 * re-install (or an import added from a stale example) would silently
 * reintroduce the absolute-positioning constraint that the whole migration
 * existed to remove.
 *
 * Comments that merely MENTION the old library (explaining why a class name
 * or fallback still exists) are fine — only real `import`/`from` statements
 * and a package.json dependency are banned.
 */

const SRC = join(__dirname, '..', '..', 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|vue)$/.test(entry) ? [full] : []
  })
}

describe('F6 stage 4 — grid-layout-plus is fully removed', () => {
  it('is not a dependency in package.json', () => {
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...((pkg as { devDependencies?: Record<string, string> }).devDependencies ?? {}),
    }
    expect(Object.keys(deps)).not.toContain('grid-layout-plus')
  })

  it('is not imported anywhere under src/', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, 'utf-8')
      // Real module resolution only — `from 'grid-layout-plus'` or
      // `import('grid-layout-plus')`. Prose mentions in comments are allowed.
      return /(?:from|import\s*\()\s*['"]grid-layout-plus['"]/.test(text)
    })
    expect(offenders).toEqual([])
  })
})
