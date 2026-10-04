import { describe, it, expect } from 'vitest'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { buildVboCatalog } from '@/domain/export/vbo/VboExporter'
import { loadFixture } from '../fixtures'

function channel(name: string, data: number[], unit?: string): Channel {
  return { name, rawName: name, description: undefined, unit, data: new Float32Array(data) }
}
const META = { formatId: 'rcz', createdDate: null, headerInfo: {} }

/** Deterministic Fisher-Yates (mulberry32) so a failure is reproducible. */
function shuffled<T>(arr: readonly T[], seed: number): T[] {
  const a = [...arr]
  let s = seed >>> 0
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const slotMap = (session: LogSession) =>
  new Map(buildVboCatalog(session).channels.map((c) => [c.ctTitle, c.rcName]))

/** Synthetic session: 70 toggling-digital (overflows the 63 slots) + 20 analog channels. */
function syntheticChannels(): Channel[] {
  const out: Channel[] = [channel('Time', [0, 100, 200, 300])]
  for (let i = 0; i < 70; i++) out.push(channel(`Flag_${String(i).padStart(2, '0')}_On`, [0, 1, 0, 1]))
  for (let i = 0; i < 20; i++) out.push(channel(`Sensor_${String.fromCharCode(65 + i)}`, [1.5, 2.5, 3.5, 4.5 + i]))
  return out
}

describe('buildVboCatalog — B128 deterministic slot assignment', () => {
  it('shuffling the session channel order yields identical rcName per channel', () => {
    const base = syntheticChannels()
    const ref = slotMap(new LogSession(base, META))
    for (const seed of [1, 2, 3, 4, 5]) {
      const got = slotMap(new LogSession(shuffled(base, seed), META))
      expect(got).toEqual(ref)
    }
  })

  it('assigns analog slots first (by name), digital next, digital overflow after the analog ones', () => {
    const m = slotMap(new LogSession(syntheticChannels(), META))
    // analog sorted by name -> rc_analog_1.. in code-unit order
    expect(m.get('Sensor_A')).toBe('rc_analog_1')
    expect(m.get('Sensor_T')).toBe('rc_analog_20')
    // digital sorted by name -> rc_digital_1..63
    expect(m.get('Flag_00_On')).toBe('rc_digital_1')
    expect(m.get('Flag_62_On')).toBe('rc_digital_63')
    // overflow (7 channels) takes rc_analog_21.. — AFTER the 20 analog channels
    expect(m.get('Flag_63_On')).toBe('rc_analog_21')
    expect(m.get('Flag_69_On')).toBe('rc_analog_27')
  })

  it('analog slots do not depend on how many digital channels exist', () => {
    const withDigital = slotMap(new LogSession(syntheticChannels(), META))
    const analogOnly = slotMap(
      new LogSession(syntheticChannels().filter((c) => !c.name.startsWith('Flag_')), META),
    )
    for (const [name, slot] of analogOnly) {
      if (name === 'Time') continue
      expect(withDigital.get(name)).toBe(slot)
    }
  })

  it('uses code-unit order, not locale order (uppercase sorts before lowercase)', () => {
    const m = slotMap(
      new LogSession(
        [
          channel('Time', [0, 100]),
          channel('apple', [1.5, 2.5]),
          channel('Zebra', [1.5, 2.5]),
          channel('Mango', [1.5, 2.5]),
        ],
        META,
      ),
    )
    expect(m.get('Mango')).toBe('rc_analog_1')
    expect(m.get('Zebra')).toBe('rc_analog_2')
    expect(m.get('apple')).toBe('rc_analog_3') // localeCompare would put 'apple' first
  })

  it('keeps the OUTPUT column order as the session original order', () => {
    const base = syntheticChannels()
    const order = shuffled(base, 9)
    const names = buildVboCatalog(new LogSession(order, META)).channels.map((c) => c.ctTitle)
    expect(names).toEqual(order.map((c) => c.name).filter((n) => n !== 'Time'))
  })

  it('an all-NaN passthrough rc_analog_N still reserves N (and is still dropped + skipped)', () => {
    const generic = (): Channel[] => {
      const out: Channel[] = [channel('Time', [0, 100, 200])]
      for (let i = 0; i < 20; i++) out.push(channel(`Sensor_${String.fromCharCode(65 + i)}`, [1.5, 2.5, 3.5 + i]))
      return out
    }
    const withNaN = buildVboCatalog(new LogSession([...generic(), channel('rc_analog_13', [NaN, NaN, NaN])], META))
    const withData = buildVboCatalog(new LogSession([...generic(), channel('rc_analog_13', [7, 8, 9])], META))

    // slot 13 is blocked in both cases, so every generic channel gets the same slot either way
    const a = new Map(withNaN.channels.map((c) => [c.ctTitle, c.rcName]))
    const b = new Map(withData.channels.map((c) => [c.ctTitle, c.rcName]))
    expect(a.has('rc_analog_13')).toBe(false)
    expect(withNaN.skipped.map((s) => s.ctTitle)).toEqual(['rc_analog_13'])
    expect(b.get('rc_analog_13')).toBe('rc_analog_13')
    for (const [name, slot] of a) expect(b.get(name)).toBe(slot)
    // and nobody took rc_analog_13: Sensor_A..L -> 1..12, Sensor_M -> 14
    expect(a.get('Sensor_L')).toBe('rc_analog_12')
    expect(a.get('Sensor_M')).toBe('rc_analog_14')
    expect([...a.values()].filter((v) => v === 'rc_analog_13')).toEqual([])
  })

  it('is order-independent on a real fixture (vbo.loga, two orderings + reverse)', () => {
    const session = parseLoga(loadFixture('vbo.loga'))
    const ref = slotMap(session)
    const reversed = slotMap(new LogSession([...session.channels].reverse(), session.meta))
    const shuf = slotMap(new LogSession(shuffled(session.channels, 42), session.meta))
    expect(reversed).toEqual(ref)
    expect(shuf).toEqual(ref)
    expect(ref.size).toBeGreaterThan(100)
  })

  it('all slot names are unique on a real fixture', () => {
    const session = parseLoga(loadFixture('super2.loga'))
    const slots = buildVboCatalog(session).channels.map((c) => c.rcName)
    expect(new Set(slots).size).toBe(slots.length)
  })
})
