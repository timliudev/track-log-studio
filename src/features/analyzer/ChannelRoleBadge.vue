<script setup lang="ts">
/**
 * B134 defect 2 (coordinator review) — a correction control for a role that
 * DID resolve, but via a guess (`source: 'override' | 'heuristic'`) rather
 * than our own formats' unambiguous canonical lookup.
 *
 * Before this component, the ONLY place a user could touch the channel-role
 * mapping was `ChannelRolePicker.vue`'s "缺少 X 頻道" empty state — which
 * disappears the instant resolution succeeds. That's fine when it succeeded
 * via the canonical step (nothing to correct, nothing to show), but wrong
 * for `'override'`/`'heuristic'`: a user who picked the wrong channel, or
 * whose channel the heuristic auto-guessed incorrectly, would have had NO
 * way back to the picker short of clearing localStorage. This renders one
 * muted, always-visible line — "轉速：EngineRPM_rpm（自動判定）· 變更" — that
 * expands into the SAME `ChannelRolePicker` select on click, rather than
 * duplicating its logic.
 *
 * A `source: 'canonical'` resolution should never reach this component —
 * callers gate on `source !== 'canonical'` before rendering it, so RPM/speed
 * for every existing supported format shows nothing extra here.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import type { ChannelRole } from '@/domain/analysis/channelRoles'
import ChannelRolePicker from './ChannelRolePicker.vue'

const props = defineProps<{
  session: LogSession
  role: ChannelRole
  /** The channel name currently in use for `role` (from
   *  `resolveRoleChannelDetailed`'s `.name`). */
  channelName: string
  /** Restricted to the two guess sources — a 'canonical' resolution should
   *  never be passed in (see the module header comment). */
  source: 'override' | 'heuristic'
}>()

const { t } = useI18n()
const expanded = ref(false)

const roleLabelKey: Record<ChannelRole, string> = {
  rpm: 'analyzer.channelRole.roleRpm',
  speed: 'analyzer.channelRole.roleSpeed',
  gear: 'analyzer.channelRole.roleGear',
}
const sourceLabelKey: Record<'override' | 'heuristic', string> = {
  override: 'analyzer.channelRole.sourceOverride',
  heuristic: 'analyzer.channelRole.sourceHeuristic',
}

const summary = computed(() =>
  t('analyzer.channelRole.summary', {
    role: t(roleLabelKey[props.role]),
    channel: props.channelName,
    source: t(sourceLabelKey[props.source]),
  }) as string,
)
</script>

<template>
  <ChannelRolePicker v-if="expanded" :session="session" :role="role" :message="summary" />
  <p v-else class="channel-role-badge">
    {{ summary }}
    <button type="button" class="change-link" @click="expanded = true">
      {{ t('analyzer.channelRole.change') }}
    </button>
  </p>
</template>

<style scoped>
.channel-role-badge {
  margin: 0;
  font-size: var(--text-md);
  color: var(--color-text-muted);
}
.change-link {
  background: none;
  border: none;
  padding: 0;
  margin-left: 4px;
  font: inherit;
  color: var(--color-accent);
  cursor: pointer;
  text-decoration: underline;
}
.change-link:hover {
  color: var(--color-text);
}
</style>
