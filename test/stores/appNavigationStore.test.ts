import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppNavigationStore } from '@/stores/appNavigationStore'

describe('appNavigationStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps a requested modified-loga destination until the destination consumes it', () => {
    const navigation = useAppNavigationStore()
    navigation.requestConverterSaveModified()
    expect(navigation.target).toBe('converter-save-modified')

    navigation.consumeConverterSaveModified()
    expect(navigation.target).toBeNull()
  })
})
