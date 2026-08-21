<script setup lang="ts">
/**
 * B134 — shared "缺少 X 頻道" empty-state + manual channel-role picker.
 *
 * Wherever `resolveRoleChannel` (see `domain/analysis/channelRoles.ts`) comes
 * back null for a session — canonical lookup AND the name/unit heuristic both
 * found nothing — this renders the existing translated hint text plus a
 * `<select>` of the session's own channels so the user can supply the
 * mapping on the spot instead of hitting a dead end. The mapping is saved to
 * the device-wide `channelName → role` table (`stores/channelRoleStore.ts`),
 * keyed by NAME (not this session), so the next log from the same logging
 * setup resolves automatically too.
 *
 * Deliberately dumb/stateless beyond the store: this component doesn't know
 * WHY the role is missing or what happens once it resolves — every call
 * site's own reactive chain (through `resolveRoleChannel`/derived-trace
 * caches, all keyed on `channelRoleStore.overrides`) picks the change up on
 * its own, so setting an override here needs no emit/callback.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import { overriddenChannelForRole, type ChannelRole } from '@/domain/analysis/channelRoles'
import { useChannelRoleStore } from '@/stores/channelRoleStore'

const props = defineProps<{
  session: LogSession
  role: ChannelRole
  /** The already-translated "缺少 X 頻道" hint text for this role/site
   *  (callers keep owning their own i18n key/interpolation — this component
   *  just displays it next to the picker). */
  message: string
}>()

const { t } = useI18n()
const store = useChannelRoleStore()

const AUTO_VALUE = ''

/** The channel name currently overridden for this role in THIS session, or
 *  `AUTO_VALUE` when none (the "自動" option is selected). */
const selected = computed<string>(
  () => overriddenChannelForRole(props.session, props.role, store.overrides) ?? AUTO_VALUE,
)

function onChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value === AUTO_VALUE) {
    const current = selected.value
    if (current !== AUTO_VALUE) store.clearOverride(current)
    return
  }
  store.setOverride(value, props.role)
}
</script>

<template>
  <div class="channel-role-picker">
    <p class="hint">{{ message }}</p>
    <label class="field">
      <span>{{ t('analyzer.channelRole.pickerLabel') }}</span>
      <select :value="selected" @change="onChange">
        <option :value="AUTO_VALUE">{{ t('analyzer.channelRole.auto') }}</option>
        <option v-for="channel in session.channels" :key="channel.name" :value="channel.name">
          {{ channel.name }}
        </option>
      </select>
    </label>
    <p v-if="selected !== AUTO_VALUE" class="applied-hint" role="status">
      {{ t('analyzer.channelRole.applied', { channel: selected }) }}
    </p>
  </div>
</template>

<style scoped>
.channel-role-picker {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.hint {
  margin: 0;
  font-size: var(--text-base);
  color: var(--color-text-muted);
}
.field {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--text-md);
  color: var(--color-text-muted);
}
.field select {
  min-width: 180px;
  max-width: 100%;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.applied-hint {
  margin: 0;
  font-size: var(--text-md);
  color: var(--color-accent);
}
</style>
