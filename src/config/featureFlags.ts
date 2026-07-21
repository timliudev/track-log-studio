import { computed, reactive, type ComputedRef } from 'vue'

/**
 * F2 — a small, typed feature-flag registry replacing B98's hard-coded
 * `if (id === STATIC_CARD_IDS.cvtDynamics) return false` in AnalyzerView.
 * A flag is OFF by default until explicitly enabled by a developer/tester —
 * see `defaultCardVisibilityPrefs`'s sibling `cardVisibility.ts` for the
 * SEPARATE "does the user want to see this card" concern; a flag gates
 * whether the card can EVER appear at all (dev-only / not-yet-field-tested),
 * while the visibility store is a normal device preference layered on top.
 *
 * Resolution precedence (highest wins):
 *  1. `window.__flags` — an in-memory, per-PAGE-LOAD console override (see
 *     `installWindowFlagsApi` below). Never persisted; gone on reload.
 *  2. `?ff=` URL query — a comma list, e.g. `?ff=cvtDynamics` enables,
 *     `?ff=-cvtDynamics` disables. Parsed once per page load and folded into
 *     a per-TAB `sessionStorage` blob (see `initSessionOverrides`) so it
 *     survives an in-app navigation that drops the query string (this is an
 *     SPA — the router changes the URL without a full reload).
 *  3. Persisted `localStorage` override — written by the Settings
 *     "開發者選項" toggle (SettingsView.vue), survives across sessions on
 *     this device.
 *  4. The registry's own `default`.
 *
 * Every layer is a plain reactive object (Vue's `reactive()`), so a plain
 * (non-composable) `isFlagEnabled` read still participates in whatever
 * computed/watcher calls it synchronously — no need to route every caller
 * through `useFeatureFlags()` (AnalyzerView's `isVisibleId` is a plain
 * function called from inside several computed getters, same shape as the
 * rest of this module's callers).
 */

export interface FeatureFlagDef {
  /** Resolved value when no override at any layer applies. */
  default: boolean
  /** i18n key for the flag's toggle label in Settings' dev-options section. */
  labelKey: string
  /** i18n key for an optional one-line description under the toggle. */
  descriptionKey?: string
}

/** The registry itself — one entry per flag. Add new flags here; nothing
 *  else needs to change for a flag to show up in Settings' dev-options list
 *  (see SettingsView.vue, which iterates `Object.keys(FEATURE_FLAGS)`). */
const FEATURE_FLAG_REGISTRY = {
  // B98 — the CVT dynamics card is feature-complete but not yet
  // field-tested; OFF by default so it doesn't show for ordinary users until
  // a tester flips it on via ?ff=cvtDynamics, the console, or Settings.
  cvtDynamics: {
    default: false,
    labelKey: 'settings.devOptions.flags.cvtDynamics.label',
    descriptionKey: 'settings.devOptions.flags.cvtDynamics.description',
  },
} as const satisfies Record<string, FeatureFlagDef>

export type FeatureFlagName = keyof typeof FEATURE_FLAG_REGISTRY
export const FEATURE_FLAGS: Record<FeatureFlagName, FeatureFlagDef> = FEATURE_FLAG_REGISTRY

/** Ambient typing for the console-debug `window.__flags` handle installed by
 *  `installWindowFlagsApi` below — untyped (`unknown`) since its real shape
 *  (a Proxy mixing direct flag properties with `list()`/`reset()` methods)
 *  isn't meant to be consumed from app TypeScript code, only the console. */
declare global {
  interface Window {
    __flags?: unknown
  }
}

export function isFeatureFlagName(name: string): name is FeatureFlagName {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, name)
}

const LOCAL_STORAGE_KEY = 'tracklogstudio.featureFlags.v1'
const SESSION_STORAGE_KEY = 'tracklogstudio.featureFlags.session.v1'

type FlagOverrides = Partial<Record<FeatureFlagName, boolean>>

function sanitizeOverrides(data: unknown): FlagOverrides {
  const out: FlagOverrides = {}
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (isFeatureFlagName(k) && typeof v === 'boolean') out[k] = v
  }
  return out
}

/**
 * Parse a `?ff=` query VALUE (just the param's raw string, e.g.
 * `"cvtDynamics,-someOtherFlag"`) into per-flag overrides. Exported as a pure
 * function (no `location`/storage access) so the precedence/parsing logic is
 * unit-testable without a browser environment — same "pure core, thin
 * localStorage shell" split every other domain module in this app uses.
 * Unknown flag names are silently ignored (forward-compatible with a `?ff=`
 * link that mentions a flag this build doesn't have).
 */
export function parseFfParam(raw: string | null | undefined): FlagOverrides {
  const out: FlagOverrides = {}
  if (!raw) return out
  for (const tokRaw of raw.split(',')) {
    const tok = tokRaw.trim()
    if (!tok) continue
    const disable = tok.startsWith('-')
    const name = disable ? tok.slice(1) : tok
    if (isFeatureFlagName(name)) out[name] = !disable
  }
  return out
}

/**
 * Pure resolution — given the three override layers (window/session/local,
 * `undefined` meaning "no override at that layer") plus the registry
 * default, returns the effective value. Exported separately from
 * `isFlagEnabled` (which reads the real reactive layers below) purely so the
 * PRECEDENCE ORDER itself has a direct unit test independent of
 * localStorage/sessionStorage/window plumbing.
 */
export function resolveFlagValue(
  layers: { windowOverride?: boolean; sessionOverride?: boolean; localOverride?: boolean },
  registryDefault: boolean,
): boolean {
  if (layers.windowOverride !== undefined) return layers.windowOverride
  if (layers.sessionOverride !== undefined) return layers.sessionOverride
  if (layers.localOverride !== undefined) return layers.localOverride
  return registryDefault
}

// --- Layer 1: window.__flags in-memory console override (highest precedence) ---
const windowOverrides = reactive<FlagOverrides>({})

// --- Layer 2: ?ff= query, folded into a per-tab sessionStorage blob ---
function readSessionOverrides(): FlagOverrides {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? sanitizeOverrides(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function initSessionOverrides(): FlagOverrides {
  try {
    const fromQuery = parseFfParam(new URLSearchParams(location.search).get('ff'))
    const existing = readSessionOverrides()
    if (Object.keys(fromQuery).length === 0) return existing
    const merged = { ...existing, ...fromQuery }
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(merged))
    return merged
  } catch {
    return {}
  }
}

const sessionOverrides = reactive<FlagOverrides>(initSessionOverrides())

// --- Layer 3: persisted localStorage override (Settings dev-options UI) ---
function readLocalOverrides(): FlagOverrides {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw ? sanitizeOverrides(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

const localOverrides = reactive<FlagOverrides>(readLocalOverrides())

function persistLocalOverrides(): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ ...localOverrides }))
  } catch {
    // storage unavailable / quota — override simply won't persist
  }
}

/** Set (or, passing `null`, clear) a PERSISTED localStorage override for
 *  `name` — this is what the Settings dev-options toggle calls (see
 *  SettingsView.vue). Independent of `windowOverrides`/`sessionOverrides` —
 *  `window.__flags.reset()` only ever clears the in-memory layer, never this
 *  persisted one. */
export function setLocalFlagOverride(name: FeatureFlagName, value: boolean | null): void {
  if (value === null) delete localOverrides[name]
  else localOverrides[name] = value
  persistLocalOverrides()
}

/** Current persisted (localStorage) override for `name`, or `undefined` when
 *  the user hasn't touched it — lets Settings distinguish "off because
 *  explicitly disabled" from "off because still at the registry default". */
export function getLocalFlagOverride(name: FeatureFlagName): boolean | undefined {
  return localOverrides[name]
}

/**
 * The single resolution entry point every caller should use (AnalyzerView's
 * isVisibleId, the card menu, Settings' "目前生效" indicator). Reads three
 * reactive layers via plain property access/`in`, both of which Vue's
 * `reactive()` proxy tracks as dependencies — so calling this from inside a
 * computed getter (even indirectly, e.g. through `isVisibleId`) correctly
 * re-runs that computed when any layer changes, with no extra wiring needed.
 */
export function isFlagEnabled(name: FeatureFlagName): boolean {
  return resolveFlagValue(
    {
      windowOverride: windowOverrides[name],
      sessionOverride: sessionOverrides[name],
      localOverride: localOverrides[name],
    },
    FEATURE_FLAGS[name].default,
  )
}

function resolvedSnapshot(): Record<FeatureFlagName, boolean> {
  const out = {} as Record<FeatureFlagName, boolean>
  for (const name of Object.keys(FEATURE_FLAGS) as FeatureFlagName[]) out[name] = isFlagEnabled(name)
  return out
}

/**
 * `window.__flags` console API — a thin `Proxy` over the in-memory
 * `windowOverrides` reactive object so `window.__flags.cvtDynamics = true`
 * both sets the override AND (being a Vue-reactive target) notifies every
 * dependent computed, plus two convenience methods:
 *   - `window.__flags.list()` → the fully-RESOLVED flag values (after
 *     precedence), for a quick "what's actually on right now" readout.
 *   - `window.__flags.reset(name?)` → clear one (or, with no argument,
 *     every) in-memory override, falling back to the next layer down.
 * Guarded so installing it (and every layer's init above) can never throw in
 * a non-browser environment (SSR / the test suite's default `node`
 * environment, which has no `window`/`location`/`sessionStorage` at all).
 */
function installWindowFlagsApi(): void {
  try {
    const handle = new Proxy(windowOverrides as Record<string, unknown>, {
      get(target, prop) {
        if (prop === 'list') return () => resolvedSnapshot()
        if (prop === 'reset') {
          return (name?: FeatureFlagName) => {
            if (name) delete target[name]
            else for (const k of Object.keys(target)) delete target[k]
          }
        }
        return Reflect.get(target, prop)
      },
      set(target, prop, value) {
        if (typeof prop === 'string' && isFeatureFlagName(prop)) target[prop] = Boolean(value)
        return true
      },
    })
    window.__flags = handle
  } catch {
    // no `window` (SSR/tests) — the console API simply isn't installed;
    // isFlagEnabled still works fine via the session/local/default layers.
  }
}
installWindowFlagsApi()

/** Reactive composable form, for template/computed consumers that want the
 *  full resolved set (e.g. Settings' dev-options list) rather than checking
 *  one flag at a time. */
export function useFeatureFlags(): {
  isFlagEnabled: (name: FeatureFlagName) => boolean
  flags: ComputedRef<Record<FeatureFlagName, boolean>>
} {
  const flags = computed(() => resolvedSnapshot())
  return { isFlagEnabled, flags }
}
