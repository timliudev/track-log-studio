import type { LogaFormat, HeaderParseResult } from './types'
import { scanMarkerHeader } from './markerHeader'

const FIRST_LINE = '<aRacer MX APP Log File>'

/**
 * MX APP ("aRacer MX APP Log File"), exported by the aRacer x Tune Android app
 * (often shared as a .zip containing this .loga). Same marker-based layout as
 * SuperX — "<VAR NAME>" then the column row, "<DATA START>" then data — with
 * extra "<VAR ID>" / "<VAR GROUP>" sections that the shared scan ignores.
 * Differences from SuperX: a "<aRacer MX APP Log File>" title, a dashed 24h
 * "Created Date:2026-05-15 17:53:50", column names with no "/說明" suffix, and
 * GPS supplied only as decimal-degree Phone_GPS_Latitude/Longitude (aliased to
 * GPS_Lat/GPS_Lon so the track map and exporter pick it up).
 */
export const mxAppFormat: LogaFormat = {
  id: 'mxApp',

  matches(firstLine) {
    return firstLine.trim().startsWith(FIRST_LINE)
  },

  parseHeader(lines): HeaderParseResult {
    return scanMarkerHeader(lines, 'MX APP')
  },
}
