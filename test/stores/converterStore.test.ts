import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useConverterStore } from '@/stores/converterStore'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { DEFAULT_PRESET } from '@/domain/export/rc3Nmea/mapping'
import { loadFixture } from '../fixtures'
import { useFileStore } from '@/stores/fileStore'
import { nmeaToSession } from '@/domain/import/nmea/nmeaToSession'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('converterStore', () => {
  it('starts on the default preset', () => {
    const s = useConverterStore()
    expect(s.activePresetId).toBe('default')
    expect(s.mapping.a1.channel).toBe(DEFAULT_PRESET.a1.channel)
  })

  it('setSlot updates the mapping and marks it custom', () => {
    const s = useConverterStore()
    s.setSlot('a1', 'RPM', 0)
    expect(s.mapping.a1).toEqual({ channel: 'RPM', decimals: 0 })
    expect(s.activePresetId).toBe('custom')
  })

  it('saves a user preset, reapplies it, and resets to default', () => {
    const s = useConverterStore()
    s.setSlot('a1', 'RPM', 0)
    s.saveToUser(0, 'mine')
    expect(s.activePresetId).toBe('user1')

    s.reset()
    expect(s.activePresetId).toBe('default')
    expect(s.mapping.a1.channel).toBe(DEFAULT_PRESET.a1.channel)

    s.applyPreset('user1')
    expect(s.mapping.a1.channel).toBe('RPM')
  })

  it('convertAll produces .nmea for ready files', () => {
    const s = useConverterStore()
    const session = parseLoga(loadFixture('super2.loga'))
    const id = s.beginImport(new File(['x'], 'Super2.loga'))
    s.completeImport(id, session)

    const results = s.convertAll()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Super2.nmea')
    expect(results[0].content).toContain('$RC3')
    expect(s.availableChannels.length).toBeGreaterThan(0)
  })

  it('threads each file session\'s own CVT notes into every registry export', () => {
    const s = useConverterStore()
    const session = parseLoga(loadFixture('super2.loga'))
    const first = s.beginImport(new File(['x'], 'first.loga'))
    const second = s.beginImport(new File(['x'], 'second.loga'))
    s.completeImport(first, session)
    s.completeImport(second, session)
    const fileStore = useFileStore()
    fileStore.setExportMetadata(first, { cvtNotes: [{ label: '珠重', value: '12 g' }] })
    fileStore.setExportMetadata(second, { cvtNotes: [{ label: '珠重', value: '14 g' }] })

    const results = s.convertAll()
    expect(results).toHaveLength(2)
    expect(nmeaToSession(results[0].content).meta.exportMetadata?.cvtNotes?.[0].value).toBe('12 g')
    expect(nmeaToSession(results[1].content).meta.exportMetadata?.cvtNotes?.[0].value).toBe('14 g')
  })

  it('convertAll in .vbo mode emits _ct, _rc and _channels.csv per log', () => {
    const s = useConverterStore()
    const session = parseLoga(loadFixture('super2.loga'))
    const id = s.beginImport(new File(['x'], 'Super2.loga'))
    s.completeImport(id, session)

    s.setOutputFormat('vbo')
    const results = s.convertAll()
    expect(results.map((r) => r.name)).toEqual([
      'Super2_ct.vbo',
      'Super2_rc.vbo',
      'Super2_channels.csv',
    ])
    expect(results[0].content).toContain('[header]')
    expect(results[1].content).toContain('rc_rpm')
  })
})
