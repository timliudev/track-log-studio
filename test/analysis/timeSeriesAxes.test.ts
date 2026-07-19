import { describe, expect, it } from 'vitest'
import { normalizeTimeSeriesUnit, planTimeSeriesAxes } from '@/domain/analysis/timeSeriesAxes'

describe('normalizeTimeSeriesUnit', () => {
  it('normalizes only non-empty units for equality', () => {
    expect(normalizeTimeSeriesUnit(' KM / h ')).toBe('km/h')
    expect(normalizeTimeSeriesUnit('')).toBeUndefined()
    expect(normalizeTimeSeriesUnit('   ')).toBeUndefined()
    expect(normalizeTimeSeriesUnit(undefined)).toBeUndefined()
  })
})

describe('planTimeSeriesAxes', () => {
  it('shares one scale for compatible declared units while retaining unknown channels independently', () => {
    const plan = planTimeSeriesAxes([
      { id: 'BoostA', label: 'BoostA (bar)', unit: 'bar' },
      { id: 'BoostB', label: 'BoostB ( BAR )', unit: ' BAR ' },
      { id: 'RawA', label: 'RawA' },
      { id: 'RawB', label: 'RawB', unit: ' ' },
    ])

    expect(plan.axes).toEqual([
      { scale: 'unit:bar', label: 'bar', side: 3, show: true, channels: ['BoostA', 'BoostB'] },
      { scale: 'RawA', label: 'RawA', side: 1, show: true, channels: ['RawA'] },
      { scale: 'RawB', label: 'RawB', side: 3, show: true, channels: ['RawB'] },
    ])
    expect(plan.scaleFor('BoostA')).toBe('unit:bar')
    expect(plan.scaleFor('BoostB')).toBe('unit:bar')
    expect(plan.scaleFor('RawA')).toBe('RawA')
    expect(plan.scaleFor('missing')).toBe('missing')
  })

  it('keeps all groups but hides axes after the visible cap', () => {
    const plan = planTimeSeriesAxes([
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' },
      { id: 'C', label: 'C' },
      { id: 'D', label: 'D' },
      { id: 'E', label: 'E' },
      { id: 'F', label: 'F' },
    ])
    expect(plan.axes).toHaveLength(6)
    expect(plan.axes.map((axis) => axis.show)).toEqual([true, true, true, true, false, false])
    expect(plan.axes.slice(4).map((axis) => axis.channels)).toEqual([['E'], ['F']])
  })

  it('keeps a single known-unit channel label intact', () => {
    const plan = planTimeSeriesAxes([{ id: 'RPM', label: 'RPM (rpm)', unit: 'rpm' }])
    expect(plan.axes[0]).toMatchObject({ scale: 'unit:rpm', label: 'RPM (rpm)' })
  })
})
