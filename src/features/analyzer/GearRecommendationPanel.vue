<script setup lang="ts">
/**
 * F8 — Stages 2/3/4: renders `gearRecommendation.ts`'s math core output on
 * top of the MT calculator's spec + `EngineProfileInput.vue`'s engine
 * profile (both read live from `drivetrainStore`).
 *
 * ── Layout ───────────────────────────────────────────────────────────────
 * 1. A 3-way target switcher (Stage 3): 加速優先 / 依實測 log 速域 / 極速優先 —
 *    only 加速優先 changes the "recommended ratio" column below (a full
 *    geometric re-spacing); the other two targets drive the 終傳建議 block
 *    instead (a final-drive suggestion doesn't touch per-gear spacing).
 * 2. 建議齒比表 (Stage 2, always shown once a usable band exists): per gear,
 *    current ratio + upshift landing-rpm diagnosis (`diagnoseExistingRatios`,
 *    target-independent — it's a diagnostic of the EXISTING spec) + the
 *    target-dependent recommended ratio column.
 * 3. 建議換檔轉速 (Stage 2, curve-only): `optimalShiftRpm` per upshift pair.
 * 4. 終傳建議 (Stage 2/3): content depends on the active target.
 *
 * ── Stage 4 honesty gating ──────────────────────────────────────────────
 * Every curve-only output (here: just 建議換檔轉速 — this panel deliberately
 * does not surface `simulateAcceleration`, see the file-level note below)
 * gates on `curveProfile` being non-null, which requires BOTH `activeKind
 * === 'curve'` AND a currently-valid parsed curve (via
 * `engineProfileForm.ts`'s `buildCurveProfile` — the SAME function
 * `EngineProfileInput.vue` uses, so the two components can never disagree).
 * When gated, the section header still renders with an explanatory hint —
 * "visibly disabled with a stated reason", never silently absent — per the
 * F8 spec's explicit requirement.
 *
 * ── Deliberately not implemented (scope decisions, see PR/handoff notes) ──
 * - `simulateAcceleration` is not surfaced at all: it needs a rider-supplied
 *   vehicle mass (and optional aero/rolling-resistance parameters) that
 *   would add a whole extra input surface for a result the spec itself
 *   marks optional ("if you surface it at all") and whose value is only a
 *   relative comparison, never an absolute time — the ratio table + shift-
 *   rpm list already carry this panel's actionable content.
 * - Corner-EXIT speeds for the 依實測 log 速域 target are not extracted —
 *   `recommendForMeasuredSpeeds` treats `cornerExitSpeedsKmh` as fully
 *   optional and degrades gracefully to the plain speed-distribution score
 *   without it; deriving a genuine "exit point" from `detectCorners` would
 *   mean writing new corner-adjacent heuristics beyond what the F8 spec
 *   authorizes ("reuse what exists, do NOT write new corner detection").
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import { useDrivetrainStore, toMtDrivetrainSpec } from '@/stores/drivetrainStore'
import { useChannelRoleStore } from '@/stores/channelRoleStore'
import { resolveRoleChannelDetailed } from '@/domain/analysis/channelRoles'
import { resolveGearRatio } from '@/domain/analysis/drivetrain'
import { buildEngineProfile, buildCurveProfile } from '@/domain/analysis/engineProfileForm'
import {
  usableBand as computeUsableBand,
  recommendRatioSpacing,
  diagnoseExistingRatios,
  optimalShiftRpm,
  finalDriveForTopSpeed,
  rankSprocketCombos,
  diagnoseTopSpeedGearing,
  recommendForMeasuredSpeeds,
  type RatioDiagnosis,
  type OptimalShiftResult,
  type SprocketCombo,
} from '@/domain/analysis/gearRecommendation'

const props = defineProps<{
  /** The active session, for the 依實測 log 速域 target's speed-sample
   *  extraction — null shows an explanatory disabled hint on that target. */
  session: LogSession | null
}>()

const { t } = useI18n()
const store = useDrivetrainStore()
const channelRoleStore = useChannelRoleStore()

const mtSpec = computed(() => toMtDrivetrainSpec(store.mt))
const redlineRpm = computed<number | null>(() => (store.mt.redlineRpm > 0 ? store.mt.redlineRpm : null))

// ── Engine profile (shared with EngineProfileInput.vue's own build calls —
// see this file's header comment on why these must be the SAME functions). ─
const engineProfile = computed(() => buildEngineProfile(store.mt.engineProfile, redlineRpm.value))
const band = computed(() => (engineProfile.value ? computeUsableBand(engineProfile.value) : null))
/** Stage 4 gate: non-null only when the ACTIVE selection is curve AND it
 *  currently parses/validates — a leftover valid curve paste sitting behind
 *  an active two-point selection does not count (see header comment). */
const curveProfile = computed(() =>
  store.mt.engineProfile.activeKind === 'curve'
    ? buildCurveProfile(store.mt.engineProfile.curve, redlineRpm.value).profile
    : null,
)

// ── Resolved per-gear ratios — same skip-invalid-slot indexing as
// `computeMtGearTable`'s own internal loop (see that function in
// drivetrain.ts), so `gear` numbers here always agree with the numbering
// already shown in GearPanel's "計算結果" table above this one. ───────────
interface ResolvedGear {
  gear: number
  ratio: number
}
const resolvedGears = computed<ResolvedGear[]>(() => {
  const out: ResolvedGear[] = []
  mtSpec.value.gearRatios.forEach((input, i) => {
    const g = resolveGearRatio(input)
    if (g > 0) out.push({ gear: i + 1, ratio: g })
  })
  return out
})

// ── Stage 3: target switcher ──────────────────────────────────────────────
// Local UI state only (not persisted) — switching targets is a "what if"
// exploration, not a durable setting like the drivetrain spec itself.
type RecommendationTarget = 'acceleration' | 'measuredLog' | 'topSpeed'
const target = ref<RecommendationTarget>('acceleration')
const TARGETS: readonly RecommendationTarget[] = ['acceleration', 'measuredLog', 'topSpeed']
const TARGET_LABEL_KEY: Record<RecommendationTarget, string> = {
  acceleration: 'analyzer.gearRec.targetAcceleration',
  measuredLog: 'analyzer.gearRec.targetMeasuredLog',
  topSpeed: 'analyzer.gearRec.targetTopSpeed',
}
const TARGET_HINT_KEY: Record<RecommendationTarget, string> = {
  acceleration: 'analyzer.gearRec.targetAccelerationHint',
  measuredLog: 'analyzer.gearRec.targetMeasuredLogHint',
  topSpeed: 'analyzer.gearRec.targetTopSpeedHint',
}

// ── Stage 2: 建議齒比表 — recommended-ratio column only for the acceleration
// target (see header comment on why the other targets don't produce one). ──
const recommendedRatios = computed<number[] | null>(() => {
  if (target.value !== 'acceleration' || !band.value || resolvedGears.value.length === 0) return null
  const topGearRatio = resolvedGears.value[resolvedGears.value.length - 1].ratio
  return recommendRatioSpacing({ band: band.value, gearCount: resolvedGears.value.length, topGearRatio })
})

/** Target-independent diagnostic of the EXISTING spec's upshift landing
 *  points — always computed once a band exists, regardless of `target`. */
const landingDiagnosis = computed<RatioDiagnosis[]>(() =>
  band.value ? diagnoseExistingRatios(mtSpec.value.gearRatios, band.value) : [],
)
const landingByFromGear = computed<Map<number, RatioDiagnosis>>(() => {
  const map = new Map<number, RatioDiagnosis>()
  for (const d of landingDiagnosis.value) map.set(d.gear, d)
  return map
})

/** Rounds to the nearest whole rpm for display; a sub-1rpm distance from the
 *  torque peak reads as landing exactly ON it rather than a spurious ±0. */
const LANDING_AT_TOLERANCE_RPM = 0.5
function landingLabelKey(deltaFromBottomRpm: number): string {
  if (deltaFromBottomRpm < -LANDING_AT_TOLERANCE_RPM) return 'analyzer.gearRec.landingBelow'
  if (deltaFromBottomRpm > LANDING_AT_TOLERANCE_RPM) return 'analyzer.gearRec.landingAbove'
  return 'analyzer.gearRec.landingAt'
}
function landingParams(d: RatioDiagnosis): Record<string, string> {
  return { rpm: fmtRpmValue(d.landingRpm), delta: fmtRpmValue(Math.abs(d.deltaFromBottomRpm)) }
}

// ── Stage 2 (curve-only): 建議換檔轉速 ─────────────────────────────────────
interface ShiftRecommendation {
  gear: number
  next: number
  result: OptimalShiftResult
}
const shiftRecommendations = computed<ShiftRecommendation[]>(() => {
  const profile = curveProfile.value
  const gears = resolvedGears.value
  if (!profile || gears.length < 2) return []
  const out: ShiftRecommendation[] = []
  for (let i = 0; i < gears.length - 1; i++) {
    const result = optimalShiftRpm(profile, gears[i].ratio, gears[i + 1].ratio)
    if (result) out.push({ gear: gears[i].gear, next: gears[i + 1].gear, result })
  }
  return out
})
const REASON_KEY: Record<OptimalShiftResult['reason'], string> = {
  crossover: 'analyzer.gearRec.reasonCrossover',
  redlineClamped: 'analyzer.gearRec.reasonRedlineClamped',
  bandFloorClamped: 'analyzer.gearRec.reasonBandFloorClamped',
}

// ── Stage 3 target: 依實測 log 速域 ────────────────────────────────────────
const speedChannelName = computed<string | null>(() =>
  props.session ? (resolveRoleChannelDetailed(props.session, 'speed', channelRoleStore.overrides)?.name ?? null) : null,
)

const MAX_SPEED_SAMPLES = 20000
function strideFilterNumbers(arr: number[], max: number): number[] {
  if (arr.length <= max) return arr
  const stride = Math.max(1, Math.floor(arr.length / max))
  return arr.filter((_, i) => i % stride === 0)
}

const speedSamplesKmh = computed<number[]>(() => {
  const session = props.session
  const name = speedChannelName.value
  if (!session || !name) return []
  const channel = session.get(name)
  if (!channel) return []
  const samples: number[] = []
  for (const v of channel.data) if (Number.isFinite(v) && v > 0) samples.push(v)
  return strideFilterNumbers(samples, MAX_SPEED_SAMPLES)
})

const measuredLogUnavailableReason = computed<string | null>(() => {
  if (!props.session) return 'analyzer.gearRec.targetMeasuredLogNoSession'
  if (!speedChannelName.value) return 'analyzer.gearRec.targetMeasuredLogNoSpeed'
  return null
})

const measuredLogResult = computed(() => {
  if (target.value !== 'measuredLog' || !band.value || measuredLogUnavailableReason.value) return null
  if (speedSamplesKmh.value.length === 0) return null
  return recommendForMeasuredSpeeds({ speedSamplesKmh: speedSamplesKmh.value, spec: mtSpec.value, band: band.value })
})

// ── Stage 3 target: 極速優先 ────────────────────────────────────────────────
const targetTopSpeedKmh = ref<number | null>(null)
const achievedTopSpeedKmh = ref<number | null>(null)

function numOrNull(e: Event): number | null {
  const raw = (e.target as HTMLInputElement).value
  if (raw.trim() === '') return null
  const v = Number(raw)
  return Number.isFinite(v) && v > 0 ? v : null
}

const topSpeedSuggestedFinalDrive = computed<number | null>(() => {
  if (target.value !== 'topSpeed' || targetTopSpeedKmh.value == null) return null
  if (redlineRpm.value == null || resolvedGears.value.length === 0) return null
  return finalDriveForTopSpeed({
    targetTopSpeedKmh: targetTopSpeedKmh.value,
    redlineRpm: redlineRpm.value,
    topGearRatio: resolvedGears.value[resolvedGears.value.length - 1].ratio,
    primaryReduction: mtSpec.value.primaryReduction,
    wheelCircumferenceMm: mtSpec.value.wheelCircumferenceMm,
  })
})
const sprocketCombos = computed<SprocketCombo[]>(() => {
  const drive = topSpeedSuggestedFinalDrive.value
  if (drive == null || store.mt.finalDrive.mode !== 'teeth') return []
  return rankSprocketCombos(drive)
})
const topSpeedDiagnosis = computed(() =>
  achievedTopSpeedKmh.value != null ? diagnoseTopSpeedGearing(mtSpec.value, achievedTopSpeedKmh.value) : null,
)
const VERDICT_KEY: Record<NonNullable<ReturnType<typeof diagnoseTopSpeedGearing>>['gearingVerdict'], string> = {
  'over-geared': 'analyzer.gearRec.topSpeedVerdictOverGeared',
  matched: 'analyzer.gearRec.topSpeedVerdictMatched',
  'under-geared': 'analyzer.gearRec.topSpeedVerdictUnderGeared',
}

// ── Formatting ─────────────────────────────────────────────────────────────
function fmtRatio(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : '—'
}
function fmtRpmValue(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v)) : '—'
}
function fmtPct(frac: number): string {
  return Number.isFinite(frac) ? `${Math.round(frac * 100)}%` : '—'
}
function fmtSpeedValue(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} km/h` : '—'
}
</script>

<template>
  <div class="gear-recommendation-panel">
    <h4 class="sub-heading">{{ t('analyzer.gearRec.heading') }}</h4>
    <p v-if="!engineProfile" class="hint">{{ t('analyzer.gearRec.noEngineProfile') }}</p>
    <template v-else>
      <!-- Stage 3: target switcher -->
      <span class="mode-label">{{ t('analyzer.gearRec.targetHeading') }}</span>
      <div class="row target-toggle" role="group" :aria-label="t('analyzer.gearRec.targetHeading')">
        <button
          v-for="tgt in TARGETS"
          :key="tgt"
          type="button"
          :class="{ active: target === tgt }"
          @click="target = tgt"
        >
          {{ t(TARGET_LABEL_KEY[tgt]) }}
        </button>
      </div>
      <p class="hint inline-hint">{{ t(TARGET_HINT_KEY[target]) }}</p>

      <!-- Stage 2: 建議齒比表 -->
      <h5 class="sub-sub-heading">{{ t('analyzer.gearRec.ratioTableHeading') }}</h5>
      <p v-if="target !== 'acceleration'" class="hint inline-hint">
        {{ t('analyzer.gearRec.recommendedRatioOnlyAcceleration') }}
      </p>
      <table v-if="resolvedGears.length > 0" class="results-table rec-table">
        <thead>
          <tr>
            <th>{{ t('analyzer.gearRec.colGear') }}</th>
            <th>{{ t('analyzer.gearRec.colCurrentRatio') }}</th>
            <th v-if="target === 'acceleration'">{{ t('analyzer.gearRec.colRecommendedRatio') }}</th>
            <th>{{ t('analyzer.gearRec.colLandingRpm') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(g, i) in resolvedGears" :key="g.gear">
            <td>{{ g.gear }}</td>
            <td>{{ fmtRatio(g.ratio) }}</td>
            <td v-if="target === 'acceleration'">
              {{ recommendedRatios ? fmtRatio(recommendedRatios[i]) : '—' }}
            </td>
            <td>
              <template v-if="landingByFromGear.get(g.gear)">
                {{ t(landingLabelKey(landingByFromGear.get(g.gear)!.deltaFromBottomRpm), landingParams(landingByFromGear.get(g.gear)!)) }}
              </template>
              <template v-else>—</template>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Stage 2 (curve-only): 建議換檔轉速 -->
      <h5 class="sub-sub-heading">{{ t('analyzer.gearRec.shiftRpmHeading') }}</h5>
      <p v-if="!curveProfile" class="hint inline-hint">{{ t('analyzer.gearRec.shiftRpmCurveOnlyHint') }}</p>
      <ul v-else-if="shiftRecommendations.length > 0" class="shift-list">
        <li v-for="s in shiftRecommendations" :key="s.gear">
          {{ t('analyzer.gearRec.shiftRow', { gear: s.gear, next: s.next, rpm: fmtRpmValue(s.result.rpm) }) }}
          <span class="shift-reason">{{ t(REASON_KEY[s.result.reason]) }}</span>
          <span v-if="s.result.usedClampedTorque" class="hint inline-hint estimate-err">
            {{ t('analyzer.gearRec.usedClampedTorqueWarning') }}
          </span>
        </li>
      </ul>
      <p v-else class="hint inline-hint">—</p>

      <!-- Stage 2/3: 終傳建議 -->
      <h5 class="sub-sub-heading">{{ t('analyzer.gearRec.finalDriveHeading') }}</h5>
      <template v-if="target === 'acceleration'">
        <p class="hint inline-hint">{{ t('analyzer.gearRec.finalDriveAccelerationHint') }}</p>
      </template>
      <template v-else-if="target === 'measuredLog'">
        <p v-if="measuredLogUnavailableReason" class="hint inline-hint">{{ t(measuredLogUnavailableReason) }}</p>
        <p v-else-if="!measuredLogResult" class="hint inline-hint">{{ t('analyzer.gearRec.measuredLogNoSamples') }}</p>
        <template v-else>
          <p class="hint inline-hint">
            {{ t('analyzer.gearRec.measuredLogBandOccupancy', { pct: fmtPct(measuredLogResult.bandOccupancyFrac) }) }}
          </p>
          <p v-if="measuredLogResult.cornerExitBandOccupancyFrac != null" class="hint inline-hint">
            {{ t('analyzer.gearRec.measuredLogCornerExitOccupancy', { pct: fmtPct(measuredLogResult.cornerExitBandOccupancyFrac) }) }}
          </p>
          <p class="summary">
            {{
              t('analyzer.gearRec.measuredLogSuggestedFinalDrive', {
                ratio: fmtRatio(measuredLogResult.suggestedFinalDrive),
                scale: measuredLogResult.suggestedFinalDriveScale.toFixed(3),
                pct: fmtPct(measuredLogResult.suggestedBandOccupancyFrac),
              })
            }}
          </p>
        </template>
      </template>
      <template v-else>
        <div class="row params">
          <label class="field">
            <span>{{ t('analyzer.gearRec.topSpeedTargetLabel') }}</span>
            <input
              type="number"
              inputmode="decimal"
              step="1"
              min="1"
              :value="targetTopSpeedKmh ?? ''"
              @input="targetTopSpeedKmh = numOrNull($event)"
            />
          </label>
        </div>
        <p v-if="targetTopSpeedKmh != null && topSpeedSuggestedFinalDrive == null" class="hint inline-hint estimate-err">
          {{ t('analyzer.gearRec.topSpeedInvalidInput') }}
        </p>
        <p v-else-if="topSpeedSuggestedFinalDrive != null" class="summary">
          {{ t('analyzer.gearRec.topSpeedSuggestedFinalDrive', { ratio: fmtRatio(topSpeedSuggestedFinalDrive) }) }}
        </p>

        <template v-if="sprocketCombos.length > 0">
          <h6 class="sub-sub-heading">{{ t('analyzer.gearRec.topSpeedSprocketHeading') }}</h6>
          <table class="results-table sprocket-table">
            <thead>
              <tr>
                <th>{{ t('analyzer.gearRec.topSpeedColFront') }}</th>
                <th>{{ t('analyzer.gearRec.topSpeedColRear') }}</th>
                <th>{{ t('analyzer.gearRec.topSpeedColRatio') }}</th>
                <th>{{ t('analyzer.gearRec.topSpeedColError') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="combo in sprocketCombos" :key="`${combo.frontTeeth}-${combo.rearTeeth}`">
                <td>{{ combo.frontTeeth }}</td>
                <td>{{ combo.rearTeeth }}</td>
                <td>{{ fmtRatio(combo.ratio) }}</td>
                <td>{{ fmtPct(combo.errorFrac) }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <div class="row params">
          <label class="field">
            <span>{{ t('analyzer.gearRec.topSpeedAchievedLabel') }}</span>
            <input
              type="number"
              inputmode="decimal"
              step="1"
              min="1"
              :value="achievedTopSpeedKmh ?? ''"
              @input="achievedTopSpeedKmh = numOrNull($event)"
            />
          </label>
        </div>
        <p v-if="topSpeedDiagnosis" class="hint inline-hint">
          {{
            t(VERDICT_KEY[topSpeedDiagnosis.gearingVerdict], {
              theoretical: fmtSpeedValue(topSpeedDiagnosis.theoreticalTopSpeedKmh),
              achieved: fmtSpeedValue(topSpeedDiagnosis.achievedTopSpeedKmh),
              delta: fmtSpeedValue(Math.abs(topSpeedDiagnosis.deltaKmh)),
            })
          }}
        </p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.gear-recommendation-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sub-heading {
  margin: 8px 0 0;
  font-size: var(--text-base);
  color: var(--color-text-muted);
}
.sub-sub-heading {
  margin: 8px 0 0;
  font-size: var(--text-md);
  color: var(--color-text-muted);
}
.mode-label {
  font-size: var(--text-md);
  color: var(--color-text-muted);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.target-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
  align-self: flex-start;
}
.target-toggle button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  font-size: var(--text-base);
  cursor: pointer;
}
.target-toggle button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.field {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--text-md);
  color: var(--color-text-muted);
}
.field input {
  width: 130px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.hint {
  margin: 0;
  font-size: var(--text-base);
  color: var(--color-text-muted);
}
.inline-hint {
  align-self: flex-start;
}
.estimate-err {
  color: #e63946;
}
.results-table {
  border-collapse: collapse;
  font-size: var(--text-base);
  font-variant-numeric: tabular-nums;
}
.results-table th {
  text-align: left;
  color: var(--color-text-muted);
  font-weight: 600;
  padding: 4px 10px;
  border-bottom: 1px solid var(--color-border);
}
.results-table td {
  padding: 4px 10px;
}
.summary {
  margin: 4px 0 0;
  font-size: var(--text-lg);
  color: var(--color-text);
  font-weight: 600;
}
.shift-list {
  margin: 0;
  padding-left: 18px;
  font-size: var(--text-base);
  color: var(--color-text);
}
.shift-list li {
  margin-bottom: 4px;
}
.shift-reason {
  color: var(--color-text-muted);
  margin-left: 4px;
}
</style>
