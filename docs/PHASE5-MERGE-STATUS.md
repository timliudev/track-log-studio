# Phase 5 原型 — GPS 合併 (.loga + .nmea time-align merge)

Status: domain core done + tested; UI not wired (ran out of time budget).

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
