/**
 * Third-party open-source license inventory for the "About" page (#16).
 *
 * Curated manually (not from memory) by reading each package's own
 * `node_modules/<pkg>/package.json` `license` field. Covers every entry in
 * this repo's package.json `dependencies` (the app's actual runtime
 * dependencies) plus two build-time packages whose generated code still
 * ships into the production output:
 *   - vite-plugin-pwa: generates the Workbox-based service worker that
 *     ships with every build (App.vue's PWA install/offline support).
 *   - interactjs: pulled in transitively by grid-layout-plus to power the
 *     dashboard's drag/resize interactions (see AnalyzerView's dashboard
 *     grid, #8) — its runtime code is genuinely bundled and exercised, just
 *     not `import`ed directly by our own source.
 *
 * Maintenance: when a listed package is upgraded (or a new runtime
 * dependency is added to package.json), update the matching entry's
 * `version`/`license` here. `test/units/licenses.test.ts` cross-checks this
 * list against package.json's `dependencies` so a forgotten update fails
 * the test suite instead of silently going stale.
 */
export interface ThirdPartyLicense {
  /** npm package name. */
  name: string
  /** Version currently installed (see node_modules/<name>/package.json). */
  version: string
  /** SPDX license identifier as declared by the package itself. */
  license: string
  /** Canonical reference link (npm package page). */
  url: string
  /** Optional i18n key (under about.licenses.notes.<noteKey>) explaining why a non-obvious entry is listed. */
  noteKey?: string
}

export const thirdPartyLicenses: ThirdPartyLicense[] = [
  { name: 'vue', version: '3.5.39', license: 'MIT', url: 'https://www.npmjs.com/package/vue' },
  {
    name: 'vue-i18n',
    version: '11.4.6',
    license: 'MIT',
    url: 'https://www.npmjs.com/package/vue-i18n',
  },
  { name: 'pinia', version: '3.0.4', license: 'MIT', url: 'https://www.npmjs.com/package/pinia' },
  {
    name: 'echarts',
    version: '6.1.0',
    license: 'Apache-2.0',
    url: 'https://www.npmjs.com/package/echarts',
  },
  { name: 'uplot', version: '1.6.32', license: 'MIT', url: 'https://www.npmjs.com/package/uplot' },
  {
    name: 'grid-layout-plus',
    version: '1.1.1',
    license: 'MIT',
    url: 'https://www.npmjs.com/package/grid-layout-plus',
  },
  {
    name: 'sql.js',
    version: '1.14.1',
    license: 'MIT',
    url: 'https://www.npmjs.com/package/sql.js',
  },
  {
    name: 'fflate',
    version: '0.8.3',
    license: 'MIT',
    url: 'https://www.npmjs.com/package/fflate',
  },
  { name: 'idb', version: '8.0.3', license: 'ISC', url: 'https://www.npmjs.com/package/idb' },
  {
    name: 'vite-plugin-pwa',
    version: '1.3.0',
    license: 'MIT',
    url: 'https://www.npmjs.com/package/vite-plugin-pwa',
    noteKey: 'vitePluginPwa',
  },
  {
    name: 'interactjs',
    version: '1.10.27',
    license: 'MIT',
    url: 'https://www.npmjs.com/package/interactjs',
    noteKey: 'interactjs',
  },
]
