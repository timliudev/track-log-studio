import { describe, it, expect } from 'vitest'
import {
  redirectWorkersDevToCanonical,
  WORKERS_DEV_HOST,
  CANONICAL_ORIGIN,
} from '../../worker/redirect'

describe('redirectWorkersDevToCanonical', () => {
  it('redirects the workers.dev root with a 301 to the canonical origin', () => {
    const res = redirectWorkersDevToCanonical(new URL(`https://${WORKERS_DEV_HOST}/`))

    expect(res).not.toBeNull()
    expect(res?.status).toBe(301)
    expect(res?.headers.get('location')).toBe(`${CANONICAL_ORIGIN}/`)
  })

  it('preserves path and query string on redirect', () => {
    const res = redirectWorkersDevToCanonical(
      new URL(`https://${WORKERS_DEV_HOST}/analyzer?tab=laps&id=42`),
    )

    expect(res?.status).toBe(301)
    expect(res?.headers.get('location')).toBe(`${CANONICAL_ORIGIN}/analyzer?tab=laps&id=42`)
  })

  it('preserves a fragment on redirect', () => {
    const res = redirectWorkersDevToCanonical(new URL(`https://${WORKERS_DEV_HOST}/manual#6.1`))

    expect(res?.headers.get('location')).toBe(`${CANONICAL_ORIGIN}/manual#6.1`)
  })

  it('returns null for the canonical host itself (no redirect loop)', () => {
    const res = redirectWorkersDevToCanonical(new URL(`${CANONICAL_ORIGIN}/`))
    expect(res).toBeNull()
  })

  it('returns null for unrelated hosts (e.g. local dev)', () => {
    const res = redirectWorkersDevToCanonical(new URL('http://localhost:8787/'))
    expect(res).toBeNull()
  })
})
