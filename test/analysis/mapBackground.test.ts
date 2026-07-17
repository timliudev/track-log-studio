import { describe, expect, it } from 'vitest'
import {
  MAX_BACKGROUND_IMAGE_BYTES,
  parseMapBackgroundSettings,
  validateBackgroundImage,
} from '@/domain/analysis/mapBackground'

describe('map background upload guard', () => {
  it('only permits bounded JPEG, PNG, WebP, and SVG uploads', () => {
    expect(validateBackgroundImage({ type: 'image/png', size: 1024 })).toBeNull()
    expect(validateBackgroundImage({ type: 'image/svg+xml', size: 1024 })).toBeNull()
    expect(validateBackgroundImage({ type: 'text/plain', size: 1024 })).toBe('type')
    expect(validateBackgroundImage({ type: 'image/jpeg', size: MAX_BACKGROUND_IMAGE_BYTES + 1 })).toBe('size')
  })

  it('sanitizes malformed persisted settings and clamps image scale', () => {
    expect(parseMapBackgroundSettings('{bad')).toMatchObject({ kind: 'none' })
    expect(parseMapBackgroundSettings(JSON.stringify({ kind: 'image', imageId: 'a', alignment: { x: 3, y: 4, scale: 99 } })))
      .toMatchObject({ kind: 'image', imageId: 'a', alignment: { x: 3, y: 4, scale: 8 } })
  })
})
