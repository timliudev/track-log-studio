import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as vueCompiler from 'vue/compiler-sfc'
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
      // Give the plugin a compiler before its build-start hook. During a cold
      // dependency optimisation, the file watcher can otherwise receive an
      // HMR event while the plugin's compiler slot is still null.
      vue({ compiler: vueCompiler }),
      VitePWA({
        // 'prompt': an update-available toast is now wired (see
        // src/composables/usePwaUpdate.ts + src/components/PwaUpdateToast.vue),
        // so a new build no longer needs to silently self-apply — the user is
        // told a new version is ready and reloads on their own terms (avoids
        // yanking state out from under someone mid-session, e.g. mid-import).
        registerType: 'prompt',
        // We register the service worker ourselves via `virtual:pwa-register`
        // (see main.ts) so the custom toast can hook onNeedRefresh/onOfflineReady
        // instead of the plugin's own injected (invisible) auto-registration.
        injectRegister: false,
        // App shell + assets are precached; large .loga files are user-provided at
        // runtime and never cached.
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
          // These chunks are intentionally dynamic-import()ed (see
          // ScatterChart.vue's GgChart/Scatter3dChart loaders and
          // parseRcnx.ts's sql.js loader) so they never block the initial
          // page render — but GenerateSW's default globPatterns precaches EVERY built asset
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
            '**/Scatter3dChart-*.js',
            '**/Scatter3dChart-*.css',
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
              urlPattern: /\/assets\/(GgChart|Scatter3dChart|sql-wasm)-.*\.(js|css|wasm)$/,
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
          // Rasterised PNGs (generated from public/app-icon.svg by
          // scripts/generate-pwa-icons.mjs — re-run that script if the logo
          // ever changes) for the broadest install support: some
          // installers/stores still expect concrete PNG sizes rather than a
          // scalable "any" icon. The SVG stays listed too as a crisp
          // any-size fallback for installers that DO support it. Maskable is
          // its own dedicated PNG (safe-zone padded) rather than reusing the
          // "any" art, so a maskable-aware installer doesn't clip artwork
          // that has no safe-zone padding baked in.
          icons: [
            {
              src: 'app-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
      // B39d: `cloudflare()` now builds worker/index.ts as a real Worker
      // environment (wrangler.jsonc gained a `main` entry for the
      // workers.dev->custom-domain redirect). That extra environment's
      // config is incompatible with the plain-node Vitest run below (its
      // `resolve.external` node-builtins list trips the plugin's own
      // validation) — and Vitest doesn't need it anyway, since
      // worker/redirect.ts is tested as a plain pure function. Skip the
      // plugin under `vitest` (which sets `process.env.VITEST`); it still
      // runs for `vite dev`/`vite build`/`wrangler dev`.
      ...(process.env.VITEST ? [] : [cloudflare()]),
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
