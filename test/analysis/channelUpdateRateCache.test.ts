import { describe, expect, it } from 'vitest'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { cachedChannelUpdateRateHz } from '@/composables/channelUpdateRateCache'

function channel(name: string, values: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(values) }
}

describe('channelUpdateRateCache', () => {
  it('keeps one computed result per session and channel key', () => {
    const session = new LogSession(
      [channel('Time', [0, 100, 200, 300])],
      { formatId: 'test', createdDate: null, headerInfo: {} },
    )
    expect(cachedChannelUpdateRateHz(session, 'Virtual', [1, 2, 3, 4])).toBeCloseTo(10)
    // A different array for the same file+channel cannot trigger a second scan.
    expect(cachedChannelUpdateRateHz(session, 'Virtual', [1, 1, 1, 1])).toBeCloseTo(10)
  })
})
