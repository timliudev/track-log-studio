/**
 * Cloudflare Worker entry point (B39d). The app is otherwise a pure static
 * SPA/PWA served straight from `dist/` (see docs/DESIGN.md §10) — this
 * script exists solely to 301-redirect the workers.dev duplicate host to the
 * canonical custom domain before falling through to the static assets. See
 * `redirect.ts` for the (unit-tested) redirect logic itself.
 *
 * `assets.run_worker_first: true` in wrangler.jsonc is required for this to
 * see every request: by default the Assets Worker serves matching files
 * *before* this Worker ever runs, so the host check below would never fire
 * for e.g. `/` or any other asset path.
 *
 * The same `run_worker_first` setting is also why this Worker can post-process
 * the asset response for B40: it stamps a long-lived, `immutable`
 * Cache-Control onto Vite's content-hashed `/assets/*` files (see
 * `assetCache.ts` for why that's safe) so repeat visits don't re-download
 * them. That rewrite is guarded to skip `text/html` responses — with
 * `not_found_handling: single-page-application`, a request for an
 * old/no-longer-existing hashed asset (a stale client after a deploy) falls
 * back to serving `index.html` with a 200 status, and we must never stamp
 * `immutable` on that HTML served under what looks like a JS/CSS URL.
 */
import { redirectWorkersDevToCanonical } from './redirect'
import { IMMUTABLE_ASSET_CACHE_CONTROL, isImmutableAssetPath } from './assetCache'

interface Env {
  /** Static-assets binding configured via `assets.binding` in wrangler.jsonc. */
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const redirect = redirectWorkersDevToCanonical(url)
    if (redirect) return redirect

    const response = await env.ASSETS.fetch(request)

    const contentType = response.headers.get('content-type') ?? ''
    if (
      isImmutableAssetPath(url.pathname) &&
      response.status === 200 &&
      !contentType.startsWith('text/html')
    ) {
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', IMMUTABLE_ASSET_CACHE_CONTROL)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    return response
  },
}
