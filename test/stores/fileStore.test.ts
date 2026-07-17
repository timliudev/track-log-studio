import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useFileStore } from '@/stores/fileStore'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { loadFixture } from '../fixtures'

beforeEach(() => setActivePinia(createPinia()))

describe('fileStore', () => {
  it('beginImport creates a parsing entry with loga type', () => {
    const s = useFileStore()
    const id = s.beginImport(new File(['x'], 'test.loga'))
    expect(s.files).toHaveLength(1)
    expect(s.files[0].status).toBe('parsing')
    expect(s.files[0].fileType).toBe('loga')
    expect(id).toBeGreaterThan(0)
  })

  it('nmea files get fileType nmea', () => {
    const s = useFileStore()
    s.beginImport(new File(['x'], 'track.nmea'))
    expect(s.files[0].fileType).toBe('nmea')
  })

  it('vbo files get fileType vbo', () => {
    const s = useFileStore()
    s.beginImport(new File(['x'], 'run.vbo'))
    expect(s.files[0].fileType).toBe('vbo')
  })

  it('completeImport marks ready and getSession returns session', () => {
    const s = useFileStore()
    const session = parseLoga(loadFixture('super2.loga'))
    const id = s.beginImport(new File(['x'], 'super2.loga'))
    s.completeImport(id, session)
    expect(s.files[0].status).toBe('ready')
    expect(s.getSession(id)).toBe(session)
    expect(s.readyFiles).toHaveLength(1)
  })

  it('keeps export notes isolated per imported session', () => {
    const s = useFileStore()
    const session = parseLoga(loadFixture('super2.loga'))
    const first = s.beginImport(new File(['x'], 'first.loga'))
    const second = s.beginImport(new File(['x'], 'second.loga'))
    s.completeImport(first, session)
    s.completeImport(second, session)

    s.setExportMetadata(first, { cvtNotes: [{ label: '珠重', value: '12 g' }] })
    s.setExportMetadata(second, { cvtNotes: [{ label: '珠重', value: '14 g' }] })

    expect(s.getExportMetadata(first).cvtNotes?.[0].value).toBe('12 g')
    expect(s.getExportMetadata(second).cvtNotes?.[0].value).toBe('14 g')
    expect(s.savableEntries.find((entry) => entry.id === first)?.metadata.cvtNotes?.[0].value).toBe('12 g')
  })

  it('failImport marks error', () => {
    const s = useFileStore()
    const id = s.beginImport(new File(['x'], 'bad.loga'))
    s.failImport(id, 'parse error')
    expect(s.files[0].status).toBe('error')
    expect(s.files[0].error).toBe('parse error')
  })

  it('savableEntries includes only ready loga files', () => {
    const s = useFileStore()
    const session = parseLoga(loadFixture('super2.loga'))
    const id = s.beginImport(new File(['x'], 'test.loga'))
    s.completeImport(id, session)
    expect(s.savableEntries).toHaveLength(1)
    expect(s.savableEntries[0].name).toBe('test.loga')
  })

  it('removeFile removes entry and session', () => {
    const s = useFileStore()
    const session = parseLoga(loadFixture('super2.loga'))
    const id = s.beginImport(new File(['x'], 'test.loga'))
    s.completeImport(id, session)
    s.removeFile(id)
    expect(s.files).toHaveLength(0)
    expect(s.getSession(id)).toBeUndefined()
  })

  it('clearFiles empties everything', () => {
    const s = useFileStore()
    const session = parseLoga(loadFixture('super2.loga'))
    const id = s.beginImport(new File(['x'], 'test.loga'))
    s.completeImport(id, session)
    s.clearFiles()
    expect(s.files).toHaveLength(0)
  })

  it('addMergedSession registers an in-app-produced session as ready, fileType merged', () => {
    const s = useFileStore()
    const session = parseLoga(loadFixture('super2.loga'))
    const id = s.addMergedSession('merged-session.loga', session)
    expect(s.files).toHaveLength(1)
    expect(s.files[0].status).toBe('ready')
    expect(s.files[0].fileType).toBe('merged')
    expect(s.files[0].name).toBe('merged-session.loga')
    expect(s.getSession(id)).toBe(session)
    expect(s.readySessions).toContain(session)
    // No original File was ever supplied, so it can never appear in savableEntries.
    expect(s.savableEntries.some((e) => e.id === id)).toBe(false)
  })
})
