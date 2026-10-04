# Issue tracker

Living checklist of reported issues / requests, so nothing gets lost across work sessions.
Status: `[ ]` open · `[~]` in progress · `[x]` done. When done, note the fixing commit (short SHA).
Entries are **issue text + status + commit hash only** — no implementer names, no dates, no
working-hours logs. The binding to git is the commit hash, never the id.
Cite a commit's hash only once it is on origin — a not-yet-published local hash can still change
before it lands, so a hash recorded too early may dangle.
Id prefixes: **B** = reported bug / acceptance item · **M** = maintenance (deps/cleanup/security)
· **F** = feature milestone (design-first). Ids are FROZEN once they appear in a commit message —
never renumber or reuse; new items take the next free number in their prefix.
Role split: THIS file tracks WHAT/status/commit; design rationale, formulas and interaction
policy live in docs/DESIGN.md (+ docs/specs/ for research) — entries here should point there
instead of embedding specs.

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
- [x] **B22** Track-map base layers landed: user-uploaded image + OSM tiles per DESIGN §6.1/§6.3 — `1df1b7c`. Follow-ups: B54 (tiles don't refresh on zoom), B55 (switchable primary track). Original scope: Map base-image overlay (upload + align custom image, free OSM tiles, satellite via user's own API key). Designed in docs/DESIGN.md §6.1/§6.3, never built. Large — schedule separately.

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

## Acceptance round 1
- [x] **B28** Root cause: `TimeSeriesChart.vue`'s `x-bounds` prop always described the full session extent; B9's `UPlotChart.applyXRange()` falls back to `x-bounds` whenever `xRange` is null — which it intentionally is in selection/overlay mode — so every lap (re)selection forced-zoomed back out to the whole session. Fixed by scoping `x-bounds` to no-selection mode only. — `d6c56d1`
- [x] **B29** Renamed XY 散佈圖 → 散佈圖 (both locales); 3rd colour axis makes "XY" redundant. — `693853f`
- [x] **B25b** 3D XYZ scatter when a 3rd channel is chosen: echarts-gl@2.1.0 (pinned; works against echarts@6 in practice), lazy-loaded `Scatter3dChart` chunk excluded from PWA precache like GgChart; 2D unchanged without a 3rd channel; colour back to per-file identity. Follow-ups: B50 (1:1/自動 in 3D), B51 (outlier-robust axis ranges). — `d74e7bd` (follow-up to B25) Marker shape per file is unreadable at real point densities. **DECIDED (user): go 3D — X/Y/Z scatter where the 3rd channel becomes a real Z axis; colour returns to per-file identity.** Implementation notes: needs a WebGL 3D scatter (echarts-gl — VERIFY it supports echarts@6 first; if not, evaluate alternatives or pinning strategy); lazy-load the 3D chunk like the G-G chart; keep the plain 2D scatter when no 3rd channel is chosen; rotation/orbit controls + mobile touch support. Medium-large — schedule like B22.
- [x] **B30** Root cause: `TrackMap.vue`'s pointermove handler itself was fine — the `watch(cursorIdx, () => draw())` ran the FULL expensive redraw pipeline (polyline, heatmap buckets, gates, extrema text) synchronously on every single hover pixel, flooding the main thread and starving pointer-event delivery on real (large) tracks. Fixed with `scheduleDraw()` coalescing cursorIdx-driven redraws to one `requestAnimationFrame` tick, always reading the latest cursorIdx; all other draw() call sites (zoom/pan/drag/resize) stay synchronous. — `0824719`
- [x] **B31** RaceChrono-style fixed centre needle: global Settings toggle (`centreCursorMode`, persisted alongside `inputModePref`, in the B19 export bundle) switches `UPlotChart.vue`'s time-series charts into a mode with an always-visible fixed vertical needle at plot centre; ONE drag gesture for every pointer type (touch/mouse/pen, per DESIGN.md §8 layer 1) pans the visible range under the needle; cursor emitted from the sample under the needle via `centreCursorIndex`, tracked on every visible-range change; cross-chart sync comes for free from the existing shared `xRange`. Scoped to `TimeSeriesChart.vue` only (GearPanel/SessionMergePanel's standalone charts unaffected). — `e6cd49d`
- [x] **B35** Foundation landed: reactive `useInputCapabilities()` (3 matchMedia signals w/ change listeners, mirrored as `<html data-*>` for pure CSS) + settings 操作模式 override (auto/touch/pointer, persisted, included in B19 export) — `6d6966e`; chart gestures were ALREADY per-event pointerType (not width-gated) but `pen` wrongly took the touch branch — now pen≈mouse (`isTouchGesturePointer()`), reset-zoom ≥44px on coarse — `87f876a`; touch-target sizing (⦸ 22→44px, offset ±, collapse/pin 26→44px, chart delete, grid resize handle 30px) migrated from `max-width:768px` to the capability signal; true LAYOUT breakpoints (BottomNav, column count) intentionally stay width-based — `8664eae`. Original **Touch-input policy (user — REFINED): neither viewport width NOR one-shot device classification is acceptable; the same machine switches input live (DeX / phone+BT-mouse / S Pen / tablet touch / laptop trackpad). Adopt the 4-layer policy now specified in DESIGN.md §8:** (1) every interaction must be input-agnostic — no hover-only info, no modifier-key-only gestures (B9's Shift-drag pan needs a touch/pen equivalent); (2) behaviour branches on per-event `PointerEvent.pointerType` (touch drag = pan, mouse drag = box-zoom; pen ≈ mouse with hover), never on device type; (3) `any-pointer: coarse` (+ `matchMedia` change listeners, wrapped in a reactive `useInputCapabilities()`) ONLY sets default density: ≥44px hit targets (⦸ toggles, lap-offset ±, resize handles, gutter), always-visible handles — re-evaluates when a mouse is plugged/unplugged; (4) settings override 自動/觸控優先/指標優先 (persisted) as the escape hatch. Current state: ZERO capability queries in the codebase; everything hangs off `max-width:768px` (App.vue, BottomNav, AnalyzerView, useDashboardLayout, PwaUpdateToast). Also: dashboard drag/resize on touch (long-press vs scroll), map finger-scrub (ties into B30/B31). Build the shared primitive first, then migrate screen by screen.
- [x] **B18b** (follow-up to B18) Pinned card's `.pin-resize-handle` now mirrors grid-layout-plus's `.vgl-item__resizer` structure exactly (position/size via `--vgl-resizer-size`, same `::before` border-corner technique, same accent colour/radius); `AnalyzerView.vue` declares the `--vgl-resizer-*` tokens on `.analyzer` so the pinned handle also gets the existing mobile 30px touch-target bump (DESIGN.md §8). — `9d3dacd`
- [x] **B32** Root cause: the collapse-reflow overlay (`applyCollapsedHeights`/`compactVertical`, added after FLIP already worked) shrinks a collapsing card's OWN grid slot; grid-layout-plus only transitions `left/top/right`/`transform`, not width/height, so that resize lands instantly and `useAutoFlip` saw its own `.vgl-item` snap and FLIP-animated the whole card (incl. header) via non-uniform `scale()` — fighting the body's own real height transition at the same time. Fixed by gating `useAutoFlip`'s `enabled` with a `selfReflowing` ref (set during `animateBodyHeight`, cleared in `onBodyAfterTransition`), same treatment already given to `pinned`; neighbour cards pushed by the reflow still get their own FLIP normally. — `9d3dacd`
- [x] **B24b** (follow-up to B24) Sector card's gate list now fills/scrolls via `CardFillScroll` (same fix as B24's accel list). — `693853f`
- [x] **B33** Root cause: `useTrackExtrema`'s `focusedLap` was derived only from the primary session's own selected lap. Added `buildComparisonExtremaMarkers` (`crossSessionExtrema.ts`, mirroring `crossSessionLapHighlight.ts`) — for each comparison session with a lap selected, computes that channel's min/max on its own track, normalized independently so the colour gradient stays meaningful per file; `AnalyzerView.vue` merges primary + comparison markers for `TrackMap`. — `0824719`
- [x] **B34** Static card types (e.g. 目前數值) missing from persisted layouts now self-heal: `reconcileLayout` also appends any missing `STATIC_CARD_IDS` entry, using the same append-below-everything placement as new charts. — `c090877`

- [x] **B36** Mobile single-column full-bleed: page/grid/card side margins-borders-radius removed (cards → grouped-list sections, top/bottom dividers kept); chart/map canvases bleed edge-to-edge via `--card-bleed-x`; pinned card keeps its floating look; Converter/Settings visually unchanged (own padding restored); 8px OS edge-gesture dead zone on touch (`edgeGesture.ts`, needs real-device verify). — `a9c7093`

- [x] **B37** (a+b done; c decided-skip) (a) `usePwaUpdate.ts` now starts an hourly `registration.update()` timer in `onRegisteredSW`, cleared in `onUnmounted`, so long-lived tabs surface the existing update toast rather than waiting on browser-default check intervals. (b) Verified via `curl -I` against the live deployment: `sw.js` and `/` already come back `Cache-Control: public, max-age=0, must-revalidate` from Cloudflare Workers static-assets defaults — no `_headers` file needed. Incidental finding (not fixed, separate perf item): hashed JS/CSS assets also come back `max-age=0` instead of long-cache/immutable — Cloudflare's immutable-asset heuristic may expect a different hash format than Vite's `name-HASH.ext`. — `f4a8a84`. (c) DECIDED with user: SKIP the skipWaiting rescue release — remaining stranded clients are the user's own devices, already cleared; closing all tabs once fixes any straggler. B37 CLOSED.
- [x] **B38** Confirmed root cause: `App.vue`'s unconditional `.site-footer{padding}` was cancelling the mobile-only fix at equal specificity by source order. Added shared `--bottom-nav-height` CSS var (`theme.css`, 0px default / 56px ≤768px matching BottomNav's own breakpoint); `.content`/`.site-footer` now derive bottom padding unconditionally from `calc(var(--space)*2 + var(--bottom-nav-height) + env(safe-area-inset-bottom,0px))` — single declaration, no ordering collision possible; `PwaUpdateToast.vue`'s hardcoded 56px consolidated into the same var. — `2ef65e3`

- [x] **B39** a/b/c landed in `f4a8a84` but pointed at workers.dev (stale DESIGN.md misled the agent); corrected to `https://tracklogstudio.timliudev.com` in index.html canonical/OG, robots.txt, sitemap.xml (+ manual debug-URL examples) — `28e7594`. (d) user-approved 301: new `worker/redirect.ts` + `worker/index.ts`, `wrangler.jsonc` gains `main` + `assets.run_worker_first`, verified via `wrangler dev` (301 preserves path+query) and `wrangler deploy --dry-run` — `bfe74d1`. ⚠️ Build output moved to `dist/client/` + worker bundle; if the next deploy 404s assets, check that Workers Builds still ends in `wrangler deploy`/`versions upload` (dry-run shows config auto-resolution works). Submit sitemap to Search Console after next deploy. `llms.txt` still optional/undone.

- [x] **B40** (1+2 done; 3 dropped; cache-fix done+verified-live; 4 won't-do) (1) Added `<link rel="preconnect">` for `api.github.com` and `static.cloudflareinsights.com` (verified as the actual beacon host) to `index.html`. (2) The GitHub star-count fetch (`useGithubStars.ts`) ran eagerly in `onMounted` with `GithubStarButton` rendering unconditionally in the header — deferred the fetch via `requestIdleCallback` with a `setTimeout(…,1)` Safari fallback. — `f4a8a84`. (3)/(4) RE-MEASURED (user-provided prod mobile PSI, Lighthouse 13.4.0, 2026-07-22): **效能 97/100** — FCP 1.9s, LCP 2.2s (good), TBT 60ms, **CLS 0**, SI 1.9s. Verdict on the deferred items: **(3) 靜態骨架/critical shell → DROPPED (not warranted): CLS already 0 and LCP already in the "good" band; a skeleton shell is complexity for a marginal LCP gain.** (4) render-blocking (~省300ms) + 無用JS (~省23KiB) → marginal at a 97 score, and any such change needs a prod re-measure to validate + carries FOUC risk + can't be paint-verified headless → left OPEN as optional polish, NOT scheduled. The one clean win — **快取生命週期 (~9KiB): DONE** — Cloudflare Worker now stamps `Cache-Control: public,max-age=31536000,immutable` on Vite's content-hashed `/assets/*` (guarded against the SPA-fallback `text/html` case); closes the B37 incidental finding. `worker/assetCache.ts` + 17 tests — merge `530e120`, released to main `d6ea40a`. **VERIFIED LIVE (2026-07-22, post-`d6ea40a` deploy):** `/assets/index-*.js` → `Cache-Control: public, max-age=31536000, immutable` (CF-Cache-Status HIT); `/` and `/sw.js` correctly stay `max-age=0, must-revalidate` (SPA-fallback + PWA-update guards confirmed working). (4) CLOSED as **won't-do** — read-only analysis of the built `dist/client/index.html` shows the ONLY render-blocking resource is the single main CSS bundle (`/assets/index-*.css`); the module entry script + CF beacon are both `defer`/module (non-blocking). Eliminating the CSS block needs critical-CSS extraction or a `media`-swap hack, both of which risk FOUC / CLS regression on an app already at 97 / CLS 0 — not worth it for a ~300ms throttled-lab estimate. Unused-JS 23KiB is likewise marginal (heavy views already lazy-loaded per B88). Revisit only if a future measurement regresses. **B40 CLOSED.**
- [x] **B41** `PresetBar.vue`: save-slot `<select>` now has `:aria-label` reusing the existing "Save to" i18n string (no new copy); "Field preset" heading bumped `<h3>`→`<h2>` (it was the first heading rendered on load, no `<h2>` ancestor existed yet) with the matching scoped-CSS selector updated so it stays visually identical. — `2ef65e3`
- [x] **B42** Discussed with the user (fresh Lighthouse a11y run listed the exact failures: brand-title, import-guide link, seg-btn active, slot-id, bottom-nav label — ALL of them were `--color-accent` #e23b3b used as text/background on light surfaces, 4.27:1 < AA 4.5:1); user picked the single-token option: LIGHT theme `--color-accent` → `#cc3333` (5.13:1 vs white, ≈4.98:1 vs bg), dark theme untouched. Repo-wide audit: uPlot/CVT canvas series colours and the logo SVGs keep #e23b3b deliberately (non-text/logotype exemptions), meta/manifest theme-color was always the bg colour, every `color-mix`/hover derives from the var and follows automatically. — `fededa3`/`dcefb63`

## Acceptance round 2
- [x] **B1c** Comparison tables now have the same ⦸ manual exclude as the primary: per-session `manualExcludedBySession` in lapStore (cleared with session removal), union with band auto-exclusion feeds that session's fastestLapTime/delta; band-excluded laps stay on+disabled like the primary; ⦸ button extracted to shared `LapExcludeToggle.vue` (used by both tables, incl. B35 44px coarse-pointer rule) so styles can't drift. — `8c38b12` Comparison lap tables need the ⦸ exclude button after all, same UI as the primary (user: 「比較檔的排除此圈按鈕呢?沒看到阿」 — supersedes B1b's "comparison stays non-excludable"). Requires per-comparison-session MANUAL exclusion state in lapStore (band-based auto-exclusion already works); excluded comparison laps affect that session's fastest-lap/delta the same way as primary. Lead cell = ⦸ + swatch + lap number, identical to primary.
- [x] **B30b** Root cause was NOT the mapping (overlayCursor sample→lap-relative X already worked): on a closed circuit the nearest-point scan often snapped to an adjacent UNSELECTED lap a few px away, so the mapping found no lap. `nearestSample()` gains `preferredRanges` (selected-lap index ranges win within the hit radius; outside-selection hover naturally ignored); hit radius 24→32px, 48px when any touch pointer present. — `7c00831`
- [x] **B32b** **User confirmed fixed — flicker did not reproduce (沒有觸發).** Investigated: the pin/unpin FLIP mechanism itself (invert→release sequence, transform math, genuine CSS Transition via `getAnimations()`, no remount across the Teleport) checked out correct. Found and fixed a real bug in `useAutoFlip` (`useFlipAnimation.ts`): a rapid pin→unpin→re-pin inside the `PIN_FLIP_DURATION_MS` debounce window left the FIRST toggle's re-attach timer armed; it fired unconditionally and re-observed the WRONG parent (the pinned anchor instead of the grid slot), silently breaking "auto-flip disabled while pinned" — fixed by cancelling the stale timer on every `enabled` flip + re-checking state at fire time, regression test added. — `7525823`
- [x] **B43** 目前數值 card can shrink to a single column: `STATIC_MIN_SIZE` minW 3→2 + grid `minmax(min(96px,100%),1fr)` so narrow cards stack one column with vertical scroll, no horizontal overflow. — `b3290cb`
- [x] **B44** Current-values cells pulse (accent 10%, 400ms, color-mix) when their DISPLAYED string changes; re-triggers without stacking on rapid changes; 目前時間 cell excluded; disabled under prefers-reduced-motion. — `e268981`
- [x] **B46** Scatter/G-G (shared GgChart.vue) gains inside dataZoom on X+Y (wheel/drag, native pinch) + reset-zoom button matching B9 (shown only while zoomed, 44px on coarse); zoom window survives re-renders (resize/theme/axis changes). Known trade-off: 1:1 mode can temporarily deviate from square while zooming. — `7907b9e`
- [x] **B47** 理論最佳圈 summary moved into SectorPanel's CardFillScroll fixed header (after gate controls, before the scrollable gate list) — visible at any card height. — `ba2f9b2`

## Acceptance round 3
- [x] **B31b** Root cause: neither needle position nor value readout — uPlot's NATIVE drag-to-zoom stayed active (`cursor.x:false` only hides the crosshair; `cursor.drag` defaults on, and mouse events bypass the pointer-handler preventDefault), so every mouse pan got overwritten by a box-zoom on mouseup. Fixed with `drag:{setScale:false,x:false,y:false}` in centre mode; needle/readout math extracted to pure `needleOffsetX`/`valueAtPlotX` + tests against REAL uplot reproducing the fight. Touch path unified too. — `133c691`
- [x] **B48** Accel-test results sorted fastest→slowest via pure `sortSegmentsByTime` (render-side only; domain return order unchanged for existing callers); B26 focus keys unaffected. — `d96afeb`
- [x] **B43b** `STATIC_MIN_SIZE[currentValues].minW` 2→1 (measured: minW 2 content width ≈175px still fit two 96px cells; minW 1 stays below the 200px two-column threshold) — true single column with existing minmax CSS. — `904a018`
- [x] **B49** Current-values field arrangement: sort original/alphabetical/custom + per-field hide + up/down in an 編輯欄位 mode (44px on coarse); 目前時間 pinned first; prefs persisted (`currentValuesFieldPrefs`, reconciled on session change) and included in the B19 export bundle. — `3dbda93`

## Acceptance round 4
- [x] **B50** Investigated: the 1:1/自動 buttons did NOTHING in 3D — `equalAspect` was only forwarded to the 2D `GgChart` path and `grid3D`'s box was hardcoded 120/100/100. Decided to implement for real (not hide): `equalAspectBoxSize()` (`domain/analysis/scatter3d.ts`) sizes `boxWidth/boxHeight/boxDepth` proportional to each axis's actual data span (largest span → 100, degenerate spans floored at 5%), so equal data units map to equal visual length on X/Y/Z; 自動 keeps the historic fixed box. Tooltip hints get 3D-specific wording (both locales). — `2c28446`/`3576aa7`
- [x] **B51** Outlier-robust 3D axis ranging: each of X/Y/Z clamps to its 0.5–99.5 percentile band (`robustAxisRange`/`computeAxisRanges`, PERCENTILE.INC-style linear interpolation, 5% padding) instead of full min/max; outliers stay in the series data and just clip at the box edge (tooltips unaffected). Escape hatch: per-chart persisted 包含離群值 checkbox (`ScatterChartConfig.includeOutliers`, backfills false, 3D-only, 44px on coarse pointers). 2D scatter ranging intentionally untouched (not reported squashed; has its own 1:1 mechanism). — `2c28446`/`3576aa7`
- [x] **B52** Root cause: `gutterItems` was built from the CANONICAL (expanded-height) `desktopVisibleLayout`, while the grid renders the collapse-reflow DISPLAY layout (`applyCollapsedHeights` → COLLAPSED_ROWS + `compactVertical`) — so once any card collapsed, every gutter rect stayed at its stale pre-collapse position/size. Fix: shared `desktopDisplayLayout` computed feeds BOTH the grid and the gutter overlay; pure `filterCollapsedGutters` drops horizontal gutters on a collapsed card's display-only bottom edge (vertical gutters unaffected — collapse never touches `w`); gutter write-back now restores collapsed cards' canonical heights before `mergeLayoutPositions` (same treatment as the native drag/resize path — without it ANY gutter drag would have frozen COLLAPSED_ROWS into the persisted layout for every collapsed card). — `1acca7b`/`3ccaa22`
- [x] **B53** Verified WITH the actual file (parsed via the repo's own importer; reproduced the exact 28-segment result set): **real data, code correct — not a bug.** Both segments start from genuine standstill (20 consecutive samples at exactly 0.00 km/h each). #1 (7.601s, exit 37 km/h) launches harder, peaks at **70.0 km/h** mid-window, then brakes before the 100 m mark; #2 (9.003s, exit 63 km/h) climbs monotonically. #1's average over the 100 m (47.4 km/h) beats #2's (40.0) — faster time with lower exit speed is legitimate. Distance interpolation/boundaries/end-speed sampling all check out. To stop this reading as a bug: `AccelSegment.peakSpeedKmh` added and AccelTestPanel shows 「峰值 xx km/h」 only when the peak meaningfully exceeds exit speed (>1 km/h). — `92c4ba1`/`0e66cd3`
- [x] **B54** (B22 follow-up) Root cause was threefold: no settle debounce (every wheel tick fired real tile requests across every zoom level crossed), no stale-tile placeholder (uncached cells drew blank), and `onerror` allowed infinite per-frame retries (retry storm → OSM rate limiting → tiles never arriving). Fix: pure `domain/analysis/mapTiles.ts` (z-selection, viewport→tile range, `TileLruCache` 400-entry, ancestor-placeholder math) + TrackMap 250ms viewport-signature settle debounce, FIFO queue capped at 6 concurrent, failed-tile no-retry set, coarser-ancestor crop-and-stretch placeholder so zoom never flashes blank; attribution + user-image layer unchanged. — `5a95756`/`baeeeb8`
- [x] **B55** Investigated: primary switching ALREADY existed (`promotePrimarySession` + clicking the file-name pill, since `5e6b409` — present in the build the user tested) but its only discovery cue was a mouse-hover tooltip (invisible on touch), AND swapping left real state bugs behind. Fixes: (a) explicit always-visible star button on every non-primary ready pill (44px on coarse pointers per DESIGN §8; pill-name click kept). (b) Real bug — the index-keyed primary lap facet (`selected`/`manualExcluded`/`offsets`) vs fileId-keyed comparison facets had NO migration on swap, and useLaps/useSectors' file-change watchers wiped state (incl. the GLOBAL start/finish line + sector gates) on every swap. New pure `swapPrimaryLapState` (`domain/analysis/primaryLapSwap.ts`) migrates both directions (old primary folds into its per-session slot; promoted file's state becomes the primary facet; discarded when the old primary leaves the set); `lapStore.swapPrimarySession` + one-flush `primarySwapPending` signal ('post'-flush self-reset) tells those watchers to skip the wipe; line/gates/valid-lap bands treated as global (already shared with comparisons) and survive swaps. Wired into `makePrimary`, primary-uncheck auto-promotion, and AnalyzerView's removed-file auto-promotion. Audited as fine without changes: analyzerStore offsets/xRange, accel test, theoretical best, deltas, currentValuesFieldPrefs reconcile, TrackMap/overlay role swap. — `3e371d5`/`60f77d1`

## Acceptance round 4 follow-up
- [x] **B56** Root cause: `useAutoFlip` measured the CARD element as its FLIP baseline — mid-animation that rect carries the in-flight inverse transform, so any redundant wrapper style rewrite while hovering the title re-fed the transient rect as the new baseline → repeated invert→release cycle = the "picked-up card" strobe. Fixed by always measuring the unanimated `.vgl-item` wrapper instead; regression tests added. Verified fix (typecheck clean, 1590 tests green) and released to main `bd92850`. — `9d59339`/`9c578f9` Original report: hovering a card TITLE (drag handle) makes every card flicker wildly "as if picked up for dragging". Investigation had excluded gutter-rect overlap, hover layout writes, collapse echo loops, and tooltip pointer-events before the FLIP baseline was pinned down. (Separate transient noted: a one-off `@vitejs/plugin-vue` `invalidateTypeCache` HMR overlay crash on dev-server file change — cleared by refresh, not reproducible, no action.)

## Acceptance round 5
- [x] **B58** (part 2 landed: band origin `auto`/`user` in lapStore; auto bands re-suggest on EVERY laps recompute — line drag/source switch/new track — user-edited bands never touched; 清除區間 re-arms suggestion for the next laps change; primary swap suppresses one refresh via the existing pre/post flush ordering; synthetic garbage-loop→real-loop regression fixture mirrors the reported repro. — `c4758a7`/`8026e59`/merge `e73d330`. Verify the live behaviour on your file when convenient.) Loading bbbb(22).loga (TYKA) auto-excluded ALL 9 laps (time band 50.6–76.0s vs real laps 46.7–54.1s; distance band 5.4–8.0 m vs real 0.44–0.68 km) and 自動偵測彎道 silently did nothing. ROOT CAUSE REVISED during review: the lap table's distance column and the suggestion pipeline use the SAME `cumulativeDistanceM` — there was never a divergent calculation. The absurd bands come from suggestion TIMING: `useLaps`' one-shot `pendingBandSuggestion` fires the moment laps FIRST become non-empty for a track — i.e. from the garbage micro-laps the default/initial line produces (median distance ~6.7 m!) — and once bands are non-null nothing (line drags to the correct position, band clears) ever re-suggests. Confirmed by the user live: bands only reflect the FIRST drag instant, later drags never update, reset doesn't re-derive. LANDED (part 1, hardening): shared `lapDistanceM` (NaN for out-of-range/degenerate instead of clamped-to-0), cross-TRACK band reset+re-suggest (primary swap exempt via `primarySwapPending`), zero-valid-lap hint on 自動偵測, "all laps auto-excluded" LapTable hint, both locales — `05910dc`/`b44d97f`/`83e957f`/merge `bc622cb`. REMAINING (part 2): re-suggest when the start/finish LINE changes while bands are auto-suggested (track auto-suggested vs user-edited provenance; user-edited bands survive line drags, auto ones refresh), and clearing a band must re-arm suggestion on the next laps change.
- [x] **B57** Root cause: the multi-session branch (`9f3e9bd`) in `ScatterChart.vue`'s `ggSeries` ran BEFORE the lap-selection logic and `buildMultiSessionScatter` never had start/end slicing — with ANY comparison file enabled the scatter (2D, 3D and G-G alike) ignored both the primary's `selectedLaps` and cross-session picks and always drew whole sessions. Fix mirrors TimeSeriesChart's `crossLapSources` merge: pure `resolveComparisonLapPicks` (stale cross-refs silently dropped) + `buildMultiSessionScatterLaps` (one clipped cloud per selected lap, hue stays per-file, series named 「檔名 · 第 N 圈」 via existing i18n); empty combined selection keeps the whole-session behaviour. Single-file path was never broken. — `4a8c12d`/`9d51f9e`

## Acceptance round 5 — second batch
- [~] **B59** Root cause (confirmed in grid-layout-plus source): the corner resize handle binds left/right/bottom edges to one selector, so `state.resizing.width` tracks the finger's raw X live and is only clamped back to `w ≤ cols` at resizeend — on the 1-column mobile grid that transient is the rightward stretch. Fix: `resizeOption` per GridItem fully overrides the library's `edges`; new `VERTICAL_ONLY_RESIZE_OPTION`/`resizeOptionFor(isMobile)` (dashboardLayout.ts) keeps only `bottom` on mobile so width can never change mid-drag; desktop unchanged. Needs real-device confirm. — `9ab8ed3`/`366f91a` · Device retest: PINNED (floating) cards can still change width — B59 only covered grid cards → see [[B99]].
- [x] **B60** Root cause: `MapBackgroundControls.vue` used a bare `<details>/<summary>` whose collapse triangle is the browser's UA-default disclosure marker — desktop Chrome paints it, Android Chrome doesn't reliably. Replaced with an always-visible button + inline SVG chevron (same convention as DashboardCard's collapse button: rotate transition, 44px coarse target, `aria-expanded`; reuses existing expand/collapse i18n). UA-independent by construction. Follow-up (round 6): the toggle button is a bit too TALL (底圖按鈕有點高了) — tighten its min-height/padding on fine pointers (keep the 44px coarse target). — `d76443f`/`8b17e3b` **User confirmed OK (incl. the too-tall follow-up).**
- [~] **B61** Touch pointers on the drag handle now go through a 300ms/10px long-press gate (pure state machine `domain/layout/touchDragDelay.ts`) before grid-layout-plus's interactjs ever sees the gesture: handle `touch-action` none→`pan-y` (vertical swipes scroll natively during the pending window), touch pointerdown is stopPropagation'd (interactjs listens on document in the bubble phase — verified in its source), and a successful hold re-dispatches a synthetic pointerdown (same pointerId, marker-flagged so the component ignores its own hand-off) that interactjs adopts for the real drag; `.touch-armed` gives instant hold-complete feedback; mouse/pen drag stays immediate (§8 pointerType branch). `dragHintMobile` copy updated both locales. — `50cb104`/`366f91a` · Device retest: long-press-then-drag & short-tap-noop both OK, but "hold-then-immediately-drag" scrolls the page instead of dragging the card (long-press gate vs native pan-y race — a finger moving inside the 300ms window is judged a scroll). Gesture arbitration needs rework. Related edge-autoscroll / pink-block mis-touch → [[B102]] (folded into [[F1]]).

## Acceptance round 6
- [x] **B62** Per-reason exclusion icons (manual/timeBand/distBand/sector) + table-footer legend, per user's decision. — `28c2463` (icon centering + sector `S<n>` marker follow-ups → B72)
- [x] **B63** Title-origin vertical swipe scrolls natively again (B61 follow-up). — `668aba0` (real-device re-verify pending)
- [x] **B64** Mobile pinned card full-bleed + session-scoped mini/expanded toggle. — `7eae27e` (device compare pending; `pinnedMini` shared B100's un-shrunk-frame bug — fixed in [[B103]])
- [x] **B65** Per-channel update rate (median value-change interval, cached) + Current-Values Hz badges + GPS/ECU summary fields + one rate per chart. — `097be06` (badge→bottom-right B79, units B80)
- [x] **B66** Larger content-fitting default card heights + reset-layout regression coverage. — `d042d13`/`ff9b4fa` (user reports desktop reset STILL cramped → B76)
- [x] **B67** Sector auto-detect no longer nukes every lap: gates offset to midpoint toward next distinct GPS fix (root cause: gates centred exactly ON recorded fixes fail the robust endpoint-only intersection test; duplicated ECU rows compound it); failures now carry first-missed `S<n>`; all-failed configs warn without excluding. Real-file: reference lap 0/11→11/11 gates. — `de2d0d0` (S2 attribution bug → B74, gate-drag-out no reaction → B73)
- Round-6 follow-up batch (22 items, all landed in the same merge): drag/hover/current-values perf overhaul `0c154cb`; storage-copy removal + map-controls sizing `8981a8c`; maximize glyph + theme-independent checkered line `d0bfa5d`; MT/CVT inference + 120/80-12 CVT default `80ab683`; CVT notes export/import across NMEA/VBO/CSV/LOGA `87e29e7`; background-luminance track casing `ce87fc5`; accel manual exclusion + GPS-drift false-record rejection (r674: 342→25 candidates, best 0.0186s→6.5689s) `bb39b81`; ECU-lap line inference + no-line whole-recording row `6f90102`; sector `S<n>` markers `de2d0d0`; gate midpoint drag `10d993e`; map-maximize survives tab switch `72b7056`; fixed-centre cursor geometry/zoom + 450ms touch long-press select `e0d02d2`; mobile split-window deliberately deferred (no approved design → F1); manual sector sequence #14 unreproducible without persisted geometry (now provided in LogaExample — folded into B73/B74).

## Acceptance round 7
Test assets: user placed `bbbb(22).loga` + `bbbb(22)set.json` (his manual gates — the persisted circuit geometry follow-up #14 needed) + `bbbb(22)auto.json` (algorithm output) in `C:\Data\repo\AracerLogaAnalysis\LogaExample\`. NEVER commit them; add `LogaExample/` to `.gitignore`.
- [x] **B68** Centre-needle mode can't reach the first/last samples — allow panning past the data edges (virtual x-axis padding up to half the visible span) so the needle can land on every sample; axis ticks outside the data render empty. — `3bf3289`
- [x] **B69** 底圖 controls: the file-choose button should only render when layer kind = custom image; rename 「上傳圖片」→「自訂圖片」; accept SVG files as the custom image (canvas drawImage handles SVG via Image element). — `0602187`
- [x] **B70** Chart x-axis shows UTC when no lap selected — must honour the app's timezone setting (existing decision: local time). Check all uPlot axis/tooltip/cursor readout paths. — `b678fa2`
- [x] **B71** Accel-test 排除區段 should reuse the SAME exclusion UI logic/pattern as the lap table (shared component/behaviour, not a parallel impl — same lesson as B1/B17). — `d7d6fbc`
- [x] **B72** Exclusion icon still not optically centered inside its circle (user screenshot); also the sector-fail `S<n>` marker text is too small to read. Fix both, keep two-digit `S12` fitting. — `95aa31a` (optical centring = visual check pending)
- [x] **B73** Dragging sector gate S8 completely OFF the track produced NO reaction — laps should re-fail sector check (suspect the 0c154cb pointer-up-commit change dropped validity recompute on gate move; verify wiring end-to-end with LogaExample assets). — `3d016b1` (real set.json: S8-off = 0 pass/9 raw failed/0 effective per B67 policy, now surfaced)
- [x] **B74** After reset + auto-detect: lap 2 visibly crosses S2 but is excluded as missing S2 — sector-crossing attribution bug; investigate with `bbbb(22)auto.json` geometry. — `d3ac30a` (auto.json 4→5 pass, lap 2 restored; three-point exact-sample crossing rule shared by validity/timing/order)
- [x] **B75** Sector gates should auto-populate without pressing 自動偵測: when a start/finish line exists and NO gates are set (and none saved for this circuit), run detection automatically; NEVER overwrite user-placed/saved gates. Future-proof order per user: saved circuit/track-library geometry first (circuitStore already persists per-circuit) → auto-detect only as fallback. — `bb446d8`
- [x] **B76** Reset layout STILL yields cramped cards on desktop (B66/ff9b4fa insufficient — user screenshot shows internal scrollbars everywhere). Re-derive defaults from real rendered content heights. — `ddce6cb` (lap table 16→21 rows etc., browser-measured; unbounded lists keep internal scroll by design)
- [x] **B77** Remove developer-voice UI copy (「誠實拒絕優於亂給估計值」-style wording) — locate the string(s), replace with plain user-facing text, both locales. — `5ef82e4`
- [x] **B78** ECU-lap times/distances differ between runs/screens (lap 6: 1:04.125/188/219/313 across the user's session; vendor app shows 1:04.429) — ECU lap source should be deterministic. Investigate boundary/interpolation and any line-dependence leaking into ECU mode; document the vendor-app delta explanation honestly. — `910213c` (bit-exact ×32 determinism test; vendor +116.5ms = boundary/clock definition, documented not corrected)
- [x] **B79** Update-rate badge: move from cell top-right to BOTTOM-right (it covers field names). — `4f8e61a`
- [x] **B80** If the log provides a channel's unit, show it in 目前數值 cells and chart axes/tooltips. — `d9be677`
- [x] **B81** Charts narrow as channels are added (each channel adds its own y-axis). Consolidate: shared/merged axes where scales match, cap visible axes, rest legend-only — pick the least-surprising scheme. — `d46a44d`
- [x] **B82** Multi-channel chart series are same-colour-different-dash and unreadable — switch to per-channel colours (theme-aware palette, keep light/dark contrast); dash can stay as a secondary cue. — `19ac6e8`
- [x] **B83** CVT-notes write-back is undiscoverable — add a hint/link from the analyzer CVT card to the converter's 另存修改 (.loga) export. — `d824f13`
- [x] **B84** Suspension-calibration settings should ride along in CSV/VBO/NMEA/LOGA exports via the same metadata mechanism CVT notes use (87e29e7) and round-trip on import. — `57b1390`
- [x] **B85** New importer: plain CSV (header row → channels; Time column detection; document expected format in the import guide). — `eb944b6` (RFC4180+BOM, unique Time/Timer header, size caps, TLS metadata round-trip)

## Acceptance round 7 follow-up
- [x] **B86** Time-series charts should use SOLID lines only; channel identity = colour, multiple files/laps of the same channel = brightness variants of that hue (light theme darkens repeats, dark theme lightens; every variant keeps ≥3:1 surface contrast; chips keep the base colour; dash removed as a cue). — `32bc82a`
- [x] **B87** B68 follow-up: fixed-centre mode stopped showing the value under the centre needle. Root cause: centre-cursor emission was only a side effect of uPlot's `setScale` hook, so initial range application/same-range data replacement never published a sample; additionally uPlot's own legend stayed `--` because no native cursor index was set. Emission is now an explicit lifecycle step (queued emits reject stale/destroyed instances and non-centre mode) and the native cursor is synced to the centre sample with the crosshair still hidden and feedback suppressed. Real-file browser check shows values instead of `--`. — `6f62ebe`/`01c2679`
- [x] **B88** Chrome dev-mode LCP 2.84s on `p.muted` (default Converter note): default Converter view moved into the initial graph (Analyzer/Settings stay lazy); FileBar now uses lightweight format definitions with ZIP inflation and RCNX SQLite inspection loaded only on file selection. Production critical-chain gzip 70.40→63.21 kB, two post-mount requests removed. Re-measure production Chrome LCP for acceptance (dev-mode cold Vite transform is not a release metric). — `8ad0890`
- [x] **B89** Sudden desktop→mobile resize left the fixed needle off the geometric centre. Root cause: stale uPlot plot-rectangle race during layout transitions. Resize now coalesces Vue layout settlement + animation frames, ignores zero-size transition frames, observes the current data rectangle and re-measures the needle once settled. Verified in-browser with the real record across 1440×900→390×844→back (needle within 1 CSS px of centre at every size). — `56262bb`
- [x] **B90** Left/right gutter drag now performs a zero-sum SPLIT resize: left card grows exactly as the right card's x/width contracts (shared edge stays under the pointer; right edge/total span/y positions preserved; both minima and third-card collisions clamp the delta). Top/bottom gutters keep the existing reflow semantics. Touch starts only from a persistent coarse 44×44 grip; other touch starts keep native scrolling. — `7dbbbf5`
- [x] **B92** P0 regression from B90 (caught by user on first device test, diagnosed live in his broken tab): the three touch-grip rules were written `:global(:root[data-any-pointer-coarse]) .grid-gutter-grip …` — Vue scoped-CSS `:global(X) Y` makes the WHOLE rule global with selector `X` and silently drops `Y`, so on any touch-capable machine `<html>` itself received the grip styles (`position:absolute; 18×4px; place-items:center` + pink `color-mix` background) the moment the lazy analyzer chunk loaded: entire app collapsed to a ~172px centred strip on a pink page, and returning to 轉換 couldn't undo it. Fix: drop the `:global()` wrapper (repo convention `:root[data-any-pointer-coarse] .foo` — Vue scopes the tail segment); regression guard `test/lint/scopedCssGlobalBan.test.ts` bans `:global(` in scoped blocks repo-wide. Verified live: with the attribute forced, `<html>` stays full-size and compiled selectors carry the scope attr. — `6a71e55`/merge `5a0cd8c`
- [x] **B93** (user, device test) The B90 pink gutter strips are already the resize affordance — circular 44px grip pill removed. Touch drags start from the strip itself; §8 kept via an invisible coarse-pointer `::before` hit-slop widening only the narrow axis to 44px (visible strip unchanged); coarse `touch-action: none` on the gutter so horizontal-gutter vertical drags aren't stolen by page scroll; `role="separator"`/aria moved onto the gutter element. — `8e92566`
- [x] **B94** (user, device test) Non-centre mode with an active x-zoom can now PAN by dragging the X-AXIS tick/label band (mouse + touch; band hit-test = below `u.over`, within the axes canvas, so the B70 second clock axis pans too). Strict clamp to data range (no B68 virtual padding — centre-mode-only), same `dataXBounds`/`emitXRange` pipeline as existing gestures so reset-zoom/persistence unaffected; grab/grabbing cursor while pannable; pure helper `isPointInAxisBand` + 11 tests. — `83cf714`
- [x] **B91** Sector-marker policy clarified: removing ALL gates clears sector exclusions and leaves no `S?` marker; when EVERY lap fails the current gate set, the B67 safety policy still applies no automatic exclusions but each row now shows a non-clickable `S<n>` diagnostic beside the manual toggle; partial-failure automatic exclusions keep the existing disabled `S<n>` toggle. — `4856c98`
- [x] **M5 — CVT belt-position model + animation** LANDED (merge `1bcaa00`, research chain `e44dfda`…`b288c7e` docs/specs/CVT-DYNAMICS-RESEARCH.md, impl chain `d44919e`…`2e127fc`, 1852 tests green): Phase 1 kinematics (`cvtDynamics.ts` exact open-belt length + bounded bisection two-constraint solve; 5 derived channels `@derived/cvt/*` precomputed+WeakMap-cached in `cvtTrace.ts` — cursor consumers never invoke a solver), Phase 2 honest degradation (per-sample geometryStatus 0=ok/1=out-of-bounds ⇒ slip/2=no-root; per-input disabled reasons; `inferFixedReductionFromSegment` median/MAD calibration fallback; no extrapolation beyond measured curves), Phase 3 quasi-static force-balance sandbox (`cvtForceBalance.ts` roller/spring/torque-cam per spec eqs, equilibrium roots + stability + endpoint fallback, roller-mass ±Δg sensitivity sweep) + cursor-synced rAF animation card (`CvtDynamicsCard.vue`) + per-vehicle profiles with structured belt/geometry/force/calibration params in drivetrainStore, B19-bundle round-trip w/ sanitization, zh-Hant+en. Real-file check (R672.loga, 46k rows): launch clutch-slip solved i_cvt 12.96 ≫ bounds correctly flagged out-of-bounds; top-speed i_total 7.743 @122 km/h → fixed-reduction calibration 10.01 (relMAD 0.005, ok); ratio↔front-radius inverse relation 0/200 violations. Default-layout integration: cvtDynamics card in column C under 目前數值 (h12), mapAlign relocated to column B bottom to keep the default a compactLayoutTopLeft fixed point + column spread ≤10. (Card currently hidden from release via B98 / to be menu-gated via [[F2]].)

## Features (design-first)
> ⚠️ **溯源更正(2026-07-24):F1/F5 整條「行動聚焦視圖」是 Claude 自起的 roadmap 點子(DESIGN.md「M6 手機分割視窗」),不是使用者要求的功能。文件/commit 中的「使用者拍板 / user 決策 / approved / decisions locked」為 Claude 自我核准的誤記——使用者 2026-07-24 明確表示「從頭到尾沒要過這個聚焦功能」。依使用者指示**整個移除**,手機回到單欄捲動儀表板。詳見記憶 focus-feature-was-claude-originated。以下 F1/F5 內文保留為歷史,狀態改為移除中。**
- [x] **F1 (整條已移除 `3447cad`;非使用者要求——見上方溯源更正。本條保留為歷史)** — **聚焦堆疊範式已淘汰**:真機測試顯示堆疊會塞入**全部**可見卡 → 每面板卡在 `min-height:180px` 底線 → 堆疊整體捲動 → phase-2 分隔線**無自由空間可重分配(拖了沒反應)**、scrubber 被推出畫面底部;聚焦模式因而與完整捲動幾乎無異。使用者拍板轉向**單焦點視圖**(見 [[F5]])。**已刪除**:`MobileFocusStack.vue` 與可拖曳分隔線、`mobileView.splitWeights`(僅保留欄位相容)。**仍沿用**:底部 scrubber + ▶ 播放(phases 3-4)、`cursorIdx` 共用游標同步、phase-5 拖曳手勢引擎(仍服務「完整」儀表板模式)。設計文 docs/specs/F1-MOBILE-STACK-DESIGN.md 已標註取代狀態。以下為原始條目內容: Mobile split-window — RaceChrono-style: a menu picks which cards show on the small screen (user's own default = map/track on top, chart below), multiple cards visible at once in a curated vertical stack with one shared bottom time-scrubber syncing every panel's cursor, alongside the existing full-dashboard scroll mode (mobile default = the focus/stack view). Shares the visibility state with [[F2]]'s menu. Folds in [[B102]] (mobile card-drag gesture: edge-autoscroll, two-finger scroll during drag, pink gutter-grip mis-touch/priority — needs the [[B61]] gesture-arbitration rework). **設計已定稿 + 決策拍板(docs/specs/F1-MOBILE-STACK-DESIGN.md):(a)聚焦集=F2 可見集、(b)v1 就做可拖曳分隔線、(c)v1 就做完整行動拖曳手勢引擎(edge-autoscroll+兩指捲動+粉紅塊優先權,完整關掉 B61/B102)、(d)scrubber 含 ▶ 播放。實作待 [[F2]] 落地後開始(F1 重用 F2 可見性 store/選單)。** **Phase-1 地基已落地(merge `e945fed`,實作 `27cc288`):純資料模組 `src/domain/layout/mobileView.ts`(`tracklogstudio.mobileView.v1` = `{mode:'focus'|'full', focusOrder, splitWeights}`,load/save/sanitize/reconcile/`resolveFocusStackOrder`/`weightFor`)+ composable `src/composables/useMobileView.ts`(比照 `useCardVisibility`)+ 41 單元測試;2003/2003 綠、typecheck 乾淨、build 成功。純新增、零 UI 變動。**Phase-1 UI 已落地(merge `4c57372`,實作 `8f8d2e2` 抽取 + `16993ac` focus stack;user 選 (ii) 全拆、用 Opus 4.8):** 把 14 個卡片 body(13 靜態 + `ChartCard`)全抽到 `src/features/analyzer/cards/*.vue`,由 `AnalyzerCardBody.vue` dispatcher 依 id 派發,吃單一 typed `AnalyzerCardContext`(`analyzerCardContext.ts`,一次組裝於 AnalyzerView、把 god-component 耦合抽成明確介面)—— grid `#item` slot 從 ~400 行 14 分支收成一個 `<DashboardCard><AnalyzerCardBody/>`;桌面 + 行動完整模式行為保留(pin/Teleport/gutter/drag 全不動)。`MobileFocusStack.vue` + `聚焦/完整` 行動切換接上 `useMobileView`,focus/grid 以 `v-if/v-else` 互斥(絕不同時掛載)。i18n 雙語 + dispatcher/focus-stack 測試。typecheck 乾淨、**2039/2039 綠**、build 成功。**⚠️ 只在 develop,未發 main —— 待真機視覺驗證**(headless 無法 paint;重點驗:focus stack 的填滿/捲動手感、各卡在新容器內渲染、雙欄→單欄)。裝置驗證 follow-up:`.focus-expand` 展開鈕 32px < §8 coarse 44px、focus 模式仍顯示 drag-hint 文案(可隱)。**Phase 2 已落地(merge `a39d41a`;user 選 sonnet 實作):** MobileFocusStack 相鄰面板間可拖曳分隔線,即時重分配兩鄰居 flex 權重(合併權重恆定、180px floor 夾限)、drag 結束經 `useMobileView().setWeight`→`mobileView.splitWeights` 持久化;44px coarse target、`touch-action:none`、pointer-capture(pointer-agnostic);`setSplitWeight` setter + 7 測試。typecheck 乾淨、2046/2046 綠、build PWA30。分隔線 drag 手感待裝置驗證。**Phases 3+4 已落地(merge `ba25907`;user 選 sonnet 實作):(§3) 底部 scrubber** `MobileScrubber.vue`——focus 模式下釘在 BottomNav 上方(flex 子元素、複用 `--bottom-nav-height` 佈局),domain = 選到 1 圈則該圈 sample 區間、否則全 session;拖 thumb → session sample index → `analyzer.setCursor`(overlay 圖表由 `TimeSeriesChart` 既有 `cursorIdx` 反向推導自動跟隨,**不呼叫** `setOverlayCursor`、零冗餘);thumb = `cursorIdx` 的 computed → 雙向(外部移動 cursor 也帶 thumb、無回饋迴圈);`m:ss.mmm` 讀數用既有 `formatLapTime`。純 `src/domain/analysis/scrubber.ts`(domain/clamp/fraction↔index/elapsed/`advanceByTime`)+ 44 測試。**(§4) ▶ 播放**——scrubber 上 play/pause,rAF + `performance.now()` delta 沿 `timeMs` 以 1x 推進(比照 CvtDynamicsCard),到 domain 末停(v1 不循環);`prefers-reduced-motion` 改 250ms setInterval 離散步進;換圈/離開 focus/unmount 皆停並清理。typecheck 乾淨、2090/2090 綠、build PWA30。scrub/play 手感 + BottomNav 上方佈局待裝置驗證。**Phase 5 已實作(commit `e942e13` / merge `d8a9104`;user 選 sonnet、指定「自己真機測」)——已在 develop。** full-dashboard 模式手勢引擎,關 [[B61]]/[[B102]]:純 `edgeAutoscroll.ts`(velocity 函式,B102a)+ `touchDragDelay.advanceOnSecondPointer`(B102b);DashboardCard 拖曳中 rAF edge-autoscroll、二指落下發 synthetic `pointercancel` 中止拖曳(對照 interactjs 源碼驗過)、`.pin-resize-handle` 加 long-press gate + `touch-action:none`→`pan-y` + 44px hit-slop。**B102c 真兇 = 釘選浮動卡的 `.pin-resize-handle`(accent-red 角落把手),非桌面限定的 gutter。** 滑鼠/筆路徑逐位元不變(early-return)、+33 測試、2123/2123 綠、typecheck+build+scoped-css-lint 全綠。**B61 殘留(hold-then-drag)為 best-effort**:mid-gesture 改 `touch-action` 是否即時套用同一觸點依瀏覽器引擎而定,誠實標註於 module doc(B102b 二指中止才是可靠強制的那半)。**裝置測試清單(優先序):①B61 hold~300ms 後立刻甩(touch-action 交接是否真擋住原生捲動,引擎相關);②B102a 拖到頂/底邊 edge-autoscroll 速度手感(16px/frame)+ 卡片能否到達畫面外位置;③B102b 拖曳中第二指落下 → 拖曳明顯中止(卡片不卡在 ghost dragging)且頁面隨新指捲動;④B102c pin-resize 真機:long-press gate 不拖沓、44px hit-slop 好抓又不擋捲動;⑤一般單指拖曳排序 regression。** 驗過後 push develop,再視情況授權發 main。focus order 目前用可見的 mobileOrder,無專屬排序 UI。**（**§8 觸控打磨也已落地 develop `32c4d75`**：稽核新 focus-stack/scrubber 元件的 coarse 44px 觸控目標——只有 `.focus-expand` 展開鈕是真缺口(32→44px),scrubber 播放鈕/thumb/分隔線建成時就已合規;focus 模式隱藏 drag-reorder 提示文案。滑鼠路徑逐位元不變、2123/2123 綠。前述兩個 device-verify follow-up 已消。）
- [x] **F2 v1** 卡片增減下拉選單 — 已合入 develop(merge `b0f1d25`,實作 `f2ba786` + 前綴改名 `3dc5920`)並發版到 main(`c9bc39f`)。UI 視覺/裝置驗證仍待辦;剩餘小尾巴:靜態卡目前無法從 UI 加回(只有「＋新增圖表」按鈕、其餘只能收合/釘選)。後續行動版聚焦堆疊(選單驅動)接續於 [[F1]]。v1 內容:feature-flag 註冊表 `src/config/featureFlags.ts`(`cvtDynamics` 預設關,precedence `window.__flags`→`?ff=`→localStorage→default)、`isVisibleId` 改吃 flag+可見性 store(取代 B98 硬隱藏)、卡片可見性 store `tracklogstudio.cardVisibility.v1`(裝置偏好+`cardDataAvailability` 無資料預設關+使用者明選優先)、依功能分組選單 `CardMenu.vue`(勾選/定位高亮/圖表多實例+刪除+「＋新增圖表/散佈圖」併入、移除原工具列按鈕)、設定頁連點版本號 7 次揭露「開發者選項」列出 flags、**獨立 commit** 把全部 `aracer-loga.*` localStorage 前綴改 `tracklogstudio.*`(零遷移)。typecheck 乾淨、1958/1958 綠、build 成功。⚠️ 前綴改名=破壞性:清掉既有本機資料(版面/設定/懸吊/傳動等),review 時需確認接受。待 review 後合入 develop 再補 hash。目前只有「新增圖表」按鈕、靜態卡無法從 UI 加回(只能收合/釘選)。方向(user 定):不是單層開關清單,而是**依功能分組的面板** —— (a) 每列勾選=顯示/隱藏,點名稱=**定位**(捲動到該卡並高亮);(b) 支援**一個功能對多張卡**(圖表這種可多實例:列出各實例、可各自刪除/定位,底部一個「＋新增圖表」,原按鈕併入此處);(c) 可見性=**裝置偏好**(與檔案無關),但「該卡無對應資料 → 預設關閉」;(d) CVT 動力卡改由**廣域 feature-flag**控制,正式版預設完全不出現、僅開發者於設定頁隱藏的「開發者選項」區開啟(取代 B98 的 `isVisibleId` 硬隱藏;flag 註冊表 `src/config/featureFlags.ts`,`?ff=` 為瀏覽器分頁備援入口,另掛 `window.__flags` console API)。行動版此選單同時驅動 [[F1]] 的聚焦堆疊。localStorage 可見性狀態趁未公開一併乾淨重來(換掉 legacy `aracer-loga.*` 前綴、零遷移碼)。G-G 摩擦圓可作為「預先選好兩個力頻道的散佈卡」預設,供選單一鍵叫出(散佈圖已用 `looksLikeForcePair` 自動 1:1)。
- [x] **F3 (階段1+2 已合入 develop;scale 標定 2026-07-24 完成並已套進程式碼 → 見 [[B106]]、`fix/b106-rcz-single-session`、`docs/specs/RCZ-FORMAT-SPEC.md`。整機備份與單場匯出現共用 `parseRczCore.ts`)** RaceChrono 整機備份 `.rcz` 匯入 — **階段1 已落地**(merge `03ab5e8`,實作 `bbc44c0`):`listRczSessions`/`isRczBackup` + `parseRczBackupSession` + FileBar `pendingRcz` 場次 picker + worker threading;非-OOM 機制 = fflate `unzipSync(data,{filter})`(只 inflate 選中場的條目,`channel_*` blob 絕不整包解壓——已核對 fflate 源碼);GPS 裝置由 sessionfragment `type===1` 自動判定(非硬寫 100),GPS 自身時鐘為 master。**階段2 = CAN/ECU 多裝置解碼已落地**(merge `af170b4`,實作 `896d127`):解碼**全部裝置**而非僅 GPS;master clock 改取**時間戳樣本數最多**的裝置(非 GPS——真檔 CAN 50Hz/248 萬筆 vs GPS 10Hz/3.4 萬筆,若硬用 GPS 當 master 會丟掉約 80% CAN 解析度),其餘裝置以既有 `nearestIndexMap` 對齊(同 `parseRcz` 既有 GPS→ECU 慣例),同分時以 sessionfragment 裝置順序決勝;通道命名全走既有 `decodeRcChannelName`(零硬寫 id/裝置),跨裝置同名以 `<name>_dev<dev>`→`<name>_dev<dev>_<id>` 決定性去重;id 2 解為 `distance`(mm→km);headerInfo 改為 `deviceCount`/`masterDeviceId`/`masterSampleRateHz`/per-device `type`/`channels`/`rateHz` + `undecodedDeviceCount`(有列在 sessionfragment 但無可讀時間戳流、無法時間對齊者);維持非-OOM filter(仍只 inflate 選中場)。合成多裝置 fixture 測試涵蓋 master 選擇(刻意讓非首個裝置最密以證明不是照順序)、最近鄰對齊(手算預期索引)、距離換算、跨裝置命名碰撞、未知 id fallthrough、鄰場資料不外洩。2180 綠。⚠️ **加速度/陀螺儀維持原始 int32、不給單位**——scale factor 仍未驗證,刻意不臆造(寧可誠實原始值,也不要看似合理卻錯誤的 g/deg·s⁻¹);module doc 已標為待辦:須以真備份對照 RaceChrono 自身畫面同時段讀數推導並驗證 scale+offset,並確認 type 2/3/8→accel/gyro/id28-30 的對應是否隨硬體而異。逆向已用真檔驗證:三個 CAN 裝置共用同一時間軸(`_1_1` int64 epoch-ms,Δ≈20ms=**50Hz**,約 248 萬筆/13.8h 場次,對得上 `lengthTime`);資料通道編碼為 **int32(`_<id>_0`)**,非單場路徑預期的 float64 `channel2_*_<id>_3`;channel id 直接走既有 `decodeRcChannelName`/`NAMED_LO`(type2 的 9/10/11=加速度 XYZ、type3 的 12/13/14=陀螺儀 XYZ、type8 的 28/29/30 未在表中→`rc_channel_<id>`);**`_2_1`(id 2)= 累積距離(mm)**,int64、GPS 取樣率,值 0/2794/5378… ≈100km/h 與 GPS 速度吻合,**末值精確等於 session.json `lengthDistance`**(完全驗證)。⚠️ 加速度/陀螺儀 **scale factor 未知**,不得臆造物理單位,須以原始值呈現並標註待標定。原始需求:實測 2.18GB zip / ~11.9GB 解壓 / 22883 檔 / **673 sessions**,巢狀於 `sessions/session_YYYYMMDD_HHMM/`,每場 = `session.json`+`sessionfragment.json`(小 JSON)+ 逐通道二進位。**關鍵:既有 `src/domain/import/rcz/parseRcz.ts` 的二進位解碼在此備份上驗證正確**——原型 decode 實測:int64 10Hz 時間戳對上 session.json `firstTimestamp`;lat/lon int32 pair ÷6,000,000 → 台灣 24.897°N/121.267°E 平滑軌跡;速度 int32 mm/s×0.0036 → 97–109 km/h 合理。故**非「從零逆向未知格式」,而是擴充既有 parser**(格式另有 docs/specs/RCNX-FORMAT-SPEC.md)。落差 4 點:(1) 現 parser regex `^channel…`+讀 root `session.json`,需支援巢狀路徑+逐場 session.json;(2) 裝置角色硬寫 GPS=100/ECU=101,本檔 GPS=**200**(model101/type1)另有 100/101/102(type2/3/8 CAN),需從 sessionfragment.json `devices` 推角色+各自時鐘最近鄰對齊;(3) 673 場需場次 picker(比照既有 `listRcnxSessions` / FileBar `pendingRcnx`);(4) **不可 `unzipSync(全檔)` 會 OOM,需讀 ZIP central directory 只 inflate 選中場 ~30 檔(單場 ~150MB)—— 串流抽取是真正工程重點**。建議分階段:①讀目錄+列場 metadata+picker(低成本證明)→②串流抽單場+泛化裝置角色餵既有解碼→③多 CAN 裝置頻道命名/對齊。短期替代:RaceChrono 直接匯出單場 `.rcnx`/`.vbo`/`.csv`(已支援)。設計待拍板。
- [~] **F4 (phase 1+2 皆已合入 develop;餘 UX 確認 + 真機驗證)** RCNX 場次切換 + 複合區段 — **決策(user, 2026-07-24):兩者都做**。**Phase 1(切換場次)已落地**(merge `1baef83`,實作 `08dff6b`):`fileStore` 加 `rcnxSessions`/`rcnxSessionIndex` + `getOriginalFile`/`replaceSession` + `sessionVersion` 反應性觸發(`sessions` 本身維持非反應式 Map,避免深代理大型 typed array);FileBar 「切換場次」`<select>` 以既有 worker path 重解析保留的 `File`、就地替換記錄並只清該檔失效的 per-lap 狀態(主檔清 `selected`/`manualExcluded`/`offsets`;比較檔走既有 `clearSessionSelection`),沿用 B55 `primarySwapPending` 抑制,**不動全域起終點線/區間/sector 幾何**;2139 綠。小註:`RcnxSessionInfo` 解析前無圈數/距離/最快圈欄位,選項標籤改用 日期/時長/waypoints/hasLapData。已知取捨:重用 `primarySwapPending` 會讓自動區間建議 watcher 跳過緊接的一次(與 `swapPrimarySession` 同款),切換後區間可能短暫顯示為舊值,非阻斷性。**Phase 2(複合區段)已落地**(merge `e237f52`,實作 `bb5642c`):UX = phase 1「切換場次」旁新增「複合區段」按鈕(同樣以 `rcnxSessions.length > 1` 為條件),開**獨立的勾選對話框**(非沿用匯入時的單選對話框),至少勾 2 場;合併結果產生**全新記錄**(經 `fileStore.addMergedSession`,沿用 SessionMerge/T6 既有慣例),**不取代**來源記錄——原場次仍可正常使用與切換。核心為新純模組 `src/domain/analysis/sessionComposite.ts` 的 `buildCompositeSession`;**刻意未建構於 `sessionMerge.ts` 的 `mergeSessions` 之上**——後者是把一場重採樣到另一場既有時間軸,而複合區段是把**不同時段首尾相接**,屬不同問題(已於 JSDoc 說明,非 B1/B17 那種平行實作)。**時間軸**:各段依 `wallClockStart[i] − wallClockStart[0]` 位移(取自 `meta.createdDate`,`parseRcnx` 本就由 `summary_N.txt` 設定),**保留場次間真實時間間隔**(如午休);缺 `createdDate` 時退回零間隔接續。**通道集合不一致**:取聯集、缺者補 NaN(非取交集,已記錄並測試)。**圈計數接縫**:`IR_LapNumber` 以跨段累計位移確保接縫處永不遞減(即 [[B104]] 的教訓);中間無圈的段不動累計值,使後段圈次仍從先前數字接續。⚠️ **已知且已測的副作用**:`detectLapsByChannel` 以「任兩相鄰上升邊界」成圈、沒有「段」的概念,故**每個接縫會多出一個無害的 connector 區間**(時長極大、恰跨越真實間隔)——**不是掉圈**,可由回傳的 `segmentRowCounts` 辨識;要消除就得改 `detectLapsByChannel` 本身或犧牲一個真圈,取捨已於模組 JSDoc 分析記錄。+16 測試(11 domain,含跨接縫 `detectLapsByChannel` 真實復原測試;5 UI),2224 綠。**待使用者確認**:①勾選對話框的 UX 形狀是否符合期待;②接縫 connector 區間要不要在 UI/圈統計主動過濾(目前僅可辨識、不自動濾);③真機驗證 picker 觸控與視覺。現況(`FileBar.vue` `pendingRcnx`/`finishRcnxImport`):`.rcnx` 多場只在**匯入當下**選一場(預設 waypoint 最多),之後要換 = 只能重新匯入;且無複合/合併多區段。缺口二解:(a)**切換**——記住「來源 .rcnx + 選定 sessionIndex」,檔案列給「切換場次」下拉、重解析換場(免重選檔);(b)**複合區段**——跨場併軌可導向既有 SessionMerge(T6)路徑(多場各匯成獨立檔再用比較/合併疊),要「同一畫面併成連續記錄」則需時間軸接續處理。設計待拍板。
- [x] **F5 (整條已移除 `3447cad`;⚠️ 見上方溯源更正:Claude 自起、非使用者要求) 行動版單焦點視圖(曾取代 [[F1]] 聚焦堆疊)** — 手機已回單欄儀表板;`MobileFocusView`/`MobileScrubber`/`useMobileView`/`mobileView`/`horizontalGestureCards`/`mobileSwipeGesture`/`scrollEdgeFade`/`scrubber` + 測試 + 死 i18n 鍵全刪,設計文 F1/F5 一併刪除。內文「決策(user, 2026-07-24)」等字樣為誤記,實為 Claude 自我核准。**以下保留為歷史。Phase 1 曾落地**(merge `a469b3f`,實作 `af132e0`+`d1a68a6`):新 `MobileFocusView.vue`(頂部可水平捲動分頁列,active 沿用 `.xaxis` segmented 視覺語言、coarse 44px;下方單一 `<AnalyzerCardBody>` 填滿;`currentViewId` 失效時退回 `ids[0]`)取代並**刪除** `MobileFocusStack.vue` 與其分隔線;`mobileView.ts` 新增 `currentViewId` + `setCurrentView` + reconcile(失效 id 清為 `''`),`splitWeights` 標記 deprecated(保留欄位相容、不再用於版面);AnalyzerView `showFocusStack`→`showFocusView`、移除 `focusWeightFor`/`onFocusResize`,`MobileScrubber` 維持原樣接在其後(scrubber/play/游標同步零改動);2152 綠。**Phase 2(左右滑切換)已落地**(merge `fdae13e`,實作 `84a769f`):採**逐 view opt-in**——純模組 `src/domain/layout/horizontalGestureCards.ts` 的 `consumesHorizontalDrag(id)` 對 `STATIC_CARD_IDS.map`(TrackMap 平移)與所有 `chart-*`(uPlot 的 B9/B31/B94 拖曳縮放/平移、echarts 的 B46 inside dataZoom,含 G-G)回傳 true → **這些 view 維持只能點分頁**,其餘面板才吃滑動;手勢邏輯純模組 `mobileSwipeGesture.ts`,**重用既有 `chartPointerGesture.ts` 的 `pendingTouchIntent`**(同一套 slop→主導方向判定,非另造一套),slop 10px/釋放門檻 60px 淨水平位移、嚴格 `>`;**僅觸控**(滑鼠/筆拖曳永不切換——分頁列對所有指標裝置同樣可達,限制此加速器不損失功能);`pointercancel`/unmount 皆乾淨重置不誤發。⚠️ **實作中抓到一個真 bug**:`ScatterChart.vue` 的 echarts canvas 自身未宣告 `touch-action`,倚賴祖先維持 `auto` 才能做它自己的觸控拖曳縮放(B46)——若對包裹層一律套 `pan-y`,只要散佈/G-G 成為目前 view 就會**靜默破壞** B46;故 `touch-action` 改為**動態**(僅在目前 view 不吃水平拖曳時才 `pan-y`)。另附分頁自動捲入視野。+28 測試,2208 綠。**裝置測試清單(headless 無法驗真實手勢仲裁,最高風險項)**:①一般面板左右滑可切換、垂直小幅捲動不誤切;②地圖上左右滑只平移不切換;③時序圖拖曳走圖表自身 zoom/pan;④**散佈/G-G 內拖曳 dataZoom 仍正常**(未能無真機驗證的那項);⑤畫面邊緣滑動與 OS 返回手勢是否打架(未特別緩解,不同於 `edgeGesture.ts` 的 8px 死區);⑥首/末分頁再滑為 no-op;⑦連續滑動時分頁列自動捲動保持 active 可見;⑧接滑鼠(DeX)拖曳不切換;⑨滑到一半被中斷不卡住/不誤發。 **Phase 3(打磨)已落地**(merge `98fb277`,實作 `e5e27fe`):**每 view 捲動位置記憶**——`watch(activeId)` 於 pre-flush 時機(DOM 尚未換成新卡片 body)同步存下離開中 view 的 `scrollTop`,`nextTick` 後還原進入 view 的位移,並以**單次** `requestAnimationFrame` 重試處理「首次還原時內容尚未排版完、被夾為 0」的情況(刻意不做輪詢;若使用者已再次切走則放棄);**僅存記憶體不持久化**(綁定當下 DOM 佈局,非 `mode`/`focusOrder` 那種耐久偏好,已於程式碼註明);id 從 `ids` 消失時清除其記錄,換檔案/場次時(以 `ctx.primaryFileId` 偵測)整份清空。已知限制:自帶內部捲動容器的卡片(`CardFillScroll` 系的加速測試/目前數值/Sector)只還原**外層** body 位移,內部捲動位置不動(本輪不逐卡掛鉤)。**分頁列溢出提示**——新純模組 `src/domain/layout/scrollEdgeFade.ts` 的 `computeScrollEdgeFade`(含 epsilon 防次像素閃爍)決定哪一側仍有隱藏內容,由 `.focus-tabs-wrap` 的 `::before`/`::after` 以 `color-mix` 畫出淡出漸層(明暗主題皆正確、無需 dark-mode 覆寫、`pointer-events:none` 不影響 §8 44px 觸控目標、`prefers-reduced-motion` 下不加轉場);於捲動/`ids` 變動/mount/視窗縮放/phase-2 `scrollIntoView` 後重算。**未加圖示集**(超出打磨範圍,分頁標籤沿用既有 i18n 字串)。+42 測試,2246 綠。⚠️ 「單一 view 填滿 + scrubber 貼底」headless 無法 paint,待真機驗證。**決策(user, 2026-07-24):轉「單焦點視圖」**——一次全螢幕一個主視覺(地圖/圖表/圈表/散佈),頂部分頁或左右滑切換,底部**常駐 scrubber+▶**(沿用 F1 的 `MobileScrubber.vue`/`scrubber.ts`/`cursorIdx` 同步,不重寫),共用游標;桌面卡片儀表板完全不動。此舉讓聚焦堆疊的分隔線/拖曳/二指仲裁/選單溢出整類問題消失。**F1 的 `MobileFocusStack.vue`+分隔線(phase 1-2)將被淘汰;scrubber/play(phase 3-4)、gesture-engine(phase 5,僅適用完整模式)沿用。Q4 放大鈕問題隨堆疊移除自然消解。** 設計文:docs/specs/F5-SINGLE-FOCUS-DESIGN.md。動機證據(裝置回饋):具體 device-test 證據:**(Q3)** 面板間分隔線拖不動——根因 `focusStackIds`(AnalyzerView `resolveFocusStackOrder`)把**全部可見卡**塞進堆疊而非精選少數,每 `.focus-panel` 卡在 `min-height:180px`、總高超過視窗→整體捲動、`flex-grow` 權重無空間可表現,拖分隔線變紅但 no-op(桌面模擬亦然);**(Q6)** scrubber 只在聚焦模式渲染、位置在堆疊之後,因堆疊塞滿所有卡被推到最底、未達「常駐底部」效果;**(Q2)** 聚焦模式因此與完整捲動幾乎無異。方向選項(待拍板):(i) 修正現範式——聚焦集真的精選 2–3 卡(分隔線/scrubber 才有意義);或 (ii) 轉向 RaceChrono/TrackAddict 式**單焦點視圖**(一次全螢幕一個主視覺 地圖/圖表/圈表,頂部分頁或左右滑切換,底部常駐 scrubber+▶,共用 `cursorIdx`)——(ii) 可讓分隔線/拖曳/二指仲裁/選單溢出整類問題消失,桌面卡片儀表板不變。**拍板前不宜繼續打磨聚焦堆疊分隔線/拖曳**(恐優化將被取代的範式)。附 **(Q4)** 獨立 UX 小修:focus 面板「放大鈕」(`MobileFocusStack.vue` `.focus-expand` ⤢)emit `expand`→回完整模式,但 ⤢ 直覺是「放大這張卡」、語意衝突,需換圖示/文字或改成真最大化。
- [x] **F6 (階段1–4 全數完成,遷移結束 —— 階段1已併入 develop `8583109`〔merge, commit `a10e680`〕;階段2已併入 develop `c95f9db`〔merge `feat/css-grid-dashboard-stage2`→`7b30ee0`〕;階段3已併入 develop `07151ea`〔merge `feat/css-grid-dashboard-stage3`→`5acff6b`〕;階段4已併入 develop `46e603e`〔merge `feat/css-grid-dashboard-stage4`→`7605354`〕。⚠️ 整條遷移**待使用者真機驗證**) grid-layout-plus → CSS Grid 儀表板渲染器分階段遷移** — **動機**:grid-layout-plus 用 `position:absolute`(+`transform:translate3d`)排版每張卡,`position:sticky` 對絕對定位元素完全無效——這正是「釘選卡片維持可見」功能只能靠 `<Teleport>` 把卡片搬到獨立 sticky 容器來偽造的根本原因,使用者明確拒絕此作法(「不該拉出獨立空間，這無論都無法接受」)。改用 CSS Grid 的 `grid-column`/`grid-row` 明確定位後,卡片回到一般文件流內的 grid item,`position:sticky` 原生可用,釘選即可原地變 sticky,不需搬移。**分階段**:階段1(本條)=唯讀渲染(不含拖曳/縮放/縫隙拖動)+ 釘選改真 sticky,與 grid-layout-plus 舊路徑並存、flag 互斥;階段2=拖曳移植;階段3=縮放+縫隙拖動移植;階段4=拔除舊路徑與 flag。**階段1內容**:新元件 `src/features/analyzer/CssGridGrid.vue`(唯讀,不含拖曳/縮放/縫隙拖動)+ 新純幾何模組 `src/domain/layout/cssGridPlacement.ts`(`itemGridPlacement`:x/y/w/h → `grid-column`/`grid-row` 字串;`gridContainerStyle`:cols/rowHeight/marginX/marginY → 容器 `grid-template-columns`/`grid-auto-rows`/`gap`/`padding`;module doc 內含與 `gridGutter.ts` 既有 `xPx`/`yPx`/`wPx`/`hPx` 像素數學等價性的代數推導——容器 `padding: marginY marginX` + `gap: marginY marginX` 使 CSS Grid 原生軌道尺寸算式與 grid-layout-plus 手算像素完全相同,測試中亦數值驗證多組 containerWidth/cols/margin 組合)。新 feature flag `cssGridDashboard`(`src/config/featureFlags.ts`,預設關閉,雙語 i18n 鍵齊全,依既有 `cvtDynamics` 模式自動出現在設定頁「開發者選項」)。`AnalyzerView.vue` 新增 `cssGridEnabled`/`cssGridDesktopLayout`/`cssGridMobileLayout`/`cssGridActiveLayout` computed,模板以 `v-if="!cssGridEnabled"`/`v-else` 讓兩套渲染器互斥渲染(flag 關閉時舊路徑逐位元不變;開啟時 `#dashboard-pinned-anchor` 與其 `<Teleport>` 完全不渲染,不會雙渲染)。新渲染器重用既有 `DashboardCard`+`AnalyzerCardBody`(非新卡片系統)。**釘選(本階段的核心效益)**:與舊路徑不同,新渲染器**不**把釘選卡從 layout 中濾除——`pinnedIds` 直接傳給 `CssGridGrid`,該卡在自己原本的 grid 格位內加上 `position:sticky;top:0`+z-index+陰影,不需 Teleport、不需獨立容器、不需佔位格;多張同時釘選各自獨立 sticky,捲動時自然「疊」在一起(未做跨卡偏移堆疊計算,任務要求本階段如此即可)。`DashboardCard.vue` 新增 `disablePinResize` prop(預設 `false`,不影響任何既有呼叫端)——新渲染器下隱藏釘選卡自己的浮動角落縮放把手(`pin-resize-handle`),因為拖曳它會產生獨立像素尺寸、與「釘選卡維持格線原尺寸」的階段1目標衝突;新渲染器同時刻意不傳 `aspect-ratio`/`pinned-width-px`/`pinned-height-px`,讓 `DashboardCard` 的 `cardStyle` 對釘選卡不套任何行內尺寸覆蓋,卡片維持格線正常大小。**測試**:純函式 15 則(`cssGridPlacement.test.ts`,含像素等價性數值驗證+手機單欄案例)+ 元件測試 8 則(`CssGridGrid.test.ts`,涵蓋 grid-column/row 放置、容器樣式、手機單欄、釘選卡原地 sticky 且無 Teleport 目標、多重釘選各自獨立)+ `DashboardCard.test.ts` 新增 2 則(`disablePinResize`)+ `featureFlags`/`featureFlagsWindowApi` 既有測試更新以涵蓋新登記的 flag。typecheck 乾淨、**2243/2243 綠**(基準 2218)、lint 0 新增 error/warning、scoped-css `:global()` 禁令測試通過、build 成功 PWA **31** entries(基準 31,未變)、`npm audit --audit-level=high` 0 漏洞。⚠️ **視覺/真機驗證待辦**(headless 無法繪製):新渲染器產生的版面幾何是否與舊渲染器視覺一致、釘選卡片實際 sticky 觀感、多重釘選同時捲動經過時的視覺重疊情形,皆需使用者開啟 `cssGridDashboard` flag 後於瀏覽器實測,再決定是否/何時推進後續階段(見階段2/3各自的驗證待辦)。 **階段4 已完成**:移除 `cssGridDashboard` flag 與整條舊 `GridLayout` 路徑(含 Teleport 釘選錨點、`pinnedSize` 浮動卡像素尺寸與 `.pin-placeholder`),`AnalyzerView` 一律走 `CssGridGrid`;**卸載 `grid-layout-plus` 相依**(連帶不再打包其傳遞相依 `interactjs`),`licenses.ts` 兩筆條目移除、`useDashboardLayout.ts` 的 `Breakpoints` 型別改為本地宣告、`useFlipAnimation` 的 skip-class 改用新渲染器 class(保留舊名相容)。新增守衛測試 `test/lint/noGridLayoutPlus.test.ts`(禁 package.json 相依與 src/ 內真實 import,註解提及不禁)。**測試遷移而非刪除**:`dragMode`/`resizeMode` 判別子消失後改寫既有測試;僅刪除「測試對象已不存在」者——舊 Teleport 釘選尺寸(`aspectRatio`/`pinnedWidthPx`/`pinOrder`/`disablePinResize`/B18/B99/B100/B64 的 `.pin-resize-handle`)與 interactjs 交接/synthetic pointercancel 行為;**長按閘門、二指中止、touch-dragging 等行為在新路徑已有等價測試覆蓋(已逐項核對)**。typecheck 乾淨、**2307 綠**、lint 0、audit 0;**PWA precache 1500→1367 KiB(-133 KiB)**。⚠️ 全程 headless 無法繪製:拖曳/縮放/縫隙/收合/釘選/手機單欄的實際畫面與手感**完全未經視覺驗證**,且**已無舊渲染器可退回**,務必先在瀏覽器逐項確認。

**階段2內容(拖曳排序)**:新純模組 `src/domain/layout/cssGridDrag.ts`——`cssGridDragTarget(origin, dxPx, dyPx, metrics)` 把指標像素位移換算成夾制過的目標格位(`clampDragTarget`:`x∈[0, cols-w]`、`y>=0` 無上限,同舊格線可無限往下長)。**與階段1 handoff 筆記的落差,特此澄清**:該筆記原稱 `gridGutter.ts` 的 `pxDeltaToColUnits`/`pxDeltaToRowUnits`「服務舊渲染器手算像素模型、不可直接沿用」——但階段1自己的代數證明(CSS Grid 用 `padding`+`gap` 重現的軌道尺寸與 grid-layout-plus 手算像素**完全相同**,`cssGridPlacement.test.ts` 已數值驗證)代表這兩個純函式的算式對 CSS Grid 同樣成立,故 `cssGridDrag.ts` 直接重用它們(`import from './gridGutter'`),未重新發明算式,只新增 CSS Grid 特有的「候選格位夾制」邏輯(`gridGutter.ts` 本身只服務兩張相鄰卡的縫隙分割,並無夾制到格線邊界這件事)。新 composable `src/composables/useCssGridDashboardDrag.ts`:自建 ResizeObserver 量測 `CssGridGrid` 自己的容器寬度(舊版 `grid-wrap` 容器在此渲染器啟用時完全不存在 DOM 中,無法沿用 `useGridGutters` 的量測);pointermove 以 `requestAnimationFrame` 節流合併(只在有 pending 座標且尚未排定影格時才 schedule,拖曳結束時強制 flush 一次確保不漏掉最後位置);`previewLayout` 即時預覽 = 候選格位套入 `resolveOverlaps`+`compactLayoutTopLeft`(`packExcluding` 排除釘選卡,同既有寫回路徑的 B112 規則)——**已知簡化**:預覽一律用 `compactLayoutTopLeft`,不像既有寫回路徑那樣在「有卡片收合中」時切換成 `compactVertical`(B52 規則);由於**實際落地的版面一律走下方 `writeBackLayout` 這條正確、有收合感知的路徑**,此簡化只可能讓「拖曳中、且同時有另一張卡收合」這個罕見組合的即時預覽有一瞬間跟落地結果不同,鬆手瞬間會自我修正。`dragOffsetPx` 額外回傳被拖曳卡片「未經格線吸附」的原始像素位移,讓 `CssGridGrid.vue` 疊加一個 `translate()`,呈現「卡片跟著指標走、其餘卡片以離散格位預覽讓位」的效果(`CssGridGrid.vue` 新增 `dragOffsetPx` prop + `.dragging` class,樣式疊在既有 `grid-column`/`grid-row` 之上)。`DashboardCard.vue` 新增 `dragMode="cssGrid"` + `draggable`(用 `withDefaults` 給 `true` 預設——單純 `defineProps<{draggable?:boolean}>()` 會被 Vue 的 boolean prop 型別自動轉型成「省略即 `false`」,這裡特意記錄下來,是實作中踩到、修正過的一個坑)兩個新 prop,`.drag-handle` 的既有 `onDragHandlePointerDown` 在此模式下改分派到全新、自包含的拖曳實作(不再合成 pointerdown 交給 grid-layout-plus 的 interactjs——此渲染器下沒有東西可交):滑鼠/觸控筆立即開始(§8 layer 2),觸控沿用既有 `touchDragDelay.ts` 長按判定純狀態機(獨立追蹤,不與舊路徑共用),長按確立後啟動與舊路徑 B102a 共用寫法的 `requestAnimationFrame` 邊緣自動捲動迴圈;第二指落下時(無論在長按判定期或已進入拖曳中)直接中止(`css-grid-drag-end` payload `{committed:false}`),不需像舊路徑那樣合成 `pointercancel` 去唬弄 interactjs。`AnalyzerView.vue` 把 `activeLayout` setter 原本的整段寫回邏輯抽成獨立函式 `writeBackLayout(next)`,新舊兩條拖曳路徑(舊：`activeLayout` setter/`onLayoutUpdated`;新：`useCssGridDashboardDrag` 的 `onCommit`)共用同一份函式,確保 B52 顯示/持久化高度分離、echo 防迴圈守門、`packExcluding` 排除釘選卡、`mergeMobileOrder` 保護釘選卡手機記憶格位等既有不變量對兩個渲染器一致適用。**手機單欄寫回**:與桌面版共用同一個「候選版面→resolveOverlaps/compactLayoutTopLeft」流程(手機 cols=1,w=1,水平軸恆為 0,退化成單純垂直清單重排),但落地時走 `writeBackLayout` 既有的手機分支——把settled結果依 `(y,x)` 排序取得新順序,`mergeMobileOrder` 合併回 `mobileOrder`,從不寫入沒有意義的 x/y(與舊渲染器手機拖曳排序完全同一套機制)。**測試**:純函式 21 則(`cssGridDrag.test.ts`,涵蓋精確格線邊界/兩側夾制/手機單欄退化/小數位移四捨五入/容器未量測防呆)+ composable 17 則(`useCssGridDashboardDrag.test.ts`,涵蓋 rAF 節流合併、拖曳鎖定/釘選卡不可拖曳、真正的三卡重排〔含代數推導避開「單卡/無阻擋鄰居必被 compactLayoutTopLeft 拉回原點」這個既有純函式的固有特性〕、commit/abort 語意、卸載時清理)+ `DashboardCard.test.ts` 新增 15 則(滑鼠/觸控筆立即開始、`draggable:false` 全擋、`.actions` 區排除、即時 pointermove/up 轉發、真 pointercancel 中止、第二指中止〔pending 期與 armed 期各一則〕、觸控長按門檻未達不啟動、`touch-dragging` 視覺提示、卸載清理)+ `CssGridGrid.test.ts` 新增 3 則(`dragOffsetPx` 套用 translate 且只影響對應卡片、無 `dragOffsetPx` 時零變動、與釘選共存不衝突)。typecheck 乾淨、**2299/2299 綠**(基準 2243)、lint 0 新增 error/warning、scoped-css `:global()` 禁令測試通過、build 成功 PWA **31** entries(基準 31,未變)、`npm audit --audit-level=high` 0 漏洞。⚠️ **拖曳手感真機驗證待辦**(headless 無法有真實指標/繪製):長按判定的實際時間感、邊緣自動捲動速度是否順手、拖曳中卡片跟隨指標的視覺流暢度、放開後其餘卡片讓位動畫的觀感,皆需使用者開啟 `cssGridDashboard` flag 後於真機測試。

**階段3內容(縮放 + 縫隙拖動 + 多重釘選堆疊)**:(a) 縮放——新純模組 `src/domain/layout/cssGridResize.ts`,`cssGridResizeTarget(origin, dxPx, dyPx, metrics, minW, minH, mobile)` 把角落把手的像素位移換算成夾制過的 `w`/`h`(`clampResizeTarget`:`w` 夾在 `[minW, max(minW, cols-x)]`、`h` 只夾下限無上限,同舊格線可無限往下長);同階段2的澄清,`gridGutter.ts` 的 `pxDeltaToColUnits`/`pxDeltaToRowUnits`/`colWidthPx` 對 CSS Grid 同樣成立,直接重用未重新發明算式。**B59 手機單欄僅垂直**這條規則做成函式本身的顯式 `mobile` 參數(而非要求呼叫端記得先把水平位移歸零),使其可直接單元測試。新 composable `src/composables/useCssGridDashboardResize.ts`:自建 ResizeObserver 量測與拖曳 composable 相同的 `CssGridGrid` 容器(同一元素掛兩個獨立 observer,便宜且讓兩個 composable 各自可獨立測試);`previewLayout` **刻意不**即時對其餘卡片做 resolveOverlaps/compaction——縮放中的卡片可視覺上與鄰居重疊,行為對齊 grid-layout-plus 舊角落把手今天的樣子(壓縮/排擠只在鬆手時透過 `writeBackLayout` 一次到位),避免維護第二套即時 reflow 邏輯。`DashboardCard.vue` 新增 `resizeMode="cssGrid"`/`resizable` 兩個 prop + `.css-grid-resize-handle`,觸控長按判定刻意比照**釘選卡自己的 `.pin-resize-handle`(B102c)**而非 drag-handle 的完整手勢引擎——只有長按門檻+pending 期二指取消,沒有 B102a 邊緣自動捲動、沒有 B102b 已啟動後的二指中止(角落縮放是短距手勢,B102c 的簡化版才是合適的參考對象);把手沿用 `--vgl-resizer-size`/`--vgl-resizer-border-color`/`--vgl-resizer-border-width` 這幾個既有在 `.analyzer` 祖先元素上設定的 CSS 自訂屬性,零新增 AnalyzerView 樣式變數。(b) 縫隙拖動——**直接重用既有 `useGridGutters.ts`,一字未改**(該 composable 本就是純 Vue 接線,對哪個渲染器一無所知),在 AnalyzerView 內另建一個獨立實例,`containerRef` 改指向新建的 `cssGridWrapRef`(包住 `<CssGridGrid>`、零額外 padding/border 的 `position:relative` 容器,同舊版 `grid-wrap` 的角色)。**B52 不變量**(縫隙覆蓋層與格線必須吃同一份顯示版面)靠 `cssGridRenderedLayout` 這一個共用 computed 保證——它是拖曳預覽鏈接縮放預覽後的結果(`cssGridDrag.previewLayout` → `useCssGridDashboardResize` 的 `layout` 輸入 → `cssGridResize.previewLayout`),同時餵給 `<CssGridGrid :layout="...">` 本身**與**縫隙偵測(過濾掉釘選卡,見下)——兩者保證讀到完全相同的陣列。縫隙的 `onChange` 直接呼叫共用 `writeBackLayout`(而非仿照舊版縫隙那樣自己手刻一個不做 resolveOverlaps/compaction 的簡化合併——舊版能簡化是因為 grid-layout-plus 自己在 prop 變動後還會內部再跑一次 compaction,CSS Grid 沒有這種自動二次整理,所以這裡改用完整、有收合高度還原的共用路徑更正確也更簡單)。釘選卡從縫隙偵測的輸入陣列中濾除(即使它在 CSS Grid 下仍保有自己的格位)——因為縫隙拖動會同時改動兩側卡片的 `w`/`x`,若其中一側是釘選卡,會讓「釘選卡維持格線原尺寸」這個不變量被打破。(c) 多重釘選堆疊——`CssGridGrid.vue` 新增 `pinStackStyle`:依 `pinnedIds` 陣列索引(= 既有釘選順序慣例,同 AnalyzerView 的 `pinOrderFor`)給每張同時釘選的卡一個小幅遞增的 `top` 偏移(每階 8px)+ z-index(index 0 = 最早釘選者最上層,下限不低於 20、上限不超過拖曳中卡片的 30)。單一釘選卡完全不受影響(`top:0px`,同階段1/2)。**這是刻意保守、不過度工程化的選擇**:headless 環境無法驗證 CSS Grid 子項目的 sticky「包含區塊」在各瀏覽器引擎上是否真的把黏著範圍限制在自己的格位內(若是,原生行為本就不會重疊;若否——曾是部分引擎的已知不一致——這個小幅 top 級距 + z-index 至少能保證最壞情況下仍露出「疊卡」邊緣可辨識,而非兩張卡完全重合看不出釘了兩張)。**測試**:純函式 15 則(`cssGridResize.test.ts`,含格線邊界夾制/手機水平位移完全忽略/退化容器防呆)+ composable 18 則(`useCssGridDashboardResize.test.ts`,涵蓋鎖定/釘選/收合不可縮放、rAF 節流合併、最小尺寸夾制、commit/abort 語意、手機垂直限定、卸載清理)+ `DashboardCard.test.ts` 新增 18 則(把手顯隱條件、滑鼠/觸控筆立即開始、長按門檻、二指取消 pending、touch-dragging 視覺提示、卸載清理)+ `CssGridGrid.test.ts` 新增 4 則(單一釘選 top:0px 不變、多重釘選階梯 top/z-index、依釘選順序而非陣列/DOM 順序)。typecheck 乾淨、**2351/2351 綠**(基準 2299)、lint 0 新增 error/warning、scoped-css `:global()` 禁令測試通過、build 成功 PWA **31** entries(基準 31,未變)、`npm audit --audit-level=high` 0 漏洞。⚠️ **真機驗證待辦**(headless 無法繪製/派發真實指標):縮放手感(尤其觸控長按後的拖曳流暢度)、縫隙把手實際抓取準確度、多重釘選捲動經過時的實際堆疊觀感是否需要調整偏移量/z-index。

**階段4內容(拔除舊路徑,遷移收尾)**:移除 `cssGridDashboard` feature flag 與整條舊 `GridLayout` 路徑(含 Teleport 釘選錨點、`pinnedSize` 與原位佔位框),`AnalyzerView` 一律走 `CssGridGrid`;卸載 `grid-layout-plus` 依賴(連帶不再打包 `interactjs`)、更新 `licenses.ts` 授權清單、`Breakpoints` 型別本地化到 `useDashboardLayout.ts`、FLIP 動畫的 skip-class 換成新渲染器的 class。新增**禁止復入**的守衛測試(避免舊依賴/舊路徑被再度引入)。測試以遷移為主,僅刪除「測試對象已不存在」者,行為覆蓋由新路徑的等價測試接手。成效:precache 1500→1367 KiB;**釘選自此為原地 `sticky`,不再搬移卡片**——即本條最初的動機(使用者拒絕的「獨立空間」偽釘選)已根除。

## User report (B96–B98)
- [x] **B96** CVT 齒輪組多軸齒數「新增一軸」按鈕沒有反應。根因：`CvtReductionEditor.addStage()` 新增的空白列 `{driveTeeth:0, drivenTeeth:0}` 被 `drivetrainStore.ts` 的 M9 P2 sanitizer（`sanitizeReductionStage` 用 `positiveNumberOrNull` 要求 `>0`）當場濾除，按鈕看似無反應。改用 `nonNegativeNumberOrNull` 允許 0 值暫存列（缺失欄位預設為 0），負值/NaN/Infinity/超過 `MAX_TEETH` 仍照舊拒絕（M9 P2 未退化）；`resolveFixedReduction` 本就對非正齒數回傳 NaN，無崩潰風險。獨立驗證 drivetrainStore 62/62、全套 1898/1898 綠、typecheck 乾淨。 — `d2ce850`/merge `5855c7c`
- [x] **B97** 節圓半徑 4 個欄位（前/後盤最小/最大節圓半徑）輸入後焦點離開值會消失。根因：`CvtProfileEditor.patchBounds()` 每次 `@change`(blur) 都重送整個 `{min,max}` 物件，未碰過的欄位預設為 0；`drivetrainStore.sanitizeBounds()` 要求兩者皆 `>0`，單一欄位失焦時整組被判定無效、歸零消失。新增 `resolveRadiusBoundEdge` 區分「blank(0/未填，不牽連整組，轉為 NaN 保留另一欄位)」與「invalid(負值/NaN/Infinity/超過 MAX_RADIUS_MM，仍整組拒絕)」；`max<min` 排序錯誤僅在兩欄位皆為實數時才檢查。M9 P2 未退化(既有 3 個 pinned 測試不變)。獨立驗證 drivetrainStore 64/64、全套 1900/1900 綠、typecheck 乾淨。 — `d3e95f3`/merge `26b6a9d`
- [x] **B98** 發版前暫時隱藏 CVT 動力卡片(功能完整但目前無法實測)。`AnalyzerView.isVisibleId` 加一行 `cvtDynamics → false`,透過既有可見性判斷式(align 面板同款機制)讓卡片在桌面/行動版皆不渲染;元件、domain 運算、測試、i18n、`defaultLayout`/`reconcileLayout` 條目全數保留,重新啟用僅需翻回一行。全套 1900/1900 綠、typecheck 乾淨。後續改由 [[F2]] 卡片增減下拉選單 + feature-flag 控制。 — `f6a3f7d`/merge `df6756f`

## User report — device test (B99–B102)
- [x] **B99** 釘選(浮動)卡片仍可調整**寬度** — 已限制(決定:比照 B59/B64 僅**行動版寬度**鎖定,桌面浮動卡維持自由縮放)。根因:浮動卡自己的像素 resize handle(B18/B18b,`DashboardCard.vue` `onPinResizePointerMove`→`pinnedSize`)是獨立於 B59 格線路徑的程式碼,從未受限。修法:新增 `isMobileWidth()`(`window.innerWidth <= 768`,與 `useDashboardLayout.ts` 的 `MOBILE_BREAKPOINT_PX` 同一常數、與既有 `resetPinnedMiniOutsideMobile`(B64)同慣例,順手收斂成單一來源),行動版時 `onPinResizePointerMove` 把水平 `dx` 歸零(比照 B59 `VERTICAL_ONLY_RESIZE_OPTION` 每次重釘 lastW),`pinnedSize.value.w` 整段手勢維持 pointerdown 當下的滿版寬,只改高度;桌面路徑零變動;`clampPinnedSize`/雙擊重設不受影響;未動 B100/B103 的 collapsed/mini `cardStyle` 分支。行動版 handle cursor 改 `ns-resize`(純 media query,無 `:global()`)。獨立驗證 typecheck 乾淨、1911/1911 綠、build 成功(+4 B99 測試)。**視覺/裝置驗證待辦**。 — `457c250`/merge `594e3ef`
- [x] **B100** 釘選卡片按**收折**後只把內容收起來,卡片外框仍佔用畫面空間;應比照格線卡收折真正縮到最小高度(只剩標題列)。根因:`DashboardCard.vue` 的 `cardStyle` computed 不論 `collapsed` 都把 inline `height`(來自使用者拖曳的 `pinnedSize`)或 `aspect-ratio`(格點比例)強加到浮動卡根元素;inline style 永遠贏過 class 規則,蓋掉本來就正確的 `.pinned.collapsed{height:auto}`。修法:collapsed 時 `pinnedSize` 分支只回 `{width,maxWidth:'none'}`(丟掉高度)、`aspectRatio` 分支回 `undefined`;`pinnedSize.value` 不動,展開即還原使用者拖曳尺寸;寬度保留(只垂直收合);pin-resize handle 本就 `v-if !collapsed` 隱藏不變。獨立驗證 typecheck 乾淨、1904/1904 綠(+9 B100 測試)。**視覺/裝置驗證待辦**(worktree headless 無法 paint,僅 DOM/style 斷言)。附帶發現:行動版 `pinnedMini`(B64)有同款未修 bug——`src/` 無 `.pinned-mini` CSS 規則,mini 也只藏 body 不縮外框;本次 scope 僅 `collapsed`,未動 → 已於 [[B103]] 修復。 — `201a234`
- [x] **B101** 設定頁「操作模式」在「自動」下,右側未像主題/語言/時區(B20)顯示目前**實際生效**狀態(觸控/指標);補上同款「目前:XXX」指示。照 B20 pattern:`SettingsView.vue` 新增 `effectiveInputMode` computed,重用 app 其餘元件共用的 `anyPointerCoarse`(`useInputCapabilities`,非新 heuristic;`inputModePref` 為 auto 時走即時 matchMedia),`inputModePref === 'auto'` 時顯示 `settings.current` + `inputMode.touch/pointer`(無新 i18n 鍵)。獨立驗證 typecheck 乾淨、1904/1904 綠。 — `befd700`
- [x] **B102** (實作早已落地 `e942e13`/merge `d8a9104`;原掛在 [[F1]] 下追蹤,F1 整條移除後重新判定 —— **拖曳手勢引擎在移除聚焦時刻意保留**,因為它服務的是一般手機單欄儀表板,與聚焦無關,故本條的 (a)(b)(c) 皆已實作、仍在線上。⚠️ 待裝置驗證) 重新核驗現況:手機卡片**確實可長按拖曳**(`isItemDraggable = globalDraggable && !pinned`,**無任何手機閘門**,僅受「鎖定布局」影響),(a) 拖曳中 rAF **edge-autoscroll** 已實作(`edgeAutoscroll.ts` 純速度函式),(b) 拖曳中第二指落下發 synthetic `pointercancel` **中止拖曳**(`touchDragDelay.advanceOnSecondPointer`;設計上是「二指中止」而非「同時拖+捲」),(c) 粉紅 gutter grip 誤觸真兇經查為釘選浮動卡的 `.pin-resize-handle`,已加 long-press gate + `touch-action` 切換 + 44px hit-slop,且 B93 已把 grip pill 移除改以色條本身為 affordance。連帶修正:使用手冊原稱手機版「停用拖曳與縮放」與實作不符(實為可長按拖曳、縮放限垂直),雙語已更正。 原始條目: 行動版拖動卡片的手勢問題(B61 延伸):(a)拖動中**無邊緣自動捲動**,無法把卡片移到目前畫面外(頂/底)的位置;(b)拖動中無法用另一根手指捲動畫面;(c)背景的**粉紅色 gutter grip 塊**(B90/B93 split-resize 觸控把手)會被觸控誤觸,使用者不解其用途、且與拖卡片搶手勢。需要:拖動中的 edge-autoscroll、釐清粉紅塊觸控範圍與拖曳把手的優先權。
- [x] **B103** (B64/B100 姊妹修正) 行動版 `pinnedMini`(B64 手機專用精簡切換)按下後只隱藏 body、浮動卡外框仍佔整格 footprint —— 與 B100 收折同款 bug。根因:`DashboardCard.vue` `cardStyle` computed 的 `pinnedSize`/`aspectRatio` 兩分支僅在 `props.collapsed` 時丟高度,`pinnedMini` 走相同的 `v-if="!collapsed && !pinnedMini"` 藏 body 卻仍強加原高度。兩個 guard 改為 `props.collapsed || pinnedMini.value`:`pinnedSize` 分支只保留使用者拖曳寬度(丟像素高度)、`aspectRatio` 分支回 `undefined`,讓 `.pinned` 自身 `height:auto` 縮到只剩標題列;`pinnedSize.value` 不動,取消 mini 即還原拖曳尺寸(比照 collapse/展開)。無需 `.pinned-mini` CSS。獨立驗證(sub-agent)typecheck 乾淨、1907/1907 綠、build 成功。**視覺/裝置驗證待辦**(headless worktree 無法 paint,僅 DOM/style 斷言)。 — `2ff52da`/merge `b02cd18`

## User report (B104) — RCNX 匯入
- [x] **B104**(user:「RCNX 目前的實作好像有問題」;merge `8a54450`/impl `273d062`)RCNX(Qstarz)匯入**每場都掉最後一圈**。用真檔 `LogaExample/142.rcnx`(3 場)確認:官方 sana `lap` 表 8/4/7 圈,`detectLapsByChannel` 卻只得 7/3/6,且 `meta.headerInfo.lapCount` 仍正確顯示 8/4/7 → 「檔頭說 8 圈、只出現 7 圈」的可見矛盾。根因:`parseRcnx.ts` `buildLapNumberChannel` 建的 `IR_LapNumber` counter 每圈**進入**時 +1(N 圈=N 次上升),但 `detectLapsByChannel` 以「相鄰上升之間」成圈需 **N+1 個 boundary**;最後一圈 `finish_wp` 之後的尾巴沿用最後圈值、無收尾上升,最後一圈遂被丟。修法:尾巴段 counter 再 +1(`if lapNo>0 && cursor<rowCount`),給最後一圈收尾 crossing,尾巴成獨立 out-lap plateau(無收尾→不成圈)。真檔驗證恢復 8/8、4/4、7/7,durations 與 sana 官方吻合(如 session 2:51.5/52.1/51.3/156.8/51.6/54.7/50.1)。連帶更正兩個把 bug 行為鎖死的既有測試 + 新增真檔形狀(尾巴)回歸測試。獨立驗證 typecheck 乾淨、2124/2124 綠、build 成功。唯一殘留邊界(非 Qstarz 實務、已註解):最後一圈 finish_wp 剛好落在最後一列(全無尾巴)則仍無法收尾。IMPORT-FORMATS-STATUS 🔧 已補。

## User report — UI/UX 討論輪 (B105)
- [x] **B105** 行動版「面板」(F2 `CardMenu`)下拉選單顯示不完整/被裁切。根因:`.popover` 用 `position:absolute; left:0` 錨在 `.card-menu`,但「面板」按鈕位於 `.layout-tools`(在 `justify-content:space-between` 工具列的**右側**),於窄螢幕從右對齊錨點往右展開,寬度 `min(320px, calc(100vw - 32px))` 使右緣溢出視窗被裁。修法:`@media (max-width:768px)` 下改 `left:auto; right:0` 往左展開(寬度上限本就存在,僅改水平位置);桌面 `left:0` 不變;未用 `:global()`。獨立驗證 typecheck 乾淨、2135 綠、scoped-css-lint 過。 — `6192632`/merge `9ef9bf5`
- 同輪其餘回報已歸入設計項:聚焦堆疊分隔線拖不動 + scrubber 被推到底 + 聚焦模式與完整捲動無異 → 根因與轉向見 [[F5]];卡片「放大」⤢ 鈕語意衝突 → 隨聚焦堆疊移除自然消解(見 [[F5]]);拖曳中二指捲動 → 現行設計為「二指中止拖曳」(B102b),非同時拖+捲。

## Format research — RCZ 單場匯出逆向 (B106)
- [x] **B106** (已修,merge 前分支 `fix/b106-rcz-single-session`:核心重構+A–G `e81eb2c`、驗收測試 `7338703`、distance 去重 `2b60c4e`;2261/2261 綠、typecheck 0、真檔逐點吻合已獨立複驗) RaceChrono **單場匯出** `.rcz` 匯入在「手機內建 GPS + 內建 IMU + RC3」的場次上**整份匯壞**。研究產出:`docs/specs/RCZ-FORMAT-SPEC.md`(2026-07-24,樣本 `LogaExample/session_20260315_1642_極限/` —— 使用者把同一場同時匯出 rcz/v2csv/v3csv/vbo/nmea/gpx,可逐點交叉驗證)。七項缺陷依序:**(A)** `parseRcz.ts` 硬寫 `dev100=GPS/dev101=ECU`,但裝置 id 無固定語意(本樣本 GPS=**300**、100/101/102=內建 acc/gyro/magn、200=RC3),角色須讀根目錄 `sessionfragment.json` 的 `type`(1=gps/2=acc/3=gyro/4=data/8=magn,由 v3 CSV 表頭第 3 行的來源標籤直接對上);現況會拿陀螺儀當 master clock、GPS 全部消失,只剩 Time + 3 條未縮放 acc。`parseRczBackup.ts` 早已是泛用寫法,**兩者應共用同一核心**(單場/備份差別只在檔案前綴與挑場次)。**(B)** GPS altitude 實為 **mm** 不是 m(現行兩個 parser 都直接當公尺輸出 → 311300 m)。**(C)** `INT32_MAX`(2147483647)= **無資料哨兵**,須轉 NaN(本樣本 RC3 IMU、analog13-15、altitude_precision、低速 bearing 皆是;RaceChrono 自家 CSV 在同位置輸出空字串,100% 對得上)。**(D)** `session.json.laps[]`(每圈 epoch-ms 起訖 + `isInvalid`)完全沒用到。**(E)** int32 IMU scale **已標定**(見下)可移除 UNRESOLVED CALIBRATION 警告。**(F)** RC3 analog/digital id 空間 20002=digital1(RPM)/20003-20007=analog1-5/20010=digital2/20011-20020=analog6-15,現行 `decodeRcChannelName` 會退成 `rc_channel_20002`。**(G)** 單場路徑 `headerInfo` 比 backup 路徑少(且本樣本無 `session.title`,只有 `trackName`)。
  **修法落地**:抽出共用核心 `src/domain/import/rcz/parseRczCore.ts`(`buildRczSession`),`parseRcz` 與 `parseRczBackupSession` 皆改為只做「取 ZIP 條目(前綴 `''` vs `sessions/<key>/`)→ 拆 json/channel → 餵核心」;裝置角色一律讀 `sessionfragment.json` 的 `type`(缺檔 fallback:有 channel id 3 者為 GPS);int32 scale 套用(acc `/9806.65`→G、gyro/magn `/1000`、altitude mm→m、DOP `/1000`)、float64 不縮放、`INT32_MAX`→NaN、id 2 距離 mm→km、RC3 20002/20003-20007/20010/20011-20020 → `rc_digital_1`/`rc_analog_1..15`、laps 轉每列 `IR_LapNumber`(0=首圈前)、headerInfo 對齊 backup。真檔複驗:`rc_x_acc[0]=1.27781`(=12531/9806.65)、altitude 302–312 m、全域 0 殘留哨兵、magn µT、digital1 1651–11467 rpm、distance 末值 3.7177 km、RC3 IMU 全 NaN;舊 OBD 樣本 17791 列/149 ch 無回歸。**後續 wart 已一併修**(`2b60c4e`):每裝置都帶 id-2 距離,原本吐 5 條 `distance`/`distance_dev*`,改為只留一條(GPS 優先→master→first)。**未做**:`decodeRcChannelName` 的 5000/5001 bank 規則仍保留(未驗證,見 §9);float64 OBD 通道仍不給單位(沿舊行為)。
- [x] **F3 scale 標定(原 F3 唯一剩項) — 已套進程式碼** int32 通道 = **物理值 × 1000**:加速度原始單位 **mm/s²**(`/9806.65` 得 G)、陀螺儀**毫度/秒**、磁力計 **nT**、altitude/speed/DOP 亦 ×1000、距離 mm。float64 通道則**已是物理量**(舊樣本 OBD:accel 單位是 **G**、gyro deg/s ——★同一個 id 的單位取決於編碼型別,不是 id)。驗證法:以 `.rcz` 每裝置 epoch-ms 時間戳去 `_v3.csv` 找**完全相同**的 timestamp 列逐點比對,GPS 全通道最大誤差 0.000000,acc/gyro/magn/analog 中位誤差 0(殘餘最大誤差全落在 CSV 對該欄做內插的列)。✅ **已於 B106 套進 `parseRczCore.ts` 的 `int32ScaleFor`**(2026-07-24)。
- 一併記錄:`calc` 群組(lean_angle ±45°、lateral/longitudinal/combined acc、calc speed)**不存在於 `.rcz`**,是 RaceChrono 自算的;匯入 rcz 想要傾角就得自己算。`.vbo` 匯出把 47 Hz 內建 IMU 降到 GPS 10 Hz(有損);`.gpx`/`.nmea` 只剩 GPS。`decodeRcChannelName` 的 `5000/5001` analog/digital bank 規則**兩個樣本都對不上、無樣本佐證**,建議降級為 fallback。

## User report — 播放與平滑 (B107–B109)
- [x] **B107** 散佈圖在特定視窗尺寸(1386×949)1:1 模式下**瘋狂放大縮小閃爍**。根因:`GgChart.vue` 的 `new ResizeObserver(()=>resize())`,而 1:1 模式的 `resize()` 會再呼叫 `render()` 重算 `squareGridBox`(由容器尺寸推導)→ 次像素 relayout → 再觸發 observer → 無窮迴圈,該尺寸恰落在不穩定平衡點故永不收斂。修法:抽純函式 `sizeChangedEnoughToApply(lastApplied, measured, 1px)`(尺寸差 <1px 判定為 render 自身的 echo 並略過)+ `scheduleResize()` rAF 合併(比照 TrackMap B30 `scheduleDraw`)+ `lastAppliedSize` 快取(於 `create()` 由 `echarts.init` 尺寸種下);ResizeObserver 與 `window.resize` 統一走同一守護,只有真 ≥1px 變動才 `chart.resize()`+`render()`,unmount 取消 rAF。+6 測試、2104 綠。**已發版 main `4d153a7`**。 — `40e354c`/merge `331c5c9`
- [x] **B108** 播放按鈕移入**賽道地圖卡片**,PC/手機共用(user:「播放按鈕放到賽道地圖卡片好了，讓PC版也可以使用」)。`MapCard.vue` 新增 ▶/⏸ 控制列(卡片正常與 B7 最大化狀態皆顯示),以 rAF + `performance.now()` delta 依記錄自身時間 **1×** 推進**共享游標**(`analyzer.setCursor`/`setCursorAt`),所有卡片沿既有 `cursorIdx` 連動、零新同步機制;播放域 = 選單圈時該圈 sample 區間、否則全 session(沿用已刪除 `scrubber.ts` 的 domain 邏輯,見 `git show d5d7c2e:src/domain/analysis/scrubber.ts`);播到域末停止(不循環)、換圈/換檔/unmount 皆停並清理 rAF。純模組 `src/domain/analysis/playback.ts`(`playbackDomain`/`advanceByTime` 每次由絕對經過時間重算避免 rAF 間隔不均漂移/`interpolateSample`)+ 29 測試。§8 coarse 44px、雙語 i18n。 — `97294b1`/merge `a4d1172`
- [x] **B109** 播放時游標 marker **一格一格跳**(10Hz 取樣=100ms 階梯,user:「不要一個一個跳看起來卡卡」)+ **軌跡線平滑、平滑值可調**(user:「設定可以選擇平滑值，看要忠實呈現還是多平順」;user 拍板**兩者都要**)。**(A) 游標時間內插**:新增**分數游標** `analyzerStore.cursorFrac` + `setCursorAt(idx,frac)`(夾限 0–1),`cursorIdx` 對**其餘所有消費者維持整數語意**、一般 `setCursor()` 一律歸零分數(非播放來源零影響);`TrackMap` 新增選用 `cursorFrac` prop(預設 0),`drawCursorMarker` 改走 `interpolateSample` 在相鄰樣本間線性內插,並**沿用同一個 rAF `scheduleDraw`**(一幀一畫,不因多一個 watch 而重複繪製);`prefers-reduced-motion` 退回 250ms 離散步進(frac 強制 0)。**(B) 軌跡線 Catmull-Rom 平滑**:純模組 `src/domain/analysis/trackSmoothing.ts`,**向心** Catmull-Rom(α=0.5,避免 GPS 點距不均造成尖點/自交),`amount∈[0,1]`;**amount=0 為零成本位元相同直通**(回傳 `Float64Array.subarray()` 視圖,測試以共用 `.buffer` identity 驗證)——即預設「忠實呈現」不改變任何現有外觀;amount>0 映射為每段 `max(2, round(amount*8))` 條弦,單一無斷點 run 輸出上限 `MAX_RUN_OUTPUT_POINTS=20000` 防爆量;**NaN 斷點嚴格保留**(先切成最大 NaN-free run 各自 spline、輸出以單一 NaN 分隔,既有 `drawPlainSegment` 斷線邏輯零改動)。接進 `drawTrackPath`(casing/inner/muted)、`drawOverlayTracks`、`drawComparisonHighlights`;**熱區圖桶、起終點線、sector 閘門、極值標記、游標 marker 皆不平滑**(熱區顏色綁原始樣本索引)。效能:`activeSmoothCache` 以 `(track, overlayTracks, zoom, pan, w, h, n, amount)` 為鍵快取(刻意用 `props.overlayTracks` 而非每次配置新 `[]` 的區域變數,否則單檔常見情境快取永遠失效);游標/播放走**另一張** overlay canvas(`drawInteractionOverlay`,不呼叫 `draw()`),結構上即排除每幀重算 spline。設定:`settingsStore.trackLineSmoothing`(預設 **0**,`Number.isFinite`+夾限 sanitize,隨 B19 匯出匯入),設定頁 range 滑桿(step 0.25、忠實呈現↔平順端點標籤、coarse 44px)。**平滑純屬視覺**:已獨立核驗 hover/scrub 命中測試走 `nearestIndexedSample(sampleIndex,…)`(原始樣本空間索引)、`interpolateSample` 亦讀原始 `px/py`,樣本/圈時/距離/游標對應全不受影響。+41 測試(29 playback + 19 smoothing 及 UI/store),**2165 綠**。⚠️ **待裝置驗證**(headless 無法 paint):①播放鈕位置手感(目前在地圖畫布正上方右對齊一列)②實際滑順度 ③各平滑值視覺與長場次開平滑後平移/縮放的反應速度 ④預設關是否真的與先前逐像素相同。 — `97294b1`+`eca3827`/merge `a4d1172`+`ef575b8`

## User report — 手機格線把手/多重釘選 (B110–B111)
- [x] **B110** 分析頁格線縮放把手(grid-layout-plus `.vgl-item__resizer`)原本用 `@media (max-width: 768px)` 判定 30px 觸控尺寸,違反 §8/B35「不得以螢幕寬度判斷輸入密度」政策——PC 拉窄視窗(滑鼠)也拿到大把手、觸控平板寬度>768px 反而只有 10px。改用既有 `useInputCapabilities.ts` 的 `:root[data-any-pointer-coarse]` 能力訊號,尺寸(30px)與 `touch-action: none` 不變,`:deep(.vgl-layout)`/`:deep(.vgl-item__resizer)` 部分維持。順帶發現 `theme.css` 先前已補了一條 unscoped 全域重複規則(因為 `AnalyzerView.vue` 自己那份還是寬度判斷時的暫時繞道,見 DESIGN.md B35 實作註記),本次修正後該繞道已無必要,一併移除並更新 DESIGN.md 說明。未用 `:global()`(scoped-css-lint 過)。typecheck 乾淨、2187 綠、build+audit 0。⚠️ 手感(把手實際大小/可點性)待裝置驗證。 — `39b3106`(格線把手改 coarse 判定)+`00b5aeb`(移除 theme.css 重複規則)
- [x] **B111** 釘選卡片(手機置頂 sticky)支援**多張同時釘選**(user:「讓釘選卡片可以多釘選，可以多個釘選，這樣在手機UI找到解方之前也算是一個暫時性的解決方案」),原本 `panelState.pinnedId: string | null` 只能單張。`pinnedId` → `pinnedIds: string[]`(依釘選先後排序,index 0 = 最早釘選 = 最上方);`togglePinned` 改為加入/移出清單而非取代;`reconcilePanelState` 過濾失效 id 時保留其餘釘選卡片的相對順序。**持久化遷移**:`parsePanelState` 相容舊版單一 `pinnedId` 字串,自動轉為單元素清單,不會清空既有使用者的釘選;B19 設定匯出匯入(`settingsTransfer.ts`)透過共用的 `parsePanelState` 一併相容舊格式匯入。**高度政策(user 拍板)**:釘選區(`#dashboard-pinned-anchor`)改 flex column 堆疊,**合計**高度上限約 50vh、超出時釘選區自身 `overflow-y: auto` 內捲,取代原本每卡各自 `max-height: 45vh` 的做法(多張釘選時各自 45vh 會合計吃掉整個畫面,不符合「下方內容永遠留一半螢幕」的要求);堆疊順序不依賴 Teleport 的 DOM 插入順序(会跟著格線/掛載順序走,不等於釘選順序),而是各卡依 `pinOrder` prop 轉成 CSS `order` 明確排序。各卡收合/`pinnedMini`/縮放把手行為不變。新增/更新測試涵蓋:舊版 `pinnedId` 遷移、多重釘選加入/移除、`reconcile` 過濾失效 id 保序、B19 匯出匯入新舊格式往返、`pinOrder` 樣式;typecheck 乾淨、2187 綠、build+audit 0、scoped-css-lint 過。雙語手冊(`docs/manual/zh-Hant.md`/`en.md`)與本條目同步更新。⚠️ 視覺結果(把手手感、50vh 上限與內捲觀感、多張同時釘選的實際排版)headless 無法繪製,待裝置驗證。 — `22e7653`/merge `d4c841f`

## User report — 釘選卡片獨立框架/空洞 (B112)
- [x] **B112** 使用者附桌面版與手機版截圖回報(user:「你釘選怎麼會是獨立的框架阿? 不是應該屬於同一頁面的嗎?」):釘選中的卡片在兩種裝置上都(1)在原本格線位置留下一個佔滿卡片大小的虛線空框(📌+「已釘選於頂部」)、(2)桌面版另外置中縮成 560px 窄卡、帶有自己的捲軸,讀起來像獨立浮動小窗而非同一頁面的一部分。**(1) 移除原位空洞**:`AnalyzerView.vue` 的 `desktopVisibleLayout`/`mobileVisibleLayout` 改在**渲染用**版面直接濾除已釘選 id(`isPinned`,與既有 `isVisibleId` 對齊隱藏卡片的做法同一機制),`gutterItems` 因此天然不再需要自己的釘選過濾(移除重複、改為單一過濾點,避免 B52 式格線/縮放把手位置不同步)。**持久化的 `layout`/`mobileOrder` 完全不受影響**,取消釘選後卡片精確回到原位置與尺寸。因為 Teleport 的來源本來就是 GridLayout 的 `#item` slot(釘選卡片被濾除後該 slot 根本不會被建立),`pin-placeholder` 已失去存在意義而整個移除;釘選卡片改在格線**外**新增一段獨立的 `v-for="id in pinnedIds"` + 恆啟用的 `<Teleport>`(釘選機制本身保留、只是搬到專屬區塊——桌面版原本置中縮成 560px 純屬視覺副作用,見下)。副作用:釘選/取消釘選不再是同一個 DOM 節點的 Teleport 搬移,而是格線 `#item` 卸載+專屬區塊掛載(反之亦然),因此 #19 的 FLIP 滑動動畫與 `pinnedSize`/`pinnedMini` 等釘選限定的本地狀態在該次切換不再延續——這兩者都只在釘選當下才有意義,權衡後判斷可接受。**寫回保護(風險最高的部分)**:桌面拖曳/縮放寫回(`activeLayout` setter)會把 `resolveOverlaps`/`compactLayoutTopLeft` 套用在整包**持久化**陣列上,若不處理,某張卡片仍釘選時拖曳其他卡片可能因為「紙面上」仍與釘選卡片的舊 rect 碰撞而被擠開(即使畫面上該格根本沒東西)——新增 `packExcluding(layout, excludeIds, transform)`(`dashboardLayout.ts`)先把釘選 id 抽出、只讓其餘卡片跑幾何運算、算完再原封不動接回去,`mergeLayoutPositions` 既有「陣列中缺席=保持不變」的保證因此不會被幾何運算意外覆寫。手機拖曳排序寫回同理新增 `mergeMobileOrder(base, next)`(`panelState.ts`):原本邏輯把「目前未顯示」的 id(含釘選卡片)整批丟到排序陣列最後,若釘選著 A 時使用者只是把 B、C 互換順序,會連帶把 A 的記憶位置錯誤地推到最尾端;新函式改為原位替換,缺席 id 完全不動索引。**(2) 視覺融入頁面**:桌面版 `.pinned-anchor :deep(.dashboard-card)` 移除 `width: min(560px, 100%)` 置中,改與手機版一致直接 `width: 100%`(與格線內容同寬);`DashboardCard.vue` 的 `.pinned` 陰影(`box-shadow: 0 6px 16px rgba(0,0,0,.18)`)保留——判斷這是「疊在已捲動內容上方」所需的合理辨識度,而非獨立浮動卡片的視覺語言,故意保留、只改了說明文字。**(3) 50vh 上限改僅手機**:`.pinned-anchor` 的 `max-height: 50vh`+`overflow-y: auto`(B111 的手機暫時方案)移進 `@media (max-width: 768px)`,桌面版不再有高度上限、不再出現非必要的內捲軸。順帶修正手冊/i18n 遺留的過期字串:`pin` 提示原本寫「同時僅能釘選一張卡片」(B111 早已支援多張,忘了同步),以及已移除的 `pinnedPlaceholder` i18n key(en/zh-Hant 皆清除)。新增測試:`packExcluding`(含真實 `compactLayoutTopLeft` 場景驗證釘選卡片不會擋到其他卡片復位)、B112 整合情境(渲染版面濾除+持久化保留、取消釘選精確回原位、拖曳寫回不遺失/不重排釘選卡片)、`mergeMobileOrder`(原位替換、缺席 id 不被推到尾端)共 11 項。typecheck 乾淨、**2203/2203 綠**(基準 2192)、lint 0 error、scoped-css-lint 過、build 31 entries、audit 0。⚠️ 視覺結果(桌面/手機是否讀起來像同一頁面、桌面確實無內捲軸、手機仍有 50vh 上限、卡片外觀是否與一般卡片一致)headless 無法繪製,待使用者裝置實測。 — 分支 `fix/pinned-cards-inline-integration`(尚未推送,commit hash 待 push/merge 後補)

## User report — 散佈圖(3D)又閃爍又模糊 (B113)
- [x] **B113** 使用者回報選了 Z 軸(截圖:`GPS_Speed`)的**3D**散佈圖「又開始亂彈,而且又不清楚」——B107 只修了 `GgChart.vue`(2D 路徑)的 ResizeObserver 迴圈,選 Z 軸時走的是完全不同的元件 `Scatter3dChart.vue`(echarts-gl/WebGL),其 `new ResizeObserver(() => chart?.resize(hostSize()))` 從未套用 B107 的防護,同一類 bug 未被涵蓋到——回歸缺口而非同一個 bug 重犯。**共用防護**:純函式 `sizeChangedEnoughToApply` 搬到新模組 `src/domain/analysis/chartResize.ts`(原本内嵌在 `GgChart.vue`,現在 GgChart 與 Scatter3dChart 皆 import 同一份實作,`ggChartResizeLoopGuard.test.ts` 改指向新路徑,只有一份實作)。`Scatter3dChart.vue` 補齊與 GgChart 相同的三件套:`lastAppliedSize` 快取(於 `create()` 由 `echarts.init` 尺寸種下)、`scheduleResize()` rAF 合併、`resize()` 內以 `sizeChangedEnoughToApply` 判斷是否真的需要 `chart.resize()`,unmount 時取消待執行的 rAF。**「不清楚/模糊」調查**:確認 `devicePixelRatio` **不是**原因——兩個元件的 `echarts.init()` 皆未顯式傳入 `devicePixelRatio` opt,zrender(`config.js`)與 echarts-gl 的 `LayerGL`(讀 `zr.painter.dpr`)一致地退回全域 `window.devicePixelRatio`,兩條路徑吃到的 DPR 相同,沒有落差可修。「小圖擠在角落、卡片有雙捲軸」最可能與閃爍**同一根源**:zrender 的 `Painter.resize()`/`echarts.init` 把量到的尺寸寫成 domRoot 的**字面 px 內聯樣式**(非百分比),若掛載當下量到 0 或錯誤尺寸且後續 ResizeObserver 因無防護而卡在迴圈中被瀏覽器判定為 loop 而跳過通知,domRoot 便可能卡在錯誤(過小)尺寸不再更新,產生「卡片版面已撐大但畫面內容仍是小尺寸」的觀感;此為**推論、非螢幕驗證**。另檢查 `.scatter-3d.fill` 缺少 GgChart 對應 `.fill` 規則的 `min-height:0`(只有 `min-height:60px` 底線)——分析後判斷這**不是**成因(flex-grow 分配空間不受 `min-height:auto` 影響,該屬性只限制收縮下限,不限制向上分配),因此**未**動這處 CSS,避免做出無法佐證的臆測性樣式變更。未動 2D 散佈圖行為、`dataZoom`(B46)或 3D 軸/長寬比邏輯(B50/B51)。獨立驗證 typecheck 乾淨、**2203/2203 綠**(與基準相同,守護測試沿用原 6 項、只換了 import 路徑)、lint 0 error(scoped-css-lint 過)、build 成功、audit 0。⚠️ headless 無法繪製/跑 WebGL——迴圈是否真的停止、畫面是否確實填滿且清晰,均待裝置實測;僅 `sizeChangedEnoughToApply` 的判斷邏輯本身有單元測試覆蓋。 — 分支 `fix/scatter3d-resize-loop`(尚未推送,commit hash 待 push/merge 後補)**〔2026-07-31 修正:上面這版沒修好,根因抓錯〕** 使用者用兩張同一張卡片、相隔數秒的截圖回報「持續」亂彈:狀態 A 是 echarts-gl 畫布縮得很小、擠在卡片下方留一大片空白,同時卡片 body **同時出現垂直+水平捲軸**;狀態 B 是畫布填滿卡片、捲軸消失;兩者不斷來回切換。B113 的 `sizeChangedEnoughToApply` 1px 門檻鎖定的是「render() 造成的次像素回聲」這個機制(來自 GgChart/B107,量級 <1px),但這次的證據——捲軸出現/消失,量級是捲軸軌寬(約 15–17px)——是完全不同、量級大得多的機制,1px 門檻對這種變化永遠判定「該套用」,擋不住。**重新查證根因**:讀 `node_modules/zrender/lib/canvas/Painter.js` 確認 `createRoot`/`resize` 會把 zrender 自己的 `domRoot`(整個畫布圖層的容器 `<div>`)以**字面 px 內聯樣式**(`domRoot.style.cssText`/`.width`/`.height`,非百分比)掛在 `echarts.init()` 傳入的容器(也就是 `Scatter3dChart.vue` 的 `.scatter-3d` host 本身,`domRoot` 是它的子節點)底下。這個內聯尺寸只有元件自己呼叫 `resize()` 時才會更新,中間(掛載瞬間、或一連串 ResizeObserver 回呼還在等同一個 rAF 合併時)可能暫時比 `.scatter-3d` 用 flex 版面算出的框大或小。`.scatter-3d` 先前是預設的 `overflow: visible`,兩者之間的 host/host 之上到 `DashboardCard.vue` 的 `.body`(`overflow: auto`)之間也全部沒有任何一層設 `overflow: hidden`——於是這段落差可以一路溢出、撐大 `.body` 的 `scrollHeight`/`scrollWidth`,顯示捲軸;捲軸出現吃掉 `.body` 內容框約 15–17px(雙軸),ResizeObserver 量到「真的」變化(遠超 1px 門檻)因而縮小圖表,捲軸消失、內容框變回原尺寸,ResizeObserver 又量到「變大」,如此反覆——這正是**捲軸自激迴圈**(scrollbar feedback loop),不是次像素回聲,B113 的門檻對此機制完全無效。**真正的修法(移除回饋路徑,而非加大阻尼)**:`.scatter-3d` 新增 `overflow: hidden`——不論 domRoot 內聯尺寸暫時比框大或比框小,溢出一律被裁掉,不會再傳到 `.body` 影響其 scrollHeight/scrollWidth,`.body` 的捲軸從此不可能被這顆圖表觸發,回饋路徑徹底斷開(而非只是加大容忍度)。副作用需一併處理:echarts 預設把 tooltip 的 HTML 節點掛在 `api.getDom()`(即同一個現在會裁切的 host)底下(讀 `TooltipHTMLContent.js` 確認),`.scatter-3d` 一旦裁切,貼近圖表邊緣的 tooltip 會被切掉——因此同時在 `buildOption()` 的 `tooltip` 加上 `appendToBody: true`,讓 tooltip 改掛在 `<body>`,不再是會裁切的子孫。**重新查證 B113 的舊結論**(不可盡信,自行覆核):`.scatter-3d.fill` 的 `min-height: 60px` 是明確數值,不是會觸發「flex 收縮下限＝內容尺寸」經典陷阱的隱式 `min-height: auto`——B113 判斷這不是成因的結論站得住腳,本次**未**更動這行。**未對 `DashboardCard.vue` 的 `.body` 加 `scrollbar-gutter: stable`**:雖然這也能從另一端(讓捲軸出現/消失不再改變內容框寬度)斷開迴圈,但它會讓**所有**卡片(含從不捲動的卡片)永久保留捲軸溝槽空間,是全域可見的版面改動;既然 `.scatter-3d` 的 `overflow: hidden` 已經在源頭完全阻斷這個特定 bug,兩個手法疊加沒有必要,選擇影響面更小的那個(`.body` 本身只加了說明註解,行為不變)。保留 B113 的 1px 門檻 + rAF 合併(對次像素回聲仍然正確、只是不足以擋這次的 bug,兩者是互補的不同機制)。新增測試 `test/units/scatter3dOverflowGuard.test.ts`(靜態核對 `.scatter-3d` 規則含 `overflow: hidden`、`tooltip` 設定含 `appendToBody: true`,2 項,回歸防呆用途,承認 headless 無法跑真實 WebGL/量測捲軸/驗證迴圈實際停止)。獨立驗證:typecheck 乾淨、**2218/2218 綠**(基準 2216)、lint 0 error(既有 4 個警告與本次無關,scoped-css-lint 過)、build 31 entries、audit 0。⚠️ headless 無法繪製/跑 WebGL/量測真實捲軸——迴圈是否真的停止、畫面是否確實填滿清晰、tooltip 邊緣是否正常顯示,均待使用者裝置實測;若迴圈確實停止,預期先前「小/模糊」症狀(domRoot 卡在錯誤尺寸)也會隨之消失,但這是推論而非獨立驗證的另一個結論。 — 分支 `fix/scatter3d-scrollbar-loop`(尚未推送,commit hash 待 push/merge 後補)

## User report — 釘選卡片自行放大/手機超版擠掉內容 (B114)
- [x] **B114** 使用者回報兩個症狀、同一根因(user:「釘選的卡片要維持原本大小，不要自己放大」、「手機板上的卡片釘選後會超過尺寸? 底下全不見」):B112 把桌面版 `.pinned-anchor :deep(.dashboard-card)` 從 `width: min(560px, 100%)` 改成 `width: 100%`,搭配 `DashboardCard.vue` 既有的 `aspect-ratio`(由卡片格線 `w/h` 推導)機制,使釘選卡片變成「整頁寬 × 原比例」而自行放大;手機上更因此輕易撐爆釘選區 `max-height: 50vh` 的上限,把下方內容全部擠出畫面。**修法**:釘選卡片改用它在格線中的**實際像素尺寸**作為預設大小,而非由寬度反推的比例形狀。高度純粹由 `h`(列數)× `GRID_ROW_HEIGHT` + `GRID_MARGIN[1]` 推得(`gridGutter.ts` 既有的 `hPx`),兩個斷點的公式完全相同、不受容器寬度影響(手機釘選卡的 `h` 本來就繼承自桌面版,`mobileLayout` 早已如此設計);寬度則用 `wPx` 搭配**當前斷點**的 `colNum`/`gridMargin[0]`(桌面用卡片自己的 `w`,手機固定視為 `w:1`——手機本來就只有一欄、`marginX:0`,與非釘選卡片在手機單欄下永遠滿版同一套邏輯),數學上桌面 `w<=12` 時必然 `<= 容器寬度`(12 欄滿版都還留格線自己的左右邊界),不需額外夾限。新增純函式 `pinnedCardPixelSize(item, isMobile, metrics)`(`src/domain/layout/gridGutter.ts`),`AnalyzerView.vue` 的 `pinnedGridSizeForItemId` 只是查出 canonical `layout` 條目後轉呼叫的薄包裝;`useGridGutters.ts` 額外導出原本就有量測的 `containerWidthPx`(單一 ResizeObserver 共用,不重複量測)。`DashboardCard.vue` 新增 `pinnedWidthPx`/`pinnedHeightPx` prop,`cardStyle` 計算屬性的優先順序:①使用者手動拖曳的 `pinnedSize`(B18 拖曳把手)最優先、不受影響;②新的 `pinnedWidthPx`/`pinnedHeightPx`(本次新預設,`maxWidth: '100%'` 作為上限安全網、不是強制寬度)次之;③容器尚未量測完成或 id 意外不在 `layout` 中時,才退回舊的 `aspectRatio` 行為(現在純屬邊界情況的保底)。`AnalyzerView.vue` 的 `.pinned-anchor :deep(.dashboard-card)` 也把 `width: 100%` 改為 `max-width: 100%`(inline style 本來就會贏過 class,此變更主要是讓 CSS 意圖與新行為一致)。新增測試:`gridGutter.test.ts` 的 `pinnedCardPixelSize` 純函式(桌面寬度來自卡片自身 w、高度與容器寬度無關、不同形狀卡片尺寸不同、手機寬度等於容器滿版、容器未量測/非法 w-h 回傳 null,共 6 項)+ `DashboardCard.test.ts` 的 `pinnedWidthPx`/`pinnedHeightPx`(套用/優先於 aspectRatio/缺一退回 fallback/非法值忽略/非釘選不套用/使用者拖曳仍優先,共 7 項)。typecheck 乾淨、**2216/2216 綠**(基準 2203)、lint 0 error(既有 4 個警告與本次無關)、scoped-css-lint 過、build 31 entries、audit 0。⚠️ 視覺結果(釘選卡片實際看起來是否等於格線中原尺寸、手機是否不再擠掉下方內容)headless 無法繪製,待使用者裝置實測。 — `fb4b817`/merge `ab8f1b3`

## 設計審查 — Apple 流體介面準則 (B115–B119, M17)
一次以 Apple《Designing Fluid Interfaces》/《Principles of Great Design》準則對全 `src/` 做的設計審查
(觸發:user「審查一次目前專案的設計」)。審查結論:工程紀律高(1:1 拖曳追蹤保留抓取偏移、rAF 合併輸入、
FLIP 從 presentation 值出發、reduced-motion 覆蓋 7 檔、粗指標政策用能力偵測而非視窗寬度),缺口集中在
**設計語言未系統化**與**動效全部是固定時長 CSS transition**兩件事。以下五條為審查產出的可執行條目。

- [x] **B115** 全 app 幾乎沒有「按下」回饋。整個 `src/` 只有 `BottomNav.vue` 一個檔案有 `:active`
  (69 處互動狀態其餘全是 `:hover`,而 hover 在觸控裝置上不存在)——手機使用者按下 FileBar 匯入鈕、
  CardMenu `.menu-toggle`/`.row-name`、rcnx session 選擇鈕、DashboardCard `.icon-btn`(26×26)、
  Settings/Converter 表單按鈕時,從按下到動作完成之間畫面完全無反應,違反「回饋發生在 pointer-down
  而非 release」。同一組問題:`:focus-visible` 也只有 `BottomNav.vue`/`PwaUpdateToast.vue` 兩檔有,
  其餘控制項靠瀏覽器預設 outline,與自訂 accent 焦點環不一致。
  **修法**:`theme.css` 補元素層級基礎樣式(非伸進任何元件 scoped 內部,並遵守本檔案 B35/B110 那條
  「絕不用 `:global()` 包 `:root[...]`」的教訓)——`button` 基礎規則掛
  `transition: transform var(--dur-instant) ease-out` + `-webkit-tap-highlight-color: transparent`,
  `button:not(:disabled):not(.no-press):active` 掛 `transform: scale(0.97)`,整組包在
  `prefers-reduced-motion: no-preference` 內。⚠️ **實作中抓到並修正的坑**:transition 一度寫在
  `:active` 規則**內**,這樣只在按住期間生效,放開瞬間規則不再套用、`transform` 沒有 transition 可依
  而直接跳回,造成「進場有動畫、退場是瞬跳」的不對稱;正解是 `BottomNav.vue` 本來就在用的形狀
  (transition 在基礎規則、transform 在 `:active`),已在程式碼內註解記錄。焦點環用
  `:where(button, a, input, select, textarea, summary, [tabindex]):focus-visible` 把特異度壓到 0,
  元件自己既有的兩份 `:focus-visible` 仍然贏,這裡只補原本無人管的控制項。`.no-press` 逃生艙全庫
  只用到一處(`BottomNav.vue` 的分頁鈕,它自己已有調過手感的 scale 0.94,純粹是特異度衝突需要排除);
  稽核過所有 `<button>`,本庫拖曳/縮放把手一律是 `<div>`,天生不會被這條規則命中。 — merge `dec86d3`
- [x] **B116** `LapTable.vue` 與 `SessionLapComparison.vue` 缺 `font-variant-numeric: tabular-nums`。
  `AccelTestPanel`/`CurrentValuesPanel`/`SectorPanel`/`GearPanel`/`CvtDynamicsCard` 都已有,但**圈速表
  是本 app 最重要的數字表**——比例寬度數字使同位數欄位對不齊、切換圈次時數字左右跳動。
  **修法**:改在共用根 `LapTableView.vue`(依 [[B1]]/[[B17]],比較表本來就重用主表這個元件)加
  `tbody td:not(:first-child) { font-variant-numeric: tabular-nums }`,一處涵蓋兩個呼叫端,
  而不是在兩個檔案各補一次。 — merge `dec86d3`
- [x] **B117** 手勢缺物理:(a) `useCssGridDashboardDrag.onCardDragEnd` 一 commit 就把 `active` 設 null,
  `dragOffsetPx` 立刻變 null → 卡片從手指位置**瞬間跳**到格線位置,剛剛的物理操作在放手瞬間消失;
  (b) `DashboardCard` 的 `.touch-armed` 只換背景色,缺 iOS 拖曳排序那個「拿起來」的 lift;
  (c) 全庫無任何指標速度追蹤(`edgeAutoscrollVelocity` 是捲動速度不是手勢速度)→ `TrackMap` 平移放手
  即停、`UPlotChart` 觸控 pan 同理,而地圖類元件的肌肉記憶預期會滑行;
  (d) `xRangeGesture.clampRange` 與 `TrackMap` 的 `MIN_ZOOM`/`MAX_ZOOM` 到邊界硬夾,讀起來像「當掉了」
  而不是「到底了」,缺 rubber-banding 漸進阻力。
  **修法(分四階段,每階段獨立 commit)**:①`useCssGridDashboardDrag.onCardDragEnd` 改用彈簧從當前
  螢幕位移收斂回 0,**X/Y 兩條獨立彈簧**(單一 2D 距離彈簧在兩軸速度不同時會脫節),放手速度交接
  故拖曳與動畫之間無接縫;`onCommit` 語意完全不變——版面寫回仍只在 pointerup 發生一次,彈簧純視覺、
  不延後也不把關持久化,中止的拖曳(`committed:false`)同樣彈回而非瞬跳(`7c36795`)。②`DashboardCard`
  的 `.touch-armed` 由「只換背景色」加上 iOS 式 lift(scale + 抬高陰影),不動既有
  `touch-action: pan-y → none` 交接與 `touchDragDelay.ts` 長按狀態機(`d80b9a8`)。③`TrackMap`/
  `UPlotChart` 放手保留平移慣性,`TrackMap` 走**既有的平移夾制路徑**故不可能逸出邊界、`UPlotChart`
  走既有 `xRange` owner(`analyzerStore`)不另開第二條設定尺度的路(`f63c1ad`)。④邊界橡皮筋阻力,
  以**新命名匯出**加進 `xRangeGesture.ts`,[[B68]] 既有的 `clampCentreNeedleRange` 家族語意一字未改
  (`24479f6`)。
  **重用而非重造**:直接 import [[B118]] 落地的 `sheetPhysics.ts` 的 `project()`/`rubberBand()`/
  `pushSample()`,並**原地加性泛化**(`PointerSample` 增選用 `x`、新增 `estimateVelocity2DPxPerSec`
  與 `momentumOffsetAt`),既有匯出行為零變動。新增 `src/domain/interaction/spring.ts`——semi-implicit
  (symplectic) Euler,以 Apple 式 `(dampingRatio, responseSec)` 參數化而非 stiffness/damping/mass;
  `SPRING_DRAG_RELEASE = {0.8, 0.3s}`(帶動量的手勢才配 overshoot)、`SPRING_DEFAULT = {1.0, 0.3s}`
  (臨界阻尼,無動量的程式化 snap 用);`SPRING_MAX_DT_SEC = 1/30` 夾制單步,避免分頁背景化/掉幀
  交回過大 dt 導致顯式積分器發散;`isSpringSettled` 同時檢查位置與速度,否則欠阻尼彈簧第一次穿越
  目標時就會被誤判為靜止而凍在 overshoot 中途。**全部可中斷**:新手勢落下即取消進行中的彈簧/滑行,
  並從當前螢幕位置接手(stage 1 以殘餘位移平移 `startX/startY`,首幀即連續)。reduced-motion 全覆蓋,
  沿用既有 `prefersReducedMotion()`。主線實測:typecheck 乾淨、**2416/2416 綠**(基準 2353 + 63)、
  lint 0 error、build 31 entries、audit 0;8 個受影響測試檔 `git diff --numstat` 全為
  **0 deletions**,確認未竄改任何既有斷言。
  ⚠️ **已知缺口(刻意不做完,非疏漏)**:`TrackMap` 的 `MIN_ZOOM`/`MAX_ZOOM` 只落地純函式
  `rubberBandZoomValue` 與其測試,**未接進 `zoomAbout`**——滾輪縮放每一格是原子操作、沒有自然的
  「放手」時機可觸發回彈,需要另行設計 debounce,硬接會是半成品。`TrackMap` 自身的平移邊界、軸帶
  平移([[B70]]/[[B94]])、滑鼠 Shift 拖曳與雙指縮放亦維持既有硬夾;本次只有 `UPlotChart` 一般模式
  觸控平移接上橡皮筋。 — merge `6e1f849`
- [x] **B118** 浮層行為不一致且缺空間連續性:(a) `CardMenu` 的 `.popover` 直接 `v-if` 出現/消失,無進出
  動畫、`transform-origin` 未錨定觸發按鈕;手機版 `@media (max-width:768px)` 已經把它變成 `position:
  fixed` 貼底的 bottom sheet 形狀,卻沒有 sheet 的任何行為(不從底部滑入、不能下拉關閉);
  (b) `FileBar` 三個 `role="dialog" aria-modal="true"` 的 rcnx 選擇器有 scrim 卻**沒有 Escape 關閉、
  沒有焦點陷阱、沒有進出動畫**,而同一個 app 裡 `CardMenu` 有 Escape——看起來一樣的東西行為不一樣,
  且 aria 宣告與實際行為不符。
  **修法**:新增純模組 `src/domain/interaction/sheetPhysics.ts`(`project()` 用 Apple《Designing Fluid
  Interfaces》的指數衰減離散閉式 `(v/1000)·d/(1−d)`,**不是**教科書的 `v²/2a`;`rubberBand()` 為
  WebKit over-scroll 公式,漸近趨近 sheet 高度而非硬停;另有 `dragTranslateY`/`pushSample`/
  `estimateVelocityPxPerSec`/`shouldDismissSheet`/`parseTranslateY`)與 `focusTrap.ts`,共用 composable
  `useOverlayMotion.ts`(進出編排:prime-hidden → 強制 reflow → release → transitionend-or-timeout,
  同 `useFlipAnimation` 既有的手法)與 `useModalDialog.ts`(Escape/焦點陷阱/焦點歸還,三個 dialog 共用
  一份、不複製三次;不擁有開關狀態,只吃呼叫端的 `open` 與既有 cancel handler,確保 cancel 語意
  完全不變)。CardMenu 桌面版 `transform-origin: top left` 靜態即正確(popover 本來就 `top`/`left`
  貼齊按鈕,不需 JS 量測);手機版拖曳關閉限制在新的 `.sheet-grab` 抓握區,避免與 `.popover-scroll`
  自己的 `overflow-y: auto` 打架;中斷支援靠解析當前 computed `translateY` 凍結後接手。FileBar 三個
  dialog 的 scrim-click 取消**本來就有**(`@click.self`),未改動。 — merge `e3e8c49`
- [x] **B119** 深色模式下陰影實質失效 + 材質層只做了一處。全庫 10 種 `box-shadow` 全部硬寫
  `rgba(0,0,0,α)`,`rgba(0,0,0,0.18)` 疊在深色 `--color-surface: #181b21` 上幾乎看不見 → 暗色主題的
  層級感塌掉。另:`backdrop-filter` 只有 `BottomNav` 一處(且做得正確:88% surface + blur 14 + saturate
  150% + 亮上緣),topbar/tabs/FileBar 都是不透明實色橫條;且全庫 0 處 `prefers-reduced-transparency`
  與 `prefers-contrast`,半透明材質要往外鋪之前必須先補這兩個分支,否則是可及性倒退。
  **修法(陰影部分併入 [[M17]] 的 token 系統)**:三階 `--shadow-1/2/3` + `--shadow-nav`,深色兩個
  分支(`prefers-color-scheme` 與顯式 `[data-theme='dark']`)各自覆寫,深色版額外疊
  `0 0 0 1px rgba(255,255,255,α)` 的極淡白色描邊——純黑陰影在深色 surface 上做不到分離,這圈
  「材質在暗處自己反光」的亮邊可以。`prefers-reduced-transparency: reduce` 放在 `BottomNav.vue`
  自己的 scoped 區塊(全庫唯一使用 `backdrop-filter` 的就是它,屬它自己的職責),命中時退回不透明
  實色列。`prefers-contrast: more` 在 `theme.css` 補三分支(鏡射色彩 token 本身的結構),只拉
  `--color-border` 與 `--color-text-muted` 這兩個本來就刻意低對比的 token。⚠️ **實作中抓到並修正
  的數值問題**:淺色 border 初版 `#8b92a0` 對 `--color-bg` 只有 2.94:1,低於 WCAG 非文字 UI 元件的
  3:1 門檻——在一個專為提高對比而存在的分支裡沒達標說不過去,改為 `#828a99`(對 bg 3.27:1、對
  surface 3.47:1)。深色組(3.96:1 / 3.61:1)本來就合格未動。**本批刻意不新增任何半透明材質**
  (topbar/FileBar 的毛玻璃處理不在範圍內)。 — merge `dec86d3`
- [x] **M17** 設計 token 未系統化。`theme.css` 只有 7 個顏色 token + `--radius` + `--space`,其餘全部硬寫:
  **字級** 216 處 `font-size`、**23 種不同值**(0.85/0.8/0.9/0.78/0.82/0.75/0.72/0.7/0.68/0.65/0.64/0.62rem…),
  `.85rem` 與 `0.85rem` 兩種寫法混用,0.62rem≈9.9px 實質不可讀,另有 2 處硬像素破壞 Dynamic Type
  (`CvtDynamicsCard` 的 `.cvt-svg text`、`TrackMap` 的 `.osm-attribution`);**陰影** 10 種值(見 [[B119]]);
  **動效** `cubic-bezier(0.22,1,0.36,1)` 在 `App.vue` 與 `flip.ts` 各寫一份字串常數,時長有
  0.1/0.12/0.15/0.25/0.32/0.4/1s 無規則。**排版基準**亦缺:`body` 沒有全域 `line-height`(theme.css 的
  1.35 是掛在 `.app-tooltip` 上),全庫只有 1 處 `letter-spacing`,而 tracking 本應隨字級變化
  (大標收緊、密集小字略放)。
  **修法**:9 階字級 `--text-2xs`(0.65rem)…`--text-3xl`(1.4rem),遷移後 `src/` 內字面 `font-size`
  **歸零**(含原本兩處 10px 硬像素——實測 SVG text 在該處用 rem 幾何一致,所以是修掉而非豁免);
  合併誤差最大 0.05rem(≈0.8px),刻意保守,這是「把既有視覺尺寸收斂進系統」而非重新設計字級。
  另加 `--leading-*`/`--tracking-*`(`body` 補上全域 `line-height`,tracking 只套在大標與密集小字
  兩端、中段本文維持 0——**不是**全域套一個值,那正是準則點名的反模式)、`--shadow-*`(見 [[B119]])、
  `--ease-standard` 與 `--dur-instant/fast/base/slow`。`flip.ts` 的 `PIN_FLIP_DURATION_MS`/
  `PIN_FLIP_EASING` 維持 TS 為真實來源(JS 讀不到 CSS custom property 的數值語意),兩邊各自宣告、
  由新增的 `test/lint/designTokens.test.ts` **import 該常數與 theme.css 逐字比對**,漂移即紅燈;
  同測試另外守住「`font-size` 必須用 `var(--text-*)`」與「elevation `box-shadow` 必須用
  `var(--shadow-*)`」(ring/marker 類陰影逐檔案 allowlist 並註明理由)。保留 bespoke 值的例外:
  兩個 `@keyframes` 脈衝(1s locate-pulse、400ms value-pulse)無合適 token、GgChart 的 echarts
  tooltip 陰影是 `<script>` 內的 JS 防禦性 fallback 字串(天生不在 CSS 掃描範圍)。 — merge `dec86d3`

## User report — .rcz → .vbo 匯出欄位映射失準 (B120–B127, F7)
> 實測樣本 `session_20250817_1621_lihpao_full.rcz`(LihPao Full,7 圈,5 個裝置:100 accel /
> 101 gyro / 102 magn / 200 GPS / 300 RC3 資料裝置 model 404)。匯出 **49 欄**(7 標準 GPS +
> 42 頻道),**欄位數本身正確、沒有遺漏**:原始 45 個 channel 檔 − 4 份重複的 `distance`
> + `IR_LapNumber` = 42。問題全部在**命名、單位、槽位分配**。根因:`domain/export/vbo/`
> 這套映射是為 `.loga`(aRacer ECU 文字欄名)設計的,而 `.rcz` 內**只有數字 channel id、
> 沒有任何文字標籤**(`sessionfragment.json` 實測只有 device id/model/type),頻道名是
> importer 依 id 造出來的 `rc_*`(見 docs/specs/RCZ-FORMAT-SPEC.md §5.3)——兩邊語彙直接撞號。

- [x] **B120** 已經是合法 RaceChrono 識別符的頻道被 Allocator 重新編號,和來源撞名。實測:
  來源 `rc_analog_5`(電瓶電壓,值域 0.5–14.7)在 `_rc.vbo` 變成 `rc_analog_18`;來源
  `rc_analog_15` 變成 `rc_digital_2`;來源 `rc_digital_2` 反過來變成 `rc_analog_27`;
  `rc_x/y/z_acc`、`rc_*_rate_of_rotation`、`rc_*_magn` 本身就是官方識別符,卻被丟進
  `rc_analog_1..9`。修法:`buildVboCatalog` 在查 `SEMANTIC` 之前先判斷「名稱已是合法 `rc_`
  識別符」→ identity 直通,並把這些已占用的槽位登記進 `Allocator`,避免後續 generic 配號撞號。
  識別符集合抽到共用模組 `domain/raceChrono/identifiers.ts`,匯入(`decodeRcChannelName`)與
  匯出雙邊共用同一份表,不再各自硬寫。新增測試證明 5 個 generic 頻道排在 `rc_analog_5` 之前
  仍不會撞號。 — `23c75f5`
- [x] **B121** RC3 `digital1` 的固定語意(RPM)沒被識別。RaceChrono `$RC3` 句子的 d1 槽位是
  **固定的 RPM**(本 repo 自家的 `Rc3NmeaExporter.ts` 也是硬填 `RPM`;`mapping.ts` 註明可由
  使用者指派的只有 d2 + a1..a15),RCZ-FORMAT-SPEC §5.3 亦記 id 20002 = digital1「RaceChrono
  顯示為 RPM」。本檔實測 `rc_digital_1` 值域 0–10337、怠速 1732–1925,確為引擎轉速,卻因為
  「值不只有 0/1」被歸進 `rc_analog_28`、單位 `raw`。修法:`rc_digital_1` → `rc_rpm`(單位 rpm)。
  `rc_digital_2` 是使用者自訂槽(本檔實測 0–100 且值呈 n/255×100 的離散階,實質是節氣門開度 %),
  **不得**硬編語意,但也不該被判成 bool——現況為 identity 直通、非 bool。真檔複驗:
  `rc_digital_1` 首筆 1833 rpm。 — `23c75f5`
- [x] **B122** 標準 VBO GPS 欄位沒接上來源資料。`sats` 欄永遠寫死 `012`(實際 `Satellites`
  首筆為 5)、`height` 欄永遠 `+00000.00`(實際 `GPS_Altitude` 首筆 201.5 m)→ Circuit Tools
  的高度圖是平的、衛星數是假的;真值反而被塞進 `rc_analog_11` / `rc_analog_16`。另
  `GPS_Lat`/`GPS_Lon` 已經填進 `lat`/`long` 標準欄,卻因不在 `GPS_CONSUMED` 名單而又各自
  重複輸出一欄。修法:`GPS_Altitude`→`height`、`Satellites`→`sats`(來源缺這兩者時才退回
  現行常數),`GPS_Lat`/`GPS_Lon` 併入 `GPS_CONSUMED`。**`heading` 維持現行由 lat/lon 重算的
  平滑航向**(與 `.loga`/`.nmea` 路徑一致、已平滑),來源的 `GPS_Course` 保留為一般頻道,不互相取代。
  `GPS_Altitude`/`Satellites` 刻意**不**併入共用 `GPS_CONSUMED`(會連帶讓通用 `.csv` 匯出器
  漏掉這兩欄,CSV 沒有對應標準欄位可接),改開一個僅 VBO 用的 `VBO_ONLY_CONSUMED`。真檔複驗:
  `sats`=005、`height`=+00201.50。 — `a6fc0ff`
- [x] **B123** 單位被洗成 `raw`/`bool`。importer 已經標好 G / deg/s / µT / km / ° / DOP,
  `buildVboCatalog` 對所有非 `SEMANTIC` 頻道一律覆寫成 `raw`(類比)或 `bool`(數位),
  資訊平白丟掉,`[channel units]` 整段幾乎沒有意義。修法:generic bucket 保留來源
  `channel.unit`,真的沒有單位時才落 `raw`。`.loga` 路徑不受影響(該路徑頻道本就沒有
  `channel.unit`,golden fixture 位元不變)。 — `4c3ee7c`
- [x] **B124** 整條無資料的頻道仍被輸出成一整欄 0。本檔 dev300 的 IMU 六條
  (`rc_x/y/z_acc_dev300`、`rc_x/y/z_rate_of_rotation_dev300`)與 `rc_analog_13/14/15` 在
  `.rcz` 內整條是 `INT32_MAX` 哨兵(= 無資料,見 RCZ-FORMAT-SPEC §5.3),importer 正確轉成
  NaN,但匯出的 `cell()` 把 NaN 一律當 0 → **9 個垃圾欄位**,還讓「無資料」在 Circuit Tools
  裡看起來像真實的 0。修法:整條皆 NaN 的頻道不輸出,並在 `_channels.csv` 列一行
  「已略過(整條無資料)」;其餘零星 NaN 維持現行填 0(VBO 沒有空值表示法)。空值檢查改讀原始
  `Float32Array`(不是先過 `cell()` 的 NaN→0 視圖)。真檔複驗發現**第 10 個**全無資料頻道
  `GPS_AltitudePrecision`(本檔整條也是 `INT32_MAX`)——連帶解釋了 [[B125]] 描述的 (b) 案例
  實際上就是本條(全 NaN 被 `cell()` 灌成常數 0 才誤判 digital),而非「真實 DOP 數值恰好落在
  {0,1}」;修完後此頻道由本條直接略過,根本不會走到 [[B125]] 的判定。 — `a1c9f5c`
- [x] **B125** 數位/類比判定規則過脆。現行規則是「所有值都是 0 或 1 就算 digital」,於是
  (a) 被 [[B124]] 填成全 0 的無資料頻道被判成 digital(`rc_z_rate_of_rotation_dev300` →
  `rc_digital_3`),(b) `GPS_AltitudePrecision` 這種 DOP 浮點只因本檔剛好落在 {0,1} 就被標
  `bool`,(c) 真正的數位槽(RPM)反而被判成類比。修法:先扣掉 B124 的全無資料頻道,再讓
  「來源已有 `unit`」優先於「值域猜測」——`unit` 非空的頻道永遠不算 digital(這部分是真正解決
  (b) 的關鍵)。**值域規則本身維持歷史語意「每個有限值都是 0 或 1」,不要求同時出現 0 與 1**:
  第一版曾改成「必須同時出現真正的 0 與真正的 1」以求自動排除常數頻道,但這條規則分不清「整場
  都沒觸發過的真實數位旗標」(如 `Malf8.Malf_On`、`Pit_SW_On`——確實是數位訊號,只是這趟記錄
  剛好全程沒觸發)跟「值剛好恆為 0 的類比頻道」,結果讓 `.loga` golden fixture 裡 108 個頻道從
  digital 誤判成 analog(其中真的是數位旗標的也一起遭殃),卻對 `.rcz` 沒有實益——真檔裡促成
  B125 的全部頻道(`rc_*_dev300`×6、`rc_analog_13/14/15`、`GPS_AltitudePrecision`)整條皆為
  `INT32_MAX`,早被 [[B124]] 攔掉,從未走到這個判定式;倖存頻道(`GPS_FixType` {1,2}、
  `GPS_CoordinatePrecision` 1.8–2.4、`distance` 連續值、`IR_LapNumber` 0–8)沒有一個落在
  {0,1},新舊規則判定結果完全相同。已改回歷史語意(NaN 略過、不當 0)。殘留限制見 [[B127]]。
  — `a1c9f5c`(初版)/`789d1b9`(訂正 `looksDigital()` 為歷史語意、fixture 復原、測試改寫)
- [x] **B126** `.vbo` 的 `time` 欄比實際樣本早 6.5 秒。`.rcz` 沒有 `GPS_UTC_*` 頻道,匯出器
  因此退回「`meta.createdDate` 的時分秒 + 相對 `Time`」;而 RCZ importer 的 `createdDate` 取
  `session.json` 的 `timeCreated`(本檔 08:21:05.518 UTC),第一筆樣本卻在 `firstTimestamp`
  08:21:12.023 UTC → 整份 `.vbo` 的絕對時鐘偏移 6.5 秒。相對時間正確(圈速不受影響),但與
  影片、或與 RaceChrono 自家匯出對時就會錯。修法:RCZ importer 把「第一筆主時鐘樣本的 epoch」
  帶出來(`headerInfo` 或 meta 新欄位),VBO 匯出器優先採用它;`createdDate` 的顯示語意不變。
  採用型別化欄位 `LogMeta.firstSampleEpochMs`(而非塞進 `headerInfo` 字串)——選它是因為匯出器
  要的是真正的 epoch number 可直接 `new Date()`,不是還要再解析回數字的字串,且是純新增的
  optional 欄位,其餘 9 個 importer 的既有 `LogMeta` 建構語法完全不用動。真檔複驗:首筆
  `time`=162112.xxx(非改前的 162105.xxx)。 — `d3b15a6`
- [ ] **B127** [[B125]] 的殘留限制:值域啟發式規則分辨不出「整場都沒觸發過的真實數位旗標」跟
  「值剛好恆為某個常數的類比頻道」。`.loga` 裡整趟記錄都停在 0 的 ECU 旗標(如
  `IR_LapNumber`/`IR_LapTime`/`SimRPM`/`MapNum` 這類本質是類比、但剛好也全程恆 0/某常數的頻道)
  跟真正未觸發的數位旗標一樣,都會落進數位槽——單靠值域完全無法區分。正確修法需要**頻道名稱/
  說明文字**當佐證(例如名稱含 `_SW`/`Malf`/`_Act`/`_En` 等慣例字樣 vs. 純數值型頻道),但這條
  規則需要涵蓋所有既有 ECU 命名慣例、有誤判風險,屬於待拍板的設計決策,**本批刻意不實作**。
  背景:[[B125]] 第一版曾嘗試改用純值域規則(要求同時出現 0 與 1)來繞開這個問題,結果誤傷了
  `.loga` golden fixture 裡 108 個頻道(含真的數位旗標),已還原為歷史語意並記錄在案。
  **決策素材已備(2026-08-21,實驗分支 `experiment/b127-candidates`,不 merge)**:四個名稱規則
  候選(V1 允許清單/V2 tiebreak/V3 拒絕清單/V4 三條件複合)各對 7 個樣本(5 個 .loga fixture +
  2 個真 .rcz,共 1095 頻道)實測。四者皆可修正點名的 4 個誤判;V4(恆常數 ∧ 名字像數值 ∧
  名字不像布林才降級)**零誤殺**、真 .rcz 零影響,V3 看似改動最小(10 頻道)卻誤殺 13 個真旗標。
  結構性事實:`rc_digital_*` 僅 63 格、.loga 動輒 94–209 個 digital → 數位桶**永遠溢位**,digital
  數量一動 generic 槽位就大規模重編(69–106/119),「挑最小改動」不成立——真正選項是
  **V0 完全不改(wontfix)vs V4 一次到位**,待 user 拍板(另見 [[B128]] 槽位不穩定性)。
- [ ] **B128**(2026-08-21 開單;源自 [[B127]] 決策素材實測的結構性發現 + 2026-08-17 handoff
  未開單小瑕疵)`_rc` flavour 的 generic 槽號**跨場次不穩定**:配號依「哪些頻道有資料」而浮動
  (例:`GPS_CoordinatePrecision` 拿到 `rc_analog_13` 只因來源自己的 analog 13 恰好沒資料),且
  `rc_digital_*` 僅 63 格、.loga 常態 94–209 個 digital,溢位進 `rc_analog_*` 的量隨場次而變,
  同一頻道在不同場次可能拿到不同槽號。這是 Allocator 的既有設計(B120 之前就如此),不是
  B120–B126 造成;影響的是跨場次比對 `_rc.vbo` 欄名的使用情境。可能修法:穩定排序鍵(按頻道
  名 hash 而非出現順序)或每頻道固定配號表——**皆屬行為變更,會動 golden fixture,待 user
  決定要不要修**;若 [[B127]] 拍板 V4,建議同一批處理(反正 fixture 要重生)。
- [ ] **F7**(design-first,**本批不實作、待拍板**)RC3 Analog 自訂命名表。`.rcz` 內沒有任何
  頻道文字標籤,Analog 1–15 的語意只存在使用者的 RaceChrono / ECU 設定裡,程式無從得知——
  這是 [[B120]]–[[B125]] 修完之後**剩下的唯一**「名字看不懂」來源。需要一個可存成 preset、
  隨裝置記憶的對應表,讓匯入顯示與匯出欄名都用真名。本檔實測值域可供對照:a1 0–118、
  a2 0–255、a3 −53…61、a4 0–99.84(0.78 階)、a5 0.5–14.7、a6 64–98、a7 37–54、a8 恆 9、
  a9 恆 251、a10 17–100、a11 0–255、a12 8/9、a13–15 無資料;d1 = RPM(固定)、d2 0–100
  (n/255×100 階,疑似 TPS)。UX 待拍板。

## 圈次偵測 — M4 截圖作業順帶發現 (B129–B131)
> 這三條是 2026-08-21 做 [[M4]] 截圖手冊時,agent 為了讓示範記錄跑出完整圈而反覆調參,從行為
> 反推出來的。**B129/B130 我已讀碼確認屬實**(證據見各條),但**都還沒寫復現測試**,實際影響
> 範圍待評估;修法皆會動到圈次偵測這個核心路徑,**待 user 拍板要不要修**。

- [x] **B129** `detectLapsByLine`(起終點線圈次偵測,`src/domain/analysis/laps.ts:257`)缺少
  `walkLapGates` 有的「取樣點正好落在線上」補救。**已讀碼確認**:`walkLapGates`(同檔 :170)
  明文處理這個情況——註解寫著「A GPS fix can land exactly on the gate line. The two adjacent
  segments then only TOUCH the gate at their endpoint, so the strict pairwise test below rejects
  both」,並以 `crossesThroughSample()`(:145,檢查前後兩個有效 fix 分屬異側)救回;但
  `detectLapsByLine` 的 raw crossing 迴圈(:282-299)**只有** `segmentsIntersect()` 這個嚴格
  proper-straddle 判斷,端點接觸一律拒絕。後果:該圈被漏算、與下一圈合併成一圈。
  觸發條件:軌跡每圈幾乎完全重疊時會系統性發生——float32 經度在 121°E 的 ulp 約 0.85 m,
  座標會吸附到同一格點,取樣點就可能正好落在線上。修法:把 `crossesThroughSample` 的三點
  檢查套進 `detectLapsByLine`(該函式已存在、已被 sector 路徑用了,不必新寫演算法)。
  **✅ 已修(2026-10-04,merge `e0f7cc4`;repro 測試 `e763d63`、修正 `36d5b1a`)**:crossing 迴圈改維護
  `before/prev/i` 三點視窗,`crossesThroughSample` 成立時在線上那個 fix(`idx = prev`)記一次穿越,
  並略過該段的嚴格判斷——嚴格 straddle 不可能涉及線上端點,故不會重複計數;同側擦過仍拒絕。
  新增 3 個測試(線上穿越算一次、線上與嚴格穿越混合、擦線折返不算)。typecheck 0 錯、2740/2740 綠、
  lint 0 錯(4 個既有 warning 不在本次檔案);**既有真檔/golden 測試圈數零變化**。
  已知限制(與 `walkLapGates` 相同):連續兩個以上 fix 都落在線上時仍會漏算,需兩函式一起改。
  ⚠️ 尚未經裝置驗證。
- [ ] **B130** 自動種下的起終點線,方向取自「前兩個有效 fix」(`src/composables/useLaps.ts:25`
  的 `defaultLine()`)。**已讀碼確認**:`defaultLine` 取 `firstValidIdx` 與其後第一個 valid fix
  當方向基準。若記錄從靜止或極慢速開頭(常見:按下記錄後才起步),這兩點的位移可能小於
  float32 量化誤差 → 方向等同雜訊 → 種出來的線角度歪掉,大部分圈次因而漏算。修法建議:改取
  「與起點相距 ≥N 公尺的第一個 fix」當方向基準(N 待定),而非固定取下一個 fix。
- [ ] **B131**(信心較低,**待確認是刻意設計還是 bug**)手機寬度下匯入記錄後**不會自動啟用**:
  勾選框未打勾,切到分析頁是空白,要手動勾選才有內容;桌面版匯入後直接是「主要」。
  agent 是在拍手機版截圖時遇到的,未深究。若為刻意(避免手機一次載入太多),應在 UI 上給提示。

## User report — 大賽道 sector 爆量 / 卡片撐爆 (B132–B133)
- [x] **B132** 大賽道(長 circuit)自動彎道偵測爆量:實測麗寶大賽道 `.rcz`(~3.5 km/圈)
  一鍵自動偵測產生 **~142 個 sector 閘門**(平均約每 25 m 一個),整張賽道地圖被切成一片
  編號圓點,完全不可用。根因就寫在 `src/domain/analysis/cornerDetection.ts` 的
  `CURVATURE_DEFAULTS` 註解裡:那組門檻(`minProminence=0.9`、`minValue=1.4` deg/m、
  `minSpacingM=15`)是 2026-07-01/02 針對 **ARK(~750 m/圈、~12 彎)** 的 `.loga` 校正的,
  註解自己也寫「NOT yet proven to generalise to a differently-scaled track (e.g. a big
  circuit with long, gentle corners)」。放到 3.5 km 賽道上:①`minSpacingM=15` 的理論上限
  就有 ~233 個閘門,毫無天花板;②`minValue=1.4` deg/m 在低速段等同「相鄰兩點差 ~3° / 2 m」,
  GPS 航向雜訊就能過關;③`boxSmooth` 是 **index-domain**(註解已註明),在大賽道上高低速
  區段的實際平滑弧長差好幾倍;④`.rcz` 無 `TC_Lean_Angle`,一定退回較不穩的 curvature 路徑。
  另外 `detectSectorGates`/`sectorStore.loadDetected` 全鏈路**沒有任何數量上限或合理性檢查**。
  可能修法(待拍板):(a) 依參考圈長度縮放 `minSpacingM`(如 `max(15, lapLenM/100)`);
  (b) 加「彎道最短持續弧長」條件,單點尖峰不算彎;(c) 以 prominence 排序取 top-N(N 隨圈長,
  或硬上限 ~30);(d) `boxSmooth` 改距離域窗。**演算法研究(2026-08-21,文獻回顧見下)**:
  問題的本質是現行判據 κ = Δψ/Δs 的單位是 **deg/m —— 有量綱、與彎道半徑成反比**,所以門檻
  `minValue=1.4` 等同「半徑 ≤ 41 m 才算彎」(57.3/1.4);ARK 的彎大多在這之內所以剛好能用,
  麗寶的高速 sweeper(R≈150–200 m → κ≈0.29–0.38 deg/m)本質上就在門檻之下,而低速段的 GPS
  航向雜訊除以極小的 Δs 後又衝過門檻——**同時發生漏抓真彎與抓爆雜訊兩種錯誤**。而且 κ 是
  一階微分量,天生放大雜訊。真正「大小賽道通吃」的方向是換成**無量綱/積分量**:
  ①**turning function θ(s)**(累積航向 vs 弧長,平移與縮放不變)——「一個彎」= θ 的一段單調
  變化且 **|Δθ| ≥ 30°** 之類的角度門檻,單位是度、與賽道尺度無關,且積分會讓零均值的 GPS
  雜訊互相抵消而非放大;②**側向 G**(a_lat = v·ω = v²κ)——賽車手在任何尺度的彎都開到輪胎
  極限,所以 a_lat 天生跨尺度一致(小迴轉 40 km/h 與大 sweeper 160 km/h 都約 0.8–1.0 G),
  這也是 MoTeC/AiM 這類專業分析軟體的慣用判據,且 `.loga` 的 `TC_Lean_Angle` 本質就是
  atan(a_lat/g)——即現行 lean-angle 路徑之所以比 curvature 穩的原因;③**尺度相對的平滑窗**
  (σ 取圈長的百分比而非固定樣本數),即 Curvature Scale Space(Mokhtarian)的作法,並只保留
  跨多個尺度都存活的彎;④**自動決定數量**取代固定門檻:把候選依 prominence(= 1-D 拓樸
  persistence)排序後,在**最大落差處切**(persistence-gap),小賽道自然停在 ~12、大賽道停在
  ~16,無需針對賽道調參;⑤ 更徹底的 **MDL 分割**(TRACLUS 的 partitioning 階段,以
  L(H)+L(D|H) 最小化自動選出特徵點數量,真正無參數)。建議落地順序:先做 ①+④(治本且改動
  集中在 `cornerDetection.ts`),②當 `.loga` 有 lean angle 時的優先路徑保留,③⑤ 視效果再議;
  無論如何都要補上硬上限當保險絲。**繞道方案(現在可用)**:sector 面板「清除全部」
  後手動加閘門,幾何會依賽道存下來、不會再被自動偵測蓋掉。
  **落地(2026-08-21)**:採建議的 ①+④ 路線,**只動 curvature 路徑**(`leanAngleSignal`/
  `LEAN_ANGLE_DEFAULTS`/`detectCorners` 的 lean-angle 分支完全未動,b1(9).loga 的
  reference-lap 彎數驗證前後皆為 12)。`detectCornersByCurvature` 改為 turning-function
  管線:訊號用 `distanceSmooth`(新增,真距離滑動平均)取代 index-domain `boxSmooth`;
  依正負號切「轉向段」;段落 `|Δθ|` 未達 `thetaMinDeg`(預設 **30°**)整段丟棄;段內用既有
  `findPeaks` 依相對峰值比例(`SUBPEAK_PROMINENCE_FRACTION`,實測校正到 **0.45**,而非文獻
  回顧建議的起始猜測)拆多頂點同向連續彎(如 ARK 8-9-10);`minSpacingM` 隨圈長縮放
  (`max(15, lapLenM/100)`);④ persistence-gap 有實作但**實測發現 1.6 的落差比門檻在真實
  雜訊資料上會誤觸**(把一個 16 候選的 reference lap 砍到 5,某圈甚至砍到 1)——真實 prominence
  分布是連續漸變、不是乾淨雙峰,調高到 **4.0** 後在所有 ARK 尺度真檔案上都不再觸發,純作保險絲
  保留;`sigmaFraction` 實測 **1%**(非建議起始值 0.5%)在真檔案上更穩定。⑤ MDL 分割未做
  (超出本輪範圍)。硬上限 `maxGates=40` 已加。真機文件三個手上有的檔案(麗寶大賽道
  `session_20260816_0945_lihpao_full.rcz` 不在 repo 內、無法實測)reference-lap 彎數
  before→after:`b1(5).loga` 11→10、`session_..._極限.rcz` 19→11、`session_..._rcvbo.rcz`
  17→11(ARK 已知 ~12,且每圈變異大幅收斂,如 極限.rcz 從 `[20,21,19,17,21]` 收斂到
  `[12,11,11,11,11]`)。合成尺度不變性測試(同形狀放大 5x)通過:彎數相同、apex 距離按比例縮放。
  Commit `2fef597`(分支 `fix/corner-detection-scale-invariant-b132`,base develop `9f9bcec`,
  尚未 merge/push)。

- [x] **B133** ([[B132]] 的 UI 併發症,但**根因是通用缺陷**)Sector 卡片在閘門數量爆量時,
  「理論最佳圈」的各段時間清單會撐滿整張卡片,把下方的閘門清單/移除按鈕整個擠出可視範圍。
  根因:`SectorPanel.vue` 的 `.optimal` 區塊(含 `<ul class="optimal-sectors">`,**每個 sector
  一個 `<li>`**)放在 `CardFillScroll` 的 **`#header` slot** 裡——那是 B47 刻意的決定(註解寫明
  「Moved into the fixed `#header` … so it stays visible even when the card is resized short」),
  當時假設 sector 只有個位數。而 `CardFillScroll` 的 `.card-fill-scroll__header` 是
  `flex: 0 0 auto` **無高度上限**,`.card-fill-scroll__content` 則是 `flex: 1 1 auto;
  min-height: 0` ——header 一長,content 就被壓縮到 0 高度、整個消失。**這是 `CardFillScroll`
  的通用缺陷**:任何會無限成長的 header 都能餓死 content pane,不只 sector 卡片。**兩層都修
  了**:(a) 局部——`SectorPanel.vue` 的 `.optimal-sectors` 加 `max-height: min(30vh, 160px)` +
  `overflow-y: auto`,B47 原意(卡片縮短時理論最佳圈仍留在可視的 `#header` 內)不變,只是限高
  +可內部捲動;(b) 通用加固——`CardFillScroll.vue` 的 `.card-fill-scroll__header` 加
  `max-height: 50%` + `overflow-y: auto`,保證 content pane 永遠拿得到至少一半高度。已 grep
  `CardFillScroll` 的全部既有使用者(`AccelTestPanel`、`CurrentValuesPanel`)確認:兩者的
  header 都是固定控制項集合(切換鈕/欄位/單行提示),不是隨資料筆數增長的清單,實務上不會
  接近 50% 上限,故此加固不影響既有版面。因 jsdom/happy-dom 在本專案測試設定下不跑真實
  layout(`vite.config.ts` 的 `test` 區塊無 `css: true`),新增測試分兩層:CSS 原始碼文字斷言
  (`test/lint/cardFillScrollHeaderCap.test.ts`,比照既有 `mapOverlayButtonSizing.test.ts` 慣例)
  + `SectorPanel.test.ts` 用 142 個閘門(對應麗寶真檔實測數字)掛載、斷言 `.gate-list` 仍完整
  渲染 142 個 `<li>`/移除按鈕於 DOM 中。2448/2448 綠、typecheck/lint/build 皆過。
  — `99f87bc`/`e3cc1aa`

## User report — 非自家命名頻道認不得 + MT 齒比建議 (B134, F8)
- [x] **B134** 認不得非自家命名的語意頻道 → 齒比/疊圖直接死當,且**無任何手動補救**。實測
  使用者自製 `.vbo`(`lihpao_20260816_ct_full.vbo`,由外部 `u6can` 工具把 Luxgen U6 CAN
  併進 VBO)明明有轉速欄,UI 卻報「此記錄缺少轉速(RPM)頻道」。根因鏈:①該檔轉速欄名為
  **`EngineRPM_rpm`**(且**沒有 `[channel units]` 區塊**,連單位都拿不到);②`parseVbo.ts`
  對非 GPS 基本欄一律 `canonicalName(header[c])` 原樣落地,不做語意對應;③
  `drivetrain.ts` 的 `resolveRpmChannel()` 只有 `session.has('RPM') ? 'RPM' : null`,而
  `canonical.ts` 的 `ALIASES` **根本沒有 RPM 這組**。連帶同檔還有兩處同病:`VehicleSpeed_kmh`
  認不得(目前只是靠 GPS `velocity` 欄補上 `GPS_Speed` 才沒爆)、`GearPRND` 過不了
  `inferDrivetrainKind()` 的檔位頻道正則(該正則要求 `gear` 前後有分隔符)。結論:**只要不是
  自家匯出器產的檔,所有 role-based 功能都會瞎掉,而使用者完全沒有救援手段。**
  修法(user 2026-08-21 拍板,兩層都做、範圍涵蓋**轉速+速度+檔位三個角色**):
  **①自動辨識加強**——把三個 resolver 收斂成單一 `channel roles` 模組,解析順序
  `使用者覆寫 > 既有 canonical/ALIASES > 名稱/單位啟發式`;啟發式只在 canonical 查無時才跑,
  確保既有格式(`.loga`/`.rcz`/`.xrk`/自家 `.vbo`)解析結果**逐字不變**。
  **②手動指定 UI**——自動抓不到時,在原本只會顯示「缺少 X 頻道」的空狀態直接給下拉選單,
  列出本 session 所有頻道讓使用者指定;選擇**以「頻道名稱→角色」為鍵存進裝置**
  (`settingsStore`/localStorage,`tracklogstudio.*` 前綴),日後任何 session 只要出現同名頻道就
  自動套用,同一台車/同一個轉檔工具只需要選一次。⚠️ 實作紅線(記取 [[B125]] 教訓):啟發式
  規則**必須回報 golden fixture diff 規模**,`.loga` 既有頻道分類一個都不許動;localStorage
  讀回的覆寫表必須比照 [[M9]] 的 sanitizer 做白名單+長度/筆數上限。
  **已落地**(merge `6ef0107`):`domain/analysis/channelRoles.ts` 統一三角色解析(覆寫 >
  canonical > 啟發式,啟發式只在 canonical 查無時才跑)、`stores/channelRoleStore.ts` 裝置層
  `channelName→role` 覆寫表(`tracklogstudio.channelRoles.v1`,含 [[M9]] 式 sanitizer、
  newest-wins)、`ChannelRolePicker.vue` + `ChannelRoleBadge.vue`(抓不到時給下拉;由覆寫或
  啟發式決定時常駐「轉速：X（自動判定）· 變更」可隨時改,canonical 命中不顯示)。
  `inferDrivetrainKind` 三頻道改走 resolver;`useLaps`/`useSessionMerge` 刻意不動(避免
  啟發式改變圈次判定與跨檔對齊語意)。**B125 紅線已證明**:golden fixture 對真
  `super2.loga` 斷言與 legacy resolver 逐字相同,既有格式零變動。真檔三份複驗:
  lihpao `.vbo` rpm→`EngineRPM_rpm`、gear→`GearPRND`;自家 `.rcz` rpm→`rc_rpm`;
  RPM 藏在 `rc_digital_1` 的舊 `.rcz` 維持 null(名稱無訊號時不亂猜——正是需要手動指定的
  情境)。typecheck 乾淨 · **2514/2514 綠**(211 檔) · lint 0 error · build PWA 29 entries。
  ⚠️ **尚未經裝置驗證**。

- [x] **F8**(design-first,user 2026-08-21 拍板要做)MT 齒比計算機:餵入引擎特性後**建議檔位與齒比**。
  現況:MT 模式是**純幾何計算機**——輸入只有 `gearRatios / primaryReduction / finalDrive /
  wheelCircumferenceMm / redlineRpm`(`MtFormState`),輸出只有每檔總減速比與紅線極速
  (`computeMtGearTable`)。**引擎特性完全不在模型內**,所以它能算「這組齒比跑多快」,
  不能算「這組齒比好不好」。
  **輸入(雙軌,user 拍板:兩者都要,拿不到曲線就退化成兩點)**:
  (a) **曲線版**——可貼上/匯入 `(rpm, Nm)` 或 `(rpm, hp/kW)` 數對(P[kW] = T·rpm/9549 互轉);
  (b) **兩點版**——只有峰值扭力 rpm 與峰值馬力 rpm(+選填量值)。
  ⚠️ **誠實紅線**:兩點版**只准**產出 band-edge 啟發式結果(級距齒比、換檔轉速近似、
  過長/過短診斷),**不得**輸出加速模擬或「真正的」換檔交叉點——那需要完整曲線,
  兩點捏造曲線再報秒數等於騙人。此限制要用型別/API 形狀強制(需要曲線的函式只收曲線 profile)。
  **輸出(三種最佳化目標,user 拍板全要)**:①**加速優先**——可用轉速帶 =
  [峰值扭力 rpm, 換檔 rpm],理想級比 = 換檔rpm/落點rpm,產出幾何級數建議齒比表並逐檔對照
  現有齒比報「升檔後掉出扭力帶多少 rpm」;②**依實測 log 速域量身訂做**——用已載入 session 的
  速度分布/彎道出彎速度,建議讓主要出彎點落在扭力帶內的齒比(這是本 App 才做得到、
  外部計算機做不到的一項,且可直接複用既有的 `detectGearPlateaus` 實測齒比反推);
  ③**極速優先**——由目標極速/紅線/輪周反推所需終傳,並在齒盤模式下給齒數組合建議。
  曲線版另可算**真正的最佳升檔轉速**(輪端推力相等:T(r)·g_n = T(r·g_{n+1}/g_n)·g_{n+1},
  於 [峰值馬力 rpm, 紅線] 掃描變號點)與**逐檔加速模擬**(需車重;無空力/滾阻輸入時只報
  齒比組之間的**相對**比較並明確標示)。
  **排程**:必須排在 [[B134]] 合併之後才能動 UI ——兩者都會改 `drivetrain.ts` 與
  `GearPanel.vue`。純數學核心(新檔 `domain/analysis/gearRecommendation.ts` + 型別 + 測試)
  可與 B130 並行,前提是**完全不碰** `drivetrain.ts`/`GearPanel.vue`/`drivetrainStore.ts`/i18n。
  **純數學核心已落地(merge `975b399`)、UI 未接**:`domain/analysis/gearRecommendation.ts`
  (+94 條測試)六階段全到位——引擎特性型別與單位換算(hp 預設公制 PS)、`usableBand` +
  `recommendRatioSpacing`(幾何級數,可加 `progressionFactor` 讓高檔級距變寬)+
  `diagnoseExistingRatios`(升檔落點 = `shiftRpm × g_next/g_cur`,報與扭力峰的帶正負距離)、
  `finalDriveForTopSpeed`/`rankSprocketCombos`/`diagnoseTopSpeedGearing`、
  `optimalShiftRpm`(曲線限定,輪端扭力相等的二分解,三種結果 + `usedClampedTorque` 標示
  曲線沒延伸到紅線而扭力被夾平)、`recommendForMeasuredSpeeds`(掃 0.6–1.6× 終傳最大化
  扭力帶佔有率,純函式吃陣列)、`simulateAcceleration`(選配,缺空力/滾阻時以
  `isRelativeOnly` 標示只能相對比較)。誠實紅線以型別強制:需要曲線形狀的函式只收
  curve profile,兩點版無法輸入(`@ts-expect-error` 測試釘住)。
  📌 **審查紀錄**:主線曾指控 `optimalShiftRpm` 在 `diff(peakPower) ≤ 0` 時夾到紅線是方向
  反了,agent 反證該分支**不可達**——`peakPowerRpm` 是 `T(r)·r` 的極大點,故
  `T(r·s) ≤ T(r)/s` ⇒ `diff ≥ 0`(另附 500 萬次隨機搜尋無反例),主線驗算後確認 agent 正確;
  該分支仍保留為防禦性程式碼並在 JSDoc 記下證明。
  **待辦**:UI 接線(引擎特性輸入欄位、建議齒比表、三種目標切換、與已載入 log 的疊圖),
  必須排在 [[B134]] 之後(已滿足)。
  **UI 已接線(merge `b9fb353`)**:新增 `domain/analysis/engineProfileForm.ts`(曲線貼上解析
  /單位換算/驗證診斷/表單型別,輸入 UI 與輸出 UI 共用同一組建構函式)、
  `EngineProfileInput.vue`(兩點版 + 曲線貼上,行內驗證訊息)、`GearRecommendationPanel.vue`
  (建議齒比表 + 升檔落點診斷 + 曲線限定建議換檔轉速 + 終傳/齒盤建議 + 三種目標切換);
  `drivetrainStore` 的 `MtFormState` 增 `engineProfile`(沿用 reject-don't-throw sanitizer、
  範圍夾限、曲線文字 100k 字上限,18 條 sanitizer 測試,持久化仍在
  `tracklogstudio.drivetrain.v2`);`UPlotChart` 新增 optional `xBands` prop 把可用轉速帶
  畫成底色(像素幾何抽成可測的 `xBandRect`)。**誠實紅線型別+UI 雙重把關**:曲線限定輸出
  只在「目前選的就是曲線版且該曲線通過驗證」時解鎖,只有兩點版時區塊仍可見但明說原因。
  **刻意未接**:`simulateAcceleration`(需車重輸入、且無空力/滾阻時只能相對比較)、
  出彎速度擷取(`recommendForMeasuredSpeeds` 視其為 optional,寫新的彎道啟發式超出範圍)、
  齒比級距錨點切換(固定錨在現有頂檔齒比)。typecheck 乾淨 · **2707/2707 綠**(218 檔) ·
  lint 0 error · build PWA 29 entries。⚠️ **尚未經裝置驗證**。

## 汽車記錄實測 — VBO `[laptiming]`/`[session data]` 沒吃 (B135–B136)
> 2026-08-21 實測**第一份汽車 log** `lihpao_20260816_ct_full.vbo`(外部 `u6can` 工具把
> Luxgen U6 CAN 併進 RaceChrono VBO,63 頻道;同場另有 `.rcz` re-export、與 2025-08-17
> 機車 `.rcz` 同賽道 LihPao Full 可互比)。除了完整重現 [[B134]] 的三個角色缺口
> (`EngineRPM_rpm`/`VehicleSpeed_kmh`/`GearPRND` 全認不得)之外,再挖出以下兩條。

- [x] **B135** `parseVbo` 完全忽略 `[session data]`(`name LihPao Full`)與 `[laptiming]`
  (`Start   -7241.186772 +1459.114540 -7241.175315 +1459.126888 ¬ Start/Finish`)兩個區段
  (grep 全 codebase 零處理)。後果:①`meta.name` 空;②起終點線只能靠 `useLaps` 的
  `defaultLine()` 自動種在第一個有效 fix(= paddock)→ **實測整場 0 圈**(`detectLapsByLine`),
  而同場 `.rcz` re-export 靠 `IR_LapNumber` 有正確 4 圈(300.4/166.1/150.6/151.0s)——
  帶 `[laptiming]` 的 VBO 其實自己就宣告了正確的線,白白丟掉,per-lap 比較整個廢掉。
  修法:`parseVbo` 解析兩區段(座標為 VBO 分制、**經度西正**:lat=+min/60、lon=−min/60;
  該行分隔符為 U+00AC)存進 `LogMeta` optional 欄位;`useLaps` 種線優先序改為
  「使用者已存的線 > meta 內建線 > defaultLine」。驗收:真檔套線後應得上述 4 圈圈速。
  後續(不在本條):自家 `VboExporter` 匯出時也回寫 `[laptiming]`,讓 round-trip 不掉線。
  **已落地**:`LogMeta` 加 optional `sessionName`/`startFinishLine`(純新增,他 importer 不動);
  `parseVbo` 解析兩區段(容錯:缺段/壞行→undefined、忽略 `Split` 行);`useLaps` 兩處種線點
  改為 `inferLapLineFromChannel > metaLine > defaultLine`(使用者存線經 `useCircuitPersistence`
  非同步回灌、本就無條件蓋過種線,已追碼確認不需改)。新增 5 測試;真檔複驗 0 圈 → **4 圈
  300.399/166.120/150.600/151.041s**(與 RaceChrono 自家偵測一致);本分支全套 2463/2463 綠、
  typecheck/lint/build 過。UI 目視驗證未做(自動化環境 Browser pane 無法 compositing,Vue
  Transition 卡 rAF,屬環境限制),待真機。 — 本 session 分支 `6250b9d`/`605af87`(hash 待上
  origin 後確認,tracker 規則:local hash 可能變動)
  **合入 develop:merge `76c547f`**(由 car-log-comparison peer session 完成,本 session
  rebase 到 develop 實際 tip 後獨立複驗:typecheck 乾淨、2613/2613 綠 212 檔)。

- [x] **B136**(待拍板)VBO 沒有 `[channel units]` 區段時(Circuit Tools flavour 刻意不寫,
  單位嵌在欄名:`EngineRPM_rpm`/`CoolantTemp_degC`/`YawRate_degps`…),全部頻道單位空白。
  可在 importer 加「欄名單位後綴」啟發式(`_rpm`/`_kmh`/`_degC`/`_kPa`/`_pct`/`_deg`/
  `_degps`/`_g`/`_uT`/`_km`)拆出單位。兩個子選項:(a) 只填 `unit`、名稱保留尾巴(安全,
  但名稱冗長);(b) 同時把名稱去尾(乾淨,但會動到 [[B134]] 使用者覆寫表的鍵與既有欄名
  假設,誤拆風險:`_g` 可能撞真名)。屬顯示品質改善、非阻斷,**待 user 拍板要不要做與做哪款**。
  **user 拍板(2026-08-21):做,採 (a) 只填 `unit`、名稱完全不動。** 理由:頻道名稱正是
  [[B134]] 裝置層覆寫表的**鍵**,改名會讓使用者已存的對應變孤兒;`_g` 這類單字母後綴誤拆
  風險也高。實作紅線:①只在單位原本為空時才套用(有 `[channel units]` 值一律優先);
  ②僅 VBO importer 內生效,既有 golden fixture 不得變動;③新填的單位會餵進 B134 啟發式的
  計分(unit 是訊號之一),須複驗真檔三個角色解析不變。
  **已落地(merge `d20c876`)**:`parseVbo` 新增
  `NAME_SUFFIX_UNITS` 表與 `inferUnitFromNameSuffix()`,接在既有 `unitAt()` 之後當
  **fallback**——`[channel units]` 有值一律優先且原封不動,`name`/`rawName`/`description`
  完全不碰。誤拆防線:後綴必須緊接底線且位於結尾,巢狀項目依長度排序在前
  (`_degps`/`_degC`/`_deg`、`_kmh`/`_km`、`_mps`/`_ms`);實測 `AcCompressorClutch_10Hz`
  不會被 `_hz` 認領。單位拼寫沿用既有 importer/`semantic.ts` 寫法(`_deg`→`deg` 而非 `°`,
  `_g`→小寫 `g` 以與匯出器 round-trip,`_uT`→`µT`)。真檔複驗:52 個 telemetry 頻道 34 個
  取得單位,其餘 18 個為布林/狀態/raw 正確維持無單位;[[B134]] 三個角色解析不變。
  兩個 VBO golden fixture 皆帶完整 `[channel units]`,不會走到 fallback。
  typecheck 乾淨 · **2737/2737 綠**(218 檔) · lint 0 error。⚠️ **尚未經裝置驗證**。

## Maintenance / deferred
- [x] **M1** Dependency refresh: no `latest`/`*` ranges existed; all direct deps already at latest in-range; transitive lockfile refreshed; `npm audit` 0 vulnerabilities. TypeScript 6→7 skipped — verified vue-tsc (≤3.3.7) crashes on TS7's removed `./lib/tsc` export; revisit when vue-tsc supports TS7. — `56dc1c5`
- [x] **M2** Dead `useTrackOverlay` candidates/toggle/clear + `trackOverlay*` i18n removed (verified zero references); the still-live `overlayTracks` path (FileBar 加入分析) kept. — `83fc12a`
- [x] **M3** `TrackMap.draw()` split: pure geometry to `domain/analysis/trackMapGeometry.ts` (projection/bbox/heatmap-bucketing/highlights/zoom-pan math, 30 unit tests) + 12 named canvas steps; draw() now a ~100-line painter's-order skeleton. Behaviour pinned by 3 pre-refactor canvas-recording tests (assertions unchanged across the refactor). — `6da278a`
- [x] **M13** CI `npm audit --audit-level=high` 閘門紅燈(該步排在 typecheck/test/build 之前,一擋全跳過,17 秒閃退;**純文件 commit 亦紅**,證明與程式改動無關):`GHSA-mh99-v99m-4gvg` — brace-expansion「無界展開致 OOM」DoS,**漏洞範圍 `<=5.0.7`,即 1.x/2.x/3.x/4.x 全線皆中,唯一修補版為 5.0.8**;經 `brace-expansion`→`minimatch`→`editorconfig`/`glob`/`filelist`→`js-beautify`/`jake`→`@vue/test-utils`(測試期)與 `ejs`→`@trickfilm400/rollup-plugin-off-main-thread`→`workbox-build`→`vite-plugin-pwa`(建置期)兩條鏈串出 **12 個 high**。皆為 dev/build 期依賴,**不進出貨 bundle**。**未採用** npm 建議的 `npm audit fix --force`(會把 `@vue/test-utils` 降到 2.2.7/2.4.0,破壞性 major);比照 [[M11]]/[[M12]] 以 top-level `overrides` 加 `"brace-expansion": "^5.0.8"` 並重新產生 lockfile。相容性事前查證:5.0.8 雖 `type:module` 但具 dual build(`exports["."].require`→`dist/commonjs`),舊 CJS consumer 仍可 `require`;`engines: node 20 || >=22` 與 CI 的 Node 22 相符。⚠️ 主線獨立複驗(sub-agent 是在 rebase 前、基於 main 的樹跑測試,數字 2104 對不上 develop 的 2165,故未採信其「不需重驗」判斷):於 develop 實際樹 `npm install` 後 `npm audit --audit-level=high` **0 漏洞**、**2165/2165 綠**(188 檔,含 ⑤⑥ 新測試)、build 成功(PWA 31 entries)、`npm ls brace-expansion --all` 全樹解析為 5.0.8(三條原本中招的 minimatch 路徑皆已修)。CI 實測轉綠(run `30355390686`)。 — `8ba6495`/merge `9e9cdf5`
- [x] **M14** 相依 minor/patch 刷新(caret range 內,`package.json` 範圍未動、僅 lockfile 前進):`@cloudflare/vite-plugin` 1.46.0→1.48.0、`wrangler` 4.113.0→4.115.0、`vue-i18n` 11.4.7→11.4.8、`eslint` 10.7.0→10.8.0、`globals` 17.7.0→17.8.0、`@types/node` 26.1.1→26.1.2。**`overrides` 三項(sharp/fast-uri/brace-expansion)完整存活**(brace-expansion 是 [[M13]] 當日才加、掉了 CI audit 會再紅,已列為驗收第一項)。主線於**合併狀態**(含播放鈕疊層)獨立複驗:`npm audit --audit-level=high` **0 漏洞**、**2166/2166 綠**(188 檔)、build 成功 PWA 31 entries、lint 0 error。 — `c3eccd2`/merge `2e82e5b`
- [x] **M15** CI `npm audit --audit-level=high` 閘門第四度紅燈(同 [[M11]]/[[M12]]/[[M13]] 家族),三則**新公告**同時命中,皆為 dev/build 期依賴、不進出貨 bundle:① `brace-expansion` — `GHSA-rgw5-rvv9-x895`「無界中間陣列致 DoS,繞過 CVE-2026-14257 的緩解」,受害範圍 **4.0.0–5.0.8**,**連 [[M13]] 當初加的 `^5.0.8` override 本身也落在範圍內**,修補版 5.0.9;② `fast-uri` — `GHSA-7p8r-x3mc-p8w7`「反斜線 authority 前導字元造成 host confusion」,範圍 3.0.0–3.1.4,即 [[M11]] 的 `^3.1.4` override 亦已失效,修補版 3.1.5(**留在 3.x 線**,不跳 4.x —— `ajv` 要求 `fast-uri ^3.0.1`);③ `undici` — 5 則公告(retry interceptor 回應去同步、私有快取指令解析致跨使用者資訊洩漏/崩潰、blob body `type` 的 CRLF injection、Cache-Control 等號空白、cookie 屬性注入),範圍 7.0.0–7.28.0,而 `miniflare` **精確釘死 `undici@7.28.0`**、即使 wrangler/@cloudflare/vite-plugin 都在最新版仍如此,故 `npm audit fix --force` 的「解法」是把 `@cloudflare/vite-plugin` 降到 **1.12.4**(破壞性,不採用),改以 override 拉到修補版 7.29.0。修法一律沿用 M11–M13 慣例:top-level `overrides`(`brace-expansion ^5.0.9`、`fast-uri ^3.1.5`、新增 `undici ^7.29.0`;`sharp ^0.35.3` 原封保留)並重新產生 lockfile。主線獨立複驗:`npm audit --audit-level=high` **0 漏洞**(全嚴重度亦 0)、`npm ls` 三者全樹分別收斂至 5.0.9/3.1.5/7.29.0 無漏網、typecheck 乾淨、**2307/2307 綠**(197 檔)、build 成功 PWA 31 entries(1367.90 KiB)、lint 0 error。**體質修正(user 拍板採用建議)**:此閘門原本排在 typecheck/test/build **之前**,任一 dev 期公告一出現就整條 workflow 17 秒閃退、連測試結果都看不到(純文件 commit 亦紅)——已把該步移到 job **最後**。把關強度完全不變(照樣讓 job 失敗、照樣 `--audit-level=high`),但公告出現時仍看得到 typecheck/測試/build 的真實結果。未採用 `continue-on-error`(會退化成純提醒、漏擋真該擋的)與放寬到 `--audit-level=critical`。 — `f6fb3fb`/merge `87d2bb8`,CI 順序調整見下一則 commit
- [x] **M16** 相依 minor/patch 刷新(全部落在既有 caret range 內,`package.json` 版本字串未動、僅 lockfile 前進;`npm install` 因 lockfile 已滿足範圍而不會自動前進,需顯式 `npm update <pkgs>`):`@cloudflare/vite-plugin` 1.49.0→1.51.0、`@vitest/eslint-plugin` 1.6.24→1.6.26、`globals` 17.8.0→17.9.0、`typescript-eslint` 8.65.0→8.66.0、`vite` 8.2.0→8.2.1、`vue` 3.5.40→3.5.41、`vue-tsc` 3.3.8→3.3.9、`wrangler` 4.116.0→4.119.0。`typescript` 維持 `^6.0.3` 不動(TS7 阻擋原因未解,見上方再評估條目)。與 [[M15]] 同一 commit 落地、共用同一次驗證。連帶效果:GitHub PR #14(Dependabot minor-and-patch 群組 5 項:@cloudflare/vite-plugin 1.50.0、@vitest/eslint-plugin 1.6.25、globals 17.9.0、vue-tsc 3.3.9、wrangler 4.118.0)為本條的**真子集**且其 CI 因 M15 的閘門而紅,故不合併、直接關閉並註明由本次取代。 — `f6fb3fb`/merge `87d2bb8`
- [x] **TypeScript 6→7 再評估(M1/M7/M12 續案)—— 實測後維持 TS6,不升級。** `vue-tsc` 已到 3.3.8、其 `peerDependencies` 宣告 `typescript: ">=5.0.0"` 看似允許 TS7,但**宣告寬鬆不等於實際可用**,實測抓到兩個獨立阻擋:**(1)** 連裝都裝不起來——`typescript-eslint@8.65.0` 的 peer 為 `typescript: ">=4.8.4 <6.1.0"`,`npm install typescript@7.0.2` 直接 ERESOLVE 失敗(非 `--force` 不可);**(2)** 強制安裝後單獨驗 vue-tsc,**與 M1 當初完全相同的崩潰重現**:`Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined by "exports" in node_modules/typescript/package.json (at resolveTscPath, vue-tsc/index.js:73)`。已完整還原 `package.json`/`package-lock.json` 至 `^6.0.3` 並重裝,**全程未動任何原始碼**。結論:M1 的阻擋原因**尚未解除**,`npm outdated` 中 typescript 是唯一刻意保留落後的項目;待 vue-tsc 真正支援 TS7(而非只是放寬 peer 宣告)且 typescript-eslint 放行後再評估。 **2026-08-21 生態系查證更新**:TS 7.0(Go 原生編譯器)已於 2026-07 GA,但**未附穩定
  programmatic API**——vue-tsc 嵌 compiler in-process 檢查 SFC 的作法因此完全動不了,Angular/
  Svelte/typescript-eslint 同卡,官方建議 Vue 專案留在 TS 6.x;TS 7.1(目標 2026 秋)承諾穩定該
  API,屆時才有升級的前提。升級條件三項:①TS 7.1 落地 ②vue-tsc release notes 明確宣告支援
  (宣告寬鬆 ≠ 可用,勿只看 peer range)③typescript-eslint 放行。
- [x] **M18** CI `npm audit --audit-level=high` 閘門第五度紅燈(同 [[M11]]/[[M12]]/[[M13]]/[[M15]] 家族,又一則新收錄公告):`GHSA-2v37-7h3g-55p8` — nanoid「custom generators can loop indefinitely when size is zero」,受害範圍 `<3.3.17`,經 `vite` 8.2.1 → `postcss` 8.5.25 → `nanoid` 3.3.16 間接引入,屬 build 期依賴、不進出貨 bundle,但該閘門仍會擋。**與 M13/M15 不同,本則不需要 overrides**:`npm audit fix`(未加 `--force`)解出的 3.3.18 仍落在既有 caret range 內,故 `package.json` 未動、只有 lockfile 前進。主線實測:audit 0 漏洞、typecheck 乾淨、2353 綠、build 31 entries。 — `e713104`
- [x] **M19** 相依 minor/patch 刷新(caret range 內,`package.json` 範圍未動、僅 lockfile 前進),取代 Dependabot PR #16(本條為其真超集):`@cloudflare/vite-plugin` 1.51.0→1.53.0、`@types/node` 26.1.2→26.2.0、`@vitest/eslint-plugin` 1.6.26→1.6.27、`eslint` 10.8.0→10.8.1、`globals` 17.9.0→17.11.0、`happy-dom` 20.11.1→20.11.6、`pinia` 4.0.2→4.0.3、`sql.js` 1.14.1→1.14.2、`typescript-eslint` 8.66.0→8.67.0、`vite` 8.2.1→8.2.2、`vitest` 4.1.10→4.1.11、`vue-tsc` 3.3.9→3.3.10、`wrangler` 4.119.0→4.124.0。TypeScript 續留 `^6.0.3` 不動(TS7 崩潰 + typescript-eslint peer 擋,見上方「TypeScript 6→7 再評估」條)。`overrides` 四項完整存活(`npm ls --all` 逐一核對):`sharp` 0.35.3、`fast-uri` 3.1.5、`brace-expansion` 5.0.9、`undici` 7.29.0。pinia/sql.js 為出貨期 runtime 依賴(非單純 dev 期),已額外確認測試/build 正常。主線獨立複驗:`npm audit --audit-level=high` 0 漏洞、typecheck 乾淨、**2443/2443 綠**(207 檔)、lint 0 error(既有 4 個警告與本次無關)、build 成功。⚠️ **PWA precache 由 31→29 entries**(1384.07 KiB→1383.65 KiB,體積幾乎不變):已用新舊 lockfile 各自 `npm ci`+build 並 diff `sw.js` precache 清單交叉核實——並非內容遺失,是 vite 8.2.2 chunking 行為改變,把兩個小 chunk(`preload-helper-*.js`、`useInputCapabilities-*.js`)併入其他 chunk(如新出現的 `index-*.js`),檔名雜湊全數改變但內容總量不變,判斷為良性合併、非回歸。 — `8ad9b67`
- [x] **M20** 收斂 B88 遺留的 importer 物件複本,讓測試改對「出貨路徑」斷言。B88(`8ad0890`)把格式處理拆成兩階段——**辨識**走 `src/domain/import/formatDefinitions.ts` 的 `IMPORT_FORMATS`(只有 id/extensions/detect,在初始 bundle 內)、**解析**走 `src/workers/parse.worker.ts` 的 `WORKER_PARSERS`(選檔後才載入)——但 B88 之前的**七個** `Importer` 物件全數留著:`csv/CsvImporter`、`loga/LogaImporter`、`nmea/NmeaImporter`、`rcnx/RcnxImporter`、`rcz/RczImporter`、`vbo/VboImporter`、`xrk/XrkImporter`。**真正的問題不是死碼,是測試盲區**:這些物件把 `detect` 判斷式**逐字複製**了一份(例:`VboImporter` 的 `fileName.endsWith('.vbo') || /\[header\]/i.test(headText)` 與 `formatDefinitions.ts` 一字不差),而四個測試檔(`test/import/importer.test.ts`、`test/import/vboRobustness.test.ts`、`test/import/xrk.test.ts`、`test/export/registry.test.ts`)斷言的全是**複本**——出貨用的 `IMPORT_FORMATS.detect` 哪天改壞或漂移,測試照樣綠。**方向**:刪物件、測試改接出貨路徑(不採「讓 `IMPORT_FORMATS` 從物件推導」,那會讓 `formatDefinitions.ts` 靜態 import 到各 parser,FileBar 一載入就打包全部 parser 與解壓相依,等於回歸 B88)。**刪除範圍**:七個 `*Importer.ts` 全刪;`Importer.ts` 保留但收斂成兩個仍在用的共用型別(`ImportCandidate` 供 `formatDefinitions`、`ImportProgress` 改由 `parse.worker.ts` import 取代自己重宣告的 `ProgressFn`),`TextImporter`/`BinaryImporter`/`Importer` 一併刪除——它們描述的正是「一個物件同時帶 detect 與 parse」這個 ARCHITECTURE-FORMATS §5 明文叫人別再寫的形狀,留著只會繼續教一套已廢止的架構。**測試如何改接**:①detect 斷言全部改走 `detectImporter()`/`IMPORT_FORMATS`,`importer.test.ts` 重寫成 16 條表格化案例、逐條指定「該由**誰**勝出」(不只是「有人命中」,所以 first-match-wins 的排序回歸也會紅),另補「bare ZIP 不得被 rcz/rcnx 認領」「`IMPORT_FORMATS` 每個項目不得帶 `parse`」「`extensionsForImporter`」;②原本「與 importer 物件比對 id/extensions 順序」改成寫死預期順序表;③新增 **`IMPORT_FORMATS` ↔ `WORKER_PARSERS` id 雙向對齊**檢查(讀 worker 原始碼比對鍵,因為 worker 模組在 vitest 的 node 環境 import 會炸在模組層的 `self`;正反兩向都驗,擋「格式加了但 worker 沒對應條目」與「worker 條目沒人派送」);④parse 斷言改直接呼叫 `WORKER_PARSERS` 所派送的函式(`parseLoga`/`nmeaToSession`/`parsePlainCsv`),測試檔頂端註明為何這樣接;⑤`export/registry.test.ts` 原本繞 `nmeaImporter.parse` 取 parser,改直接 import `nmeaToSession`;⑥xrk 另補一條:`formatDefinitions.ts` 內聯的 RFC 1950 zlib 檢查 vs `isZlibMagic` 等價性——**這份複製是 B88 lazy 邊界刻意保留的**(import `isZlibMagic` 會把 fflate 的 `Unzlib` 拉進初始 bundle),刪不掉,只能用測試釘住。**驗證**:typecheck 乾淨、**2458/2458 綠**(207 檔,較基準 2443 多 15 條新斷言、檔數不變)、lint 0 error 4 warning(既有,與本次無關)、build 成功 PWA **29 entries**。**lazy 邊界複驗**:`formatDefinitions.ts` 的靜態 import 仍只有 `./Importer`(type-only)與 `HeaderDetector`;build 後逐 chunk grep,`parseVbo`/`parseRcz`/`inflateXrz`/`parseXrk` 的專屬字串**只出現在 `parse.worker-*.js`**,`index-*.js` 入口只有辨識用的副檔名字串與匯出側程式碼,B88 的切分完好。文件同步:`docs/ARCHITECTURE-FORMATS.md` §1 資料流圖、§2、§3(`Importer.ts` 段落改寫 + M20 註記,原本「兩個物件已無任何引用」的敘述**是錯的**——是七個、且測試仍引用,已更正)、§4 支援矩陣(七個 `xxxImporter` 名稱改為實際 parser 函式名)、§5 步驟 2、§6 二進位擴充敘述;`docs/IMPORT-FORMATS-STATUS.md` 的架構行(原本寫 `Importer` 介面 + `parseBinary`,M20 後完全不成立)亦改寫為兩階段。`docs/specs/FORMAT-SUPPORT-RESEARCH.md` 內的 `parseBinary`/`vboImporter` 字樣**刻意不動**——該檔是實作前的格式研究紀錄(point-in-time),不是現況敘述。 — `9cfa163`/merge `7f93191`
- [x] **M4** 截圖使用手冊。`docs/manual/zh-Hant.md` 與 `en.md` 各插入 **28 張截圖**(`docs/manual/images/`,1.3 MB,兩語版共用同一組繁中介面截圖、手冊開頭已加註說明)。**產生方式可重現**:`scripts/manual-screenshots/`(capture.mjs / demoLog.mjs / lib.mjs),puppeteer-core + 系統 Chrome headless 打本機 dev server,fixture 經 vite `/@fs/` 取得後以 DataTransfer 塞進隱藏 file input 觸發 change 事件完成匯入;puppeteer-core **刻意不寫進 `package.json`**(僅手動開發工具,`npm i --no-save` 即可)。重跑指令見腳本註解,給定 seed 下 28 張有 27 張 byte-identical。**分析頁用合成示範記錄**——既有 fixture 全是 200 列截斷檔、跑不出完整圈,畫面會全空;`demoLog.mjs` 產生多邊形倒角賽道 3.7 km、5 圈 1:50–1:55、含靜止起步加速。轉換頁則用真檔 `test/fixtures/super2.loga`。**沒拍到的**(已知限制,非缺漏):①底圖圖磚(headless 無 DNS,地圖只有軌跡無底圖)②疊圈/地圖對位微調卡片(載兩份記錄並各選一圈仍未出現,`cardHasData` 預設 true、AnalyzerView 另有 gating,觸發條件未查明)③PWA 安裝提示 §2.2、`?debug=1` 診斷 §6.1、RCNX 場次挑選 §2.4、公開賽道庫命中提示 §4.9(各需真實安裝流程/特定檔案/特定 GPS 座標)。驗證:build **不受影響**(precache 29 entries 與本批基準相同,docs 圖片不進 bundle——vite 只打包 src/public)、typecheck 乾淨、2458 綠、lint 0 error。 — `94b7358`/merge `5fa5b97`
- [x] **M7** Dependency refresh round 2: vite 8.1.5 / wrangler 4.112.0 / @cloudflare/vite-plugin 1.45.1 / happy-dom 20.11.0; `npm outdated` clean除 typescript、`npm audit` 0 vulnerabilities。TS7 續留 skip——vue-tsc 仍為 3.3.7（M1 驗證過與 TS7 不相容），等 vue-tsc 支援再升。 — `16a1831`/merge `9ef0ae7`
- [x] **M8** 架構清理（knip 掃描 + 逐項人工確認）：25 個無引用死 i18n 鍵移除（en/zh-Hant 同步，各 676 鍵、集合一致；`mapBackground.upload*Error` 為樣板字串動態組鍵、確認保留）`b3c7a7d`；Phase 0 遺留 `sessionStore.ts` 死檔移除 `8bcef37`；`accelTest.ts` 內重複 `crossingFrac`/`lerp` 收斂 `c334412`；`Rc3NmeaExporter` 改用 `vbo/format.ts` 既有 `padInt` `d159878`。未動（審查過、不值得或需確認）：knip 的 26+43 個「未使用 export」實為檔內仍用、僅可收窄 export 面（~30 檔、風險/效益不划算）；`suspension.ts` `OUTPUT_NAME`/`ECU_NAME` 為刻意語意別名；`scripts/`+`bench-*.ts` 為手動開發工具、是否保留待使用者確認；`src/debug/diagnostics.ts` 有 main.ts 引用（`?debug=1` 面板）非死碼。 — merge `9ef0ae7`
- [x] **M9** 發版前資安審查（`f6c681a..develop`，round7 B68-B94 + CVT M5 + M7/M8）：審查 CSV importer RFC4180 解析/size cap、CVT 筆記與懸吊校正 metadata 在 NMEA/VBO/CSV/LOGA round-trip、SVG 自訂底圖(最高風險項——確認全程走 `<img>`+blob URL+canvas，無 `v-html`/`innerHTML`，無 XSS 面)、OSM tile 抓取(host 寫死、z/x/y 有邊界處理，無 SSRF)、settings/CVT profile import sanitizer(全用 `Number.isFinite`+白名單建構，無 prototype pollution)、`worker/redirect.ts`(本次未變更，另行確認安全)、M7 依賴供應鏈(`npm audit` 0 漏洞，lockfile 全部 `registry.npmjs.org`)。未發現 P0；修復 2 個 P1：①CSV 匯入超長無換行單行可繞過 `MAX_PLAIN_CSV_CELLS`(逐欄位改為即時計數) `8077888`；②CSV/VBO 匯出的 CVT 筆記/頻道名稱(可能源自惡意匯入檔的 TLS-Metadata)缺公式注入防護，補上 OWASP 建議的前導單引號中和 `7245f38`。P2+ 僅記錄未修：CVT 陣列 sanitizer 無長度上限、數值僅檢查有限性無範圍夾限、底圖 blob 重傳不清舊 IndexedDB、既有文字匯入器無檔案大小上限(技術債)。獨立驗證 typecheck 乾淨、1883/1883 測試綠、build 成功。結論：不擋 release。 — merge `de62fc5`。**P2 後續已補（merge `9080e99`）**：CVT sanitizer 陣列上限 4096 + 數值寬鬆物理範圍夾限（`startX`/`endX`/`sampleCount` 語意不明維持 finite-only）`8bb00be`；底圖重傳成功後才刪舊 IndexedDB blob（失敗不動舊圖；控制面無「移除底圖」動作、重傳為唯一洩漏路徑）`96138d2`；NMEA/VBO/LOGA 文字匯入器補 200M 字元上限（比照 B85 模式，錯誤走 e.message 非 i18n）`e47803d`。附帶：scripts 接電 `icons:generate`/`fixtures:make`/`bench:parse`/`bench:pipeline`（bench 走新 `scripts/perf/run-with-vite.mjs` ssrLoadModule loader，零新依賴；`icons:generate` 依賴的 sharp 目前僅為 wrangler 的 optional 傳遞依賴，未宣告——日後乾淨安裝可能缺）`b4274ef`。1895/1895 綠。
- [x] **M11** CI `npm audit --audit-level=high` 閘門紅燈（排在 typecheck/test/build 前擋下）：兩條新收錄 CVE 鏈，皆僅 dev/build 期依賴、不進出貨 bundle——① `sharp` 解析到 0.34.5(經 `@cloudflare/vite-plugin`→`miniflare` 間接引入，GHSA-f88m-g3jw-g9cj libvips CVE-2026-33327/33328/35590/35591)，即使 wrangler/miniflare/@cloudflare/vite-plugin 已是最新版仍內部固定 sharp 0.34.5，須用 `overrides` 強制；② `fast-uri` 解析到 3.1.3(經 `vite-plugin-pwa`→`workbox-build`→`ajv`，GHSA-v2hh-gcrm-f6hx host confusion)。修法：`package.json` 新增 top-level `overrides`(`sharp: ^0.35.3`、`fast-uri: ^3.1.4`)並重新產生 lockfile。獨立驗證(worktree sub-agent)typecheck 乾淨、1962/1962 綠、build 成功、`npm audit --audit-level=high` 0 漏洞(先前 5 個 high)；主線 checkout 重跑 `npm install`+三項驗證同樣全綠。 — `8d06738`(cherry-pick自worktree `480383d`，該分支意外從 origin/main 而非 develop 分出，經確認兩者當時 tree 相同、僅取單一 commit cherry-pick 到 develop，未污染 develop 歷史)
- [x] **M12** 相依 patch/minor 刷新:`@cloudflare/vite-plugin` 1.45.1→1.46.0、`vue-i18n` 11.4.6→11.4.7、`wrangler` 4.112.0→4.113.0(caret range 保留)。TypeScript 6→7 續留 skip(vue-tsc 3.x 不相容,M1/M7 已驗)。獨立驗證(worktree sub-agent + 主線 npm install 重驗):typecheck 乾淨、2039/2039 綠、build+PWA30 成功、`npm audit` 0 漏洞。 — merge `374070c`

## Release verification (B95)
- [x] **B95** Prod console「cross-world service worker resource mismatch」×4：index.html 的 modulepreload 在 Workbox SW 控制下永遠配對不到（模組由 CacheStorage 回應）→ 4 chunk 重複下載 + 警告，功能無影響。修法採 vite `build.modulePreload:false`（SW 控制下本來就走 cache；驗證 dist/client/index.html 零 modulepreload、entry script 與 precache 29 entries 不變）。 — `6649c52`/merge `9080e99`。同場加映（非 bug，勿修）：`beacon.min.js ERR_BLOCKED_BY_CLIENT` = 使用者擋廣告器（B23 已記載）；`inject.js StorageManager settings timeout` = 瀏覽器擴充功能的 content script，非本站程式。

## Done (早期歷史片段)

> ⚠️ 本段是**專案早期**的一批完成項殘留,不是最新進度。**最新完成項見上方各輪 acceptance round 與 B/M 編號條目**(那些才是逐項狀態與 commit 的真實來源)。

- [x] Comparison laps rendered as a per-lap table; cross-file selected laps drawn on the map; overlay↔map cursor link; collapse vertical reflow (no cross-column jump); chart-mode label 時間軸→時序; accel-test "distance from launch speed" (0=standstill); GitHub star button opens reliably; docs de-staled; PWA meta/manifest scaffolding. (Released to main.)
