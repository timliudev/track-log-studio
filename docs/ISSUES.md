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
- [x] **B28** Root cause: `TimeSeriesChart.vue`'s `x-bounds` prop always described the full session extent; B9's `UPlotChart.applyXRange()` falls back to `x-bounds` whenever `xRange` is null — which it intentionally is in selection/overlay mode — so every lap (re)selection forced-zoomed back out to the whole session. Fixed by scoping `x-bounds` to no-selection mode only. — `d6c56d1`
- [x] **B29** Renamed XY 散佈圖 → 散佈圖 (both locales); 3rd colour axis makes "XY" redundant. — `693853f`
- [ ] **B25b** (follow-up to B25) Marker shape per file is unreadable at real point densities. **DECIDED (user, 2026-07-13): go 3D — X/Y/Z scatter where the 3rd channel becomes a real Z axis; colour returns to per-file identity.** Implementation notes: needs a WebGL 3D scatter (echarts-gl — VERIFY it supports echarts@6 first; if not, evaluate alternatives or pinning strategy); lazy-load the 3D chunk like the G-G chart; keep the plain 2D scatter when no 3rd channel is chosen; rotation/orbit controls + mobile touch support. Medium-large — schedule like B22.
- [x] **B30** Root cause: `TrackMap.vue`'s pointermove handler itself was fine — the `watch(cursorIdx, () => draw())` ran the FULL expensive redraw pipeline (polyline, heatmap buckets, gates, extrema text) synchronously on every single hover pixel, flooding the main thread and starving pointer-event delivery on real (large) tracks. Fixed with `scheduleDraw()` coalescing cursorIdx-driven redraws to one `requestAnimationFrame` tick, always reading the latest cursorIdx; all other draw() call sites (zoom/pan/drag/resize) stay synchronous. — `74fc4fd`
- [ ] **B31** RaceChrono-style fixed centre needle — charts keep a fixed vertical cursor at centre and the user drags the chart left/right under it to scrub the current value. NOT phone-only: applies to every coarse-pointer device (see B35), i.e. tablets running the full desktop layout too. Consider a per-chart or global toggle.
- [x] **B35** Foundation landed: reactive `useInputCapabilities()` (3 matchMedia signals w/ change listeners, mirrored as `<html data-*>` for pure CSS) + settings 操作模式 override (auto/touch/pointer, persisted, included in B19 export) — `9e998b2`; chart gestures were ALREADY per-event pointerType (not width-gated) but `pen` wrongly took the touch branch — now pen≈mouse (`isTouchGesturePointer()`), reset-zoom ≥44px on coarse — `b16bd2f`; touch-target sizing (⦸ 22→44px, offset ±, collapse/pin 26→44px, chart delete, grid resize handle 30px) migrated from `max-width:768px` to the capability signal; true LAYOUT breakpoints (BottomNav, column count) intentionally stay width-based — `ac8d9b4`. Original **Touch-input policy (user, 2026-07-13 — REFINED): neither viewport width NOR one-shot device classification is acceptable; the same machine switches input live (DeX / phone+BT-mouse / S Pen / tablet touch / laptop trackpad). Adopt the 4-layer policy now specified in DESIGN.md §8:** (1) every interaction must be input-agnostic — no hover-only info, no modifier-key-only gestures (B9's Shift-drag pan needs a touch/pen equivalent); (2) behaviour branches on per-event `PointerEvent.pointerType` (touch drag = pan, mouse drag = box-zoom; pen ≈ mouse with hover), never on device type; (3) `any-pointer: coarse` (+ `matchMedia` change listeners, wrapped in a reactive `useInputCapabilities()`) ONLY sets default density: ≥44px hit targets (⦸ toggles, lap-offset ±, resize handles, gutter), always-visible handles — re-evaluates when a mouse is plugged/unplugged; (4) settings override 自動/觸控優先/指標優先 (persisted) as the escape hatch. Current state: ZERO capability queries in the codebase; everything hangs off `max-width:768px` (App.vue, BottomNav, AnalyzerView, useDashboardLayout, PwaUpdateToast). Also: dashboard drag/resize on touch (long-press vs scroll), map finger-scrub (ties into B30/B31). Build the shared primitive first, then migrate screen by screen.
- [x] **B18b** (follow-up to B18) Pinned card's `.pin-resize-handle` now mirrors grid-layout-plus's `.vgl-item__resizer` structure exactly (position/size via `--vgl-resizer-size`, same `::before` border-corner technique, same accent colour/radius); `AnalyzerView.vue` declares the `--vgl-resizer-*` tokens on `.analyzer` so the pinned handle also gets the existing mobile 30px touch-target bump (DESIGN.md §8). — `0cd1854`
- [x] **B32** Root cause: the collapse-reflow overlay (`applyCollapsedHeights`/`compactVertical`, added after FLIP already worked) shrinks a collapsing card's OWN grid slot; grid-layout-plus only transitions `left/top/right`/`transform`, not width/height, so that resize lands instantly and `useAutoFlip` saw its own `.vgl-item` snap and FLIP-animated the whole card (incl. header) via non-uniform `scale()` — fighting the body's own real height transition at the same time. Fixed by gating `useAutoFlip`'s `enabled` with a `selfReflowing` ref (set during `animateBodyHeight`, cleared in `onBodyAfterTransition`), same treatment already given to `pinned`; neighbour cards pushed by the reflow still get their own FLIP normally. — `0cd1854`
- [x] **B24b** (follow-up to B24) Sector card's gate list now fills/scrolls via `CardFillScroll` (same fix as B24's accel list). — `693853f`
- [x] **B33** Root cause: `useTrackExtrema`'s `focusedLap` was derived only from the primary session's own selected lap. Added `buildComparisonExtremaMarkers` (`crossSessionExtrema.ts`, mirroring `crossSessionLapHighlight.ts`) — for each comparison session with a lap selected, computes that channel's min/max on its own track, normalized independently so the colour gradient stays meaningful per file; `AnalyzerView.vue` merges primary + comparison markers for `TrackMap`. — `74fc4fd`
- [x] **B34** Static card types (e.g. 目前數值) missing from persisted layouts now self-heal: `reconcileLayout` also appends any missing `STATIC_CARD_IDS` entry, using the same append-below-everything placement as new charts. — `c090877`

- [ ] **B36** Mobile: cards waste horizontal space (page margin + card border + card side padding ≈ 24–40px on a ~360px screen). Go FULL-BLEED in single-column mobile mode: zero page side margins, drop card side borders/radius, separate sections with thin dividers/background bands (card → grouped-list section; header row with collapse/pin stays). Additionally let chart canvases and the track map bleed edge-to-edge via negative margins even where text keeps small padding. CAUTION: full-bleed interactive charts fight the OS edge-swipe (back) gesture — keep ~8px non-interactive edge inset on touch, or document the trade-off. Applies to the width-based mobile layout; desktop/tablet card look unchanged.

- [x] **B37** (a+b done; c decided-skip) (a) `usePwaUpdate.ts` now starts an hourly `registration.update()` timer in `onRegisteredSW`, cleared in `onUnmounted`, so long-lived tabs surface the existing update toast rather than waiting on browser-default check intervals. (b) Verified via `curl -I` against the live deployment: `sw.js` and `/` already come back `Cache-Control: public, max-age=0, must-revalidate` from Cloudflare Workers static-assets defaults — no `_headers` file needed. Incidental finding (not fixed, separate perf item): hashed JS/CSS assets also come back `max-age=0` instead of long-cache/immutable — Cloudflare's immutable-asset heuristic may expect a different hash format than Vite's `name-HASH.ext`. — `f21257c`. (c) DECIDED with user 2026-07-13: SKIP the skipWaiting rescue release — remaining stranded clients are the user's own devices, already cleared; closing all tabs once fixes any straggler. B37 CLOSED.
- [x] **B38** Confirmed root cause: `App.vue`'s unconditional `.site-footer{padding}` was cancelling the mobile-only fix at equal specificity by source order. Added shared `--bottom-nav-height` CSS var (`theme.css`, 0px default / 56px ≤768px matching BottomNav's own breakpoint); `.content`/`.site-footer` now derive bottom padding unconditionally from `calc(var(--space)*2 + var(--bottom-nav-height) + env(safe-area-inset-bottom,0px))` — single declaration, no ordering collision possible; `PwaUpdateToast.vue`'s hardcoded 56px consolidated into the same var. — `8fdac70`

- [x] **B39** a/b/c landed in `f21257c` but pointed at workers.dev (stale DESIGN.md misled the agent); corrected to `https://tracklogstudio.timliudev.com` in index.html canonical/OG, robots.txt, sitemap.xml (+ manual debug-URL examples) — `60fafc8`. (d) user-approved 301: new `worker/redirect.ts` + `worker/index.ts`, `wrangler.jsonc` gains `main` + `assets.run_worker_first`, verified via `wrangler dev` (301 preserves path+query) and `wrangler deploy --dry-run` — `4a46f03`. ⚠️ Build output moved to `dist/client/` + worker bundle; if the next deploy 404s assets, check that Workers Builds still ends in `wrangler deploy`/`versions upload` (dry-run shows config auto-resolution works). Submit sitemap to Search Console after next deploy. `llms.txt` still optional/undone.

- [~] **B40** (1+2 done, 3+4 deferred to a dedicated perf pass) (1) Added `<link rel="preconnect">` for `api.github.com` and `static.cloudflareinsights.com` (verified as the actual beacon host) to `index.html`. (2) The GitHub star-count fetch (`useGithubStars.ts`) ran eagerly in `onMounted` with `GithubStarButton` rendering unconditionally in the header — deferred the fetch via `requestIdleCallback` with a `setTimeout(…,1)` Safari fallback. — `f21257c`. (3) static skeleton/critical shell and (4) render-blocking CSS/unused-JS trimming still open — re-measure PageSpeed after next deploy before deciding if they're still needed.
- [x] **B41** `PresetBar.vue`: save-slot `<select>` now has `:aria-label` reusing the existing "Save to" i18n string (no new copy); "Field preset" heading bumped `<h3>`→`<h2>` (it was the first heading rendered on load, no `<h2>` ancestor existed yet) with the matching scoped-CSS selector updated so it stays visually identical. — `8fdac70`
- [ ] **B42 — ON HOLD, DISCUSS WITH USER FIRST (his explicit instruction)** Contrast failures flagged in the LIGHT theme (Lighthouse headless defaults to light; user primarily uses dark): brand-title/topbar, Load files button, Import guide link, seg-btn active, slot-id, muted notes. Any palette change must be proposed to the user before implementation.

## Maintenance / deferred
- [x] **M1** Dependency refresh: no `latest`/`*` ranges existed; all direct deps already at latest in-range; transitive lockfile refreshed; `npm audit` 0 vulnerabilities. TypeScript 6→7 skipped — verified vue-tsc (≤3.3.7) crashes on TS7's removed `./lib/tsc` export; revisit when vue-tsc supports TS7. — `56dc1c5`
- [~] **M2** (agent working, bundled with M3) Clean dead code: `useTrackOverlay` candidates/toggle/clear + `trackOverlay*` i18n (superseded by the FileBar 「加入分析」 checkbox).
- [~] **M3** (agent working, bundled with M2) Refactor `TrackMap.draw()` (≈500-line god-function) into smaller units.
- [ ] **M4** Optional: screenshot user manual.

## Done (recent)
- [x] Comparison laps rendered as a per-lap table; cross-file selected laps drawn on the map; overlay↔map cursor link; collapse vertical reflow (no cross-column jump); chart-mode label 時間軸→時序; accel-test "distance from launch speed" (0=standstill); GitHub star button opens reliably; docs de-staled; PWA meta/manifest scaffolding. (Released to main.)
