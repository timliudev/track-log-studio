/**
 * On-device diagnostics for the intermittent Android "load a file → the page
 * reloads itself" bug (#11). A phone has no DevTools and the reload wipes the
 * console, so the cause is lost the moment it happens. This module persists what
 * happened to localStorage and shows it back *after* the reload, right on screen.
 *
 * It is deliberately framework-agnostic (plain DOM, no Vue) and initialised before
 * the app mounts, so it still reports even if Vue itself crashes or the renderer
 * is killed. Gated behind `?debug=1` (sticky via localStorage) — invisible to
 * normal users. Turn off with `?debug=0`.
 *
 * The decisive signal is `document.wasDiscarded`: true ⇒ the OS discarded the tab
 * under memory pressure and Chrome auto-reloaded it (NOT a JS crash). Combined
 * with the navigation type, captured JS errors, the page-lifecycle events
 * (pagehide/freeze) and a JS-heap memory trail, this tells us whether the reload
 * is an OOM tab discard, a renderer OOM crash, an uncaught error, or a real
 * navigation — without tethering the phone to a PC.
 */

const LS_LOG = 'tls_debug_log'
const LS_ON = 'tls_debug_on'
const MAX_EVENTS = 80

interface DbgEvent {
  t: number
  type: string
  detail?: string
}

/** `?debug=1` enables (and sticks); `?debug=0` disables; otherwise the sticky flag. */
function isEnabled(): boolean {
  try {
    const v = new URLSearchParams(location.search).get('debug')
    if (v === '1') {
      localStorage.setItem(LS_ON, '1')
      return true
    }
    if (v === '0') {
      localStorage.removeItem(LS_ON)
      return false
    }
    return localStorage.getItem(LS_ON) === '1'
  } catch {
    return false
  }
}

function loadEvents(): DbgEvent[] {
  try {
    const a = JSON.parse(localStorage.getItem(LS_LOG) || '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

function saveEvents(events: DbgEvent[]): void {
  try {
    localStorage.setItem(LS_LOG, JSON.stringify(events.slice(-MAX_EVENTS)))
  } catch {
    /* storage full / unavailable — drop silently */
  }
}

/** Current JS heap usage in bytes, when the browser exposes it (Chrome only). */
function heapBytes(): number | undefined {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return m?.usedJSHeapSize
}

function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

export function initDiagnostics(): void {
  if (!isEnabled()) return

  const events = loadEvents()
  let peakBytes = 0

  const memStr = (): string => {
    const b = heapBytes()
    if (b == null) return 'n/a'
    if (b > peakBytes) peakBytes = b
    return `${Math.round(b / 1048576)}/${Math.round(peakBytes / 1048576)}MB`
  }

  // How did we get here, and was the tab discarded? (captured up front so the
  // header/list renderers can read them.)
  const nav =
    (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ??
    '?'
  const discarded = (document as unknown as { wasDiscarded?: boolean }).wasDiscarded === true

  // ── on-screen panel (plain DOM) — declared before the first push() so its ──
  // render functions are out of the temporal dead zone when push() calls them.
  let listEl: HTMLElement | null = null
  let headerEl: HTMLElement | null = null

  const renderHeader = (): void => {
    if (!headerEl) return
    headerEl.textContent = `🐞 診斷 ｜ wasDiscarded=${discarded} ｜ nav=${nav} ｜ mem ${memStr()}`
  }

  const renderList = (): void => {
    if (!listEl) return
    // newest last so the cause sits at the bottom, nearest the reload boundary
    listEl.textContent = events
      .map((ev) => `${fmtTime(ev.t)} ${ev.type}${ev.detail ? '  ' + ev.detail : ''}`)
      .join('\n')
    listEl.scrollTop = listEl.scrollHeight
  }

  const push = (type: string, detail?: string): void => {
    events.push({ t: Date.now(), type, detail })
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
    saveEvents(events)
    renderList()
  }

  const mountPanel = (): void => {
    if (!document.body || document.getElementById('tls-debug-panel')) return

    const panel = document.createElement('div')
    panel.id = 'tls-debug-panel'
    panel.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      'z-index:2147483647',
      'max-height:45vh',
      'display:flex',
      'flex-direction:column',
      'font:11px/1.4 ui-monospace,Menlo,Consolas,monospace',
      'color:#e6e6e6',
      'background:rgba(15,15,18,0.94)',
      'border-top:2px solid #c33',
      'box-shadow:0 -2px 12px rgba(0,0,0,0.5)',
    ].join(';')

    const bar = document.createElement('div')
    bar.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:4px 8px;background:#2a1414;flex:0 0 auto'

    headerEl = document.createElement('div')
    headerEl.style.cssText = 'flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis'

    const mkBtn = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.textContent = label
      b.style.cssText =
        'flex:0 0 auto;font:11px monospace;color:#eee;background:#444;border:1px solid #666;border-radius:4px;padding:2px 8px'
      b.addEventListener('click', onClick)
      return b
    }

    const copyBtn = mkBtn('複製', () => {
      const text = events
        .map((ev) => `${fmtTime(ev.t)} ${ev.type}${ev.detail ? '  ' + ev.detail : ''}`)
        .join('\n')
      navigator.clipboard?.writeText(text).then(
        () => (copyBtn.textContent = '已複製'),
        () => (copyBtn.textContent = '失敗'),
      )
      setTimeout(() => (copyBtn.textContent = '複製'), 1500)
    })
    const clearBtn = mkBtn('清除', () => {
      events.length = 0
      saveEvents(events)
      renderList()
    })
    const offBtn = mkBtn('關閉', () => {
      try {
        localStorage.removeItem(LS_ON)
      } catch {
        /* ignore */
      }
      panel.remove()
    })

    let collapsed = false
    const toggleBtn = mkBtn('—', () => {
      collapsed = !collapsed
      listEl!.style.display = collapsed ? 'none' : 'block'
      toggleBtn.textContent = collapsed ? '+' : '—'
    })

    bar.append(headerEl, copyBtn, clearBtn, offBtn, toggleBtn)

    listEl = document.createElement('pre')
    listEl.style.cssText =
      'flex:1 1 auto;margin:0;padding:6px 8px;overflow:auto;white-space:pre-wrap;word-break:break-word'

    panel.append(bar, listEl)
    document.body.appendChild(panel)

    renderHeader()
    renderList()
  }

  if (document.body) mountPanel()
  else window.addEventListener('DOMContentLoaded', mountPanel)

  // ── load marker: the first record of this (possibly post-reload) session ──
  push('LOAD', `nav=${nav} wasDiscarded=${discarded} mem=${memStr()} ua=${navigator.userAgent}`)

  // ── crash / error capture ─────────────────────────────────────────────────
  window.addEventListener('error', (e) => {
    const stack = e.error instanceof Error ? e.error.stack ?? '' : ''
    push('ERROR', `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${stack}`.slice(0, 600))
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    const detail = r instanceof Error ? r.stack ?? r.message : String(r)
    push('REJECT', detail.slice(0, 600))
  })

  // ── page lifecycle: the events that precede a discard / reload ────────────
  window.addEventListener('pagehide', (e) => {
    push('pagehide', `persisted=${e.persisted} mem=${memStr()}`)
  })
  document.addEventListener('visibilitychange', () => {
    push('visibility', `${document.visibilityState} mem=${memStr()}`)
  })
  // Page Lifecycle API (Chromium): 'freeze' fires right before the tab is frozen
  // for a possible discard; 'resume' if it comes back without being discarded.
  document.addEventListener('freeze', () => push('FREEZE', `mem=${memStr()}`))
  document.addEventListener('resume', () => push('resume', `mem=${memStr()}`))

  // ── service worker: prime suspect for a no-error nav=reload. The PWA is set
  // to autoUpdate, which reloads the page on `controllerchange`; a SW stuck
  // re-installing (e.g. on the Workers deploy) makes that loop. If a
  // SW-CONTROLLERCHANGE lands right before a reload, that's the cause.
  if ('serviceWorker' in navigator) {
    const sw = navigator.serviceWorker
    push('sw', `controllerAtLoad=${sw.controller ? 'yes' : 'none'}`)
    sw.addEventListener('controllerchange', () =>
      push('SW-CONTROLLERCHANGE', 'new SW took control → autoUpdate reloads here'),
    )
    sw.getRegistration()
      .then((reg) => {
        if (!reg) {
          push('sw', 'no registration')
          return
        }
        push('sw', `active=${reg.active?.state ?? '?'} waiting=${!!reg.waiting} installing=${!!reg.installing}`)
        reg.addEventListener('updatefound', () => {
          const inst = reg.installing
          push('SW-UPDATEFOUND', `installing=${inst?.state ?? '?'}`)
          inst?.addEventListener('statechange', () => push('sw', `installing→${inst.state}`))
        })
      })
      .catch((e) => push('sw', `getRegistration err ${e}`))
  }

  // ── file-input marker: separates "reload follows the file pick" (Android may
  // kill a backgrounded tab while the picker is open) from a SW reload loop
  // (which fires with no file involved). Captured globally so it works for any
  // <input type=file> in the app.
  document.addEventListener(
    'change',
    (e) => {
      const t = e.target
      if (t instanceof HTMLInputElement && t.type === 'file') {
        const f = t.files?.[0]
        push('FILE-INPUT', f ? `${f.name} ${(f.size / 1048576).toFixed(1)}MB mem=${memStr()}` : 'no file')
      }
    },
    true,
  )

  // ── live memory sampler: tracks peak + refreshes the header (not stored) ──
  setInterval(() => {
    memStr()
    renderHeader()
  }, 3000)
}
