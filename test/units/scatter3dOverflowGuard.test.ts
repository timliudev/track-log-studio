import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * B113-follow-up — the 3D scatter chart's "亂彈"/scrollbar flicker was NOT
 * fixed by B113's `sizeChangedEnoughToApply` 1px echo guard (that guard
 * targets a sub-pixel relayout echo, a different mechanism). The actual
 * cause: zrender appends its own `domRoot` div as a child of
 * Scatter3dChart.vue's `.scatter-3d` host with an EXPLICIT inline pixel
 * width/height (see node_modules/zrender/lib/canvas/Painter.js's
 * `createRoot`/`resize`), which — with the default `overflow: visible` —
 * could transiently exceed the host's own CSS-flex-computed box and spill
 * into DashboardCard's `.body`, inflating its scrollHeight/scrollWidth and
 * showing scrollbars. Those scrollbars eat ~15-17px of `.body`'s content box
 * per axis, which the chart's ResizeObserver reacts to as a genuine resize
 * (well above B113's 1px threshold) — shrink, scrollbars vanish, box regains
 * the ~15-17px, observer fires again, forever.
 *
 * This headless test CANNOT reproduce the oscillation itself — jsdom/
 * happy-dom don't implement real layout, so `overflow`/`scrollHeight`/
 * `ResizeObserver` interactions can't be driven end-to-end here (see this
 * PR's ISSUES.md entry for what remains unverified without a real browser).
 * What it CAN do is pin down, as a static regression guard, that the actual
 * fix — `overflow: hidden` on `.scatter-3d` (clips any transient domRoot/box
 * size mismatch before it can ever reach `.body`'s scrollable area) plus
 * `tooltip.appendToBody: true` (so the tooltip, which echarts would otherwise
 * append as a CHILD of the now-clipping host, isn't itself clipped) — stays
 * in place, so this exact regression can't silently reappear.
 */
const scatter3dSource = readFileSync(
  join(__dirname, '..', '..', 'src', 'features', 'analyzer', 'Scatter3dChart.vue'),
  'utf-8',
)

function extractStyleBlock(source: string): string {
  const match = /<style\b[^>]*>([\s\S]*?)<\/style>/i.exec(source)
  if (!match) throw new Error('Scatter3dChart.vue has no <style> block')
  return match[1]
}

function extractScriptBlock(source: string): string {
  const match = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(source)
  if (!match) throw new Error('Scatter3dChart.vue has no <script> block')
  return match[1]
}

describe('Scatter3dChart scrollbar-feedback-loop fix stays in place', () => {
  it('.scatter-3d host clips overflow instead of letting it spill into the card body', () => {
    const style = extractStyleBlock(scatter3dSource)
    const hostRuleMatch = /\.scatter-3d\s*\{([^}]*)\}/.exec(style)
    expect(hostRuleMatch, '.scatter-3d base rule not found').not.toBeNull()
    expect(hostRuleMatch![1]).toMatch(/overflow:\s*hidden/)
  })

  it('tooltip is appended to <body>, not the now-clipping chart host', () => {
    const script = extractScriptBlock(scatter3dSource)
    expect(script).toMatch(/appendToBody:\s*true/)
  })
})
