import type { Directive, DirectiveBinding } from 'vue'

/**
 * `v-tooltip="text"` — a rounded, theme-matched replacement for the native
 * `title` attribute. Browsers render `title` tooltips with OS chrome (a
 * square, always-dark box) that can't be styled via CSS, which is exactly
 * why every hover hint in the app looked out of place next to the app's
 * rounded, theme-aware cards (light/dark). This directive renders a single
 * shared `.app-tooltip` bubble (see theme.css) positioned next to the
 * hovered/focused element instead, so hints follow the same corner radius
 * and surface/border/text colours as everything else.
 *
 * Usage mirrors `:title`: `<button v-tooltip="t('foo.hint')">`. A falsy
 * value (undefined/null/'') shows nothing, same as omitting `title`.
 *
 * Accessibility: unless the element already has its own accessible name
 * (`aria-label`/`aria-labelledby` — some callers set one explicitly for
 * other reasons), the tooltip text also becomes the element's `aria-label`,
 * matching what the native `title` attribute provided for icon-only
 * buttons.
 */

let bubble: HTMLDivElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function ensureBubble(): HTMLDivElement {
  if (bubble) return bubble
  bubble = document.createElement('div')
  bubble.className = 'app-tooltip'
  bubble.setAttribute('role', 'tooltip')
  document.body.appendChild(bubble)
  return bubble
}

/** Places the bubble above the target (flipping below if that would clip off
 *  the top of the viewport), centred on and clamped within the viewport
 *  horizontally. */
function position(el: HTMLElement, el2: HTMLDivElement): void {
  const rect = el.getBoundingClientRect()
  el2.style.top = '0px'
  el2.style.left = '0px'
  const bubbleRect = el2.getBoundingClientRect()

  let top = rect.top - bubbleRect.height - 8
  if (top < 4) top = rect.bottom + 8

  let left = rect.left + rect.width / 2 - bubbleRect.width / 2
  left = Math.max(4, Math.min(left, window.innerWidth - bubbleRect.width - 4))

  el2.style.top = `${top + window.scrollY}px`
  el2.style.left = `${left + window.scrollX}px`
}

function show(el: HTMLElement, text: string): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  const b = ensureBubble()
  b.textContent = text
  b.style.display = 'block'
  position(el, b)
  // Next frame so the position set above (from display:block's freshly
  // measured size) is committed before the opacity transition starts.
  requestAnimationFrame(() => b.classList.add('is-visible'))
}

function hide(): void {
  if (!bubble) return
  bubble.classList.remove('is-visible')
  hideTimer = setTimeout(() => {
    if (bubble) bubble.style.display = 'none'
  }, 120)
}

interface TooltipState {
  text: string | null | undefined
  onEnter: () => void
  onLeave: () => void
}

const states = new WeakMap<HTMLElement, TooltipState>()

function applyAriaLabel(el: HTMLElement, text: string | null | undefined): void {
  if (!text) return
  if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return
  el.setAttribute('aria-label', text)
}

export const vTooltip: Directive<HTMLElement, string | null | undefined> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<string | null | undefined>) {
    const state: TooltipState = {
      text: binding.value,
      onEnter: () => {
        if (state.text) show(el, state.text)
      },
      onLeave: hide,
    }
    states.set(el, state)
    el.addEventListener('mouseenter', state.onEnter)
    el.addEventListener('focus', state.onEnter)
    el.addEventListener('mouseleave', state.onLeave)
    el.addEventListener('blur', state.onLeave)
    applyAriaLabel(el, binding.value)
  },
  updated(el: HTMLElement, binding: DirectiveBinding<string | null | undefined>) {
    const state = states.get(el)
    if (state) state.text = binding.value
    applyAriaLabel(el, binding.value)
  },
  unmounted(el: HTMLElement) {
    const state = states.get(el)
    if (state) {
      el.removeEventListener('mouseenter', state.onEnter)
      el.removeEventListener('focus', state.onEnter)
      el.removeEventListener('mouseleave', state.onLeave)
      el.removeEventListener('blur', state.onLeave)
    }
    states.delete(el)
    hide()
  },
}
