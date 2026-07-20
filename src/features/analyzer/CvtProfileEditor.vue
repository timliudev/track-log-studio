<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDrivetrainStore, type CvtAngleInput, type CvtProfilePatch } from '@/stores/drivetrainStore'
import { inferFixedReductionFromSegment } from '@/domain/analysis/cvtCalibration'
import CvtReductionEditor from './CvtReductionEditor.vue'

const props = defineProps<{
  open: boolean
  totalReduction?: ArrayLike<number> | null
  calibrationSelection?: { startIdx: number; endIdx: number; startX: number; endX: number } | null
}>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const drivetrain = useDrivetrainStore()
const profile = computed(() => drivetrain.activeCvtProfile)
const calibrationMessage = ref('')

function optionalNumber(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function optionalNonNegativeNumber(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function textValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

function patch(value: CvtProfilePatch): void {
  drivetrain.updateCvtProfile(profile.value.id, value)
}

function patchAngle(key: 'frontSheaveAngle' | 'rearSheaveAngle', value: Partial<CvtAngleInput>): void {
  patch({ geometry: { [key]: value } })
}

function patchBounds(side: 'frontRadiusBoundsMm' | 'rearRadiusBoundsMm', edge: 'min' | 'max', event: Event): void {
  const current = profile.value.geometry[side] ?? { min: 0, max: 0 }
  patch({ geometry: { [side]: { ...current, [edge]: optionalNumber(event) ?? 0 } } })
}

function formatMasses(values: readonly number[]): string {
  return values.join(', ')
}

function parseMasses(event: Event): number[] {
  return (event.target as HTMLInputElement).value
    .split(/[，,\s]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
}

function formatPoints(points: readonly Record<string, number>[], keys: readonly string[]): string {
  return points.map((point) => keys.map((key) => point[key]).join(', ')).join('\n')
}

function parsePoints(event: Event, keys: readonly string[]): Record<string, number>[] {
  return (event.target as HTMLTextAreaElement).value.split(/\r?\n/).flatMap((line) => {
    const values = line.trim().split(/[，,\s]+/).map(Number)
    if (values.length !== keys.length || values.some((value) => !Number.isFinite(value) || value < 0)) return []
    return [Object.fromEntries(keys.map((key, index) => [key, values[index]]))]
  })
}

function setIdealEfficiency(enabled: boolean): void {
  patch({ force: { roller: { efficiency: enabled ? 1 : null } } })
}

function setEqualSplit(enabled: boolean): void {
  patch({ force: { torqueCam: { equalSplitAssumption: enabled, torqueShare: enabled ? 0.5 : null } } })
}

function inferFixedReduction(): void {
  const selection = props.calibrationSelection
  const reference = profile.value.calibration.referencePureRatio
  if (!selection || !props.totalReduction || reference == null) {
    calibrationMessage.value = t('analyzer.cvt.calibrationMissingSelection') as string
    return
  }
  const result = inferFixedReductionFromSegment(
    props.totalReduction,
    selection.startIdx,
    selection.endIdx,
    reference,
  )
  if (result.status !== 'ok') {
    calibrationMessage.value = result.status === 'unstable'
      ? t('analyzer.cvt.calibrationUnstable', { percent: (result.relativeMad * 100).toFixed(2) }) as string
      : t('analyzer.cvt.calibrationInvalid') as string
    return
  }
  patch({
    calibration: {
      combinedFixedReduction: result.combinedFixedReduction,
      revision: profile.value.calibration.revision + 1,
      fixedReductionSegment: {
        startX: selection.startX,
        endX: selection.endX,
        sampleCount: result.sampleCount,
        referencePureRatio: reference,
        relativeMad: result.relativeMad,
      },
    },
  })
  calibrationMessage.value = t('analyzer.cvt.calibrationSaved', {
    ratio: result.combinedFixedReduction.toFixed(4),
    count: result.sampleCount,
  }) as string
}

function addProfile(): void {
  drivetrain.addCvtProfile(t('analyzer.cvt.newProfile') as string)
}

function onBackdropPointer(event: PointerEvent): void {
  if (event.target !== event.currentTarget) return
  // Touch users close on pointer-up to avoid dismissing the sheet at the start
  // of a scroll gesture; mouse/pen can dismiss immediately on pointer-down.
  if (event.pointerType !== 'touch') emit('close')
}
</script>

<template>
  <!-- The dashboard grid uses transforms, which would otherwise make a
       descendant position:fixed element relative to the card. Teleporting
       the editor to body gives the settings surface the viewport as its
       containing block. -->
  <Teleport to="body">
    <div
      v-if="open"
      class="editor-backdrop"
      role="presentation"
      @pointerdown="onBackdropPointer"
      @pointerup.self="emit('close')"
    >
      <section class="profile-editor" role="dialog" aria-modal="true" :aria-label="t('analyzer.cvt.settingsTitle')">
      <header>
        <div>
          <h2>{{ t('analyzer.cvt.settingsTitle') }}</h2>
          <p>{{ t('analyzer.cvt.settingsIntro') }}</p>
        </div>
        <button type="button" class="close-button" :aria-label="t('analyzer.cvt.close')" @click="emit('close')">×</button>
      </header>

      <div class="profile-toolbar">
        <label>
          <span>{{ t('analyzer.cvt.profile') }}</span>
          <select :value="profile.id" @change="drivetrain.setActiveCvtProfile(textValue($event))">
            <option v-for="item in drivetrain.cvt.profiles" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <button type="button" @click="addProfile">{{ t('analyzer.cvt.addProfile') }}</button>
        <button type="button" @click="drivetrain.duplicateCvtProfile(profile.id)">{{ t('analyzer.cvt.duplicateProfile') }}</button>
        <button type="button" :disabled="drivetrain.cvt.profiles.length <= 1" @click="drivetrain.removeCvtProfile(profile.id)">{{ t('analyzer.cvt.removeProfile') }}</button>
      </div>

      <div class="editor-scroll">
        <section class="form-section">
          <h3>{{ t('analyzer.cvt.identityHeading') }}</h3>
          <div class="form-grid">
            <label><span>{{ t('analyzer.cvt.profileName') }}</span><input type="text" :value="profile.name" @change="patch({ name: textValue($event) })" /></label>
            <label><span>{{ t('analyzer.cvt.vehicleId') }}</span><input type="text" :value="profile.vehicleId" @change="patch({ vehicleId: textValue($event) })" /></label>
            <label>
              <span>{{ t('analyzer.cvt.actuation') }}</span>
              <select :value="profile.actuationKind" @change="patch({ actuationKind: textValue($event) === 'electronic' ? 'electronic' : 'mechanical' })">
                <option value="mechanical">{{ t('analyzer.cvt.mechanicalActuation') }}</option>
                <option value="electronic">{{ t('analyzer.cvt.electronicActuation') }}</option>
              </select>
            </label>
            <label><span>{{ t('analyzer.gear.tireSpecLabel') }}</span><input type="text" :value="profile.tireSpec" @change="drivetrain.setCvtTireSpec(textValue($event))" /></label>
            <label><span>{{ t('analyzer.gear.wheelCircumferenceDirectLabel') }}</span><input type="number" inputmode="decimal" min="0" step="1" :value="profile.wheelCircumferenceMm" @change="drivetrain.setCvtWheelCircumferenceMm(optionalNumber($event) ?? 0)" /></label>
          </div>
        </section>

        <section class="form-section">
          <h3>{{ t('analyzer.cvt.fixedReductionHeading') }}</h3>
          <div class="reduction-grid">
            <CvtReductionEditor :model-value="profile.gearReduction" :label="t('analyzer.cvt.gearReduction')" @update:model-value="patch({ gearReduction: $event })" />
            <CvtReductionEditor :model-value="profile.finalReduction" :label="t('analyzer.gear.finalDrive')" @update:model-value="patch({ finalReduction: $event })" />
          </div>
        </section>

        <section class="form-section">
          <h3>{{ t('analyzer.cvt.beltHeading') }}</h3>
          <div class="form-grid">
            <label><span>{{ t('analyzer.cvt.beltPartNumber') }}</span><input type="text" :value="profile.belt.partNumber" @change="patch({ belt: { partNumber: textValue($event) } })" /></label>
            <label>
              <span>{{ t('analyzer.cvt.beltLengthSource') }}</span>
              <select :value="profile.belt.lengthSource" @change="patch({ belt: { lengthSource: textValue($event) === 'pitch' ? 'pitch' : 'outside' } })">
                <option value="outside">{{ t('analyzer.cvt.outsideLength') }}</option>
                <option value="pitch">{{ t('analyzer.cvt.pitchLength') }}</option>
              </select>
            </label>
            <label v-if="profile.belt.lengthSource === 'outside'"><span>{{ t('analyzer.cvt.outsideLengthMm') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.belt.outsideLengthMm ?? ''" @change="patch({ belt: { outsideLengthMm: optionalNumber($event) } })" /></label>
            <label v-if="profile.belt.lengthSource === 'outside'"><span>{{ t('analyzer.cvt.cordOffsetMm') }}</span><input type="number" inputmode="decimal" min="0" step="0.01" :value="profile.belt.cordOffsetFromOutsideMm ?? ''" @change="patch({ belt: { cordOffsetFromOutsideMm: optionalNumber($event) } })" /></label>
            <label v-else><span>{{ t('analyzer.cvt.pitchLengthMm') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.belt.pitchLengthMm ?? ''" @change="patch({ belt: { pitchLengthMm: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.beltWidthMm') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.belt.widthMm ?? ''" @change="patch({ belt: { widthMm: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.beltHeightMm') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.belt.heightMm ?? ''" @change="patch({ belt: { heightMm: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.beltAngle') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.belt.wedgeAngle.valueDeg ?? ''" @change="patch({ belt: { wedgeAngle: { valueDeg: optionalNumber($event) } } })" /></label>
            <label><span>{{ t('analyzer.cvt.angleBasis') }}</span><select :value="profile.belt.wedgeAngle.basis" @change="patch({ belt: { wedgeAngle: { basis: textValue($event) === 'included' ? 'included' : 'half' } } })"><option value="half">{{ t('analyzer.cvt.halfAngle') }}</option><option value="included">{{ t('analyzer.cvt.includedAngle') }}</option></select></label>
          </div>
          <p class="field-note">{{ t('analyzer.cvt.outsideLengthEvidence') }}</p>
        </section>

        <section class="form-section">
          <h3>{{ t('analyzer.cvt.geometryHeading') }}</h3>
          <div class="form-grid">
            <label><span>{{ t('analyzer.cvt.centerDistanceMm') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.centerDistanceMm ?? ''" @change="patch({ geometry: { centerDistanceMm: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.frontSheaveAngle') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.frontSheaveAngle.valueDeg ?? ''" @change="patchAngle('frontSheaveAngle', { valueDeg: optionalNumber($event) })" /></label>
            <label><span>{{ t('analyzer.cvt.frontAngleBasis') }}</span><select :value="profile.geometry.frontSheaveAngle.basis" @change="patchAngle('frontSheaveAngle', { basis: textValue($event) === 'included' ? 'included' : 'half' })"><option value="half">{{ t('analyzer.cvt.halfAngle') }}</option><option value="included">{{ t('analyzer.cvt.includedAngle') }}</option></select></label>
            <label><span>{{ t('analyzer.cvt.rearSheaveAngle') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.rearSheaveAngle.valueDeg ?? ''" @change="patchAngle('rearSheaveAngle', { valueDeg: optionalNumber($event) })" /></label>
            <label><span>{{ t('analyzer.cvt.rearAngleBasis') }}</span><select :value="profile.geometry.rearSheaveAngle.basis" @change="patchAngle('rearSheaveAngle', { basis: textValue($event) === 'included' ? 'included' : 'half' })"><option value="half">{{ t('analyzer.cvt.halfAngle') }}</option><option value="included">{{ t('analyzer.cvt.includedAngle') }}</option></select></label>
            <label><span>{{ t('analyzer.cvt.frontRadiusMin') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.frontRadiusBoundsMm?.min || ''" @change="patchBounds('frontRadiusBoundsMm', 'min', $event)" /></label>
            <label><span>{{ t('analyzer.cvt.frontRadiusMax') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.frontRadiusBoundsMm?.max || ''" @change="patchBounds('frontRadiusBoundsMm', 'max', $event)" /></label>
            <label><span>{{ t('analyzer.cvt.rearRadiusMin') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.rearRadiusBoundsMm?.min || ''" @change="patchBounds('rearRadiusBoundsMm', 'min', $event)" /></label>
            <label><span>{{ t('analyzer.cvt.rearRadiusMax') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.rearRadiusBoundsMm?.max || ''" @change="patchBounds('rearRadiusBoundsMm', 'max', $event)" /></label>
            <label><span>{{ t('analyzer.cvt.frontBareDiameter') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.frontBarePulleyDiameterMm ?? ''" @change="patch({ geometry: { frontBarePulleyDiameterMm: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.rearBareDiameter') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.rearBarePulleyDiameterMm ?? ''" @change="patch({ geometry: { rearBarePulleyDiameterMm: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.sleeveLength') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.geometry.sleeveLengthMm ?? ''" @change="patch({ geometry: { sleeveLengthMm: optionalNumber($event) } })" /></label>
          </div>
          <p class="field-note">{{ t('analyzer.cvt.bareDiameterNote') }}</p>
        </section>

        <details class="form-section force-section">
          <summary><strong>{{ t('analyzer.cvt.forceHeading') }}</strong><span>{{ t('analyzer.cvt.forceSummary') }}</span></summary>

          <h4>{{ t('analyzer.cvt.operatingHeading') }}</h4>
          <div class="form-grid">
            <label><span>{{ t('analyzer.cvt.operatingRpm') }}</span><input type="number" inputmode="decimal" min="0" step="100" :value="profile.force.operatingFrontRpm ?? ''" @change="patch({ force: { operatingFrontRpm: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.rearTorque') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.force.operatingRearTorqueNm ?? ''" @change="patch({ force: { operatingRearTorqueNm: optionalNonNegativeNumber($event) } })" /></label>
          </div>

          <h4>{{ t('analyzer.cvt.rollerHeading') }}</h4>
          <div class="form-grid">
            <label><span>{{ t('analyzer.cvt.rollerKind') }}</span><select :value="profile.force.roller.kind" @change="patch({ force: { roller: { kind: textValue($event) as 'roller' | 'slider' | 'mixed' } } })"><option value="roller">{{ t('analyzer.cvt.roller') }}</option><option value="slider">{{ t('analyzer.cvt.slider') }}</option><option value="mixed">{{ t('analyzer.cvt.mixedRollers') }}</option></select></label>
            <label><span>{{ t('analyzer.cvt.rollerMasses') }}</span><input type="text" inputmode="decimal" :value="formatMasses(profile.force.roller.massesG)" placeholder="9, 9, 9, 9, 9, 9" @change="patch({ force: { roller: { massesG: parseMasses($event) } } })" /></label>
          </div>
          <label class="wide-field"><span>{{ t('analyzer.cvt.rollerTrack') }}</span><textarea rows="4" :value="formatPoints(profile.force.roller.track, ['travelMm', 'radiusMm'])" placeholder="0, 24&#10;5, 29&#10;10, 35" @change="patch({ force: { roller: { track: parsePoints($event, ['travelMm', 'radiusMm']) as never } } })"></textarea></label>
          <label class="check-field"><input type="checkbox" :checked="profile.force.roller.efficiency === 1" @change="setIdealEfficiency(($event.target as HTMLInputElement).checked)" /><span>{{ t('analyzer.cvt.idealRollerEfficiency') }}</span></label>
          <p class="field-note">{{ t('analyzer.cvt.rollerTrackNote') }}</p>

          <h4>{{ t('analyzer.cvt.springHeading') }}</h4>
          <div class="form-grid">
            <label><span>{{ t('analyzer.cvt.springCatalogLabel') }}</span><input type="text" :value="profile.force.spring.catalogLabel" placeholder="1000 rpm / 1500 rpm" @change="patch({ force: { spring: { catalogLabel: textValue($event) } } })" /></label>
            <label><span>{{ t('analyzer.cvt.springInputMode') }}</span><select :value="profile.force.spring.mode" @change="patch({ force: { spring: { mode: textValue($event) as 'disabled' | 'linear' | 'curve' } } })"><option value="disabled">{{ t('analyzer.cvt.notEnabled') }}</option><option value="linear">{{ t('analyzer.cvt.linearSpring') }}</option><option value="curve">{{ t('analyzer.cvt.measuredForceCurve') }}</option></select></label>
            <label><span>{{ t('analyzer.cvt.freeLength') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.force.spring.freeLengthMm ?? ''" @change="patch({ force: { spring: { freeLengthMm: optionalNumber($event) } } })" /></label>
            <label><span>{{ t('analyzer.cvt.installedLength') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.force.spring.installedLengthMm ?? ''" @change="patch({ force: { spring: { installedLengthMm: optionalNumber($event) } } })" /></label>
            <label v-if="profile.force.spring.mode === 'linear'"><span>{{ t('analyzer.cvt.springRate') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.force.spring.rateNPerMm ?? ''" @change="patch({ force: { spring: { rateNPerMm: optionalNumber($event) } } })" /></label>
            <label v-if="profile.force.spring.mode === 'linear'"><span>{{ t('analyzer.cvt.installedPreload') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.force.spring.installedPreloadMm ?? ''" @change="patch({ force: { spring: { installedPreloadMm: optionalNonNegativeNumber($event) } } })" /></label>
            <label><span>{{ t('analyzer.cvt.coilBindLength') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.force.spring.coilBindLengthMm ?? ''" @change="patch({ force: { spring: { coilBindLengthMm: optionalNumber($event) } } })" /></label>
          </div>
          <label v-if="profile.force.spring.mode === 'curve'" class="wide-field"><span>{{ t('analyzer.cvt.springForceCurve') }}</span><textarea rows="4" :value="formatPoints(profile.force.spring.forceCurve, ['travelMm', 'value'])" placeholder="0, 100&#10;5, 160&#10;10, 225" @change="patch({ force: { spring: { forceCurve: parsePoints($event, ['travelMm', 'value']) as never } } })"></textarea></label>
          <p class="field-note">{{ t('analyzer.cvt.springCatalogWarning') }}</p>

          <h4>{{ t('analyzer.cvt.camHeading') }}</h4>
          <div class="form-grid">
            <label><span>{{ t('analyzer.cvt.camInputMode') }}</span><select :value="profile.force.torqueCam.mode" @change="patch({ force: { torqueCam: { mode: textValue($event) === 'profile' ? 'profile' : 'disabled' } } })"><option value="disabled">{{ t('analyzer.cvt.notEnabled') }}</option><option value="profile">{{ t('analyzer.cvt.measuredCamProfile') }}</option></select></label>
            <label><span>{{ t('analyzer.cvt.camAngleBasis') }}</span><select :value="profile.force.torqueCam.angleBasis" @change="patch({ force: { torqueCam: { angleBasis: textValue($event) === 'axial' ? 'axial' : 'circumferential' } } })"><option value="circumferential">{{ t('analyzer.cvt.circumferentialAngle') }}</option><option value="axial">{{ t('analyzer.cvt.axialAngle') }}</option></select></label>
            <label><span>{{ t('analyzer.cvt.torsionTorque') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.force.torqueCam.torsionTorqueNm ?? ''" @change="patch({ force: { torqueCam: { torsionTorqueNm: optionalNonNegativeNumber($event) } } })" /></label>
            <label v-if="!profile.force.torqueCam.equalSplitAssumption"><span>{{ t('analyzer.cvt.torqueShare') }}</span><input type="number" inputmode="decimal" min="0" max="1" step="0.01" :value="profile.force.torqueCam.torqueShare ?? ''" @change="patch({ force: { torqueCam: { torqueShare: optionalNumber($event) } } })" /></label>
          </div>
          <label v-if="profile.force.torqueCam.mode === 'profile'" class="wide-field"><span>{{ t('analyzer.cvt.camProfile') }}</span><textarea rows="4" :value="formatPoints(profile.force.torqueCam.points, ['travelMm', 'angleDeg', 'effectiveRadiusMm'])" placeholder="0, 42, 38&#10;5, 44, 38&#10;10, 47, 39" @change="patch({ force: { torqueCam: { points: parsePoints($event, ['travelMm', 'angleDeg', 'effectiveRadiusMm']) as never } } })"></textarea></label>
          <label class="check-field"><input type="checkbox" :checked="profile.force.torqueCam.equalSplitAssumption" @change="setEqualSplit(($event.target as HTMLInputElement).checked)" /><span>{{ t('analyzer.cvt.equalSplitAssumption') }}</span></label>

          <h4>{{ t('analyzer.cvt.couplingHeading') }}</h4>
          <div class="form-grid">
            <label><span>{{ t('analyzer.cvt.couplingModel') }}</span><select :value="profile.force.couplingMode" @change="patch({ force: { couplingMode: textValue($event) as 'disabled' | 'ideal' | 'calibrated' } })"><option value="disabled">{{ t('analyzer.cvt.notEnabled') }}</option><option value="ideal">{{ t('analyzer.cvt.idealCoupling') }}</option><option value="calibrated">{{ t('analyzer.cvt.calibratedCoupling') }}</option></select></label>
            <label v-if="profile.force.couplingMode === 'calibrated'"><span>{{ t('analyzer.cvt.couplingScale') }}</span><input type="number" inputmode="decimal" min="0" step="0.01" :value="profile.force.couplingScale ?? ''" @change="patch({ force: { couplingScale: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.frictionMin') }}</span><input type="number" inputmode="decimal" min="0" step="0.01" :value="profile.force.frictionCoefficientMin ?? ''" @change="patch({ force: { frictionCoefficientMin: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.frictionMax') }}</span><input type="number" inputmode="decimal" min="0" step="0.01" :value="profile.force.frictionCoefficientMax ?? ''" @change="patch({ force: { frictionCoefficientMax: optionalNumber($event) } })" /></label>
          </div>
          <p class="field-note">{{ t('analyzer.cvt.couplingWarning') }}</p>
        </details>

        <details class="form-section force-section">
          <summary><strong>{{ t('analyzer.cvt.calibrationHeading') }}</strong><span>{{ t('analyzer.cvt.calibrationSummary') }}</span></summary>
          <div class="form-grid calibration-grid">
            <label><span>{{ t('analyzer.cvt.setupIdentity') }}</span><input type="text" :value="profile.calibration.setupIdentity" @change="patch({ calibration: { setupIdentity: textValue($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.activeDirection') }}</span><select :value="profile.calibration.activeDirection" @change="patch({ calibration: { activeDirection: textValue($event) === 'downshift' ? 'downshift' : 'upshift' } })"><option value="upshift">{{ t('analyzer.cvt.upshift') }}</option><option value="downshift">{{ t('analyzer.cvt.downshift') }}</option></select></label>
            <label><span>{{ t('analyzer.cvt.referencePureRatio') }}</span><input type="number" inputmode="decimal" min="0" step="0.001" :value="profile.calibration.referencePureRatio ?? ''" @change="patch({ calibration: { referencePureRatio: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.combinedFixedFallback') }}</span><input type="number" inputmode="decimal" min="0" step="0.001" :value="profile.calibration.combinedFixedReduction ?? ''" disabled /></label>
            <label><span>{{ t('analyzer.cvt.accuracyTarget') }}</span><input type="number" inputmode="decimal" min="0" step="10" :value="profile.calibration.accuracyTargetRpm ?? ''" @change="patch({ calibration: { accuracyTargetRpm: optionalNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.holdoutResidual') }}</span><input type="number" inputmode="decimal" min="0" step="1" :value="profile.calibration.holdoutResidualRpm ?? ''" @change="patch({ calibration: { holdoutResidualRpm: optionalNonNegativeNumber($event) } })" /></label>
            <label><span>{{ t('analyzer.cvt.massSensitivityStep') }}</span><input type="number" inputmode="decimal" min="0" step="0.1" :value="profile.calibration.sensitivityDeltaTotalMassG" @change="patch({ calibration: { sensitivityDeltaTotalMassG: optionalNumber($event) ?? 1 } })" /></label>
          </div>
          <div class="calibration-action">
            <button type="button" :disabled="!calibrationSelection" @click="inferFixedReduction">{{ t('analyzer.cvt.useSelectedSegment') }}</button>
            <span v-if="calibrationSelection">{{ t('analyzer.cvt.selectedSegment', { start: calibrationSelection.startX.toFixed(2), end: calibrationSelection.endX.toFixed(2) }) }}</span>
            <span v-else>{{ t('analyzer.cvt.noSelectedSegment') }}</span>
          </div>
          <p v-if="calibrationMessage" class="field-note">{{ calibrationMessage }}</p>
          <p v-if="profile.calibration.fixedReductionSegment" class="field-note">{{ t('analyzer.cvt.savedSegment', { start: profile.calibration.fixedReductionSegment.startX.toFixed(2), end: profile.calibration.fixedReductionSegment.endX.toFixed(2), count: profile.calibration.fixedReductionSegment.sampleCount, mad: (profile.calibration.fixedReductionSegment.relativeMad * 100).toFixed(2) }) }}</p>

          <div class="map-grid">
            <label class="wide-field"><span>{{ t('analyzer.cvt.upshiftMap') }}</span><textarea rows="4" :value="formatPoints(profile.calibration.upshiftMap, ['ratio', 'scale'])" placeholder="1.0, 0.98&#10;1.5, 1.02" @change="patch({ calibration: { upshiftMap: parsePoints($event, ['ratio', 'scale']) as never, holdoutResidualRpm: null } })"></textarea></label>
            <label class="wide-field"><span>{{ t('analyzer.cvt.downshiftMap') }}</span><textarea rows="4" :value="formatPoints(profile.calibration.downshiftMap, ['ratio', 'scale'])" placeholder="1.0, 1.04&#10;1.5, 1.08" @change="patch({ calibration: { downshiftMap: parsePoints($event, ['ratio', 'scale']) as never, holdoutResidualRpm: null } })"></textarea></label>
          </div>
          <p class="field-note">{{ t('analyzer.cvt.calibrationBoundary') }}</p>
          <p class="field-note">{{ t('analyzer.cvt.environmentSensitivityBoundary') }}</p>
        </details>

        <aside class="honesty-boundary">
          <strong>{{ t('analyzer.cvt.boundaryHeading') }}</strong>
          <p>{{ t('analyzer.cvt.honestyBoundary') }}</p>
        </aside>
      </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.editor-backdrop { position: fixed; inset: 0; z-index: 1200; background: var(--color-bg); }
.profile-editor { width: 100vw; max-width: none; height: 100vh; height: 100dvh; display: flex; flex-direction: column; color: var(--color-text); background: var(--color-bg); }
header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 18px 20px; border-bottom: 1px solid var(--color-border); }
h2, h3, p { margin: 0; }
header p, .field-note { margin-top: 5px; color: var(--color-text-muted); font-size: 0.8rem; line-height: 1.45; }
.close-button { width: 40px; height: 40px; flex: 0 0 auto; font-size: 1.4rem; }
.profile-toolbar { display: grid; grid-template-columns: minmax(160px, 1fr) repeat(3, auto); gap: 8px; align-items: end; padding: 12px 20px; border-bottom: 1px solid var(--color-border); }
.profile-toolbar label, .form-grid label { display: grid; gap: 5px; min-width: 0; color: var(--color-text-muted); font-size: 0.78rem; }
button, select, input { min-height: 36px; padding: 6px 9px; color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); }
button { cursor: pointer; background: var(--color-surface-raised); }
button:disabled { opacity: 0.45; cursor: default; }
.editor-scroll { width: 100%; min-height: 0; overflow: auto; padding: 16px max(20px, calc((100vw - 1440px) / 2)) max(28px, env(safe-area-inset-bottom)); display: grid; gap: 16px; }
.form-section { padding: 14px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: calc(var(--radius) * 1.25); }
.form-section h3 { margin-bottom: 12px; }
.form-section h4 { margin: 18px 0 10px; }
.force-section summary { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; cursor: pointer; }
.force-section summary span { color: var(--color-text-muted); font-size: 0.78rem; }
.wide-field { display: grid; gap: 5px; margin-top: 10px; color: var(--color-text-muted); font-size: 0.78rem; }
.wide-field textarea { min-height: 96px; resize: vertical; padding: 8px 9px; color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); font-family: var(--font-mono, monospace); }
.check-field { min-height: 36px; display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 0.8rem; }
.check-field input { min-height: auto; }
.calibration-action { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 12px; color: var(--color-text-muted); font-size: 0.78rem; }
.map-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
.reduction-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.honesty-boundary { padding: 14px; border: 1px solid var(--color-warning, #c99100); border-radius: var(--radius); background: color-mix(in srgb, var(--color-warning, #c99100) 10%, transparent); }
.honesty-boundary p { margin-top: 6px; line-height: 1.5; font-size: 0.82rem; }
:root[data-any-pointer-coarse='true'] button,
:root[data-any-pointer-coarse='true'] select,
:root[data-any-pointer-coarse='true'] input { min-height: 44px; }
@media (max-width: 720px) {
  .profile-toolbar { grid-template-columns: 1fr 1fr; }
  .form-grid, .reduction-grid { grid-template-columns: 1fr; }
}
</style>
