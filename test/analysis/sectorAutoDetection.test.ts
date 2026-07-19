import { describe, expect, it } from 'vitest'
import {
  circuitGeometryOriginForRestore,
  shouldAutoDetectSectorGates,
  type CircuitGeometryOrigin,
} from '@/domain/analysis/sectorAutoDetection'

function eligible(overrides: Partial<{
  hasStartFinishLine: boolean
  gateCount: number
  geometryOrigin: CircuitGeometryOrigin
  userEdited: boolean
}> = {}): boolean {
  return shouldAutoDetectSectorGates({
    hasStartFinishLine: true,
    gateCount: 0,
    geometryOrigin: 'none',
    userEdited: false,
    ...overrides,
  })
}

describe('shouldAutoDetectSectorGates', () => {
  it('allows the fallback only for a fresh circuit with a line and no gates', () => {
    expect(eligible()).toBe(true)
  })

  it.each<CircuitGeometryOrigin>(['pending', 'saved', 'shared', 'ambiguous'])(
    'preserves %s geometry precedence even when its gate list is empty',
    (geometryOrigin) => {
      expect(eligible({ geometryOrigin })).toBe(false)
    },
  )

  it('does not run before a start/finish line exists', () => {
    expect(eligible({ hasStartFinishLine: false })).toBe(false)
  })

  it('does not overwrite an existing gate set', () => {
    expect(eligible({ gateCount: 1 })).toBe(false)
  })

  it('treats an intentional clear/remove-last as a protected manual edit', () => {
    expect(eligible({ userEdited: true })).toBe(false)
  })
})

describe('circuitGeometryOriginForRestore', () => {
  it('keeps saved and track-library geometry ahead of the fallback', () => {
    expect(circuitGeometryOriginForRestore('localOverride', true)).toBe('saved')
    expect(circuitGeometryOriginForRestore('sharedTrack', false)).toBe('shared')
    expect(circuitGeometryOriginForRestore('ambiguous', false)).toBe('ambiguous')
  })

  it('allows fallback only when matching found nothing and no saved record exists', () => {
    expect(circuitGeometryOriginForRestore('none', false)).toBe('none')
    expect(circuitGeometryOriginForRestore('none', true)).toBe('saved')
  })
})
