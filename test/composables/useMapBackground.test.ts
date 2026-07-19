// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMapBackground } from '@/composables/useMapBackground'

// M9 P2 — re-uploading a custom map background image previously left the
// OLD blob orphaned in IndexedDB forever (nothing ever referenced its id
// again once settings.imageId was overwritten). This mocks `idb` with an
// in-memory Map standing in for the object store so the test can assert the
// composable actually deletes the superseded blob once the new one lands.
const { mockStore, mockDb } = vi.hoisted(() => {
  const mockStore = new Map<string, unknown>()
  const mockDb = {
    put: vi.fn(async (_store: string, value: unknown, key: string) => {
      mockStore.set(key, value)
      return key
    }),
    get: vi.fn(async (_store: string, key: string) => mockStore.get(key)),
    delete: vi.fn(async (_store: string, key: string) => {
      mockStore.delete(key)
    }),
  }
  return { mockStore, mockDb }
})

vi.mock('idb', () => ({
  openDB: vi.fn(async () => mockDb),
}))

function installMemoryLocalStorage(): void {
  let store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store = new Map()
    },
  })
}

function pngFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/png' })
}

beforeEach(() => {
  installMemoryLocalStorage()
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
  mockStore.clear()
  mockDb.put.mockClear()
  mockDb.get.mockClear()
  mockDb.delete.mockClear()
})

describe('useMapBackground upload (M9 P2 — old blob cleanup)', () => {
  it('does not delete anything on the first upload (no previous image)', async () => {
    const bg = useMapBackground()
    const err = await bg.upload(pngFile('a.png'))
    expect(err).toBeNull()
    expect(mockDb.delete).not.toHaveBeenCalled()
    expect(mockStore.size).toBe(1)
  })

  it('deletes the previous blob after a second upload replaces it', async () => {
    const bg = useMapBackground()
    await bg.upload(pngFile('a.png'))
    const firstId = bg.settings.value.imageId
    expect(firstId).not.toBeNull()

    await bg.upload(pngFile('b.png'))
    const secondId = bg.settings.value.imageId
    expect(secondId).not.toBeNull()
    expect(secondId).not.toBe(firstId)

    expect(mockDb.delete).toHaveBeenCalledTimes(1)
    expect(mockDb.delete).toHaveBeenCalledWith('images', firstId)
    // Only the newest blob remains in the store — the old one was actually removed.
    expect(mockStore.size).toBe(1)
    expect(mockStore.has(firstId as string)).toBe(false)
    expect(mockStore.has(secondId as string)).toBe(true)
  })

  it('rejects an invalid file before touching IndexedDB', async () => {
    const bg = useMapBackground()
    const badFile = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' })
    const err = await bg.upload(badFile)
    expect(err).toBe('type')
    expect(mockDb.put).not.toHaveBeenCalled()
    expect(mockDb.delete).not.toHaveBeenCalled()
  })
})
