import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useSectorStore, type SectorSuggestion } from '@/stores/sectorStore'
import type { LapLine } from '@/domain/analysis/laps'

/** A distinct LapLine for test fixtures, offset by `n` so lines are easy to tell apart. */
function line(n: number): LapLine {
  return { a: { lat: n, lon: n + 1 }, b: { lat: n + 2, lon: n + 3 } }
}

function suggestion(n: number): SectorSuggestion {
  return {
    corner: { index: n, distanceM: n * 10, lat: n, lon: n, value: 1, prominence: 1 },
    line: line(n),
    lapDistanceM: n * 10,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('sectorStore', () => {
  it('starts with no gates and no suggestions', () => {
    const s = useSectorStore()
    expect(s.gates).toEqual([])
    expect(s.suggestions).toEqual([])
  })

  it('setSuggestions replaces the pending list; clearSuggestions empties it', () => {
    const s = useSectorStore()
    s.setSuggestions([suggestion(0), suggestion(1)])
    expect(s.suggestions).toHaveLength(2)
    s.clearSuggestions()
    expect(s.suggestions).toEqual([])
  })

  it('acceptSuggestion moves it into gates in order and drops it from suggestions', () => {
    const s = useSectorStore()
    s.setSuggestions([suggestion(0), suggestion(1), suggestion(2)])
    s.acceptSuggestion(1)
    expect(s.gates).toEqual([suggestion(1).line])
    expect(s.suggestions).toEqual([suggestion(0), suggestion(2)])
  })

  it('acceptSuggestion is a no-op for an out-of-range index', () => {
    const s = useSectorStore()
    s.setSuggestions([suggestion(0)])
    s.acceptSuggestion(5)
    expect(s.gates).toEqual([])
    expect(s.suggestions).toHaveLength(1)
  })

  it('rejectSuggestion drops it without adding a gate', () => {
    const s = useSectorStore()
    s.setSuggestions([suggestion(0), suggestion(1)])
    s.rejectSuggestion(0)
    expect(s.gates).toEqual([])
    expect(s.suggestions).toEqual([suggestion(1)])
  })

  it('acceptAllSuggestions moves every pending suggestion into gates, preserving order', () => {
    const s = useSectorStore()
    s.setSuggestions([suggestion(0), suggestion(1), suggestion(2)])
    s.acceptAllSuggestions()
    expect(s.gates).toEqual([suggestion(0).line, suggestion(1).line, suggestion(2).line])
    expect(s.suggestions).toEqual([])
  })

  it('addGate appends a manually-placed gate', () => {
    const s = useSectorStore()
    s.addGate(line(0))
    s.addGate(line(1))
    expect(s.gates).toEqual([line(0), line(1)])
  })

  it('removeGate drops the gate at that index and keeps the rest in order', () => {
    const s = useSectorStore()
    s.addGate(line(0))
    s.addGate(line(1))
    s.addGate(line(2))
    s.removeGate(1)
    expect(s.gates).toEqual([line(0), line(2)])
  })

  it('setGate repositions a gate in place by index without disturbing the others', () => {
    const s = useSectorStore()
    s.addGate(line(0))
    s.addGate(line(1))
    s.addGate(line(2))
    const dragged: LapLine = { a: { lat: 99, lon: 99 }, b: { lat: 100, lon: 100 } }
    s.setGate(1, dragged)
    expect(s.gates).toEqual([line(0), dragged, line(2)])
  })

  it('setGate is a no-op for an out-of-range index', () => {
    const s = useSectorStore()
    s.addGate(line(0))
    const before = s.gates
    s.setGate(5, line(9))
    expect(s.gates).toEqual(before)
  })

  it('clearGates empties confirmed gates but leaves suggestions untouched', () => {
    const s = useSectorStore()
    s.addGate(line(0))
    s.setSuggestions([suggestion(0)])
    s.clearGates()
    expect(s.gates).toEqual([])
    expect(s.suggestions).toHaveLength(1)
  })

  it('clearAll empties both gates and suggestions', () => {
    const s = useSectorStore()
    s.addGate(line(0))
    s.setSuggestions([suggestion(0)])
    s.clearAll()
    expect(s.gates).toEqual([])
    expect(s.suggestions).toEqual([])
  })
})
