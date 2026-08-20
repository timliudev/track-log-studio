import { nextTick, onBeforeUnmount, watch, type ComputedRef, type Ref } from 'vue'
import { getFocusableElements, wrappingFocusIndex } from '@/domain/interaction/focusTrap'

/**
 * B118(b) — FileBar has three near-identical `role="dialog" aria-modal
 * ="true"` pickers (rcnx import-time picker, rcz device-backup picker,
 * composite-segment picker) that had a scrim but none of the behaviour the
 * `aria-modal` declaration promises: no Escape-to-close, no focus trap, no
 * focus restore. `CardMenu.vue` (same app) already closes on Escape, so two
 * things that LOOK alike behaved differently. This composable is the one
 * place that behaviour now lives, wired identically into all three dialogs
 * rather than copy-pasted three times.
 *
 * Deliberately does NOT own the dialog's open/close STATE — FileBar already
 * has three separate "pending" refs (`pendingRcnx`/`pendingRcz`
 * /`pendingComposite`) driving `v-if`, each with its own existing cancel
 * handler (`cancelPendingRcnx` etc.) whose semantics (e.g. `cancelPendingRcnx`
 * also removing the in-progress import record) must stay EXACTLY what they
 * already are. This composable only reacts to that state via the `open`
 * ref/computed the caller passes in, and calls `onCancel` for both Escape
 * and (by convention, not enforced here) scrim-click — it never decides
 * what "cancel" means for a given caller.
 */
export interface UseModalDialogOptions {
  /** The dialog's root element (the `role="dialog"` node itself, NOT the
   *  scrim/backdrop wrapper around it) — this is both the focus-trap
   *  boundary and the element focused as a last resort if the dialog has no
   *  focusable children. Caller-owned (same convention as
   *  `useAutoFlip(target, ...)` in useFlipAnimation.ts: the ref is created
   *  in the component, bound to the template's `ref="..."` there, and
   *  handed to this composable rather than the other way around — a ref
   *  ONLY ever assigned via a template `ref` and never otherwise read in
   *  the component's own `<script>` trips `noUnusedLocals`, which a
   *  caller-supplied parameter does not). */
  dialogEl: Ref<HTMLElement | null>
  /** Whether the dialog is currently open — typically
   *  `computed(() => pendingX.value !== null)`. */
  open: Ref<boolean> | ComputedRef<boolean>
  /** Called on Escape. Callers pass their existing cancel handler
   *  (`cancelPendingRcnx`/`cancelPendingRcz`/`cancelCompositePicker`) so
   *  Escape and the Cancel button/scrim-click all funnel through the same
   *  one place that already exists per dialog. */
  onCancel: () => void
}

export function useModalDialog(options: UseModalDialogOptions): void {
  const dialogEl = options.dialogEl
  // The element focus was on right before the dialog opened (typically the
  // button that opened it) — restored on close so keyboard/screen-reader
  // navigation lands back where the user left off rather than reverting to
  // <body>. Captured fresh on EVERY open, not just the first, since the
  // same dialog instance can open/close/open again for different files.
  let previouslyFocused: HTMLElement | null = null

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      options.onCancel()
      return
    }
    if (e.key !== 'Tab') return
    const root = dialogEl.value
    if (!root) return
    const focusables = getFocusableElements(root)
    if (focusables.length === 0) {
      // Nothing to cycle through — keep focus pinned on the dialog root
      // (its `tabindex="-1"`) rather than letting Tab escape the trap.
      e.preventDefault()
      return
    }
    const active = document.activeElement
    const currentIndex = active instanceof HTMLElement ? focusables.indexOf(active) : -1
    const nextIndex = wrappingFocusIndex(currentIndex, focusables.length, e.shiftKey)
    e.preventDefault()
    focusables[nextIndex]?.focus()
  }

  watch(options.open, async (isOpen) => {
    if (isOpen) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.addEventListener('keydown', onKeydown)
      // The dialog's content (v-if) only exists in the DOM once Vue has
      // flushed this update — `dialogEl` isn't populated yet at the moment
      // this watcher callback runs.
      await nextTick()
      const root = dialogEl.value
      if (!root) return
      const focusables = getFocusableElements(root)
      ;(focusables[0] ?? root).focus()
    } else {
      document.removeEventListener('keydown', onKeydown)
      // `document.contains` guards against restoring focus to an element
      // that was itself removed while the dialog was open (e.g. the
      // triggering "組合" button disappears if its file was removed via a
      // different control while the picker was up).
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
      previouslyFocused = null
    }
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
  })
}
