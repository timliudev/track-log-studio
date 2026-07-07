import { onMounted, ref, type Ref } from 'vue'

/**
 * Fetches a public GitHub repo's star count for the header's GitHub button,
 * with a localStorage cache so a returning visitor sees a number immediately
 * (no flash of "no count") and the app doesn't re-hit the unauthenticated
 * GitHub API (60 req/hr per IP, shared across every visitor behind the same
 * NAT/office network) on every single page load.
 *
 * Fully optional and best-effort: offline, a network failure, or a rate-limit
 * response all resolve to `null` silently (no thrown error, no console
 * noise) — the caller (GithubStarButton) falls back to icon-only / a plain
 * "Star" label, never a broken UI.
 */

const CACHE_KEY_PREFIX = 'gh-stars:'
// Generous TTL: a star count is a "nice to have", not data anyone needs
// fresh-to-the-minute, and this keeps a whole day's visitors to one shared
// cache-refresh worth of API calls instead of one per load.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface Cached {
  count: number
  ts: number
}

function readCache(repo: string): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + repo)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Cached>
    if (typeof parsed.count !== 'number' || typeof parsed.ts !== 'number') return null
    return parsed as Cached
  } catch {
    return null
  }
}

function writeCache(repo: string, count: number): void {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + repo, JSON.stringify({ count, ts: Date.now() }))
  } catch {
    // localStorage unavailable (private mode / quota) — degrade to in-memory only.
  }
}

/**
 * `repo` is `"owner/name"` (GitHub API's own path shape), e.g.
 * `"timliudev/track-log-studio"`.
 */
export function useGithubStars(repo: string): { stars: Ref<number | null> } {
  const cached = readCache(repo)
  const stars = ref<number | null>(cached?.count ?? null)

  async function refresh(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) return
      const data = (await res.json()) as { stargazers_count?: unknown }
      if (typeof data.stargazers_count === 'number') {
        stars.value = data.stargazers_count
        writeCache(repo, data.stargazers_count)
      }
    } catch {
      // Offline, CORS, DNS, rate-limited — keep whatever the cache already gave us.
    }
  }

  onMounted(() => {
    const isStale = !cached || Date.now() - cached.ts > CACHE_TTL_MS
    if (isStale) void refresh()
  })

  return { stars }
}
