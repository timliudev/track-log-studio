# Phase 5 原型 — GPS 合併 (.loga + .nmea time-align merge)

Status: domain core done + tested; UI wired (T6, branch `feature/phase5-merge-ui`,
see below — "UI wired" section).

## Built (this session, branch `feature/phase5-merge`)

- `src/domain/analysis/sessionAlign.ts` — `crossCorrelateOffset(refSpeed, refTimeMs, otherSpeed, otherTimeMs, {maxLagMs, stepMs})`.
  Resamples both speed series onto a common fixed-step grid (linear interp, padded by `maxLagMs` on each side), z-score
  normalizes, scans integer-sample lags in `[-maxLagMs, +maxLagMs]` by `stepMs`, returns `{offsetMs, score}` for the lag with
  highest normalized cross-correlation. `offsetMs` is defined as "add to `other`'s time axis to match `ref`'s clock".
  Returns `null` for empty/too-short/zero-variance series or invalid options. 10 tests in `test/analysis/sessionAlign.test.ts`.

- `src/domain/analysis/sessionMerge.ts` — `mergeSessions(base, gps, {offsetMs, gpsChannelNames?})`.
  Takes a structural `ChannelSource` (channels + `get()` + `timeChannel`, satisfied directly by `LogSession`), resamples
  `GPS_Lat/GPS_Lon/GPS_Speed/GPS_Course` (default set, `GPS_CHANNEL_NAMES`) from `gps` onto `base`'s own time axis with the
  offset applied, linear interp, NaN outside `gps`'s covered range. Base channels are returned untouched (same array
  references); an existing same-named channel in `base` (e.g. a broken `GPS_Lat`) is replaced rather than duplicated.
  11 tests in `test/analysis/sessionMerge.test.ts`.

Both are pure, dependency-free of Pinia/Vue — safe to unit test directly and to call from a store action later.

Full suite: 430/430 green, `npm run typecheck` clean, no new npm deps.

## Suggested next steps (not started)

1. **UI wiring** — a "合併 GPS" action, gated on `fileStore.readySessions` containing at least one session with
   `meta.formatId === 'nmea'` and one loga-family session (`formatId !== 'nmea'` and truthy). Likely lives near
   `fileStore.ts` (see `readySessions`/`readyLogaFiles` computed there) — probably a new `sessionMerge` store or an action
   added to an existing store, plus a small panel/dialog to pick which two sessions to merge.
2. **Wire the two functions together**: pull `GPS_Speed` (or best-available speed channel) + `Time` from each session,
   call `crossCorrelateOffset`, feed the resulting `offsetMs` into `mergeSessions`, then wrap the returned `Channel[]` in a
   new `LogSession` (reuse `base.meta`, or tag `formatId`/`headerInfo` to note it's a merged session).
3. **Manual fine-tune nudge UI** — since `mergeSessions` takes `offsetMs` directly (decoupled from alignment), a slider/
   +/- buttons to nudge the auto-detected offset and re-preview (e.g. overlay GPS track or speed traces) before committing,
   without re-running correlation each nudge.
4. **Export of merged session** — once a merged `LogSession` exists, it should be exportable the same way as any other
   session (check `src/domain/export/registry.ts` / `rc3Nmea.ts` for the existing .nmea export path) so the user can save
   the merged result, not just view it in-app.
5. **Speed channel choice for correlation** — current suggestion is `GPS_Speed` from the nmea side vs whatever speed
   channel the loga session has (wheel speed / `Speed` canonical channel — check `canonical.ts` aliases); may need a
   fallback chain if a session lacks a speed-like channel entirely.
6. Consider exposing `maxLagMs`/`stepMs` as tunable (defaults untested end-to-end against real files yet — pick generous
   `maxLagMs` e.g. 60000 for "recorder started at a very different time", `stepMs` e.g. 100 for the initial UI default,
   trading precision for scan speed).

## UI wired (T6, branch `feature/phase5-merge-ui`)

Implements suggested steps #1–#3 and #6 above (not format-gated per #1 — any two
ready sessions can be picked, not just nmea+loga specifically) and #4 for free
(merged session goes through the normal fileStore/converter export path, no new
export code needed):

- `src/composables/useSessionMerge.ts` — orchestrates the two domain functions:
  lists every ready file as a merge candidate (flagging whether
  `resolveSpeedChannel` finds a usable speed channel), `autoAlign()` runs
  `crossCorrelateOffset` with generous defaults (`maxLagMs: 60000`,
  `stepMs: 100`, suggestion #6), `nudge(deltaMs)` adjusts `offsetMs` without
  re-aligning (#3), `merge()` calls `mergeSessions` and registers the result via
  a new `fileStore.addMergedSession(name, session)` action. 8 tests in
  `test/composables/useSessionMerge.test.ts`.
- `src/stores/fileStore.ts` — `addMergedSession`: registers an in-app-produced
  `LogSession` (no original `File`) straight to `ready`; new `fileType: 'merged'`
  variant naturally excludes it from `savableEntries` (no source .loga text to
  patch) while it still appears in `readyFiles`/`readySessions` for the analyzer
  and any export-registry format (#4).
- `src/features/analyzer/SessionMergePanel.vue` — new dashboard card
  (`STATIC_CARD_IDS.sessionMerge`, always visible like the track-file/gear
  panels, not gated on lap selection): base/GPS session pickers, 自動對齊
  button, offset readout + ±100ms nudge buttons + correlation score, merge
  button, and a confirmation message naming the new record.
- i18n: `analyzer.sessionMerge.*` + `analyzer.layout.cardSessionMerge` added to
  both `zh-Hant.ts` and `en.ts`.

Full suite: 711/711 green (was 430 at end of previous session — includes all
work landed on develop since, plus this task's 9 new tests), `vue-tsc --noEmit`
clean, `npm run build` clean, no new npm deps.

Not done / left for a follow-up:
- Manual browser/visual acceptance of the new panel — the sandboxed preview
  browser used during this task got stuck mid-`<Transition mode="out-in">`
  navigating away from the Converter tab (reproduces on an unmodified checkout
  too, i.e. pre-existing environment quirk, not caused by this change), so the
  panel's live look/interaction was verified by code review + unit tests only,
  not by clicking through it in a real browser.
- No preview/overlay of the merged GPS track before committing (suggestion #3's
  "e.g. overlay GPS track or speed traces" preview) — only the numeric offset +
  correlation score are shown; the merge itself is cheap enough to redo if the
  result looks wrong (just re-merge with a different offset).
- Speed-channel choice for correlation is exactly `resolveSpeedChannel` (GPS_Speed
  → Vehicle_Speed) on both sides, unchanged from the original suggestion (#5) —
  no additional fallback chain was added.
