import { describe, expect, it } from 'vitest'
import {
  resolveCurrentValueIndex,
  buildCurrentValueFields,
  formatCurrentValueField,
  type CurrentValueField,
} from '@/domain/analysis/currentValues'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function session(channels: Channel[]): LogSession {
  return new LogSession(channels, { formatId: 'test', createdDate: null, headerInfo: {} })
}

describe('resolveCurrentValueIndex (B15 — cursor vs. idle fallback)', () => {
  it('uses the cursor index when it is set and in range', () => {
    expect(resolveCurrentValueIndex(3, 10)).toBe(3)
    expect(resolveCurrentValueIndex(0, 10)).toBe(0)
  })

  it('falls back to the LAST row when there is no cursor', () => {
    expect(resolveCurrentValueIndex(null, 10)).toBe(9)
  })

  it('falls back to the last row when the cursor is out of range (stale from a shorter session)', () => {
    expect(resolveCurrentValueIndex(50, 10)).toBe(9)
    expect(resolveCurrentValueIndex(-1, 10)).toBe(9)
  })

  it('returns null for an empty session (nothing to show)', () => {
    expect(resolveCurrentValueIndex(0, 0)).toBeNull()
    expect(resolveCurrentValueIndex(null, 0)).toBeNull()
  })
})

describe('buildCurrentValueFields (B15/B16)', () => {
  it('puts the elapsed-time field first, followed by every channel in session order', () => {
    const s = session([channel('RPM', [1000, 2000, 3000]), channel('GPS_Speed', [10, 20, 30])])
    const elapsed = new Float64Array([0, 1, 2])
    const fields = buildCurrentValueFields(s, elapsed, 1, 'Time')
    expect(fields.map((f) => f.key)).toEqual(['time', 'RPM', 'GPS_Speed'])
    expect(fields[0].kind).toBe('time')
    expect(fields[1].kind).toBe('channel')
  })

  it('reads each channel value at the given index (O(1) — not the whole array)', () => {
    const s = session([channel('RPM', [1000, 2000, 3000])])
    const elapsed = new Float64Array([0, 0.5, 1])
    const fields = buildCurrentValueFields(s, elapsed, 2, 'Time')
    const rpm = fields.find((f) => f.key === 'RPM')!
    expect(rpm.value).toBe(3000)
    const time = fields.find((f) => f.key === 'time')!
    expect(time.value).toBe(1000) // 1s -> 1000ms
  })

  it('every value is NaN when index is null (no rows)', () => {
    const s = session([channel('RPM', [1000])])
    const elapsed = new Float64Array([0])
    const fields = buildCurrentValueFields(s, elapsed, null, 'Time')
    for (const f of fields) expect(Number.isNaN(f.value)).toBe(true)
  })

  it('uses the caller-supplied label for the time field only', () => {
    const s = session([channel('RPM', [1])])
    const elapsed = new Float64Array([0])
    const fields = buildCurrentValueFields(s, elapsed, 0, '目前時間')
    expect(fields[0].label).toBe('目前時間')
    expect(fields[1].label).toBe('RPM')
  })
})

describe('formatCurrentValueField', () => {
  function f(kind: CurrentValueField['kind'], value: number): CurrentValueField {
    return { key: 'k', label: 'k', kind, value }
  }

  it('formats a NaN time or channel value as an em dash', () => {
    expect(formatCurrentValueField(f('channel', NaN))).toBe('—')
    expect(formatCurrentValueField(f('time', NaN))).toBe('—')
  })

  it('formats a time field as m:ss.mmm', () => {
    expect(formatCurrentValueField(f('time', 92345))).toBe('1:32.345')
  })

  it('formats a channel field with the generic metric formatter', () => {
    expect(formatCurrentValueField(f('channel', 12345.6))).toBe('12345.6')
    expect(formatCurrentValueField(f('channel', 3.14159))).toBe('3.14')
  })

  it('formats an update-rate field with its unit and keeps null-like values explicit', () => {
    expect(formatCurrentValueField(f('updateRate', 10))).toBe('10.0 Hz')
    expect(formatCurrentValueField(f('updateRate', NaN))).toBe('— Hz')
  })
})
