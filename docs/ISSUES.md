# Issue tracker

Living checklist of reported issues / requests, so nothing gets lost across work sessions.
Status: `[ ]` open · `[~]` in progress · `[x]` done. When done, note the fixing commit (short SHA).
Please keep this list free of working-hours logs (issue text + status + commit only).

## Comparison lap-table (must REUSE the primary LapTable's parsing + UI, not a parallel impl)
- [x] **B1 / B17** Comparison table now reuses the primary LapTable via a shared `LapTableView` (read-only); sector column computed from each comparison's own track through the shared gates. — `bbb9c15`
- [x] **B2** Valid-lap time/distance band now marks comparison laps as excluded, same as primary. — `bbb9c15`
- [x] **B3** Removed the duplicate lap list that was double-mounted inside the sector-gate card. — `bbb9c15`
- [x] **B1b** Comparison table lead/selection UI unified with the primary: checkbox column removed, row-click selects, lead cell = selection swatch (same colour as the map/chart cross-file highlight) + lap number; unused `pick` slot removed from LapTableView. Comparison stays non-excludable (no ⦸). — `40e3155`

## LapTable layout
- [x] **B4** Primary-file title moved to directly above the table; add-column buttons share a row with the line/ECU source toggle; clear-selection on that row, far right (wraps on narrow screens). — `df97c7d`

## Lap detection
- [x] **B5** Switching lap source 線段自算 ↔ ECU clears both primary and cross-session lap selections (indices invalid under the new source); manual exclusions kept; same-source re-click is a no-op. — `5091250`

## Track map
- [x] **B6** Root cause: the no-lap fallback ran per-lap peak-finding (`detectChannelExtrema`) over the whole multi-lap session. Now no-lap shows exactly ONE global min + ONE global max per marked channel (`findGlobalChannelExtremum`); lap-selected behaviour unchanged. — `92a5bdc`
- [x] **B7** Map maximize reworked: Teleport/fullscreen overlay removed; maximizing now expands the map in place to fill the CARD (other in-card controls hidden), works on desktop and mobile alike; Esc still exits. — `dfaae6f`
- [ ] **B22** Map base-image overlay (upload + align custom image, free OSM tiles, satellite via user's own API key). Designed in docs/DESIGN.md §6.1/§6.3, never built. Large — schedule separately.

## Charts
- [x] **B8** 時序/timeline mode removed entirely (type/store/UI/i18n); overlay is the only mode and falls back to the full-session view when no lap is selected; stale persisted `mode` values ignored safely; cross-session overlay kept. — `419bb6a`
- [x] **B9** Reset-zoom button (shown only while zoomed) on all uPlot charts + Shift-drag horizontal pan; clearing zoom elsewhere now properly restores full range; focus-then-reset returns to full view. — `758aaf9`

## New "current values" card
- [x] **B15** New 目前數值 dashboard card (`CurrentValuesPanel.vue` + pure `currentValues.ts`): grid of every channel's value at the shared cursor (falls back to the LAST sample when no cursor); auto columns via CSS grid auto-fill, scrolls via CardFillScroll; O(1) per-cell lookups. Registered as a normal draggable/resizable/collapsible card. — `efd22a3`
- [x] **B16** 目前時間 (elapsed, `m:ss.mmm`) is the first field of that card, formatted via the shared format helpers. — `efd22a3`

## Acceleration test
- [x] **B14** List ALL matching segments, not just the single fastest (e.g. 10 traffic-light launches → ~10 0→50 km/h or 0→100 m segments). — `21e8ea6`

## PWA
- [x] **B13** PNG icon set generated from `public/app-icon.svg` (192/512 + maskable + iOS 180 + favicon); `virtual:pwa-register/vue` update-available toast added. — `5fdd152`
- [x] **B23** Added `<meta name="mobile-web-app-capable" content="yes">` alongside the kept apple variant. (The `cloudflareinsights beacon ERR_BLOCKED_BY_CLIENT` is just the user's ad-blocker — NOT a bug.) — `d1b56f7`

- [x] **B24** Shared `CardFillScroll.vue` container (fixed `#header` slot + fill-remaining-height scrolling content); accel-test segment list migrated to it (root cause was a hardcoded `max-height:260px`); current-values card (B15) uses the same container. Other in-card lists can adopt it incrementally. — `d373f70`
- [x] **B26** Accel-test focus is now a toggle (re-click un-focuses) + explicit 清除聚焦 button; stale focus auto-clears when the result set changes; clearing restores the full chart range. — `348cb0c`

## Charts (scatter)
- [x] **B25** Multi-file scatter now keeps colour fully on the 3rd-axis gradient; files are distinguished by marker shape (`markerShapes.ts`: circle→triangle→rect→diamond→pin→arrow by comparison-list position, primary always circle) with a shape legend shown only when colour axis is on AND >1 shape present; tooltip already names the file. Single-file / no-colour-axis behaviour unchanged. — `b9e4aff`

## Card chrome
- [x] **B27** Root cause: leftover `border-top`/`margin-top`/`padding-top` on the panel roots (a stacked-panel divider from before each panel got its own card). Removed from GearPanel/AccelTestPanel/SectorPanel. — `9f0a085`
- [x] **B27b** Same leftover divider (`margin-top`/`padding-top`/`border-top`) removed from `TrackChannelPanel.vue` and `TrackFilePanel.vue` root class. — `68080f2`

## Settings
- [x] **B19** Settings export/import implemented (`settingsTransfer.ts`): versioned JSON bundle of appearance (theme/language/timezone) + drivetrain, with an "include dashboard layout" toggle (layout + panel state + lock); import validates leniently via each store's sanitizer, confirms before overwrite, reloads when layout is applied. — `2bc6b35`
- [x] **B20** Settings page now shows the currently-applied value next to auto theme/language/timezone controls. — `1e1e13f`

## Converter
- [x] **B21** Suspension-calibration section moved into the output/convert column on wide layouts (stacked behaviour unchanged ≤880px). — `f87cb9a`

## Dashboard
- [x] **B18** Pinned (floating) card gets its own bottom-right pixel drag handle (grid resize stays off for the empty placeholder — that was why it was locked); size clamped 220px–96vw / 140px–90vh, double-click resets to auto aspect; collapsed cards stay non-resizable. — `516648b`

## Acceptance round 2026-07-13 (user tested on device, 10 reports)
- [ ] **B28** Selecting a lap no longer expands/zooms the chart X axis to that lap — ALL charts affected, including the gear-ratio card's chart. Likely a regression from the B8/B9 chart rework (xRange/xZoom handling). Restore: lap select → charts zoom to the lap's range.
- [ ] **B29** Rename XY 散佈圖 → 散佈圖 (both locales): now that the 3rd colour axis is built in, "XY" is redundant.
- [ ] **B25b** (follow-up to B25) Marker shape per file is unreadable at real point densities. **DECIDED (user, 2026-07-13): go 3D — X/Y/Z scatter where the 3rd channel becomes a real Z axis; colour returns to per-file identity.** Implementation notes: needs a WebGL 3D scatter (echarts-gl — VERIFY it supports echarts@6 first; if not, evaluate alternatives or pinning strategy); lazy-load the 3D chunk like the G-G chart; keep the plain 2D scatter when no 3rd channel is chosen; rotation/orbit controls + mobile touch support. Medium-large — schedule like B22.
- [ ] **B30** Hovering/moving the mouse along the TRACK MAP does not continuously update the linked charts/current position — only the first touched point registers. Map→chart cursor forwarding should track mousemove continuously (chart→map already works).
- [ ] **B31** RaceChrono-style fixed centre needle — charts keep a fixed vertical cursor at centre and the user drags the chart left/right under it to scrub the current value. NOT phone-only: applies to every coarse-pointer device (see B35), i.e. tablets running the full desktop layout too. Consider a per-chart or global toggle.
- [ ] **B35** **Touch-input policy (user, 2026-07-13 — REFINED): neither viewport width NOR one-shot device classification is acceptable; the same machine switches input live (DeX / phone+BT-mouse / S Pen / tablet touch / laptop trackpad). Adopt the 4-layer policy now specified in DESIGN.md §8:** (1) every interaction must be input-agnostic — no hover-only info, no modifier-key-only gestures (B9's Shift-drag pan needs a touch/pen equivalent); (2) behaviour branches on per-event `PointerEvent.pointerType` (touch drag = pan, mouse drag = box-zoom; pen ≈ mouse with hover), never on device type; (3) `any-pointer: coarse` (+ `matchMedia` change listeners, wrapped in a reactive `useInputCapabilities()`) ONLY sets default density: ≥44px hit targets (⦸ toggles, lap-offset ±, resize handles, gutter), always-visible handles — re-evaluates when a mouse is plugged/unplugged; (4) settings override 自動/觸控優先/指標優先 (persisted) as the escape hatch. Current state: ZERO capability queries in the codebase; everything hangs off `max-width:768px` (App.vue, BottomNav, AnalyzerView, useDashboardLayout, PwaUpdateToast). Also: dashboard drag/resize on touch (long-press vs scroll), map finger-scrub (ties into B30/B31). Build the shared primitive first, then migrate screen by screen.
- [ ] **B18b** (follow-up to B18) The pinned-card resize handle reinvented the wheel: a custom 90°-corner icon instead of the same resize affordance every other (grid) card already uses. Reuse the existing grid-card resize handle look & behaviour for the pinned floating card.
- [ ] **B32** Card transition animations (collapse/expand height transition + FLIP reflow) are GONE — regression, possibly from the collapse/reflow or dashboard changes in the last two batches. Find and restore.
- [ ] **B24b** (follow-up to B24) Sector card's gate list still does not fill/scroll with card size — migrate SectorPanel's list (and audit ALL remaining in-card lists) to `CardFillScroll`.
- [ ] **B33** 軌跡通道標記 (track channel markers: colour-on-track / min / max) must work when laps are selected on COMPARISON files too, not just the primary — any selected lap (either file) should light up markers on its own trace.
- [ ] **B34** User cannot find the new 目前數值 card: it was added to `defaultLayout()` only, so existing persisted layouts never receive it. Need a layout migration that injects newly-introduced card types into saved layouts (or an "add card" affordance) — check how earlier new cards handled this.

## Maintenance / deferred
- [x] **M1** Dependency refresh: no `latest`/`*` ranges existed; all direct deps already at latest in-range; transitive lockfile refreshed; `npm audit` 0 vulnerabilities. TypeScript 6→7 skipped — verified vue-tsc (≤3.3.7) crashes on TS7's removed `./lib/tsc` export; revisit when vue-tsc supports TS7. — `56dc1c5`
- [ ] **M2** Clean dead code: `useTrackOverlay` candidates/toggle/clear + `trackOverlay*` i18n (superseded by the FileBar 「加入分析」 checkbox).
- [ ] **M3** Refactor `TrackMap.draw()` (≈500-line god-function) into smaller units.
- [ ] **M4** Optional: screenshot user manual.

## Done (recent)
- [x] Comparison laps rendered as a per-lap table; cross-file selected laps drawn on the map; overlay↔map cursor link; collapse vertical reflow (no cross-column jump); chart-mode label 時間軸→時序; accel-test "distance from launch speed" (0=standstill); GitHub star button opens reliably; docs de-staled; PWA meta/manifest scaffolding. (Released to main.)
