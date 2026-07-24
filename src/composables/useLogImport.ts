import ParseWorker from '@/workers/parse.worker?worker'
import type { LogSession } from '@/domain/model/LogSession'
import type { ParseRequest, ParseResponse } from '@/workers/parseProtocol'
import { rebuildLogSession } from '@/workers/rebuildSession'

type ProgressFn = (fraction: number) => void

interface Pending {
  resolve: (session: LogSession) => void
  reject: (error: Error) => void
  onProgress?: ProgressFn
}

// One shared worker reused across parses; requests are correlated by id.
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new ParseWorker()
  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    const msg = event.data
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.kind === 'progress') {
      p.onProgress?.(msg.fraction)
    } else if (msg.kind === 'done') {
      pending.delete(msg.id)
      p.resolve(rebuildLogSession(msg.channels, msg.meta))
    } else {
      pending.delete(msg.id)
      p.reject(new Error(msg.message))
    }
  }
  return worker
}

/**
 * Parse log files off the main thread. Parsing is serialised through a single
 * worker (memory-friendly for large files); progress is reported per file. The
 * importer is selected in the worker by `importerId`.
 */
export function useLogImport(): {
  parseFile: (
    file: File,
    importerId: string,
    onProgress?: ProgressFn,
    sessionIndex?: number,
    rczSessionKey?: string,
  ) => Promise<LogSession>
} {
  function parseFile(
    file: File,
    importerId: string,
    onProgress?: ProgressFn,
    sessionIndex?: number,
    rczSessionKey?: string,
  ): Promise<LogSession> {
    const w = ensureWorker()
    const id = nextId++
    return new Promise<LogSession>((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress })
      w.postMessage({ id, importerId, file, sessionIndex, rczSessionKey } satisfies ParseRequest)
    })
  }

  return { parseFile }
}
