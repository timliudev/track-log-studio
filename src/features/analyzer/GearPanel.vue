<script setup lang="ts">
/**
 * A11 — 變速齒比計算器 panel. Redesigned per user decisions #12/#13 (see
 * `drivetrain.ts`'s header comment for the full rationale) after the ORIGINAL
 * panel was confusing and its chart rendered empty.
 *
 * Root cause of the empty chart (original panel, now replaced): the "由記錄
 * 反推" (log-inversion) section only ever rendered a chart for CVT
 * (`cvtChartData`/`UPlotChart` inside `v-else` of `isMt`) — the MT branch just
 * showed a plain table of detected-vs-configured ratios with NO chart at all.
 * Worse, a user opening the panel on an MT bike (the default `kind`) without
 * first confirming both an RPM channel AND a resolvable speed channel
 * (`GPS_Speed`/`Vehicle_Speed`) exist would see `noChannels` correctly, but
 * once channels DID resolve there was still no MT chart to look at — "the
 * chart" they expected (this was the panel's headline feature per the
 * feature request) simply didn't exist for the MT path. This rewrite adds
 * the missing overlay: measured RPM-vs-speed scatter (Layer 2) + theoretical
 * per-gear speed(rpm) lines (Layer 1), so the two sides of the tool are
 * visibly checking each other.
 *
 * Two modes, mirroring `drivetrain.ts`'s two-layer design:
 * - MT: geometry calculator. Inputs (ratio-or-teeth per gear, optional
 *   primary reduction, final drive, tire spec or direct circumference)
 *   produce per-gear theoretical speed-vs-RPM lines, drawn over the
 *   measured RPM/speed scatter recovered from the log. Detected plateaus
 *   (Layer 2 clustering) are listed against the configured ratios.
 * - CVT: measured-curve presentation only (no geometry sim — see
 *   `drivetrain.ts`). Ratio-vs-time and ratio-vs-speed charts, launch/top
 *   ratio + clutch-engagement RPM summary, plus free-form tuning notes
 *   (前普利尺寸/珠重/彈簧硬度/開閉盤規格/套管長度/終傳比 etc.) persisted with the
 *   drivetrain settings for setup comparison.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type uPlot from 'uplot'
import type { LogSession } from '@/domain/model/LogSession'
import {
  useDrivetrainStore,
  toMtDrivetrainSpec,
  MAX_GEARS,
  type MtGearFormInput,
  type FinalDriveFormInput,
} from '@/stores/drivetrainStore'
import { resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'
import UPlotChart from '@/components/UPlotChart.vue'
import {
  computeMtGearTable,
  mtGearSpeedLine,
  resolveRpmChannel,
  computeRatioSeries,
  detectGearPlateaus,
  buildCvtRatioSweep,
  buildCvtRatioTimeSeries,
  cvtRatioSummary,
  estimateClutchEngagementRpm,
} from '@/domain/analysis/drivetrain'

const props = defineProps<{
  /** The active session, for the log-inversion (由記錄反推) section — null when
   *  no file is loaded (that section shows an i18n hint instead). */
  session: LogSession | null
}>()

const { t } = useI18n()
const store = useDrivetrainStore()

const isMt = computed(() => store.kind === 'mt')

// ── Preconditions ────────────────────────────────────────────────────────
// Both channels are required for the measured overlay/curve — surfaced as an
// explicit hint (rather than a silently-empty chart) per the user's #11
// complaint.
const rpmChannelName = computed(() => (props.session ? resolveRpmChannel(props.session) : null))
const speedChannelName = computed(() => (props.session ? resolveSpeedChannel(props.session) : null))
const hasRpmChannel = computed(() => rpmChannelName.value != null)
const hasSpeedChannel = computed(() => speedChannelName.value != null)
const channelsAvailable = computed(() => hasRpmChannel.value && hasSpeedChannel.value)

// ── MT: Layer 1 calculator ───────────────────────────────────────────────
const mtSpec = computed(() => toMtDrivetrainSpec(store.mt))
const mtResults = computed(() => (isMt.value ? computeMtGearTable(mtSpec.value) : []))
const mtValid = computed(() => mtResults.value.length > 0)
const specCircumferenceValid = computed(() => Number.isFinite(mtSpec.value.wheelCircumferenceMm) && mtSpec.value.wheelCircumferenceMm > 0)

const topGear = computed(() =>
  mtResults.value.length > 0
    ? mtResults.value.reduce((a, b) => (b.speedAtRedlineKmh > a.speedAtRedlineKmh ? b : a))
    : null,
)

// ── MT + CVT: Layer 2 log inversion (shared ratio series) ────────────────
const ratioSeries = computed(() => {
  const s = props.session
  const rpmName = rpmChannelName.value
  const speedName = speedChannelName.value
  if (!s || !rpmName || !speedName) return null
  const rpmCh = s.get(rpmName)
  const speedCh = s.get(speedName)
  if (!rpmCh || !speedCh) return null
  const circ = isMt.value ? store.inversionWheelCircumferenceMm : store.cvt.wheelCircumferenceMm
  return computeRatioSeries(rpmCh.data, speedCh.data, { wheelCircumferenceMm: circ })
})

const rpmData = computed(() => {
  const s = props.session
  const rpmName = rpmChannelName.value
  if (!s || !rpmName) return null
  return s.get(rpmName)?.data ?? null
})

const speedData = computed(() => {
  const s = props.session
  const speedName = speedChannelName.value
  if (!s || !speedName) return null
  return s.get(speedName)?.data ?? null
})

const timeSData = computed(() => {
  const s = props.session
  const time = s?.timeChannel?.data
  if (!time) return null
  // session time is stored in ms (see LogSession/Channel doc) — the CVT
  // ratio-vs-time chart's x-axis is seconds, matching other analyzer charts.
  const out = new Float64Array(time.length)
  for (let i = 0; i < time.length; i++) out[i] = time[i] / 1000
  return out
})

// ── MT: measured scatter + theoretical line overlay ──────────────────────
const MAX_SCATTER_POINTS = 4000

function strideFilter<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  const stride = Math.max(1, Math.floor(arr.length / max))
  return arr.filter((_, i) => i % stride === 0)
}

/** Measured (rpm, speed) scatter — index-aligned rpm/speed pair kept only
 *  where both are finite and speed is above the same floor `computeRatioSeries`
 *  uses (near-zero speed makes for a meaningless point at the origin corner). */
const measuredScatter = computed<{ rpm: number[]; speed: number[] }>(() => {
  const rpm = rpmData.value
  const speed = speedData.value
  if (!rpm || !speed || !channelsAvailable.value) return { rpm: [], speed: [] }
  const n = Math.min(rpm.length, speed.length)
  const pts: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const r = rpm[i]
    const s = speed[i]
    if (Number.isFinite(r) && r > 0 && Number.isFinite(s) && s >= 1) pts.push([r, s])
  }
  const kept = strideFilter(pts, MAX_SCATTER_POINTS)
  return { rpm: kept.map((p) => p[0]), speed: kept.map((p) => p[1]) }
})

const maxObservedRpm = computed(() => {
  const rpm = measuredScatter.value.rpm
  if (rpm.length === 0) return store.mt.redlineRpm
  return Math.max(store.mt.redlineRpm, ...rpm)
})

/** Per-gear theoretical speed(rpm) line, sampled 0..max(redline, observed max
 *  RPM) — reaching past redline so the line still covers over-rev samples in
 *  the measured scatter instead of stopping short of them. */
const mtGearLines = computed(() => {
  if (!isMt.value || !mtValid.value) return []
  const maxRpm = maxObservedRpm.value
  return mtResults.value.map((r) => ({
    gear: r.gear,
    line: mtGearSpeedLine(r.totalReduction, mtSpec.value.wheelCircumferenceMm, maxRpm, 40),
  }))
})

const mtChartHasData = computed(() => measuredScatter.value.rpm.length > 0 || mtGearLines.value.length > 0)

// uPlot AlignedData requires ONE shared x-array — the measured scatter and
// each gear's theoretical line don't share x-values naturally (scatter is
// per-sample RPM, each line is its own evenly-spaced RPM sweep), so build a
// single merged/sorted x-axis (all distinct RPM values across every series)
// and re-index each series onto it (nulls where a series has no point at
// that x) — uPlot draws through nulls as gaps, which is correct for a
// sparse-per-series line/scatter overlay chart.
const mtChartData = computed<uPlot.AlignedData>(() => {
  const xsSet = new Set<number>()
  for (const r of measuredScatter.value.rpm) xsSet.add(r)
  for (const g of mtGearLines.value) for (const r of g.line.rpm) xsSet.add(r)
  const xs = Array.from(xsSet).sort((a, b) => a - b)
  const xIndex = new Map<number, number>()
  xs.forEach((x, i) => xIndex.set(x, i))

  const scatterY = new Array<number | null>(xs.length).fill(null)
  measuredScatter.value.rpm.forEach((r, i) => {
    const idx = xIndex.get(r)
    if (idx != null) scatterY[idx] = measuredScatter.value.speed[i]
  })

  const lineSeries = mtGearLines.value.map((g) => {
    const y = new Array<number | null>(xs.length).fill(null)
    g.line.rpm.forEach((r, i) => {
      const idx = xIndex.get(r)
      if (idx != null) y[idx] = g.line.speedKmh[i]
    })
    return y
  })

  return [xs, scatterY, ...lineSeries] as unknown as uPlot.AlignedData
})

const GEAR_LINE_COLORS = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#8338ec']

const mtChartSeries = computed<uPlot.Series[]>(() => [
  {},
  {
    label: t('analyzer.gear.measuredScatterLabel'),
    stroke: 'transparent',
    points: { show: true, size: 3 },
    paths: (): null => null,
  },
  ...mtGearLines.value.map((g, i) => ({
    label: t('analyzer.gear.gearRatioLabel', { n: g.gear }),
    stroke: GEAR_LINE_COLORS[i % GEAR_LINE_COLORS.length],
    width: 2,
    points: { show: false },
  })),
])

const mtChartAxes: uPlot.Axis[] = [
  { label: 'RPM' },
  { label: 'km/h' },
]

// ── MT: detected plateaus vs configured ───────────────────────────────────
const detectedPlateaus = computed(() => {
  const series = ratioSeries.value
  if (!series || !isMt.value) return []
  return detectGearPlateaus(series, { gearCount: store.mt.gearRatios.length || undefined })
})

// ── CVT: measured curve + summary ─────────────────────────────────────────
const cvtSweep = computed(() => {
  const series = ratioSeries.value
  const speed = speedData.value
  if (!series || !speed || isMt.value) return []
  const points = buildCvtRatioSweep(series, speed)
  return strideFilter(points, 2000)
})

const cvtTimeSeries = computed(() => {
  const series = ratioSeries.value
  const time = timeSData.value
  if (!series || !time || isMt.value) return []
  const points = buildCvtRatioTimeSeries(series, time)
  return strideFilter(points, 2000)
})

const cvtSummary = computed(() => (ratioSeries.value ? cvtRatioSummary(ratioSeries.value) : null))
const cvtClutchRpm = computed(() => {
  const rpm = rpmData.value
  const speed = speedData.value
  if (!rpm || !speed || isMt.value) return NaN
  return estimateClutchEngagementRpm(rpm, speed)
})

const cvtSweepChartData = computed<uPlot.AlignedData>(() => [
  cvtSweep.value.map((p) => p.speedKmh),
  cvtSweep.value.map((p) => p.ratio),
])
const cvtSweepSeries: uPlot.Series[] = [
  {},
  {
    label: '',
    stroke: 'transparent',
    points: { show: true, size: 4 },
    paths: (): null => null,
  },
]
const cvtSweepAxes: uPlot.Axis[] = [
  { label: 'km/h' },
  { label: t('analyzer.gear.cvtSweepAxisRatio') as string },
]

const cvtTimeChartData = computed<uPlot.AlignedData>(() => [
  cvtTimeSeries.value.map((p) => p.timeS),
  cvtTimeSeries.value.map((p) => p.ratio),
])
const cvtTimeSeriesOpts: uPlot.Series[] = [
  {},
  {
    label: t('analyzer.gear.cvtSweepAxisRatio') as string,
    stroke: '#2a9d8f',
    width: 2,
    points: { show: false },
  },
]
const cvtTimeAxes: uPlot.Axis[] = [
  { label: 's' },
  { label: t('analyzer.gear.cvtSweepAxisRatio') as string },
]

// ── Formatting ─────────────────────────────────────────────────────────────
function fmtSpeed(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} km/h` : '—'
}
function fmtRpm(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v)} RPM` : '—'
}
function fmtRatio(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : '—'
}

// ── MT form helpers ───────────────────────────────────────────────────────
function numField(e: Event): number {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? v : 0
}

function onGearCountInput(e: Event): void {
  const v = Number((e.target as HTMLSelectElement).value)
  if (Number.isFinite(v)) store.setGearCount(v)
}

function setGearMode(gear: number, mode: MtGearFormInput['mode']): void {
  store.setGearRatio(gear, { mode })
}

function setFinalDriveMode(mode: FinalDriveFormInput['mode']): void {
  store.setFinalDrive({ mode })
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

    <!-- ════════════════════════ MT ════════════════════════ -->
    <template v-if="isMt">
      <h4 class="sub-heading">{{ t('analyzer.gear.specHeading') }}</h4>
      <div class="spec-form">
        <label class="field">
          <span>{{ t('analyzer.gear.primaryReduction') }}</span>
          <input
            type="number"
            inputmode="decimal"
            step="0.001"
            min="0"
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
      </div>

      <!-- Final drive: ratio-or-teeth toggle -->
      <div class="sub-block">
        <div class="row mode-toggle" role="group" :aria-label="t('analyzer.gear.finalDrive')">
          <span class="mode-label">{{ t('analyzer.gear.finalDrive') }}</span>
          <button
            type="button"
            :class="{ active: store.mt.finalDrive.mode === 'teeth' }"
            @click="setFinalDriveMode('teeth')"
          >
            {{ t('analyzer.gear.modeTeeth') }}
          </button>
          <button
            type="button"
            :class="{ active: store.mt.finalDrive.mode === 'ratio' }"
            @click="setFinalDriveMode('ratio')"
          >
            {{ t('analyzer.gear.modeRatio') }}
          </button>
        </div>
        <div v-if="store.mt.finalDrive.mode === 'teeth'" class="row params">
          <label class="field">
            <span>{{ t('analyzer.gear.frontSprocket') }}</span>
            <input
              type="number"
              inputmode="numeric"
              step="1"
              min="1"
              :value="store.mt.finalDrive.frontTeeth"
              @input="store.setFinalDrive({ frontTeeth: numField($event) })"
            />
          </label>
          <label class="field">
            <span>{{ t('analyzer.gear.rearSprocket') }}</span>
            <input
              type="number"
              inputmode="numeric"
              step="1"
              min="1"
              :value="store.mt.finalDrive.rearTeeth"
              @input="store.setFinalDrive({ rearTeeth: numField($event) })"
            />
          </label>
        </div>
        <div v-else class="row params">
          <label class="field">
            <span>{{ t('analyzer.gear.finalDriveRatioLabel') }}</span>
            <input
              type="number"
              inputmode="decimal"
              step="0.01"
              min="0"
              :value="store.mt.finalDrive.ratio"
              @input="store.setFinalDrive({ ratio: numField($event) })"
            />
          </label>
        </div>
      </div>

      <!-- Wheel circumference: tire-spec-or-direct toggle -->
      <div class="sub-block">
        <div class="row mode-toggle" role="group" :aria-label="t('analyzer.gear.wheelCircumference')">
          <span class="mode-label">{{ t('analyzer.gear.wheelCircumference') }}</span>
          <button
            type="button"
            :class="{ active: store.mt.circumferenceMode === 'tire' }"
            @click="store.setMt({ circumferenceMode: 'tire' })"
          >
            {{ t('analyzer.gear.modeTireSpec') }}
          </button>
          <button
            type="button"
            :class="{ active: store.mt.circumferenceMode === 'direct' }"
            @click="store.setMt({ circumferenceMode: 'direct' })"
          >
            {{ t('analyzer.gear.modeDirect') }}
          </button>
        </div>
        <div v-if="store.mt.circumferenceMode === 'tire'" class="row params">
          <label class="field">
            <span>{{ t('analyzer.gear.tireSpecLabel') }}</span>
            <input
              type="text"
              placeholder="120/70-17"
              :value="store.mt.tireSpec"
              @input="store.setMt({ tireSpec: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <p v-if="!specCircumferenceValid" class="hint inline-hint">{{ t('analyzer.gear.tireSpecInvalid') }}</p>
          <p v-else class="hint inline-hint">
            {{ t('analyzer.gear.tireSpecResolved', { mm: mtSpec.wheelCircumferenceMm.toFixed(0) }) }}
          </p>
        </div>
        <div v-else class="row params">
          <label class="field">
            <span>{{ t('analyzer.gear.wheelCircumferenceDirectLabel') }}</span>
            <input
              type="number"
              inputmode="decimal"
              step="1"
              min="1"
              :value="store.mt.wheelCircumferenceMm"
              @input="store.setMt({ wheelCircumferenceMm: numField($event) })"
            />
          </label>
        </div>
      </div>

      <!-- Per-gear ratio-or-teeth inputs -->
      <div class="sub-block">
        <span class="mode-label">{{ t('analyzer.gear.perGearHeading') }}</span>
        <div v-for="(g, i) in store.mt.gearRatios" :key="i" class="gear-row">
          <span class="gear-row-label">{{ t('analyzer.gear.gearRatioLabel', { n: i + 1 }) }}</span>
          <div class="row mode-toggle small">
            <button
              type="button"
              :class="{ active: g.mode === 'ratio' }"
              @click="setGearMode(i + 1, 'ratio')"
            >
              {{ t('analyzer.gear.modeRatio') }}
            </button>
            <button
              type="button"
              :class="{ active: g.mode === 'teeth' }"
              @click="setGearMode(i + 1, 'teeth')"
            >
              {{ t('analyzer.gear.modeTeeth') }}
            </button>
          </div>
          <template v-if="g.mode === 'ratio'">
            <input
              type="number"
              inputmode="decimal"
              step="0.001"
              min="0"
              :value="g.ratio"
              @input="store.setGearRatio(i + 1, { ratio: numField($event) })"
            />
          </template>
          <template v-else>
            <input
              class="teeth-input"
              type="number"
              inputmode="numeric"
              step="1"
              min="1"
              :placeholder="t('analyzer.gear.drivenTeeth') as string"
              :value="g.drivenTeeth"
              @input="store.setGearRatio(i + 1, { drivenTeeth: numField($event) })"
            />
            <span class="teeth-sep">/</span>
            <input
              class="teeth-input"
              type="number"
              inputmode="numeric"
              step="1"
              min="1"
              :placeholder="t('analyzer.gear.driveTeeth') as string"
              :value="g.driveTeeth"
              @input="store.setGearRatio(i + 1, { driveTeeth: numField($event) })"
            />
          </template>
        </div>
      </div>

      <h4 class="sub-heading">{{ t('analyzer.gear.resultsHeading') }}</h4>
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
            <tr v-for="r in mtResults" :key="r.gear">
              <td>{{ r.gear }}</td>
              <td>{{ r.totalReduction.toFixed(3) }}</td>
              <td>{{ fmtSpeed(r.speedAtRedlineKmh) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="topGear" class="summary">
          {{ t('analyzer.gear.topSpeed', { speed: fmtSpeed(topGear.speedAtRedlineKmh), gear: topGear.gear }) }}
        </p>
      </template>

      <!-- Chart: measured RPM/speed scatter + theoretical per-gear lines -->
      <h4 class="sub-heading">{{ t('analyzer.gear.chartHeading') }}</h4>
      <p v-if="!props.session" class="hint">{{ t('analyzer.gear.noSession') }}</p>
      <p v-else-if="!channelsAvailable" class="hint">
        {{ t(!hasRpmChannel ? 'analyzer.gear.noRpmChannel' : 'analyzer.gear.noSpeedChannel') }}
      </p>
      <p v-else-if="!mtValid" class="hint">{{ t('analyzer.gear.invalidSpec') }}</p>
      <p v-else-if="!mtChartHasData" class="hint">{{ t('analyzer.gear.noPlateaus') }}</p>
      <UPlotChart
        v-else
        :data="mtChartData"
        :series="mtChartSeries"
        :axes="mtChartAxes"
        :height="280"
      />

      <!-- Detected plateaus vs configured -->
      <template v-if="channelsAvailable">
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
        <label class="field inversion-circ">
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
      </template>
    </template>

    <!-- ════════════════════════ CVT ════════════════════════ -->
    <template v-else>
      <p class="intro">{{ t('analyzer.gear.cvtIntro') }}</p>

      <h4 class="sub-heading">{{ t('analyzer.gear.chartHeading') }}</h4>
      <p v-if="!props.session" class="hint">{{ t('analyzer.gear.noSession') }}</p>
      <p v-else-if="!channelsAvailable" class="hint">
        {{ t(!hasRpmChannel ? 'analyzer.gear.noRpmChannel' : 'analyzer.gear.noSpeedChannel') }}
      </p>
      <template v-else>
        <label class="field">
          <span>{{ t('analyzer.gear.inversionWheelCircumference') }}</span>
          <input
            type="number"
            inputmode="decimal"
            step="1"
            min="1"
            :value="store.cvt.wheelCircumferenceMm"
            @input="store.setCvtWheelCircumferenceMm(numField($event))"
          />
        </label>

        <div class="summary-row">
          <span v-if="cvtSummary" class="summary-item">
            {{ t('analyzer.gear.launchRatio', { ratio: fmtRatio(cvtSummary.launchRatio) }) }}
          </span>
          <span v-if="cvtSummary" class="summary-item">
            {{ t('analyzer.gear.topRatio', { ratio: fmtRatio(cvtSummary.topRatio) }) }}
          </span>
          <span class="summary-item">
            {{ t('analyzer.gear.clutchEngagementRpm', { rpm: fmtRpm(cvtClutchRpm) }) }}
          </span>
        </div>

        <h5 class="sub-sub-heading">{{ t('analyzer.gear.cvtTimeHeading') }}</h5>
        <p v-if="cvtTimeSeries.length === 0" class="hint">{{ t('analyzer.gear.noPlateaus') }}</p>
        <UPlotChart
          v-else
          :data="cvtTimeChartData"
          :series="cvtTimeSeriesOpts"
          :axes="cvtTimeAxes"
          :height="200"
        />

        <h5 class="sub-sub-heading">{{ t('analyzer.gear.cvtSweepHeading') }}</h5>
        <p v-if="cvtSweep.length === 0" class="hint">{{ t('analyzer.gear.noPlateaus') }}</p>
        <UPlotChart
          v-else
          :data="cvtSweepChartData"
          :series="cvtSweepSeries"
          :axes="cvtSweepAxes"
          :height="240"
        />
      </template>

      <!-- Free-form tuning notes -->
      <h4 class="sub-heading">{{ t('analyzer.gear.notesHeading') }}</h4>
      <div class="notes-list">
        <div v-for="(n, i) in store.cvt.notes" :key="i" class="note-row">
          <input
            class="note-label"
            type="text"
            :placeholder="t('analyzer.gear.noteLabelPlaceholder') as string"
            :value="n.label"
            @input="store.setCvtNote(i, { label: ($event.target as HTMLInputElement).value })"
          />
          <input
            class="note-value"
            type="text"
            :placeholder="t('analyzer.gear.noteValuePlaceholder') as string"
            :value="n.value"
            @input="store.setCvtNote(i, { value: ($event.target as HTMLInputElement).value })"
          />
          <button type="button" class="note-remove" :aria-label="t('analyzer.gear.removeNote')" @click="store.removeCvtNote(i)">
            ×
          </button>
        </div>
      </div>
      <button type="button" class="note-add" @click="store.addCvtNote()">{{ t('analyzer.gear.addNote') }}</button>
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
.mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mode-toggle button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 3px 8px;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
.mode-toggle button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
}
.mode-toggle.small button {
  padding: 2px 6px;
  font-size: 0.7rem;
}
.mode-label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.sub-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
.inline-hint {
  align-self: center;
}
.inversion-circ {
  margin-top: 4px;
}
.gear-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
}
.gear-row-label {
  width: 110px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.gear-row input {
  width: 90px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 4px 6px;
  font: inherit;
}
.teeth-input {
  width: 60px !important;
}
.teeth-sep {
  color: var(--color-text-muted);
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
.summary {
  margin: 4px 0 0;
  font-size: 0.9rem;
  color: var(--color-text);
  font-weight: 600;
}
.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.summary-item {
  font-size: 0.85rem;
  color: var(--color-text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.detected-table .detected {
  color: var(--color-text);
  font-weight: 600;
}
.detected-table .configured {
  margin-left: 8px;
  color: var(--color-text-muted);
}
.notes-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.note-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.note-label {
  width: 180px;
  flex-shrink: 0;
}
.note-value {
  flex: 1;
  min-width: 100px;
}
.note-label,
.note-value {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
  font-size: 0.8rem;
}
.note-remove {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  width: 26px;
  height: 26px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}
.note-remove:hover {
  color: var(--color-text);
  border-color: var(--color-accent);
}
.note-add {
  align-self: flex-start;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.note-add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
