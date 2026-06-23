import type { LogMeta } from '@/domain/model/types'

/** Message posted to the parse worker. The File is read inside the worker. */
export interface ParseRequest {
  id: number
  /** Which registered importer parses this file, e.g. 'loga' | 'nmea'. */
  importerId: string
  file: File
}

/** A channel in transferable form (the buffer is transferred, not copied). */
export interface SerializedChannel {
  name: string
  rawName: string
  description: string | undefined
  data: Float32Array
}

/** Messages posted back from the parse worker. */
export type ParseResponse =
  | { id: number; kind: 'progress'; fraction: number }
  | { id: number; kind: 'done'; channels: SerializedChannel[]; meta: LogMeta }
  | { id: number; kind: 'error'; message: string }
