# Issue tracker

Living checklist of reported issues / requests, so nothing gets lost across work sessions.
Status: `[ ]` open · `[~]` in progress · `[x]` done. When done, note the fixing commit (short SHA).
Please keep this list free of working-hours logs (issue text + status + commit only).

## Comparison lap-table (must REUSE the primary LapTable's parsing + UI, not a parallel impl)
- [x] **B1 / B17** Comparison table now reuses the primary LapTable via a shared `LapTableView` (read-only); sector column computed from each comparison's own track through the shared gates. — `bbb9c15`
- [x] **B2** Valid-lap time/distance band now marks comparison laps as excluded, same as primary. — `bbb9c15`
- [x] **B3** Removed the duplicate lap list that was double-mounted inside the sector-gate card. — `bbb9c15`
- [ ] **B1b** (RE-REPORT, screenshot 2026-07-12) The comparison table's LEAD/SELECTION UI still differs from the primary: it uses a **checkbox** column + has **no exclude (⦸) button**, whereas the primary uses the ⦸ exclude lead. User: 「怎麼還是獨立的?為何會有checkbox?主表是這種樣式嗎?排除圈的按鈕呢?」 Make the lead column + row-selection interaction visually match the primary (row-click to select for overlay like the primary does; drop the standalone checkbox look; comparison stays non-excludable but the lead cell should read the same). Columns/sector/band parity (B1/B2/B17) already landed — this is the remaining visual/interaction unification.

## LapTable layout
- [ ] **B4** Primary-file title belongs above the table (not top of whole card); "add column" button on the same row as the line/ECU source toggle; clear-selection on that row too but far right.

## Lap detection
- [ ] **B5** Switching lap source 線段自算 ↔ ECU must clear the selected laps (lap sets differ between sources).

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
- [ ] **B23** Console warns `apple-mobile-web-app-capable` is deprecated — add `<meta name="mobile-web-app-capable" content="yes">` (keep the apple one for older iOS). index.html. (The `cloudflareinsights beacon ERR_BLOCKED_BY_CLIENT` is just the user's ad-blocker — NOT a bug.)

- [ ] **B24** The accel-test segment list doesn't stretch/scroll to fill the card as the card resizes. Make lists-in-cards share ONE "fill card height + scroll on overflow" layout (user: 「我好像不只一次提到這類議題」) — same pattern needed by B15's current-values grid and other in-card lists. Factor out a shared scroll/fill container.
- [ ] **B26** Accel-test card can focus a segment (highlights it on the map/chart) but has NO way to un-focus/cancel the focused segment. Add a clear/deselect.

## Charts (scatter)
- [ ] **B25** XY scatter's 3rd axis (colour) breaks once a 2nd track file is selected — the colour channel now collides with per-file identity colour. **DECIDED (user, 2026-07-12): marker SHAPE per file (circle/triangle/square…) + shape legend; colour stays fully on the 3rd-axis value gradient.** Implement accordingly.

## Card chrome
- [ ] **B27** Gear-ratio calculator, accel-test, and Sector cards show a stray horizontal bar/line at the TOP inside the card. Find + remove the artifact (likely a leftover element/border/empty header row in those panels).

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
