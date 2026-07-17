import type { LogSession } from '@/domain/model/LogSession'
import { formatLapTime, formatMetricValue } from './format'

/**
 * B15/B16 — one cell of the "目前數值" (current values) dashboard card: every
 * channel in the session, plus a synthetic elapsed-time field (B16 — time is
 * just another field, not special UI chrome), read at a single shared sample
 * index. `value` is the RAW number (NaN when not computable), same
 * "NaN = no value" convention as `Channel.data` and the lap-table formatters
 * in format.ts — kept separate from the formatted STRING so a future
 * caller (e.g. a numeric sort/threshold) doesn't need to re-parse text.
 */
export interface CurrentValueField {
  /** Stable key for list rendering: 'time' for the synthetic time field, the
   *  channel's own name otherwise (channel names are unique within a session
   *  — LogSession itself indexes them by name). */
  key: string
  /** Display label — translated for synthetic fields, the channel name for raw fields. */
  label: string
  kind: 'time' | 'channel' | 'updateRate'
  value: number
}

/**
 * Resolve which sample row the current-values card reads from: the live
 * shared cursor (chart hover / map hover — see analyzerStore's `cursorIdx`)
 * when it's set and in range, otherwise the LAST row of the session.
 *
 * Design choice (no cursor set): show the session's most recent sample
 * rather than blanking every field to '—'. A cursor is a transient hover
 * state — most of the time (page just loaded, mouse not over a chart) there
 * is none, and an all-dashes grid would make the card useless at rest. The
 * last row is a well-defined, always-available snapshot ("where the log
 * ended up") and costs nothing extra to read (same O(1) index access as the
 * cursor case). Returns null only when the session has zero rows.
 */
export function resolveCurrentValueIndex(cursorIdx: number | null, rowCount: number): number | null {
  if (rowCount <= 0) return null
  if (cursorIdx != null && cursorIdx >= 0 && cursorIdx < rowCount) return cursorIdx
  return rowCount - 1
}

/**
 * Build the full field list for the current-values card: elapsed time first
 * (B16), then every channel in the session, in the session's own channel
 * order. Every value is read with a single array index (`elapsedTimeSec[i]` /
 * `ch.data[i]`) — never re-scanning a channel's full data array — so this
 * stays O(channel count), not O(channel count × row count), however often the
 * caller re-runs it (e.g. a Vue `computed` re-evaluating on every cursor
 * move). `elapsedTimeSec` is passed in (rather than computed here from
 * `session`) so the caller can cache the O(rowCount) `timeSeconds(session)`
 * call in its own `computed` keyed only on the session — it must NOT change
 * with the cursor, only with the session.
 */
export function buildCurrentValueFields(
  session: LogSession,
  elapsedTimeSec: Float64Array,
  index: number | null,
  timeLabel: string,
): CurrentValueField[] {
  const timeValue = index != null && index < elapsedTimeSec.length ? elapsedTimeSec[index] * 1000 : NaN
  const fields: CurrentValueField[] = [{ key: 'time', label: timeLabel, kind: 'time', value: timeValue }]
  for (const ch of session.channels) {
    const value = index != null && index < ch.data.length ? ch.data[index] : NaN
    fields.push({ key: ch.name, label: ch.name, kind: 'channel', value })
  }
  return fields
}

/** Format time, raw-channel and synthetic update-rate fields for display. */
export function formatCurrentValueField(field: CurrentValueField): string {
  if (field.kind === 'updateRate') {
    return Number.isFinite(field.value) ? `${formatMetricValue(field.value)} Hz` : '— Hz'
  }
  if (Number.isNaN(field.value)) return '—'
  return field.kind === 'time' ? formatLapTime(field.value) : formatMetricValue(field.value)
}
