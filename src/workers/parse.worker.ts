/// <reference lib="webworker" />
import { parseLoga } from '@/domain/parsing/LogaParser'
import { nmeaToSession } from '@/domain/import/nmea/nmeaToSession'
import { parseVbo } from '@/domain/import/vbo/parseVbo'
import { parseRcz } from '@/domain/import/rcz/parseRcz'
import { parseRcnx } from '@/domain/import/rcnx/parseRcnx'
import { parseXrk } from '@/domain/import/xrk/parseXrk'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { LogSession } from '@/domain/model/LogSession'
import type { ParseRequest, ParseResponse } from './parseProtocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

/** Progress callback passed through to a worker parser. */
type ProgressFn = (fraction: number) => void

/**
 * A parser entry runnable in the worker. `binary: false` parsers receive the
 * file decoded as text; `binary: true` parsers receive the raw bytes. The
 * worker reads the file in the right mode based on this flag.
 */
interface WorkerParser {
  binary: boolean
  parse: (
    input: string | Uint8Array,
    onProgress?: ProgressFn,
  ) => LogSession | Promise<LogSession>
}

/**
 * Parsers runnable in the worker, keyed by importer id. Any format here can be
 * parsed off the main thread; the importer is chosen by `request.importerId`.
 * Each entry must only depend on worker-safe code (no DOM / window).
 */
const WORKER_PARSERS: Record<string, WorkerParser> = {
  loga: { binary: false, parse: (input, onProgress) => parseLoga(input as string, onProgress) },
  nmea: { binary: false, parse: (input) => nmeaToSession(input as string) },
  vbo: { binary: false, parse: (input) => parseVbo(input as string) },
  rcz: { binary: true, parse: (input) => parseRcz(input as Uint8Array) },
  rcnx: { binary: true, parse: (input) => parseRcnx(input as Uint8Array, sqlWasmUrl) },
  xrk: { binary: true, parse: (input) => parseXrk(input as Uint8Array) },
}

// Parses a log file off the main thread and streams progress back. The parsed
// channels are returned with their Float32Array buffers transferred (zero-copy)
// so the main thread can rebuild a LogSession.
ctx.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, importerId, file } = event.data
  try {
    const entry = WORKER_PARSERS[importerId]
    if (!entry) {
      ctx.postMessage({
        id,
        kind: 'error',
        message: `No worker parser for importer '${importerId}'`,
      } satisfies ParseResponse)
      return
    }
    const input: string | Uint8Array = entry.binary
      ? new Uint8Array(await file.arrayBuffer())
      : await file.text()
    const session = await entry.parse(input, (fraction) => {
      ctx.postMessage({ id, kind: 'progress', fraction } satisfies ParseResponse)
    })

    const channels = session.channels.map((c) => ({
      name: c.name,
      rawName: c.rawName,
      description: c.description,
      data: c.data,
    }))
    const transfer = channels.map((c) => c.data.buffer)

    ctx.postMessage(
      { id, kind: 'done', channels, meta: session.meta } satisfies ParseResponse,
      transfer,
    )
  } catch (err) {
    ctx.postMessage({
      id,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies ParseResponse)
  }
}
