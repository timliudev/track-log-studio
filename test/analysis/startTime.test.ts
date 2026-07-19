import { describe, it, expect } from 'vitest'
import { resolveClockTimezoneOffset, sessionStartAnchor } from '@/domain/analysis/startTime'
import { formatClock } from '@/domain/analysis/axisFormat'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'

function ch(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function meta(createdDate: Date | null): LogMeta {
  return { formatId: 'superX', createdDate, headerInfo: {} }
}

describe('sessionStartAnchor', () => {
  it('retains the created-date instant when no GPS UTC', () => {
    // The +08:00 suffix makes this regression independent of the test host's
    // timezone: treating getFullYear()/getHours() as UTC would be eight hours
    // wrong, while getTime() retains the parsed instant.
    const created = new Date('2024-05-17T13:45:30.250+08:00')
    const session = new LogSession([ch('RPM', [1000, 2000, 3000])], meta(created))

    const anchor = sessionStartAnchor(session)
    expect(anchor).not.toBeNull()
    expect(anchor!.source).toBe('created')
    expect(anchor!.startUtcMs).toBe(created.getTime())
    expect(formatClock(anchor!.startUtcMs, resolveClockTimezoneOffset('auto', 480))).toBe('13:45:30')
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

describe('resolveClockTimezoneOffset', () => {
  it('uses the browser local offset for the app auto setting', () => {
    expect(resolveClockTimezoneOffset('auto', 480)).toBe(480)
  })

  it('keeps an explicit timezone override for both created and GPS anchors', () => {
    expect(resolveClockTimezoneOffset(-300, 480)).toBe(-300)
    expect(resolveClockTimezoneOffset(0, 480)).toBe(0)
  })

  it('falls back safely if a browser offset is unavailable', () => {
    expect(resolveClockTimezoneOffset('auto', NaN)).toBe(0)
  })
})
