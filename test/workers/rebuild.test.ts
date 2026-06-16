import { describe, it, expect } from 'vitest'
import { rebuildLogSession } from '@/workers/rebuildSession'
import type { SerializedChannel } from '@/workers/parseProtocol'
import type { LogMeta } from '@/domain/model/types'

describe('rebuildLogSession', () => {
  it('reconstructs a working LogSession from serialized channels', () => {
    const channels: SerializedChannel[] = [
      { name: 'Time', rawName: 'Time', description: undefined, data: new Float32Array([0, 62.5, 125]) },
      { name: 'RPM', rawName: 'RPM/引擎轉速', description: '引擎轉速', data: new Float32Array([1000, 2000, 3000]) },
    ]
    const meta: LogMeta = { formatId: 'superX', createdDate: null, headerInfo: {} }

    const session = rebuildLogSession(channels, meta)

    expect(session.rowCount).toBe(3)
    expect(session.has('RPM')).toBe(true)
    expect(session.get('RPM')?.data[1]).toBe(2000)
    expect(session.sampleIntervalMs).toBeCloseTo(62.5, 5)
    expect(session.meta.formatId).toBe('superX')
  })
})
