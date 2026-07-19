import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  defaultSuspensionConfig,
  legacyAdChannelName,
  normalizeSuspensionConfig,
  type LegacyAdSource,
  type SuspensionChannelConfig,
  type SuspensionConfig,
  type SuspensionPart,
} from '@/domain/units/suspension'

const STORAGE_KEY = 'aracer-loga.suspension.v2'

// v1 -> v2: the per-channel `source: 'AD1'|'AD2'` field (hardcoded to the
// .loga RaceAmp channel names) was replaced by a free-form `sourceChannel`
// (any channel name in the active session — see suspension.ts's interface
// doc for why: it's what decouples calibration from the .loga format). Unlike
// drivetrainStore's v1->v2 (which started fresh because the shapes were too
// different to safely remap), THIS migration preserves every existing value:
// a v1 `source` maps 1:1 onto the channel name it always meant
// (legacyAdChannelName), and every other field (enabled/minMv/maxMv/zeroMv/
// minMm/maxMm) carries over unchanged. So a user who already calibrated their
// suspension keeps that calibration after upgrading — nothing is lost, no
// re-entry needed.
const LEGACY_STORAGE_KEY = 'aracer-loga.suspension.v1'

interface LegacyChannelConfig {
  enabled?: boolean
  source?: LegacyAdSource
  minMv?: number
  maxMv?: number
  zeroMv?: number
  minMm?: number
  maxMm?: number
}

/** True when `v` looks like a v1 payload (has the old `source: 'AD1'|'AD2'`
 *  field and no v2 `sourceChannel`). */
function isLegacyChannel(v: unknown): v is LegacyChannelConfig {
  if (v == null || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return (c.source === 'AD1' || c.source === 'AD2') && typeof c.sourceChannel !== 'string'
}

/** Merge a persisted (v1 or v2) channel payload over the default, migrating
 *  a v1 `source` to its equivalent v2 `sourceChannel`. Unknown/garbage input
 *  falls back to `def` untouched. */
function mergeChannel(
  def: SuspensionChannelConfig,
  data: unknown,
): SuspensionChannelConfig {
  if (data == null || typeof data !== 'object') return def
  if (isLegacyChannel(data)) {
    const { source, ...rest } = data
    return { ...def, ...rest, sourceChannel: legacyAdChannelName(source as LegacyAdSource) }
  }
  return { ...def, ...(data as Partial<SuspensionChannelConfig>) }
}

function parseConfig(raw: string | null, def: SuspensionConfig): SuspensionConfig | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<Record<SuspensionPart, unknown>>
    return {
      front: mergeChannel(def.front, data.front),
      rear: mergeChannel(def.rear, data.rear),
    }
  } catch {
    return null
  }
}

function loadPersisted(): SuspensionConfig {
  const def = defaultSuspensionConfig()
  try {
    const v2 = parseConfig(localStorage.getItem(STORAGE_KEY), def)
    if (v2) return v2
    // No v2 data yet — fall back to the legacy v1 key so an existing user's
    // calibration survives the upgrade (see module doc). The v1 key is left
    // untouched on disk; the next config write persists under v2 as usual.
    const v1 = parseConfig(localStorage.getItem(LEGACY_STORAGE_KEY), def)
    return v1 ?? def
  } catch {
    return def
  }
}

/**
 * Suspension calibration config (front/rear), persisted to localStorage —
 * same global-slot pattern as drivetrainStore/settingsStore (a VEHICLE
 * property, not per-circuit). Shared by the converter (derived channel →
 * export formats) and the analyzer (derived channel → charts), via
 * `applyDerivedChannels`/`useActiveSession` — format-agnostic: `sourceChannel`
 * can name any channel in the active session, not just .loga's SuspensionAD1/
 * AD2 (see suspension.ts's interface doc).
 */
export const useSuspensionStore = defineStore('suspension', () => {
  const config = ref<SuspensionConfig>(loadPersisted())

  watch(
    config,
    () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config.value))
      } catch {
        // storage unavailable — config just won't persist
      }
    },
    { deep: true },
  )

  function setChannel(part: SuspensionPart, patch: Partial<SuspensionChannelConfig>): void {
    config.value[part] = { ...config.value[part], ...patch }
  }

  function reset(): void {
    config.value = defaultSuspensionConfig()
  }

  /** Apply a full calibration only after an explicit user action. */
  function replaceConfig(imported: unknown): boolean {
    const normalized = normalizeSuspensionConfig(imported)
    if (!normalized) return false
    config.value = normalized
    return true
  }

  return { config, setChannel, reset, replaceConfig }
})
