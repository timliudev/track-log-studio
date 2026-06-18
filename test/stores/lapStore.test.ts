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

  it('starts with no lap selected', () => {
    const s = useLapStore()
    expect(s.selectedIndex).toBeNull()
  })

  it('selectLap sets and clears the selected index', () => {
    const s = useLapStore()
    s.selectLap(2)
    expect(s.selectedIndex).toBe(2)
    s.selectLap(null)
    expect(s.selectedIndex).toBeNull()
  })

  it('toggleLap selects, then deselects the same lap on a second toggle', () => {
    const s = useLapStore()
    s.toggleLap(1)
    expect(s.selectedIndex).toBe(1)
    s.toggleLap(1)
    expect(s.selectedIndex).toBeNull()
    s.toggleLap(1)
    s.toggleLap(3)
    expect(s.selectedIndex).toBe(3)
  })
})
