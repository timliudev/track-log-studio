import { describe, it, expect } from 'vitest'
import { sessionStartAnchor } from '@/domain/analysis/startTime'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'

function ch(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function meta(createdDate: Date | null): LogMeta {
  return { formatId: 'superX', createdDate, headerInfo: {} }
}

describe('sessionStartAnchor', () => {
  it('uses the created date (wall-clock reinterpreted as UTC) when no GPS UTC', () => {
    const created = new Date(2024, 4, 17, 13, 45, 30, 250) // local components
    const session = new LogSession([ch('RPM', [1000, 2000, 3000])], meta(created))

    const anchor = sessionStartAnchor(session)
    expect(anchor).not.toBeNull()
    expect(anchor!.source).toBe('created')
    expect(anchor!.startUtcMs).toBe(Date.UTC(2024, 4, 17, 13, 45, 30, 250))
  })

  it('uses the first finite GPS UTC fix, anchored to elapsed=0 via the Time channel', () => {
    const created = new Date(2024, 4, 17, 0, 0, 0, 0)
    // First fix at sample 1 (sample 0 is NaN), Time channel elapsed in ms.
    const session = new LogSession(
      [
        ch('Time', [0, 1000, 2000]),
        ch('GPS_UTC_hh', [NaN, 10, 10]),
        ch('GPS_UTC_mm', [NaN, 30, 30]),
        ch('GPS_UTC_ss', [NaN, 15, 16]),
      ],
      meta(created),
    )

    const anchor = sessionStartAnchor(session)
    expect(anchor).not.toBeNull()
    expect(anchor!.source).toBe('gpsUtc')
    // Fix instant at sample 1 = 10:30:15; subtract elapsed offset (1000-0 = 1000ms).
    const fixMs = Date.UTC(2024, 4, 17, 10, 30, 15, 0)
    expect(anchor!.startUtcMs).toBe(fixMs - 1000)
  })

  it('returns null with no created date and no GPS UTC', () => {
    const session = new LogSession([ch('RPM', [1000, 2000])], meta(null))
    expect(sessionStartAnchor(session)).toBeNull()
  })
})
