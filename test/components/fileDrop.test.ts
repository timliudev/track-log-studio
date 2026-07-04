import { describe, it, expect } from 'vitest'
import { isFileDrag, filesFromDataTransfer } from '@/components/fileDrop'

/** Minimal DataTransfer stand-in — only the members our helpers read. */
function fakeDataTransfer(types: string[], files: File[] = []): DataTransfer {
  return { types, files } as unknown as DataTransfer
}

describe('fileDrop — isFileDrag', () => {
  it('is true when DataTransfer.types includes "Files"', () => {
    expect(isFileDrag(fakeDataTransfer(['Files']))).toBe(true)
  })

  it('is false for a text/link drag (no "Files" type)', () => {
    expect(isFileDrag(fakeDataTransfer(['text/plain']))).toBe(false)
    expect(isFileDrag(fakeDataTransfer(['text/uri-list', 'text/plain']))).toBe(false)
  })

  it('is false for a null/undefined DataTransfer', () => {
    expect(isFileDrag(null)).toBe(false)
    expect(isFileDrag(undefined)).toBe(false)
  })
})

describe('fileDrop — filesFromDataTransfer', () => {
  it('returns the dropped files for a real file drag', () => {
    const f1 = new File(['a'], 'a.loga')
    const f2 = new File(['b'], 'b.nmea')
    const files = filesFromDataTransfer(fakeDataTransfer(['Files'], [f1, f2]))
    expect(files).toEqual([f1, f2])
  })

  it('returns [] for a non-file drag even if files happens to be non-empty', () => {
    const f1 = new File(['a'], 'a.loga')
    const files = filesFromDataTransfer(fakeDataTransfer(['text/plain'], [f1]))
    expect(files).toEqual([])
  })

  it('returns [] for a null DataTransfer', () => {
    expect(filesFromDataTransfer(null)).toEqual([])
  })
})
