import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SEED_TRACK_LIBRARY } from '@/domain/tracks/seedLibrary'
import type { TrackDefinitionV1 } from '@/domain/tracks/schema'

/**
 * The SHARED track library (docs/CLOUD-TRACK-DESIGN.md §1.2/§4.2 flow ②) —
 * currently just the bundled seed snapshot (§3.2 step 1), which guarantees
 * offline/first-load availability with no runtime network dependency. §3.2
 * step 2 (background `jsDelivr` fetch of the independent
 * `track-log-studio-tracks` repo, merged into this same list) is a LATER
 * addition this store is shaped to accept without a call-site change: any
 * future loader just needs to push validated `TrackDefinitionV1` entries into
 * `tracks` (e.g. via a `mergeFetched` action) — not built here because it
 * depends on infrastructure that doesn't exist yet (no separate tracks repo,
 * no CDN URL to point at — see the delivery report for why this phase stops
 * here).
 */
export const useTrackLibraryStore = defineStore('trackLibrary', () => {
  const tracks = ref<TrackDefinitionV1[]>(SEED_TRACK_LIBRARY)

  return { tracks }
})
