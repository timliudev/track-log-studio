import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * B117(b) — regression guards for DashboardCard.vue's "pick up" lift, over
 * the raw `<style>` source text (same technique test/lint/designTokens.test.ts
 * already uses) rather than a mounted-component computed-style assertion:
 * happy-dom has no real layout/cascade engine, so asserting on
 * `getComputedStyle` for a scoped `@media (prefers-reduced-motion)` rule
 * would be unreliable at best — the CLASS-toggling logic that drives
 * `.touch-dragging` is already covered by several existing mounted-component
 * tests in test/components/DashboardCard.test.ts (unmodified by this
 * feature); these two checks instead pin down the two properties that are
 * easy to silently regress in a future edit:
 *
 *  1. The lift is reduced-motion-gated (B117's own "skip the lift" spec).
 *  2. `transform`/`box-shadow` are declared on the UNCONDITIONAL `.drag-handle`
 *     transition list, not only inside `.touch-dragging` itself — see the
 *     component's own inline doc for why the LATTER would reproduce exactly
 *     the asymmetric "animates in, snaps out" bug B115 already found and
 *     fixed once for the button-press feedback (theme.css).
 */
const SOURCE = readFileSync(join(process.cwd(), 'src/components/DashboardCard.vue'), 'utf-8')

function styleBlock(): string {
  const match = /<style scoped>([\s\S]*)<\/style>/.exec(SOURCE)
  if (!match) throw new Error('DashboardCard.vue: no <style scoped> block found')
  return match[1]
}

describe('DashboardCard.vue — B117(b) drag lift affordance', () => {
  it('the lift (transform + shadow) is declared only inside a reduced-motion-no-preference media query', () => {
    const style = styleBlock()
    const mediaMatch = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(style)
    expect(mediaMatch, 'expected a `prefers-reduced-motion: no-preference` block in DashboardCard.vue').not.toBeNull()
    const mediaBody = mediaMatch![1]
    expect(mediaBody).toMatch(/\.drag-handle\.touch-dragging\s*\{[^}]*transform:\s*scale\(/)
    expect(mediaBody).toMatch(/\.drag-handle\.touch-dragging\s*\{[^}]*box-shadow:\s*var\(--shadow-\d\)/)
  })

  it('the .touch-dragging rule OUTSIDE the media query never itself sets transform/box-shadow (those live only in the gated block, and the transition lives on the unconditional base rule)', () => {
    const style = styleBlock()
    const mediaMatch = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(style)
    const withoutMedia = mediaMatch ? style.replace(mediaMatch[0], '') : style
    const ungatedTouchDragging = /\.drag-handle\.touch-dragging\s*\{([^}]*)\}/.exec(withoutMedia)
    expect(ungatedTouchDragging, 'expected exactly one ungated `.drag-handle.touch-dragging` rule (touch-action only)').not.toBeNull()
    expect(ungatedTouchDragging![1]).not.toMatch(/transform:/)
    expect(ungatedTouchDragging![1]).not.toMatch(/box-shadow:/)
  })

  it('the base .drag-handle rule\'s transition list includes transform and box-shadow (so the lift animates OUT, not just in)', () => {
    const style = styleBlock()
    const baseRule = /(?<!\.dashboard-card\.collapsed )(?<!\.touch-armed\s)\.drag-handle\s*\{([^}]*)\}/.exec(style)
    expect(baseRule, 'expected a base `.drag-handle { ... }` rule').not.toBeNull()
    const transitionLine = /transition:\s*([^;]+);/.exec(baseRule![1])
    expect(transitionLine, 'expected a `transition:` declaration on the base .drag-handle rule').not.toBeNull()
    expect(transitionLine![1]).toMatch(/\btransform\b/)
    expect(transitionLine![1]).toMatch(/\bbox-shadow\b/)
  })
})
