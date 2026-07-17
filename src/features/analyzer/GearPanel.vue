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
 *   `drivetrain.ts`). Ratio-vs-speed chart, launch/top ratio + clutch-
 *   engagement RPM summary, plus free-form tuning notes
 *   (前普利尺寸/珠重/彈簧硬度/開閉盤規格/套管長度/終傳比 etc.) persisted with the
 *   drivetrain settings for setup comparison.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type uPlot from 'uplot'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import { useFileStore } from '@/stores/fileStore'
import { useAppNavigationStore } from '@/stores/appNavigationStore'
import {
  useDrivetrainStore,
  toMtDrivetrainSpec,
  MAX_GEARS,
  type MtGearFormInput,
  type FinalDriveFormInput,
} from '@/stores/drivetrainStore'
import { resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'
import UPlotChart from '@/components/UPlotChart.vue'
import GearRatioChart from './GearRatioChart.vue'
import {
  computeMtGearTable,
  mtGearSpeedLine,
  tireSpecToCircumferenceMm,
  resolveGearRatio,
  resolveFinalDrive,
  resolveRpmChannel,
  computeRatioSeries,
  detectGearPlateaus,
  buildCvtRatioSweep,
  cvtRatioSummary,
  estimateClutchEngagementRpm,
  estimateCircumferenceFromLog,
  inferDrivetrainKind,
  type CircumferenceFromLogEstimate,
} from '@/domain/analysis/drivetrain'

const props = defineProps<{
  /** The active session, for the log-inversion (由記錄反推) section — null when
   *  no file is loaded (that section shows an i18n hint instead). */
  session: LogSession | null
  /** Main analyzer X values/range/cursor are forwarded to the embedded ratio
   * trace so this STATIC calculator card participates in chart sync. */
  xValues?: Float64Array | null
  xRange?: { min: number; max: number } | null
  externalCursor?: number | null
  selectedLaps?: Lap[]
  comparisonSessions?: ComparisonSession[]
  primaryFileId?: number | null
  primaryFileName?: string
}>()

const emit = defineEmits<{
  cursor: [number | null]
  xZoom: [{ min: number; max: number } | null]
}>()

const { t } = useI18n()
const store = useDrivetrainStore()
const fileStore = useFileStore()
const navigation = useAppNavigationStore()

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

/** What the (last-entered) tire spec converts to — shown as a reference hint
 *  next to the manual mm field so the user can see how far a fine-tuned value
 *  drifted from the spec estimate. Null when the spec string doesn't parse
 *  (no hint). */
const specReferenceMm = computed<number | null>(() => {
  const circ = tireSpecToCircumferenceMm(store.mt.tireSpec)
  return Number.isFinite(circ) && circ > 0 ? circ : null
})

// ── Tire-spec LIVE conversion (user decision 2026-07-08) ─────────────────
// A valid spec edit auto-applies into the circumference via
// store.setTireSpec (which also encodes the "only an EFFECTIVE change
// overwrites a manual tweak" rule); the flash below is the visual feedback
// that an overwrite just happened.
const tireSpecInvalid = computed(
  () => store.mt.tireSpec.trim() !== '' && specReferenceMm.value == null,
)
const tireSpecJustApplied = ref(false)
let tireSpecFlashTimer: ReturnType<typeof setTimeout> | null = null

function onTireSpecInput(e: Event): void {
  const applied = store.setTireSpec((e.target as HTMLInputElement).value)
  if (applied) {
    tireSpecJustApplied.value = true
    if (tireSpecFlashTimer != null) clearTimeout(tireSpecFlashTimer)
    tireSpecFlashTimer = setTimeout(() => {
      tireSpecJustApplied.value = false
    }, 2500)
  } else if (tireSpecJustApplied.value && specReferenceMm.value == null) {
    // The spec stopped parsing mid-edit — drop the "auto-applied" banner
    // immediately so it can't misdescribe the now-invalid spec text.
    tireSpecJustApplied.value = false
  }
}

function onCircumferenceInput(e: Event): void {
  // Manual fine-tune: never touches the spec field, and dismisses the
  // auto-applied flash (the number on screen is now the user's, not the
  // conversion's).
  tireSpecJustApplied.value = false
  store.setMt({ wheelCircumferenceMm: numField(e) })
}

onBeforeUnmount(() => {
  if (tireSpecFlashTimer != null) clearTimeout(tireSpecFlashTimer)
  if (cvtTireSpecFlashTimer != null) clearTimeout(cvtTireSpecFlashTimer)
})

// ── CVT: tire-spec LIVE conversion (#7/#12) ───────────────────────────────
// The wheel/tire is the SAME physical part regardless of drivetrain kind —
// CVT previously only exposed a bare "反推用後輪周長" mm number with no way to
// convert from a tire spec string, unlike MT's spec+direct-mm pair. Mirrors
// MT's block above exactly, just against `store.cvt`/`setCvtTireSpec`.
const cvtSpecReferenceMm = computed<number | null>(() => {
  const circ = tireSpecToCircumferenceMm(store.cvt.tireSpec)
  return Number.isFinite(circ) && circ > 0 ? circ : null
})
const cvtTireSpecInvalid = computed(
  () => store.cvt.tireSpec.trim() !== '' && cvtSpecReferenceMm.value == null,
)
const cvtTireSpecJustApplied = ref(false)
let cvtTireSpecFlashTimer: ReturnType<typeof setTimeout> | null = null

function onCvtTireSpecInput(e: Event): void {
  const applied = store.setCvtTireSpec((e.target as HTMLInputElement).value)
  if (applied) {
    cvtTireSpecJustApplied.value = true
    if (cvtTireSpecFlashTimer != null) clearTimeout(cvtTireSpecFlashTimer)
    cvtTireSpecFlashTimer = setTimeout(() => {
      cvtTireSpecJustApplied.value = false
    }, 2500)
  } else if (cvtTireSpecJustApplied.value && cvtSpecReferenceMm.value == null) {
    cvtTireSpecJustApplied.value = false
  }
}

function onCvtCircumferenceInput(e: Event): void {
  cvtTireSpecJustApplied.value = false
  store.setCvtWheelCircumferenceMm(numField(e))
}

// ── MT: circumference back-estimation from the log (speed / RPM inversion) ──
// Per-gear total reductions resolved WITHOUT the circumference (ratio-only:
// primary x gear x final drive) — `estimateCircumferenceFromLog` solves FOR
// the circumference, so this must not depend on it (unlike `mtResults`).
const totalReductionsForEstimate = computed<number[]>(() => {
  const spec = mtSpec.value
  const final = resolveFinalDrive(spec.finalDrive)
  if (!Number.isFinite(final) || !(final > 0)) return []
  const primary = spec.primaryReduction != null && spec.primaryReduction > 0 ? spec.primaryReduction : 1
  return spec.gearRatios
    .map(resolveGearRatio)
    .filter((g) => Number.isFinite(g) && g > 0)
    .map((g) => primary * g * final)
})

/** Why the estimate button is disabled (i18n key), or null when it can run. */
const estimateDisabledReason = computed<string | null>(() => {
  if (!props.session) return 'analyzer.gear.noSession'
  if (!hasRpmChannel.value) return 'analyzer.gear.noRpmChannel'
  if (!hasSpeedChannel.value) return 'analyzer.gear.noSpeedChannel'
  if (totalReductionsForEstimate.value.length === 0) return 'analyzer.gear.estimateNeedGears'
  return null
})

const estimateResult = ref<CircumferenceFromLogEstimate | null>(null)
const estimateFailed = ref(false)

// GearPanel is a single long-lived instance (AnalyzerView mounts it once,
// no :key on file switch — see AnalyzerView.vue), so without this the
// estimate result/error from a PREVIOUS log session stayed on screen after
// switching to a different file, misrepresenting a value computed from data
// that's no longer loaded.
watch(
  () => props.session,
  (session) => {
    estimateResult.value = null
    estimateFailed.value = false
    store.applyDetectedKind(session ? inferDrivetrainKind(session)?.kind ?? null : null)
  },
  { immediate: true },
)

watch(
  [() => props.session, () => props.primaryFileId],
  ([session, fileId]) => {
    if (!session || fileId == null) return
    store.replaceCvtNotes(fileStore.getExportMetadata(fileId).cvtNotes)
  },
  { immediate: true },
)

function syncCvtNotesToSession(): void {
  if (props.primaryFileId == null || !props.session) return
  fileStore.setExportMetadata(props.primaryFileId, { cvtNotes: store.cvt.notes })
}

function setSessionCvtNote(index: number, patch: { label?: string; value?: string }): void {
  store.setCvtNote(index, patch)
  syncCvtNotesToSession()
}

function addSessionCvtNote(): void {
  store.addCvtNote()
  syncCvtNotesToSession()
}

function removeSessionCvtNote(index: number): void {
  store.removeCvtNote(index)
  syncCvtNotesToSession()
}

function openSaveModified(): void {
  navigation.requestConverterSaveModified()
}

function runCircumferenceEstimate(): void {
  const rpm = rpmData.value
  const speed = speedData.value
  if (!rpm || !speed || estimateDisabledReason.value) return
  // Current circumference (spec-resolved or direct) as the ambiguity
  // reference — see `estimateCircumferenceFromLog`'s single-gear-log note.
  const current = mtSpec.value.wheelCircumferenceMm
  const est = estimateCircumferenceFromLog(rpm, speed, totalReductionsForEstimate.value, {
    referenceCircumferenceMm: Number.isFinite(current) && current > 0 ? current : undefined,
  })
  if (Number.isFinite(est.circumferenceMm)) {
    estimateResult.value = est
    estimateFailed.value = false
    // One-click apply into the tweakable direct field (same flow as the
    // tire-spec apply button).
    store.setMt({ wheelCircumferenceMm: Math.round(est.circumferenceMm), circumferenceMode: 'direct' })
  } else {
    estimateResult.value = null
    estimateFailed.value = true
  }
}

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

// #7/#12 — 8 entries to match the raised MAX_GEARS ceiling (was 6 colours for
// a hardcoded 6-gear max); modulo-indexed below so any count still works.
const GEAR_LINE_COLORS = [
  '#e63946',
  '#f4a261',
  '#e9c46a',
  '#2a9d8f',
  '#457b9d',
  '#8338ec',
  '#ff6fb0',
  '#6a994e',
]

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
    // #8 — mtChartData merges this line's sparse 41-point RPM sweep onto ONE
    // shared x-axis together with the measured scatter's much denser (often
    // thousands of) sample RPMs (uPlot's AlignedData requires a single shared
    // x-array — see mtChartData's doc), so at almost every x-position between
    // two of this series' real points the y-value is null (contributed by the
    // scatter having a sample there, this line not). uPlot's line renderer
    // DOES connect real point to real point through those nulls, but by
    // default (spanGaps: false) it then CLIPS the connecting segment wherever
    // it detects a null run — which, given how sparse this line's real points
    // are relative to the shared axis, clips away nearly the entire line,
    // leaving nothing visible while the cursor/legend still reports a value
    // (interpolated/nearest-point lookup, unaffected by the clip) — exactly
    // the "hover shows a number, no line drawn" bug report. spanGaps: true
    // skips that clip so the theoretical line renders as a continuous line
    // through the interleaved nulls, same as before the shared-axis merge.
    spanGaps: true,
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
    // This used to be a transparent, points-only series. uPlot inherits a
    // point's colour from the series stroke when no explicit point colour is
    // supplied, so both the path AND its points became transparent: hover
    // could still read the values, but the plot looked empty. Keep the
    // speed-sorted sweep as a real visible curve and give its points an
    // explicit colour so neither rendering path can silently disappear.
    stroke: '#e23b3b',
    width: 2,
    points: { show: true, size: 4, stroke: '#e23b3b', fill: '#e23b3b' },
  },
]
const cvtSweepAxes: uPlot.Axis[] = [
  { label: 'km/h' },
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

    <!-- The measured ratio trace belongs to this calculator card, but uses
         the exact same TimeSeriesChart/UPlot pipeline as the dashboard:
         global time/distance axis, zoom, cursor and selected-lap overlay. -->
    <h4 class="sub-heading">{{ t('analyzer.gear.ratioTimelineHeading') }}</h4>
    <p v-if="!props.session" class="hint">{{ t('analyzer.gear.noSession') }}</p>
    <p v-else-if="!props.xValues" class="hint">{{ t('analyzer.gear.noRatioAxis') }}</p>
    <GearRatioChart
      v-else
      :session="props.session"
      :x-values="props.xValues"
      :x-range="props.xRange"
      :external-cursor="props.externalCursor"
      :selected-laps="props.selectedLaps"
      :comparison-sessions="props.comparisonSessions"
      :primary-file-id="props.primaryFileId"
      :primary-file-name="props.primaryFileName"
      @cursor="emit('cursor', $event)"
      @x-zoom="emit('xZoom', $event)"
    />

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

      <!-- Wheel circumference: the tire spec LIVE-converts and auto-applies
           into the mm field as you type (user decision 2026-07-08 — replaces
           the old tire/direct mode toggle + 套用 button). The mm field stays
           manually tweakable; only an EFFECTIVE spec change (different
           resolved geometry) overwrites a manual tweak — see
           drivetrainStore.setTireSpec. -->
      <div class="sub-block">
        <span class="mode-label">{{ t('analyzer.gear.wheelCircumference') }}</span>
        <div class="row params">
          <label class="field">
            <span>{{ t('analyzer.gear.tireSpecLabel') }}</span>
            <input
              type="text"
              class="tire-spec-input"
              placeholder="120/70-17"
              :value="store.mt.tireSpec"
              @input="onTireSpecInput"
            />
          </label>
          <label class="field">
            <span>{{ t('analyzer.gear.wheelCircumferenceDirectLabel') }}</span>
            <input
              type="number"
              inputmode="decimal"
              step="1"
              min="1"
              class="circumference-input"
              :class="{ 'auto-applied': tireSpecJustApplied }"
              :value="store.mt.wheelCircumferenceMm"
              @input="onCircumferenceInput"
            />
          </label>
        </div>
        <p v-if="tireSpecJustApplied" class="hint inline-hint estimate-ok tire-spec-applied" role="status">
          {{
            t('analyzer.gear.tireSpecAutoApplied', {
              spec: store.mt.tireSpec.trim(),
              mm: store.mt.wheelCircumferenceMm.toFixed(0),
            })
          }}
        </p>
        <p v-else-if="tireSpecInvalid" class="hint inline-hint">{{ t('analyzer.gear.tireSpecInvalid') }}</p>
        <p v-else-if="specReferenceMm != null" class="hint inline-hint">
          {{ t('analyzer.gear.tireSpecReference', { spec: store.mt.tireSpec.trim(), mm: specReferenceMm.toFixed(0) }) }}
        </p>
        <!-- Third circumference source: back-estimate from the log's speed/RPM -->
        <div class="row params">
          <button
            type="button"
            class="apply-btn"
            :disabled="estimateDisabledReason != null"
            v-tooltip="estimateDisabledReason ? (t(estimateDisabledReason) as string) : undefined"
            @click="runCircumferenceEstimate"
          >
            {{ t('analyzer.gear.estimateFromLog') }}
          </button>
          <p v-if="estimateDisabledReason" class="hint inline-hint">{{ t(estimateDisabledReason) }}</p>
          <p v-else-if="estimateResult" class="hint inline-hint estimate-ok">
            {{
              t('analyzer.gear.estimateApplied', {
                mm: estimateResult.circumferenceMm.toFixed(0),
                n: estimateResult.sampleCount,
              })
            }}
          </p>
          <p v-else-if="estimateFailed" class="hint inline-hint estimate-err">
            {{ t('analyzer.gear.estimateFailed') }}
          </p>
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

      <!-- #7/#12 — same tire-spec-converter + direct-mm pair as MT's wheel
           circumference block (the wheel is the same physical tire either
           way), available regardless of whether a log is loaded — same as
           MT's spec form (only the MEASURED overlay below needs a session).
           倒算(from log speed/RPM) stays MT-only — see the disabled button +
           hint further down, CVT has no discrete gear plateaus to solve for. -->
      <h4 class="sub-heading">{{ t('analyzer.gear.wheelCircumference') }}</h4>
      <div class="sub-block">
        <div class="row params">
          <label class="field">
            <span>{{ t('analyzer.gear.tireSpecLabel') }}</span>
            <input
              type="text"
              class="tire-spec-input"
              placeholder="120/70-17"
              :value="store.cvt.tireSpec"
              @input="onCvtTireSpecInput"
            />
          </label>
          <label class="field">
            <span>{{ t('analyzer.gear.inversionWheelCircumference') }}</span>
            <input
              type="number"
              inputmode="decimal"
              step="1"
              min="1"
              class="circumference-input"
              :class="{ 'auto-applied': cvtTireSpecJustApplied }"
              :value="store.cvt.wheelCircumferenceMm"
              @input="onCvtCircumferenceInput"
            />
          </label>
        </div>
        <p v-if="cvtTireSpecJustApplied" class="hint inline-hint estimate-ok tire-spec-applied" role="status">
          {{
            t('analyzer.gear.tireSpecAutoApplied', {
              spec: store.cvt.tireSpec.trim(),
              mm: store.cvt.wheelCircumferenceMm.toFixed(0),
            })
          }}
        </p>
        <p v-else-if="cvtTireSpecInvalid" class="hint inline-hint">{{ t('analyzer.gear.tireSpecInvalid') }}</p>
        <p v-else-if="cvtSpecReferenceMm != null" class="hint inline-hint">
          {{ t('analyzer.gear.tireSpecReference', { spec: store.cvt.tireSpec.trim(), mm: cvtSpecReferenceMm.toFixed(0) }) }}
        </p>
        <!-- #4 — CVT has no discrete gear plateaus to solve for (see
             `estimateCircumferenceFromLog`'s MT-only design), so unlike the MT
             tab there is no working "由記錄反推周長" button here — a real user
             on a CVT bike would otherwise see NOTHING at all where MT users
             see a button + explanation, and reasonably conclude the feature
             "isn't implemented". This permanently-disabled button + hint makes
             that limitation visible and actionable (measure directly, or via
             the tire-spec converter right above) instead of silent absence. -->
        <div class="row params">
          <button type="button" class="apply-btn" disabled v-tooltip="t('analyzer.gear.estimateNotAvailableCvtHint') as string">
            {{ t('analyzer.gear.estimateFromLog') }}
          </button>
          <p class="hint inline-hint">{{ t('analyzer.gear.estimateNotAvailableCvtHint') }}</p>
        </div>
      </div>

      <h4 class="sub-heading">{{ t('analyzer.gear.chartHeading') }}</h4>
      <p v-if="!props.session" class="hint">{{ t('analyzer.gear.noSession') }}</p>
      <p v-else-if="!channelsAvailable" class="hint">
        {{ t(!hasRpmChannel ? 'analyzer.gear.noRpmChannel' : 'analyzer.gear.noSpeedChannel') }}
      </p>
      <template v-else>
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
            @input="setSessionCvtNote(i, { label: ($event.target as HTMLInputElement).value })"
          />
          <input
            class="note-value"
            type="text"
            :placeholder="t('analyzer.gear.noteValuePlaceholder') as string"
            :value="n.value"
            @input="setSessionCvtNote(i, { value: ($event.target as HTMLInputElement).value })"
          />
          <button type="button" class="note-remove" :aria-label="t('analyzer.gear.removeNote')" @click="removeSessionCvtNote(i)">
            ×
          </button>
        </div>
      </div>
      <button type="button" class="note-add" @click="addSessionCvtNote()">{{ t('analyzer.gear.addNote') }}</button>
      <p class="notes-export-hint">{{ t('analyzer.gear.notesExportHint') }}</p>
      <button type="button" class="notes-export-link" @click="openSaveModified">
        {{ t('analyzer.gear.notesExportAction') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.gear-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
.apply-btn {
  align-self: center;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 4px 10px;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
.apply-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.apply-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.estimate-ok {
  color: var(--color-accent);
}
/* Tire-spec live conversion — visual feedback when a valid spec change just
   overwrote the circumference field: highlight the mm input briefly (the
   companion hint text explains what happened). Transition both ways so the
   highlight fades out instead of snapping. */
.circumference-input {
  transition:
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}
.circumference-input.auto-applied {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 30%, transparent);
}
.estimate-err {
  color: #e63946;
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
.notes-export-hint {
  margin: 2px 0 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}
.notes-export-link {
  align-self: flex-start;
  background: var(--color-surface);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius);
  min-height: 32px;
  padding: 5px 10px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
@media (any-pointer: coarse) {
  .notes-export-link {
    min-height: 44px;
  }
}
</style>
