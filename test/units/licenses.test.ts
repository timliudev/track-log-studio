import { describe, it, expect } from 'vitest'
import { thirdPartyLicenses } from '@/data/licenses'
import packageJson from '../../package.json'

/**
 * Guards the "About" page's (#16) third-party license inventory:
 * every entry must be a plausible, non-empty license record, and every
 * *actual* runtime dependency declared in package.json must be represented
 * so the list can't silently go stale as dependencies change.
 */
describe('thirdPartyLicenses', () => {
  it('is non-empty', () => {
    expect(thirdPartyLicenses.length).toBeGreaterThan(0)
  })

  it('has no duplicate package names', () => {
    const names = thirdPartyLicenses.map((pkg) => pkg.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('has complete, well-formed fields for every entry', () => {
    for (const pkg of thirdPartyLicenses) {
      expect(pkg.name, 'name').toBeTruthy()
      expect(pkg.version, `${pkg.name}.version`).toMatch(/^\d+\.\d+\.\d+/)
      expect(pkg.license, `${pkg.name}.license`).toBeTruthy()
      expect(pkg.url, `${pkg.name}.url`).toMatch(/^https:\/\//)
    }
  })

  it('covers every runtime dependency declared in package.json', () => {
    const listedNames = new Set(thirdPartyLicenses.map((pkg) => pkg.name))
    const runtimeDeps = Object.keys(packageJson.dependencies ?? {})
    for (const dep of runtimeDeps) {
      expect(listedNames.has(dep), `${dep} missing from thirdPartyLicenses`).toBe(true)
    }
  })

  it('records the known SPDX licenses accurately (spot check)', () => {
    const byName = Object.fromEntries(thirdPartyLicenses.map((pkg) => [pkg.name, pkg]))
    expect(byName.vue?.license).toBe('MIT')
    expect(byName.echarts?.license).toBe('Apache-2.0')
    expect(byName.idb?.license).toBe('ISC')
  })
})
