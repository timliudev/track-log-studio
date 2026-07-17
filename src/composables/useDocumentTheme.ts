import { onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue'
import type { ChartTheme } from '@/domain/analysis/channelPalette'

const theme = ref<ChartTheme>('light')
let observer: MutationObserver | null = null
let consumers = 0

function readTheme(): ChartTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function startObserver(): void {
  if (observer) return
  observer = new MutationObserver(() => {
    theme.value = readTheme()
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

/**
 * Shared document-theme signal for canvas/chart props. App.vue already owns the
 * matchMedia policy; charts only observe its resolved `data-theme` attribute.
 */
export function useDocumentTheme(): Readonly<Ref<ChartTheme>> {
  onMounted(() => {
    consumers++
    theme.value = readTheme()
    startObserver()
  })
  onBeforeUnmount(() => {
    consumers--
    if (consumers === 0) {
      observer?.disconnect()
      observer = null
    }
  })
  return readonly(theme)
}
