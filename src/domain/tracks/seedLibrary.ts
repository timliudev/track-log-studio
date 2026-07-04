import { parseTrackLibrary } from '@/domain/tracks/schema'
import type { TrackDefinitionV1 } from '@/domain/tracks/schema'

/**
 * Bundled SHARED-track snapshot (docs/CLOUD-TRACK-DESIGN.md §3.2 step 1 —
 * "bundle a snapshot as the offline baseline"). §7 第二階段 calls for "手動放
 * 3-5 條種子賽道（開發者自己熟悉的場地）" sourced from real recorded sessions;
 * this repo has no such recordings checked in (no `.loga`/`.nmea` fixture with
 * a real track's GPS trace to derive accurate start/finish + gate coordinates
 * from), so shipping *fabricated* coordinates under a real track's name would
 * be actively wrong — the whole point of A2 is auto-applying a *correct*
 * line/gates, and a made-up "Chiayi Speedway" entry with invented lat/lon
 * would silently mis-place a real user's line if their circuitKey ever
 * happened to land nearby.
 *
 * Placeholder instead: two clearly-synthetic example entries (obviously fake
 * names/ids/coordinates, `license: 'CC0-1.0'` per §8 open question 2's
 * default) that exercise the full match/apply/multi-match pipeline end to
 * end — §7 第二階段's acceptance bar ("至少一條種子賽道能在全新瀏覽器 profile
 * 載入 log 後自動套用正確的起終點線") is met structurally (the plumbing works
 * for ANY well-formed entry), just not populated with real-world tracks yet.
 * Swapping this file's contents for real PR-reviewed data (or wiring the
 * runtime `track-log-studio-tracks` repo fetch from §3.2 step 2) is a
 * data-only change — no code here needs to change.
 */
const SEED_RAW: unknown[] = [
  {
    schemaVersion: 1,
    id: 'example-test-track',
    name: { 'zh-TW': '範例測試賽道', en: 'Example Test Track' },
    aliases: ['demo track'],
    geo: { lat: 23.5, lon: 120.5 },
    countryCode: 'TW',
    startFinishLine: {
      a: { lat: 23.5001, lon: 120.5 },
      b: { lat: 23.4999, lon: 120.5 },
    },
    gates: [
      { a: { lat: 23.501, lon: 120.502 }, b: { lat: 23.499, lon: 120.502 } },
      { a: { lat: 23.502, lon: 120.498 }, b: { lat: 23.5, lon: 120.4965 } },
    ],
    license: 'CC0-1.0',
    updatedAt: '2026-07-05',
    contributors: ['seed-data'],
  },
  {
    schemaVersion: 1,
    id: 'example-test-track-reverse',
    name: { 'zh-TW': '範例測試賽道（反向）', en: 'Example Test Track (Reverse)' },
    geo: { lat: 23.5, lon: 120.5 },
    countryCode: 'TW',
    startFinishLine: {
      a: { lat: 23.4999, lon: 120.5 },
      b: { lat: 23.5001, lon: 120.5 },
    },
    gates: [
      { a: { lat: 23.502, lon: 120.498 }, b: { lat: 23.5, lon: 120.4965 } },
      { a: { lat: 23.501, lon: 120.502 }, b: { lat: 23.499, lon: 120.502 } },
    ],
    direction: 'ccw',
    license: 'CC0-1.0',
    updatedAt: '2026-07-05',
    contributors: ['seed-data'],
  },
]

const { tracks, errors } = parseTrackLibrary(SEED_RAW)

if (errors.length > 0) {
  // A malformed seed entry is a bug in THIS file (not user data), so surface
  // it loudly in dev rather than silently shipping a shrunk library.
  // eslint-disable-next-line no-console
  console.error('[seedLibrary] malformed bundled track definition(s):', errors)
}

/** The bundled SHARED-track snapshot, validated at module load. Two entries
 *  sharing a `geo` (see above) intentionally exercise the §4.3 "ambiguous,
 *  same venue multiple layouts" path. */
export const SEED_TRACK_LIBRARY: TrackDefinitionV1[] = tracks
