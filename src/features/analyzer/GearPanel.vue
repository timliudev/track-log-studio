<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import { useDrivetrainStore, MAX_GEARS } from '@/stores/drivetrainStore'
import { resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'
import UPlotChart from '@/components/UPlotChart.vue'
import {
  computeMtGearTable,
  computeCvtSpeedRange,
  rpmSpeedTable,
  shiftRpmDrop,
  resolveRpmChannel,
  computeRatioSeries,
  detectGearPlateaus,
  buildCvtRatioSweep,
} from '@/domain/analysis/drivetrain'

const props = defineProps<{
  /** The active session, for the log-inversion (由記錄反推) section — null when
   *  no file is loaded (that section shows an i18n hint instead). */
  session: LogSession | null
}>()

const { t } = useI18n()
const store = useDrivetrainStore()

const isMt = computed(() => store.kind === 'mt')

// ── Layer 1: calculator ──────────────────────────────────────────────────
const mtResults = computed(() => (isMt.value ? computeMtGearTable(store.mt) : []))
const cvtRange = computed(() => (isMt.value ? null : computeCvtSpeedRange(store.cvt)))

const mtValid = computed(() => mtResults.value.length > 0)
const cvtValid = computed(() => cvtRange.value != null && Number.isFinite(cvtRange.value.speedAtHighKmh))

const topGear = computed(() =>
  mtResults.value.length > 0
    ? mtResults.value.reduce((a, b) => (b.speedAtRedlineKmh > a.speedAtRedlineKmh ? b : a))
    : null,
)

// Which gear's RPM<->speed table row is expanded (null = none shown).
const expandedGear = ref<number | null>(null)
const expandedTable = computed(() => {
  const g = mtResults.value.find((r) => r.gear === expandedGear.value)
  if (!g) return []
  return rpmSpeedTable(g.totalReduction, store.mt.wheelCircumferenceMm, store.mt.redlineRpm, 10)
})

function toggleExpanded(gear: number): void {
  expandedGear.value = expandedGear.value === gear ? null : gear
}

function dropFor(gear: number): number {
  return shiftRpmDrop(mtResults.value, gear, store.mt.redlineRpm)
}

function onGearCountInput(e: Event): void {
  const v = Number((e.target as HTMLSelectElement).value)
  if (Number.isFinite(v)) store.setGearCount(v)
}

function onGearRatioInput(gear: number, e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  store.setGearRatio(gear, Number.isFinite(v) ? v : 0)
}

function numField(e: Event): number {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? v : 0
}

// ── Layer 2: log inversion ───────────────────────────────────────────────
const rpmChannelName = computed(() => (props.session ? resolveRpmChannel(props.session) : null))
const speedChannelName = computed(() => (props.session ? resolveSpeedChannel(props.session) : null))
const channelsAvailable = computed(() => rpmChannelName.value != null && speedChannelName.value != null)

const ratioSeries = computed(() => {
  const s = props.session
  const rpmName = rpmChannelName.value
  const speedName = speedChannelName.value
  if (!s || !rpmName || !speedName) return null
  const rpmCh = s.get(rpmName)
  const speedCh = s.get(speedName)
  if (!rpmCh || !speedCh) return null
  return computeRatioSeries(rpmCh.data, speedCh.data, {
    wheelCircumferenceMm: store.inversionWheelCircumferenceMm,
  })
})

const speedData = computed(() => {
  const s = props.session
  const speedName = speedChannelName.value
  if (!s || !speedName) return null
  return s.get(speedName)?.data ?? null
})

const detectedPlateaus = computed(() => {
  const series = ratioSeries.value
  if (!series || !isMt.value) return []
  return detectGearPlateaus(series, { gearCount: store.mt.gearRatios.length || undefined })
})

const cvtSweep = computed(() => {
  const series = ratioSeries.value
  const speed = speedData.value
  if (!series || !speed || isMt.value) return []
  const points = buildCvtRatioSweep(series, speed)
  // Downsample for chart performance if the trace is large — a simple stride
  // is enough here (no need for the analysis-grade downsample.ts, which is
  // built for time-series line fidelity, not a scatter cloud).
  const stride = Math.max(1, Math.floor(points.length / 2000))
  return stride === 1 ? points : points.filter((_, i) => i % stride === 0)
})

// uPlot points-only series for the CVT sweep: paths() returning null (no
// spline) draws no connecting line, just the point markers.
const cvtChartData = computed<[number[], number[]]>(() => [
  cvtSweep.value.map((p) => p.speedKmh),
  cvtSweep.value.map((p) => p.ratio),
])
const cvtSeries = computed(() => [
  {},
  {
    label: t('analyzer.gear.cvtSweepAxisRatio'),
    stroke: 'transparent',
    points: { show: true, size: 4 },
    paths: (): null => null,
  },
])
const cvtAxes = [{}, { label: '' }]

function fmtSpeed(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} km/h` : '—'
}
function fmtRpm(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v)} RPM` : '—'
}
function fmtRatio(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : '—'
}
</script>

<template>
  <div class="gear-panel">
    <h3 class="heading">{{ t('analyzer.gear.heading') }}</h3>

    <div class="row kind-toggle" role="group" :aria-label="t('analyzer.gear.heading')">
      <button type="button" :class="{ active: isMt }" @click="store.setKind('mt')">
        {{ t('analyzer.gear.kindMt') }}
      </button>
      <button type="button" :class="{ active: !isMt }" @click="store.setKind('cvt')">
        {{ t('analyzer.gear.kindCvt') }}
      </button>
    </div>

    <h4 class="sub-heading">{{ t('analyzer.gear.specHeading') }}</h4>

    <!-- MT spec form -->
    <div v-if="isMt" class="spec-form">
      <label class="field">
        <span>{{ t('analyzer.gear.primaryReduction') }}</span>
        <input
          type="number"
          inputmode="decimal"
          step="0.001"
          :value="store.mt.primaryReduction"
          @input="store.setMt({ primaryReduction: numField($event) })"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.gear.gearCount') }}</span>
        <select :value="store.mt.gearRatios.length" @change="onGearCountInput">
          <option v-for="n in MAX_GEARS" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
      <label class="field">
        <span>{{ t('analyzer.gear.frontSprocket') }}</span>
        <input
          type="number"
          inputmode="numeric"
          step="1"
          min="1"
          :value="store.mt.frontSprocketTeeth"
          @input="store.setMt({ frontSprocketTeeth: numField($event) })"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.gear.rearSprocket') }}</span>
        <input
          type="number"
          inputmode="numeric"
          step="1"
          min="1"
          :value="store.mt.rearSprocketTeeth"
          @input="store.setMt({ rearSprocketTeeth: numField($event) })"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.gear.wheelCircumference') }}</span>
        <input
          type="number"
          inputmode="decimal"
          step="1"
          min="1"
          :value="store.mt.wheelCircumferenceMm"
          @input="store.setMt({ wheelCircumferenceMm: numField($event) })"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.gear.redlineRpm') }}</span>
        <input
          type="number"
          inputmode="numeric"
          step="100"
          min="1"
          :value="store.mt.redlineRpm"
          @input="store.setMt({ redlineRpm: numField($event) })"
        />
      </label>
      <label
        v-for="(g, i) in store.mt.gearRatios"
        :key="i"
        class="field"
      >
        <span>{{ t('analyzer.gear.gearRatioLabel', { n: i + 1 }) }}</span>
        <input
          type="number"
          inputmode="decimal"
          step="0.001"
          min="0"
          :value="g"
          @input="onGearRatioInput(i + 1, $event)"
        />
      </label>
    </div>

    <!-- CVT spec form -->
    <div v-else class="spec-form">
      <label class="field">
        <span>{{ t('analyzer.gear.ratioLow') }}</span>
        <input
          type="number"
          inputmode="decimal"
          step="0.01"
          min="0"
          :value="store.cvt.ratioLow"
          @input="store.setCvt({ ratioLow: numField($event) })"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.gear.ratioHigh') }}</span>
        <input
          type="number"
          inputmode="decimal"
          step="0.01"
          min="0"
          :value="store.cvt.ratioHigh"
          @input="store.setCvt({ ratioHigh: numField($event) })"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.gear.finalReduction') }}</span>
        <input
          type="number"
          inputmode="decimal"
          step="0.01"
          min="0"
          :value="store.cvt.finalReduction"
          @input="store.setCvt({ finalReduction: numField($event) })"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.gear.wheelCircumference') }}</span>
        <input
          type="number"
          inputmode="decimal"
          step="1"
          min="1"
          :value="store.cvt.wheelCircumferenceMm"
          @input="store.setCvt({ wheelCircumferenceMm: numField($event) })"
        />
      </label>
      <label class="field">
        <span>{{ t('analyzer.gear.maxRpm') }}</span>
        <input
          type="number"
          inputmode="numeric"
          step="100"
          min="1"
          :value="store.cvt.maxRpm"
          @input="store.setCvt({ maxRpm: numField($event) })"
        />
      </label>
    </div>

    <h4 class="sub-heading">{{ t('analyzer.gear.resultsHeading') }}</h4>

    <!-- MT results table -->
    <template v-if="isMt">
      <p v-if="!mtValid" class="hint">{{ t('analyzer.gear.invalidSpec') }}</p>
      <template v-else>
        <table class="results-table">
          <thead>
            <tr>
              <th>{{ t('analyzer.gear.colGear') }}</th>
              <th>{{ t('analyzer.gear.colTotalReduction') }}</th>
              <th>{{ t('analyzer.gear.colSpeedAtRedline') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in mtResults" :key="r.gear">
              <tr class="result-row" @click="toggleExpanded(r.gear)">
                <td>{{ r.gear }}</td>
                <td>{{ r.totalReduction.toFixed(3) }}</td>
                <td>{{ fmtSpeed(r.speedAtRedlineKmh) }}</td>
              </tr>
              <tr v-if="expandedGear === r.gear" class="table-detail-row">
                <td colspan="3">
                  <div class="rpm-table-heading">{{ t('analyzer.gear.rpmSpeedTable', { gear: r.gear }) }}</div>
                  <div class="rpm-table">
                    <span v-for="row in expandedTable" :key="row.rpm" class="rpm-row">
                      {{ fmtRpm(row.rpm) }} → {{ fmtSpeed(row.speedKmh) }}
                    </span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="topGear" class="summary">
          {{ t('analyzer.gear.topSpeed', { speed: fmtSpeed(topGear.speedAtRedlineKmh), gear: topGear.gear }) }}
        </p>
        <ul class="shift-drops">
          <li v-for="r in mtResults.slice(0, -1)" :key="r.gear">
            {{
              t('analyzer.gear.shiftDrop', {
                from: r.gear,
                to: r.gear + 1,
                rpm: Number.isFinite(dropFor(r.gear)) ? Math.round(dropFor(r.gear)) : '—',
              })
            }}
          </li>
        </ul>
      </template>
    </template>

    <!-- CVT results -->
    <template v-else>
      <p v-if="!cvtValid" class="hint">{{ t('analyzer.gear.invalidSpec') }}</p>
      <p v-else class="summary">
        {{
          t('analyzer.gear.cvtSpeedRange', {
            low: fmtSpeed(cvtRange!.speedAtLowKmh),
            high: fmtSpeed(cvtRange!.speedAtHighKmh),
          })
        }}
      </p>
    </template>

    <!-- Layer 2: log inversion -->
    <h4 class="sub-heading">{{ t('analyzer.gear.inversionHeading') }}</h4>
    <p class="intro">{{ t('analyzer.gear.inversionIntro') }}</p>

    <p v-if="!props.session" class="hint">{{ t('analyzer.gear.noSession') }}</p>
    <p v-else-if="!channelsAvailable" class="hint">{{ t('analyzer.gear.noChannels') }}</p>
    <template v-else>
      <label class="field">
        <span>{{ t('analyzer.gear.inversionWheelCircumference') }}</span>
        <input
          type="number"
          inputmode="decimal"
          step="1"
          min="1"
          :value="store.inversionWheelCircumferenceMm"
          @input="store.setInversionWheelCircumferenceMm(numField($event))"
        />
      </label>

      <template v-if="isMt">
        <h5 class="sub-sub-heading">{{ t('analyzer.gear.detectedHeading') }}</h5>
        <p v-if="detectedPlateaus.length === 0" class="hint">{{ t('analyzer.gear.noPlateaus') }}</p>
        <table v-else class="results-table detected-table">
          <thead>
            <tr>
              <th>{{ t('analyzer.gear.colGear') }}</th>
              <th>{{ t('analyzer.gear.detectedVsConfigured') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in detectedPlateaus" :key="i">
              <td>{{ i + 1 }}</td>
              <td>
                <span class="detected">{{ t('analyzer.gear.detectedRatio', { ratio: fmtRatio(p.ratio), n: p.sampleCount }) }}</span>
                <span v-if="mtResults[i]" class="configured">
                  {{ t('analyzer.gear.configuredRatio', { ratio: fmtRatio(mtResults[i].totalReduction) }) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-else>
        <h5 class="sub-sub-heading">{{ t('analyzer.gear.cvtSweepHeading') }}</h5>
        <p v-if="cvtSweep.length === 0" class="hint">{{ t('analyzer.gear.noPlateaus') }}</p>
        <UPlotChart
          v-else
          :data="cvtChartData"
          :series="cvtSeries"
          :axes="cvtAxes"
          :height="240"
        />
      </template>
    </template>
  </div>
</template>

<style scoped>
.gear-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: var(--space);
  padding-top: var(--space);
  border-top: 1px solid var(--color-border);
}
.heading {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text);
}
.sub-heading {
  margin: 8px 0 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.sub-sub-heading {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.intro {
  margin: 0;
  font-size: 0.8rem;
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
  font-size: 0.85rem;
  cursor: pointer;
}
.kind-toggle button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.spec-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.field {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.8rem;
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
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.results-table {
  border-collapse: collapse;
  font-size: 0.85rem;
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
.result-row {
  cursor: pointer;
}
.result-row:hover {
  background: var(--color-bg);
}
.table-detail-row td {
  background: var(--color-bg);
  padding: 8px 10px;
}
.rpm-table-heading {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}
.rpm-table {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 0.8rem;
}
.summary {
  margin: 4px 0 0;
  font-size: 0.9rem;
  color: var(--color-text);
  font-weight: 600;
}
.shift-drops {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.detected-table .detected {
  color: var(--color-text);
  font-weight: 600;
}
.detected-table .configured {
  margin-left: 8px;
  color: var(--color-text-muted);
}
</style>
