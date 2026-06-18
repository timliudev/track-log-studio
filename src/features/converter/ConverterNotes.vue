<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t, tm, rt } = useI18n()

// TODO: replace with the user's own import walkthrough once provided. For now
// this points at the RaceChrono DIY data-format article.
const IMPORT_GUIDE_URL = 'https://racechrono.com/article/2572'
</script>

<template>
  <section class="notes">
    <p class="note">
      {{ t('converter.notes.racechrono') }}
      <a :href="IMPORT_GUIDE_URL" target="_blank" rel="noopener noreferrer">
        {{ t('converter.notes.importGuide') }} ↗
      </a>
    </p>
    <p class="note muted">⚠ {{ t('converter.notes.raceModule') }}</p>

    <details class="sources">
      <summary>{{ t('converter.notes.sources.title') }}</summary>
      <p class="src-label">{{ t('converter.notes.sources.tested') }}</p>
      <ol class="src-list">
        <li v-for="(item, i) in tm('converter.notes.sources.testedItems')" :key="`t${i}`">
          {{ rt(item) }}
        </li>
      </ol>
      <p class="src-label muted">{{ t('converter.notes.sources.untested') }}</p>
      <ol class="src-list muted">
        <li v-for="(item, i) in tm('converter.notes.sources.untestedItems')" :key="`u${i}`">
          {{ rt(item) }}
        </li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.notes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: calc(var(--space) * 1.5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius);
}
.note {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.6;
}
.note.muted {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
a {
  color: var(--color-accent);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
.sources {
  font-size: 0.85rem;
}
.sources summary {
  cursor: pointer;
  color: var(--color-accent);
}
.src-label {
  margin: 8px 0 2px;
  font-weight: 500;
}
.src-label.muted {
  color: var(--color-text-muted);
  font-weight: 400;
}
.src-list {
  margin: 0;
  padding-left: 1.4em;
  line-height: 1.6;
}
.src-list.muted {
  color: var(--color-text-muted);
}
</style>
