import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  resolveOverlaps,
  compactLayoutTopLeft,
  packExcluding,
  isItemDraggable,
  type DashboardLayoutItem,
} from '@/domain/layout/dashboardLayout'
import { cssGridDragTarget } from '@/domain/layout/cssGridDrag'
import { xPx, yPx, type GridMetrics } from '@/domain/layout/gridGutter'
import { pushSample, estimateVelocity2DPxPerSec, type PointerSample } from '@/domain/interaction/sheetPhysics'
import { springStep, isSpringSettled, SPRING_DRAG_RELEASE, SPRING_MAX_DT_SEC, type SpringState } from '@/domain/interaction/spring'
import { prefersReducedMotion } from '@/composables/useFlipAnimation'

export interface UseCssGridDashboardDragOptions {
  /** The layout array CURRENTLY fed to `<CssGridGrid>` (already breakpoint-
   *  resolved + collapse-reflowed — see AnalyzerView's `cssGridActiveLayout`).
   *  This composable never mutates it; it only reads the dragged item's
   *  origin cell out of it and builds a candidate on top. */
  layout: Ref<DashboardLayoutItem[]> | ComputedRef<DashboardLayoutItem[]>
  /** Currently-pinned ids (panelState's `pinnedIds`) — kept OUT of the live
   *  geometry pass via `packExcluding`, same B112 reasoning the legacy
   *  write-back path already relies on (a pinned card's stale rect must never
   *  phantom-collide with a card dragged into the space it visually
   *  occupies). */
  pinnedIds: Ref<string[]> | ComputedRef<string[]>
  /** Column count at the CURRENT breakpoint (`colNum` — 12 desktop, 1
   *  mobile). Reactive so a live breakpoint flip mid-drag (a rotated tablet,
   *  a resized window) is picked up the next frame rather than needing a
   *  fresh drag gesture. */
  cols: Ref<number> | ComputedRef<number>
  rowHeight: number
  /** Horizontal gutter/inset in px — `gridMargin[0]` (0 on mobile). Reactive
   *  for the same breakpoint-flip reason as `cols`. */
  marginX: Ref<number> | ComputedRef<number>
  marginY: number
  /** The grid-wide drag toggle (`isDraggable` from useDashboardLayout —
   *  already folds in 鎖定布局 + breakpoint). Per-item eligibility ALSO
   *  excludes a pinned card (`isItemDraggable`, dashboardLayout.ts), applied
   *  internally by {@link UseCssGridDashboardDragReturn.isItemDraggableNow}. */
  draggable: Ref<boolean> | ComputedRef<boolean>
  /** Called once, with the SETTLED full layout array (display shape — same
   *  items `layout` holds, with the dragged item's cell updated and every
   *  other affected card already reflowed), when a drag ends via a genuine
   *  pointerup. The caller is expected to route this through the EXACT same
   *  write-back path the legacy grid-layout-plus renderer's
   *  `update:layout`/`layout-updated` already uses (AnalyzerView's shared
   *  `writeBackLayout`) so persistence, the B52 display/canonical height
   *  split, and mobile-order derivation all stay identical between the two
   *  renderers. Never called when a drag is aborted (lock toggled mid-drag,
   *  a second pointer landing, or a stray pointercancel). */
  onCommit: (next: DashboardLayoutItem[]) => void
}

export interface UseCssGridDashboardDragReturn {
  /** Bind to the CssGridGrid instance's root element (a component ref's
   *  `.$el`) so this composable can measure the SAME container width
   *  `gridContainerStyle`'s track-sizing math implies — mirrors
   *  useGridGutters.ts's own `containerRef`/ResizeObserver wiring exactly,
   *  just pointed at the new renderer's own DOM root instead of the old
   *  grid-wrap div (which doesn't exist at all while this renderer is
   *  active). */
  containerRef: Ref<HTMLElement | null>
  /** The layout to actually feed `<CssGridGrid :layout="...">`: `layout`
   *  itself while nothing is being dragged, or a live reflow PREVIEW (the
   *  dragged item's candidate cell run through resolveOverlaps +
   *  compactLayoutTopLeft, pinned ids excluded) while a drag is in progress.
   *  Discarded (never persisted) on its own — {@link UseCssGridDashboardDragOptions.onCommit}
   *  is what actually writes a drag's result back. */
  previewLayout: ComputedRef<DashboardLayoutItem[]>
  /** The id currently being dragged, or null. Lets a caller add a "this card
   *  is mid-drag" visual (e.g. a raised z-index) without re-deriving it. */
  draggingId: ComputedRef<string | null>
  /** The dragged card's RAW pixel offset from its rest position since the
   *  drag started (not grid-cell-snapped) — "the card follows the pointer"
   *  while its logical slot (and every other card's preview position) only
   *  advances in whole grid-cell steps. Null while nothing is dragging. */
  dragOffsetPx: ComputedRef<{ id: string; dxPx: number; dyPx: number } | null>
  /** B117 stage 1 — the SAME shape as {@link dragOffsetPx}, but for the brief
   *  window AFTER a drag ends while the card is still visually springing
   *  from wherever it was released back down to its true (already-committed)
   *  grid cell — see `onCardDragEnd`'s own doc for why this is a SEPARATE
   *  field rather than just keeping `dragOffsetPx` alive longer: the two are
   *  mutually exclusive in time (never both non-null for the same id at
   *  once) but a caller that only wants the strict "is a gesture literally
   *  live right now" signal (e.g. to decide whether to show a grab cursor)
   *  still needs to tell them apart. A caller that just wants "what extra
   *  translate should this card have right now" should read
   *  `dragOffsetPx.value ?? settleOffsetPx.value` (see AnalyzerView's own
   *  wiring) exactly the way CssGridGrid's existing single `dragOffsetPx`
   *  prop already expects — no CssGridGrid.vue change was needed for this. */
  settleOffsetPx: ComputedRef<{ id: string; dxPx: number; dyPx: number } | null>
  /** Whether `id` is currently allowed to start a drag — folds the grid-wide
   *  toggle together with the pinned-card exception (isItemDraggable). */
  isItemDraggableNow: (id: string) => boolean
  /** Wire to DashboardCard's `@css-grid-drag-start` (dragMode="cssGrid"). No-op
   *  if `id` isn't currently draggable or isn't found in `layout`. */
  onCardDragStart: (id: string, clientX: number, clientY: number) => void
  /** Wire to DashboardCard's `@css-grid-drag-move`. Coalesced to at most once
   *  per animation frame — see this module's own doc below. No-op if no drag
   *  is in progress. */
  onCardDragMove: (clientX: number, clientY: number) => void
  /** Wire to DashboardCard's `@css-grid-drag-end`. `committed` mirrors that
   *  event's own payload: true for a genuine pointerup (calls `onCommit` with
   *  the settled preview), false for an abort (lock toggled mid-drag, a
   *  pointercancel, or a second pointer landing — discards the preview with
   *  no persistence at all). */
  onCardDragEnd: (committed: boolean) => void
}

interface ActiveDrag {
  id: string
  originX: number
  originY: number
  w: number
  /** Pointer position at drag start (clientX/clientY) — B117: NOT necessarily
   *  the real `clientX`/`clientY` the pointerdown fired at. When this drag
   *  INTERRUPTS an in-flight release-settle spring on the same card (see
   *  `onCardDragStart`'s own doc), this is shifted backward by the spring's
   *  residual offset at that instant, so `dragOffsetPx` (== `lastPointerX -
   *  startX`) reads as that residual on the very first frame instead of
   *  snapping to 0 — the card keeps rendering exactly where it visually was,
   *  with the new drag's pointer movement added 1:1 on top from there. */
  startX: number
  startY: number
  /** Latest RAW pointer position (drives `dragOffsetPx`'s smooth follow). */
  lastPointerX: number
  lastPointerY: number
  /** Latest CLAMPED target cell (drives `previewLayout`'s discrete reflow). */
  targetX: number
  targetY: number
}

/** B117 stage 1 — one card's post-release settle: two independent spring
 *  axes (see spring.ts's own doc for why X and Y must not share one 2D
 *  spring) animating the residual visual offset back down to its resting
 *  value of 0 (the card's OWN grid cell already reflects the final position
 *  by the time this exists — see `onCardDragEnd` — so "settled" always means
 *  "offset (0, 0)", never a moving target). */
interface SettleState {
  id: string
  x: SpringState
  y: SpringState
}

/**
 * Vue-layer wiring for the F6 stage-2 CSS Grid drag-to-reorder feature —
 * deliberately thin, same "own DOM measurement + pointer-event coalescing,
 * delegate every actual layout decision to pure functions" split
 * useGridGutters.ts already established for the sibling gutter-drag feature.
 * AnalyzerView.vue owns the actual persisted state (`layout`/`mobileOrder`/
 * `pinnedIds`/`collapsedIds`) and is the only thing that ever calls
 * `onCommit` through to storage — this composable only ever produces a
 * PREVIEW and a final candidate array, never touches localStorage itself.
 */
export function useCssGridDashboardDrag(options: UseCssGridDashboardDragOptions): UseCssGridDashboardDragReturn {
  const { layout, pinnedIds, cols, rowHeight, marginX, marginY, draggable, onCommit } = options

  // --- Container width measurement (mirrors useGridGutters.ts's own
  // ResizeObserver wiring, pointed at CssGridGrid's own root element instead
  // of the legacy grid-wrap div). ---
  const containerRef = ref<HTMLElement | null>(null)
  const containerWidthPx = ref(0)
  let observer: ResizeObserver | null = null
  watch(
    containerRef,
    (el, _prev, onCleanup) => {
      observer?.disconnect()
      observer = null
      if (!el) return
      containerWidthPx.value = el.clientWidth
      observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width
        if (width != null) containerWidthPx.value = width
      })
      observer.observe(el)
      onCleanup(() => observer?.disconnect())
    },
    { immediate: true },
  )
  onBeforeUnmount(() => observer?.disconnect())

  const metrics = computed<GridMetrics>(() => ({
    cols: cols.value,
    rowHeight,
    marginX: marginX.value,
    marginY,
    containerWidthPx: containerWidthPx.value,
  }))

  const pinnedSet = computed(() => new Set(pinnedIds.value))

  function isItemDraggableNow(id: string): boolean {
    return isItemDraggable(draggable.value, pinnedSet.value.has(id))
  }

  const active = ref<ActiveDrag | null>(null)

  const draggingId = computed(() => active.value?.id ?? null)

  const dragOffsetPx = computed(() => {
    const a = active.value
    if (!a) return null
    return { id: a.id, dxPx: a.lastPointerX - a.startX, dyPx: a.lastPointerY - a.startY }
  })

  // --- B117 stage 1 — post-release settle spring (see SettleState's own
  // doc). `settle` is a `ref`, reassigned to a brand-new object every rAF
  // frame — the SAME pattern `flushPendingMove` below already uses for
  // `active` (`active.value = { ...a, ... }` on every coalesced pointermove
  // frame), just applied to the settle animation's own per-frame state
  // instead of pointer position. `settleLastFrameMs`/`settleRafId` are plain
  // variables (not refs) since nothing needs to react to THEM, only to
  // `settle` itself changing. ---
  const settle = ref<SettleState | null>(null)
  let settleLastFrameMs: number | null = null
  let settleRafId: number | null = null

  const settleOffsetPx = computed(() => {
    const s = settle.value
    if (!s) return null
    return { id: s.id, dxPx: s.x.position, dyPx: s.y.position }
  })

  function cancelSettle(): void {
    if (settleRafId != null) {
      window.cancelAnimationFrame(settleRafId)
      settleRafId = null
    }
    settle.value = null
    settleLastFrameMs = null
  }

  function stepSettle(nowMs: number): void {
    const s = settle.value
    if (!s) {
      settleRafId = null
      return
    }
    const dtSec = settleLastFrameMs == null ? 1 / 60 : Math.min((nowMs - settleLastFrameMs) / 1000, SPRING_MAX_DT_SEC)
    settleLastFrameMs = nowMs
    const nextX = springStep(s.x, 0, SPRING_DRAG_RELEASE, dtSec)
    const nextY = springStep(s.y, 0, SPRING_DRAG_RELEASE, dtSec)
    if (isSpringSettled(nextX, 0) && isSpringSettled(nextY, 0)) {
      settle.value = null
      settleLastFrameMs = null
      settleRafId = null
      return
    }
    settle.value = { id: s.id, x: nextX, y: nextY }
    settleRafId = window.requestAnimationFrame(stepSettle)
  }

  /** Start (or, mid-interruption, restart) the settle for `id`: the visual
   *  offset springs from `initialOffsetPx` — computed by the caller as
   *  "where the card actually was on screen the instant it stopped being
   *  live-dragged, minus where its now-settled grid cell renders" (see
   *  `onCardDragEnd`) — with `initialVelocityPxPerSec` as the spring's
   *  starting velocity, toward a resting offset of (0, 0). Skips the
   *  animation entirely under `prefers-reduced-motion` or when there is
   *  nothing to animate (already at rest) — the card's grid cell is already
   *  correct either way, so "skip" just means no decorative overlay motion,
   *  not an incorrect final position. */
  function startSettle(
    id: string,
    initialOffsetPx: { dxPx: number; dyPx: number },
    initialVelocityPxPerSec: { vx: number; vy: number },
  ): void {
    cancelSettle()
    if (initialOffsetPx.dxPx === 0 && initialOffsetPx.dyPx === 0) return
    if (prefersReducedMotion()) return
    settle.value = {
      id,
      x: { position: initialOffsetPx.dxPx, velocity: initialVelocityPxPerSec.vx },
      y: { position: initialOffsetPx.dyPx, velocity: initialVelocityPxPerSec.vy },
    }
    settleLastFrameMs = null
    settleRafId = window.requestAnimationFrame(stepSettle)
  }

  /** The live reflow preview — a pure re-run of the SAME collision/packing
   *  pipeline the legacy write-back path uses (resolveOverlaps then
   *  compactLayoutTopLeft, pinned ids excluded via packExcluding), applied to
   *  a candidate where ONLY the dragged item's cell has moved. Simplification
   *  vs. the authoritative write-back (see `onCommit`'s own doc): this
   *  preview always uses compactLayoutTopLeft regardless of whether some
   *  OTHER card is currently collapsed (the B52 vertical-only packer choice
   *  the legacy setter makes in that case) — a harmless approximation since
   *  the actual PERSISTED result on drop always goes through the fully
   *  correct, collapse-aware `writeBackLayout` the caller supplies as
   *  `onCommit`; only the in-flight visual preview could theoretically differ
   *  for one frame in that rare combination. */
  const previewLayout = computed<DashboardLayoutItem[]>(() => {
    const a = active.value
    if (!a) return layout.value
    const candidate = layout.value.map((it) => (it.i === a.id ? { ...it, x: a.targetX, y: a.targetY } : it))
    return packExcluding(candidate, pinnedSet.value, (items) => compactLayoutTopLeft(resolveOverlaps(items)))
  })

  // --- rAF coalescing: DashboardCard forwards every raw pointermove as a
  // `css-grid-drag-move` emit (same "just record the latest coordinate"
  // convention its own B102a edge-autoscroll loop already uses) — recomputing
  // the candidate layout (resolveOverlaps + compactLayoutTopLeft) on EVERY one
  // of those would mean doing that work far more often than the screen can
  // even paint. Buffer the latest pointer position and only re-derive the
  // target cell once per animation frame. ---
  let pendingPointer: { x: number; y: number } | null = null
  let rafId: number | null = null

  function flushPendingMove(): void {
    rafId = null
    const a = active.value
    const pending = pendingPointer
    if (!a || !pending) return
    const target = cssGridDragTarget({ x: a.originX, y: a.originY, w: a.w }, pending.x - a.startX, pending.y - a.startY, metrics.value)
    active.value = { ...a, lastPointerX: pending.x, lastPointerY: pending.y, targetX: target.x, targetY: target.y }
  }

  function cancelPendingFrame(): void {
    if (rafId != null) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  // B117 stage 1 — rolling pointer-position window for release-velocity
  // estimation (reused `pushSample`/`estimateVelocity2DPxPerSec` from
  // sheetPhysics.ts, see this file's own top-of-module note). A plain
  // variable, not a ref — only ever read at drag-end, never during render.
  let pointerSamples: PointerSample[] = []

  function onCardDragStart(id: string, clientX: number, clientY: number): void {
    if (!isItemDraggableNow(id)) return
    if (active.value) return // belt-and-braces — a stray second start should never stomp an in-flight drag
    const item = layout.value.find((it) => it.i === id)
    if (!item) return

    // B117 stage 1 — interruption: if THIS card is mid-settle from a drag
    // that JUST ended, don't let the new drag discard the settle's residual
    // offset out from under it (that would be a visible micro-teleport, the
    // exact bug this whole feature exists to fix, just relocated to drag
    // START instead of drag end). Shifting `startX`/`startY` backward by the
    // residual means `dragOffsetPx` (`lastPointerX - startX`) reads as that
    // residual on this very first frame — the card keeps rendering exactly
    // where it was — and every subsequent real pointer move is added on top
    // 1:1 from there, same as an uninterrupted drag. `item.x`/`item.y` here
    // already come from `layout.value`, which by now reflects the SETTLED
    // (committed) cell the spring is animating toward — see `onCardDragEnd`
    // — so the origin cell itself is already correct with no adjustment
    // needed. A settle in progress for a DIFFERENT card is simply cancelled
    // (see `cancelSettle`'s own doc for why that's safe — the earlier card's
    // grid cell was already committed, the spring is purely decorative).
    const s = settle.value
    const biasX = s?.id === id ? s.x.position : 0
    const biasY = s?.id === id ? s.y.position : 0
    if (s) cancelSettle()

    pointerSamples = [{ t: performance.now(), x: clientX, y: clientY }]
    active.value = {
      id,
      originX: item.x,
      originY: item.y,
      w: item.w,
      startX: clientX - biasX,
      startY: clientY - biasY,
      lastPointerX: clientX,
      lastPointerY: clientY,
      targetX: item.x,
      targetY: item.y,
    }
  }

  function onCardDragMove(clientX: number, clientY: number): void {
    if (!active.value) return
    pointerSamples = pushSample(pointerSamples, { t: performance.now(), x: clientX, y: clientY })
    pendingPointer = { x: clientX, y: clientY }
    if (rafId == null) rafId = window.requestAnimationFrame(flushPendingMove)
  }

  function onCardDragEnd(committed: boolean): void {
    cancelPendingFrame()
    flushPendingMove()
    const a = active.value
    pendingPointer = null
    if (!a) return

    // B117 stage 1 — capture everything the settle spring needs BEFORE
    // clearing `active`: `previewLayout` (read via `draggedItem` below)
    // depends on `active.value`, so it must be read while the drag is still
    // "live" from this composable's own point of view.
    const liveOffsetPx = { dxPx: a.lastPointerX - a.startX, dyPx: a.lastPointerY - a.startY }
    const draggedPreviewItem = previewLayout.value.find((it) => it.i === a.id)
    const velocity = estimateVelocity2DPxPerSec(pointerSamples)
    pointerSamples = []

    let finalItem: DashboardLayoutItem | undefined
    if (committed) {
      const settled = previewLayout.value
      active.value = null
      onCommit(settled)
      // `onCommit` (`writeBackLayout`) is expected to route back into
      // `layout` reactively before this function returns in the real app
      // (see this composable's OWN option doc) — but a test harness (or a
      // caller that persists asynchronously) might not update it
      // synchronously, so fall back to the settled preview's own copy of
      // the dragged item rather than assuming `layout.value` already moved.
      finalItem = layout.value.find((it) => it.i === a.id) ?? settled.find((it) => it.i === a.id)
    } else {
      active.value = null
      // Aborted — nothing was ever written back, so the card's true resting
      // cell is whatever `layout` (unchanged) already says it is.
      finalItem = layout.value.find((it) => it.i === a.id)
    }

    if (!draggedPreviewItem || !finalItem) return // card removed mid-drag — nothing sensible to settle

    const m = metrics.value
    const onScreenX = xPx(draggedPreviewItem.x, m) + liveOffsetPx.dxPx
    const onScreenY = yPx(draggedPreviewItem.y, m) + liveOffsetPx.dyPx
    const initialOffsetPx = { dxPx: onScreenX - xPx(finalItem.x, m), dyPx: onScreenY - yPx(finalItem.y, m) }
    startSettle(a.id, initialOffsetPx, velocity)
  }

  onBeforeUnmount(() => {
    cancelPendingFrame()
    cancelSettle()
    active.value = null
  })

  return {
    containerRef,
    previewLayout,
    draggingId,
    dragOffsetPx,
    settleOffsetPx,
    isItemDraggableNow,
    onCardDragStart,
    onCardDragMove,
    onCardDragEnd,
  }
}
