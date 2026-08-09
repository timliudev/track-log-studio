// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { getFocusableElements, wrappingFocusIndex } from '@/domain/interaction/focusTrap'

let container: HTMLElement | null = null
afterEach(() => {
  container?.remove()
  container = null
})

function mountContainer(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.append(el)
  container = el
  return el
}

describe('getFocusableElements', () => {
  it('collects links, enabled buttons/inputs/selects/textareas, and positive-tabindex elements, in DOM order', () => {
    const root = mountContainer(`
      <a href="#one">a</a>
      <button>b</button>
      <input type="checkbox" />
      <select><option>x</option></select>
      <textarea></textarea>
      <div tabindex="0">focusable div</div>
      <span>not focusable</span>
    `)
    const found = getFocusableElements(root)
    expect(found.map((el) => el.tagName)).toEqual(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DIV'])
  })

  it('excludes disabled form controls', () => {
    const root = mountContainer(`
      <button disabled>disabled btn</button>
      <button>enabled btn</button>
      <input disabled />
    `)
    const found = getFocusableElements(root)
    expect(found).toHaveLength(1)
    expect(found[0].textContent).toBe('enabled btn')
  })

  it('excludes an anchor with no href and an explicit tabindex="-1"', () => {
    const root = mountContainer(`
      <a>no href</a>
      <button tabindex="-1">opted out</button>
      <button>plain</button>
    `)
    const found = getFocusableElements(root)
    expect(found).toHaveLength(1)
    expect(found[0].textContent).toBe('plain')
  })

  it('excludes elements hidden via display:none (their own or an ancestor)', () => {
    const root = mountContainer(`
      <button style="display:none">hidden self</button>
      <div style="display:none"><button>hidden via ancestor</button></div>
      <button>visible</button>
    `)
    const found = getFocusableElements(root)
    expect(found).toHaveLength(1)
    expect(found[0].textContent).toBe('visible')
  })

  it('returns an empty array for a container with no focusable descendants', () => {
    const root = mountContainer('<p>just text</p>')
    expect(getFocusableElements(root)).toEqual([])
  })
})

describe('wrappingFocusIndex', () => {
  it('advances forward on Tab, wrapping from the last back to the first', () => {
    expect(wrappingFocusIndex(0, 3, false)).toBe(1)
    expect(wrappingFocusIndex(1, 3, false)).toBe(2)
    expect(wrappingFocusIndex(2, 3, false)).toBe(0)
  })

  it('moves backward on Shift+Tab, wrapping from the first back to the last', () => {
    expect(wrappingFocusIndex(2, 3, true)).toBe(1)
    expect(wrappingFocusIndex(1, 3, true)).toBe(0)
    expect(wrappingFocusIndex(0, 3, true)).toBe(2)
  })

  it('treats an unknown current position (-1) as "before the first" — Tab enters at 0, Shift+Tab enters at the last', () => {
    expect(wrappingFocusIndex(-1, 3, false)).toBe(0)
    expect(wrappingFocusIndex(-1, 3, true)).toBe(2)
  })

  it('returns -1 for a count of 0 (nothing to focus)', () => {
    expect(wrappingFocusIndex(0, 0, false)).toBe(-1)
    expect(wrappingFocusIndex(-1, 0, true)).toBe(-1)
  })

  it('stays put (index 0) for a single-element trap', () => {
    expect(wrappingFocusIndex(0, 1, false)).toBe(0)
    expect(wrappingFocusIndex(0, 1, true)).toBe(0)
  })
})
