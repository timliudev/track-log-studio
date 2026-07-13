import { describe, expect, it } from 'vitest'
import {
  defaultCurrentValuesFieldPrefs,
  parseCurrentValuesFieldPrefs,
  reconcileCurrentValuesFieldPrefs,
  toggleFieldHidden,
  setCurrentValuesSortMode,
  moveFieldInOrder,
  arrangeCurrentValueFields,
  currentValuesEditableFields,
  type CurrentValuesFieldPrefs,
} from '@/domain/analysis/currentValuesFieldPrefs'
import type { CurrentValueField } from '@/domain/analysis/currentValues'

function field(key: string, kind: CurrentValueField['kind'] = 'channel'): CurrentValueField {
  return { key, label: key, kind, value: 1 }
}

const fields: CurrentValueField[] = [
  field('time', 'time'),
  field('RPM'),
  field('GPS_Speed'),
  field('Throttle'),
]

describe('defaultCurrentValuesFieldPrefs (B49)', () => {
  it('starts with original order, nothing hidden, no custom order', () => {
    expect(defaultCurrentValuesFieldPrefs()).toEqual({ sortMode: 'original', hidden: [], order: [] })
  })
})

describe('parseCurrentValuesFieldPrefs (B49)', () => {
  it('returns null for missing/garbage input', () => {
    expect(parseCurrentValuesFieldPrefs(null)).toBeNull()
    expect(parseCurrentValuesFieldPrefs('not json')).toBeNull()
    expect(parseCurrentValuesFieldPrefs('[]')).toBeNull()
    expect(parseCurrentValuesFieldPrefs('null')).toBeNull()
  })

  it('parses a well-formed blob', () => {
    const raw = JSON.stringify({ sortMode: 'custom', hidden: ['RPM'], order: ['Throttle', 'RPM'] })
    expect(parseCurrentValuesFieldPrefs(raw)).toEqual({
      sortMode: 'custom',
      hidden: ['RPM'],
      order: ['Throttle', 'RPM'],
    })
  })

  it('falls back to original for an unrecognised sortMode', () => {
    const raw = JSON.stringify({ sortMode: 'bogus' })
    expect(parseCurrentValuesFieldPrefs(raw)!.sortMode).toBe('original')
  })

  it('tolerates missing/wrong-typed hidden/order (defaults to [])', () => {
    expect(parseCurrentValuesFieldPrefs('{}')).toEqual({ sortMode: 'original', hidden: [], order: [] })
    const raw = JSON.stringify({ hidden: 'not-an-array', order: [1, 2, 'ok'] })
    expect(parseCurrentValuesFieldPrefs(raw)).toEqual({ sortMode: 'original', hidden: [], order: ['ok'] })
  })

  it('de-dups hidden/order entries', () => {
    const raw = JSON.stringify({ hidden: ['RPM', 'RPM'], order: ['A', 'B', 'A'] })
    const parsed = parseCurrentValuesFieldPrefs(raw)!
    expect(parsed.hidden).toEqual(['RPM'])
    expect(parsed.order).toEqual(['A', 'B'])
  })
})

describe('reconcileCurrentValuesFieldPrefs (B49)', () => {
  it('drops hidden/order entries for channels that no longer exist', () => {
    const prefs: CurrentValuesFieldPrefs = { sortMode: 'custom', hidden: ['Removed'], order: ['Removed', 'RPM'] }
    const next = reconcileCurrentValuesFieldPrefs(prefs, ['RPM', 'GPS_Speed'])
    expect(next.hidden).toEqual([])
    expect(next.order).toEqual(['RPM', 'GPS_Speed'])
  })

  it('appends a brand-new channel at the end of order, keeping existing order', () => {
    const prefs: CurrentValuesFieldPrefs = { sortMode: 'custom', hidden: [], order: ['GPS_Speed', 'RPM'] }
    const next = reconcileCurrentValuesFieldPrefs(prefs, ['RPM', 'GPS_Speed', 'Throttle'])
    expect(next.order).toEqual(['GPS_Speed', 'RPM', 'Throttle'])
  })

  it('returns the SAME object reference when nothing changed', () => {
    const prefs: CurrentValuesFieldPrefs = { sortMode: 'original', hidden: [], order: ['RPM', 'GPS_Speed'] }
    const next = reconcileCurrentValuesFieldPrefs(prefs, ['RPM', 'GPS_Speed'])
    expect(next).toBe(prefs)
  })
})

describe('toggleFieldHidden (B49)', () => {
  it('hides then shows a field', () => {
    let prefs = defaultCurrentValuesFieldPrefs()
    prefs = toggleFieldHidden(prefs, 'RPM')
    expect(prefs.hidden).toEqual(['RPM'])
    prefs = toggleFieldHidden(prefs, 'RPM')
    expect(prefs.hidden).toEqual([])
  })

  it('never hides the time field', () => {
    const prefs = toggleFieldHidden(defaultCurrentValuesFieldPrefs(), 'time')
    expect(prefs.hidden).toEqual([])
  })

  it('respects an explicit force value', () => {
    let prefs = defaultCurrentValuesFieldPrefs()
    prefs = toggleFieldHidden(prefs, 'RPM', true)
    expect(prefs.hidden).toEqual(['RPM'])
    // Forcing the same state again is a no-op (same reference).
    const again = toggleFieldHidden(prefs, 'RPM', true)
    expect(again).toBe(prefs)
  })
})

describe('setCurrentValuesSortMode (B49)', () => {
  it('switches modes, no-ops on the same mode', () => {
    const prefs = defaultCurrentValuesFieldPrefs()
    const next = setCurrentValuesSortMode(prefs, 'alphabetical')
    expect(next.sortMode).toBe('alphabetical')
    expect(setCurrentValuesSortMode(next, 'alphabetical')).toBe(next)
  })
})

describe('moveFieldInOrder (B49)', () => {
  it('swaps a field with its neighbour up/down', () => {
    let prefs: CurrentValuesFieldPrefs = { sortMode: 'custom', hidden: [], order: ['A', 'B', 'C'] }
    prefs = moveFieldInOrder(prefs, 'B', -1)
    expect(prefs.order).toEqual(['B', 'A', 'C'])
    prefs = moveFieldInOrder(prefs, 'B', 1)
    expect(prefs.order).toEqual(['A', 'B', 'C'])
  })

  it('is a no-op at either end of the list', () => {
    const prefs: CurrentValuesFieldPrefs = { sortMode: 'custom', hidden: [], order: ['A', 'B', 'C'] }
    expect(moveFieldInOrder(prefs, 'A', -1)).toBe(prefs)
    expect(moveFieldInOrder(prefs, 'C', 1)).toBe(prefs)
  })

  it('is a no-op for an unknown key', () => {
    const prefs: CurrentValuesFieldPrefs = { sortMode: 'custom', hidden: [], order: ['A', 'B'] }
    expect(moveFieldInOrder(prefs, 'Z', -1)).toBe(prefs)
  })
})

describe('arrangeCurrentValueFields (B49)', () => {
  it('keeps original session order, time first, when sortMode is original', () => {
    const prefs = defaultCurrentValuesFieldPrefs()
    const arranged = arrangeCurrentValueFields(fields, prefs)
    expect(arranged.map((f) => f.key)).toEqual(['time', 'RPM', 'GPS_Speed', 'Throttle'])
  })

  it('sorts alphabetically by label, time always first', () => {
    const prefs = setCurrentValuesSortMode(defaultCurrentValuesFieldPrefs(), 'alphabetical')
    const arranged = arrangeCurrentValueFields(fields, prefs)
    expect(arranged.map((f) => f.key)).toEqual(['time', 'GPS_Speed', 'RPM', 'Throttle'])
  })

  it('uses the custom order, time always first', () => {
    const prefs: CurrentValuesFieldPrefs = { sortMode: 'custom', hidden: [], order: ['Throttle', 'RPM', 'GPS_Speed'] }
    const arranged = arrangeCurrentValueFields(fields, prefs)
    expect(arranged.map((f) => f.key)).toEqual(['time', 'Throttle', 'RPM', 'GPS_Speed'])
  })

  it('appends a field missing from a stale custom order at the end', () => {
    const prefs: CurrentValuesFieldPrefs = { sortMode: 'custom', hidden: [], order: ['GPS_Speed'] }
    const arranged = arrangeCurrentValueFields(fields, prefs)
    expect(arranged.map((f) => f.key)).toEqual(['time', 'GPS_Speed', 'RPM', 'Throttle'])
  })

  it('filters out hidden fields (never the time field)', () => {
    const prefs = toggleFieldHidden(defaultCurrentValuesFieldPrefs(), 'RPM')
    const arranged = arrangeCurrentValueFields(fields, prefs)
    expect(arranged.map((f) => f.key)).toEqual(['time', 'GPS_Speed', 'Throttle'])
  })

  it('handles a field list with no time field gracefully', () => {
    const noTime = fields.filter((f) => f.kind !== 'time')
    const arranged = arrangeCurrentValueFields(noTime, defaultCurrentValuesFieldPrefs())
    expect(arranged.map((f) => f.key)).toEqual(['RPM', 'GPS_Speed', 'Throttle'])
  })
})

describe('currentValuesEditableFields (B49)', () => {
  it('excludes the time field but INCLUDES hidden fields', () => {
    const prefs = toggleFieldHidden(defaultCurrentValuesFieldPrefs(), 'RPM')
    const editable = currentValuesEditableFields(fields, prefs)
    expect(editable.map((f) => f.key)).toEqual(['RPM', 'GPS_Speed', 'Throttle'])
  })

  it('falls back to session order when no custom order is stored yet', () => {
    const editable = currentValuesEditableFields(fields, defaultCurrentValuesFieldPrefs())
    expect(editable.map((f) => f.key)).toEqual(['RPM', 'GPS_Speed', 'Throttle'])
  })

  it('follows the active sortMode (original/alphabetical), ignoring a dormant custom order', () => {
    // A stored custom order is tracked even outside 'custom' mode (see the
    // CurrentValuesFieldPrefs.order doc) but stays DORMANT until sortMode is
    // actually switched to 'custom' — the edit list should reflect what's
    // really on screen, not a not-yet-active arrangement.
    const prefs: CurrentValuesFieldPrefs = {
      sortMode: 'alphabetical',
      hidden: [],
      order: ['Throttle', 'RPM', 'GPS_Speed'],
    }
    const editable = currentValuesEditableFields(fields, prefs)
    expect(editable.map((f) => f.key)).toEqual(['GPS_Speed', 'RPM', 'Throttle'])
  })

  it('uses the stored custom order once sortMode is custom', () => {
    const prefs: CurrentValuesFieldPrefs = { sortMode: 'custom', hidden: [], order: ['Throttle', 'RPM', 'GPS_Speed'] }
    const editable = currentValuesEditableFields(fields, prefs)
    expect(editable.map((f) => f.key)).toEqual(['Throttle', 'RPM', 'GPS_Speed'])
  })
})
