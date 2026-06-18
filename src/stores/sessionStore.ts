import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { LogSession } from '@/domain/model/LogSession'

/**
 * Holds the currently loaded log. Uses shallowRef so Vue does not deeply proxy
 * the column-store (the Float32Array channels must stay plain typed arrays for
 * performance). Wiring to the file picker / parse worker comes in Phase 1.
 */
export const useSessionStore = defineStore('session', () => {
  const session = shallowRef<LogSession | null>(null)
  const fileName = shallowRef<string | null>(null)

  function setSession(next: LogSession, name: string): void {
    session.value = next
    fileName.value = name
  }

  function clear(): void {
    session.value = null
    fileName.value = null
  }

  return { session, fileName, setSession, clear }
})
