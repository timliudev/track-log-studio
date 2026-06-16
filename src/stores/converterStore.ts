import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { LogSession } from '@/domain/model/LogSession'
import { Rc3NmeaExporter } from '@/domain/export/rc3Nmea/Rc3NmeaExporter'
import {
  DEFAULT_PRESET,
  SLOT_IDS,
  type Rc3Mapping,
  type SlotId,
} from '@/domain/export/rc3Nmea/mapping'
import {
  applyDerivedChannels,
  derivedSuspensionNames,
} from '@/domain/units/suspension'
import { useSuspensionStore } from '@/stores/suspensionStore'

export interface SavedPreset {
  name: string
  mapping: Rc3Mapping
}

export interface ImportedFile {
  id: number
  name: string
  status: 'parsing' | 'ready' | 'error'
  progress: number
  formatId: string | null
  rowCount: number
  error: string | null
}

export interface ConvertResult {
  /** Output file name, e.g. "Session1.nmea". */
  name: string
  content: string
}

export type PresetId = 'default' | 'custom' | `user${number}`

const STORAGE_KEY = 'aracer-loga.converter.v1'
const USER_PRESET_COUNT = 5

interface Persisted {
  mapping: Rc3Mapping
  userPresets: (SavedPreset | null)[]
  activePresetId: PresetId
}

function clone(mapping: Rc3Mapping): Rc3Mapping {
  // JSON clone (not structuredClone) so it reads cleanly through Vue's reactive
  // Proxy; the mapping is plain JSON-safe data.
  return JSON.parse(JSON.stringify(mapping)) as Rc3Mapping
}

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {}
  } catch {
    return {}
  }
}

const exporter = new Rc3NmeaExporter()

/**
 * Converter state: the working RC3 slot mapping, user presets (persisted), the
 * list of imported logs and the conversion results. The parse worker lives in
 * the view via useLogImport — this store stays free of worker imports so it can
 * be unit-tested in Node.
 */
export const useConverterStore = defineStore('converter', () => {
  const persisted = loadPersisted()

  const mapping = ref<Rc3Mapping>(persisted.mapping ?? clone(DEFAULT_PRESET))
  const userPresets = ref<(SavedPreset | null)[]>(
    persisted.userPresets ?? Array.from({ length: USER_PRESET_COUNT }, () => null),
  )
  const activePresetId = ref<PresetId>(persisted.activePresetId ?? 'default')

  const files = ref<ImportedFile[]>([])
  const results = ref<ConvertResult[]>([])
  const isConverting = ref(false)
  let nextFileId = 1

  // Parsed sessions are held outside the reactive tree (plain Map): Vue's deep
  // ref-unwrapping would otherwise mangle the LogSession class type, and we do
  // not want the large Float32 column-store proxied.
  const sessions = new Map<number, LogSession>()

  watch(
    [mapping, userPresets, activePresetId],
    () => {
      const data: Persisted = {
        mapping: mapping.value,
        userPresets: userPresets.value,
        activePresetId: activePresetId.value,
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        // storage unavailable — settings just won't persist
      }
    },
    { deep: true },
  )

  const suspension = useSuspensionStore()

  /** Channels available across all successfully parsed logs (for the picker). */
  const availableChannels = computed<{ name: string; description?: string }[]>(() => {
    const seen = new Map<string, string | undefined>()
    for (const f of files.value) {
      const session = sessions.get(f.id)
      if (f.status !== 'ready' || !session) continue
      for (const ch of session.channels) {
        if (!seen.has(ch.name)) seen.set(ch.name, ch.description)
      }
      // include derived suspension channels (by actual field presence)
      for (const d of derivedSuspensionNames(session, suspension.config)) {
        if (!seen.has(d.name)) seen.set(d.name, d.description)
      }
    }
    return [...seen.entries()]
      .map(([name, description]) => ({ name, description }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const readyFiles = computed(() => files.value.filter((f) => f.status === 'ready'))

  // --- mapping / presets ---

  function setSlot(id: SlotId, channel: string | null, decimals?: number): void {
    mapping.value[id] = {
      channel,
      decimals: decimals ?? mapping.value[id].decimals,
    }
    activePresetId.value = 'custom'
  }

  function applyPreset(id: PresetId): void {
    if (id === 'default') {
      mapping.value = clone(DEFAULT_PRESET)
    } else if (id.startsWith('user')) {
      const index = Number(id.slice(4)) - 1
      const preset = userPresets.value[index]
      if (preset) mapping.value = clone(preset.mapping)
    }
    activePresetId.value = id
  }

  function saveToUser(index: number, name: string): void {
    if (index < 0 || index >= USER_PRESET_COUNT) return
    userPresets.value[index] = { name, mapping: clone(mapping.value) }
    activePresetId.value = `user${index + 1}`
  }

  function reset(): void {
    applyPreset('default')
  }

  // --- file lifecycle (driven by the view's useLogImport) ---

  function beginImport(name: string): number {
    const id = nextFileId++
    files.value.push({
      id,
      name,
      status: 'parsing',
      progress: 0,
      formatId: null,
      rowCount: 0,
      error: null,
    })
    return id
  }

  function withFile(id: number, fn: (f: ImportedFile) => void): void {
    const f = files.value.find((x) => x.id === id)
    if (f) fn(f)
  }

  function setProgress(id: number, fraction: number): void {
    withFile(id, (f) => {
      f.progress = fraction
    })
  }

  function completeImport(id: number, session: LogSession): void {
    sessions.set(id, session)
    withFile(id, (f) => {
      f.status = 'ready'
      f.progress = 1
      f.formatId = session.meta.formatId
      f.rowCount = session.rowCount
    })
  }

  function failImport(id: number, message: string): void {
    withFile(id, (f) => {
      f.status = 'error'
      f.error = message
    })
  }

  function removeFile(id: number): void {
    sessions.delete(id)
    files.value = files.value.filter((f) => f.id !== id)
  }

  function clearFiles(): void {
    sessions.clear()
    files.value = []
    results.value = []
  }

  // --- conversion ---

  function outputName(logName: string): string {
    return logName.replace(/\.loga$/i, '') + '.nmea'
  }

  /** Convert all ready files with the current mapping; stores results. */
  function convertAll(): ConvertResult[] {
    isConverting.value = true
    try {
      const out: ConvertResult[] = []
      for (const f of readyFiles.value) {
        const session = sessions.get(f.id)
        if (!session) continue
        // augment with calibrated suspension channels before exporting
        const augmented = applyDerivedChannels(session, suspension.config)
        out.push({
          name: outputName(f.name),
          content: exporter.export(augmented, mapping.value),
        })
      }
      results.value = out
      return out
    } finally {
      isConverting.value = false
    }
  }

  return {
    mapping,
    userPresets,
    activePresetId,
    files,
    results,
    isConverting,
    availableChannels,
    readyFiles,
    slotIds: SLOT_IDS,
    setSlot,
    applyPreset,
    saveToUser,
    reset,
    beginImport,
    setProgress,
    completeImport,
    failImport,
    removeFile,
    clearFiles,
    convertAll,
  }
})
