/** Logical source family used by the current-values update-rate summary. */
export type ChannelUpdateRateGroup = 'gps' | 'ecu'

export interface NamedChannelUpdateRate {
  name: string
  rateHz: number | null
}

export interface ChannelUpdateRateSummary {
  gpsHz: number | null
  ecuHz: number | null
}

/**
 * Estimate how often a channel actually publishes a new value.
 *
 * A change event is a finite sample whose value differs from the previous
 * finite value. The result is the reciprocal of the median interval between
 * consecutive change events. Holding the same value across several recorder
 * rows therefore does not inflate the reported rate, while a constant or
 * otherwise insufficient channel returns null.
 */
export function inferChannelUpdateRateHz(
  values: ArrayLike<number>,
  elapsedSeconds: ArrayLike<number>,
): number | null {
  const length = Math.min(values.length, elapsedSeconds.length)
  let previousValue: number | null = null
  let previousChangeTime: number | null = null
  const intervals: number[] = []

  for (let i = 0; i < length; i++) {
    const value = values[i]
    if (!Number.isFinite(value)) continue
    if (previousValue == null) {
      previousValue = value
      continue
    }
    if (value === previousValue) continue

    previousValue = value
    const time = elapsedSeconds[i]
    if (!Number.isFinite(time)) continue
    if (previousChangeTime != null) {
      const interval = time - previousChangeTime
      if (Number.isFinite(interval) && interval > 0) intervals.push(interval)
    }
    previousChangeTime = time
  }

  const interval = median(intervals)
  return interval != null && interval > 0 ? 1 / interval : null
}

/** GPS_* is recorder GPS data; every other source belongs to the ECU group. */
export function channelUpdateRateGroup(name: string): ChannelUpdateRateGroup {
  return /^GPS_/i.test(name) ? 'gps' : 'ecu'
}

/** Median of usable channel rates, so one unusually fast/slow signal does not dominate a group. */
export function representativeUpdateRateHz(rates: readonly (number | null)[]): number | null {
  return median(rates.filter((rate): rate is number => rate != null && Number.isFinite(rate) && rate > 0))
}

/** Build the GPS/ECU representative rates from already-cached per-channel rates. */
export function summarizeChannelUpdateRates(
  channels: readonly NamedChannelUpdateRate[],
): ChannelUpdateRateSummary {
  const gps: Array<number | null> = []
  const ecu: Array<number | null> = []
  for (const channel of channels) {
    if (channelUpdateRateGroup(channel.name) === 'gps') gps.push(channel.rateHz)
    else ecu.push(channel.rateHz)
  }
  return {
    gpsHz: representativeUpdateRateHz(gps),
    ecuHz: representativeUpdateRateHz(ecu),
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}
