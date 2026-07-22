import { STATIC_CARD_IDS } from './dashboardLayout'

/**
 * F2 — the FUNCTIONAL grouping the card menu (CardMenu.vue) organises static
 * cards under, so the menu reads as "地圖與軌跡 / 圈速與分段 / 通道與數值 /
 * 傳動 / 匯流" sections rather than one long flat list. A pure data table
 * (like STATIC_CARD_TITLE_KEYS in dashboardLayout.ts) rather than logic, so
 * it's trivially unit-testable (every STATIC_CARD_IDS value must have an
 * entry) and the menu component itself stays presentation-only.
 *
 * Charts are NOT listed here — they get their own dedicated "圖表" section
 * built directly from `analyzerStore.charts` (one row per chart instance, an
 * "add" row at the bottom) since they're one-to-many rather than a fixed
 * static id, see CardMenu.vue.
 */
export type CardGroupId = 'mapTrack' | 'lapsSectors' | 'channelsValues' | 'drivetrain' | 'sessionMerge'

export interface CardGroupDef {
  id: CardGroupId
  labelKey: string
}

/** Section order as they appear in the menu. */
export const CARD_GROUPS: CardGroupDef[] = [
  { id: 'mapTrack', labelKey: 'analyzer.cardMenu.groupMapTrack' },
  { id: 'lapsSectors', labelKey: 'analyzer.cardMenu.groupLapsSectors' },
  { id: 'channelsValues', labelKey: 'analyzer.cardMenu.groupChannelsValues' },
  { id: 'drivetrain', labelKey: 'analyzer.cardMenu.groupDrivetrain' },
  { id: 'sessionMerge', labelKey: 'analyzer.cardMenu.groupSessionMerge' },
]

/** Which section each STATIC card id belongs to. Every value of
 *  STATIC_CARD_IDS must have an entry (see cardGroups.test.ts). */
export const STATIC_CARD_GROUP: Record<string, CardGroupId> = {
  [STATIC_CARD_IDS.map]: 'mapTrack',
  [STATIC_CARD_IDS.trackFile]: 'mapTrack',
  [STATIC_CARD_IDS.mapAlign]: 'mapTrack',
  [STATIC_CARD_IDS.trackChannel]: 'mapTrack',
  [STATIC_CARD_IDS.lapTable]: 'lapsSectors',
  [STATIC_CARD_IDS.sectors]: 'lapsSectors',
  [STATIC_CARD_IDS.lapAlign]: 'lapsSectors',
  [STATIC_CARD_IDS.accelTest]: 'lapsSectors',
  [STATIC_CARD_IDS.currentValues]: 'channelsValues',
  [STATIC_CARD_IDS.suspension]: 'channelsValues',
  [STATIC_CARD_IDS.gear]: 'drivetrain',
  [STATIC_CARD_IDS.cvtDynamics]: 'drivetrain',
  [STATIC_CARD_IDS.sessionMerge]: 'sessionMerge',
}
