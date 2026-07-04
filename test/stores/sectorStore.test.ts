import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useSectorStore } from '@/stores/sectorStore'
import type { LapLine } from '@/domain/analysis/laps'

/** A distinct LapLine for test fixtures, offset by `n` so lines are easy to tell apart. */
function line(n: number): LapLine {
  return { a: { lat: n, lon: n + 1 }, b: { lat: n + 2, lon: n + 3 } }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

// NOTE (A1+A15 redesign): the old suggestion/accept/reject review layer is
// gone — auto-detection now loads DIRECTLY into `gates` via `loadDetected`.
// Deliberately removed: setSuggestions/clearSuggestions/acceptSuggestion/
// rejectSuggestion/acceptAllSuggestions tests, since that API no longer
// exists. Added: `loadDetected` and the `edited` flag's transitions.
describe('sectorStore', () => {
  it('starts with no gates and edited=false', () => {
    const s = useSectorStore()
    expect(s.gates).toEqual([])
    expect(s.edited).toBe(false)
  })

  it('loadDetected replaces the gate set and clears edited', () => {
    const s = useSectorStore()
    s.addGate(line(9)) // dirty the edited flag first
    s.loadDetected([line(0), line(1)])
    expect(s.gates).toEqual([line(0), line(1)])
    expect(s.edited).toBe(false)
  })

  it('addGate appends a manually-placed gate and marks edited', () => {
    const s = useSectorStore()
    s.addGate(line(0))
    s.addGate(line(1))
    expect(s.gates).toEqual([line(0), line(1)])
    expect(s.edited).toBe(true)
  })

  it('removeGate drops the gate at that index, keeps the rest in order, and marks edited', () => {
    const s = useSectorStore()
    s.loadDetected([line(0), line(1), line(2)])
    s.removeGate(1)
    expect(s.gates).toEqual([line(0), line(2)])
    expect(s.edited).toBe(true)
  })

  it('setGate repositions a gate in place by index without disturbing the others, and marks edited', () => {
    const s = useSectorStore()
    s.loadDetected([line(0), line(1), line(2)])
    const dragged: LapLine = { a: { lat: 99, lon: 99 }, b: { lat: 100, lon: 100 } }
    s.setGate(1, dragged)
    expect(s.gates).toEqual([line(0), dragged, line(2)])
    expect(s.edited).toBe(true)
  })

  it('setGate is a no-op for an out-of-range index', () => {
    const s = useSectorStore()
    s.addGate(line(0))
    const before = s.gates
    s.setGate(5, line(9))
    expect(s.gates).toEqual(before)
  })

  it('setGates replaces the full list without touching edited (reorder is not itself an edit)', () => {
    const s = useSectorStore()
    s.loadDetected([line(0), line(1)])
    s.setGates([line(1), line(0)])
    expect(s.gates).toEqual([line(1), line(0)])
    expect(s.edited).toBe(false)
  })

  it('clearGates empties gates and marks edited', () => {
    const s = useSectorStore()
    s.loadDetected([line(0)])
    s.clearGates()
    expect(s.gates).toEqual([])
    expect(s.edited).toBe(true)
  })

  it('clearAll empties gates and clears edited (e.g. file change)', () => {
    const s = useSectorStore()
    s.addGate(line(0))
    expect(s.edited).toBe(true)
    s.clearAll()
    expect(s.gates).toEqual([])
    expect(s.edited).toBe(false)
  })
})
