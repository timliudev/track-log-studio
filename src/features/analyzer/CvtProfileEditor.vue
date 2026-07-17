<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDrivetrainStore, type CvtAngleInput, type CvtProfilePatch } from '@/stores/drivetrainStore'
import CvtReductionEditor from './CvtReductionEditor.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const drivetrain = useDrivetrainStore()
const profile = computed(() => drivetrain.activeCvtProfile)

function optionalNumber(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
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

        <aside class="honesty-boundary">
          <strong>{{ t('analyzer.cvt.boundaryHeading') }}</strong>
          <p>{{ t('analyzer.cvt.honestyBoundary') }}</p>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.editor-backdrop { position: fixed; inset: 0; z-index: 1200; display: flex; justify-content: flex-end; background: rgb(0 0 0 / 0.48); }
.profile-editor { width: min(760px, 92vw); height: 100%; display: flex; flex-direction: column; color: var(--color-text); background: var(--color-bg); box-shadow: -10px 0 35px rgb(0 0 0 / 0.28); }
header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 18px 20px; border-bottom: 1px solid var(--color-border); }
h2, h3, p { margin: 0; }
header p, .field-note { margin-top: 5px; color: var(--color-text-muted); font-size: 0.8rem; line-height: 1.45; }
.close-button { width: 40px; height: 40px; flex: 0 0 auto; font-size: 1.4rem; }
.profile-toolbar { display: grid; grid-template-columns: minmax(160px, 1fr) repeat(3, auto); gap: 8px; align-items: end; padding: 12px 20px; border-bottom: 1px solid var(--color-border); }
.profile-toolbar label, .form-grid label { display: grid; gap: 5px; min-width: 0; color: var(--color-text-muted); font-size: 0.78rem; }
button, select, input { min-height: 36px; padding: 6px 9px; color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); }
button { cursor: pointer; background: var(--color-surface-raised); }
button:disabled { opacity: 0.45; cursor: default; }
.editor-scroll { min-height: 0; overflow: auto; padding: 16px 20px 28px; display: grid; gap: 16px; }
.form-section { padding: 14px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: calc(var(--radius) * 1.25); }
.form-section h3 { margin-bottom: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
.reduction-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.honesty-boundary { padding: 14px; border: 1px solid var(--color-warning, #c99100); border-radius: var(--radius); background: color-mix(in srgb, var(--color-warning, #c99100) 10%, transparent); }
.honesty-boundary p { margin-top: 6px; line-height: 1.5; font-size: 0.82rem; }
:root[data-any-pointer-coarse='true'] button,
:root[data-any-pointer-coarse='true'] select,
:root[data-any-pointer-coarse='true'] input { min-height: 44px; }
@media (max-width: 720px) {
  .profile-editor { width: 100vw; }
  .profile-toolbar { grid-template-columns: 1fr 1fr; }
  .form-grid, .reduction-grid { grid-template-columns: 1fr; }
}
</style>
