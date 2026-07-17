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
