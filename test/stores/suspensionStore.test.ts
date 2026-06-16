import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useSuspensionStore } from '@/stores/suspensionStore'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('suspensionStore', () => {
  it('defaults to disabled front/rear with AD1/AD2 sources', () => {
    const s = useSuspensionStore()
    expect(s.config.front.enabled).toBe(false)
    expect(s.config.front.source).toBe('AD1')
    expect(s.config.rear.source).toBe('AD2')
    expect(s.config.front.maxMv).toBe(5000)
  })

  it('setChannel patches one channel without touching the rest', () => {
    const s = useSuspensionStore()
    s.setChannel('front', { enabled: true, maxMm: 120 })
    expect(s.config.front.enabled).toBe(true)
    expect(s.config.front.maxMm).toBe(120)
    expect(s.config.front.source).toBe('AD1')
    expect(s.config.rear.enabled).toBe(false)
  })

  it('reset restores defaults', () => {
    const s = useSuspensionStore()
    s.setChannel('front', { enabled: true })
    s.reset()
    expect(s.config.front.enabled).toBe(false)
  })
})
