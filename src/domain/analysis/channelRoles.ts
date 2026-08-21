/**
 * B134 — channel-ROLE resolution (RPM / speed / gear), consolidated.
 *
 * Background: an importer that can't canonicalise every column (e.g. a
 * third-party `.vbo` merge tool that names the RPM column `EngineRPM_rpm`
 * instead of the `RPM/引擎轉速`-style header our own exporters and `.loga`
 * firmware use) leaves the session's RPM/speed/gear data sitting under an
 * arbitrary channel name that nothing in the app recognises — `RPM`-only
 * lookups (`drivetrain.ts`'s old `resolveRpmChannel`), the `GPS_Speed` /
 * `Vehicle_Speed` fallback (`cornerSpeed.ts`'s `resolveSpeedChannel`) and
 * `inferDrivetrainKind`'s inline gear-name regex all come back empty, and the
 * gear/CVT tools go dark with no manual recourse. This module is the SINGLE
 * place all three of those lookups now live, so they can share one resolution
 * order and — new in B134 — a name/unit heuristic plus a user override, so a
 * previously-unrecognised column stops being a dead end.
 *
 * Resolution order (strict — each step only runs if the previous found
 * nothing):
 *
 *   1. **User override.** A device-wide `channelName → role` table (see
 *      `stores/channelRoleStore.ts`) the user can edit from a "缺少 X 頻道"
 *      empty state (`ChannelRolePicker.vue`). Only an entry whose channel
 *      NAME actually exists in THIS session is honoured — an override saved
 *      against one log's `rc_rpm` must not silently redirect a different
 *      log's identically-named-but-unrelated channel, but it also means the
 *      same mapping auto-applies to every future session from the same
 *      logging setup without the user re-picking it every time (channel
 *      names are stable per data source; sessions are not).
 *   2. **Existing canonical / ALIASES lookup.** Exactly today's pre-B134
 *      behaviour, moved here verbatim rather than reimplemented:
 *        - rpm: `session.has('RPM')` (see `LogSession.get`'s alias
 *          resolution via `canonical.ts`'s `ALIASES` — RPM has no alias
 *          group today, so this is effectively an exact-name check).
 *        - speed: `GPS_Speed` then `Vehicle_Speed`.
 *        - gear: `inferDrivetrainKind`'s original inline regex — a `gear` /
 *          `gearpos` / `gearposition` token bounded by a separator or string
 *          edge, excluding anything whose label also contains `ratio` (so a
 *          computed/derived "gear ratio" channel is never mistaken for the
 *          raw gear-position signal).
 *   3. **Name/unit heuristic** (`heuristicRoleChannel` below) — ONLY reached
 *      when step 2 found nothing, so for every session where the canonical
 *      lookup already succeeds (i.e. every existing supported format today)
 *      this step never runs and behaviour is provably unchanged — see the
 *      module's test file for the golden-fixture proof.
 *
 * ── Heuristic ranking rationale ──────────────────────────────────────────
 * The heuristic scores every channel in the session against the target
 * role's keyword lists and returns the single best-scoring candidate, or
 * null if nothing clears a sane floor (never guesses from nothing). It reads
 * `channel.name`, `rawName`, `description` and `unit`, tokenised on
 * `_ - / .` and camelCase boundaries (so `EngineRPM_rpm` → `engine`, `rpm`,
 * `rpm`; `WheelSpeedFL_kmh` → `wheel`, `speed`, `fl`, `kmh`).
 *
 * Score, per candidate:
 *   - **Tier A (exact token, 100 pts)** — a keyword appears as a WHOLE token
 *     (`rpm` in `[engine, rpm, rpm]`). This is the strongest signal: the
 *     channel's own name segments spell out the role.
 *   - **Tier B (compound token, 60 pts)** — no whole-token hit, but some
 *     token CONTAINS the keyword as a substring (e.g. a flattened header with
 *     no camelCase/delimiter at all, `enginerpm`, still yields the token
 *     `enginerpm` which contains `rpm`). Weaker than Tier A because the
 *     keyword isn't the WHOLE word — more room for an accidental hit.
 *   - **Tier C (raw substring, 30 pts)** — neither of the above, but the
 *     keyword appears somewhere in the joined, separator-stripped haystack
 *     (name+rawName+description+unit). Weakest tier — a last-resort catch
 *     for tokenisation edge cases (e.g. a keyword glued to a digit run the
 *     tokeniser split differently than expected) — this tier alone plus a
 *     penalty can still drop a candidate below the floor.
 *   - **+15 per matched BONUS token** (role-specific, e.g. `vehicle`/`gps`
 *     for speed) — corroborating evidence the channel is the PRIMARY signal
 *     for the role, not an ancillary one.
 *   - **−40 per matched PENALTY token** — universal penalties (`coarse`,
 *     `sim`, `target`, `limit`, `demand`: all name a MODIFIED/derived/desired
 *     value, not the primary measured signal) plus role-specific ones
 *     (`wheel` for speed — an individual wheel-speed sensor is a valid but
 *     inferior stand-in for the vehicle's own road speed). Soft: a penalised
 *     candidate can still win if it's the only thing on offer.
 *   - **Hard VETO (disqualifies outright)** — role-specific tokens that
 *     mirror an exclusion step 2 already enforces absolutely, so the
 *     heuristic can never re-admit what the canonical step deliberately
 *     rejects: `ratio` for gear (a computed "gear ratio" channel must never
 *     be picked as the raw gear-position signal, matching the canonical
 *     regex's own `!label.includes('ratio')` check).
 *   - **−2 × (index of the first matching token)** — a small tie-break
 *     nudge, not a tier on its own: when two candidates land in the same
 *     tier with the same bonus/penalty count, the one where the role keyword
 *     leads the name (`GearPRND` → `gear` is token 0) outranks the one where
 *     it trails (`CurrentGear` → `gear` is token 1). The leading word of a
 *     name is conventionally its SUBJECT (`GearPRND`, `RPMLimit`) rather
 *     than a qualifier (`CurrentGear`, `EngineRPM` — note this nudge is
 *     deliberately small, 2 points, so it only ever breaks an otherwise-tied
 *     score; `EngineRPM_rpm` still wins the rpm role outright on the
 *     unambiguous Tier-A `rpm` token, not on this nudge).
 *
 * A candidate whose FINAL score is <= 0 is dropped entirely (the floor) —
 * ties after that are broken alphabetically by channel name for full
 * determinism. Every score, tier and bonus/penalty list is intentionally
 * narrow (a handful of literal keywords, not a fuzzy/ML matcher) — see
 * ISSUES.md B127 (a sibling heuristic-scope decision) for why: broad,
 * clever pattern matching over arbitrary ECU/CAN naming conventions has a
 * real false-positive cost, so this heuristic only ever fires once the two
 * SAFE steps above have already failed, and only for the three roles this
 * module explicitly knows about.
 */
import type { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

export type ChannelRole = 'rpm' | 'speed' | 'gear'
export const CHANNEL_ROLES: readonly ChannelRole[] = ['rpm', 'speed', 'gear']

/** `channelName → role`, as persisted by the user — see
 *  `stores/channelRoleStore.ts`. A plain readonly record (not a Map) so it
 *  can be JSON-serialised/deserialised and passed through Vue reactivity
 *  without ceremony; small (a handful of entries in practice). */
export type ChannelRoleOverrides = Readonly<Record<string, ChannelRole>>

const NO_OVERRIDES: ChannelRoleOverrides = {}

// ── Step 2: today's canonical / ALIASES lookups (verbatim, single source) ──

/** Same regex `inferDrivetrainKind` used inline pre-B134 — a `gear`/
 *  `gearpos`/`gearposition` token bounded by whitespace/`_`/`/`/`.`/`-` or a
 *  string edge, so `GearPosition_deg` matches but `GearPRND` (no separator
 *  after `gear`) does not — that's exactly the B134 gap the heuristic below
 *  closes. `!label.includes('ratio')` keeps a derived "gear ratio" channel
 *  out of both the canonical step AND (via the shared exclude list) the
 *  heuristic step. */
const CANONICAL_GEAR_CHANNEL_RE = /(?:^|[\s_/.-])(gear|gearpos|gearposition)(?:$|[\s_/.-])/i

function canonicalRpmChannel(session: LogSession): string | null {
  return session.has('RPM') ? 'RPM' : null
}

function canonicalSpeedChannel(session: LogSession): string | null {
  if (session.has('GPS_Speed')) return 'GPS_Speed'
  if (session.has('Vehicle_Speed')) return 'Vehicle_Speed'
  return null
}

/** Returns the first channel whose name/rawName/description matches the
 *  canonical gear regex, or null. Exported so `drivetrain.ts`'s
 *  `inferDrivetrainKind` (which additionally needs the full {@link Channel},
 *  not just its name, to read gear VALUES) can reuse the exact same match
 *  instead of re-implementing the regex. */
export function canonicalGearChannel(session: LogSession): Channel | undefined {
  return session.channels.find((channel) => {
    const label = `${channel.name} ${channel.rawName} ${channel.description ?? ''}`.toLowerCase()
    return CANONICAL_GEAR_CHANNEL_RE.test(label) && !label.includes('ratio')
  })
}

// ── Step 3: name/unit heuristic ─────────────────────────────────────────

interface RoleKeywords {
  /** Whole-token / substring keywords searched for, in priority order. */
  primary: readonly string[]
  /** Extra tokens that, when ALSO present, boost an already-matching candidate. */
  bonus: readonly string[]
  /** Extra tokens that, when present, penalise an already-matching candidate
   *  (soft — lowers rank but a still-positive score can still win if nothing
   *  cleaner is on offer). */
  penalty: readonly string[]
  /** Extra tokens that, when present, DISQUALIFY the candidate outright
   *  regardless of tier (hard — mirrors an exclusion the canonical step
   *  already enforces absolutely, e.g. gear's `ratio` exclusion, so the
   *  heuristic can't accidentally re-admit what step 2 deliberately rejects). */
  veto: readonly string[]
}

/** Modifiers that name a derived/desired/limited value rather than the
 *  primary measured signal — apply to every role. */
const UNIVERSAL_PENALTY_TOKENS: readonly string[] = ['coarse', 'sim', 'target', 'limit', 'demand']

const ROLE_KEYWORDS: Readonly<Record<ChannelRole, RoleKeywords>> = {
  rpm: {
    primary: ['rpm', 'tach', 'tachometer'],
    bonus: ['engine'],
    penalty: [],
    veto: [],
  },
  speed: {
    // 'speed' alone also matches wheel-speed channels — the 'wheel' penalty
    // below is what pushes vehicle/GPS speed ahead of them, per the ranking
    // rule the B134 spec calls out explicitly.
    primary: ['speed', 'velocity', 'vss'],
    bonus: ['vehicle', 'gps'],
    penalty: ['wheel'],
    veto: [],
  },
  gear: {
    primary: ['gear', 'gearpos', 'gearposition', 'prnd'],
    bonus: [],
    penalty: [],
    // Mirrors the canonical step's `!label.includes('ratio')` exclusion —
    // hard veto (not a soft penalty) so the heuristic can never re-admit a
    // computed "gear ratio" channel as the raw gear-position signal.
    veto: ['ratio'],
  },
}

/** Split into lowercase tokens on `_ - / .` / whitespace delimiters and
 *  camelCase boundaries (lower→Upper, and the end of an acronym run before a
 *  following Title-case word, e.g. `RPMLimit` → `RPM`, `Limit`). Digits are
 *  kept attached to adjacent letters (no digit/letter boundary) since unit
 *  suffixes like `kmh`, `degps` never carry a meaningful digit split here. */
function tokenize(text: string): string[] {
  const bySeparator = text.split(/[\s_\-/.]+/).filter(Boolean)
  const tokens: string[] = []
  for (const chunk of bySeparator) {
    const camelSplit = chunk
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(' ')
    for (const t of camelSplit) if (t) tokens.push(t.toLowerCase())
  }
  return tokens
}

interface HeuristicCandidate {
  channelName: string
  score: number
}

/** Score a single channel against one role's keyword lists, or null if the
 *  channel doesn't match at all (no tier reached). See the module header
 *  comment for the full tier/bonus/penalty/tie-break rationale. */
function scoreCandidate(channel: Channel, role: ChannelRole): HeuristicCandidate | null {
  const keywords = ROLE_KEYWORDS[role]
  const haystackText = `${channel.name} ${channel.rawName} ${channel.description ?? ''} ${channel.unit ?? ''}`
  const tokens = tokenize(haystackText)
  const haystackNoSep = haystackText.toLowerCase().replace(/[^a-z0-9]/g, '')

  for (const vetoToken of keywords.veto) if (tokens.includes(vetoToken)) return null

  let bestTierScore = 0
  let firstMatchIndex = -1
  for (const keyword of keywords.primary) {
    const exactIdx = tokens.indexOf(keyword)
    if (exactIdx >= 0) {
      if (100 > bestTierScore) bestTierScore = 100
      if (firstMatchIndex === -1 || exactIdx < firstMatchIndex) firstMatchIndex = exactIdx
      continue
    }
    const compoundIdx = tokens.findIndex((t) => t.includes(keyword))
    if (compoundIdx >= 0) {
      if (60 > bestTierScore) bestTierScore = 60
      if (firstMatchIndex === -1 || compoundIdx < firstMatchIndex) firstMatchIndex = compoundIdx
      continue
    }
    if (haystackNoSep.includes(keyword)) {
      if (30 > bestTierScore) bestTierScore = 30
      // No token index available for a raw-substring hit; don't touch the
      // tie-break index (0 would unfairly claim "leads the name").
    }
  }
  if (bestTierScore === 0) return null

  let score = bestTierScore
  for (const bonusToken of keywords.bonus) if (tokens.includes(bonusToken)) score += 15
  for (const penaltyToken of [...UNIVERSAL_PENALTY_TOKENS, ...keywords.penalty]) {
    if (tokens.includes(penaltyToken)) score -= 40
  }
  if (firstMatchIndex >= 0) score -= 2 * firstMatchIndex

  return score > 0 ? { channelName: channel.name, score } : null
}

/** Best-scoring channel for `role` across the whole session, or null when no
 *  channel clears the floor. Exported mainly for tests — normal callers
 *  should go through {@link resolveRoleChannel} so overrides/canonical are
 *  applied first. */
export function heuristicRoleChannel(session: LogSession, role: ChannelRole): string | null {
  let best: HeuristicCandidate | null = null
  for (const channel of session.channels) {
    const candidate = scoreCandidate(channel, role)
    if (!candidate) continue
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.channelName < best.channelName)
    ) {
      best = candidate
    }
  }
  return best?.channelName ?? null
}

// ── Public entry point ──────────────────────────────────────────────────

/** The first override entry (in the table's own key order — a flat
 *  `Record`, so realistically at most one in practice per session) whose
 *  channel NAME exists in `session` and whose ROLE matches. Exported so
 *  `ChannelRolePicker.vue` can show what's currently overridden for THIS
 *  session/role without duplicating {@link resolveRoleChannel}'s override
 *  step (step 1 there is literally this function). */
export function overriddenChannelForRole(
  session: LogSession,
  role: ChannelRole,
  overrides: ChannelRoleOverrides,
): string | null {
  for (const [channelName, overriddenRole] of Object.entries(overrides)) {
    if (overriddenRole === role && session.has(channelName)) return channelName
  }
  return null
}

/**
 * Resolve the session's channel for `role`, in strict order:
 * override (if the named channel exists in THIS session) → canonical
 * lookup (today's exact behaviour) → name/unit heuristic. Returns null if
 * none of the three steps find anything — callers should keep showing the
 * existing "缺少 X 頻道" empty state (now paired with `ChannelRolePicker.vue`
 * so the user can supply an override on the spot) rather than guessing.
 */
export function resolveRoleChannel(
  session: LogSession,
  role: ChannelRole,
  overrides: ChannelRoleOverrides = NO_OVERRIDES,
): string | null {
  const overridden = overriddenChannelForRole(session, role, overrides)
  if (overridden) return overridden

  switch (role) {
    case 'rpm': {
      const canonical = canonicalRpmChannel(session)
      if (canonical) return canonical
      break
    }
    case 'speed': {
      const canonical = canonicalSpeedChannel(session)
      if (canonical) return canonical
      break
    }
    case 'gear': {
      const canonical = canonicalGearChannel(session)
      if (canonical) return canonical.name
      break
    }
  }

  return heuristicRoleChannel(session, role)
}

/** Stable string key for a `ChannelRoleOverrides` table, used by the derived-
 *  trace caches (`gearRatioTrace.ts`/`cvtTrace.ts`) so a live override edit
 *  correctly invalidates their per-session `WeakMap` cache instead of
 *  silently serving a pre-override result. Sorted so key ORDER never affects
 *  the hash (a store rewrite that emits the same entries in a different
 *  order must still hit the cache). */
export function hashChannelRoleOverrides(overrides: ChannelRoleOverrides): string {
  const entries = Object.entries(overrides).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(entries)
}
