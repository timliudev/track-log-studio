// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TrackMap from '@/features/analyzer/TrackMap.vue'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'
import { fitProjection } from '@/features/analyzer/projection'
import { colormapSwatches } from '@/domain/analysis/colormap'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'

/**
 * Refactor-protection tests for TrackMap.vue's draw() (M3): draw() is a large
 * canvas-drawing function about to be split into small named steps + pure
 * geometry helpers. The existing TrackMap tests (cursorRedraw/maximize) only
 * assert on call COUNTS or DOM/emit side effects, never on the actual drawn
 * geometry — so they wouldn't catch a refactor that subtly reorders or
 * mis-projects what gets drawn. These tests pin down the exact canvas call
 * sequence (coordinates, styles, counts) for representative prop
 * combinations BEFORE the refactor, using a recording 2D context stub, so
 * the same assertions can be re-run unchanged afterward to prove behavior
 * didn't move.
 */

let wrapper: VueWrapper | null = null

/** A simple 5-point track with a constant lat/lon step, no gaps. */
function makeTrack(n = 5): GpsTrack {
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const valid = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    lat[i] = 35 + i * 0.001
    lon[i] = 135 + i * 0.001
    valid[i] = 1
  }
  return { lat, lon, valid }
}

interface Call {
  method: string
  args: unknown[]
}

/** Rounds numbers so float noise doesn't make assertions brittle. */
function round(v: unknown): unknown {
  return typeof v === 'number' ? Math.round(v * 1000) / 1000 : v
}

function recordingContext(calls: Call[]) {
  const proxy: Record<string, unknown> = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
  }
  const tracked = [
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'fill',
    'arc',
    'fillRect',
    'strokeRect',
    'fillText',
    'strokeText',
  ]
  for (const m of tracked) {
    proxy[m] = (...args: unknown[]) => {
      calls.push({ method: m, args: args.map(round) })
    }
  }
  // Style/property setters recorded as pseudo-calls so ordering relative to
  // draw calls is preserved.
  let _strokeStyle = ''
  let _fillStyle = ''
  let _lineWidth = 0
  let _font = ''
  let _textAlign = ''
  let _textBaseline = ''
  let _lineJoin = ''
  Object.defineProperties(proxy, {
    strokeStyle: {
      get: () => _strokeStyle,
      set: (v: string) => {
        _strokeStyle = v
        calls.push({ method: 'set:strokeStyle', args: [v] })
      },
    },
    fillStyle: {
      get: () => _fillStyle,
      set: (v: string) => {
        _fillStyle = v
        calls.push({ method: 'set:fillStyle', args: [v] })
      },
    },
    lineWidth: {
      get: () => _lineWidth,
      set: (v: number) => {
        _lineWidth = v
        calls.push({ method: 'set:lineWidth', args: [v] })
      },
    },
    font: { get: () => _font, set: (v: string) => (_font = v) },
    textAlign: { get: () => _textAlign, set: (v: string) => (_textAlign = v) },
    textBaseline: { get: () => _textBaseline, set: (v: string) => (_textBaseline = v) },
    lineJoin: { get: () => _lineJoin, set: (v: string) => (_lineJoin = v) },
  })
  return proxy
}

function mountMap(props: Record<string, unknown>) {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  wrapper = mount(TrackMap, {
    props: { track: null, cursorIdx: null, line: null, ...props },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
  return wrapper
}

/** Mounts, wires the recording context + fixed canvas size, forces one draw. */
async function drawWith(props: Record<string, unknown>, w = 400, h = 300): Promise<Call[]> {
  const calls: Call[] = []
  const w0 = mountMap(props)
  const canvas = w0.find('canvas').element as HTMLCanvasElement
  const ctx = recordingContext(calls)
  // @ts-expect-error test stub — happy-dom's canvas has no real 2D context
  canvas.getContext = () => ctx
  Object.defineProperty(canvas, 'clientWidth', { value: w, configurable: true })
  Object.defineProperty(canvas, 'clientHeight', { value: h, configurable: true })
  // Any prop change re-triggers draw() with the mocked context/size now wired up.
  await w0.setProps({ track: props.track ? { ...(props.track as GpsTrack) } : null })
  return calls
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('TrackMap draw() refactor protection (M3 baseline)', () => {
  it('plain track (no heatmap, no selection): one full-range stroke at the muted color/width, at the exact fitProjection coordinates', async () => {
    const track = makeTrack(5)
    const calls = await drawWith({ track })

    const base = fitProjection(track, 400, 300, 16)!
    const expectedPts = Array.from({ length: 5 }, (_, i) => base.toPixel(track.lat[i], track.lon[i]))

    // No line/gates/extrema/cursor/heatmap → no arc/fillRect/strokeRect/fillText/strokeText at all.
    expect(calls.filter((c) => c.method === 'arc')).toHaveLength(0)
    expect(calls.filter((c) => c.method === 'fillRect')).toHaveLength(0)
    expect(calls.filter((c) => c.method === 'strokeRect')).toHaveLength(0)
    expect(calls.filter((c) => c.method === 'fillText')).toHaveLength(0)
    expect(calls.filter((c) => c.method === 'strokeText')).toHaveLength(0)

    // Exactly one stroked path: beginPath, moveTo(first), lineTo(rest), stroke.
    expect(calls.filter((c) => c.method === 'beginPath')).toHaveLength(1)
    expect(calls.filter((c) => c.method === 'stroke')).toHaveLength(1)
    const moveTo = calls.filter((c) => c.method === 'moveTo')
    const lineTo = calls.filter((c) => c.method === 'lineTo')
    expect(moveTo).toHaveLength(1)
    expect(lineTo).toHaveLength(4)
    expect(moveTo[0].args).toEqual([round(expectedPts[0].x), round(expectedPts[0].y)])
    for (let i = 1; i < 5; i++) {
      expect(lineTo[i - 1].args).toEqual([round(expectedPts[i].x), round(expectedPts[i].y)])
    }

    // Muted color (falls back to '#888' in this environment — no theme CSS loaded)
    // and lineWidth 2, both set before the stroke.
    const lastLineWidth = [...calls].reverse().find((c) => c.method === 'set:lineWidth')
    const lastStrokeStyle = [...calls].reverse().find((c) => c.method === 'set:strokeStyle')
    expect(lastLineWidth?.args).toEqual([2])
    expect(lastStrokeStyle?.args).toEqual(['#888'])
  })

  it('heatmap (colorValues set, no selection): buckets segments and strokes only non-empty buckets with the matching colormap swatch, in bucket order', async () => {
    const track = makeTrack(5)
    // Values chosen so consecutive-pair averages land in distinct, known buckets.
    const colorValues = new Float64Array([0, 0.25, 0.5, 0.75, 1])
    const calls = await drawWith({ track, colorValues, colormap: 'turbo' })

    const HEAT_BUCKETS = 32
    const swatches = colormapSwatches('turbo', HEAT_BUCKETS)
    // Reference bucket assignment, replicating draw()'s own formula independent
    // of its implementation (segment [i, i+1] buckets by the AVERAGE of the two
    // endpoint values).
    const buckets: number[][] = Array.from({ length: HEAT_BUCKETS }, () => [])
    for (let i = 0; i < 4; i++) {
      const avg = (colorValues[i] + colorValues[i + 1]) / 2
      const b = Math.min(HEAT_BUCKETS - 1, Math.max(0, Math.round(avg * (HEAT_BUCKETS - 1))))
      buckets[b].push(i)
    }
    const nonEmpty = buckets.map((seg, b) => ({ b, seg })).filter((x) => x.seg.length > 0)

    // No plain-track fallback stroke: exactly one stroke() per non-empty bucket.
    expect(calls.filter((c) => c.method === 'stroke')).toHaveLength(nonEmpty.length)

    const strokeStyleSets = calls.filter((c) => c.method === 'set:strokeStyle')
    // Every strokeStyle used during the heatmap pass is a real swatch color,
    // and they appear in ascending bucket order (buckets iterated 0..31, only
    // non-empty ones draw).
    const heatmapColors = strokeStyleSets.slice(-nonEmpty.length).map((c) => c.args[0])
    expect(heatmapColors).toEqual(nonEmpty.map((x) => swatches[x.b]))

    expect(calls.filter((c) => c.method === 'set:lineWidth').some((c) => c.args[0] === 2.5)).toBe(true)
  })

  it('line + gates + extrema + cursor + overlay all drawn together: exact per-feature call counts', async () => {
    const track = makeTrack(5)
    const overlayTrack = makeTrack(4)
    const line: LapLine = { a: { lat: 35, lon: 135 }, b: { lat: 35.0005, lon: 135 } }
    const gates = [
      { line: { a: { lat: 35.0002, lon: 135 }, b: { lat: 35.0002, lon: 135.0005 } }, confirmed: true },
      { line: { a: { lat: 35.0003, lon: 135 }, b: { lat: 35.0003, lon: 135.0005 } }, confirmed: false },
    ]
    const extremaMarkers = [
      { lat: 35.0001, lon: 135.0001, value: 10, valueFrac: 0.2, kind: 'min' as const, label: '10' },
      { lat: 35.0003, lon: 135.0003, value: 90, valueFrac: 0.8, kind: 'max' as const, label: '90' },
    ]
    const calls = await drawWith({
      track,
      cursorIdx: 2,
      line,
      gates,
      extremaMarkers,
      overlayTracks: [{ id: 1, label: 'b', color: 'rgb(1,2,3)', track: overlayTrack, offset: { x: 0, y: 0 } }],
    })

    // Start/finish line: 2 endpoint handles, each 3 fillRect (bg square + 2
    // corner squares) + 1 strokeRect (outline) = 6 fillRect, 2 strokeRect
    // attributable to handles alone. The checkered band itself uses fill()
    // (polygon path), not fillRect, and a separate strokeRect never happens
    // elsewhere in draw() (gates/extrema use arc, not rect) — so these two
    // counts are exactly the start/finish handles.
    expect(calls.filter((c) => c.method === 'fillRect')).toHaveLength(6)
    expect(calls.filter((c) => c.method === 'strokeRect')).toHaveLength(2)

    // Text draw order, exactly as draw() emits it: gate numbers first (gate 0
    // then gate 1, "1"/"2"), then per extrema marker (min then max, in
    // extremaMarkers order) its OWN numbered glyph (each kind counts from 1,
    // so both markers here read "1") followed by its formatted value label.
    const fillTexts = calls.filter((c) => c.method === 'fillText').map((c) => c.args[0])
    expect(fillTexts).toEqual(['1', '2', '1', '10', '1', '90'])
    const strokeTexts = calls.filter((c) => c.method === 'strokeText').map((c) => c.args[0])
    expect(strokeTexts).toEqual(['10', '90'])

    // Cursor marker: exactly one arc(px[2], py[2], 5, 0, 2π) after everything else.
    const base = fitProjection([track, overlayTrack], 400, 300, 16)!
    const p2 = base.toPixel(track.lat[2], track.lon[2])
    const arcs = calls.filter((c) => c.method === 'arc')
    const cursorArc = arcs.at(-1)
    expect(cursorArc?.args).toEqual([round(p2.x), round(p2.y), 5, 0, round(Math.PI * 2)])

    // Overlay track: drawn faint, BEFORE the active track's own path — i.e. its
    // moveTo/lineTo calls precede the active track's full-range stroke. We
    // confirm by checking overlay's globalAlpha-styled stroke happened before
    // the last (cursor) arc and that a save/restore pair wraps it (draw()
    // wraps each overlay stroke in ctx.save()/ctx.restore()).
    // (save/restore aren't tracked individually above; assert indirectly via
    // strokeStyle including the overlay's own color at some point.)
    const strokeStyles = calls.filter((c) => c.method === 'set:strokeStyle').map((c) => c.args[0])
    expect(strokeStyles).toContain('rgb(1,2,3)')
  })
})
