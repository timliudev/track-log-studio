import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'

export interface InputCapabilities {
  /** True when the device has ANY coarse (touch-capable) pointer, even if a
   *  precise one (mouse/trackpad) is ALSO available — e.g. a tablet with a
   *  Bluetooth mouse still reports true, since the touchscreen never goes
   *  away. This is the signal touch-target sizing should key off (§8 layer
   *  3): it stays true regardless of which input the user happens to be
   *  using at this instant, unlike the per-EVENT `pointerType` branching
   *  layer 2 uses for gesture behaviour. */
  anyPointerCoarse: ComputedRef<boolean>
  /** True only when the PRIMARY pointer is coarse (no fine pointer exists at
   *  all) — narrower than `anyPointerCoarse`; most callers want the `any-`
   *  variant above (a coarse pointer merely being PRESENT is what makes a
   *  touch target worth enlarging, whether or not it's the primary one). */
  pointerCoarse: ComputedRef<boolean>
  /** True when no pointer on the device can hover (`any-hover: none`) — an S
   *  Pen (which CAN hover) keeps this false even on an otherwise touch-only
   *  device, so hover-only affordances still reach it naturally. */
  anyHoverNone: ComputedRef<boolean>
}

/** Wraps one `matchMedia` query as a reactive ref that updates live on
 *  'change' (mouse plugged in/unplugged, tablet docked, etc.) — never
 *  evaluated once at load and left stale (§8 layer 3's explicit requirement).
 *  Registers cleanup via `onBeforeUnmount`, so this must be called from
 *  within a component's `setup()` (mirrors useTheme.ts's own matchMedia use). */
function mediaQueryRef(query: string): Ref<boolean> {
  const mql = window.matchMedia(query)
  const matches = ref(mql.matches)
  const onChange = (e: MediaQueryListEvent): void => {
    matches.value = e.matches
  }
  mql.addEventListener('change', onChange)
  onBeforeUnmount(() => mql.removeEventListener('change', onChange))
  return matches
}

/**
 * §8 觸控友善四層政策 — layer 3 (capability query) + layer 4 (manual override
 * fuse), shared as one primitive so every consumer (CSS via the `<html>`
 * data-attributes this sets, or JS callers of this composable directly)
 * agrees on the same answer.
 *
 * Layer 3: derives from three live `matchMedia` queries — `any-pointer:
 * coarse`, `pointer: coarse`, `any-hover: none` — each independently
 * reactive to 'change' (see `mediaQueryRef`), never a load-time snapshot and
 * never a viewport-width substitute.
 *
 * Layer 4: `settingsStore.inputModePref` ('auto' | 'touch' | 'pointer') is a
 * persisted manual override — a fuse for when the automatic capability read
 * gets it wrong. 'touch' pins every capability to "yes, coarse/no-hover
 * pointer present"; 'pointer' pins every capability to "no, only a fine
 * pointer"; 'auto' (default) passes the live media-query reads through
 * unchanged.
 *
 * Also mirrors the resolved capabilities onto `<html>` as
 * `data-any-pointer-coarse` / `data-pointer-coarse` / `data-any-hover-none`
 * boolean attributes, so plain CSS (`:root[data-any-pointer-coarse] .foo`)
 * can key touch-target sizing off the SAME signal without importing this
 * composable into every component that needs it — see DESIGN.md §8.
 */
export function useInputCapabilities(): InputCapabilities {
  const { inputModePref } = storeToRefs(useSettingsStore())

  const anyPointerCoarseMedia = mediaQueryRef('(any-pointer: coarse)')
  const pointerCoarseMedia = mediaQueryRef('(pointer: coarse)')
  const anyHoverNoneMedia = mediaQueryRef('(any-hover: none)')

  const anyPointerCoarse = computed(() => {
    if (inputModePref.value === 'touch') return true
    if (inputModePref.value === 'pointer') return false
    return anyPointerCoarseMedia.value
  })
  const pointerCoarse = computed(() => {
    if (inputModePref.value === 'touch') return true
    if (inputModePref.value === 'pointer') return false
    return pointerCoarseMedia.value
  })
  const anyHoverNone = computed(() => {
    if (inputModePref.value === 'touch') return true
    if (inputModePref.value === 'pointer') return false
    return anyHoverNoneMedia.value
  })

  watch(
    [anyPointerCoarse, pointerCoarse, anyHoverNone],
    ([coarse, primaryCoarse, hoverNone]) => {
      document.documentElement.toggleAttribute('data-any-pointer-coarse', coarse)
      document.documentElement.toggleAttribute('data-pointer-coarse', primaryCoarse)
      document.documentElement.toggleAttribute('data-any-hover-none', hoverNone)
    },
    { immediate: true },
  )

  return { anyPointerCoarse, pointerCoarse, anyHoverNone }
}
