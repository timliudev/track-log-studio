<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConverterStore } from '@/stores/converterStore'
import { useSuspensionStore } from '@/stores/suspensionStore'
import {
  deriveSuspensionChannels,
  derivedSuspensionNames,
} from '@/domain/units/suspension'
import { patchLogaText } from '@/domain/export/loga/LogaWriter'
import { withSuspensionCalibration } from '@/domain/export/metadata'
import { downloadText, downloadZip } from '@/features/converter/download'

const { t } = useI18n()
const conv = useConverterStore()
const susp = useSuspensionStore()

const busy = ref(false)
const results = reactive<Record<number, string>>({})

function hasDerivedChannels(entry: (typeof conv.savableEntries)[number]): boolean {
  return derivedSuspensionNames(entry.session, susp.config).length > 0
}

function hasCvtNotes(entry: (typeof conv.savableEntries)[number]): boolean {
  return (entry.metadata.cvtNotes?.length ?? 0) > 0
}

function metadataFor(entry: (typeof conv.savableEntries)[number]) {
  return withSuspensionCalibration(entry.metadata, susp.config)
}

function hasSuspensionCalibration(entry: (typeof conv.savableEntries)[number]): boolean {
  return metadataFor(entry).suspensionCalibration != null
}

/** Entries that would write either calibrated channels or session notes. */
const eligible = computed(() =>
  conv.savableEntries.filter(
    (entry) => hasDerivedChannels(entry) || hasCvtNotes(entry) || hasSuspensionCalibration(entry),
  ),
)

function outName(entry: (typeof conv.savableEntries)[number]): string {
  const suffix = hasDerivedChannels(entry) ? '_calibrated.loga' : '_annotated.loga'
  return entry.name.replace(/\.loga$/i, '') + suffix
}

async function build(entry: (typeof eligible.value)[number]): Promise<{ name: string; content: string }> {
  const text = await entry.file.text()
  const channels = deriveSuspensionChannels(entry.session, susp.config)
  const replacements = new Map(channels.map((c) => [c.name, c.data]))
  const metadata = metadataFor(entry)
  const { text: out, replaced, appended } = patchLogaText(text, replacements, metadata)
  const parts: string[] = []
  if (replaced.length) parts.push(`${t('suspension.save.replaced')}: ${replaced.join(', ')}`)
  if (appended.length) parts.push(`${t('suspension.save.appended')}: ${appended.join(', ')}`)
  if (hasCvtNotes(entry)) parts.push(t('suspension.save.cvtNotesSaved', { count: entry.metadata.cvtNotes!.length }))
  if (metadata.suspensionCalibration) parts.push(t('suspension.save.calibrationSaved'))
  results[entry.id] = parts.join(' · ')
  return { name: outName(entry), content: out }
}

async function saveOne(entry: (typeof eligible.value)[number]): Promise<void> {
  busy.value = true
  try {
    const f = await build(entry)
    downloadText(f.name, f.content)
  } finally {
    busy.value = false
  }
}

async function saveAll(): Promise<void> {
  busy.value = true
  try {
    const files = []
    for (const e of eligible.value) files.push(await build(e))
    if (files.length === 1) downloadText(files[0].name, files[0].content)
    else if (files.length > 1) downloadZip('calibrated-loga.zip', files)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="save">
    <h3>{{ t('suspension.save.heading') }}</h3>
    <p class="intro">{{ t('suspension.save.intro') }}</p>

    <p v-if="eligible.length === 0" class="muted">{{ t('suspension.save.none') }}</p>

    <template v-else>
      <button v-if="eligible.length > 1" type="button" class="btn-primary" :disabled="busy" @click="saveAll">
        {{ busy ? t('suspension.save.busy') : t('suspension.save.all') }}
      </button>
      <ul class="items">
        <li v-for="e in eligible" :key="e.id" class="item">
          <div class="info">
            <span class="name">{{ outName(e) }}</span>
            <span v-if="results[e.id]" class="result">{{ results[e.id] }}</span>
          </div>
          <button type="button" class="btn-secondary" :disabled="busy" @click="saveOne(e)">
            {{ busy ? t('suspension.save.busy') : t('suspension.save.one') }}
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.save {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.muted {
  color: var(--color-text-muted);
}
.btn-primary {
  align-self: flex-start;
  background: var(--color-accent);
  color: var(--color-accent-text);
  border: none;
  border-radius: var(--radius);
  padding: 8px 16px;
  font: inherit;
  cursor: pointer;
}
.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
.info {
  display: flex;
  flex-direction: column;
}
.name {
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
}
.result {
  font-size: 0.78rem;
  color: var(--color-text-muted);
}
.btn-secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
</style>
