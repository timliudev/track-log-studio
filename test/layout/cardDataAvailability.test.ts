import { describe, expect, it } from 'vitest'
import { cardHasData, type CardDataContext } from '@/domain/layout/cardDataAvailability'
import { STATIC_CARD_IDS } from '@/domain/layout/dashboardLayout'

const baseCtx: CardDataContext = {
  hasSectorGates: false,
  hasAccelSegment: false,
  hasSuspensionChannel: false,
  drivetrainKind: 'mt',
}

describe('cardHasData', () => {
  it('sectors: follows hasSectorGates', () => {
    expect(cardHasData(STATIC_CARD_IDS.sectors, baseCtx)).toBe(false)
    expect(cardHasData(STATIC_CARD_IDS.sectors, { ...baseCtx, hasSectorGates: true })).toBe(true)
  })

  it('accelTest: follows hasAccelSegment', () => {
    expect(cardHasData(STATIC_CARD_IDS.accelTest, baseCtx)).toBe(false)
    expect(cardHasData(STATIC_CARD_IDS.accelTest, { ...baseCtx, hasAccelSegment: true })).toBe(true)
  })

  it('suspension: follows hasSuspensionChannel', () => {
    expect(cardHasData(STATIC_CARD_IDS.suspension, baseCtx)).toBe(false)
    expect(
      cardHasData(STATIC_CARD_IDS.suspension, { ...baseCtx, hasSuspensionChannel: true }),
    ).toBe(true)
  })

  it('gear: only for an MT drivetrain', () => {
    expect(cardHasData(STATIC_CARD_IDS.gear, { ...baseCtx, drivetrainKind: 'mt' })).toBe(true)
    expect(cardHasData(STATIC_CARD_IDS.gear, { ...baseCtx, drivetrainKind: 'cvt' })).toBe(false)
  })

  it('cvtDynamics: only for a CVT drivetrain', () => {
    expect(cardHasData(STATIC_CARD_IDS.cvtDynamics, { ...baseCtx, drivetrainKind: 'cvt' })).toBe(true)
    expect(cardHasData(STATIC_CARD_IDS.cvtDynamics, { ...baseCtx, drivetrainKind: 'mt' })).toBe(false)
  })

  it('every other static card defaults ON regardless of context', () => {
    const alwaysOn = [
      STATIC_CARD_IDS.map,
      STATIC_CARD_IDS.lapTable,
      STATIC_CARD_IDS.trackChannel,
      STATIC_CARD_IDS.trackFile,
      STATIC_CARD_IDS.mapAlign,
      STATIC_CARD_IDS.lapAlign,
      STATIC_CARD_IDS.sessionMerge,
      STATIC_CARD_IDS.currentValues,
    ]
    for (const id of alwaysOn) {
      expect(cardHasData(id, baseCtx)).toBe(true)
    }
  })

  it('an unknown id (e.g. a chart card id) defaults ON', () => {
    expect(cardHasData('chart-1', baseCtx)).toBe(true)
  })
})
