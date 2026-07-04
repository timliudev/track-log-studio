import { describe, it, expect } from 'vitest'
import { axisNameFields } from '@/features/analyzer/GgChart.vue'

describe('axisNameFields (#10 — scatter axis channel-name labels)', () => {
  it('returns name/nameLocation/nameGap when a channel name is given', () => {
    expect(axisNameFields('TC_Xforce')).toEqual({
      name: 'TC_Xforce',
      nameLocation: 'middle',
      nameGap: 28,
    })
  })

  it('returns an empty object for null/undefined/empty so it is a no-op when spread', () => {
    expect(axisNameFields(null)).toEqual({})
    expect(axisNameFields(undefined)).toEqual({})
    expect(axisNameFields('')).toEqual({})
  })
})
