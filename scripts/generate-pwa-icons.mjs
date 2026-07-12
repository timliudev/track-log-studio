// Rasterise the app logo (public/app-icon.svg) into the concrete PNG icon set
// PWAs need for broad install support. `vite-plugin-pwa`'s manifest and
// index.html's apple-touch-icon previously pointed at scalable SVG ("sizes:
// any"), which most installers accept, but some (older Android installers,
// app-store-style PWA listings, and iOS Safari's "Add to Home Screen") still
// expect concrete raster sizes — hence this one-off generation script.
//
// Produces, all under public/:
//   pwa-192x192.png          192x192, purpose "any"
//   pwa-512x512.png          512x512, purpose "any"
//   pwa-maskable-512x512.png 512x512, purpose "maskable" (padded safe zone)
//   apple-touch-icon.png     180x180, opaque background (iOS)
//   favicon-32x32.png        32x32, PNG fallback for browsers without SVG
//                            favicon support
//
// The source artwork (a red lap-trace squiggle + apex dot on a dark rounded
// square, see public/app-icon.svg) is reused for the "any"/apple/favicon
// variants as-is. The maskable variant re-renders just the squiggle+dot at
// ~70% scale, centered on a corner-less full-bleed background square, so the
// artwork survives being clipped to a circle/squircle by the OS icon mask
// (maskable spec: content must fit the inner 80%-diameter "safe zone"
// circle — see https://www.w3.org/TR/appmanifest/#dfn-safe-zone. 70% scale of
// this bounding box leaves a comfortable margin inside that circle).
//
// Usage: node scripts/generate-pwa-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(root, 'public')

const BG = '#0f1115'
const ACCENT = '#e23b3b'

// Same path/circle as public/app-icon.svg's 512x512 viewBox, reused verbatim
// so every generated icon matches the app's actual logo pixel-for-pixel.
const LOGO_MARK = `
  <path
    d="M96 360 L208 150 L264 290 L312 190 L416 360"
    fill="none"
    stroke="${ACCENT}"
    stroke-width="34"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
  <circle cx="416" cy="360" r="26" fill="${ACCENT}" />
`

// "any" purpose: identical to public/app-icon.svg (dark rounded-square
// background, full-size mark) — just rasterised at concrete sizes.
function anySvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="96" fill="${BG}" />
    ${LOGO_MARK}
  </svg>`
}

// "maskable" purpose: edge-to-edge background (no baked-in corner rounding —
// the OS applies its own mask shape) with the mark scaled into the safe
// zone. Bounding box of the mark above (incl. stroke half-width and the apex
// circle) is x:[79,442] y:[133,386], center (260.5, 259.5); scaling that
// bbox by 0.7 about its own center keeps every corner within the safe-zone
// circle (radius 204.8 @ 512px canvas) with margin to spare.
function maskableSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${BG}" />
    <g transform="translate(256 256) scale(0.7) translate(-260.5 -259.5)">
      ${LOGO_MARK}
    </g>
  </svg>`
}

// apple-touch-icon: iOS applies its own squircle mask and doesn't handle
// source transparency well, so reuse the maskable (full-bleed, safe-zone
// padded) artwork rather than the rounded-square "any" version, which would
// otherwise show a double-rounded-corner artifact under iOS's own mask.
function appleTouchSvg() {
  return maskableSvg()
}

async function renderPng(svg, size, outPath) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outPath)
  console.log(`wrote ${outPath.replace(root, '.')} (${size}x${size})`)
}

async function main() {
  // Sanity-check the source logo still matches what this script assumes,
  // so a future logo change doesn't silently make these icons stale.
  const sourceSvg = readFileSync(resolve(publicDir, 'app-icon.svg'), 'utf8')
  if (!sourceSvg.includes('M96 360 L208 150 L264 290 L312 190 L416 360')) {
    throw new Error(
      'public/app-icon.svg path data has changed — update scripts/generate-pwa-icons.mjs LOGO_MARK to match before regenerating icons.',
    )
  }

  await renderPng(anySvg(), 192, resolve(publicDir, 'pwa-192x192.png'))
  await renderPng(anySvg(), 512, resolve(publicDir, 'pwa-512x512.png'))
  await renderPng(maskableSvg(), 512, resolve(publicDir, 'pwa-maskable-512x512.png'))
  await renderPng(appleTouchSvg(), 180, resolve(publicDir, 'apple-touch-icon.png'))
  await renderPng(anySvg(), 32, resolve(publicDir, 'favicon-32x32.png'))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
