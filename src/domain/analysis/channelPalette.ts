export type ChartTheme = 'light' | 'dark'

/** Chart-series colours tuned for the app's light surface (#fff). */
export const CHANNEL_COLORS_LIGHT: readonly string[] = [
  '#b42318', '#1d4ed8', '#15803d', '#a16207',
  '#7e22ce', '#0f766e', '#be185d', '#4d7c0f',
]

/** Chart-series colours tuned for the app's dark surface (#181b21). */
export const CHANNEL_COLORS_DARK: readonly string[] = [
  '#ff6b6b', '#78a9ff', '#51cf66', '#ffd43b',
  '#d0bfff', '#63e6be', '#f783ac', '#b2f2bb',
]

/** Per-channel primary colour. The channel's selected order is stable across files. */
export function channelColor(order: number, theme: ChartTheme): string {
  const colors = theme === 'dark' ? CHANNEL_COLORS_DARK : CHANNEL_COLORS_LIGHT
  const index = ((order % colors.length) + colors.length) % colors.length
  return colors[index]
}

/**
 * Distinct brightness steps for traces of the same channel. Trace zero keeps
 * the channel's primary colour; later traces move toward the surface-opposite
 * endpoint. That preserves the channel hue while making lap/file overlays
 * distinguishable without relying on dashed lines.
 */
const TRACE_VARIANT_MIXES: readonly number[] = [0, 0.18, 0.34, 0.5]

function cycleIndex(order: number, length: number): number {
  return ((order % length) + length) % length
}

function mixComponent(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount)
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

/** Mix an opaque #rrggbb colour towards a neutral endpoint. */
function mixHex(hex: string, target: number, amount: number): string {
  const r = mixComponent(hexComponent(hex, 1), target, amount)
  const g = mixComponent(hexComponent(hex, 3), target, amount)
  const b = mixComponent(hexComponent(hex, 5), target, amount)
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Colour for one concrete trace of a channel. A light chart darkens repeated
 * traces, and a dark chart lightens them. Both directions monotonically raise
 * contrast against the respective chart surface, so every variant keeps the
 * base palette's 3:1 minimum while remaining in the same colour family.
 */
export function channelSeriesColor(channelOrder: number, traceOrder: number, theme: ChartTheme): string {
  const base = channelColor(channelOrder, theme)
  const amount = TRACE_VARIANT_MIXES[cycleIndex(traceOrder, TRACE_VARIANT_MIXES.length)]
  return amount === 0 ? base : mixHex(base, theme === 'dark' ? 255 : 0, amount)
}

function hexComponent(value: string, start: number): number {
  return Number.parseInt(value.slice(start, start + 2), 16)
}

/** WCAG relative luminance for an opaque #rrggbb colour. */
export function chartColorLuminance(hex: string): number {
  const channel = (start: number): number => {
    const c = hexComponent(hex, start) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG contrast ratio for two opaque #rrggbb colours. */
export function chartColorContrast(foreground: string, background: string): number {
  const a = chartColorLuminance(foreground)
  const b = chartColorLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
