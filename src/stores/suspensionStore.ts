import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  defaultSuspensionConfig,
  type SuspensionChannelConfig,
  type SuspensionConfig,
  type SuspensionPart,
} from '@/domain/units/suspension'

const STORAGE_KEY = 'aracer-loga.suspension.v1'

function loadPersisted(): SuspensionConfig {
  const def = defaultSuspensionConfig()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return def
    const data = JSON.parse(raw) as Partial<SuspensionConfig>
    return {
      front: { ...def.front, ...data.front },
      rear: { ...def.rear, ...data.rear },
    }
  } catch {
    return def
  }
}

/**
 * Suspension calibration config (front/rear), persisted to localStorage.
 * Shared by the converter (derived channel → RC3) and the future analyzer.
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

  return { config, setChannel, reset }
})
