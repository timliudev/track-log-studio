/**
 * B39d — the app is reachable at two hosts that serve the exact same
 * Cloudflare Worker: the custom domain `tracklogstudio.timliudev.com`
 * (canonical, per docs/DESIGN.md §10) and the workers.dev default host that
 * every Worker gets for free. Search engines should only ever index the
 * former, and visitors/bookmarks on the latter should land on the former —
 * hence a 301 at the Worker layer rather than relying on `<link
 * rel="canonical">` alone (that only affects crawlers, not real navigation).
 *
 * Pure function: given the incoming request URL, return the redirect
 * Response, or `null` when the host isn't the duplicate one (the caller then
 * falls through to serving the static asset as normal). No I/O, no globals
 * read besides the input — easy to unit test without spinning up a Worker.
 */

/** The duplicate host every request should be redirected away from. */
export const WORKERS_DEV_HOST = 'track-log-studio.timliudev.workers.dev'

/** The canonical custom-domain origin requests are redirected to. */
export const CANONICAL_ORIGIN = 'https://tracklogstudio.timliudev.com'

/**
 * Build the 301 redirect for a workers.dev request, preserving the path,
 * query string, and fragment. Returns `null` when `url.hostname` isn't the
 * workers.dev duplicate host (including when it's already the canonical
 * host), so the caller knows to serve the asset instead.
 */
export function redirectWorkersDevToCanonical(url: URL): Response | null {
  if (url.hostname !== WORKERS_DEV_HOST) return null
  const target = new URL(url.pathname + url.search + url.hash, CANONICAL_ORIGIN)
  return Response.redirect(target.toString(), 301)
}
