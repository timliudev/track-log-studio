// Browser plumbing shared by capture.mjs.
//
// puppeteer-core (NOT puppeteer) on purpose: no bundled-Chromium download —
// it drives the Chrome already installed on the machine. It is not a project
// dependency either; install it on demand:  npm i --no-save puppeteer-core
import { existsSync } from 'node:fs'

/** Where the dev server is expected. Override with MANUAL_SHOTS_URL. */
export const URL = process.env.MANUAL_SHOTS_URL ?? 'http://localhost:5180/'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA.replaceAll('\\', '/')}/Google/Chrome/Application/chrome.exe`
    : null,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

export function chromePath() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!found) {
    throw new Error(
      `No Chrome executable found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
    )
  }
  return found
}

async function puppeteer() {
  try {
    return (await import('puppeteer-core')).default
  } catch {
    throw new Error('puppeteer-core is not installed. Run: npm i --no-save puppeteer-core')
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch(viewport = { width: 1280, height: 800 }) {
  const pptr = await puppeteer()
  const browser = await pptr.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // 1x pixels: the manual does not need retina-weight PNGs
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
    ],
    defaultViewport: viewport,
  })
  const page = await browser.newPage()
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(1500)
  return { browser, page }
}

// Both importers below build a DataTransfer in-page and dispatch a real
// `change` event on the app's hidden `<input type=file>` — the same path a
// user's file picker takes.

/** Import repo files by absolute path, fetched over vite dev's `/@fs/` channel. */
export async function importFixtures(page, absPaths) {
  await page.evaluate(async (paths) => {
    const dt = new DataTransfer()
    for (const p of paths) {
      const res = await fetch('/@fs/' + p)
      const buf = await res.arrayBuffer()
      dt.items.add(new File([buf], p.split('/').pop(), { type: 'application/octet-stream' }))
    }
    const input = document.querySelector('input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, absPaths)
  await sleep(4500)
}

/** Import in-memory text files: `[{ name, text }]`. */
export async function importText(page, files) {
  await page.evaluate((list) => {
    const dt = new DataTransfer()
    for (const f of list) dt.items.add(new File([f.text], f.name, { type: 'text/csv' }))
    const input = document.querySelector('input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, files)
  await sleep(5000)
}

/** Switch top-level tab by its visible label (the app is captured in zh-Hant). */
export async function clickTab(page, label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('nav.tabs button.tab')].find(
      (b) => b.textContent.trim() === l,
    )
    btn?.click()
  }, label)
  await sleep(2500)
}
