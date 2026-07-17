import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { LogSession } from '@/domain/model/LogSession'
import { getExportFormat, type ExportOptions } from '@/domain/export/registry'
import { buildVboDisplayMap, type VboMapRow } from '@/domain/export/vbo/VboExporter'
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
import { useFileStore } from '@/stores/fileStore'
import { withSuspensionCalibration } from '@/domain/export/metadata'

export interface SavedPreset {
  name: string
  mapping: Rc3Mapping
}

export type { ImportedFile } from '@/stores/fileStore'

export interface ConvertResult {
  name: string
  content: string
}

export type PresetId = 'default' | 'custom' | `user${number}`

/**
 * Output format the converter writes: RaceChrono .nmea, Racelogic VBOX .vbo,
 * a generic .csv, or `loga` (in-place patch of the original .loga text with
 * calibrated suspension channels — see `LogaWriter.patchLogaText`). Kept as a
 * literal union (rather than `ExportFormat['id']`) so persisted values are
 * still checked against the known set; new formats must be added here as
 * well as to the export registry. `loga` is deliberately NOT in the export
 * registry (`domain/export/registry.ts`) — it patches the original source
 * text rather than exporting a normalized session, and only applies when the
 * source itself is a .loga (see `fileStore.savableEntries`), so the UI
 * special-cases it instead of forcing it into the any-source→any-format
 * registry contract.
 */
export type OutputFormat = 'nmea' | 'vbo' | 'csv' | 'loga'

const STORAGE_KEY = 'aracer-loga.converter.v1'
const USER_PRESET_COUNT = 5

interface Persisted {
  mapping: Rc3Mapping
  userPresets: (SavedPreset | null)[]
  activePresetId: PresetId
  outputFormat: OutputFormat
}

function clone(mapping: Rc3Mapping): Rc3Mapping {
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

/**
 * Converter state: the working RC3 slot mapping, user presets (persisted) and
 * the conversion results. File management lives in fileStore; this store keeps
 * thin delegation wrappers for backward compatibility.
 */
export const useConverterStore = defineStore('converter', () => {
  const persisted = loadPersisted()
  const mapping = ref<Rc3Mapping>(persisted.mapping ?? clone(DEFAULT_PRESET))
  const userPresets = ref<(SavedPreset | null)[]>(
    persisted.userPresets ?? Array.from({ length: USER_PRESET_COUNT }, () => null),
  )
  const activePresetId = ref<PresetId>(persisted.activePresetId ?? 'default')
  const outputFormat = ref<OutputFormat>(persisted.outputFormat ?? 'nmea')
  const results = ref<ConvertResult[]>([])
  const isConverting = ref(false)

  watch(
    [mapping, userPresets, activePresetId, outputFormat],
    () => {
      const data: Persisted = {
        mapping: mapping.value,
        userPresets: userPresets.value,
        activePresetId: activePresetId.value,
        outputFormat: outputFormat.value,
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
  const fileStore = useFileStore()

  /** Channels available across all successfully parsed logs (for the picker). */
  const availableChannels = computed<{ name: string; description?: string }[]>(() => {
    const seen = new Map<string, string | undefined>()
    for (const f of fileStore.files) {
      const session = fileStore.getSession(f.id)
      if (f.status !== 'ready' || !session) continue
      for (const ch of session.channels) {
        if (!seen.has(ch.name)) seen.set(ch.name, ch.description)
      }
      for (const d of derivedSuspensionNames(session, suspension.config)) {
        if (!seen.has(d.name)) seen.set(d.name, d.description)
      }
    }
    return [...seen.entries()]
      .map(([name, description]) => ({ name, description }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const readyFiles = computed(() => fileStore.readyFiles)
  const readySessions = computed(() => fileStore.readySessions)
  const savableEntries = computed(() => fileStore.savableEntries)

  /**
   * VBO channel cross-reference (same content as the _channels.csv) for the
   * first ready session (any imported format — loga/nmea/vbo/rcz/xrk/rcnx),
   * used by the converter UI to preview what each channel becomes in Circuit
   * Tools / RaceChrono. Empty until a session is loaded.
   */
  const vboChannelMap = computed<VboMapRow[]>(() => {
    const file = fileStore.readyFiles[0]
    if (!file) return []
    const session = fileStore.getSession(file.id)
    if (!session) return []
    return buildVboDisplayMap(applyDerivedChannels(session, suspension.config))
  })

  // --- Thin delegation wrappers (keeps backward compat with tests) ---
  function beginImport(file: File): number { return fileStore.beginImport(file) }
  function setProgress(id: number, fraction: number): void { fileStore.setProgress(id, fraction) }
  function completeImport(id: number, session: LogSession): void {
    fileStore.completeImport(id, session)
  }
  function failImport(id: number, message: string): void { fileStore.failImport(id, message) }
  function removeFile(id: number): void { fileStore.removeFile(id) }
  function clearFiles(): void {
    fileStore.clearFiles()
    results.value = []
  }

  // Also expose files ref for any remaining consumers
  const files = computed(() => fileStore.files)

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

  // --- conversion ---
  function setOutputFormat(format: OutputFormat): void {
    outputFormat.value = format
  }

  /** Log file name without its extension. */
  function stemOf(logName: string): string {
    return logName.replace(/\.[^./]+$/, '')
  }

  /**
   * Convert every ready session — any imported format (loga/nmea/vbo/rcz/xrk/
   * rcnx) — into the selected output format via the export registry; stores
   * results. .nmea yields one file per session; .vbo yields three (_ct, _rc
   * and a _channels.csv cross-reference).
   */
  function convertAll(): ConvertResult[] {
    isConverting.value = true
    try {
      const format = getExportFormat(outputFormat.value)
      if (!format) return (results.value = [])

      const out: ConvertResult[] = []
      for (const f of fileStore.readyFiles) {
        const session = fileStore.getSession(f.id)
        if (!session) continue
        const augmented = applyDerivedChannels(session, suspension.config)
        const stem = stemOf(f.name)
        const options: ExportOptions = {
          metadata: withSuspensionCalibration(fileStore.getExportMetadata(f.id), suspension.config),
          ...(format.id === 'nmea' ? { mapping: mapping.value } : {}),
        }
        for (const art of format.exportSession(augmented, f.name, options)) {
          out.push({ name: `${stem}${art.suffix}.${art.ext}`, content: art.content })
        }
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
    outputFormat,
    files,
    results,
    isConverting,
    availableChannels,
    readyFiles,
    readySessions,
    savableEntries,
    vboChannelMap,
    slotIds: SLOT_IDS,
    setSlot,
    applyPreset,
    saveToUser,
    reset,
    setOutputFormat,
    beginImport,
    setProgress,
    completeImport,
    failImport,
    removeFile,
    clearFiles,
    convertAll,
  }
})
