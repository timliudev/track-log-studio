import { defineStore } from 'pinia'
import { ref } from 'vue'

export type AppNavigationTarget = 'converter-save-modified'

/**
 * A short-lived cross-tab request. The requester owns intent while the target
 * view owns completion, so feature cards never need to reach into App.vue's
 * private tab state.
 */
export const useAppNavigationStore = defineStore('appNavigation', () => {
  const target = ref<AppNavigationTarget | null>(null)

  function requestConverterSaveModified(): void {
    target.value = 'converter-save-modified'
  }

  function consumeConverterSaveModified(): void {
    if (target.value === 'converter-save-modified') target.value = null
  }

  return { target, requestConverterSaveModified, consumeConverterSaveModified }
})
