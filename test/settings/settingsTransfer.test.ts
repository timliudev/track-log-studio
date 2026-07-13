import { describe, it, expect } from 'vitest'
import {
  buildExportBundle,
  serializeExportBundle,
  parseImportBundle,
  SETTINGS_EXPORT_SCHEMA_VERSION,
  type SettingsExportBundle,
} from '@/domain/settings/settingsTransfer'
import { defaultAppearanceSettings } from '@/stores/settingsStore'
import type { MtFormState } from '@/stores/drivetrainStore'
import { defaultLayout } from '@/domain/layout/dashboardLayout'
import { defaultPanelState } from '@/domain/layout/panelState'

const APPEARANCE = {
  themePref: 'dark' as const,
  localePref: 'en' as const,
  tzOverride: 480,
  inputModePref: 'touch' as const,
  centreCursorMode: false,
}

const SAMPLE_MT: MtFormState = {
  primaryReduction: 2.833,
  gearRatios: [{ mode: 'ratio', ratio: 2.615, drivenTeeth: 0, driveTeeth: 0 }],
  finalDrive: { mode: 'teeth', ratio: 0, frontTeeth: 15, rearTeeth: 45 },
  circumferenceMode: 'direct',
  tireSpec: '120/70-17',
  wheelCircumferenceMm: 1884,
  redlineRpm: 10000,
}

const DRIVETRAIN = {
  kind: 'mt' as const,
  mt: SAMPLE_MT,
  cvt: { wheelCircumferenceMm: 1400, tireSpec: '', notes: [] },
  inversionWheelCircumferenceMm: 1870,
}

describe('settingsTransfer — buildExportBundle / serializeExportBundle', () => {
  it('builds a bundle with schema version + timestamp, without layout by default', () => {
    const bundle = buildExportBundle({
      appearance: APPEARANCE,
      drivetrain: DRIVETRAIN,
      now: () => new Date('2026-07-12T00:00:00.000Z'),
    })
    expect(bundle.schemaVersion).toBe(SETTINGS_EXPORT_SCHEMA_VERSION)
    expect(bundle.exportedAt).toBe('2026-07-12T00:00:00.000Z')
    expect(bundle.appearance).toEqual(APPEARANCE)
    expect(bundle.drivetrain).toEqual(DRIVETRAIN)
    expect(bundle.layout).toBeUndefined()
  })

  it('includes layout only when explicitly passed (the "include layout" toggle)', () => {
    const layout = {
      dashboardLayout: defaultLayout(),
      panelState: defaultPanelState(),
      layoutLocked: true,
    }
    const bundle = buildExportBundle({ appearance: APPEARANCE, drivetrain: DRIVETRAIN, layout })
    expect(bundle.layout).toEqual(layout)
  })

  it('serializes to pretty-printed, round-trippable JSON', () => {
    const bundle = buildExportBundle({ appearance: APPEARANCE, drivetrain: DRIVETRAIN })
    const json = serializeExportBundle(bundle)
    expect(json).toContain('\n') // pretty-printed
    expect(JSON.parse(json)).toEqual(bundle)
  })
})

describe('settingsTransfer — parseImportBundle', () => {
  it('round-trips a bundle produced by buildExportBundle/serializeExportBundle', () => {
    const original: SettingsExportBundle = buildExportBundle({
      appearance: APPEARANCE,
      drivetrain: DRIVETRAIN,
      layout: { dashboardLayout: defaultLayout(), panelState: defaultPanelState(), layoutLocked: false },
    })
    const result = parseImportBundle(serializeExportBundle(original))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.appearance).toEqual(original.appearance)
    expect(result.bundle.drivetrain).toEqual(original.drivetrain)
    expect(result.bundle.layout).toEqual(original.layout)
  })

  it('rejects unparsable JSON', () => {
    const result = parseImportBundle('{not json')
    expect(result).toEqual({ ok: false, error: 'invalidJson' })
  })

  it('rejects a non-object payload (e.g. a bare array or number)', () => {
    expect(parseImportBundle('[1,2,3]')).toEqual({ ok: false, error: 'invalidShape' })
    expect(parseImportBundle('42')).toEqual({ ok: false, error: 'invalidShape' })
  })

  it('tolerates a payload missing every known field, falling back to defaults', () => {
    const result = parseImportBundle('{}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.appearance).toEqual(defaultAppearanceSettings())
    expect(result.bundle.drivetrain.kind).toBe('mt')
    expect(result.bundle.layout).toBeUndefined()
  })

  it('sanitizes garbage appearance fields field-by-field rather than rejecting the whole bundle', () => {
    const result = parseImportBundle(
      JSON.stringify({
        appearance: {
          themePref: 'not-a-theme',
          localePref: 'en',
          tzOverride: 'nonsense',
          inputModePref: 'not-a-mode',
          centreCursorMode: 'not-a-bool',
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.appearance).toEqual({
      themePref: 'auto',
      localePref: 'en',
      tzOverride: 'auto',
      inputModePref: 'auto',
      centreCursorMode: false,
    })
  })

  it('defaults drivetrain.kind to "mt" for anything other than the literal "cvt"', () => {
    const result = parseImportBundle(JSON.stringify({ drivetrain: { kind: 'not-a-kind' } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.drivetrain.kind).toBe('mt')
  })

  it('accepts a valid "cvt" kind', () => {
    const result = parseImportBundle(JSON.stringify({ drivetrain: { kind: 'cvt' } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.drivetrain.kind).toBe('cvt')
  })

  it('falls back to the default dashboard layout when layout.dashboardLayout is malformed', () => {
    const result = parseImportBundle(
      JSON.stringify({ layout: { dashboardLayout: 'not-an-array', panelState: {}, layoutLocked: false } }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.layout?.dashboardLayout).toEqual(defaultLayout())
  })

  it('preserves an unknown/future field being silently dropped without failing the import', () => {
    const result = parseImportBundle(JSON.stringify({ someFutureField: { anything: true } }))
    expect(result.ok).toBe(true)
  })

  it('preserves the schemaVersion when present as a number, else falls back to current', () => {
    const withVersion = parseImportBundle(JSON.stringify({ schemaVersion: 7 }))
    expect(withVersion.ok && withVersion.bundle.schemaVersion).toBe(7)
    const withoutVersion = parseImportBundle('{}')
    expect(withoutVersion.ok && withoutVersion.bundle.schemaVersion).toBe(SETTINGS_EXPORT_SCHEMA_VERSION)
  })
})
