import { describe, it, expect } from 'vitest'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { buildVboCatalog } from '@/domain/export/vbo/VboExporter'
import { BOOL_NAME, NUMERIC_NAME, demoteConstantToAnalog } from '@/domain/export/vbo/channelNaming'
import { loadFixture } from '../fixtures'

function channel(name: string, data: number[], unit?: string): Channel {
  return { name, rawName: name, description: undefined, unit, data: new Float32Array(data) }
}
const META = { formatId: 'rcz', createdDate: null, headerInfo: {} }
const kindOf = (session: LogSession, name: string) =>
  buildVboCatalog(session).channels.find((c) => c.ctTitle === name)?.kind

describe('B127 — name evidence demotes constant quantity-named channels to analog', () => {
  const FIXTURES = ['vbo.loga', 'mxApp.loga', 'raceAmp.loga', 'super2.loga', 'superX.loga']
  const sessions = FIXTURES.map((f) => ({ f, s: parseLoga(loadFixture(f)) }))

  /** Kinds of `name` in every fixture that contains it. */
  const kindsAcross = (name: string): string[] =>
    sessions.map(({ s }) => kindOf(s, name)).filter((k): k is NonNullable<typeof k> => k !== undefined)

  it.each(['IR_LapNumber', 'IR_LapTime', 'SimRPM', 'MapNum'])('%s is analog', (name) => {
    const kinds = kindsAcross(name)
    expect(kinds.length, `${name} present in some fixture`).toBeGreaterThan(0)
    expect(new Set(kinds), name).toEqual(new Set(['analog']))
  })

  it.each([
    'Malf8.Malf_On',
    'Pit_SW_On',
    'TCCtrAct',
    'EngineBrakeEn',
    'GPS_Weak',
    'Fuel8.RPM_Limit',
    'Fuel10.MAPSW0',
    'Fuel1.Dec_FC_En',
    'LC_SW_On',
    'Quick_Shift_Act',
  ])('%s stays digital', (name) => {
    const kinds = kindsAcross(name)
    expect(kinds.length, `${name} present in some fixture`).toBeGreaterThan(0)
    expect(new Set(kinds), name).toEqual(new Set(['digital']))
  })

  it('never demotes a boolean-convention name that also reads as a quantity (allowlist wins)', () => {
    expect(BOOL_NAME.test('Fuel8.RPM_Limit')).toBe(true)
    expect(NUMERIC_NAME.test('Fuel8.RPM_Limit')).toBe(true)
    expect(demoteConstantToAnalog('Fuel8.RPM_Limit', new Float32Array([0, 0, 0]), 3)).toBe(false)
  })
})

describe('B127 — unit semantics of the name rule', () => {
  it('a toggling 0/1 channel stays digital whatever its name', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100, 200, 300]),
        channel('IR_LapNumber', [0, 1, 0, 1]),
        channel('SimRPM', [1, 1, 0, 1]),
        channel('Gear_Temp_Speed', [0, 0, 0, 1]),
      ],
      META,
    )
    for (const n of ['IR_LapNumber', 'SimRPM', 'Gear_Temp_Speed']) {
      expect(kindOf(session, n)).toBe('digital')
    }
  })

  it('a constant quantity-named channel without a unit becomes analog', () => {
    const session = new LogSession(
      [channel('Time', [0, 100, 200]), channel('IR_LapNumber', [0, 0, 0]), channel('MapNum', [1, 1, 1])],
      META,
    )
    expect(kindOf(session, 'IR_LapNumber')).toBe('analog')
    expect(kindOf(session, 'MapNum')).toBe('analog')
  })

  it('a constant numeric-named channel that has a source unit is unaffected (already analog, unit kept)', () => {
    const session = new LogSession(
      [channel('Time', [0, 100, 200]), channel('Engine_Temp', [0, 0, 0], 'degC')],
      META,
    )
    const c = buildVboCatalog(session).channels.find((x) => x.ctTitle === 'Engine_Temp')!
    expect(c.kind).toBe('analog')
    expect(c.unit).toBe('degC')
  })

  it('a constant channel with an ambiguous name keeps the pre-B127 behaviour (digital)', () => {
    const session = new LogSession([channel('Time', [0, 100]), channel('Fuel_CL', [0, 0])], META)
    expect(kindOf(session, 'Fuel_CL')).toBe('digital')
  })

  it('a constant channel with a flag-like name stays digital', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('Malf8.Malf_On', [0, 0]), channel('Pit_SW_On', [0, 0])],
      META,
    )
    expect(kindOf(session, 'Malf8.Malf_On')).toBe('digital')
    expect(kindOf(session, 'Pit_SW_On')).toBe('digital')
  })
})
