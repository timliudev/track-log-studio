import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * B133 — regression guard for "sector card header eats the whole card when
 * gate count explodes". Root cause: `CardFillScroll`'s `.card-fill-scroll__
 * header` was `flex: 0 0 auto` with NO height ceiling, while `.card-fill-
 * scroll__content` was `flex: 1 1 auto; min-height: 0` — a header whose
 * natural height grows with data (SectorPanel's `.optimal-sectors`, one
 * `<li>` per detected sector gate, sitting in the `#header` slot per B47)
 * could grow large enough to squeeze the content pane (the actual gate list
 * + remove buttons) to 0 height, making it disappear and become
 * unreachable. Real-world trigger: ~142 auto-detected gates on a large
 * circuit (`.rcz`, ~3.5km/lap).
 *
 * happy-dom does not process `<style scoped>` blocks in this repo's test
 * setup (`vite.config.ts`'s `test` block has no `css: true`), so the actual
 * computed/rendered heights can't be asserted from a mounted component (see
 * the identical caveat in `test/lint/mapOverlayButtonSizing.test.ts`). This
 * test instead asserts the CSS SOURCE TEXT directly: that both halves of the
 * fix — (a) SectorPanel's own `.optimal-sectors` cap, and (b) CardFillScroll's
 * general-purpose `.card-fill-scroll__header` cap — are present and can't
 * silently regress if either rule gets edited away.
 */

const cardFillScrollSrc = readFileSync(
  join(__dirname, '..', '..', 'src', 'components', 'CardFillScroll.vue'),
  'utf-8',
)
const sectorPanelSrc = readFileSync(
  join(__dirname, '..', '..', 'src', 'features', 'analyzer', 'SectorPanel.vue'),
  'utf-8',
)

/** Pull out `selector { ...body... }` (the FIRST match) as raw text, so we can
 *  assert on its declarations without a full CSS parser. `selector` is the
 *  literal, UNESCAPED CSS selector — all regex-metacharacter escaping
 *  happens in here. */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`)
  const match = re.exec(source)
  if (!match) throw new Error(`rule not found: ${selector}`)
  return match[1]
}

describe('B133 — CardFillScroll header height cap (general-purpose fix)', () => {
  it('.card-fill-scroll__header caps its own height at 50% and scrolls internally past that', () => {
    const body = ruleBody(cardFillScrollSrc, '.card-fill-scroll__header')
    expect(body).toMatch(/max-height:\s*50%/)
    expect(body).toMatch(/overflow-y:\s*auto/)
  })

  it('.card-fill-scroll__content keeps flex:1 1 auto + min-height:0 so it still claims the remaining space', () => {
    const body = ruleBody(cardFillScrollSrc, '.card-fill-scroll__content')
    expect(body).toMatch(/flex:\s*1 1 auto/)
    expect(body).toMatch(/min-height:\s*0/)
  })

  it('does not use the banned :global() scoped-CSS escape hatch', () => {
    const styleMatch = /<style\b[^>]*scoped[^>]*>([\s\S]*?)<\/style>/.exec(cardFillScrollSrc)
    expect(styleMatch).not.toBeNull()
    expect(styleMatch![1]).not.toContain(':global(')
  })
})

describe('B133 — SectorPanel .optimal-sectors local height cap', () => {
  it('caps its height with a relative-plus-ceiling value and scrolls internally', () => {
    const body = ruleBody(sectorPanelSrc, '.optimal-sectors')
    expect(body).toMatch(/max-height:\s*min\(30vh,\s*160px\)/)
    expect(body).toMatch(/overflow-y:\s*auto/)
  })
})
