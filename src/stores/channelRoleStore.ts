import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { CHANNEL_ROLES, type ChannelRole, type ChannelRoleOverrides } from '@/domain/analysis/channelRoles'

/**
 * B134 — device-wide `channelName → role` overrides for the RPM/speed/gear
 * channel resolver (`domain/analysis/channelRoles.ts`).
 *
 * Deliberately keyed by CHANNEL NAME rather than per-session or per-file: the
 * whole point is that a user who once tells the app "`EngineRPM_rpm` is my
 * RPM channel" never has to repeat that for the next log from the same
 * logging setup — channel names are stable per data source (a given ECU/GPS
 * logger/merge tool always emits the same header), sessions are not. Several
 * source formats can coexist in the same table (`EngineRPM_rpm`, `rc_rpm`,
 * a bike's `RPM_ecu`, …) and a single channel name could even map to a
 * different role across two entries only if the user explicitly re-picks it
 * — {@link resolveRoleChannel} always takes the LATEST entry for a name
 * since this is a flat `Record`, not a list.
 *
 * Persisted separately from the general `settingsStore` (own storage key,
 * `tracklogstudio.channelRoles.v1`) rather than folded into
 * `AppearanceSettings`: that store is "kept deliberately small" (its own
 * doc comment) — a handful of fixed scalar fields — while this table grows
 * unboundedly with the user's file collection, so it gets its own small
 * store + key instead of bloating every appearance-settings read/write.
 */

const STORAGE_KEY = 'tracklogstudio.channelRoles.v1'

/** Sanitizer caps — generous for real use (a user is never going to
 *  legitimately map hundreds of distinctly-named channels) while bounding
 *  the cost of a hostile/corrupted persisted blob, mirroring M9's CVT-array
 *  caps (`drivetrainStore.ts`'s `MAX_CVT_ARRAY_LENGTH`) and the settings
 *  transfer sanitizers' "reject the entry, don't throw" discipline. */
const MAX_ENTRIES = 512
const MAX_CHANNEL_NAME_LENGTH = 256

const VALID_ROLES: ReadonlySet<string> = new Set(CHANNEL_ROLES)

/**
 * Sanitize a possibly-partial/garbage payload (an older persisted blob, or a
 * directly-edited localStorage value) into a well-formed
 * {@link ChannelRoleOverrides}: non-object input, non-string keys, oversized
 * keys, unrecognised role values and an oversized entry count are all
 * dropped rather than thrown — never trust persisted/imported JSON wholesale
 * (same discipline as `settingsStore.ts`'s `mergeAppearanceSettings` and
 * `drivetrainStore.ts`'s CVT sanitizers).
 */
export function sanitizeChannelRoleOverrides(value: unknown): ChannelRoleOverrides {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, ChannelRole> = {}
  let count = 0
  for (const [key, role] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_ENTRIES) break
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_CHANNEL_NAME_LENGTH) continue
    if (typeof role !== 'string' || !VALID_ROLES.has(role)) continue
    out[key] = role as ChannelRole
    count++
  }
  return out
}

function loadPersisted(): ChannelRoleOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeChannelRoleOverrides(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

/**
 * The `channelName → role` override table, persisted to localStorage.
 * `overrides` is always assigned a FRESH object on every mutation (never
 * mutated in place) — `gearRatioTrace.ts`/`cvtTrace.ts`'s derived-trace
 * caches key on this reference via `hashChannelRoleOverrides`, and Vue's own
 * reactivity for a `ref<Record<...>>` needs a new object for template/
 * computed consumers to reliably see the change too.
 */
export const useChannelRoleStore = defineStore('channelRoles', () => {
  const overrides = ref<ChannelRoleOverrides>(loadPersisted())

  watch(overrides, (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
      // storage unavailable / quota — the override simply won't persist
    }
  })

  /** Map `channelName` to `role`, replacing any prior mapping for that name
   *  (a name maps to at most one role at a time). */
  function setOverride(channelName: string, role: ChannelRole): void {
    const trimmed = channelName.trim()
    if (!trimmed) return
    overrides.value = { ...overrides.value, [trimmed]: role }
  }

  /** Remove `channelName`'s mapping (the picker's "自動" / clear option) —
   *  falls back to steps 1/2 of {@link resolveRoleChannel} again. */
  function clearOverride(channelName: string): void {
    if (!(channelName in overrides.value)) return
    const next = { ...overrides.value }
    delete next[channelName]
    overrides.value = next
  }

  /** The role currently overridden for `channelName`, if any — for the
   *  picker's initial selection. */
  function roleFor(channelName: string): ChannelRole | null {
    return overrides.value[channelName] ?? null
  }

  return { overrides, setOverride, clearOverride, roleFor }
})
