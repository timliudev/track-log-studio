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
  sessionMerge: 'sessionmerge',
} as const

/** Prefix for dynamic chart-card ids — see {@link chartItemId}. */
const CHART_PREFIX = 'chart-'

/**
 * B6 — minimum grid size (in grid units) a card may be resized down to, so
 * free-form resizing (grid-layout-plus's own resize handle, already wired up
 * since #8) can't shrink a card into an unreadable sliver: a chart/map with
 * `w:1,h:1` renders nothing useful, and the lap table would lose its header +
 * every row. Kept as a small per-KIND table rather than one global minimum
 * because a control panel (gear/track-file) is legitimately fine much
 * smaller than a chart or the map. Static ids not listed here (and any
 * chart-card id, which is NOT in this table — see the `isChartItemId` branch
 * of {@link minSizeFor}) fall back to `DEFAULT_MIN_SIZE`.
 */
const DEFAULT_MIN_SIZE = { minW: 2, minH: 3 } as const

const STATIC_MIN_SIZE: Partial<Record<string, { minW: number; minH: number }>> = {
  [STATIC_CARD_IDS.map]: { minW: 3, minH: 5 },
  [STATIC_CARD_IDS.lapTable]: { minW: 3, minH: 4 },
  [STATIC_CARD_IDS.sectors]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.trackChannel]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.accelTest]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.gear]: { minW: 3, minH: 4 },
  [STATIC_CARD_IDS.trackFile]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.mapAlign]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.lapAlign]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.sessionMerge]: { minW: 2, minH: 3 },
}

/** Chart cards (uPlot/echarts) need more room than a small control panel to
 *  stay legible — same minimum for every chart kind (line or scatter). */
const CHART_MIN_SIZE = { minW: 3, minH: 5 } as const

/** Minimum `{minW, minH}` (grid units) for a card id — see module doc above.
 *  Used both to decorate GridItem props (enforced live during drag/resize)
 *  and to defensively clamp sizes coming from an older persisted layout or a
 *  freshly-added default item (belt-and-braces; the default/[reconcile
 *  positions already respect these, so this is normally a no-op). */
export function minSizeFor(id: string): { minW: number; minH: number } {
  if (isChartItemId(id)) return CHART_MIN_SIZE
  return STATIC_MIN_SIZE[id] ?? DEFAULT_MIN_SIZE
}

/** Returns `item` unchanged if it already meets its minimum size, otherwise a
 *  NEW object clamped up to the minimum (never shrinks — only grows a
 *  too-small `w`/`h`). Pure; does not touch `x`/`y`. */
export function clampToMinSize(item: DashboardLayoutItem): DashboardLayoutItem {
  const { minW, minH } = minSizeFor(item.i)
  if (item.w >= minW && item.h >= minH) return item
  return { ...item, w: Math.max(item.w, minW), h: Math.max(item.h, minH) }
}

function rectsOverlap(a: DashboardLayoutItem, b: DashboardLayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Deterministic collision resolver — B6-review fix: `clampToMinSize` only
 * grows `w`/`h` and never touches `x`/`y`, so a card that was smaller than
 * the CURRENT minimum in an older persisted layout (saved before the B6
 * min-size table existed) can, after clamping, overlap a neighbour that used
 * to sit right next to/below it. Whether grid-layout-plus's initial mount
 * silently compacts away an overlapping `layout` prop is unverified (its
 * `verticalCompact` is only confirmed to fire on drag/resize-stop — see
 * AnalyzerView.vue's GridLayout comment), so `loadLayout` needs its own
 * guarantee rather than relying on that.
 *
 * Algorithm (semantically the same "resolve top-to-bottom, then left-to-
 * right" ordering vertical-compaction uses): sort items by `(y, x)` so the
 * placement order matches the user's visual reading order, then place them
 * one at a time — an item is pushed straight down (`y` increased, `x`/`w`/`h`
 * untouched) just far enough to clear every already-placed item it would
 * otherwise overlap. Pushing only ever increases `y`, so earlier (higher/
 * left) items are never displaced by later ones, keeping relative order
 * stable and avoiding any oscillation/infinite-loop risk.
 *
 * Pure and a no-op on an already non-overlapping layout (every item keeps
 * its original `x`/`y`/`w`/`h` — only pushed items get a new `y`).
 */
export function resolveOverlaps(layout: DashboardLayoutItem[]): DashboardLayoutItem[] {
  const order = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: DashboardLayoutItem[] = []
  for (const original of order) {
    let item = original
    // An item can be pushed down to clear one placed neighbour, which may
    // then newly overlap a DIFFERENT already-placed neighbour below the
    // first — re-scan from the top until a `y` is found that clears
    // everything already placed (guaranteed to terminate: `y` only ever
    // increases, and is bounded by the sum of all placed items' heights).
    let movedDown = true
    while (movedDown) {
      movedDown = false
      for (const other of placed) {
        if (rectsOverlap(item, other)) {
          item = { ...item, y: other.y + other.h }
          movedDown = true
        }
      }
    }
    placed.push(item)
  }
  // Restore the original array order (the sort above was only a placement
  // strategy) so callers see the same item at the same array index.
  const byId = new Map(placed.map((it) => [it.i, it]))
  return layout.map((it) => byId.get(it.i)!)
}

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
    { i: STATIC_CARD_IDS.sessionMerge, x: 0, y: 46, w: 5, h: 8 },
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
    const parsed = parseLayout(localStorage.getItem(STORAGE_KEY))
    if (!parsed) return defaultLayout()
    // Clamp on load so a layout saved BEFORE the B6 minimum-size table existed
    // (or corrupted by a manual localStorage edit) can't hand GridItem a
    // smaller-than-minW/minH item — see clampToMinSize's doc.
    const clamped = parsed.map(clampToMinSize)
    // If clamping didn't actually change anything, the layout is either a
    // normal (already-valid) user layout or was never touched — return it
    // AS-IS rather than running it through resolveOverlaps, which reorders
    // nothing but does re-derive `y` for anything it deems "overlapping" by
    // placement order; a legitimately-authored layout must come back
    // byte-for-byte identical (see test: "leaves an already-valid persisted
    // layout untouched"). Only when clamping actually grew some item's
    // w/h — which can newly create overlaps with an old, pre-B6 layout — do
    // we need resolveOverlaps's collision guarantee.
    const changed = clamped.some((it, idx) => it !== parsed[idx])
    return changed ? resolveOverlaps(clamped) : clamped
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

/** Fallback row-height for a mobile card whose id isn't in the desktop layout
 *  (shouldn't happen after reconciliation, but keeps the builder total). */
const MOBILE_DEFAULT_H = 8

/**
 * #9 (revised) — build the MOBILE single-column (cols=1) layout from an
 * explicit top-to-bottom card ORDER (the user's persisted `mobileOrder`, see
 * panelState.ts). Every item is full-width (`x:0, w:1`) and stacked by
 * cumulative height so the column reads top-to-bottom in exactly `order`.
 * Each card keeps its DESKTOP `h` (looked up from `desktopLayout`) so a tall
 * card (map/chart) stays tall and a short control panel stays short — the
 * mobile order is the only thing the user chose, heights are inherited.
 *
 * `order` should already be reconciled (visible + existing ids only); any id
 * not found in `desktopLayout` falls back to a default height. This is what
 * gets PASSED to GridLayout on mobile (instead of the library's own responsive
 * reflow) so drag-to-reorder writes back a pure order, never a 2-D arrangement
 * that could leak into the desktop layout.
 */
export function mobileLayout(
  order: string[],
  desktopLayout: DashboardLayoutItem[],
): DashboardLayoutItem[] {
  const hById = new Map(desktopLayout.map((it) => [it.i, it.h]))
  let y = 0
  return order.map((i) => {
    const h = hById.get(i) ?? MOBILE_DEFAULT_H
    const item = { i, x: 0, y, w: 1, h }
    y += h
    return item
  })
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
