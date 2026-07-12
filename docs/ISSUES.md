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
- [ ] **B6** Min/max extrema markers with no lap selected show the whole track's extrema (screen floods). Rework to avoid clutter.
- [ ] **B7** "Maximize track map within the card" must work on desktop too (not mobile-only) and maximize inside the CARD, not fill the screen.
- [ ] **B22** Map base-image overlay (upload + align custom image, free OSM tiles, satellite via user's own API key). Designed in docs/DESIGN.md §6.1/§6.3, never built. Large — schedule separately.

## Charts
- [ ] **B8** Remove the 時序/timeline chart mode entirely; overlay mode should show ALL values when no lap is selected.
- [ ] **B9** Timeseries chart has zoom but no reset (can't restore after zooming) and no horizontal pan while zoomed. Add reset + pan.

## New "current values" card
- [ ] **B15** New dashboard card: grid of every channel's current value (at cursor). Auto rows/cols by card size, scroll on overflow; each cell shows field name (top-left) + value (centered).
- [ ] **B16** Treat the time display as one of those fields (relates to B15 and B8).

## Acceleration test
- [x] **B14** List ALL matching segments, not just the single fastest (e.g. 10 traffic-light launches → ~10 0→50 km/h or 0→100 m segments). — `21e8ea6`

## PWA
- [x] **B13** PNG icon set generated from `public/app-icon.svg` (192/512 + maskable + iOS 180 + favicon); `virtual:pwa-register/vue` update-available toast added. — `5fdd152`
- [x] **B23** Added `<meta name="mobile-web-app-capable" content="yes">` alongside the kept apple variant. (The `cloudflareinsights beacon ERR_BLOCKED_BY_CLIENT` is just the user's ad-blocker — NOT a bug.) — `d1b56f7`

- [ ] **B24** The accel-test segment list doesn't stretch/scroll to fill the card as the card resizes. Make lists-in-cards share ONE "fill card height + scroll on overflow" layout (user: 「我好像不只一次提到這類議題」) — same pattern needed by B15's current-values grid and other in-card lists. Factor out a shared scroll/fill container.
- [x] **B26** Accel-test focus is now a toggle (re-click un-focuses) + explicit 清除聚焦 button; stale focus auto-clears when the result set changes; clearing restores the full chart range. — `348cb0c`

## Charts (scatter)
- [ ] **B25** XY scatter's 3rd axis (colour) breaks once a 2nd track file is selected — the colour channel now collides with per-file identity colour. **DECIDED (user, 2026-07-12): marker SHAPE per file (circle/triangle/square…) + shape legend; colour stays fully on the 3rd-axis value gradient.** Implement accordingly.

## Card chrome
- [x] **B27** Root cause: leftover `border-top`/`margin-top`/`padding-top` on the panel roots (a stacked-panel divider from before each panel got its own card). Removed from GearPanel/AccelTestPanel/SectorPanel. — `9f0a085`
- [ ] **B27b** Same leftover divider style also exists in `TrackChannelPanel.vue` and `TrackFilePanel.vue` (each solo in its own card) — remove there too.

## Settings
- [ ] **B19** Define + implement settings export scope (theme/language/timezone/units, drivetrain, and layout — dashboard layout + panel state; likely a "include layout" toggle) + import.
- [ ] **B20** Settings page: show the current read values of theme / language / timezone.

## Converter
- [ ] **B21** PC mode: the suspension-calibration menu need not be full-width at the bottom — place it on the output/convert side to save space.

## Dashboard
- [ ] **B18** Pinned card still cannot be resized — make it resizable.

## Maintenance / deferred
- [ ] **M1** Dependency refresh — pin to current latest versions (not a `latest`/`*` range).
- [ ] **M2** Clean dead code: `useTrackOverlay` candidates/toggle/clear + `trackOverlay*` i18n (superseded by the FileBar 「加入分析」 checkbox).
- [ ] **M3** Refactor `TrackMap.draw()` (≈500-line god-function) into smaller units.
- [ ] **M4** Optional: screenshot user manual.

## Done (recent)
- [x] Comparison laps rendered as a per-lap table; cross-file selected laps drawn on the map; overlay↔map cursor link; collapse vertical reflow (no cross-column jump); chart-mode label 時間軸→時序; accel-test "distance from launch speed" (0=standstill); GitHub star button opens reliably; docs de-staled; PWA meta/manifest scaffolding. (Released to main.)
