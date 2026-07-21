import { STATIC_CARD_IDS } from './dashboardLayout'

/**
 * F2 — "no corresponding data → default OFF" per-card predicate: cheap,
 * already-computed-elsewhere signals AnalyzerView folds into one context
 * object so this stays a pure, unit-testable function rather than each card
 * re-deriving its own availability check.
 *
 * Only cards with a CHEAP, already-available signal get a real predicate
 * here (per the F2 v1 spec); every other card (map, lap table, track file,
 * the align panels, session merge, current values, every chart) is always
 * relevant or has no cheap signal to check, so it defaults ON — see the
 * `default` branch below.
 */
export interface CardDataContext {
  /** Sectors card: at least one sector gate has been placed on the track. An
   *  empty gate list means the feature hasn't been configured for this
   *  circuit yet — see AnalyzerView's `sectorStore.gates`. */
  hasSectorGates: boolean
  /** Accel-test card: the whole-session search (accelTest.ts) actually found
   *  ≥1 qualifying segment (e.g. a launch) — an empty result means there's
   *  nothing to show yet even though the feature is always "available". */
  hasAccelSegment: boolean
  /** Suspension card: at least one part (front/rear) has an ENABLED
   *  calibration whose source channel is actually present in this session —
   *  mirrors SuspensionCard.vue's own `channelPresent` check. */
  hasSuspensionChannel: boolean
  /** The active drivetrain kind (drivetrainStore.kind) — cheap because it's
   *  already a single reactive ref, not derived from the session data. */
  drivetrainKind: 'mt' | 'cvt'
}

/** True when `id`'s card has data worth showing BY DEFAULT — i.e. before any
 *  explicit user show/hide choice is applied (see cardVisibility.ts's
 *  `isCardVisible`, which lets an explicit choice always override this). */
export function cardHasData(id: string, ctx: CardDataContext): boolean {
  switch (id) {
    case STATIC_CARD_IDS.sectors:
      return ctx.hasSectorGates
    case STATIC_CARD_IDS.accelTest:
      return ctx.hasAccelSegment
    case STATIC_CARD_IDS.suspension:
      return ctx.hasSuspensionChannel
    // Gear-ratio calculator: relevant for a manual-transmission drivetrain.
    case STATIC_CARD_IDS.gear:
      return ctx.drivetrainKind === 'mt'
    // CVT dynamics model: relevant only for a CVT drivetrain — independently
    // ALSO gated by the cvtDynamics feature flag (see AnalyzerView's
    // isVisibleId), which this predicate doesn't need to know about.
    case STATIC_CARD_IDS.cvtDynamics:
      return ctx.drivetrainKind === 'cvt'
    default:
      return true
  }
}
