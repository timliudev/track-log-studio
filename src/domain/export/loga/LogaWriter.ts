import { detectFormat } from '@/domain/parsing/HeaderDetector'
import { canonicalName } from '@/domain/parsing/canonical'

export interface PatchResult {
  text: string
  /** Canonical names whose existing column was overwritten. */
  replaced: string[]
  /** Canonical names added as new columns. */
  appended: string[]
}

/** Descriptions used when a new column is appended (raw = `Name/說明`). */
const APPEND_DESC: Record<string, string> = {
  'Front Suspension': '前避震行程',
  'Rear Suspension': '後避震行程',
}

/** Decimal places to write: match the column's existing precision; an integer
 * column keeps 1 decimal so calibrated sub-mm values aren't lost. */
function detectDecimals(samples: string[]): number {
  for (const s of samples) {
    const t = s.trim()
    if (t === '') continue
    const dot = t.indexOf('.')
    return dot === -1 ? 1 : t.length - dot - 1
  }
  return 1
}

function fmtVal(v: number, decimals: number): string {
  return Number.isNaN(v) ? '' : v.toFixed(decimals)
}

/**
 * Return a copy of the .loga text with the given channels written in. A channel
 * whose column already exists is overwritten in place; a missing one is appended
 * as a new column (name row + every data row). Everything else — header lines,
 * other columns, formatting, line endings — is preserved verbatim. The source
 * file is never mutated.
 *
 * Replacement arrays must have one value per non-empty data row (i.e. match
 * LogSession.rowCount), aligning with how LogaParser counts rows.
 */
export function patchLogaText(
  text: string,
  replacements: Map<string, Float32Array>,
): PatchResult {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const format = detectFormat(lines[0] ?? '')
  if (!format) throw new Error('patchLogaText: unrecognized .loga format')
  const { rawColumns, namesLineIndex, dataStartLine } = format.parseHeader(lines)

  interface Target {
    name: string
    data: Float32Array
    index: number
    decimals: number
    append: boolean
  }
  const targets: Target[] = []
  const replaced: string[] = []
  const appended: string[] = []

  for (const [name, data] of replacements) {
    const index = rawColumns.findIndex((c) => canonicalName(c) === name)
    if (index !== -1) {
      const samples: string[] = []
      for (let i = dataStartLine; i < lines.length && samples.length < 50; i++) {
        const f = lines[i].split(',')
        if (index < f.length) samples.push(f[index])
      }
      targets.push({ name, data, index, decimals: detectDecimals(samples), append: false })
      replaced.push(name)
    } else {
      targets.push({ name, data, index: -1, decimals: 1, append: true })
      appended.push(name)
    }
  }

  // Append position: after the last non-empty name (before any trailing-empty
  // column produced by a trailing comma).
  const namesArr = (lines[namesLineIndex] ?? '').split(',')
  let appendAt = namesArr.length
  while (appendAt > 0 && namesArr[appendAt - 1].trim() === '') appendAt--

  const appendTargets = targets.filter((t) => t.append)
  appendTargets.forEach((t, k) => {
    const raw = APPEND_DESC[t.name] ? `${t.name}/${APPEND_DESC[t.name]}` : t.name
    namesArr.splice(appendAt + k, 0, raw)
  })
  if (appendTargets.length > 0) lines[namesLineIndex] = namesArr.join(',')

  let row = 0
  for (let i = dataStartLine; i < lines.length; i++) {
    if (lines[i].length === 0 || lines[i].trim().length === 0) continue
    const fields = lines[i].split(',')
    for (const t of targets) {
      if (!t.append && t.index < fields.length) {
        fields[t.index] = fmtVal(t.data[row], t.decimals)
      }
    }
    appendTargets.forEach((t, k) => {
      const pos = appendAt + k
      while (fields.length < pos) fields.push('')
      fields.splice(pos, 0, fmtVal(t.data[row], t.decimals))
    })
    lines[i] = fields.join(',')
    row++
  }

  return { text: lines.join(eol), replaced, appended }
}
