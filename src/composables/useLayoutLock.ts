import { ref, watch, type Ref } from 'vue'
import { loadLayoutLocked, saveLayoutLocked } from '@/domain/layout/layoutLock'

/**
 * 鎖定布局 (lock-layout): a single global toggle for the analyzer dashboard,
 * separate from and orthogonal to per-card PIN (usePanelState) — this is a
 * SIBLING composable to useDashboardLayout/usePanelState, same "own storage
 * key" pattern (see layoutLock.ts's module doc for why).
 *
 * Consumed by useDashboardLayout (passed in as `isLocked`) so the grid's own
 * isDraggable/isResizable computed refs fold the lock in alongside whatever
 * the current breakpoint already allows — this composable itself doesn't
 * know about breakpoints or grid items at all.
 */
export function useLayoutLock(): { isLocked: Ref<boolean>; toggleLocked: () => void } {
  const isLocked = ref<boolean>(loadLayoutLocked())

  watch(isLocked, (next) => {
    saveLayoutLocked(next)
  })

  function toggleLocked(): void {
    isLocked.value = !isLocked.value
  }

  return { isLocked, toggleLocked }
}
