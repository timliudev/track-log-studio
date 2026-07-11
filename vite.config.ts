import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
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
export default defineConfig(({ mode }) => {
  // loadEnv reads .env / .env.local / .env.[mode].local (gitignored) into a
  // plain object — needed because THIS config file runs in Node before Vite's
  // own client-side import.meta.env replacement exists, so process.env alone
  // wouldn't see .env.local's contents.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      VitePWA({
        // autoUpdate (was 'prompt' but the update-prompt UI was never wired, so
        // returning visitors got stuck on the first cached build). During rapid
        // continuous deploys we want new builds to apply automatically on next
        // load instead of serving a stale service-worker cache.
        registerType: 'autoUpdate',
        // App shell + assets are precached; large .loga files are user-provided at
        // runtime and never cached.
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
          // These two chunks are intentionally dynamic-import()ed (see
          // ScatterChart.vue's GgChart loader and parseRcnx.ts's sql.js
          // loader) so they never block the initial page render — but
          // GenerateSW's default globPatterns precaches EVERY built asset
          // regardless of how it's loaded at runtime, which silently
          // re-eagerfies them: the service worker would fetch both
          // (~480 kB echarts + ~700 kB sql.js/wasm, combined over 1 MB)
          // during install, on every visitor, even those who never open
          // the G-G chart or import an RCNX file. Excluding them here and
          // letting the runtimeCaching rule below cache-on-first-actual-use
          // keeps the precache (and PWA install/update payload) to just the
          // app shell, matching the code-splitting intent.
          globIgnores: [
            '**/GgChart-*.js',
            '**/GgChart-*.css',
            '**/sql-wasm-*.js',
            '**/sql-wasm-*.wasm',
          ],
          runtimeCaching: [
            {
              // Content-hashed filenames (immutable per build) — safe to
              // cache indefinitely once actually requested. GgChart also
              // emits a split CSS chunk (its own <style> imports), which
              // must be excluded from precache and caught here exactly like
              // its .js chunk — otherwise it would be silently re-eagerfied
              // via the default {js,css,...} globPattern above.
              urlPattern: /\/assets\/(GgChart|sql-wasm)-.*\.(js|css|wasm)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'lazy-chunks',
                expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },
        manifest: {
          id: '/',
          name: 'Track Log Studio',
          short_name: 'TrackLogStudio',
          description:
            'Track Log Studio — multi-format track telemetry analysis: import ECU and GPS logger recordings, convert between formats, and analyse laps & telemetry.',
          lang: 'zh-Hant',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#0f1115',
          theme_color: '#0f1115',
          categories: ['utilities', 'sports'],
          // SVG icons for Phase 0 — replace with rasterised PNG (192/512 +
          // a padded maskable variant) before production for the broadest
          // install support (some installers/stores still expect concrete
          // PNG sizes rather than a scalable "any" icon). Split into two
          // entries (rather than one "any maskable" icon) so a maskable-aware
          // installer doesn't apply an OS icon mask to art that has no
          // maskable safe-zone padding baked in.
          icons: [
            {
              src: 'app-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: 'app-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'maskable',
            },
          ],
        },
      }),
      cloudflare(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    worker: {
      format: 'es',
    },
    server: {
      // Vite blocks unrecognised Host headers by default (DNS-rebinding guard).
      // When testing from a phone over LAN by hostname (mDNS/Windows computer
      // name) rather than IP, that hostname needs allowlisting — but a personal
      // machine name has no place in this PUBLIC repo, so it's read from a
      // gitignored `.env.local` (VITE_DEV_ALLOWED_HOSTS=comma,separated,hosts)
      // instead of hardcoded here. Unset → vite's own default (localhost only).
      allowedHosts: env.VITE_DEV_ALLOWED_HOSTS
        ? env.VITE_DEV_ALLOWED_HOSTS.split(',').map((h) => h.trim())
        : undefined,
    },
    define: {
      __BUILD_SHA__: JSON.stringify(buildSha()),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    test: {
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  }
})
