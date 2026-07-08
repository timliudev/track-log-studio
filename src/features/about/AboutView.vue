<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { thirdPartyLicenses } from '@/data/licenses'

const { t } = useI18n()

// Build identity injected at compile time (see vite.config.ts `define`),
// same mechanism as the footer build stamp in App.vue.
const buildSha = __BUILD_SHA__
const buildDate = __BUILD_DATE__

const repoUrl = 'https://github.com/timliudev/track-log-studio'
const authorUrl = 'https://github.com/timliudev'
const licenseUrl = `${repoUrl}/blob/main/LICENSE`
</script>

<template>
  <div class="about">
    <div class="card">
      <h2 class="card-heading">{{ t('about.project.heading') }}</h2>
      <p class="app-name">{{ t('app.title') }}</p>
      <p class="app-subtitle">{{ t('app.subtitle') }}</p>
      <dl class="info-list">
        <div class="info-row">
          <dt>{{ t('about.project.author') }}</dt>
          <dd>
            <a :href="authorUrl" target="_blank" rel="noopener noreferrer">timliudev</a>
          </dd>
        </div>
        <div class="info-row">
          <dt>{{ t('about.project.repo') }}</dt>
          <dd>
            <a :href="repoUrl" target="_blank" rel="noopener noreferrer">{{ repoUrl }}</a>
          </dd>
        </div>
        <div class="info-row">
          <dt>{{ t('about.project.version') }}</dt>
          <dd>{{ t('about.project.versionValue', { sha: buildSha, date: buildDate }) }}</dd>
        </div>
        <div class="info-row">
          <dt>{{ t('about.project.license') }}</dt>
          <dd>
            <a :href="licenseUrl" target="_blank" rel="noopener noreferrer">{{
              t('about.project.licenseValue')
            }}</a>
          </dd>
        </div>
      </dl>
    </div>

    <div class="card">
      <h2 class="card-heading">{{ t('about.licenses.heading') }}</h2>
      <p class="licenses-intro">{{ t('about.licenses.intro') }}</p>
      <div class="licenses-table-wrap">
        <table class="licenses-table">
          <thead>
            <tr>
              <th>{{ t('about.licenses.colName') }}</th>
              <th>{{ t('about.licenses.colVersion') }}</th>
              <th>{{ t('about.licenses.colLicense') }}</th>
              <th>{{ t('about.licenses.colLink') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="pkg in thirdPartyLicenses" :key="pkg.name">
              <tr>
                <td class="pkg-name">{{ pkg.name }}</td>
                <td>{{ pkg.version }}</td>
                <td>
                  <span class="license-badge">{{ pkg.license }}</span>
                </td>
                <td>
                  <a :href="pkg.url" target="_blank" rel="noopener noreferrer">{{
                    t('about.licenses.viewLink')
                  }}</a>
                </td>
              </tr>
              <tr v-if="pkg.noteKey" class="note-row">
                <td colspan="4">{{ t(`about.licenses.notes.${pkg.noteKey}`) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
  max-width: 820px;
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  padding: calc(var(--space) * 2);
  display: flex;
  flex-direction: column;
  gap: var(--space);
}
.card-heading {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text);
}
.app-name {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-accent);
}
.app-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.info-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.info-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  font-size: 0.9rem;
}
.info-row dt {
  min-width: 6em;
  color: var(--color-text-muted);
}
.info-row dd {
  margin: 0;
  word-break: break-all;
}
.info-row a {
  color: var(--color-accent);
}
.licenses-intro {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.licenses-table-wrap {
  overflow-x: auto;
}
.licenses-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.licenses-table th,
.licenses-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}
.licenses-table th {
  color: var(--color-text-muted);
  font-weight: 500;
}
.pkg-name {
  font-weight: 600;
}
.license-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  font-size: 0.78rem;
}
.licenses-table a {
  color: var(--color-accent);
}
.note-row td {
  white-space: normal;
  color: var(--color-text-muted);
  font-size: 0.78rem;
  padding-top: 0;
  padding-bottom: 10px;
}
</style>
