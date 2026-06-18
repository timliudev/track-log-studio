import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useLapStore } from '@/stores/lapStore'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('lapStore', () => {
  it('starts with no line and a line source', () => {
    const s = useLapStore()
    expect(s.line).toBeNull()
    expect(s.source).toBe('line')
  })

  it('setLine holds the line and clearLine resets it', () => {
    const s = useLapStore()
    const line = { a: { lat: 1, lon: 2 }, b: { lat: 3, lon: 4 } }
    s.setLine(line)
    expect(s.line).toEqual(line)
    s.clearLine()
    expect(s.line).toBeNull()
  })

  it('setSource switches the detection mode', () => {
    const s = useLapStore()
    s.setSource('ecu')
    expect(s.source).toBe('ecu')
    s.setSource('line')
    expect(s.source).toBe('line')
  })
})
