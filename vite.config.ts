import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * Short commit hash for the footer build stamp. CI/CD provides it via env
 * (Cloudflare Pages `CF_PAGES_COMMIT_SHA`, GitHub Actions `GITHUB_SHA`); local
 * builds fall back to reading git directly, so the stamp is a real commit hash
 * everywhere instead of a literal "dev". Since we ship continuously without
 * release tags, this commit hash IS the deployed version identifier.
 */
function buildSha(): string {
  const fromEnv =
    process.env.WORKERS_CI_COMMIT_SHA ?? // Cloudflare Workers Builds
    process.env.CF_PAGES_COMMIT_SHA ?? // Cloudflare Pages
    process.env.GITHUB_SHA // GitHub Actions
  if (fromEnv) return fromEnv.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

// Note: defineConfig from 'vitest/config' extends Vite's config with the `test`
// field, so the unit-test setup lives alongside the build setup in one file.
export default defineConfig({
  plugins: [vue(), VitePWA({
    // autoUpdate (was 'prompt' but the update-prompt UI was never wired, so
    // returning visitors got stuck on the first cached build). During rapid
    // continuous deploys we want new builds to apply automatically on next
    // load instead of serving a stale service-worker cache.
    registerType: 'autoUpdate',
    // App shell + assets are precached; large .loga files are user-provided at
    // runtime and never cached.
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
    },
    manifest: {
      name: 'Track Log Studio',
      short_name: 'TrackLogStudio',
      description:
        'Track Log Studio — convert aRacer ECU .loga logs to RaceChrono .nmea and analyse laps & telemetry.',
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
  }), cloudflare()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})