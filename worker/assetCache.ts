/**
 * B40 — PageSpeed flagged "使用有效的快取生命週期" (use an efficient cache
 * lifetime) for our content-hashed static assets. Vite emits every
 * chunk/CSS/font/image under `/assets/` with a content hash baked into the
 * filename (e.g. `/assets/AnalyzerView-CCsglJJ7.js`), which makes each such
 * URL content-addressed: the URL only ever changes when the content changes.
 * That means it's safe — and correct — to cache these responses forever
 * (`immutable`, one-year `max-age`) rather than relying on the Assets
 * Worker's default (much shorter) heuristic. Root-level files that are NOT
 * content-hashed (`/sw.js`, `/manifest.webmanifest`, `/index.html`,
 * `/robots.txt`, `/sitemap.xml`, the workbox runtime file) all live outside
 * `/assets/`, so a prefix check is sufficient to separate the two groups —
 * see `worker/index.ts` for where this is applied, including the
 * SPA-fallback guard that keeps this function's simplicity safe.
 */

/** Cache-Control applied to every immutable, content-hashed asset response. */
export const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/**
 * True iff `pathname` is one of Vite's content-hashed build outputs, i.e.
 * starts with `/assets/`. Content-hashing means the fingerprint in the
 * filename changes whenever the file's content changes, so a URL matching
 * this check can be cached for an effectively infinite TTL without ever
 * serving stale content. Pure string check — never throws.
 */
export function isImmutableAssetPath(pathname: string): boolean {
  return pathname.startsWith('/assets/')
}
