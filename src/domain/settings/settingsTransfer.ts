/**
 * B19 — settings export / import transfer format.
 *
 * Scope: the "appearance / general" preferences (theme/language/timezone —
 * see settingsStore's `AppearanceSettings`), the drivetrain calculator spec
 * (gear ratios, tire/wheel circumference, redline — see drivetrainStore's
 * `PersistedDrivetrain`), and OPTIONALLY the analyzer dashboard layout
 * (grid positions + per-card collapse/pin/mobile-order state — see
 * `domain/layout/dashboardLayout.ts` / `panelState.ts` / `layoutLock.ts`).
 * Layout is opt-in (via the `layout` param being present/absent) because it's
 * a bulkier, more device-specific preference than the other two — the
 * Settings UI exposes this as an "include layout" toggle.
 *
 * Kept as a pure module (no localStorage/DOM access) so the serialize/
 * validate logic is unit-testable without a browser environment — all
 * localStorage reads/writes and file-picker/download plumbing stay in
 * SettingsView.vue.
 *
 * Deliberately reuses each domain's OWN sanitizer (`mergeAppearanceSettings`,
 * `mergeMtFormState`/`mergeCvtFormState`, `parseLayout`, `parsePanelState`,
 * `parseLayoutLocked`) rather than re-implementing shape validation here —
 * those are the same functions each store/module already uses to guard its
 * own localStorage reads, so an imported bundle is held to exactly the same
 * "tolerate missing fields, reject-and-default on garbage" standard as a
 * normal reload.
 */
import {
  mergeAppearanceSettings,
  defaultAppearanceSettings,
  type AppearanceSettings,
} from '@/stores/settingsStore'
import {
  mergeMtFormState,
  mergeCvtFormState,
  type PersistedDrivetrain,
} from '@/stores/drivetrainStore'
import {
  parseLayout,
  defaultLayout,
  type DashboardLayoutItem,
} from '@/domain/layout/dashboardLayout'
import {
  parsePanelState,
  defaultPanelState,
  type PanelState,
} from '@/domain/layout/panelState'
import { parseLayoutLocked } from '@/domain/layout/layoutLock'

/** Bumped whenever the bundle's shape changes in a way old builds can't just
 *  tolerate-and-default their way through (rare — every field below is
 *  already merged field-by-field against a default). Not currently used for
 *  any migration branching; carried purely so a FUTURE breaking change has
 *  somewhere to hang a version check. */
export const SETTINGS_EXPORT_SCHEMA_VERSION = 1

export interface LayoutSettings {
  dashboardLayout: DashboardLayoutItem[]
  panelState: PanelState
  layoutLocked: boolean
}

export interface SettingsExportBundle {
  schemaVersion: number
  /** ISO timestamp of when the export was produced — informational only
   *  (shown to the user / useful for support), never validated on import. */
  exportedAt: string
  appearance: AppearanceSettings
  drivetrain: PersistedDrivetrain
  /** Present only when the user opted in via the "include layout" toggle. */
  layout?: LayoutSettings
}

export interface BuildExportBundleInput {
  appearance: AppearanceSettings
  drivetrain: PersistedDrivetrain
  layout?: LayoutSettings
  /** Injectable clock for deterministic tests; defaults to `new Date()`. */
  now?: () => Date
}

/** Assemble a bundle from already-loaded state (the caller reads the current
 *  store/localStorage values — this function just shapes them). */
export function buildExportBundle(input: BuildExportBundleInput): SettingsExportBundle {
  const now = input.now ?? (() => new Date())
  const bundle: SettingsExportBundle = {
    schemaVersion: SETTINGS_EXPORT_SCHEMA_VERSION,
    exportedAt: now().toISOString(),
    appearance: input.appearance,
    drivetrain: input.drivetrain,
  }
  if (input.layout) bundle.layout = input.layout
  return bundle
}

/** Pretty-printed JSON, stable field order (object literal insertion order —
 *  see {@link buildExportBundle}) so a diff between two exports stays readable. */
export function serializeExportBundle(bundle: SettingsExportBundle): string {
  return JSON.stringify(bundle, null, 2)
}

export type ImportError = 'invalidJson' | 'invalidShape'

export type ImportResult =
  | { ok: true; bundle: SettingsExportBundle }
  | { ok: false; error: ImportError }

/**
 * Parse + validate an imported settings JSON string into a fully-populated
 * bundle. Tolerant of unknown/missing fields (an older export, a hand-edited
 * file, or a future build's added field are all handled the same way: known
 * fields are sanitized against their own default, unknown fields are simply
 * dropped) — only a fundamentally unparsable/non-object payload is rejected
 * outright.
 */
export function parseImportBundle(json: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return { ok: false, error: 'invalidJson' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'invalidShape' }
  }
  const d = data as Record<string, unknown>

  const appearance = mergeAppearanceSettings(d.appearance as Partial<AppearanceSettings> | undefined)

  const drivetrainRaw = (d.drivetrain && typeof d.drivetrain === 'object' ? d.drivetrain : {}) as Partial<PersistedDrivetrain>
  const drivetrain: PersistedDrivetrain = {
    kind: drivetrainRaw.kind === 'cvt' ? 'cvt' : 'mt',
    mt: mergeMtFormState(drivetrainRaw.mt),
    cvt: mergeCvtFormState(drivetrainRaw.cvt),
    inversionWheelCircumferenceMm:
      typeof drivetrainRaw.inversionWheelCircumferenceMm === 'number'
        ? drivetrainRaw.inversionWheelCircumferenceMm
        : 1870,
  }

  let layout: LayoutSettings | undefined
  if (d.layout && typeof d.layout === 'object' && !Array.isArray(d.layout)) {
    const l = d.layout as Record<string, unknown>
    layout = {
      dashboardLayout: parseLayout(JSON.stringify(l.dashboardLayout ?? null)) ?? defaultLayout(),
      panelState: parsePanelState(JSON.stringify(l.panelState ?? null)) ?? defaultPanelState(),
      layoutLocked: parseLayoutLocked(JSON.stringify(l.layoutLocked ?? null)) ?? false,
    }
  }

  return {
    ok: true,
    bundle: {
      schemaVersion: typeof d.schemaVersion === 'number' ? d.schemaVersion : SETTINGS_EXPORT_SCHEMA_VERSION,
      exportedAt: typeof d.exportedAt === 'string' ? d.exportedAt : new Date().toISOString(),
      appearance,
      drivetrain,
      layout,
    },
  }
}

export { defaultAppearanceSettings }
