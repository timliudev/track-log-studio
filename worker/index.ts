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
 */
import { redirectWorkersDevToCanonical } from './redirect'

interface Env {
  /** Static-assets binding configured via `assets.binding` in wrangler.jsonc. */
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const redirect = redirectWorkersDevToCanonical(url)
    if (redirect) return redirect
    return env.ASSETS.fetch(request)
  },
}
