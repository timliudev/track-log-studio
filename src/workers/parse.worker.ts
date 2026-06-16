/// <reference lib="webworker" />
import { parseLoga } from '@/domain/parsing/LogaParser'
import type { ParseRequest, ParseResponse } from './parseProtocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

// Parses .loga text off the main thread and streams progress back. The parsed
// channels are returned with their Float32Array buffers transferred (zero-copy)
// so the main thread can rebuild a LogSession. UI wiring lands in Phase 1.
ctx.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, text } = event.data
  try {
    const session = parseLoga(text, (fraction) => {
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
