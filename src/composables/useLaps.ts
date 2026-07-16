import { computed, watch, type ComputedRef } from 'vue'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLapStore } from '@/stores/lapStore'
import { timeSeconds } from '@/domain/analysis/timeAxis'
import { detectLapsByChannel, detectLapsByLine, inferLapLineFromChannel, type LapLine } from '@/domain/analysis/laps'
import { suggestLapTimeBand, suggestLapDistanceBand } from '@/domain/analysis/lapValidity'
import { resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'
import { toRadians } from '@/domain/export/rc3Nmea/geo'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'

/** Index of the first valid fix, or -1 when the track has none. */
function firstValidIdx(track: GpsTrack): number {
  for (let i = 0; i < track.valid.length; i++) if (track.valid[i]) return i
  return -1
}

/**
 * A small default start/finish line: centred on the first valid fix and drawn
 * perpendicular to the initial heading (from the first two valid fixes). Its
 * half-length is a small fraction of the track's lat/lon bbox diagonal, scaled
 * by cos(lat) on the longitude axis so it looks perpendicular on screen.
 * Returns null if there are fewer than two valid fixes.
 */
function defaultLine(track: GpsTrack): LapLine | null {
  const i0 = firstValidIdx(track)
  if (i0 < 0) return null
  let i1 = -1
  for (let i = i0 + 1; i < track.valid.length; i++) {
    if (track.valid[i]) {
      i1 = i
      break
    }
  }
  if (i1 < 0) return null

  // bbox over valid fixes for a length reference.
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (let i = 0; i < track.valid.length; i++) {
    if (!track.valid[i]) continue
    if (track.lat[i] < minLat) minLat = track.lat[i]
    if (track.lat[i] > maxLat) maxLat = track.lat[i]
    if (track.lon[i] < minLon) minLon = track.lon[i]
    if (track.lon[i] > maxLon) maxLon = track.lon[i]
  }

  const lat0 = track.lat[i0]
  const lon0 = track.lon[i0]
  const cosLat = Math.cos(toRadians(lat0))

  // Heading vector in planar (cos-lat scaled) space.
  const hx = (track.lon[i1] - track.lon[i0]) * cosLat
  const hy = track.lat[i1] - track.lat[i0]
  const hlen = Math.hypot(hx, hy) || 1
  // Perpendicular unit vector (planar).
  const ux = -hy / hlen
  const uy = hx / hlen

  // Half-length ~ 10% of the bbox diagonal (planar units).
  const diag = Math.hypot((maxLon - minLon) * cosLat, maxLat - minLat)
  const half = (diag || 1e-4) * 0.1

  // Convert planar offset back to lat/lon (undo cos-lat on the longitude axis).
  const dLon = (ux * half) / cosLat
  const dLat = uy * half

  return {
    a: { lat: lat0 + dLat, lon: lon0 + dLon },
    b: { lat: lat0 - dLat, lon: lon0 - dLon },
  }
}

/**
 * Lap detection wiring for the analyzer: exposes a millisecond time axis, the
 * detected laps for the active session, and auto-seeds a sensible default
 * start/finish line into the lapStore when a track first appears (and reseeds
 * when the active file changes).
 */
export function useLaps(): {
  timeMs: ComputedRef<Float64Array | null>
  laps: ComputedRef<Lap[]>
  resetLine: () => void
} {
  const { session, track } = useActiveSession()
  const lapStore = useLapStore()

  const timeMs = computed<Float64Array | null>(() => {
    const s = session.value
    if (!s) return null
    const sec = timeSeconds(s)
    const out = new Float64Array(sec.length)
    for (let i = 0; i < sec.length; i++) out[i] = sec[i] * 1000
    return out
  })

  const laps = computed<Lap[]>(() => {
    if (lapStore.source === 'ecu') {
      return session.value && timeMs.value
        ? detectLapsByChannel(session.value, timeMs.value)
        : []
    }
    if (track.value && timeMs.value && lapStore.line) {
      return detectLapsByLine(track.value, timeMs.value, lapStore.line)
    }
    // With no line, keep the table useful as a whole-recording summary. This
    // synthetic single span uses the same metric/selection pipeline as a lap.
    const count = session.value?.rowCount ?? 0
    if (!timeMs.value || count === 0) return []
    return [{ index: 0, startIdx: 0, endIdx: count - 1, lapTimeMs: timeMs.value[count - 1] - timeMs.value[0] }]
  })

  // Keep the store's copy of the detected laps in sync so it can derive the
  // time-band (out-of-band) exclusions from lap times. The store owns the
  // resulting "excluded" union; this is just the feed.
  watch(laps, (next) => lapStore.setLaps(next), { immediate: true })

  // Same "just the feed" pattern for the active track, so the store can derive
  // sector-gate-crossing validity (which needs the raw GPS fixes, not just lap
  // boundaries) without reaching into useActiveSession itself.
  watch(track, (next) => lapStore.setTrack(next), { immediate: true })

  /**
   * Re-seed the start/finish line to a fresh default from the current track.
   * (Clearing alone would leave the line null until the next file change, since
   * the seeding watcher only fires on track identity change — so "reset" must
   * itself re-seed, otherwise the line vanishes with no way to get it back.)
   */
  function resetLine(): void {
    const seeded = track.value && session.value
      ? inferLapLineFromChannel(session.value, track.value) ?? defaultLine(track.value)
      : null
    if (seeded) lapStore.setLine(seeded)
    else lapStore.clearLine()
  }

  // Seed a default line when a track appears, and reseed when the active file
  // changes (track identity changes -> clear so the next tick reseeds).
  //
  // B55 — `lapStore.primarySwapPending` is true for exactly this one flush
  // when the active-file change came from an explicit primary swap (FileBar's
  // makePrimary / toggleIncludedSession auto-promotion) rather than a
  // genuinely different recording being loaded. `swapPrimarySession` already
  // migrated the index-keyed selection/exclusion/offset state for that case,
  // so wiping it here would just throw that migration away. The start/finish
  // line and valid-lap bands are left untouched either way: they're GLOBAL,
  // not tied to one file — comparison recordings already re-detect their own
  // laps off this SAME shared line/source (see setSource's doc above), so a
  // primary swap within the same loaded set has no reason to reset them.
  //
  // B58 part 2 — a swap also has to SUPPRESS the auto-band-suggestion watcher
  // below for this one flush: that watcher reacts to `laps` changing for ANY
  // reason (including the track switching underneath a swap), and would
  // otherwise stomp a swap-preserved 'auto' band with a fresh suggestion from
  // the newly-promoted session's laps. `suppressAutoBandSuggest` is peeked
  // (and consumed) by that watcher, which runs in the 'post' phase — always
  // after this 'pre' (default) watcher — so it always sees an up-to-date value.
  let suppressAutoBandSuggest = false
  watch(
    track,
    (next, prev) => {
      if (prev && next !== prev) {
        if (lapStore.primarySwapPending) {
          suppressAutoBandSuggest = true
        } else {
          lapStore.clearLine()
          // Lap selection, garbage exclusions and alignment offsets are keyed
          // by lap index, which is meaningless across a different recording —
          // clear them all on file change. Clearing the bands also re-arms
          // their auto-suggestion origin (see lapStore.clearLapTimeBand's doc),
          // so the fresh track's laps get a fresh suggestion below.
          lapStore.clearAllLapSelections()
          lapStore.clearExcluded()
          lapStore.clearLapTimeBand()
          lapStore.clearLapDistanceBand()
          lapStore.clearOffsets()
        }
      }
      if (next && lapStore.line == null) {
        const seeded = session.value
          ? inferLapLineFromChannel(session.value, next) ?? defaultLine(next)
          : defaultLine(next)
        if (seeded) lapStore.setLine(seeded)
      }
    },
    { immediate: true },
  )

  // Auto-suggest the valid lap-time AND lap-distance bands whenever the
  // detected laps change (a new track, a dragged start/finish line, or a
  // lap-source switch) — as long as the corresponding band hasn't been
  // explicitly edited by the user (origin 'user', set by AnalyzerView's panel
  // inputs via setLapTimeBand/setLapDistanceBand). This intentionally keeps
  // re-suggesting on every genuine laps recompute rather than once per track:
  // the seeded default line is a tiny placeholder near the first GPS fix, so
  // the FIRST laps a brand-new track ever produces are themselves garbage
  // micro-laps (B58) — there is no reliable one-shot moment to suggest from,
  // only "keep refreshing until the user takes over".
  //
  // Clearing a band (the panel's 清除 button, or blanking both its inputs)
  // resets its origin to null via clearLapTimeBand/clearLapDistanceBand,
  // which RE-ARMS this watcher for that band: the next laps change (typically
  // the next line drag) suggests it again. This is a deliberate trade-off —
  // "clear" behaves as "reset and try again", matching what B58's report
  // expected, not as a permanent per-track opt-out. A user who wants no band
  // at all can still get there by typing a band that intentionally includes
  // every lap, which (being a user edit) is never touched by this watcher.
  watch(
    laps,
    (next) => {
      const suppressed = suppressAutoBandSuggest
      suppressAutoBandSuggest = false
      if (suppressed) return
      if (next.length === 0) return
      const t = track.value
      if (!t) return
      if (lapStore.lapTimeBandOrigin !== 'user') {
        lapStore.applyAutoLapTimeBand(suggestLapTimeBand(t, next))
      }
      if (lapStore.lapDistanceBandOrigin !== 'user') {
        lapStore.applyAutoLapDistanceBand(suggestLapDistanceBand(t, next))
      }
    },
    { immediate: true, flush: 'post' },
  )

  // Seed ONE default statistics column (reproducing the old "top speed" column)
  // the first time a session with a speed channel appears and no columns exist.
  // Guarded on `columns.length === 0` so it seeds once and never duplicates on
  // recompute; a fresh file with an empty column list reseeds, which is fine.
  watch(
    session,
    (s) => {
      if (!s || lapStore.columns.length > 0) return
      const speed = resolveSpeedChannel(s)
      if (speed) lapStore.addColumn({ kind: 'channel', channel: speed, agg: 'max' })
    },
    { immediate: true },
  )

  return { timeMs, laps, resetLine }
}
