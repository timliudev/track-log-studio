# Track Log Studio User Manual

> This manual is a living document and will keep expanding as features land. If the UI differs slightly from this description, trust the actual app.

---

## 1. What it is

**Track Log Studio** is a **fully browser-based** track-log tool. No install, no account, and **none of your files are ever uploaded to a server** — all parsing, conversion, and analysis happen locally in your browser.

Two main features:

1. **Converter**: converts aRacer ECU `.loga` logs into a [RaceChrono](https://racechrono.com/) DIY-importable `.nmea` (NMEA 0183 + `$RC3` sensor slots), or into a Racelogic `.vbo` (for Circuit Tools 3 / RaceChrono).
2. **Analyzer**: view the track map, split laps, compare lap times, plot telemetry charts, and view a track heatmap, directly in the browser.

> **Trademark notice:** Track Log Studio is an independent, unofficial tool and is not affiliated with or endorsed by aRacer or RaceChrono; those names are used only to describe compatibility. aRacer and RaceChrono are trademarks of their respective owners.

---

## 2. Getting started

### 2.1 Opening the app

Just open the site in your browser — no sign-up or login needed. Recent versions of Chrome / Edge / Safari are recommended (phone, tablet, or desktop; the layout adapts automatically to screen size and can also be adjusted manually).

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

### 2.5 Supported export formats

- RaceChrono DIY `.nmea` (NMEA 0183 `$GPRMC` + `$RC3`)
- A calibrated `.loga` (derived channels such as suspension travel written back into a new `.loga`)
- Racelogic `.vbo` (`_ct.vbo` + `_rc.vbo` + a `_channels.csv` map)

---

## 3. Converter

The Converter turns `.loga` into an `.nmea` readable by RaceChrono, or into a `.vbo` readable by Circuit Tools 3.

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

If a log contains a `SuspensionAD` voltage channel, you can convert that voltage into travel (mm) under the Settings page's "Suspension calibration," producing a derived channel usable for both conversion and analysis (see section 5.3).

### 3.5 Batch convert and download

1. After setting up the output format (and the RC3 mapping, if applicable), click "Convert."
2. Once done, the "Results" section lists every output file — download each individually, or use "Download all (ZIP)" to get everything at once.

### 3.6 Saving a calibrated .loga

If you've enabled suspension calibration in Settings, and the loaded log contains the matching `SuspensionAD` channel, you can go to "Settings → Save calibrated .loga" to write the calibrated travel data into a **new** `.loga` (the original file is left untouched; existing matching columns are replaced, otherwise new ones are appended). Save a single file, or "Save all (ZIP)" to batch-export.

---

## 4. Analyzer

The Analyzer lets you view the track, split laps, and compare telemetry directly in the browser — no separate analysis software required.

### 4.1 Loading a log

Go to the "Analyzer" tab and use the "Load files" control at the top to pick a `.loga`, `.nmea`, `.vbo`, `.rcz`, `.xrk`, `.rcnx`, or `.zip` file (see section 2.4 for the full list). If nothing is loaded yet, the app prompts you to load a file first.

### 4.2 Track map

- **Zoom / pan**: scroll to zoom, drag to pan; on touch devices, pinch to zoom and drag to pan.
- **Reset view**: one click restores the default zoom and position (double-click the map also resets it).
- **Start/finish line**: drag the two endpoints on the track to set the start/finish line used for lap splitting; "Reset line" restores the default position.
- **Track colour / heatmap**: pick a channel (e.g. speed, brake, throttle) and the track line is colour-coded by that channel's value, making it easy to spot where a value is especially high or low along the track.
  - **Colormap**: switch between `turbo` (blue→green→yellow→red), `viridis` (colour-blind-friendly, purple→green→yellow), `plasma`, and `coolwarm`.
  - With no channel selected, the track is drawn as a plain, single-colour line.

### 4.3 Lap table

The app auto-splits laps based on the start/finish line (or the ECU's built-in lap markers — you can switch the source between "By line" and "ECU"), and lists them in the lap table:

- Default columns: **#** (lap number), **Lap time**, **Distance**.
- **Add column**: add a **Max / Min / Avg** column for any channel (e.g. "peak speed this lap"); columns can also be removed.
- **Markers**:
  - The fastest lap (⚡) and slowest lap (🐢) are marked automatically (excluded laps are not considered).
  - Each lap can be manually "excluded" (useful for track-cutting, pit-in/out, or start laps — excluded laps are omitted from the fastest-lap pick), and "re-included" later.
  - If sector gates are configured, laps that fail the sector check show an extra indicator (see section 4.5).
- **Selecting laps**: check laps in the table to include them in the overlay comparison mode in the charts below.
- **Empty list**: means no laps have been detected yet — drag the start/finish line, or switch the lap-split source.

#### Valid lap-time band filter

Set a min/max "Valid lap-time band (s)"; any lap outside that range is automatically treated as excluded — handy for filtering out obviously too-short/too-long junk laps (e.g. a lap that includes a pit stop) with one setting. "Clear band" removes the filter at any time. This exclusion is a union with manually excluded laps — a lap is excluded if either condition applies.

### 4.4 Charts

- **Add chart**: click "Add chart" to create a new time-series chart card; each chart independently picks which channel(s) to plot.
- **X-axis mode**: switch the horizontal axis between "Time" and "Distance."
- **View mode**:
  - **Timeline**: shows the raw time series for the whole session.
  - **Overlay**: select laps to compare in the lap table below, and the chart overlays them on one graph (colour = lap, line style = channel, X axis aligned from 0), making it easy to compare braking points, corner-exit speed, etc. across laps.
- **Cursor sync**: the cursor is linked across multiple charts and the track map, so you can see the same moment in time reflected on both the map and every chart.
- **Touch gestures**: pinch-to-zoom and drag-to-pan are supported for the chart's X-axis range (uPlot's built-in mouse drag-zoom is mouse-only, so touch devices get an equivalent gesture-based implementation).
- **Overlay alignment**: when comparing laps in overlay mode, if a slight time offset between laps causes corners/braking points to not line up, use "Shift earlier (left)" / "Shift later (right)" to nudge each lap's start offset individually so the features align — this does not affect actual lap times or track data. "Reset this lap" or "Reset all" undoes the nudges.
- **Map alignment**: if GNSS drift causes a lap's racing line to appear offset on the map relative to other laps, use "North / South / East / West" to nudge that lap's position on the map to realign it — again, this does not affect lap times or the underlying data. Each lap can be reset individually.

### 4.5 Sector gates (corner validation)

The Sector feature locates corners along the track and sets up a series of "gates" to check whether each lap actually drove through every corner in order (catching track-cutting or shortcuts that would otherwise be mistaken for a valid lap).

1. Click "Auto-detect corners" — the app analyzes the track and finds candidate corner locations.
2. Detected candidates appear in a list; "Accept" or "Reject" each one individually, or use "Accept all" / "Reject all" to handle them in bulk.
3. Accepted candidates become confirmed **sector gates**, and the count shows as "N sector gates confirmed."
4. **Drag to adjust**: confirmed sector gates can be dragged directly on the track map to reposition them (only confirmed gates are draggable — pending suggestions must be accepted first).
5. "Clear all" removes every confirmed gate at once, to start over.
6. Once gates are set, the lap table and stats show "N laps failed sector check" — meaning those laps' tracks didn't pass through all configured gates in order, which can indicate cutting a corner, missing part of the track, or a GPS glitch. This result also feeds into the overall lap-exclusion logic.

> This feature requires valid GPS track coordinates to work.

---

## 5. Settings

### 5.1 Theme and language

- **Theme**: Auto (follows system), Light, or Dark.
- **Language**: Auto (detected from browser locale) or manually switch between Traditional Chinese and English.

### 5.2 Time zone

Times shown in the Analyzer and Converter are converted according to the time zone set here: choose "Auto (browser)," or pick a whole-hour zone manually from UTC-12 to UTC+14.

### 5.3 Suspension calibration

Converts `SuspensionAD` voltage into travel (mm) as a derived channel, usable for both conversion and analysis:

- For "Front" and "Rear" independently:
  - **Enable**: whether calibration is applied to that axis.
  - **AD source**: which loga voltage channel it maps from.
  - **Min voltage / Max voltage (mv)**, **Zero voltage (mv)**: the voltage endpoints and zero point.
  - **Min travel / Max travel (mm)**: the corresponding real-world travel endpoints.
  - **Preview**: shows the resulting travel curve/values live, to sanity-check the calibration.
  - **Output channel**: shows the name of the channel that calibration will produce.
- **Recover from loaded log**: if the loaded log has both a `SuspensionAD` voltage channel and known ECU travel data, this feature can back-calculate the calibration parameters (r² is the goodness-of-fit; since the 5 parameters can't be uniquely recovered from the data, the result is shown under an assumed 0–5000mv voltage range). If there isn't enough data, nothing is configured, or travel is constant, it reports that recovery isn't possible.

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
| 轉檔器 | Converter | The tab that converts `.loga` into `.nmea` / `.vbo` |
| 分析器 | Analyzer | The tab for the track map, lap splitting, and chart analysis |
| 記錄檔 / 記錄 | Log | The uploaded raw track log file (`.loga`, etc.) |
| 圈次表 | Lap table | The table listing per-lap stats |
| 切西瓜 | Cutting the track / invalid lap | An abnormal lap where the driving line deviates from the real track (a shortcut); usually excluded manually or via sector checks |
| 排除（圈） | Exclude (lap) | Marking a lap so it's omitted from stats like the fastest lap |
| 起終點線 | Start/finish line | The reference line used to split laps; draggable |
| Sector 閘門 | Sector gate | Checkpoints placed along the track to verify a lap passed through every corner |
| 候選彎道 | Candidate corner / suggestion | An auto-detected corner awaiting manual confirmation as a sector gate |
| 疊圈 | Overlay (mode) | A chart view mode that overlays multiple laps' data on one graph |
| 時間軸 | Timeline (mode) | A chart view mode showing the raw time series for the whole session |
| 對位微調 | Alignment | Manually nudging the time or map offset between laps so feature points line up |
| 軌跡上色 / 熱力圖 | Track colour / heatmap | Colour-coding the track line by a channel's value |
| 色階 | Colormap | The gradient colour scheme used by the heatmap (turbo/viridis/plasma/coolwarm) |
| 避震校正 | Suspension calibration | Converting suspension voltage into travel (mm) |
| 欄位組合 / Preset | Preset | A saved RC3 field-mapping configuration |
| RC3 欄位對應 | RC3 field mapping | The configuration of which loga channel maps to which sensor slot in NMEA/RC3 output |
| 有效圈速區間 | Valid lap-time band | A lap-time filter range used to auto-exclude junk laps that are too short or too long |

---

*This manual covers the features currently implemented on the `develop` branch of Track Log Studio, and will keep being updated as new features ship.*
