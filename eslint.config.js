import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVitest from '@vitest/eslint-plugin'
import globals from 'globals'

// Flat config (ESLint 10). Built on the official create-vue shape
// (eslint-plugin-vue + @vue/eslint-config-typescript) with a deliberately
// lenient "green baseline" so first-time adoption on the existing codebase
// stays (near-)clean. Tighten rules incrementally over time.
export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue,js,mjs,cjs}'],
  },

  {
    name: 'app/files-to-ignore',
    ignores: [
      '**/dist/**',
      '**/dist-ssr/**',
      '**/coverage/**',
      '**/dev-dist/**',
      '**/.wrangler/**',
      // Machine-local Claude Code tooling: nested git worktrees live here and
      // would otherwise be linted as duplicate copies of the whole tree.
      '**/.claude/**',
      'public/**',
      '**/*.d.ts',
    ],
  },

  // Plain JS/MJS (build scripts, config files): ESLint core recommended.
  {
    ...js.configs.recommended,
    name: 'app/js-recommended',
    files: ['**/*.{js,mjs,cjs}'],
  },

  // Vue 3 + TypeScript (app, tests, worker). Non-type-checked preset keeps
  // linting fast and avoids requiring a full type-graph on every run.
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  // Runtime globals available across the app / worker / node scripts.
  {
    name: 'app/language-options',
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
      },
    },
  },

  // Vitest rules, scoped to the test suite only.
  {
    ...pluginVitest.configs.recommended,
    name: 'app/test-files',
    files: ['test/**/*.{ts,mts}', '**/*.{test,spec}.{ts,mts}'],
  },

  // Green baseline: neutralise duplicate/high-frequency findings for now.
  {
    name: 'app/green-baseline',
    rules: {
      // Unused locals/params are already enforced by tsconfig
      // (noUnusedLocals / noUnusedParameters) — avoid double-reporting.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',

      // Ease-in: surface as warnings rather than errors during adoption.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',

      // Single-word SFC names are used throughout (App.vue, cards/*).
      'vue/multi-word-component-names': 'off',

      // The codebase already carries `eslint-disable no-console` markers, so
      // the intent is a no-console policy. Allow warn/error (legitimate
      // diagnostics); flag stray log/info/debug.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Build / benchmark / codegen scripts: console output is their purpose.
  {
    name: 'app/scripts',
    files: ['scripts/**/*.{ts,mts,js,mjs,cjs}'],
    rules: {
      'no-console': 'off',
    },
  },

  // Test-suite rule tuning (applied after the vitest preset above).
  {
    name: 'app/test-rules',
    files: ['test/**/*.{ts,mts}', '**/*.{test,spec}.{ts,mts}'],
    rules: {
      // Data-driven assertions inside for/if blocks are the house style for
      // real-log fixtures — this is intentional, not an anti-pattern here.
      'vitest/no-conditional-expect': 'off',
      // Keep visible but non-blocking.
      'vitest/no-commented-out-tests': 'warn',
      // Vitest supports the `expect(actual, message)` message form.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
    },
  },
)
