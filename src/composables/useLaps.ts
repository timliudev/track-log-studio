import { computed, watch, type ComputedRef } from 'vue'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLapStore } from '@/stores/lapStore'
import { timeSeconds } from '@/domain/analysis/timeAxis'
import { detectLapsByChannel, detectLapsByLine, type LapLine } from '@/domain/analysis/laps'
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
    return track.value && timeMs.value && lapStore.line
      ? detectLapsByLine(track.value, timeMs.value, lapStore.line)
      : []
  })

  /**
   * Re-seed the start/finish line to a fresh default from the current track.
   * (Clearing alone would leave the line null until the next file change, since
   * the seeding watcher only fires on track identity change — so "reset" must
   * itself re-seed, otherwise the line vanishes with no way to get it back.)
   */
  function resetLine(): void {
    const seeded = track.value ? defaultLine(track.value) : null
    if (seeded) lapStore.setLine(seeded)
    else lapStore.clearLine()
  }

  // Seed a default line when a track appears, and reseed when the active file
  // changes (track identity changes -> clear so the next tick reseeds).
  watch(
    track,
    (next, prev) => {
      if (prev && next !== prev) lapStore.clearLine()
      if (next && lapStore.line == null) {
        const seeded = defaultLine(next)
        if (seeded) lapStore.setLine(seeded)
      }
    },
    { immediate: true },
  )

  // Seed ONE default statistics column (reproducing the old "top speed" column)
  // the first time a session with a speed channel appears and no columns exist.
  // Guarded on `columns.length === 0` so it seeds once and never duplicates on
  // recompute; a fresh file with an empty column list reseeds, which is fine.
  watch(
    session,
    (s) => {
      if (!s || lapStore.columns.length > 0) return
      const speed = s.has('GPS_Speed')
        ? 'GPS_Speed'
        : s.has('Vehicle_Speed')
          ? 'Vehicle_Speed'
          : null
      if (speed) lapStore.addColumn({ kind: 'channel', channel: speed, agg: 'max' })
    },
    { immediate: true },
  )

  return { timeMs, laps, resetLine }
}
