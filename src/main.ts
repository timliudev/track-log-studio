import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { i18n } from '@/i18n'
import { initDiagnostics } from '@/debug/diagnostics'
import { vTooltip } from '@/directives/tooltip'
import '@/theme/theme.css'

// On-device diagnostics for the Android #11 reload bug. Self-gates on ?debug=1;
// initialised first so it catches errors even if app mount throws.
initDiagnostics()

createApp(App).use(createPinia()).use(i18n).directive('tooltip', vTooltip).mount('#app')
