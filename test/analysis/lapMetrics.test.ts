import { describe, it, expect } from 'vitest'
import { computeMetric, type LapContext } from '@/domain/analysis/lapMetrics'
import { aggregateChannel } from '@/domain/analysis/lapAggregate'
import { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import type { Channel, LogMeta } from '@/domain/model/types'

const META = {} as LogMeta

function session(channels: Array<{ name: string; data: number[] }>): LogSession {
  const chans: Channel[] = channels.map((c) => ({
    name: c.name,
    rawName: c.name,
    description: undefined,
    data: new Float32Array(c.data),
  }))
  return new LogSession(chans, META)
}

const lap: Lap = { index: 0, startIdx: 1, endIdx: 4, lapTimeMs: 92345 }

describe('computeMetric', () => {
  describe("kind 'lapTime'", () => {
    it('returns the lap duration verbatim, ignoring context', () => {
      const ctx: LapContext = { session: null, cumDistM: null }
      expect(computeMetric({ kind: 'lapTime' }, lap, ctx)).toBe(92345)
    })
  })

  describe("kind 'distance'", () => {
    it('returns the cumulative-distance delta over the lap span', () => {
      const cum = new Float64Array([0, 100, 250, 400, 600, 900])
      const ctx: LapContext = { session: null, cumDistM: cum }
      // span endIdx 4 - startIdx 1 -> 600 - 100
      expect(computeMetric({ kind: 'distance' }, lap, ctx)).toBe(500)
    })

    it('returns NaN when cumDistM is null', () => {
      const ctx: LapContext = { session: null, cumDistM: null }
      expect(Number.isNaN(computeMetric({ kind: 'distance' }, lap, ctx))).toBe(true)
    })

    it('returns NaN for a degenerate span (endIdx <= startIdx)', () => {
      const cum = new Float64Array([0, 100, 250, 400, 600, 900])
      const ctx: LapContext = { session: null, cumDistM: cum }
      const degenerate: Lap = { index: 0, startIdx: 3, endIdx: 3, lapTimeMs: 1 }
      expect(Number.isNaN(computeMetric({ kind: 'distance' }, degenerate, ctx))).toBe(true)
    })

    it('returns NaN when endIdx is out of range', () => {
      const cum = new Float64Array([0, 100, 250])
      const ctx: LapContext = { session: null, cumDistM: cum }
      const oob: Lap = { index: 0, startIdx: 0, endIdx: 9, lapTimeMs: 1 }
      expect(Number.isNaN(computeMetric({ kind: 'distance' }, oob, ctx))).toBe(true)
    })
  })

  describe("kind 'channel'", () => {
    it('matches aggregateChannel over the same span', () => {
      const data = [10, 40, 55, 80, 30, 5]
      const ctx: LapContext = { session: session([{ name: 'RPM', data }]), cumDistM: null }
      const f32 = new Float32Array(data)
      for (const agg of ['max', 'min', 'avg'] as const) {
        expect(computeMetric({ kind: 'channel', channel: 'RPM', agg }, lap, ctx)).toBe(
          aggregateChannel(f32, lap.startIdx, lap.endIdx, agg),
        )
      }
    })

    it('returns NaN when there is no session', () => {
      const ctx: LapContext = { session: null, cumDistM: null }
      expect(
        Number.isNaN(computeMetric({ kind: 'channel', channel: 'RPM', agg: 'max' }, lap, ctx)),
      ).toBe(true)
    })

    it('returns NaN for an empty channel string', () => {
      const ctx: LapContext = { session: session([{ name: 'RPM', data: [1, 2, 3, 4, 5] }]), cumDistM: null }
      expect(
        Number.isNaN(computeMetric({ kind: 'channel', channel: '', agg: 'max' }, lap, ctx)),
      ).toBe(true)
    })

    it('returns NaN for a channel missing from the session', () => {
      const ctx: LapContext = { session: session([{ name: 'RPM', data: [1, 2, 3, 4, 5] }]), cumDistM: null }
      expect(
        Number.isNaN(computeMetric({ kind: 'channel', channel: 'NOPE', agg: 'max' }, lap, ctx)),
      ).toBe(true)
    })
  })

  describe("kind 'sectorTime'", () => {
    it("returns this lap's sector time by index, found via lapIndex", () => {
      const ctx: LapContext = {
        session: null,
        cumDistM: null,
        sectorTimings: [
          { lapIndex: 0, sectorTimesMs: [1000, 2000, 3000], complete: true },
          { lapIndex: 1, sectorTimesMs: [900, 1900, 2900], complete: true },
        ],
      }
      expect(computeMetric({ kind: 'sectorTime', sector: 1 }, lap, ctx)).toBe(2000)
    })

    it('returns NaN when there is no timing entry for this lap', () => {
      const ctx: LapContext = { session: null, cumDistM: null, sectorTimings: [] }
      expect(Number.isNaN(computeMetric({ kind: 'sectorTime', sector: 0 }, lap, ctx))).toBe(true)
    })

    it('returns NaN when the sector index is out of range (e.g. incomplete lap)', () => {
      const ctx: LapContext = {
        session: null,
        cumDistM: null,
        sectorTimings: [{ lapIndex: 0, sectorTimesMs: [1000], complete: false }],
      }
      expect(Number.isNaN(computeMetric({ kind: 'sectorTime', sector: 1 }, lap, ctx))).toBe(true)
    })

    it('returns NaN when sectorTimings is absent from the context', () => {
      const ctx: LapContext = { session: null, cumDistM: null }
      expect(Number.isNaN(computeMetric({ kind: 'sectorTime', sector: 0 }, lap, ctx))).toBe(true)
    })
  })

  describe("kind 'delta'", () => {
    it("returns this lap's time minus the best lap's time", () => {
      const ctx: LapContext = { session: null, cumDistM: null, bestLapTimeMs: 90000 }
      expect(computeMetric({ kind: 'delta' }, lap, ctx)).toBe(92345 - 90000)
    })

    it('returns 0 for the best lap itself', () => {
      const ctx: LapContext = { session: null, cumDistM: null, bestLapTimeMs: 92345 }
      expect(computeMetric({ kind: 'delta' }, lap, ctx)).toBe(0)
    })

    it('returns NaN when bestLapTimeMs is null (no qualifying lap)', () => {
      const ctx: LapContext = { session: null, cumDistM: null, bestLapTimeMs: null }
      expect(Number.isNaN(computeMetric({ kind: 'delta' }, lap, ctx))).toBe(true)
    })

    it('returns NaN when bestLapTimeMs is absent from the context', () => {
      const ctx: LapContext = { session: null, cumDistM: null }
      expect(Number.isNaN(computeMetric({ kind: 'delta' }, lap, ctx))).toBe(true)
    })

    it("returns NaN when this lap's own lapTimeMs is not finite", () => {
      const broken: Lap = { index: 0, startIdx: 1, endIdx: 4, lapTimeMs: NaN }
      const ctx: LapContext = { session: null, cumDistM: null, bestLapTimeMs: 90000 }
      expect(Number.isNaN(computeMetric({ kind: 'delta' }, broken, ctx))).toBe(true)
    })
  })
})
