import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PIN_FLIP_DURATION_MS, PIN_FLIP_EASING } from '@/domain/layout/flip'

/**
 * M17 — design-token system guard. Three independent checks over the same
 * file set (`src/**\/*.vue` + `src/theme/theme.css`), all scanning ONLY the
 * literal CSS surface (`<style>` blocks in `.vue` files; the whole file for
 * `theme.css`, which has no wrapper tags) — this deliberately does NOT reach
 * into `<script>` blocks, so a JS string that happens to mention a CSS
 * property name (e.g. GgChart.vue's `extraCssText` building a `box-shadow`
 * string for an echarts tooltip via `themeColor('--shadow-2', …)`) is out of
 * scope by construction rather than needing an allowlist entry.
 *
 * 1. Every `font-size:` declaration must be `var(--text-*)` — the 9-step
 *    type scale. Zero exceptions were needed after migration (see the M17
 *    commit's own report for the two SVG/hard-px cases that WERE migrated,
 *    not exempted); the allowlist below exists as a structural safety valve
 *    for any future addition that genuinely can't use the scale, not because
 *    anything currently needs it.
 * 2. Every `box-shadow:` declaration must be `var(--shadow-*)` UNLESS it's a
 *    ring/marker (a 1px/2px/3px solid-colour outline-style shadow, not real
 *    elevation) — those are explicitly allowlisted by file below, each with
 *    the reason it's exempt.
 * 3. `theme.css` must declare `--dur-slow: 320ms` and
 *    `--ease-standard: cubic-bezier(0.22, 1, 0.36, 1)` matching
 *    `flip.ts`'s `PIN_FLIP_DURATION_MS`/`PIN_FLIP_EASING` byte-for-byte —
 *    imported directly from the TS source (not hand-copied into this test)
 *    so the two can never silently drift apart; see the comment on those
 *    constants in flip.ts for why they have to be declared twice at all
 *    (JS can't read the numeric/semantic value of a CSS custom property).
 */

const SRC = join(__dirname, '..', '..', 'src')
const THEME_CSS = join(SRC, 'theme', 'theme.css')

function collectVueFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...collectVueFiles(fullPath))
    } else if (entry.endsWith('.vue')) {
      files.push(fullPath)
    }
  }
  return files
}

/** All `<style>` block bodies in a `.vue` file (scoped or not — both kinds
 *  ship real CSS that ends up on the page, so both are in scope for a
 *  design-token guard, unlike `scopedCssGlobalBan.test.ts` which cares
 *  specifically about `scoped`'s `:global()` footgun). */
function extractStyleBlocks(source: string): string[] {
  const blocks: string[] = []
  const styleTagRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let match: RegExpExecArray | null
  while ((match = styleTagRegex.exec(source)) !== null) {
    blocks.push(match[1])
  }
  return blocks
}

/** file (relative to src/) → reason it may keep a literal, non-token
 *  `box-shadow` value. Every entry here is a ring/marker/outline-style
 *  shadow (per docs/ISSUES.md B119's own carve-out), never real elevation —
 *  see the M17 batch's own commit message for the full audit. */
const BOX_SHADOW_ALLOWLIST: Record<string, string> = {
  'features/analyzer/AccelTestPanel.vue':
    '`inset 3px 0 0 var(--color-accent)` — 左側色條標記(選取態),不是 elevation。',
  'features/analyzer/cards/MapCard.vue':
    '`0 0 0 1px var(--color-surface)` — 卡片邊框描邊 ring,不是 elevation。',
  'features/analyzer/LapAlignPanel.vue':
    '`0 0 0 1px var(--color-surface)` — 同上,描邊 ring。',
  'features/analyzer/LapTable.vue':
    '`0 0 0 1px var(--color-surface)` — 同上,描邊 ring。',
  'features/analyzer/MapAlignPanel.vue':
    '`0 0 0 1px var(--color-surface)` — 同上,描邊 ring。',
  'features/analyzer/SessionLapComparison.vue':
    '`0 0 0 1px var(--color-surface)` — 同上,描邊 ring。',
  'features/analyzer/GearPanel.vue':
    '`0 0 0 2px color-mix(in srgb, var(--color-accent) 30%, transparent)` — 有效值套用後的 focus 風格 ring,不是 elevation。',
}

describe('M17 design tokens', () => {
  const vueFiles = collectVueFiles(SRC)
  const themeCss = readFileSync(THEME_CSS, 'utf-8')

  it('has no literal font-size in <style> blocks — must use var(--text-*)', () => {
    const offenders: string[] = []

    for (const file of vueFiles) {
      const source = readFileSync(file, 'utf-8')
      for (const block of extractStyleBlocks(source)) {
        const matches = block.match(/font-size:\s*[^;]+;/g) ?? []
        for (const m of matches) {
          if (!/font-size:\s*var\(--text-/.test(m)) {
            offenders.push(`${relative(SRC, file)} → ${m.trim()}`)
          }
        }
      }
    }
    // theme.css itself has one font-size declaration (.app-tooltip).
    const themeMatches = themeCss.match(/font-size:\s*[^;]+;/g) ?? []
    for (const m of themeMatches) {
      if (!/font-size:\s*var\(--text-/.test(m)) {
        offenders.push(`theme.css → ${m.trim()}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('has no literal elevation box-shadow — must use var(--shadow-*), rings/markers allowlisted', () => {
    const offenders: string[] = []

    for (const file of vueFiles) {
      const relPath = relative(SRC, file).replace(/\\/g, '/')
      const source = readFileSync(file, 'utf-8')
      for (const block of extractStyleBlocks(source)) {
        const matches = block.match(/box-shadow:\s*[^;]+;/g) ?? []
        for (const m of matches) {
          if (/box-shadow:\s*var\(--shadow-/.test(m)) continue
          if (relPath in BOX_SHADOW_ALLOWLIST) continue
          offenders.push(`${relPath} → ${m.trim()}`)
        }
      }
    }
    // theme.css's OWN `box-shadow:` usages (e.g. .app-tooltip) must also be
    // tokenised — this does NOT touch the `--shadow-*` custom-property
    // DEFINITIONS themselves (those are `--shadow-2: …rgba(0,…);`, a
    // different property name, and are exactly where the raw rgba values
    // are supposed to live).
    const themeMatches = themeCss.match(/box-shadow:\s*[^;]+;/g) ?? []
    for (const m of themeMatches) {
      if (!/box-shadow:\s*var\(--shadow-/.test(m)) {
        offenders.push(`theme.css → ${m.trim()}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('theme.css --dur-slow/--ease-standard match flip.ts PIN_FLIP_DURATION_MS/PIN_FLIP_EASING', () => {
    expect(PIN_FLIP_DURATION_MS).toBe(320)
    expect(PIN_FLIP_EASING).toBe('cubic-bezier(0.22, 1, 0.36, 1)')

    expect(themeCss).toContain(`--dur-slow: ${PIN_FLIP_DURATION_MS}ms;`)
    expect(themeCss).toContain(`--ease-standard: ${PIN_FLIP_EASING};`)
  })
})
