/** A selected channel and the display metadata needed to plan its value axis. */
export interface TimeSeriesAxisChannel {
  id: string
  label: string
  unit?: string
}

/** A value-axis independent of the charting library. */
export interface TimeSeriesValueAxis {
  /** Stable uPlot scale key used by every channel in this axis group. */
  scale: string
  label: string
  side: 1 | 3
  /** Hidden axes leave their series in the legend and plot, without shrinking it. */
  show: boolean
  channels: readonly string[]
}

export interface TimeSeriesAxesPlan {
  axes: readonly TimeSeriesValueAxis[]
  /** Resolve a selected channel to its value scale; unknown ids stay independent. */
  scaleFor(channelId: string): string
}

/**
 * Normalize source units for equality only. The original trimmed spelling is
 * retained for labels, while equivalent casing/whitespace shares one scale.
 */
export function normalizeTimeSeriesUnit(unit: string | undefined): string | undefined {
  const trimmed = unit?.trim()
  return trimmed ? trimmed.replace(/\s+/g, '').toLocaleLowerCase() : undefined
}

interface MutableGroup {
  scale: string
  label: string
  unit?: string
  channels: string[]
}

/**
 * Plan compact chart value axes. A declared non-empty unit is the only signal
 * that two channels are safe to share a scale; unknown units deliberately stay
 * independent so unrelated raw values are never flattened together. Series
 * remain present when their axis is hidden after the visible-axis cap.
 */
export function planTimeSeriesAxes(
  channels: readonly TimeSeriesAxisChannel[],
  maxVisibleAxes = 4,
): TimeSeriesAxesPlan {
  const groups: MutableGroup[] = []
  const groupByKey = new Map<string, MutableGroup>()
  const scaleByChannel = new Map<string, string>()

  for (const channel of channels) {
    const normalizedUnit = normalizeTimeSeriesUnit(channel.unit)
    const groupKey = normalizedUnit ? `unit:${normalizedUnit}` : `channel:${channel.id}`
    let group = groupByKey.get(groupKey)
    if (!group) {
      group = {
        scale: normalizedUnit ? groupKey : channel.id,
        label: channel.label,
        unit: normalizedUnit ? channel.unit!.trim() : undefined,
        channels: [],
      }
      groupByKey.set(groupKey, group)
      groups.push(group)
    }
    group.channels.push(channel.id)
    scaleByChannel.set(channel.id, group.scale)
  }

  const visibleCount = Math.max(0, maxVisibleAxes)
  const axes = groups.map((group, index) => ({
    scale: group.scale,
    // A shared unit is less ambiguous than arbitrarily naming one of its
    // channels. Single-channel groups retain the B80 channel + unit label.
    label: group.channels.length > 1 && group.unit ? group.unit : group.label,
    side: (index % 2 === 0 ? 3 : 1) as 1 | 3,
    show: index < visibleCount,
    channels: group.channels,
  }))

  return {
    axes,
    scaleFor: (channelId) => scaleByChannel.get(channelId) ?? channelId,
  }
}
