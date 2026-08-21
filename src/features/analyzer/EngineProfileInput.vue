<script setup lang="ts">
/**
 * F8 — Stage 1: engine torque/power profile input, MT mode only.
 *
 * Two input kinds, matching `gearRecommendation.ts`'s `EngineProfile` union
 * (see that module's header for the full honesty rationale):
 * - **兩點版 (two-point)** — peak-torque rpm + peak-power rpm, plus optional
 *   magnitude fields (peak Nm / peak power in a chosen unit). Always
 *   constructible the moment both rpm fields are filled in; this is the
 *   "just the numbers off a spec sheet" path.
 * - **曲線版 (curve)** — paste a `(rpm, value)` table (comma/tab/whitespace
 *   separated, one row per line, header row tolerated). Needs >= 3 valid,
 *   strictly-increasing points AND a valid redline (from the MT calculator's
 *   own `redlineRpm` field, entered once, not duplicated here) before it
 *   becomes a usable curve — see `engineProfileForm.ts`'s
 *   `diagnoseCurveProfile` for the exact validation reasons surfaced below.
 *
 * State lives in `drivetrainStore`'s `mt.engineProfile` (persisted,
 * sanitized — see that store's `sanitizeEngineProfileFormState`); this
 * component only reads/writes it through `setEngineProfileActiveKind`/
 * `setEngineTwoPoint`/`setEngineCurve` and NEVER builds an `EngineProfile`
 * itself — all validity/point-count feedback goes through
 * `engineProfileForm.ts`'s `buildTwoPointProfile`/`buildCurveProfile`, the
 * SAME functions `GearRecommendationPanel.vue` uses for the actual math, so
 * the two can never disagree about whether the current profile is usable.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import {
  buildTwoPointProfile,
  buildCurveProfile,
  type EnginePowerUnit,
  type EngineCurveValueUnit,
} from '@/domain/analysis/engineProfileForm'

const { t } = useI18n()
const store = useDrivetrainStore()

const activeKind = computed(() => store.mt.engineProfile.activeKind)
/** The MT calculator's own redline field, or null when it isn't set yet —
 *  shared as the single redline for BOTH profile kinds (see this
 *  component's header comment on why it isn't duplicated per-kind). */
const redlineRpm = computed<number | null>(() => (store.mt.redlineRpm > 0 ? store.mt.redlineRpm : null))

const twoPoint = computed(() => store.mt.engineProfile.twoPoint)
const twoPointProfile = computed(() => buildTwoPointProfile(twoPoint.value, redlineRpm.value))
/** True once the rider has started filling in the two-point form but it
 *  doesn't (yet) resolve to a valid profile — e.g. only one rpm field
 *  filled in, or peak-power rpm not above peak-torque rpm. Stays quiet on a
 *  still-completely-blank form (nothing to complain about yet). */
const twoPointIncomplete = computed(() => {
  const hasSomething = twoPoint.value.peakTorqueRpm != null || twoPoint.value.peakPowerRpm != null
  return hasSomething && twoPointProfile.value == null
})

const curve = computed(() => store.mt.engineProfile.curve)
const curveBuild = computed(() => buildCurveProfile(curve.value, redlineRpm.value))
const curveErrorKey = computed<string | null>(() => {
  switch (curveBuild.value.reason) {
    case 'noRedline':
      return 'analyzer.engineProfile.curveErrorNoRedline'
    case 'tooFewPoints':
      return 'analyzer.engineProfile.curveErrorTooFewPoints'
    case 'notIncreasing':
      return 'analyzer.engineProfile.curveErrorNotIncreasing'
    default:
      return null
  }
})

/** Parse a number input's value into `number | null` — blank means "not
 *  entered" (kept as null, not coerced to 0 — see `EngineTwoPointFormState`'s
 *  doc on why every field there is nullable). A non-numeric value falls back
 *  to null too rather than propagating NaN into the store. */
function numOrNull(e: Event): number | null {
  const raw = (e.target as HTMLInputElement).value
  if (raw.trim() === '') return null
  const v = Number(raw)
  return Number.isFinite(v) ? v : null
}

function onPeakPowerUnitChange(e: Event): void {
  store.setEngineTwoPoint({ peakPowerUnit: (e.target as HTMLSelectElement).value as EnginePowerUnit })
}

function onCurveValueUnitChange(e: Event): void {
  store.setEngineCurve({ valueUnit: (e.target as HTMLSelectElement).value as EngineCurveValueUnit })
}
</script>

<template>
  <div class="engine-profile-input">
    <h4 class="sub-heading">{{ t('analyzer.engineProfile.heading') }}</h4>

    <div class="row kind-toggle" role="group" :aria-label="t('analyzer.engineProfile.heading')">
      <button
        type="button"
        :class="{ active: activeKind === 'twoPoint' }"
        @click="store.setEngineProfileActiveKind('twoPoint')"
      >
        {{ t('analyzer.engineProfile.kindTwoPoint') }}
      </button>
      <button
        type="button"
        :class="{ active: activeKind === 'curve' }"
        @click="store.setEngineProfileActiveKind('curve')"
      >
        {{ t('analyzer.engineProfile.kindCurve') }}
      </button>
    </div>

    <template v-if="activeKind === 'twoPoint'">
      <div class="row params">
        <label class="field">
          <span>{{ t('analyzer.engineProfile.peakTorqueRpm') }}</span>
          <input
            type="number"
            inputmode="numeric"
            step="100"
            min="1"
            :value="twoPoint.peakTorqueRpm ?? ''"
            @input="store.setEngineTwoPoint({ peakTorqueRpm: numOrNull($event) })"
          />
        </label>
        <label class="field">
          <span>{{ t('analyzer.engineProfile.peakPowerRpm') }}</span>
          <input
            type="number"
            inputmode="numeric"
            step="100"
            min="1"
            :value="twoPoint.peakPowerRpm ?? ''"
            @input="store.setEngineTwoPoint({ peakPowerRpm: numOrNull($event) })"
          />
        </label>
      </div>
      <div class="row params">
        <label class="field">
          <span>{{ t('analyzer.engineProfile.peakTorqueNm') }}</span>
          <input
            type="number"
            inputmode="decimal"
            step="0.1"
            min="0"
            :value="twoPoint.peakTorqueNm ?? ''"
            @input="store.setEngineTwoPoint({ peakTorqueNm: numOrNull($event) })"
          />
        </label>
        <label class="field">
          <span>{{ t('analyzer.engineProfile.peakPowerValue') }}</span>
          <input
            type="number"
            inputmode="decimal"
            step="0.1"
            min="0"
            :value="twoPoint.peakPowerValue ?? ''"
            @input="store.setEngineTwoPoint({ peakPowerValue: numOrNull($event) })"
          />
        </label>
        <label class="field">
          <span>{{ t('analyzer.engineProfile.peakPowerUnitLabel') }}</span>
          <select :value="twoPoint.peakPowerUnit" @change="onPeakPowerUnitChange">
            <option value="kW">{{ t('analyzer.engineProfile.unitKw') }}</option>
            <option value="PS">{{ t('analyzer.engineProfile.unitPs') }}</option>
            <option value="hp">{{ t('analyzer.engineProfile.unitHp') }}</option>
          </select>
        </label>
      </div>
      <p v-if="twoPointIncomplete" class="hint inline-hint estimate-err">
        {{ t('analyzer.engineProfile.twoPointIncomplete') }}
      </p>
      <p class="hint inline-hint">{{ t('analyzer.engineProfile.twoPointCurveOnlyHint') }}</p>
    </template>

    <template v-else>
      <label class="field curve-field">
        <span>{{ t('analyzer.engineProfile.curveTextareaLabel') }}</span>
        <textarea
          class="curve-textarea"
          rows="6"
          :placeholder="t('analyzer.engineProfile.curveTextareaPlaceholder') as string"
          :value="curve.rawText"
          @input="store.setEngineCurve({ rawText: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.engineProfile.curveValueUnitLabel') }}</span>
        <select :value="curve.valueUnit" @change="onCurveValueUnitChange">
          <option value="Nm">{{ t('analyzer.engineProfile.unitNm') }}</option>
          <option value="kW">{{ t('analyzer.engineProfile.unitKw') }}</option>
          <option value="PS">{{ t('analyzer.engineProfile.unitPs') }}</option>
          <option value="hp">{{ t('analyzer.engineProfile.unitHp') }}</option>
        </select>
      </label>
      <p class="hint inline-hint curve-point-count">
        {{ t('analyzer.engineProfile.curvePointCount', { n: curveBuild.parse.points.length }) }}
        <template v-if="curveBuild.parse.skippedLines > 0">
          {{ t('analyzer.engineProfile.curveSkippedLines', { n: curveBuild.parse.skippedLines }) }}
        </template>
      </p>
      <p v-if="curveErrorKey" class="hint inline-hint estimate-err">{{ t(curveErrorKey) }}</p>
    </template>
  </div>
</template>

<style scoped>
.engine-profile-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sub-heading {
  margin: 8px 0 0;
  font-size: var(--text-base);
  color: var(--color-text-muted);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.kind-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
  align-self: flex-start;
}
.kind-toggle button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  font-size: var(--text-base);
  cursor: pointer;
}
.kind-toggle button.active {
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
.field input,
.field select {
  width: 130px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.curve-field {
  width: 100%;
}
.curve-textarea {
  width: 100%;
  max-width: 480px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 8px;
  font: inherit;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm);
  resize: vertical;
}
.hint {
  margin: 0;
  font-size: var(--text-base);
  color: var(--color-text-muted);
}
.inline-hint {
  align-self: flex-start;
}
.curve-point-count {
  font-variant-numeric: tabular-nums;
}
.estimate-err {
  color: #e63946;
}
</style>
