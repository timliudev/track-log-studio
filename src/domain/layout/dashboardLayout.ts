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

/** Row height (px) and [x,y] margin (px) passed to `<GridLayout>` — exported
 *  (rather than left as literals in AnalyzerView.vue's template) so
 *  useGridGutters.ts's pixel math (gridGutter.ts's `GridMetrics`) can use the
 *  EXACT same numbers grid-layout-plus itself lays cards out with; two
 *  independent copies of "24" and "[12, 12]" would silently drift if either
 *  one were ever tuned without remembering the other (#2 — gutter overlay
 *  must line up pixel-for-pixel with the real card edges). */
export const GRID_ROW_HEIGHT = 24
export const GRID_MARGIN: [number, number] = [12, 12]

/** Static (always-present) card ids, in the same order as the default layout below. */
export const STATIC_CARD_IDS = {
  map: 'map',
  lapTable: 'laptable',
  sectors: 'sectors',
  trackChannel: 'trackchannel',
  accelTest: 'acceltest',
  gear: 'gear',
  cvtDynamics: 'cvtdynamics',
  trackFile: 'trackfile',
  mapAlign: 'mapalign',
  lapAlign: 'lapalign',
  sessionMerge: 'sessionmerge',
  suspension: 'suspension',
  currentValues: 'currentvalues',
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
  [STATIC_CARD_IDS.cvtDynamics]: { minW: 3, minH: 7 },
  [STATIC_CARD_IDS.trackFile]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.mapAlign]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.lapAlign]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.sessionMerge]: { minW: 2, minH: 3 },
  [STATIC_CARD_IDS.suspension]: { minW: 2, minH: 3 },
  // B15/B43/B43b — floor lowered to minW:1 (below every other control panel's
  // minW:2). B43 dropped the floor to 2 and switched the value grid itself to
  // `auto-fill minmax(min(96px,100%),1fr)` (see CurrentValuesPanel.vue) so it
  // COULD collapse to a single column — but at GRID_COLS=12 a 2-grid-unit-wide
  // card is, on any realistic desktop window, still comfortably wide enough
  // for two 96px cells side by side (e.g. at a 1280px window: colWidth ≈
  // (1280 - 12*13)/12 ≈ 93.7px/col, so a w:2 card is ≈ 93.7*2+12 ≈ 199px
  // outer / ≈ 175px content after the card's 12px+12px body padding — comfortably
  // over the 96*2+8(gap) = 200px... actually just under it, but far from the
  // ~70-95px content width a TRUE single-column squeeze implies), so B43
  // never actually reached the single-column case it was meant to enable —
  // hence B43b. At minW:1, a w:1 card's content is ≈ 93.7-24 ≈ 70px at
  // 1280px, ≈ 123px at 1920px, ≈ 176px at 2560px — all comfortably under the
  // 200px (96*2+8 gap) needed for a second 96px column, so the existing
  // `minmax(min(96px,100%),1fr)` track sizing (unchanged — no need to shrink
  // the 96px floor further) naturally renders exactly one column with no
  // horizontal scrollbar/clipping. (Only an extremely wide, ~3600px+ browser
  // window would still fit two columns at minW:1 — at that point there's
  // genuine extra room, so a second column there is a reasonable use of the
  // space rather than a bug.)
  [STATIC_CARD_IDS.currentValues]: { minW: 1, minH: 3 },
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

/**
 * Per-item drag/resize eligibility — pure decision functions so AnalyzerView
 * only needs to CALL these rather than encode the rule itself (logic lives in
 * the domain layer per this project's "component stays thin" convention).
 *
 * A card is draggable/resizable when the GRID-WIDE toggle allows it (the
 * global 鎖定布局 lock — see layoutLock.ts — combined with whatever the
 * current breakpoint already permits) AND the card itself isn't the
 * currently-pinned one: a pinned card's real content has been Teleported out
 * of the grid into the sticky pinned anchor (see AnalyzerView's module doc),
 * so its grid slot is just an empty placeholder — dragging/resizing THAT
 * placeholder (via grid-layout-plus's own handles) would be meaningless
 * (nothing visibly moves) and would desync the placeholder's size from the
 * card's actual position it returns to on unpin.
 *
 * B18 — this does NOT mean a pinned card can't be resized at all: the
 * floating card itself has its own, separate corner-drag resize handle (see
 * DashboardCard.vue's `pin-resize-handle` / `pinnedSize`), independent of
 * the grid entirely. Only the grid-layout-plus resize handle on the inert
 * grid-slot placeholder is disabled here.
 */
export function isItemDraggable(globalDraggable: boolean, pinned: boolean): boolean {
  return globalDraggable && !pinned
}
export function isItemResizable(globalResizable: boolean, pinned: boolean): boolean {
  return globalResizable && !pinned
}

/**
 * B59 — 手機單欄模式下,調整卡片尺寸會自己往右延伸(放開才彈回原寬)。根因
 * (讀 node_modules/grid-layout-plus/src/components/grid-item.vue 的
 * `tryMakeResizable`/`handleResize` 查證): 該套件的角落把手預設同時掛
 * `edges.right` 和 `edges.bottom` 在同一個選取器上(單一小方塊同時代表「可橫向
 * +可縱向」),拖曳期間 `state.resizing.width` 直接跟著指尖 X 位移即時變動,不會
 * 等到手放開才 clamp——單欄下任何 w>1 的暫態寬度都會把卡片視覺上推出右邊界,
 * 直到 `resizeend` 呼叫 `calcWH()` 才夾回 `w<=cols`(=1),於是「放掉寬度才彈回」。
 * grid-layout-plus 沒有內建「單軸 resize」開關,但 GridItem 的 `resizeOption`
 * prop 會整包蓋掉 grid-item.vue 自己組出的 `edges`(見該檔案
 * `{ edges, ignoreFrom, restrictSize, ...props.resizeOption }`),所以可以在
 * 我們這層用同一個把手選取器,只保留 `bottom` 這個邊——`handleResize` 裡
 * `if (!event.edges.right && !event.edges.left) lastW = x` 這行本來就是給
 * 「純垂直 resize」用的:每次 move 都把 lastW 釘回目前的 x,下一輪算出的
 * deltaX 恆為 0,寬度全程不變,不需要等 resizeend 才夾回——沒有暫態、沒有彈跳。
 * 選取器沿用 AnalyzerView.vue 已經在用的 `.vgl-item__resizer`(themed 在該檔案
 * 的 `<style>`),對應 grid-item.vue 內 `useNameHelper('item').be('resizer')`
 * 的固定輸出,非 RTL 情境下就是這個字串。
 */
const VERTICAL_RESIZE_HANDLE_SELECTOR = '.vgl-item__resizer'

/** 手機單欄下要餵給 GridItem 的 `resizeOption`——只保留 bottom 邊,水平方向
 *  (left/right)一律 false,讓拖曳角落把手時橫向位移完全不影響寬度。桌面 2-D
 *  網格不套用這個(維持原本四個邊都可用的自由 resize),見 {@link resizeOptionFor}。 */
export const VERTICAL_ONLY_RESIZE_OPTION: Record<string, unknown> = {
  edges: { left: false, right: false, top: false, bottom: VERTICAL_RESIZE_HANDLE_SELECTOR },
}

/** 依目前斷點決定要不要把 resize 鎖成只能改高度——手機(單欄)鎖,桌面(2-D 網格)
 *  不鎖。回傳 `undefined`(而不是空物件)給桌面,讓 GridItem 使用它自己預設的
 *  `resizeOption: () => ({})`,不留下一個「什麼都沒覆蓋」的空物件痕跡。 */
export function resizeOptionFor(isMobile: boolean): Record<string, unknown> | undefined {
  return isMobile ? VERTICAL_ONLY_RESIZE_OPTION : undefined
}

/** i18n message key (under `analyzer.layout`) for each STATIC card's title —
 *  a plain data table so AnalyzerView's pinned-placeholder label (rendered
 *  OUTSIDE the big per-card template branch — see its module doc) can look up
 *  a title without duplicating that branch's own per-card `t(...)` calls.
 *  Dynamic chart cards aren't in this table — their title is numbered by
 *  position (see chartTitle in AnalyzerView) rather than a fixed key. */
export const STATIC_CARD_TITLE_KEYS: Record<string, string> = {
  [STATIC_CARD_IDS.map]: 'analyzer.layout.cardMap',
  [STATIC_CARD_IDS.lapTable]: 'analyzer.layout.cardLapTable',
  [STATIC_CARD_IDS.sectors]: 'analyzer.layout.cardSectors',
  [STATIC_CARD_IDS.trackChannel]: 'analyzer.layout.cardTrackChannel',
  [STATIC_CARD_IDS.accelTest]: 'analyzer.layout.cardAccelTest',
  [STATIC_CARD_IDS.gear]: 'analyzer.layout.cardGear',
  [STATIC_CARD_IDS.cvtDynamics]: 'analyzer.layout.cardCvtDynamics',
  [STATIC_CARD_IDS.trackFile]: 'analyzer.layout.cardTrackFile',
  [STATIC_CARD_IDS.mapAlign]: 'analyzer.layout.cardMapAlign',
  [STATIC_CARD_IDS.lapAlign]: 'analyzer.layout.cardLapAlign',
  [STATIC_CARD_IDS.sessionMerge]: 'analyzer.layout.cardSessionMerge',
  [STATIC_CARD_IDS.suspension]: 'analyzer.layout.cardSuspension',
  [STATIC_CARD_IDS.currentValues]: 'analyzer.layout.cardCurrentValues',
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

/**
 * Grid-compact fix — pull every card toward the TOP-LEFT corner, closing both
 * vertical AND horizontal gaps. grid-layout-plus's own `verticalCompact` (the
 * `:vertical-compact="true"` prop on `<GridLayout>`, see AnalyzerView.vue)
 * only ever pulls a card UP within its own x-span — it has no notion of also
 * sliding a card LEFT into space freed up in an adjacent column (there's no
 * `compact-type: 'horizontal'`-equivalent in this library, unlike e.g.
 * react-grid-layout). That's what leaves the "hole" this fixes: deleting a
 * chart from a short column, or moving a card away from one, can leave a
 * gap that only a card sitting in a DIFFERENT x range could fill, and
 * grid-layout-plus's vertical-only pass will never do that.
 *
 * Algorithm: process items in reading order (top-to-bottom, then left-to-
 * right — `(y, x)`, same placement-priority ordering {@link resolveOverlaps}
 * uses) so an item already near the top-left keeps priority over one lower/
 * righter when both could claim the same freed slot. Each item is then
 * repeatedly nudged up one row, then left one column, alternating until
 * neither move is possible without colliding with an already-placed item —
 * alternating (rather than "all the way up, then all the way left, once") is
 * necessary because sliding an item left can open up NEW vertical space above
 * it that a single up-then-left pass would miss. Only previously-placed items
 * are checked for collision (same one-directional dependency `resolveOverlaps`
 * relies on for termination): `x`/`y` only ever DECREASE and are bounded below
 * by 0, so the loop is guaranteed to terminate.
 *
 * This is a greedy "gravity" pack (same family as gridstack.js's `float:
 * false` compaction), not a globally-optimal bin-packing — good enough for a
 * dashboard-card-count grid (a dozen-ish items) and, critically, stable: an
 * already-packed layout is a fixed point (running it twice gives back the
 * exact same object for every item — see the identity-preserving return below),
 * which matters because this gets called from a live layout-update pipeline
 * (see AnalyzerView.vue's `onLayoutUpdated`) that depends on eventually
 * converging to a no-op, same invariant {@link mergeLayoutPositions} documents.
 *
 * Pure; returns a NEW array only when at least one item's `x`/`y` actually
 * changed, and even then keeps the exact same object reference for any
 * INDIVIDUAL item that didn't move (mirrors mergeLayoutPositions/
 * reconcileLayout's no-op guards).
 */
export function compactLayoutTopLeft(layout: DashboardLayoutItem[]): DashboardLayoutItem[] {
  const order = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: DashboardLayoutItem[] = []
  for (const original of order) {
    let item = original
    let moved = true
    while (moved) {
      moved = false
      while (item.y > 0 && placed.every((o) => !rectsOverlap({ ...item, y: item.y - 1 }, o))) {
        item = { ...item, y: item.y - 1 }
        moved = true
      }
      while (item.x > 0 && placed.every((o) => !rectsOverlap({ ...item, x: item.x - 1 }, o))) {
        item = { ...item, x: item.x - 1 }
        moved = true
      }
    }
    placed.push(item)
  }
  const byId = new Map(placed.map((it) => [it.i, it]))
  let changed = false
  const result = layout.map((it) => {
    const next = byId.get(it.i)!
    if (next === it) return it
    changed = true
    return next
  })
  return changed ? result : layout
}

/**
 * Collapse-reflow packer — same idea as {@link compactLayoutTopLeft} but
 * VERTICAL-ONLY: each item is pulled straight up within its own x-span (its
 * `x`/`w` never change) until it collides with an already-placed item or
 * hits the top. Unlike compactLayoutTopLeft, this never slides an item
 * sideways into a column it wasn't already in.
 *
 * This matters specifically for the collapse-reflow overlay
 * ({@link applyCollapsedHeights}): shrinking a collapsed card only frees up
 * rows in ITS OWN column, and collapsing a card must never yank an unrelated
 * card from a DIFFERENT column across into that freed slot. Reported bug:
 * collapsing a row-2 card pulled a row-3 card from a different column up
 * into row 2 — that's compactLayoutTopLeft's horizontal "gravity" doing its
 * job for drag/resize/delete, but it's the wrong behaviour for a collapse
 * toggle, where only cards already BELOW the collapsed one in the same
 * x-span should move.
 *
 * Same structure/termination/identity-preservation guarantees as
 * compactLayoutTopLeft: items are processed in reading order (`y`, then `x`)
 * so an item nearer the top keeps priority over one further down when both
 * could claim the same freed row; only previously-placed items are checked
 * for collision, and `y` only ever decreases (bounded below by 0), so the
 * loop is guaranteed to terminate. Pure; returns the SAME array reference
 * when nothing moved, and keeps the exact same object reference for any
 * individual item that didn't move (same no-op guard compactLayoutTopLeft
 * uses, needed for the same reason — see its doc's "Maximum recursive
 * updates" note).
 */
export function compactVertical(layout: DashboardLayoutItem[]): DashboardLayoutItem[] {
  const order = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: DashboardLayoutItem[] = []
  for (const original of order) {
    let item = original
    while (item.y > 0 && placed.every((o) => !rectsOverlap({ ...item, y: item.y - 1 }, o))) {
      item = { ...item, y: item.y - 1 }
    }
    placed.push(item)
  }
  const byId = new Map(placed.map((it) => [it.i, it]))
  let changed = false
  const result = layout.map((it) => {
    const next = byId.get(it.i)!
    if (next === it) return it
    changed = true
    return next
  })
  return changed ? result : layout
}

/** Grid rows a collapsed card occupies while only its header shows (its body is
 *  hidden — see DashboardCard's #9 note). Just tall enough for the header bar. */
export const COLLAPSED_ROWS = 2

/**
 * Collapse-reflow (補位) — DISPLAY-only overlay: replace every collapsed card's
 * height with {@link COLLAPSED_ROWS} and pack the result VERTICALLY-only so the
 * rows a collapsed card gives up are reclaimed by cards BELOW it in the same
 * column — never a card from a different column sliding sideways into the
 * freed slot (see {@link compactVertical}'s doc for why this must be
 * vertical-only rather than {@link compactLayoutTopLeft}'s top-left packing).
 * The caller keeps the CANONICAL (expanded) heights in its own `layout` ref
 * and feeds THIS to the grid, so expanding a card is just dropping it from
 * `collapsedIds` — its stored height returns with no separate "pre-collapse
 * height" bookkeeping (the alternative DashboardCard's #9 note rejected).
 *
 * Pure and identity-preserving on an already collapsed-and-packed layout
 * (compactVertical is a fixed point), so it can sit in the live layout
 * pipeline (AnalyzerView's `activeLayout` getter) without oscillating.
 */
export function applyCollapsedHeights(
  layout: DashboardLayoutItem[],
  collapsedIds: ReadonlySet<string>,
): DashboardLayoutItem[] {
  let changed = false
  const shrunk = layout.map((it) => {
    if (collapsedIds.has(it.i) && it.h !== COLLAPSED_ROWS) {
      changed = true
      return { ...it, h: COLLAPSED_ROWS }
    }
    return it
  })
  return compactVertical(changed ? shrunk : layout)
}

/** True when two layouts hold the same cards at the same x/y/w/h, regardless of
 *  array order. Used to short-circuit the collapse-reflow write-back: when a
 *  grid emission reconstructs the CURRENT canonical layout (the common case — a
 *  collapse toggle echoing the display we just fed it), the caller skips
 *  re-assigning its `layout` ref, breaking the update→compact→update loop
 *  DashboardCard's #9 note warns collapse-into-`h` would otherwise cause. */
export function sameLayoutPositions(a: DashboardLayoutItem[], b: DashboardLayoutItem[]): boolean {
  if (a.length !== b.length) return false
  const byId = new Map(b.map((it) => [it.i, it]))
  return a.every((it) => {
    const o = byId.get(it.i)
    return o != null && o.x === it.x && o.y === it.y && o.w === it.w && o.h === it.h
  })
}

/**
 * #1 fix — merge a grid-layout-plus callback payload (from `update:layout`,
 * `layout-updated`, `resized`, or `moved`; the library emits the SAME shape
 * for all of them: an array of every VISIBLE item's CURRENT x/y/w/h/i,
 * carrying whatever extra per-item props the caller decorated the layout
 * with, e.g. AnalyzerView's `dragAllowFrom`/`isDraggable`/`minW` —
 * see `decorateForGrid`) back into the full persisted layout array.
 *
 * Three things this guards against:
 *  - Only the COORDINATE fields (`x`/`y`/`w`/`h`) are copied from `updated` —
 *    every other field on a decorated item is UI-only (drag config, min-size)
 *    and must never leak into the persisted array / localStorage.
 *  - An item present in `base` but ABSENT from `updated` (e.g. a hidden
 *    align card that isn't part of the currently-visible slice passed to
 *    the grid) is kept UNCHANGED, at its original array position — this is
 *    a merge, not a replace.
 *  - #4 crash fix — when NO item's coordinates actually changed, the exact
 *    same `base` ARRAY reference is returned (not a same-content-but-new
 *    array). This matters because the caller assigns the result straight
 *    into a `ref` (`layout.value = mergeLayoutPositions(...)`, see
 *    AnalyzerView's `onLayoutUpdated`/`activeLayout` setter): Vue's ref
 *    setter only triggers reactivity when the new value is NOT the same
 *    object as the old one, so handing back the identical `base` reference
 *    on a no-op merge makes that assignment a true no-op — it doesn't
 *    re-trigger any computed/watcher, and in particular doesn't re-render
 *    `<GridLayout>`'s `:layout` prop with a "new" (but equal) array. Without
 *    this, EVERY call — including one whose payload changed nothing —
 *    produced a fresh array via `.map()`, which re-triggered the whole
 *    reactive chain (layout ref -> activeLayout computed -> GridLayout's own
 *    `layout` prop watcher), which could itself re-emit `layout-updated`
 *    (grid-layout-plus's compaction pass runs on prop changes, not just
 *    drag) and call back in here — an unbounded `onLayoutUpdated` ->
 *    `layout.value = ...` -> re-render -> `layout-updated` -> ... cycle
 *    ("Maximum recursive updates exceeded"). Reported repro: loading a
 *    SECOND file caused `reconcileLayout` to reassign `layout.value` (see
 *    useDashboardLayout's `chartIds` watcher) which kicked off exactly this
 *    cycle. Returning the SAME reference once coordinates converge breaks
 *    it regardless of how many upstream reassignments kick it off.
 *
 * Pure; returns a NEW array only when at least one item's coordinates
 * actually changed, and even then keeps the exact same object reference for
 * any INDIVIDUAL item whose coordinates didn't change (cheap no-op
 * detection, same pattern as {@link clampToMinSize}).
 *
 * This exists because grid-layout-plus's `update:layout` (the v-model event)
 * only fires on initial mount and on a responsive breakpoint change — a
 * drag or resize ending instead fires `layout-updated` (and, per-item,
 * `resized`/`moved`), which a v-model-only binding never observes. Callers
 * must wire ALL of those events into this same merge so a card's new
 * position is written back into the persisted `layout` ref regardless of
 * which one fired (see AnalyzerView's `activeLayout` setter / `onLayoutUpdated`).
 */
export function mergeLayoutPositions<T extends DashboardLayoutItem>(
  base: DashboardLayoutItem[],
  updated: T[],
): DashboardLayoutItem[] {
  const byId = new Map(updated.map((it) => [it.i, it]))
  let changed = false
  const merged = base.map((it) => {
    const next = byId.get(it.i)
    if (!next) return it
    if (next.x === it.x && next.y === it.y && next.w === it.w && next.h === it.h) return it
    changed = true
    return { i: it.i, x: next.x, y: next.y, w: next.w, h: next.h }
  })
  // No item's coordinates changed -> hand back `base` ITSELF (not `merged`,
  // which is a structurally-equal but freshly-allocated array from `.map`)
  // so the caller's `layout.value = ...` assignment is a genuine no-op.
  return changed ? merged : base
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
 * Default (wide/desktop) layout: THREE equal (GRID_COLS/3 = 4-unit-wide)
 * columns rather than the old lopsided 5/7 two-column split — the old split
 * crammed all 8 control-panel cards into ONE narrow left column (~54 rows
 * tall) against a right column that (with the align panels hidden, their
 * normal default-state) bottomed out around row ~10, leaving a large blank
 * swath of background below the chart on wide screens. Spreading the same
 * cards across three columns keeps each column's bottom within a handful of
 * rows of the others (see dashboardLayout.test.ts's "balances column
 * heights" regression test), which is what actually reads as "the dashboard
 * fills the page" rather than any specific pixel-height target (unknowable
 * here — this is a fixed grid-unit array, not something that measures the
 * user's real viewport).
 *
 * B66 — these heights are deliberate defaults for a NEW layout, not a
 * runtime content measurement. They leave ordinary card content expanded and
 * readable on both desktop and the mobile one-column layout, while existing
 * persisted layouts remain exactly as the user sized them.
 *
 * Column A (x:0..4): map + lap table + sectors — the "at a glance" cards.
 * Column B (x:4..8): the remaining control panels (channel/accel/gear/file).
 * Column C (x:8..12): session-merge + the first chart + current values, with
 * the align panels (hidden until ≥2 laps are selected — see AnalyzerView's
 * isVisibleId) placed BELOW them so their default hidden state never leaves a
 * gap above visible content in this column.
 */
export function defaultLayout(): DashboardLayoutItem[] {
  return [
    // Column A — the at-a-glance map/lap/sector stack.
    { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 12 },
    { i: STATIC_CARD_IDS.lapTable, x: 0, y: 12, w: 4, h: 16 },
    { i: STATIC_CARD_IDS.sectors, x: 0, y: 28, w: 4, h: 20 },
    // Column B
    { i: STATIC_CARD_IDS.trackChannel, x: 4, y: 0, w: 4, h: 7 },
    { i: STATIC_CARD_IDS.accelTest, x: 4, y: 7, w: 4, h: 12 },
    { i: STATIC_CARD_IDS.gear, x: 4, y: 19, w: 4, h: 14 },
    { i: STATIC_CARD_IDS.trackFile, x: 4, y: 33, w: 4, h: 8 },
    { i: STATIC_CARD_IDS.suspension, x: 4, y: 41, w: 4, h: 12 },
    // Column C — first chart (the store's initial default chart) sits right
    // under session-merge; further charts are appended below by
    // reconcileLayout's "new item" path (see defaultChartItem).
    { i: STATIC_CARD_IDS.sessionMerge, x: 8, y: 0, w: 4, h: 10 },
    { i: chartItemId(1), x: 8, y: 10, w: 4, h: 14 },
    { i: STATIC_CARD_IDS.currentValues, x: 8, y: 24, w: 4, h: 22 },
    { i: STATIC_CARD_IDS.cvtDynamics, x: 8, y: 46, w: 4, h: 12 },
    { i: STATIC_CARD_IDS.mapAlign, x: 4, y: 53, w: 4, h: 8 },
    { i: STATIC_CARD_IDS.lapAlign, x: 0, y: 48, w: 4, h: 8 },
  ]
}

/** Default size for a chart card appended after the initial layout (e.g. via
 *  "add chart"), placed at the bottom of column C (x:8..12) so it doesn't
 *  overlap existing cards — grid-layout-plus's vertical compaction then
 *  settles it upward if there's room. */
function defaultChartItem(id: string, layout: DashboardLayoutItem[]): DashboardLayoutItem {
  const maxY = layout.reduce((m, it) => Math.max(m, it.y + it.h), 0)
  return { i: id, x: 8, y: maxY, w: 4, h: 14 }
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

/** B34 — default position/size for a STATIC card missing from a persisted
 *  layout (an older layout saved before that card type existed, e.g. B15's
 *  目前數值 card added only to `defaultLayout()` — see {@link reconcileLayout}'s
 *  doc). Same "append below everything, at whatever size the card wants"
 *  rule {@link defaultChartItem} uses for a newly added chart: looks up the
 *  card's shape from `defaultLayout()` (falling back to its `minSizeFor` floor
 *  if it's somehow not listed there) so it isn't squashed to an arbitrary
 *  size, and places it full-width at column A's x so it doesn't need the
 *  3-column split's exact geometry to avoid overlapping anything. */
function defaultStaticItem(id: string, layout: DashboardLayoutItem[]): DashboardLayoutItem {
  const template = defaultLayout().find((it) => it.i === id)
  const { minW, minH } = minSizeFor(id)
  const maxY = layout.reduce((m, it) => Math.max(m, it.y + it.h), 0)
  return { i: id, x: 0, y: maxY, w: template?.w ?? minW, h: template?.h ?? minH }
}

/**
 * Reconcile a layout against the CURRENT set of chart ids AND the current
 * set of known static card ids: appends a default-positioned item for any
 * chart id missing from the layout (a newly added chart) or any
 * `STATIC_CARD_IDS` value missing from the layout (a static card type
 * introduced AFTER this layout was first saved — B34: B15's 目前數值 card was
 * added only to `defaultLayout()`, so every user with an already-persisted
 * layout never received it; the same gap existed for every earlier static
 * card added this way — see dashboardLayout's git history for `sessionMerge`/
 * `suspension` — this is the first time it's actually been fixed rather than
 * only affecting fresh installs), and drops any chart-card entry whose chart
 * no longer exists (a removed chart). Called after loading a persisted layout
 * AND after every add/remove so the layout array and `analyzerStore.charts`
 * never drift out of sync (stale entries would otherwise accumulate in
 * localStorage forever), and so a future new static card type self-heals the
 * same way without needing its own bespoke migration.
 */
export function reconcileLayout(
  layout: DashboardLayoutItem[],
  chartIds: number[],
): DashboardLayoutItem[] {
  const wantedChartItemIds = new Set(chartIds.map(chartItemId))
  const present = new Set(layout.map((it) => it.i))
  const missingChartIds = chartIds.filter((chartId) => !present.has(chartItemId(chartId)))
  const missingStaticIds = Object.values(STATIC_CARD_IDS).filter((id) => !present.has(id))
  const hasStaleChartEntries = layout.some((it) => isChartItemId(it.i) && !wantedChartItemIds.has(it.i))

  // True no-op (nothing to drop, nothing to add) -> hand back the SAME array
  // reference. This is called from useDashboardLayout's `chartIds` watcher
  // (`layout.value = reconcileLayout(layout.value, ids)`) on every change to
  // the chart-id SET, including ones that don't actually add/remove a chart
  // card here — without this short-circuit, `.filter()`/`[...kept]` below
  // always manufacture a structurally-identical-but-new array, and assigning
  // THAT into the `layout` ref re-triggers every downstream computed/watcher
  // exactly like a real change would (see mergeLayoutPositions's doc for why
  // that identity matters — #4 crash fix: this is the OTHER write path into
  // `layout.value`, alongside the drag/gutter write-back).
  if (!hasStaleChartEntries && missingChartIds.length === 0 && missingStaticIds.length === 0) return layout

  // Drop chart-card entries for charts that no longer exist; keep every
  // static-card entry (and any not-yet-recognised id) untouched.
  const kept = layout.filter((it) => !isChartItemId(it.i) || wantedChartItemIds.has(it.i))

  // Grid-compact fix — a chart's removal is exactly the "hole" scenario
  // compactLayoutTopLeft exists for: the deleted card's slot would otherwise
  // sit empty until the user manually drags something into it (grid-layout-
  // plus's own vertical-only compaction can pull a same-column card up into
  // part of the gap, but never slides a DIFFERENT column's card sideways to
  // fill it). Only run when something was actually dropped — a pure add
  // (missingChartIds.length > 0 but hasStaleChartEntries false) leaves every
  // existing card exactly where the user put it; only defaultChartItem's own
  // append-at-the-bottom placement applies then, same as before this fix.
  const compactedKept = hasStaleChartEntries ? compactLayoutTopLeft(kept) : kept

  const result = [...compactedKept]
  // Static cards are appended FIRST (in `STATIC_CARD_IDS`'s declared order)
  // so a layout missing several new card types at once stacks them in a
  // stable, predictable order rather than however `Object.values` interleaves
  // with chart ids; each newly-added chart is then appended below that.
  for (const id of missingStaticIds) {
    result.push(defaultStaticItem(id, result))
  }
  for (const chartId of missingChartIds) {
    result.push(defaultChartItem(chartItemId(chartId), result))
  }
  return result
}
