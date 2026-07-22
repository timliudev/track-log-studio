import { describe, it, expect } from 'vitest'
import { isImmutableAssetPath, IMMUTABLE_ASSET_CACHE_CONTROL } from '../../worker/assetCache'
import worker from '../../worker/index'
import { CANONICAL_ORIGIN } from '../../worker/redirect'

describe('isImmutableAssetPath', () => {
  it.each([
    '/assets/x-HASH.js',
    '/assets/x-HASH.css',
    '/assets/font-HASH.woff2',
    '/assets/sub/thing-HASH.png',
  ])('is true for content-hashed asset path %s', (pathname) => {
    expect(isImmutableAssetPath(pathname)).toBe(true)
  })

  it.each([
    '/',
    '/index.html',
    '/sw.js',
    '/manifest.webmanifest',
    '/workbox-2ff6bd68.js',
    '/robots.txt',
    '/sitemap.xml',
    '/assets',
    '',
  ])('is false for non-asset path %s', (pathname) => {
    expect(isImmutableAssetPath(pathname)).toBe(false)
  })
})

/** Minimal stub of the `env.ASSETS` binding: returns a preconfigured Response. */
function stubAssets(response: Response) {
  return { fetch: async () => response }
}

describe('worker default export fetch — B40 immutable asset caching', () => {
  it('stamps the immutable Cache-Control on a 200 content-hashed asset response', async () => {
    const upstream = new Response('console.log(1)', {
      status: 200,
      headers: { 'content-type': 'application/javascript' },
    })
    const request = new Request(`${CANONICAL_ORIGIN}/assets/app-HASH.js`)
    const env = { ASSETS: stubAssets(upstream) }

    const res = await worker.fetch(request, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE_ASSET_CACHE_CONTROL)
    expect(await res.text()).toBe('console.log(1)')
  })

  it('does not stamp immutable Cache-Control on non-asset paths (e.g. /sw.js)', async () => {
    const upstream = new Response('self.addEventListener(...)', {
      status: 200,
      headers: { 'content-type': 'application/javascript' },
    })
    const request = new Request(`${CANONICAL_ORIGIN}/sw.js`)
    const env = { ASSETS: stubAssets(upstream) }

    const res = await worker.fetch(request, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).not.toBe(IMMUTABLE_ASSET_CACHE_CONTROL)
  })

  it('does not stamp immutable on an SPA-fallback text/html 200 for a missing hashed asset', async () => {
    const upstream = new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
    const request = new Request(`${CANONICAL_ORIGIN}/assets/missing-HASH.js`)
    const env = { ASSETS: stubAssets(upstream) }

    const res = await worker.fetch(request, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).not.toBe(IMMUTABLE_ASSET_CACHE_CONTROL)
    expect(await res.text()).toBe('<!doctype html><html></html>')
  })

  it('preserves status and body for a non-200 asset response without stamping immutable', async () => {
    const upstream = new Response('not found', { status: 404 })
    const request = new Request(`${CANONICAL_ORIGIN}/assets/gone-HASH.js`)
    const env = { ASSETS: stubAssets(upstream) }

    const res = await worker.fetch(request, env)

    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).not.toBe(IMMUTABLE_ASSET_CACHE_CONTROL)
    expect(await res.text()).toBe('not found')
  })
})
