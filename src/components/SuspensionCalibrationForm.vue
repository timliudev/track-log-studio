<script setup lang="ts">
/**
 * Shared suspension-calibration editor — the SAME form embedded in both the
 * converter page (`SuspensionPanel.vue`, wraps this with its collapsible
 * `<details>`) and the analyzer page (`SuspensionCard.vue`, behind an "edit"
 * toggle). Both read/write the SAME `useSuspensionStore` (a Pinia store is
 * already a single reactive instance app-wide — see suspensionStore.ts) so
 * editing from either page is reflected everywhere else immediately,
 * including any chart already deriving `Front/Rear Suspension` from it.
 *
 * `sourceChannel` (see suspension.ts) is a free channel name, not a fixed
 * .loga-only enum — the picker below lists whatever channels the given
 * `sessions` actually contain, but ALSO accepts a name typed for a session
 * that isn't loaded yet (SearchableSelect just displays the raw string).
 * This is what makes calibration usable on any imported format, not only
 * .loga: point `sourceChannel` at whichever analog channel a VBO/RCZ/XRK/
 * RCNX/NMEA import happens to carry the sensor voltage under.
 */
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSuspensionStore } from '@/stores/suspensionStore'
import {
  PARTS,
  OUTPUT_NAME,
  ECU_NAME,
  adToTravelMm,
  fitLinear,
  suggestConfig,
  type SuspensionPart,
} from '@/domain/units/suspension'
import type { LogSession } from '@/domain/model/LogSession'
import SearchableSelect from '@/components/SearchableSelect.vue'

const props = defineProps<{
  /** Sessions to source the channel-name picker options and the reverse-calc
   *  reference data from — any imported format, any number of sessions (the
   *  converter passes every ready session; the analyzer passes just the one
   *  active session). */
  sessions: LogSession[]
}>()

const { t } = useI18n()
const susp = useSuspensionStore()

const reverseMsg = reactive<Record<SuspensionPart, string>>({ front: '', rear: '' })

const num = (e: Event): number => Number((e.target as HTMLInputElement).value)
const checked = (e: Event): boolean => (e.target as HTMLInputElement).checked

/** Every channel name (deduped, sorted) across all given sessions — the
 *  picker's option list. Not scoped to a single "format" — a channel named
 *  the same across sessions of different formats appears once. */
const channelOptions = computed<{ name: string; description?: string }[]>(() => {
  const seen = new Map<string, string | undefined>()
  for (const s of props.sessions) {
    for (const ch of s.channels) {
      if (!seen.has(ch.name)) seen.set(ch.name, ch.description)
    }
  }
  return [...seen.entries()]
    .map(([name, description]) => ({ name, description }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

function sourceSession(part: SuspensionPart): LogSession | undefined {
  const name = susp.config[part].sourceChannel
  if (!name) return undefined
  return props.sessions.find((s) => s.has(name) && s.has(ECU_NAME[part]))
}

function canReverse(part: SuspensionPart): boolean {
  return sourceSession(part) !== undefined
}

function doReverse(part: SuspensionPart): void {
  const s = sourceSession(part)
  if (!s) return
  const name = susp.config[part].sourceChannel
  const ad = s.get(name)?.data
  const mm = s.get(ECU_NAME[part])?.data
  const fit = fitLinear(ad, mm)
  if (!fit) {
    reverseMsg[part] = t('suspension.reverseFail')
    return
  }
  susp.setChannel(part, suggestConfig(fit))
  reverseMsg[part] = t('suspension.reverseOk', { r2: fit.r2.toFixed(3) })
}

function preview(part: SuspensionPart): string {
  const c = susp.config[part]
  const at = (v: number): string => {
    const mm = adToTravelMm(v, c)
    return Number.isFinite(mm) ? mm.toFixed(1) : '—'
  }
  return `${c.minMv}mv→${at(c.minMv)}mm · ${c.maxMv}mv→${at(c.maxMv)}mm · ${c.zeroMv}mv→${at(c.zeroMv)}mm`
}
</script>

<template>
  <section class="suspension">
    <h3>{{ t('suspension.heading') }}</h3>
    <p class="intro">{{ t('suspension.intro') }}</p>

    <div v-for="part in PARTS" :key="part" class="part">
      <header class="part-head">
        <label class="enable">
          <input
            type="checkbox"
            :name="`${part}-enabled`"
            :checked="susp.config[part].enabled"
            @change="susp.setChannel(part, { enabled: checked($event) })"
          />
          <strong>{{ t(`suspension.${part}`) }}</strong>
        </label>
        <span class="out">{{ t('suspension.outputs') }}: <code>{{ OUTPUT_NAME[part] }}</code></span>
      </header>

      <div class="grid">
        <label class="field source-field">
          <span>{{ t('suspension.source') }}</span>
          <SearchableSelect
            :model-value="susp.config[part].sourceChannel"
            :options="channelOptions"
            @update:model-value="susp.setChannel(part, { sourceChannel: $event ?? '' })"
          />
        </label>
        <label class="field">
          <span>{{ t('suspension.minMv') }}</span>
          <input type="number" :name="`${part}-minMv`" :value="susp.config[part].minMv" @input="susp.setChannel(part, { minMv: num($event) })" />
        </label>
        <label class="field">
          <span>{{ t('suspension.maxMv') }}</span>
          <input type="number" :name="`${part}-maxMv`" :value="susp.config[part].maxMv" @input="susp.setChannel(part, { maxMv: num($event) })" />
        </label>
        <label class="field">
          <span>{{ t('suspension.zeroMv') }}</span>
          <input type="number" :name="`${part}-zeroMv`" :value="susp.config[part].zeroMv" @input="susp.setChannel(part, { zeroMv: num($event) })" />
        </label>
        <label class="field">
          <span>{{ t('suspension.minMm') }}</span>
          <input type="number" :name="`${part}-minMm`" :value="susp.config[part].minMm" @input="susp.setChannel(part, { minMm: num($event) })" />
        </label>
        <label class="field">
          <span>{{ t('suspension.maxMm') }}</span>
          <input type="number" :name="`${part}-maxMm`" :value="susp.config[part].maxMm" @input="susp.setChannel(part, { maxMm: num($event) })" />
        </label>
      </div>

      <p class="preview">{{ t('suspension.preview') }}: {{ preview(part) }}</p>

      <div class="reverse">
        <button type="button" class="btn-secondary" :disabled="!canReverse(part)" @click="doReverse(part)">
          {{ t('suspension.reverse') }}
        </button>
        <span v-if="!canReverse(part)" class="hint">{{ t('suspension.reverseHint') }}</span>
        <span v-if="reverseMsg[part]" class="msg">{{ reverseMsg[part] }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.suspension {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
h3 {
  margin: 0;
  font-size: 1rem;
}
.intro {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
.part {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: calc(var(--space) * 1.5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
.part-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.enable {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.out {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
code {
  font-family: ui-monospace, monospace;
  color: var(--color-accent);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}
.source-field {
  grid-column: 1 / -1;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.field input,
.field select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.preview {
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-text-muted);
  font-family: ui-monospace, monospace;
}
.reverse {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.btn-secondary {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint,
.msg {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.msg {
  color: var(--color-text);
}
</style>
