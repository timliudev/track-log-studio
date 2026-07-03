/**
 * #8 — Analyzer dashboard grid layout persistence (grid-layout-plus).
 *
 * The grid itself (GridLayout's `layout` v-model) is just an array of
 * `{ i, x, y, w, h }` entries keyed by a STABLE STRING id — never an array
 * index, since charts can be added/removed/reordered (see reconcile* below).
 * Static (always-present) cards use fixed ids (see `STATIC_CARD_IDS`); dynamic
 * chart cards use `chartItemId(chart.id)` so they track the chart's own
 * store-assigned id, not its position in `analyzerStore.charts`.
 *
 * Persisted to localStorage as a flat `LayoutItem[]` — same global-slot
 * pattern as drivetrainStore/settingsStore/suspensionStore (`aracer-loga.*.v1`
 * keys), not per-circuit: the user's preferred dashboard arrangement is a
 * device/UI preference, not something that should change when they load a
 * different log.
 */

/** One grid item's position/size, keyed by a stable string id (see module doc). */
export interface DashboardLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

export const STORAGE_KEY = 'aracer-loga.dashboardLayout.v1'

/** Total column count of the wide (desktop) grid — see AnalyzerView's GridLayout `cols`. */
export const GRID_COLS = 12

/** Static (always-present) card ids, in the same order as the default layout below. */
export const STATIC_CARD_IDS = {
  map: 'map',
  lapTable: 'laptable',
  sectors: 'sectors',
  trackChannel: 'trackchannel',
  accelTest: 'acceltest',
  gear: 'gear',
  trackFile: 'trackfile',
  mapAlign: 'mapalign',
  lapAlign: 'lapalign',
} as const

/** Prefix for dynamic chart-card ids — see {@link chartItemId}. */
const CHART_PREFIX = 'chart-'

/** The grid item id for a chart, keyed by the chart's OWN store id (stable
 *  across add/remove/reorder) — never its index in `analyzerStore.charts`. */
export function chartItemId(chartId: number): string {
  return `${CHART_PREFIX}${chartId}`
}

/** True when `id` is a dynamic chart-card id (as opposed to a static card). */
export function isChartItemId(id: string): boolean {
  return id.startsWith(CHART_PREFIX)
}

/**
 * Default (wide/desktop) layout: map + lap table anchor a left column (map on
 * top, lap table below it), tool panels (sectors/track-channel/accel/gear/
 * track-file) continue that left column further down, and the right column —
 * wider, since charts benefit most from horizontal space — starts with the
 * two align panels (only relevant once laps are selected, so they sit right
 * above where charts appear) followed by chart cards (appended dynamically,
 * see {@link reconcileLayout}). This keeps the map+lap-table "at a glance"
 * priority from the old single-column flow while actually using a wide
 * screen's side space, per the task's design goal.
 */
export function defaultLayout(): DashboardLayoutItem[] {
  return [
    { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 5, h: 10 },
    { i: STATIC_CARD_IDS.lapTable, x: 0, y: 10, w: 5, h: 8 },
    { i: STATIC_CARD_IDS.sectors, x: 0, y: 18, w: 5, h: 6 },
    { i: STATIC_CARD_IDS.trackChannel, x: 0, y: 24, w: 5, h: 5 },
    { i: STATIC_CARD_IDS.accelTest, x: 0, y: 29, w: 5, h: 5 },
    { i: STATIC_CARD_IDS.gear, x: 0, y: 34, w: 5, h: 7 },
    { i: STATIC_CARD_IDS.trackFile, x: 0, y: 41, w: 5, h: 5 },
    { i: STATIC_CARD_IDS.mapAlign, x: 5, y: 0, w: 7, h: 5 },
    { i: STATIC_CARD_IDS.lapAlign, x: 5, y: 5, w: 7, h: 5 },
    // First chart (the store's initial default chart) starts the right
    // column's chart stack; further charts are appended below it by
    // reconcileLayout's "new item" path.
    { i: chartItemId(1), x: 5, y: 10, w: 7, h: 9 },
  ]
}

/** Default size for a chart card appended after the initial layout (e.g. via
 *  "add chart"), placed at the bottom of the right (wide) column so it
 *  doesn't overlap existing cards — grid-layout-plus's vertical compaction
 *  then settles it upward if there's room. */
function defaultChartItem(id: string, layout: DashboardLayoutItem[]): DashboardLayoutItem {
  const maxY = layout.reduce((m, it) => Math.max(m, it.y + it.h), 0)
  return { i: id, x: 5, y: maxY, w: 7, h: 9 }
}

/** Parse persisted JSON into a layout array, or null if missing/invalid
 *  (caller falls back to {@link defaultLayout}). Deliberately permissive
 *  about extra fields (min/max/static from a future version) by just
 *  filtering to the shape this module understands. */
export function parseLayout(raw: string | null): DashboardLayoutItem[] | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return null
    const items: DashboardLayoutItem[] = []
    for (const it of data) {
      if (
        it &&
        typeof it.i === 'string' &&
        Number.isFinite(it.x) &&
        Number.isFinite(it.y) &&
        Number.isFinite(it.w) &&
        Number.isFinite(it.h)
      ) {
        items.push({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h })
      }
    }
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

export function loadLayout(): DashboardLayoutItem[] {
  try {
    return parseLayout(localStorage.getItem(STORAGE_KEY)) ?? defaultLayout()
  } catch {
    return defaultLayout()
  }
}

export function saveLayout(layout: DashboardLayoutItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // storage unavailable / quota — layout simply won't persist
  }
}

/**
 * Reconcile a layout against the CURRENT set of chart ids (static card ids
 * never change, so only chart cards need reconciling): appends a default-
 * positioned item for any chart id missing from the layout (a newly added
 * chart), and drops any chart-card entry whose chart no longer exists (a
 * removed chart) — static-card entries are always kept even if momentarily
 * absent from `chartIds` (they're not chart ids, so they're untouched by
 * either pass). Called after loading a persisted layout AND after every
 * add/remove so the layout array and `analyzerStore.charts` never drift out
 * of sync (stale entries would otherwise accumulate in localStorage forever).
 */
export function reconcileLayout(
  layout: DashboardLayoutItem[],
  chartIds: number[],
): DashboardLayoutItem[] {
  const wantedChartItemIds = new Set(chartIds.map(chartItemId))
  // Drop chart-card entries for charts that no longer exist; keep every
  // static-card entry (and any not-yet-recognised id) untouched.
  const kept = layout.filter((it) => !isChartItemId(it.i) || wantedChartItemIds.has(it.i))

  const present = new Set(kept.map((it) => it.i))
  const result = [...kept]
  for (const chartId of chartIds) {
    const id = chartItemId(chartId)
    if (!present.has(id)) {
      result.push(defaultChartItem(id, result))
    }
  }
  return result
}
