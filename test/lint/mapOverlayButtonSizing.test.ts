import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fix — 地圖疊層按鈕高度一致化(重設視角 vs 播放/最大化). Regression guard for
 * a specific visual bug: TrackMap's `.reset-view` (a text button, ~26px tall
 * from padding+font-size alone) sat in the SAME flex row as the host's
 * `.play-toggle` (a fixed 32px icon button) once ⑤ moved the play button onto
 * the map's own top-right overlay — the height mismatch was invisible before
 * that because reset-view used to be alone at top-right while maximize-toggle
 * lived at top-left, never adjacent to either.
 *
 * happy-dom does not process `<style scoped>` blocks in this repo's test
 * setup (`vite.config.ts`'s `test` block has no `css: true`), so actual
 * computed pixel heights of mounted buttons can't be asserted from a
 * component test — see the companion structural check in
 * `test/components/TrackMap.cursorRedraw.test.ts` ("overlay-top-right slot")
 * for what CAN be verified there (that all three controls co-exist in the
 * DOM). This test instead asserts the CSS SOURCE TEXT directly: that the fix
 * (min-height parity at both pointer densities) is actually present and that
 * it can't silently regress if someone edits one button's rule but not its
 * neighbour's. It intentionally does not attempt to compute or compare real
 * pixel values — only that the specific declarations the fix relies on exist.
 *
 * Genuinely NOT verified by any automated test in this repo: what the row
 * actually looks like painted in a real browser, at both desktop and a
 * coarse-pointer (touch) device. That needs a human visual check.
 */

const trackMapSrc = readFileSync(
  join(__dirname, '..', '..', 'src', 'features', 'analyzer', 'TrackMap.vue'),
  'utf-8',
)
const mapCardSrc = readFileSync(
  join(__dirname, '..', '..', 'src', 'features', 'analyzer', 'cards', 'MapCard.vue'),
  'utf-8',
)

/** Pull out `selector { ...body... }` (the FIRST match) as raw text, so we can
 *  assert on its declarations without a full CSS parser. `selector` is the
 *  literal, UNESCAPED CSS selector (e.g. `:root[data-any-pointer-coarse]
 *  .reset-view`) — all regex-metacharacter escaping happens in here. */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`)
  const match = re.exec(source)
  if (!match) throw new Error(`rule not found: ${selector}`)
  return match[1]
}

describe('map overlay button sizing (desktop, 32px box)', () => {
  it('.reset-view grows to 32px via min-height + inline-flex centring, not a hard height (it must keep sizing to its label)', () => {
    const body = ruleBody(trackMapSrc, '.reset-view')
    expect(body).toMatch(/min-height:\s*32px/)
    expect(body).toMatch(/display:\s*inline-flex/)
    expect(body).toMatch(/align-items:\s*center/)
    // A hard `height:` would fight the label's line-height / wrapping; the
    // fix deliberately avoids it in favour of min-height.
    expect(body).not.toMatch(/(?<!min-)height:\s*32px/)
  })

  it('.maximize-toggle and MapCard\'s .play-toggle stay the reference 32px fixed icon-button size', () => {
    const maximizeBody = ruleBody(trackMapSrc, '.maximize-toggle')
    expect(maximizeBody).toMatch(/width:\s*32px/)
    expect(maximizeBody).toMatch(/height:\s*32px/)

    const playBody = ruleBody(mapCardSrc, '.play-toggle')
    expect(playBody).toMatch(/width:\s*32px/)
    expect(playBody).toMatch(/height:\s*32px/)
  })
})

describe('map overlay button sizing (§8 coarse-pointer touch targets, >=44px)', () => {
  it('all three overlay controls have a coarse-pointer rule (none was previously missing one)', () => {
    for (const [label, source, selector] of [
      ['.reset-view (TrackMap)', trackMapSrc, '.reset-view'],
      ['.maximize-toggle (TrackMap)', trackMapSrc, '.maximize-toggle'],
      ['.play-toggle (MapCard)', mapCardSrc, '.play-toggle'],
    ] as const) {
      const body = ruleBody(source, `:root[data-any-pointer-coarse] ${selector}`)
      expect(body, `${label} coarse rule should require min-height >= 44px`).toMatch(/min-height:\s*44px/)
    }
  })

  it('the two fixed-size icon buttons (.maximize-toggle, .play-toggle) also pin min-width to 44px on coarse pointers, matching shape', () => {
    const maximizeCoarse = ruleBody(trackMapSrc, ':root[data-any-pointer-coarse] .maximize-toggle')
    expect(maximizeCoarse).toMatch(/min-width:\s*44px/)

    const playCoarse = ruleBody(mapCardSrc, ':root[data-any-pointer-coarse] .play-toggle')
    expect(playCoarse).toMatch(/min-width:\s*44px/)
  })

  it('none of the fix\'s new rules use the banned :global() scoped-CSS escape hatch', () => {
    for (const source of [trackMapSrc, mapCardSrc]) {
      const styleMatch = /<style\b[^>]*scoped[^>]*>([\s\S]*?)<\/style>/.exec(source)
      expect(styleMatch).not.toBeNull()
      expect(styleMatch![1]).not.toContain(':global(')
    }
  })
})
