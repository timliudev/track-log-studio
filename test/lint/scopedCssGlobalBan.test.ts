import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Vue's scoped-CSS `:global(X) Y` syntax does NOT scope `X` and leave `Y`
 * scoped as one might expect from reading it left to right. Vue treats the
 * WHOLE selector as global once `:global(...)` appears anywhere in it, and
 * drops everything after the `:global(...)` segment — so `:global(:root[...])
 * .foo` compiles to a bare `:root[...]` rule, landing that block's
 * declarations on the global `:root`/`<html>` element instead of `.foo`
 * scoped to this component. This is exactly what caused the gutter-grip
 * touch styles to hijack `<html>` on any touch-capable device.
 *
 * The repo convention for selectors that need to react to a state attribute
 * set on `<html>` (e.g. `data-any-pointer-coarse`) while still scoping the
 * rest of the selector to the component is to omit `:global()` entirely and
 * write `:root[attr] .foo` directly — Vue attaches the scope id to the last
 * selector segment, which is `.foo` here, so the rule still only matches
 * inside this component while reacting to the root-level attribute.
 *
 * This test scans every `<style scoped>` block under src/**\/*.vue and fails
 * if `:global(` shows up anywhere in it, so this class of bug can't reappear.
 */

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

function extractScopedStyleBlocks(source: string): string[] {
  const blocks: string[] = []
  const styleTagRegex = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi
  let match: RegExpExecArray | null
  while ((match = styleTagRegex.exec(source)) !== null) {
    const attrs = match[1]
    const body = match[2]
    if (/\bscoped\b/.test(attrs)) {
      blocks.push(body)
    }
  }
  return blocks
}

const srcDir = join(__dirname, '..', '..', 'src')

describe('scoped CSS :global() ban', () => {
  it('has no <style scoped> blocks using :global() in src/**/*.vue', () => {
    const vueFiles = collectVueFiles(srcDir)
    expect(vueFiles.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of vueFiles) {
      const source = readFileSync(file, 'utf-8')
      const scopedBlocks = extractScopedStyleBlocks(source)
      for (const block of scopedBlocks) {
        if (block.includes(':global(')) {
          offenders.push(relative(srcDir, file))
          break
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
