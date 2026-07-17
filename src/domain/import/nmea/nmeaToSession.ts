import { parseNmea } from './NmeaReader'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

export function nmeaToSession(text: string): LogSession {
  const { fixes, exportMetadata } = parseNmea(text)
  const n = fixes.length
  const time = new Float32Array(n)
  const lat = new Float32Array(n)
  const lon = new Float32Array(n)
  const speed = new Float32Array(n)
  const course = new Float32Array(n)
  if (n > 0) {
    const t0 = fixes[0].timeMs
    for (let i = 0; i < n; i++) {
      time[i] = fixes[i].timeMs - t0
      lat[i] = fixes[i].lat
      lon[i] = fixes[i].lon
      speed[i] = fixes[i].speedKnots * 1.852
      course[i] = fixes[i].course
    }
  }
  const channels: Channel[] = [
    { name: 'Time', rawName: 'Time', description: undefined, data: time },
    { name: 'GPS_Lat', rawName: 'GPS_Lat', description: 'GPS Latitude (°)', data: lat },
    { name: 'GPS_Lon', rawName: 'GPS_Lon', description: 'GPS Longitude (°)', data: lon },
    { name: 'GPS_Speed', rawName: 'GPS_Speed', description: 'GPS Speed (km/h)', data: speed },
    { name: 'GPS_Course', rawName: 'GPS_Course', description: 'GPS Course (°)', data: course },
  ]
  return new LogSession(channels, {
    formatId: 'nmea',
    createdDate: null,
    headerInfo: {},
    exportMetadata,
  })
}
