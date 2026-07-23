# F1 — Mobile Focus/Stack View (design proposal)

> **STATUS: ⚠️ PARTLY SUPERSEDED BY `F5` (2026-07-24).** All five phases WERE built and
> landed, but device testing showed the stack itself was the wrong mobile paradigm: it
> held EVERY visible card, so every panel sat at its `min-height: 180px` floor, the stack
> scrolled as a whole, the phase-2 divider had **no free space to rebalance and did
> nothing**, and the scrubber was pushed below the fold instead of pinning. The user chose
> to pivot to a **single-focus view** — see docs/specs/F5-SINGLE-FOCUS-DESIGN.md, which
> supersedes §3–§4 here.
>
> **Superseded / deleted:** `MobileFocusStack.vue` and the draggable divider (locked
> choice (b)); `mobileView.splitWeights` (now deprecated, kept only for back-compat).
> **Still live, reused by F5:** the bottom scrubber + ▶ play (locked choice (d) —
> `MobileScrubber.vue` / `scrubber.ts`), the shared-`cursorIdx` sync, and the phase-5
> drag-gesture engine (locked choice (c)), which still serves the full-dashboard mode.
>
> Tracker entries: docs/ISSUES.md `F1` (history) and `F5` (current). Folds in `B102`/`B61`
> (mobile drag-gesture arbitration). Depends on `F2` (the card-visibility menu) for curation.
>
> **Locked choices:** (a) focus set = F2 visible set · (b) **draggable divider in v1**
> · (c) **full drag-gesture engine in v1** (edge-autoscroll + two-finger-scroll +
> gutter priority — closes B61/B102 fully) · (d) **scrubber includes ▶ play/auto-advance**.

## 1. Problem & goal

Today the analyzer on a phone is **one long single-column scroll of every visible
card** (`mobileOrder` → `mobileLayout`, AnalyzerView.vue). It works but is not a
*live* view — you scroll a wall of cards. RaceChrono-style tools instead show a
short, curated vertical stack (e.g. **map on top, chart below**) with **one shared
bottom time-scrubber** that moves every panel's cursor together.

**Goal:** add a second mobile presentation — a **Focus Stack** — that becomes the
mobile default, while the current full-dashboard scroll stays available as the
"advanced/complete" mode. Curation is driven by the same menu we are building for
`F2`. Desktop is unchanged (always the free grid).

## 2. Two mobile modes (one toggle)

| Mode | What it is | Reorder gesture | Default |
|------|-----------|-----------------|---------|
| **Focus Stack** (new) | Short curated vertical split of chosen panels + shared bottom scrubber | none (curated via menu) | ✅ mobile default |
| **Full Dashboard** (existing) | Current single-column scroll of all visible cards | menu up/down (drag demoted — see §6) | advanced |

- **Switch:** a small segmented control (`聚焦 / 完整`) in the analyzer header on
  mobile. Persisted per device. Never shown on desktop.
- Both modes read the **same** visibility state from the `F2` menu — Focus Stack is
  just a *constrained layout* over the visible set (see §4), not a separate card list.

## 3. Focus-stack layout model

- A vertical stack of the visible cards, rendered with the existing card **content
  components** (TrackMap, TimeSeriesChart, …) but without the grid drag/resize chrome
  — a slim header (title + a ▸ "展開為完整" / locate affordance) over the content.
- **Heights:** proportional weights per panel. Default pairing **map 55% / chart 45%**
  (user's stated default). Two options for v1 — see decision (b):
  - *fixed preset* weights (simplest), or
  - a **draggable horizontal divider** between adjacent panels to rebalance live
    (weights persisted).
- Stack fills the viewport between the app header and the bottom scrubber; if the
  curated set is taller than one screen it scrolls vertically as a whole (no per-panel
  nested scroll except lists that already scroll, e.g. lap table).
- **v1 guardrail:** recommend curating to ~2–3 panels; no hard cap, but the default
  focus set is just `map` + the first chart.

## 4. Panel selection — driven by F2

Single source of truth = the `F2` visibility store (device pref). Focus Stack shows
the **visible** cards in a **focus order**. The `F2` menu already gives us:
show/hide (checkbox), locate, and per-card ordering. F1 adds:

- a **focus order** list (reuse F2's up/down ordering, or a dedicated `focusOrder`)
- the default set = `map`, `chart#1` on (everything else hidden by the `F2`
  "no-data → default off" rule + the user's curation).

> **Decision (a):** is the Focus Stack content *exactly* the F2 visible set, or a
> *separate, smaller* "focus subset" you pick independently? Recommendation: **same
> set** (one mental model; you curate once). A separate subset adds a second toggle
> column to the menu.

## 5. Shared bottom time-scrubber

A persistent bar pinned above `BottomNav` (Focus Stack only):

- A horizontal **time track** spanning the current domain: the **selected lap** if one
  is selected, else the **full session**. A draggable thumb + a `m:ss.mmm` readout
  (reuse the shared format helpers) and optionally a couple of live value chips.
- Dragging the thumb sets the **global cursor** — nothing more is needed because the
  cursor is already shared (see §6). Fine, input-agnostic drag (§8 policy): touch =
  direct scrub, mouse/pen = same.
- **v1:** manual scrub only. A ▶ play/animate button (auto-advance the cursor over the
  lap) is a clean later add — see decision (d).

## 6. Cursor-sync architecture (reuse — no new global state)

The app already shares the cursor across every consumer:

- `analyzerStore.cursorIdx` — **session sample index**; read by the track map and
  timeline charts. `setCursor(i)`.
- `analyzerStore.overlayCursorIdx` — **lap-relative grid index**; read by overlay
  charts. `setOverlayCursor(i)`.
- `xRange` — shared X zoom.

The scrubber maps thumb position → session sample index → `setCursor`, and derives
the lap-relative index via the existing session↔lap mapping (same conversion the
overlay path already uses). Every panel then follows for free — this is exactly how
B31's fixed-centre needle already publishes a cursor. **No new cursor plumbing**, only
a new *producer* (the scrubber) of the existing signal. Scrubber thumb position is a
*derived* view of `cursorIdx`, so external cursor moves (tapping the map) move the
thumb too — bidirectional for free.

## 7. Gesture arbitration — how this resolves B61 / B102

The Focus Stack is designed to **sidestep** the fragile mobile drag gestures:

- **Panels are not drag-reordered** in Focus Stack — ordering is explicit (menu
  up/down). → the `B61` long-press-vs-native-`pan-y` race **does not exist here**.
- The **pink split-resize gutter grips** (`B90`/`B93`) are a **grid-only** affordance;
  they don't render in Focus Stack. → `B102(c)` mis-touch **eliminated in this mode**.
- Panel-internal gestures (map pan/zoom, chart pan) keep the existing per-`pointerType`
  branching (§8). The scrubber is a dedicated horizontal control at the bottom — no
  contest with vertical page scroll.
- The optional divider drag is a dedicated, clearly-affordanced horizontal handle.

For the **Full Dashboard** mode (where `B61`/`B102` actually live today), the proposal
is to **demote touch drag-reorder** in favour of the menu's explicit up/down ordering,
so the default reordering path is no longer a gesture race. This "solves" B61/B102 for
the common case by removing the unreliable gesture from the default flow.

> **Decision (c):** for Full Dashboard mobile reordering — (i) **demote drag**, make
> menu up/down the primary reorder (recommended, cheap, robust), or (ii) invest now in
> a proper drag rework with **edge-autoscroll** (`B102a`) + **two-finger scroll during
> drag** (`B102b`) + gutter-priority fix. Option (i) closes B61/B102 for v1; option (ii)
> is a larger, separate gesture-engine effort.

## 8. Persistence (new `tracklogstudio.` prefix, per F2's clean-slate)

`tracklogstudio.mobileView.v1`:
```
{ mode: 'focus' | 'full',
  focusOrder: string[],          // card ids in stack order
  splitWeights: Record<string, number> }  // per-panel height weight (if divider shipped)
```
Device-scoped, sanitized on load (whitelist ids, finite weights). Not in the B19
export bundle for v1 (device-local view state).

## 9. New / reused pieces

- **New:** `MobileFocusStack.vue` (stack container + dividers), `MobileScrubber.vue`
  (bottom bar), a mobile mode toggle, a small `mobileViewStore`/domain module.
- **Reuse:** all card content components, `analyzerStore` cursor API, the `F2`
  visibility store + menu, format helpers, `useInputCapabilities` (§8).

## 10. Implementation phases (approved scope)

1. Mode toggle (`聚焦 / 完整`) + `tracklogstudio.mobileView.v1` persistence; render the
   F2 visible set as a vertical stack; full-dashboard mode still available.
2. **Draggable horizontal dividers** between panels + per-panel weight persistence
   (decision b). Coarse-pointer 44px handle, §8 input-agnostic drag.
3. Bottom **scrubber** wired bidirectionally to `cursorIdx`/`overlayCursorIdx`
   (selected-lap domain when a lap is picked, else full session).
4. **▶ play / auto-advance** on the scrubber (decision d): rAF loop advancing the
   cursor over the domain, play/pause, respects prefers-reduced-motion; a speed
   control is optional.
5. **Full mobile drag-gesture engine** (decision c) for the full-dashboard mode —
   the B61/B102 rework: reliable long-press activation, `touch-action` handoff,
   **edge-autoscroll while dragging** (B102a), **two-finger scroll during drag**
   (B102b), and pink split-gutter priority/labelling vs card drag (B102c). This is
   the largest phase and can be split into its own sub-effort.
6. Polish: reduced-motion, coarse-pointer 44px targets, theme-aware, i18n both locales.

> Phases 1–4 are the Focus-Stack view itself. Phase 5 is a mostly-independent gesture
> engine for the *legacy* full-dashboard mode; it can land in parallel or after.

## 11. Decisions — LOCKED (user 拍板)

- **(a)** Focus set = **the F2 visible set** (one source of truth; curate once).
- **(b)** v1 heights = **draggable divider** (live rebalance, weights persisted).
- **(c)** Full-dashboard mobile reorder = **full drag rework** — edge-autoscroll +
  two-finger scroll during drag + gutter-priority fix (fully closes B61/B102).
- **(d)** Scrubber = **includes ▶ play/auto-advance** over the domain.
