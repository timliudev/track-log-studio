import { describe, expect, it } from 'vitest'
import {
  availableDerivedAnalyzerChannels,
  MEASURED_TOTAL_RATIO_CHANNEL,
  resolveAnalyzerChannel,
} from '@/domain/analysis/analyzerChannels'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function channel(name: string, values: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(values) }
}

function session(channels: Channel[]): LogSession {
  return new LogSession(channels, { formatId: 'test', createdDate: null, headerInfo: {} })
}

describe('analyzer virtual channels', () => {
  it('resolves raw channels unchanged and derives the measured total ratio lazily', () => {
    const s = session([channel('RPM', [3000]), channel('GPS_Speed', [60])])
    const rpm = resolveAnalyzerChannel(s, 'RPM', { wheelCircumferenceMm: 1000 })
    const ratio = resolveAnalyzerChannel(s, MEASURED_TOTAL_RATIO_CHANNEL, { wheelCircumferenceMm: 1000 })

    expect(rpm.data).toBe(s.get('RPM')?.data)
    expect(rpm.derived).toBe(false)
    expect(ratio.derived).toBe(true)
    expect(ratio.error).toBeNull()
    expect(ratio.data?.[0]).toBeCloseTo(3)
  })

  it('only offers the virtual channel when RPM, speed and circumference are available', () => {
    const complete = session([channel('RPM', [3000]), channel('Vehicle_Speed', [60])])
    const noSpeed = session([channel('RPM', [3000])])

    expect(availableDerivedAnalyzerChannels(complete, { wheelCircumferenceMm: 1000 }))
      .toEqual([MEASURED_TOTAL_RATIO_CHANNEL])
    expect(availableDerivedAnalyzerChannels(noSpeed, { wheelCircumferenceMm: 1000 })).toEqual([])
    expect(availableDerivedAnalyzerChannels(complete, { wheelCircumferenceMm: 0 })).toEqual([])
  })
})
