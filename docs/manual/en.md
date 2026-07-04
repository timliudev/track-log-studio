# Track Log Studio User Manual

> This manual is a living document and will keep expanding as features land. If the UI differs slightly from this description, trust the actual app.

---

## 1. What it is

**Track Log Studio** is a **fully browser-based** track-log tool. No install, no account, and **none of your files are ever uploaded to a server** — all parsing, conversion, and analysis happen locally in your browser.

Two main features:

1. **Converter**: converts aRacer ECU `.loga` logs into a [RaceChrono](https://racechrono.com/) DIY-importable `.nmea` (NMEA 0183 + `$RC3` sensor slots), a Racelogic `.vbo` (for Circuit Tools 3 / RaceChrono), or a generic `.csv` (for Race Studio 3, Excel, Python, or any other tool).
2. **Analyzer**: view the track map, split laps, compare lap times, plot telemetry charts, and view a track heatmap, directly in the browser.

> **Trademark notice:** Track Log Studio is an independent, unofficial tool and is not affiliated with or endorsed by aRacer or RaceChrono; those names are used only to describe compatibility. aRacer and RaceChrono are trademarks of their respective owners.

---

## 2. Getting started

### 2.1 Opening the app

Just open the site in your browser — no sign-up or login needed. Recent versions of Chrome / Edge / Safari are recommended (phone, tablet, or desktop; the layout adapts automatically to screen size and can also be adjusted manually).

**Mobile navigation:** on narrow (roughly phone-sized, below 768px) screens, the Converter / Analyzer / Settings tabs move to an iOS-style bottom tab bar (padded for the iPhone home-indicator safe area) instead of the desktop top nav; tablet and desktop widths keep the top nav. Switching tabs plays a subtle slide + fade transition, which automatically simplifies to a plain fade if your system has "reduce motion" (prefers-reduced-motion) enabled.

### 2.2 Installing as an app (PWA)

This site is a **PWA (Progressive Web App)** and can be "installed" to your phone or desktop home screen, working like a native app:

- **Mobile (iOS / Android)**: in the browser menu, choose "Add to Home Screen" / "Install app."
- **Desktop (Chrome / Edge)**: an install icon appears on the right side of the address bar — click it to install.

Once installed, the app works **offline** (previously loaded pages and code are cached), but you still need to load your own log files each time you convert or analyze — log files themselves are not pre-cached or uploaded to any cloud.

### 2.3 Supported log sources

**Tested:**

| Source | Notes |
|---|---|
| RC super2 | read back via SpeedTuning 2 |
| RC superX | read back via SpeedTuningX |
| aRacer X tune App | exported via the share feature (you can upload the `.zip` directly — it's auto-extracted) |
| aRacer Logger 2.5 Module | read out via Logger2 Reader |

**Expected to work, untested:** RC super, RC superXX, RC mini X, RC mini XX, aRacer Race Module 3

### 2.4 Supported input formats

| Extension | Notes |
|---|---|
| `.loga` | aRacer ECU raw log (Super2 / SuperX / RaceAMP / aRacer X tune App headers all auto-detected) |
| `.nmea` | a previously converted NMEA/RC3 log |
| `.vbo` | Racelogic VBOX format (including files exported by this app, or from other sources) |
| `.rcz` | RaceChrono log (ZIP containing session.json + binary channel data) |
| `.xrk` | AiM Solo 2 DL / MyChron5 log |
| `.rcnx` | Qstarz LT-Q6000 / Q6000S (QRacing) log |
| `.zip` | a share-export from the aRacer x Tune app; auto-extracted and detected on upload |

The app auto-detects the format from the file extension and content on upload — you don't need to manually pick "which format to import."

#### RCNX multi-session files

A single `.rcnx` file can contain multiple sessions (separate recordings). If more than one session is detected, loading it opens a picker asking you to choose which one to open, listing each session's point count, duration (minutes), and whether it has lap data — the session with the most data is flagged as the recommended default. Click a session to open it, or "Cancel" to abandon the import. If that session's analysis data (the `sana` database) already contains lap records, lap boundaries are imported automatically from that source (i.e. ECU-based lap splitting — no need to drag the start/finish line manually).

### 2.5 Supported export formats

- RaceChrono DIY `.nmea` (NMEA 0183 `$GPRMC` + `$RC3`)
- Racelogic `.vbo` (`_ct.vbo` + `_rc.vbo` + a `_channels.csv` map)
- A generic `.csv` (for Race Studio 3 / Excel / Python and similar tools; `Time`/`GPS_Lat`/`GPS_Lon`/`GPS_Speed` plus every other channel, one row per sample)
- A modified `.loga` (derived channels such as suspension travel written back into a new `.loga`; only selectable when the original source is itself a `.loga`)

---

## 3. Converter

The Converter turns `.loga` into an `.nmea` readable by RaceChrono, a `.vbo` readable by Circuit Tools 3, or a generic `.csv`.

### 3.1 Loading files

1. Go to the "Converter" tab.
2. Click "Choose files" or drag and drop files onto the upload area; multiple `.loga` files can be selected at once.
3. Loaded files appear in the "Loaded files" list, showing row counts or a parsing/error state; each can be removed individually, or all cleared at once.

### 3.2 Choosing the output format

Under "Output format," choose:

- **NMEA / RC3**: outputs GPS (`$GPRMC`) plus a limited number of sensor slots (`$RC3`) for import into a RaceChrono DIY device. Requires manually setting up the "field mapping" below.
  - If the log has no GPS (no aRacer Race Module installed), sensor data can still be converted, but timestamps are synthesized from the conversion time.
- **VBO**: automatically exports **every** ECU channel — no field mapping needed. Each `.loga` produces three files:
  - `_ct.vbo` (for Circuit Tools, keeps original ECU channel names)
  - `_rc.vbo` (for RaceChrono, channels named with RaceChrono identifiers)
  - `_channels.csv` (a channel cross-reference: ECU channel / description / RaceChrono id / unit / type)
- **CSV**: automatically exports **every** channel (including derived suspension channels) — no field mapping needed, and no target-app naming constraints beyond Race Studio 3. Each `.loga` produces one `.csv`: columns are `Time`, `GPS_Lat`, `GPS_Lon`, `GPS_Speed`, followed by every other channel (named with its original aRacer channel name), one row per sample. Rows with no GPS fix leave the lat/lon cells empty; samples with no value are left empty too (never `0`). Line endings are `\n` (LF only), UTF-8 without a BOM.
- **Save modified (.loga)**: writes calibrated suspension travel (and other derived channels) back into a new `.loga` (the original file is left untouched). **Only selectable when the currently loaded source is itself a `.loga`** — if the source is another format (`.nmea`/`.vbo`/`.rcz`/`.xrk`/`.rcnx`), this option is shown disabled with a hint. See section 3.6.

### 3.3 RC3 field mapping (NMEA mode only)

Each NMEA/RC3 record only has room for a fixed number of sensor slots, so you need to manually specify which loga channel goes into which slot:

- **Fixed fields (auto-filled)**:
  - Accel `xacc/yacc/zacc` ← `TC_Xforce/Yforce/Zforce` ÷ 1000 (requires Race Module IMU; left empty otherwise)
  - Gyro `gyrox/y/z` ← `TC_Xangle_dps/Yangle_dps/Zangle_dps` (same, requires IMU)
  - `rpm/d1` ← `RPM`
- **Custom slots**: pick a loga channel for each slot one by one — you can search by channel name, or choose "(unused)" to leave a slot empty.

#### Presets (field combinations)

So you don't have to redo the mapping every time, field mappings can be saved as a "preset":

- The current-preset dropdown switches between **Default**, **Custom (unsaved)**, and **User 1–5**.
- After you change the mapping, the dropdown shows "Custom (unsaved)" — at that point you can "Save to" one of User 1–5 and give it a name.
- "Reset to default" restores the current mapping to the system default at any time.

### 3.4 Suspension calibration

If a log contains a `SuspensionAD` voltage channel, you can convert that voltage into travel (mm) using the collapsible "Suspension calibration" section below the converter's main controls, producing a derived channel usable for both conversion and analysis (see section 3.4.1). Suspension settings are shared app-wide (the Analyzer reads the same configuration) — only the controls live on the Converter tab.

#### 3.4.1 Suspension calibration parameters

Converts `SuspensionAD` voltage into travel (mm) as a derived channel, usable for both conversion and analysis:

- For each of "Front" and "Rear" independently:
  - **Enable**: whether calibration is applied to that axis.
  - **AD source**: which loga voltage channel it maps to.
  - **Min voltage / Max voltage (mv)**, **Zero voltage (mv)**: voltage endpoints and zero point.
  - **Min travel / Max travel (mm)**: the corresponding physical travel endpoints.
  - **Preview**: shows the resulting travel curve/values live, to sanity-check the calibration.
  - **Output channel**: shows the name of the channel that calibration will produce.
- **Recover from loaded log**: if the loaded log has both a `SuspensionAD` voltage channel and known ECU travel data, this feature can back-calculate the calibration parameters (r² is the goodness-of-fit; since the 5 parameters can't be uniquely recovered from the data, the result is shown under an assumed 0–5000mv voltage range). If there isn't enough data, nothing is configured, or travel is constant, it reports that recovery isn't possible.

### 3.5 Batch convert and download

1. After setting up the output format (and the RC3 mapping, if applicable), click "Convert."
2. Once done, the "Results" section lists every output file — download each individually, or use "Download all (ZIP)" to get everything at once.

### 3.6 Saving a modified .loga

If the currently loaded source is itself a `.loga`, choose "Save modified (.loga)" under "Output format"; if you've also enabled suspension calibration (section 3.4) and the log contains the matching `SuspensionAD` channel, this writes the calibrated travel data into a **new** `.loga` (the original file is left untouched; existing matching columns are replaced, otherwise new ones are appended). Save a single file, or "Save all (ZIP)" to batch-export. If the original source isn't a `.loga` (e.g. `.nmea`/`.vbo`/`.rcz`/`.xrk`/`.rcnx`), this format option is disabled.

---

## 4. Analyzer

The Analyzer lets you view the track, split laps, and compare telemetry directly in the browser — no separate analysis software required.

### 4.1 Loading a log

Go to the "Analyzer" tab and use the "Load files" control at the top to pick a `.loga`, `.nmea`, `.vbo`, `.rcz`, `.xrk`, `.rcnx`, or `.zip` file (see section 2.4 for the full list). If nothing is loaded yet, the app prompts you to load a file first.

### 4.2 Track map

- **Zoom / pan**: scroll to zoom, drag to pan; on touch devices, pinch to zoom and drag to pan.
- **Reset view**: one click restores the default zoom and position (double-click the map also resets it).
- **Start/finish line**: drag the two endpoints on the track to set the start/finish line used for lap splitting; "Reset line" restores the default position.
- **Track channel markers**: see section 4.6 — track colouring and extrema marking are now a single "pick a channel" control.

### 4.3 Lap table

The app auto-splits laps based on the start/finish line (or the ECU's built-in lap markers — you can switch the source between "By line" and "ECU"), and lists them in the lap table:

- Default columns: **#** (lap number), **Lap time**, **Distance**.
- **Add column**: add a **Max / Min / Avg** column for any channel (e.g. "peak speed this lap"); columns can also be removed.
- **Add sector time**: requires at least one sector gate (see section 4.5); once added, pick "Sector 1," "Sector 2," etc. from the dropdown to show the time taken through that segment on each lap.
- **Add delta**: adds a "Delta" column showing each lap's time relative to the fastest lap currently in the (non-excluded) list — a positive value means slower than the fastest lap.
- **Markers**:
  - The fastest lap (⚡) and slowest lap (🐢) are marked automatically (excluded laps are not considered).
  - Each lap can be manually "excluded" (useful for track-cutting, pit-in/out, or start laps — excluded laps are omitted from the fastest-lap pick), and "re-included" later.
  - If sector gates are configured, laps that fail the sector check show an extra indicator (see section 4.5).
- **Selecting laps**: check laps in the table to include them in the overlay comparison mode in the charts below.
- **Empty list**: means no laps have been detected yet — drag the start/finish line, or switch the lap-split source.

#### Valid lap-time band filter

Set a min/max "Valid lap-time band (s)"; any lap outside that range is automatically treated as excluded — handy for filtering out obviously too-short/too-long junk laps (e.g. a lap that includes a pit stop) with one setting. "Clear band" removes the filter at any time. This exclusion is a union with manually excluded laps — a lap is excluded if either condition applies.

### 4.4 Charts

- **Add chart**: click "Add chart" to create a new time-series chart card; each chart independently picks which channel(s) to plot. Click "Add XY scatter chart" instead to create a scatter chart card (see "XY scatter chart" below). Both chart types can coexist as multiple independent cards, each with its own settings and its own "Remove" button.
- **X-axis mode**: switch the horizontal axis between "Time" and "Distance."
- **View mode**:
  - **Timeline**: shows the raw time series for the whole session.
  - **Overlay**: select laps to compare in the lap table below, and the chart overlays them on one graph (colour = lap, line style = channel, X axis aligned from 0), making it easy to compare braking points, corner-exit speed, etc. across laps.
- **Cursor sync**: the cursor is linked across multiple time-series charts and the track map, so you can see the same moment in time reflected on both the map and every chart. (An XY scatter chart's X/Y axes are two freely chosen channels with no time/distance meaning, so it does not participate in this shared cursor or in shared chart-zoom syncing.)
- **Touch gestures**: pinch-to-zoom and drag-to-pan are supported for the chart's X-axis range (uPlot's built-in mouse drag-zoom is mouse-only, so touch devices get an equivalent gesture-based implementation).
- **Overlay alignment**: when comparing laps in overlay mode, if a slight time offset between laps causes corners/braking points to not line up, use "Shift earlier (left)" / "Shift later (right)" to nudge each lap's start offset individually so the features align — this does not affect actual lap times or track data. "Reset this lap" or "Reset all" undoes the nudges.
- **Map alignment**: if GNSS drift causes a lap's racing line to appear offset on the map relative to other laps, use "North / South / East / West" to nudge that lap's position on the map to realign it — again, this does not affect lap times or the underlying data. Each lap can be reset individually.
- **Chart box-zoom → map focus**: when you box-select (drag-zoom, or pinch on touch) a sub-range on a Timeline chart while **no laps are checked** in the lap table, the track map highlights the corresponding stretch of track and auto-fits/zooms to it. If laps are checked, the overlay-selection highlight on the map takes precedence and the box-zoom focus is not shown.

#### XY scatter chart

The XY scatter chart is its own chart type: the X and Y axes can be **any two channels** you like (not limited to force channels), so besides the "G-G diagram / friction circle" featured below, it's equally useful for e.g. plotting "RPM vs. speed" or any other channel pair.

- **Add**: click "Add XY scatter chart" to create a scatter chart card; you can add multiple, each with independently chosen X/Y channels.
- **Channel pickers**: X and Y are each picked from the full channel list (searchable); the chart only renders once both are chosen.
- **Adaptive axis rule**: when **both** the X and Y channels are signed, force-like data (values spanning both positive and negative, e.g. `TC_Xforce`/`TC_Yforce`), the chart uses square, zero-centred symmetric axes — the classic G-G diagram / friction-circle look, which makes it easy to compare grip symmetry between left/right or braking/acceleration. Any other channel pairing (e.g. RPM vs. speed) uses normal auto-ranged axes instead, with no forced centring or square aspect.
- **G-G diagram / friction circle (featured example)**: when adding a new scatter chart, if the session has `TC_Xforce`/`TC_Yforce` (aRacer Race Module IMU lateral/longitudinal G, stored in milli-g), those two channels are pre-selected and automatically converted to g units — this is the classic "G-G diagram," plotting the lateral G (cornering) and longitudinal G (braking/accelerating) the car experienced around the track. A shape closer to a full circle indicates more balanced tyre grip usage. If laps are checked in the lap table, each lap is coloured separately for comparison; otherwise the whole session's distribution is shown.
- If the session doesn't have `TC_Xforce`/`TC_Yforce`, the X/Y pickers start empty and you choose whichever two channels you want to compare.
- **Loading hint**: the scatter-chart plotting library (echarts) is fairly large, so it's now loaded on demand the first time you add a scatter chart, rather than as part of the initial page load. The first "Add XY scatter chart" click briefly shows a loading indicator inside the card; adding further scatter charts in the same browsing session won't wait again.

### 4.5 Sector gates (corner validation)

The Sector feature sets up a series of "gates" along the track to check whether each lap actually drove through every corner in order (catching track-cutting or shortcuts that would otherwise be mistaken for a valid lap). Gates can be auto-detected, manually added/removed, or dragged into place at any time — there's no separate "confirm before use" step.

1. Click "Auto-detect corners" — the app analyzes the track and **immediately** sets the detected corner positions as the current sector gates (no per-item review needed). The gate list shows numbered entries right away, they're drawn on the map right away, and lap sector timing/validity apply the new gates right away.
2. The current gate count shows as "N sector gates," with each gate listed below by number.
3. **Add a gate**: click "+ Add gate" to insert a new gate at the track position under the current map cursor (or near the middle of the reference lap if you haven't hovered the map yet); its orientation is set automatically to match the local direction of travel.
4. **Remove a gate**: each entry in the gate list has a "✕" button to remove that gate individually.
5. **Drag to adjust**: any gate can be dragged directly on the track map to reposition either endpoint (same as the start/finish line).
6. After adding, removing, or dragging a gate, the set is **automatically re-sorted** by each gate's actual position along the direction of travel on the reference lap — sector order (which sector timing and validity both depend on) always stays correct without any manual reordering.
7. "Clear all" removes every gate at once, to start over.
8. **Re-running auto-detect**: if the current gate set has been manually added to/removed from/dragged since the last detect, clicking "Auto-detect corners" again first asks for confirmation (so a manual adjustment isn't accidentally overwritten). If nothing has been manually edited yet (e.g. right after a detect, or right after restoring a saved circuit), the new detection result applies immediately.
9. Once gates are set, the lap table and stats show "N laps failed sector check" — meaning those laps' tracks didn't pass through all configured gates in order, which can indicate cutting a corner, missing part of the track, or a GPS glitch. This result also feeds into the overall lap-exclusion logic.
10. **Theoretical best lap**: once at least one sector gate exists, the Sector panel shows a "Theoretical best lap" — a hypothetical lap time made by summing the best time recorded in each sector across all non-excluded laps, along with which lap owns each sector's best time. If there isn't enough lap data yet to compute it, a message explains that it can't be calculated.

> This feature requires valid GPS track coordinates to work.

### 4.6 Track channel markers

Below the Sector panel, the "Track channel markers" panel lets you pick **one channel** (speed, RPM, G, brake, throttle — any channel), then independently check any combination of three options:

- **Track colour**: colour-code the track polyline by that channel's value (this is the same heatmap feature from section 4.2, now consolidated into this one panel).
  - **Colormap**: switch between `turbo` (blue→green→yellow→red), `viridis` (colour-blind-friendly, purple→green→yellow), `plasma`, and `coolwarm`.
- **Mark minima**: mark the channel's local minimum points on the track map (e.g. picking the speed channel reproduces the old "corner apex" minimum-speed markers).
- **Mark maxima**: mark the channel's local maximum points on the track map (e.g. RPM peaks on each shift point).
- Both marker kinds can be shown at once; minima are drawn as **circles** and maxima as **diamonds** on the map, colour-coded by value (green → red) so they're distinguishable at a glance. Each kind is numbered independently (minima #1, #2, … and maxima #1, #2, … don't share a sequence).
- Below the toggles, a list shows each marker's **kind** (min/max), **lap distance** (km), and **value**.
- **Markers are only shown when exactly one lap is checked**: with no lap selected, or multiple laps selected, a hint asks you to check a single lap first; if no channel is picked yet, a hint asks you to pick one. Track colouring isn't subject to this rule — it applies to the whole track even with no lap selected.
- The old "corner speed markers" feature is now just "pick the speed channel + check Mark minima" — it isn't a separate feature anymore.

### 4.7 Acceleration test

Below the track-channel-markers panel, search the **entire session** (not limited to one lap) for the best-matching acceleration segment:

- **Condition type**:
  - **Distance**: enter a target distance (metres); the app finds the fastest segment anywhere in the session that covers that distance. Optionally set a "minimum entry speed" to only consider segments that start at or above that speed (leave blank for no limit, including a standing start).
  - **Speed range**: enter a "from" and "to" speed (km/h); the app finds the fastest segment that accelerates from the first speed to the second.
- Once a best segment is found, it shows: **elapsed time**, **distance**, and **entry → exit speed**.
- "Focus this segment": zooms the charts and map to where this best segment occurred.
- Requires a speed channel (`GPS_Speed` or `Vehicle_Speed`); if no segment in the whole session matches the condition, a "no match" hint is shown.

### 4.8 Gear ratio calculator

Below the acceleration test panel, a motorcycle drivetrain gear-ratio calculator is available in two modes (tab toggle):

- **MT (chain-drive geared bike)**: enter the primary reduction ratio, each gear's ratio (1–6 gears, count adjustable), final-drive sprocket teeth (front/rear), rear wheel circumference (mm), and redline/shift RPM. This produces:
  - A per-gear table of **total reduction** and **speed at redline** (click a row to expand a compact RPM↔speed lookup table for that gear).
  - The **theoretical top speed** (top gear's speed at redline).
  - The **RPM drop on each upshift** (e.g. how far RPM falls shifting 1st→2nd at redline).
- **CVT (scooter)**: enter the CVT ratio range (low/high), final/gear reduction, wheel circumference, and engine max RPM. This produces the speed range at max RPM across the CVT's ratio span (the high-ratio end is the top speed).

**Recover ratio from recording** (shown only when a session is loaded and it has both an RPM (`RPM`) and a speed (`GPS_Speed` / `Vehicle_Speed`) channel):

- Enter the wheel circumference; the app computes `ratio(t) = engine RPM / wheel RPM` (wheel RPM derived from road speed) at every sample across the whole recording, automatically filtering out samples below 5 km/h (standing starts, clutch slip) and any non-finite RPM/speed values as noise.
- **MT mode**: the filtered ratio samples are clustered (3% tolerance) to find the most stable "plateaus" — the actual total reduction per gear — shown side-by-side with the calculator's configured values above (detected vs. configured), useful for checking whether the real drivetrain ratio has drifted from the nominal spec (tyre wear, sprocket swaps, etc).
- **CVT mode**: plots "speed vs. ratio" as a scatter (reusing the existing UPlotChart component), showing how the CVT's ratio varies continuously with road speed.

Validated against a real .loga recording containing acceleration-test segments: with a gear-count hint (e.g. 6), the detector found 6 plateaus spaced roughly 5–13% apart from each other — consistent with real motorcycle gear spacing. Without a gear-count hint, a continuous acceleration ramp gets sliced into many small plateaus (since the ramp itself is near-continuous) — so a gear-count hint (or a wider tolerance) matters for acceleration-heavy recordings.

### 4.9 Local persistence and track files

The Analyzer identifies "which circuit this is" from GPS location, and automatically saves that circuit's start/finish line, sector gates, and lap-table column setup locally in the browser (IndexedDB). The next time you load a log recorded at the same circuit (same GPS location), these settings are **restored automatically** — no need to redrag the start/finish line or re-detect corners.

"Track setup" is one of the Analyzer's cards (see §4.10 "Layout" — cards can be freely dragged around, so there's no longer a fixed order), and offers:

- **Export track setup**: bundles the current circuit's start/finish line, sector gates, and lap-table columns into a JSON "track file" you can download for backup or to share with someone else.
- **Import track setup**: import a previously exported JSON track file; if it matches the circuit currently open, it's applied immediately.
- **Saved circuits list**: expand "N saved track setups" to see each saved circuit's name and last-updated time, with a "Delete" button for each.
- If the current log has no valid GPS coordinates, the circuit can't be identified, so export is disabled and a hint is shown instead.

> The gear ratio calculator's inputs (MT/CVT choice, per-gear ratios, wheel circumference, etc.) are automatically saved in the browser (localStorage) and persist across reloads and closed tabs — no need to re-enter them each time. This is a vehicle-spec setting, stored separately from the track setup above (which uses IndexedDB, keyed by circuit GPS location).

### 4.10 Layout (desktop drag/resize grid)

On wider screens (desktop), every Analyzer panel — the track map, lap table, sector gates, track channel markers, acceleration test, gear ratio calculator, track setup, map alignment, lap overlay alignment, and each chart — is its own card that you can **drag to rearrange** and **resize**, so you can put the panels you care about side by side and make good use of a wide screen's space instead of scrolling a single long column.

- **Drag to move**: press and drag a card's **title bar** (the strip at the top with the card's name) to move it; interacting with a card's content (panning/zooming the map, clicking a table row) does not start a drag.
- **Drag to resize**: hover the card's **bottom-right corner** until the resize cursor appears, then drag to resize; the map and charts redraw immediately to fit the new size without blurring or misalignment.
- **Auto-saved**: the layout (every card's position and size) is automatically saved in the browser (localStorage) and persists across reloads and closed tabs.
- **Reset layout**: the "Reset layout" button in the toolbar restores the default arrangement (map and lap table in the left column, charts and tool panels in the right column).
- **Adding chart cards**: a chart added via "Add chart" / "Add XY scatter chart" gets a default position in the layout automatically; removing a chart also removes its layout entry.
- **Collapsing a card**: every card's title bar has a collapse/expand button (chevron) on the right — click it to hide the card's content and keep just the title bar, useful for tidying up cards you don't need right now. Works on both desktop and mobile; the collapsed state is saved automatically.

#### Mobile: single column + collapse + pin

Below roughly 768px wide, the layout automatically collapses to a single column, ordered by the logical order derived from the desktop layout, and **dragging/resizing are disabled** (rearranging doesn't apply in a fixed single-column order). Mobile additionally offers:

- **Collapsing a card**: same as desktop — tap a card's chevron to collapse/expand its content, handy for skipping past sections you don't need right now in the single column.
- **Pinning a card**: on mobile, every card's title bar also has a pin button. Tap it and that card becomes **stuck to the top of the screen** (sticky) while the rest of the cards keep scrolling normally underneath it — for example, pin the "Track map" card so it stays visible while you scroll down to check the XY scatter chart or the lap table.
  - Only **one card can be pinned at a time** — pinning a different card automatically unpins the previous one.
  - A pinned card's height is capped at roughly 45% of the screen (`max-height: 45vh`) so it doesn't take over the whole screen and block scrolling to the rest of the content.
  - Tap the pin button again to unpin.
  - Collapse and pin state are each saved in the browser (localStorage) and persist across reloads and closed tabs.

---

## 5. Settings

### 5.1 Theme and language

- **Theme**: Auto (follows system), Light, or Dark.
- **Language**: Auto (detected from browser locale) or manually switch between Traditional Chinese and English.

### 5.2 Time zone

Times shown in the Analyzer and Converter are converted according to the time zone set here: choose "Auto (browser)," or pick a whole-hour zone manually from UTC-12 to UTC+14.

> Suspension calibration and saving a modified `.loga` have moved to the Converter tab (see sections 3.4 and 3.6) — Settings now only holds general app settings such as theme, language, and time zone.

---

## 6. Troubleshooting

### 6.1 Diagnostics mode `?debug=1`

If you hit an issue on mobile — for example, the page reloading itself right after loading a file — append `?debug=1` to the URL (e.g. `https://track-log-studio.timliudev.workers.dev/?debug=1`) to enable the **on-device diagnostics panel**:

- It logs page lifecycle events (e.g. the tab being discarded by the OS — `wasDiscarded` — JS errors, memory usage trends) and displays them on screen *after* a reload happens, so issues can be reported even without a desktop DevTools connection.
- Once enabled via `?debug=1`, the setting sticks (stored locally in the browser), so you don't need to add the parameter every time; use `?debug=0` to turn it off.
- Regular users don't need to enable this.

### 6.2 Mobile notes

- Parsing and rendering large logs on a mobile browser is memory-intensive; if the page reloads unexpectedly, try installing the app as a PWA, closing other tabs to free memory, or use `?debug=1` above to help report the issue.
- Touch input: both the track map and charts support pinch-to-zoom and drag-to-pan; dragging the start/finish line and sector gates also works on touch devices.

### 6.3 Version info

The footer at the bottom of the page shows "build \<sha\> · \<date\>." Include this when reporting an issue, so it can be matched to the exact build.

---

## 7. Glossary

| Traditional Chinese | English | Meaning |
|---|---|---|
| 轉換 | Converter | The tab that converts `.loga` into `.nmea` / `.vbo` |
| 分析 | Analyzer | The tab for the track map, lap splitting, and chart analysis |
| 記錄檔 / 記錄 | Log | The uploaded raw track log file (`.loga`, etc.) |
| 圈次表 | Lap table | The table listing per-lap stats |
| 切西瓜 | Cutting the track / invalid lap | An abnormal lap where the driving line deviates from the real track (a shortcut); usually excluded manually or via sector checks |
| 排除（圈） | Exclude (lap) | Marking a lap so it's omitted from stats like the fastest lap |
| 起終點線 | Start/finish line | The reference line used to split laps; draggable |
| Sector 閘門 | Sector gate | Checkpoints placed along the track to verify a lap passed through every corner; can be auto-detected, manually added/removed, or dragged |
| 疊圈 | Overlay (mode) | A chart view mode that overlays multiple laps' data on one graph |
| 時間軸 | Timeline (mode) | A chart view mode showing the raw time series for the whole session |
| 對位微調 | Alignment | Manually nudging the time or map offset between laps so feature points line up |
| 軌跡上色 / 熱力圖 | Track colour / heatmap | Colour-coding the track line by a channel's value |
| 色階 | Colormap | The gradient colour scheme used by the heatmap (turbo/viridis/plasma/coolwarm) |
| 軌跡通道標記 | Track channel markers | The unified panel: pick one channel, then independently toggle track colouring / mark minima / mark maxima |
| 避震校正 | Suspension calibration | Converting suspension voltage into travel (mm) |
| 欄位組合 / Preset | Preset | A saved RC3 field-mapping configuration |
| RC3 欄位對應 | RC3 field mapping | The configuration of which loga channel maps to which sensor slot in NMEA/RC3 output |
| 有效圈速區間 | Valid lap-time band | A lap-time filter range used to auto-exclude junk laps that are too short or too long |
| 理論最佳圈 | Theoretical best lap / optimal lap | A hypothetical lap time made by summing each sector's best recorded time |
| 差距 | Delta | A lap's time difference from the current fastest lap; positive means slower |
| 極值標記 | Extremum marker | A map marker showing a channel's local minimum/maximum point (circle = minimum, diamond = maximum) |
| 直線加速測試 | Acceleration test | Searches the whole session for the best segment matching a distance or speed-range condition |
| XY 散佈圖 | XY scatter chart | A chart type that plots any two freely chosen channels against each other; does not participate in the shared cursor/zoom syncing between charts |
| G-G 圖／摩擦圓 | G-G diagram / friction circle | The featured use of the XY scatter chart: lateral G vs. longitudinal G, showing how evenly tyre grip is used |
| 軌跡檔 | Track file | An exported/imported JSON track setup (start/finish line + sector gates + lap-table columns) |
| RCNX 多 session | RCNX multi-session | A single `.rcnx` file containing multiple recordings; you pick one on load |

---

*This manual covers the features currently implemented on the `develop` branch of Track Log Studio, and will keep being updated as new features ship.*
