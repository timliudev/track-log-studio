import { describe, expect, it } from 'vitest'
import { buildGearRatioTrace } from '@/domain/analysis/gearRatioTrace'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function session(channels: Channel[]): LogSession {
  return new LogSession(channels, { formatId: 'test', createdDate: null, headerInfo: {} })
}

describe('buildGearRatioTrace', () => {
  it('reuses the drivetrain ratio calculation and keeps main-chart sample alignment', () => {
    const result = buildGearRatioTrace(
      session([
        channel('Time', [0, 100, 200]),
        channel('RPM', [3000, 4000]),
        channel('GPS_Speed', [60, 60, 60]),
      ]),
      1000,
    )

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(3)
    expect(result.data?.[0]).toBeCloseTo(3)
    expect(result.data?.[1]).toBeCloseTo(4)
    expect(result.data?.[2]).toBeNaN()
  })

  it.each([
    ['rpm', [channel('Time', [0]), channel('GPS_Speed', [60])], 1000],
    ['speed', [channel('Time', [0]), channel('RPM', [3000])], 1000],
    ['circumference', [channel('RPM', [3000]), channel('GPS_Speed', [60])], 0],
  ] as const)('reports %s precondition failures without manufacturing data', (error, channels, circumference) => {
    expect(buildGearRatioTrace(session([...channels]), circumference)).toEqual({ data: null, error })
  })
})
