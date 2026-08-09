<script setup lang="ts">
import { useI18n } from 'vue-i18n'

export type NavTab = 'converter' | 'analyzer' | 'settings'

defineProps<{
  tab: NavTab
}>()

const emit = defineEmits<{
  (e: 'update:tab', value: NavTab): void
}>()

const { t } = useI18n()

// Inline SVGs (not emoji/Unicode glyphs) so all three tabs share the exact
// same icon family — same viewBox, stroke width and line-cap style, and
// they inherit `color` via currentColor so the active/inactive tint applies
// uniformly. Before this, analyzer used the 📈 emoji, which renders as a
// fixed-color multi-tone glyph and visibly clashed with the other two
// monoline symbol icons (#20).
const items: { id: NavTab; labelKey: string }[] = [
  { id: 'converter', labelKey: 'nav.converter' },
  { id: 'analyzer', labelKey: 'nav.analyzer' },
  { id: 'settings', labelKey: 'nav.settings' },
]
</script>

<template>
  <nav class="bottom-nav" :aria-label="t('nav.mainLabel')">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="bottom-nav__tab no-press"
      :class="{ active: tab === item.id }"
      :aria-current="tab === item.id ? 'page' : undefined"
      @click="emit('update:tab', item.id)"
    >
      <svg
        v-if="item.id === 'converter'"
        class="bottom-nav__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M7 4 3 8l4 4" />
        <path d="M3 8h13" />
        <path d="M17 12l4 4-4 4" />
        <path d="M21 16H8" />
      </svg>
      <svg
        v-else-if="item.id === 'analyzer'"
        class="bottom-nav__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M7 16l4-5 3 3 5-7" />
      </svg>
      <svg
        v-else
        class="bottom-nav__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
      <span class="bottom-nav__label">{{ t(item.labelKey) }}</span>
    </button>
  </nav>
</template>

<style scoped>
.bottom-nav {
  display: none;
}

@media (max-width: 768px) {
  .bottom-nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    align-items: stretch;
    justify-content: space-around;
    gap: 2px;
    padding: 4px 6px calc(env(safe-area-inset-bottom, 0px) + 4px);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    -webkit-backdrop-filter: blur(14px) saturate(150%);
    backdrop-filter: blur(14px) saturate(150%);
    border-top: 1px solid var(--color-border);
    box-shadow: var(--shadow-nav);
  }
}

/* B119 — 這支列本身是全庫唯一一處半透明材質(88% surface + blur 14 +
   saturate 150%),做對了(見 docs/ISSUES.md B119 條目)。`prefers-reduced-
   transparency` 是可及性偏好(部分使用者對半透明/模糊背景會不適,或裝置
   效能不足以流暢算 backdrop-filter),命中時直接退回不透明實色列 —— 這是
   本檔案自己的 scoped 區塊,而非 theme.css 統一處理,因為 backdrop-filter
   這個材質層本來就只有這支列在用,屬於它自己的職責。 */
@media (prefers-reduced-transparency: reduce) {
  .bottom-nav {
    background: var(--color-surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

.bottom-nav__tab {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 44px;
  min-width: 44px;
  padding: 6px 4px;
  background: none;
  border: none;
  border-radius: var(--radius);
  font: inherit;
  color: var(--color-text-muted);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    color var(--dur-fast) ease,
    transform var(--dur-fast) ease;
}

/* B115 — 這支列比 theme.css 的全域 button:active 更早就有自己的按下回饋
   (scale 0.94,經過觸控手感調過),模板上特意加了 `.no-press` 逃生艙把全域
   那條(scale 0.97)排除掉 —— 不是因為這支按鈕本身有拖曳/canvas 定位風險,
   純粹是特異度問題:全域規則帶了 `button` 元素選擇器,比這裡純 class 組成
   的選擇器特異度還高(即使算上 Vue scoped 附加的 data-v 屬性選擇器),不排
   除就會被兩個不同的縮放值打架、且贏的還不是這裡刻意調過的 0.94。 */
.bottom-nav__tab:active {
  transform: scale(0.94);
}

.bottom-nav__tab.active {
  color: var(--color-accent);
}

.bottom-nav__tab:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.bottom-nav__icon {
  width: 22px;
  height: 22px;
}

.bottom-nav__label {
  font-size: var(--text-xs);
  /* M17 — 密集小字略放字距(tracking-wide),與大標的收緊(tracking-tight)
     方向相反,對應 Apple「字距隨字級變化」而非全域套一個值的準則。 */
  letter-spacing: var(--tracking-wide);
  line-height: 1;
  font-weight: 500;
}
</style>
