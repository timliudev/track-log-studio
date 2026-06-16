import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// Note: defineConfig from 'vitest/config' extends Vite's config with the `test`
// field, so the unit-test setup lives alongside the build setup in one file.
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      // App shell + assets are precached; large .loga files are user-provided at
      // runtime and never cached.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      manifest: {
        name: 'aRacer Loga Analysis',
        short_name: 'LogaAnalysis',
        description:
          'Parse aRacer ECU .loga logs: convert to RaceChrono .nmea and analyse laps & telemetry.',
        lang: 'zh-Hant',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        // SVG icon for Phase 0 — replace with rasterised PNG (192/512 +
        // maskable) before production for the broadest install support.
        icons: [
          {
            src: 'app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
