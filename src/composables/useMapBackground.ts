import { ref, watch, type Ref } from 'vue'
import { openDB, type DBSchema } from 'idb'
import {
  parseMapBackgroundSettings,
  validateBackgroundImage,
  type MapBackgroundKind,
  type MapBackgroundSettings,
} from '@/domain/analysis/mapBackground'

const STORAGE_KEY = 'tracklogstudio.mapBackground.v1'
const DB_NAME = 'track-log-studio-map-backgrounds'
const STORE = 'images'
interface MapBackgroundDb extends DBSchema { images: { key: string; value: Blob } }

let db: ReturnType<typeof openDB<MapBackgroundDb>> | null = null
function database() {
  return db ??= openDB<MapBackgroundDb>(DB_NAME, 1, { upgrade(database) { database.createObjectStore(STORE) } })
}

/** UI state plus the deliberately separate large-image IndexedDB store. */
export function useMapBackground(): {
  settings: Ref<MapBackgroundSettings>
  image: Ref<HTMLImageElement | null>
  upload: (file: File) => Promise<string | null>
  setKind: (kind: MapBackgroundKind) => void
  setSatelliteKey: (key: string) => void
  nudgeImage: (dx: number, dy: number) => void
  scaleImage: (factor: number) => void
  resetImageAlignment: () => void
} {
  const settings = ref(parseMapBackgroundSettings(localStorage.getItem(STORAGE_KEY)))
  const image = ref<HTMLImageElement | null>(null)
  let objectUrl: string | null = null

  async function loadImage(): Promise<void> {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    image.value = null
    const id = settings.value.imageId
    if (!id) return
    const blob = await (await database()).get(STORE, id)
    if (!blob) return
    objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { image.value = img }
    img.src = objectUrl
  }
  void loadImage()

  watch(settings, (next) => localStorage.setItem(STORAGE_KEY, JSON.stringify(next)), { deep: true })

  async function upload(file: File): Promise<string | null> {
    const invalid = validateBackgroundImage(file)
    if (invalid) return invalid
    // M9 P2: re-uploading previously left the OLD blob behind in IndexedDB
    // under its old id — nothing ever referenced it again (settings.imageId
    // gets overwritten below), so every re-upload silently grew the store by
    // one orphaned image forever. Remember the outgoing id and delete it
    // once the new blob is safely stored, so a failed upload never loses the
    // still-in-use image.
    const previousId = settings.value.imageId
    const id = crypto.randomUUID()
    const store = await database()
    await store.put(STORE, file, id)
    settings.value.imageId = id
    settings.value.kind = 'image'
    settings.value.alignment = { x: 0, y: 0, scale: 1 }
    await loadImage()
    if (previousId && previousId !== id) await store.delete(STORE, previousId)
    return null
  }
  const setKind = (kind: MapBackgroundKind) => { settings.value.kind = kind }
  const setSatelliteKey = (key: string) => { settings.value.satelliteApiKey = key }
  const nudgeImage = (dx: number, dy: number) => { settings.value.alignment.x += dx; settings.value.alignment.y += dy }
  const scaleImage = (factor: number) => { settings.value.alignment.scale = Math.min(8, Math.max(0.1, settings.value.alignment.scale * factor)) }
  const resetImageAlignment = () => { settings.value.alignment = { x: 0, y: 0, scale: 1 } }
  return { settings, image, upload, setKind, setSatelliteKey, nudgeImage, scaleImage, resetImageAlignment }
}
