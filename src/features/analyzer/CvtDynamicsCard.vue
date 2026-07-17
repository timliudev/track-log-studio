<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import { cachedGearRatioTrace } from '@/domain/analysis/gearRatioTrace'
import { cachedCvtDerivedTraces } from '@/domain/analysis/cvtTrace'
import { sheaveAngleMismatch } from '@/domain/analysis/cvtDynamics'
import { solveCvtForceBalance, type CvtForceDisabledReason } from '@/domain/analysis/cvtForceBalance'
import { toCvtForceBalanceInput, toCvtTraceConfig, useDrivetrainStore } from '@/stores/drivetrainStore'
import CvtProfileEditor from './CvtProfileEditor.vue'

const props = defineProps<{
  session: LogSession | null
  fileId?: number | null
  cursorIdx?: number | null
}>()
const { t } = useI18n()
const drivetrain = useDrivetrainStore()
const settingsOpen = ref(false)
const frontPitchCircle = ref<SVGCircleElement | null>(null)
const rearPitchCircle = ref<SVGCircleElement | null>(null)
const beltPath = ref<SVGPathElement | null>(null)
const frontMovingSheave = ref<SVGGElement | null>(null)
const rearMovingSheave = ref<SVGGElement | null>(null)

interface DisplayFrame {
  totalRatio: number
  pureRatio: number
  frontRadiusMm: number
  rearRadiusMm: number
  frontDisplacementMm: number
  rearDisplacementMm: number
  status: 'unavailable' | 'ok' | 'out-of-bounds' | 'no-root'
}

const blankFrame = (): DisplayFrame => ({
  totalRatio: Number.NaN,
  pureRatio: Number.NaN,
  frontRadiusMm: Number.NaN,
  rearRadiusMm: Number.NaN,
  frontDisplacementMm: Number.NaN,
  rearDisplacementMm: Number.NaN,
  status: 'unavailable',
})
const displayed = ref<DisplayFrame>(blankFrame())
const profile = computed(() => drivetrain.activeCvtProfile)
const traceConfig = computed(() => toCvtTraceConfig(profile.value))
const totalTrace = computed(() =>
  props.session ? cachedGearRatioTrace(props.session, traceConfig.value.wheelCircumferenceMm) : null,
)
const cvtTrace = computed(() =>
  props.session
    ? cachedCvtDerivedTraces(props.session, props.fileId ?? 'unassigned', traceConfig.value)
    : null,
)

function halfAngle(value: { valueDeg: number | null; basis: 'half' | 'included' }): number {
  if (value.valueDeg == null) return Number.NaN
  return value.basis === 'included' ? value.valueDeg / 2 : value.valueDeg
}

const angleMismatch = computed(() => {
  const belt = halfAngle(profile.value.belt.wedgeAngle)
  const sheave = halfAngle(profile.value.geometry.frontSheaveAngle)
  if (!Number.isFinite(belt) || !Number.isFinite(sheave) || profile.value.belt.heightMm == null) return null
  return sheaveAngleMismatch(belt, sheave, profile.value.belt.heightMm)
})
const forceResult = computed(() => solveCvtForceBalance(toCvtForceBalanceInput(profile.value)))
const forceStatusText = computed(() => {
  if (forceResult.value.status === 'equilibrium') return t('analyzer.cvt.forceEquilibrium') as string
  if (forceResult.value.status === 'endpoint') return t('analyzer.cvt.forceEndpoint') as string
  if (forceResult.value.status === 'no-feasible-geometry') return t('analyzer.cvt.forceNoGeometry') as string
  return t('analyzer.cvt.forceDisabled') as string
})
const forceReasonKeys: Record<CvtForceDisabledReason, string> = {
  'electronic-actuation': 'forceReasonElectronic',
  'operating-condition': 'forceReasonCondition',
  'roller-masses': 'forceReasonMasses',
  'roller-track': 'forceReasonTrack',
  'roller-efficiency': 'forceReasonEfficiency',
  'rear-spring': 'forceReasonSpring',
  'torque-cam': 'forceReasonCam',
  'torque-share': 'forceReasonTorqueShare',
  coupling: 'forceReasonCoupling',
  geometry: 'forceReasonGeometry',
}
const forceDisabledText = computed(() => forceResult.value.disabledReasons
  .map((reason) => t(`analyzer.cvt.${forceReasonKeys[reason]}`) as string)
  .join('、'))
const forceChart = computed(() => {
  const curve = forceResult.value.curve
  if (curve.length < 2) return null
  const allForces = curve.flatMap((point) => [point.frontRollerForceN, point.couplingRatio * point.rearTotalForceN])
  const min = Math.min(...allForces)
  const max = Math.max(...allForces)
  const span = Math.max(1e-9, max - min)
  const points = (pick: (index: number) => number) => curve.map((_, index) => {
    const x = 8 + 284 * index / (curve.length - 1)
    const y = 92 - 78 * (pick(index) - min) / span
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return {
    front: points((index) => curve[index].frontRollerForceN),
    rear: points((index) => curve[index].couplingRatio * curve[index].rearTotalForceN),
  }
})

const geometryErrorText = computed(() => {
  const error = cvtTrace.value?.geometryError
  if (!props.session) return t('analyzer.cvt.noSession') as string
  if (error === 'rpm') return t('analyzer.gear.noRpmChannel') as string
  if (error === 'speed') return t('analyzer.gear.noSpeedChannel') as string
  if (error === 'circumference') return t('analyzer.gear.invalidCircumference') as string
  if (error === 'fixed-reduction') return t('analyzer.gear.cvtMissingFixedReduction') as string
  if (error === 'belt-length') return t('analyzer.gear.cvtMissingBeltLength') as string
  if (error === 'center-distance') return t('analyzer.gear.cvtMissingCenterDistance') as string
  if (error === 'sheave-angle') return t('analyzer.gear.cvtMissingSheaveAngle') as string
  if (error === 'radius-bounds') return t('analyzer.gear.cvtMissingRadiusBounds') as string
  return null
})

function finiteAt(values: ArrayLike<number> | null | undefined, index: number): number {
  if (!values || index < 0 || index >= values.length) return Number.NaN
  const value = values[index]
  return Number.isFinite(value) ? value : Number.NaN
}

function currentFrame(): DisplayFrame {
  const index = props.cursorIdx ?? 0
  const trace = cvtTrace.value
  const totalRatio = finiteAt(totalTrace.value?.data, index)
  if (!trace) return { ...blankFrame(), totalRatio }
  const pureRatio = finiteAt(trace.pureRatio, index)
  const frontRadiusMm = finiteAt(trace.frontRadiusMm, index)
  const rearRadiusMm = finiteAt(trace.rearRadiusMm, index)
  const statusCode = trace.geometryStatus?.[index]
  const status = statusCode === 0 ? 'ok' : statusCode === 1 ? 'out-of-bounds' : trace.frontRadiusMm ? 'no-root' : 'unavailable'
  return {
    totalRatio,
    pureRatio,
    frontRadiusMm,
    rearRadiusMm,
    frontDisplacementMm: finiteAt(trace.frontDisplacementMm, index),
    rearDisplacementMm: finiteAt(trace.rearDisplacementMm, index),
    status,
  }
}

function visualRadius(value: number, side: 'front' | 'rear'): number {
  const bounds = side === 'front'
    ? profile.value.geometry.frontRadiusBoundsMm
    : profile.value.geometry.rearRadiusBoundsMm
  if (!Number.isFinite(value) || !bounds || bounds.max <= bounds.min) return 36
  const progress = Math.max(0, Math.min(1, (value - bounds.min) / (bounds.max - bounds.min)))
  return 23 + progress * 32
}

function applySvgFrame(frame: DisplayFrame): void {
  const frontR = visualRadius(frame.frontRadiusMm, 'front')
  const rearR = visualRadius(frame.rearRadiusMm, 'rear')
  frontPitchCircle.value?.setAttribute('r', frontR.toFixed(2))
  rearPitchCircle.value?.setAttribute('r', rearR.toFixed(2))
  beltPath.value?.setAttribute(
    'd',
    `M 92 ${90 - frontR} L 268 ${90 - rearR} A ${rearR} ${rearR} 0 0 1 268 ${90 + rearR} L 92 ${90 + frontR} A ${frontR} ${frontR} 0 0 1 92 ${90 - frontR}`,
  )
  const frontShift = Number.isFinite(frame.frontDisplacementMm) ? Math.max(-8, Math.min(8, frame.frontDisplacementMm * 1.5)) : 0
  const rearShift = Number.isFinite(frame.rearDisplacementMm) ? Math.max(-8, Math.min(8, frame.rearDisplacementMm * 1.5)) : 0
  frontMovingSheave.value?.setAttribute('transform', `translate(${frontShift.toFixed(2)} 0)`)
  rearMovingSheave.value?.setAttribute('transform', `translate(${rearShift.toFixed(2)} 0)`)
}

let rafId: number | null = null
function scheduleFrame(): void {
  if (rafId != null) return
  const request = globalThis.requestAnimationFrame ?? ((callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(performance.now()), 16))
  rafId = request(async () => {
    rafId = null
    const frame = currentFrame()
    displayed.value = frame
    await nextTick()
    applySvgFrame(frame)
  })
}

watch([() => props.cursorIdx, cvtTrace, totalTrace], scheduleFrame, { immediate: true })
onBeforeUnmount(() => {
  if (rafId != null && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(rafId)
})

function format(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

const statusLabel = computed(() => {
  if (displayed.value.status === 'ok') return t('analyzer.cvt.statusGeometry') as string
  if (displayed.value.status === 'out-of-bounds') return t('analyzer.cvt.statusNonGeometric') as string
  if (displayed.value.status === 'no-root') return t('analyzer.cvt.statusNoRoot') as string
  return t('analyzer.cvt.statusDisabled') as string
})
</script>

<template>
  <div class="cvt-card">
    <div class="card-toolbar">
      <div class="profile-title">
        <strong>{{ profile.name }}</strong>
        <span>{{ profile.actuationKind === 'electronic' ? t('analyzer.cvt.electronicShort') : t('analyzer.cvt.mechanicalShort') }}</span>
      </div>
      <button type="button" class="settings-button" @click="settingsOpen = true">{{ t('analyzer.cvt.openSettings') }}</button>
    </div>

    <div class="status-row">
      <span class="status-chip" :class="`status-${displayed.status}`">{{ statusLabel }}</span>
      <span v-if="profile.actuationKind === 'electronic'" class="status-chip electronic">{{ t('analyzer.cvt.electronicObservationOnly') }}</span>
      <span class="status-chip" :class="forceResult.status === 'disabled' ? 'status-unavailable' : 'status-ok'">{{ forceStatusText }}</span>
    </div>

    <svg class="cvt-svg" viewBox="0 0 360 180" role="img" :aria-label="t('analyzer.cvt.animationLabel')">
      <g class="fixed-sheaves">
        <path d="M 72 30 L 88 90 L 72 150" />
        <path d="M 288 30 L 272 90 L 288 150" />
      </g>
      <g ref="frontMovingSheave" class="moving-sheave"><path d="M 112 30 L 96 90 L 112 150" /></g>
      <g ref="rearMovingSheave" class="moving-sheave"><path d="M 248 30 L 264 90 L 248 150" /></g>
      <circle cx="92" cy="90" r="58" class="pulley-rim" />
      <circle cx="268" cy="90" r="58" class="pulley-rim" />
      <circle ref="frontPitchCircle" cx="92" cy="90" r="36" class="pitch-circle" />
      <circle ref="rearPitchCircle" cx="268" cy="90" r="36" class="pitch-circle" />
      <path ref="beltPath" class="belt" d="M 92 54 L 268 54 A 36 36 0 0 1 268 126 L 92 126 A 36 36 0 0 1 92 54" />
      <circle cx="92" cy="90" r="4" class="hub" />
      <circle cx="268" cy="90" r="4" class="hub" />
      <text x="92" y="174" text-anchor="middle">{{ t('analyzer.cvt.frontPulley') }}</text>
      <text x="268" y="174" text-anchor="middle">{{ t('analyzer.cvt.rearPulley') }}</text>
    </svg>

    <dl class="live-values">
      <div><dt>{{ t('analyzer.cvt.measuredTotalRatio') }}</dt><dd>{{ format(displayed.totalRatio, 3) }}</dd></div>
      <div><dt>{{ t('analyzer.cvt.pureRatio') }}</dt><dd>{{ format(displayed.pureRatio, 3) }}</dd></div>
      <div><dt>{{ t('analyzer.cvt.frontRadius') }}</dt><dd>{{ format(displayed.frontRadiusMm, 1) }}<small> mm</small></dd></div>
      <div><dt>{{ t('analyzer.cvt.rearRadius') }}</dt><dd>{{ format(displayed.rearRadiusMm, 1) }}<small> mm</small></dd></div>
    </dl>

    <details class="force-readout">
      <summary>{{ t('analyzer.cvt.forceReadout') }}</summary>
      <p v-if="forceResult.status === 'disabled'" class="layer-message">{{ forceDisabledText }}</p>
      <p v-else-if="forceResult.status === 'no-feasible-geometry'" class="warning-message">{{ t('analyzer.cvt.forceNoGeometryDetail') }}</p>
      <template v-else>
        <svg v-if="forceChart" class="force-chart" viewBox="0 0 300 100" role="img" :aria-label="t('analyzer.cvt.forceChartLabel')">
          <line x1="8" y1="92" x2="292" y2="92" />
          <polyline :points="forceChart.front" class="front-force" />
          <polyline :points="forceChart.rear" class="rear-force" />
        </svg>
        <div class="force-legend"><span class="front-key">{{ t('analyzer.cvt.frontRollerForce') }}</span><span class="rear-key">{{ t('analyzer.cvt.coupledRearForce') }}</span></div>
        <dl class="force-values">
          <div><dt>q</dt><dd>{{ format(forceResult.selected?.ratio ?? Number.NaN, 3) }}</dd></div>
          <div><dt>{{ t('analyzer.cvt.frontForce') }}</dt><dd>{{ format(forceResult.selected?.frontRollerForceN ?? Number.NaN, 0) }} N</dd></div>
          <div><dt>{{ t('analyzer.cvt.springForce') }}</dt><dd>{{ format(forceResult.selected?.rearSpringForceN ?? Number.NaN, 0) }} N</dd></div>
          <div><dt>{{ t('analyzer.cvt.camForce') }}</dt><dd>{{ format(forceResult.selected?.rearCamForceN ?? Number.NaN, 0) }} N</dd></div>
        </dl>
        <p v-if="forceResult.roots.length > 1" class="warning-message">{{ t('analyzer.cvt.multipleRoots', { count: forceResult.roots.length }) }}</p>
      </template>
      <p class="field-note">{{ profile.force.frictionCoefficientMin == null || profile.force.frictionCoefficientMax == null ? t('analyzer.cvt.slipNotAssessed') : t('analyzer.cvt.slipWarningOnly') }}</p>
    </details>

    <p v-if="geometryErrorText" class="layer-message">{{ geometryErrorText }}</p>
    <p v-else-if="displayed.status === 'out-of-bounds' || displayed.status === 'no-root'" class="warning-message">{{ t('analyzer.cvt.nonGeometricWarning') }}</p>
    <p v-if="angleMismatch && Math.abs(angleMismatch.displacementScaleDifferenceRatio) > 0.001" class="warning-message">{{ t('analyzer.cvt.angleMismatchWarning', { percent: Math.abs(angleMismatch.displacementScaleDifferenceRatio * 100).toFixed(2) }) }}</p>
    <p class="confidence-note">{{ t('analyzer.cvt.uncertaintyAlwaysVisible') }}</p>

    <CvtProfileEditor :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.cvt-card { min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.card-toolbar, .status-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.profile-title { min-width: 0; display: grid; }
.profile-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.profile-title span, .confidence-note { color: var(--color-text-muted); font-size: 0.72rem; }
.settings-button { min-height: 36px; padding: 6px 10px; color: var(--color-text); background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius); cursor: pointer; }
.status-row { justify-content: flex-start; flex-wrap: wrap; }
.status-chip { padding: 3px 7px; border: 1px solid var(--color-border); border-radius: 999px; font-size: 0.68rem; }
.status-ok { color: var(--color-success, #2ea043); }
.status-out-of-bounds, .status-no-root { color: var(--color-warning, #c99100); }
.status-unavailable { color: var(--color-text-muted); }
.electronic { color: var(--color-accent); }
.cvt-svg { width: 100%; min-height: 128px; flex: 1 1 150px; overflow: visible; }
.cvt-svg text { fill: var(--color-text-muted); font-size: 10px; }
.fixed-sheaves path, .moving-sheave path { fill: none; stroke: var(--color-text-muted); stroke-width: 4; stroke-linecap: round; }
.pulley-rim { fill: color-mix(in srgb, var(--color-surface-raised) 70%, transparent); stroke: var(--color-border); stroke-width: 2; }
.pitch-circle { fill: none; stroke: var(--color-accent); stroke-width: 1.5; stroke-dasharray: 4 3; }
.belt { fill: none; stroke: #d19a47; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
.hub { fill: var(--color-text); }
.live-values { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin: 0; }
.live-values div { min-width: 0; padding: 6px; background: var(--color-surface-raised); border-radius: var(--radius); }
.live-values dt { overflow: hidden; color: var(--color-text-muted); font-size: 0.64rem; text-overflow: ellipsis; white-space: nowrap; }
.live-values dd { margin: 2px 0 0; font-variant-numeric: tabular-nums; font-weight: 600; }
.live-values small { font-weight: 400; color: var(--color-text-muted); }
.force-readout { padding: 7px 9px; background: var(--color-surface-raised); border-radius: var(--radius); font-size: 0.75rem; }
.force-readout summary { cursor: pointer; font-weight: 600; }
.force-readout[open] summary { margin-bottom: 8px; }
.force-chart { width: 100%; height: 86px; }
.force-chart line { stroke: var(--color-border); }
.force-chart polyline { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; }
.front-force { stroke: var(--color-accent); }
.rear-force { stroke: #d19a47; }
.force-legend { display: flex; gap: 14px; margin: 2px 0 7px; color: var(--color-text-muted); }
.force-legend span::before { content: ''; display: inline-block; width: 12px; height: 2px; margin-right: 5px; vertical-align: middle; background: var(--color-accent); }
.force-legend .rear-key::before { background: #d19a47; }
.force-values { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin: 0; }
.force-values div { min-width: 0; }
.force-values dt { color: var(--color-text-muted); font-size: 0.65rem; }
.force-values dd { margin: 2px 0 0; font-variant-numeric: tabular-nums; }
.field-note { margin: 7px 0 0; color: var(--color-text-muted); line-height: 1.35; }
.layer-message, .warning-message, .confidence-note { margin: 0; line-height: 1.35; }
.layer-message { padding: 7px 9px; color: var(--color-text-muted); background: var(--color-surface-raised); border-radius: var(--radius); font-size: 0.75rem; }
.warning-message { color: var(--color-warning, #c99100); font-size: 0.72rem; }
:root[data-any-pointer-coarse='true'] .settings-button { min-height: 44px; }
@media (max-width: 520px) {
  .live-values { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
