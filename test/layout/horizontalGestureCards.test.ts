import { describe, it, expect } from 'vitest'
import { consumesHorizontalDrag } from '@/domain/layout/horizontalGestureCards'
import { STATIC_CARD_IDS, chartItemId } from '@/domain/layout/dashboardLayout'

describe('consumesHorizontalDrag', () => {
  it('is true for the track map — TrackMap.vue owns pan/drag', () => {
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.map)).toBe(true)
  })

  it('is true for any dynamic chart id — both chart kinds own a horizontal drag', () => {
    expect(consumesHorizontalDrag(chartItemId(1))).toBe(true)
    expect(consumesHorizontalDrag(chartItemId(42))).toBe(true)
    expect(consumesHorizontalDrag('chart-999')).toBe(true)
  })

  it('is false for every other static card — plain panels/tables/forms, no internal horizontal drag', () => {
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.lapTable)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.sectors)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.trackChannel)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.accelTest)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.gear)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.cvtDynamics)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.trackFile)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.sessionMerge)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.suspension)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.currentValues)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.mapAlign)).toBe(false)
    expect(consumesHorizontalDrag(STATIC_CARD_IDS.lapAlign)).toBe(false)
  })

  it('is false for an unknown/made-up id (defensive default)', () => {
    expect(consumesHorizontalDrag('not-a-real-card-id')).toBe(false)
    expect(consumesHorizontalDrag('')).toBe(false)
  })
})
