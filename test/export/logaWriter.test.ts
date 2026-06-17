import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { patchLogaText } from '@/domain/export/loga/LogaWriter'
import { loadFixture } from '../fixtures'

/** A ramp 0,1,2,... of the given length (round-trips exactly at 1 decimal). */
function ramp(n: number): Float32Array {
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = i
  return a
}

describe('patchLogaText — replace existing column', () => {
  const original = loadFixture('raceAmp.loga')
  const before = parseLoga(original)
  const n = before.rowCount

  const result = patchLogaText(
    original,
    new Map([['Front Suspension', ramp(n)]]),
  )

  it('reports the column as replaced (not appended)', () => {
    expect(result.replaced).toContain('Front Suspension')
    expect(result.appended).toHaveLength(0)
  })

  it('round-trips the new values via re-parsing', () => {
    const after = parseLoga(result.text)
    expect(after.rowCount).toBe(n)
    const data = after.get('Front Suspension')!.data
    expect(data[0]).toBe(0)
    expect(data[5]).toBe(5)
    expect(data[n - 1]).toBe(n - 1)
  })

  it('leaves an unspecified column (Rear Suspension) untouched', () => {
    const after = parseLoga(result.text)
    const a = before.get('Rear Suspension')!.data
    const b = after.get('Rear Suspension')!.data
    expect(b[0]).toBe(a[0])
    expect(b[n - 1]).toBe(a[n - 1])
  })

  it('preserves the line count', () => {
    expect(result.text.split(/\r?\n/).length).toBe(original.split(/\r?\n/).length)
  })
})

describe('patchLogaText — append missing column', () => {
  const original = loadFixture('super2.loga') // no Front Suspension column
  const before = parseLoga(original)
  const n = before.rowCount

  const result = patchLogaText(
    original,
    new Map([['Front Suspension', ramp(n)]]),
  )

  it('reports the column as appended', () => {
    expect(result.appended).toContain('Front Suspension')
    expect(result.replaced).toHaveLength(0)
  })

  it('adds a resolvable column with the right values, leaving others intact', () => {
    const after = parseLoga(result.text)
    expect(after.rowCount).toBe(n)
    expect(after.has('Front Suspension')).toBe(true)
    expect(after.get('Front Suspension')!.data[7]).toBe(7)
    // an existing channel is unchanged
    expect(after.get('RPM')!.data[0]).toBe(before.get('RPM')!.data[0])
  })
})
