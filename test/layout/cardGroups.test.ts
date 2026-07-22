import { describe, expect, it } from 'vitest'
import { CARD_GROUPS, STATIC_CARD_GROUP } from '@/domain/layout/cardGroups'
import { STATIC_CARD_IDS } from '@/domain/layout/dashboardLayout'

describe('cardGroups', () => {
  it('assigns every STATIC_CARD_IDS value to a known group', () => {
    const validGroupIds = new Set(CARD_GROUPS.map((g) => g.id))
    for (const id of Object.values(STATIC_CARD_IDS)) {
      expect(STATIC_CARD_GROUP[id], `missing group for card id "${id}"`).toBeDefined()
      expect(validGroupIds.has(STATIC_CARD_GROUP[id])).toBe(true)
    }
  })

  it('every group has a non-empty labelKey', () => {
    for (const group of CARD_GROUPS) {
      expect(group.labelKey.length).toBeGreaterThan(0)
    }
  })
})
