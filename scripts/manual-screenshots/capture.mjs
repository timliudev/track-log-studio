// Capture the user-manual screenshots into docs/manual/images/ (M4).
//
// Prerequisites:
//   1. the dev server is running   (npm run dev  → http://localhost:5180/,
//      or set MANUAL_SHOTS_URL)
//   2. npm i --no-save puppeteer-core   (drives the installed Chrome; set
//      CHROME_PATH if it is somewhere unusual)
//
// Usage:
//   node scripts/manual-screenshots/capture.mjs [outDir] [pass]
//   pass ∈ converter | analyzer | multi | settings | mobile (default: all)
//
// The app is captured in its default appearance (dark theme, zh-Hant); the
// English manual embeds the SAME images on purpose.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, importText, importFixtures, clickTab, sleep, URL } from './lib.mjs'
import { buildDemoCsv } from './demoLog.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = process.argv[2] ?? resolve(root, 'docs/manual/images')
// Forward slashes: this path is handed to vite dev's /@fs/ channel.
const FIXTURES = resolve(root, 'test/fixtures').replaceAll('\\', '/') + '/'
mkdirSync(OUT, { recursive: true })

const shots = []
async function shot(page, name, opts = {}) {
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path, ...opts })
  shots.push(name)
  console.log('  shot', name)
}

/** Screenshot one element (element handles scroll themselves, so this is safe
 *  for cards below the fold — a page-coordinate `clip` is not). */
async function shotEl(page, name, handle, what) {
  // park the cursor so no hover tooltip/highlight bleeds into the shot
  await page.mouse.move(2, 2)
  await sleep(250)
  const el = handle ? (handle.asElement ? handle.asElement() : handle) : null
  if (!el || typeof el.screenshot !== 'function') {
    console.log('  MISSING', what, '->', name)
    return false
  }
  await el.screenshot({ path: `${OUT}/${name}.png` })
  shots.push(name)
  console.log('  shot', name)
  return true
}

/** Screenshot one dashboard card by its header title. */
async function shotCard(page, name, title) {
  const handle = await page.evaluateHandle(
    (title) =>
      [...document.querySelectorAll('.dashboard-card')].find((el) =>
        (el.querySelector('header')?.innerText || '').includes(title),
      ) ?? null,
    title,
  )
  return shotEl(page, name, handle, `card ${title}`)
}

/** Screenshot an arbitrary CSS selector. */
async function shotSel(page, name, selector) {
  const handle = await page.$(selector)
  return shotEl(page, name, handle, `selector ${selector}`)
}

/** Click a button/element inside a card whose text contains `text`. */
async function clickInCard(page, cardTitle, text) {
  return page.evaluate(
    ({ cardTitle, text }) => {
      const c = [...document.querySelectorAll('.dashboard-card')].find((el) =>
        (el.querySelector('header')?.innerText || '').includes(cardTitle),
      )
      if (!c) return false
      const btn = [...c.querySelectorAll('button, label, input')].find((b) =>
        (b.innerText || b.value || '').trim().includes(text),
      )
      if (!btn) return false
      btn.click()
      return true
    },
    { cardTitle, text },
  )
}

/** Choose an option in the nth SearchableSelect of a card. */
async function pick(page, cardTitle, optionName, nth = 0) {
  const opened = await page.evaluate(
    ({ cardTitle, nth }) => {
      const c = [...document.querySelectorAll('.dashboard-card')].find((el) =>
        (el.querySelector('header')?.innerText || '').includes(cardTitle),
      )
      const trig = c?.querySelectorAll('button.ss-trigger')[nth]
      if (!trig) return false
      trig.click()
      return true
    },
    { cardTitle, nth },
  )
  if (!opened) {
    console.log('  MISSING picker', cardTitle, nth)
    return false
  }
  await sleep(400)
  const ok = await page.evaluate(
    ({ optionName }) => {
      const opt = [...document.querySelectorAll('.ss-panel .ss-option')].find(
        (b) => (b.querySelector('.ss-name')?.textContent || b.textContent).trim() === optionName,
      )
      if (!opt) return false
      opt.click()
      return true
    },
    { optionName },
  )
  await sleep(900)
  if (!ok) console.log('  MISSING option', optionName, 'in', cardTitle)
  return ok
}

/** Drag a card's resize handle so a screenshot of it is legible. */
async function resizeCard(page, title, dx, dy) {
  // the handle must be inside the viewport for real mouse events to reach it
  await page.evaluate(
    ({ title }) => {
      const c = [...document.querySelectorAll('.css-grid-item')].find((el) =>
        (el.querySelector('.dashboard-card header')?.innerText || '').includes(title),
      )
      c?.querySelector('.css-grid-resize-handle')?.scrollIntoView({ block: 'center' })
    },
    { title },
  )
  await sleep(500)
  const h = await page.evaluate(
    ({ title }) => {
      const c = [...document.querySelectorAll('.css-grid-item')].find((el) =>
        (el.querySelector('.dashboard-card header')?.innerText || '').includes(title),
      )
      const handle = c?.querySelector('.css-grid-resize-handle')
      if (!handle) return null
      const r = handle.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    },
    { title },
  )
  if (!h) return false
  await page.mouse.move(h.x, h.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(h.x + (dx * i) / 10, h.y + (dy * i) / 10)
    await sleep(35)
  }
  await page.mouse.up()
  await sleep(900)
  return true
}

/**
 * Force a card visible from the card menu. A card the data-availability
 * default hides (e.g. Sector gates before any gate exists) shows its checkbox
 * already ticked, so one click hides it — only an EXPLICIT show choice
 * overrides the default, hence the off/on double toggle.
 */
async function forceShowCard(page, name) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.menu-toggle')][0]
    b?.click()
  })
  await sleep(500)
  const ok = await page.evaluate(
    async ({ name }) => {
      const row = [...document.querySelectorAll('.card-menu .row')].find(
        (r) => (r.querySelector('.row-name')?.textContent || '').trim() === name,
      )
      const cb = row?.querySelector('.row-check')
      if (!cb) return false
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      if (cb.checked) {
        cb.click()
        await wait(250)
      }
      cb.click()
      return true
    },
    { name },
  )
  await sleep(600)
  await page.keyboard.press('Escape')
  await sleep(400)
  if (!ok) console.log('  MISSING card-menu item', name)
  return ok
}

// ---------------------------------------------------------------- converter
async function converterPass() {
  console.log('converter pass')
  const { browser, page } = await launch()
  const cdp = await page.createCDPSession()
  await cdp.send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})
  page.on('dialog', (d) => d.accept().catch(() => {}))

  await shot(page, 'converter-empty')
  await importFixtures(page, [FIXTURES + 'super2.loga'])
  await shot(page, 'converter-loaded', { fullPage: true })
  await shotSel(page, 'converter-output-format', 'section.results')
  await shotSel(page, 'converter-preset', 'section.presetbar')
  await shotSel(page, 'converter-rc3-mapping', 'section.mapping')

  // suspension calibration (collapsed <details>)
  await page.evaluate(() => document.querySelector('details.suspension-section')?.setAttribute('open', ''))
  await sleep(700)
  await shotSel(page, 'converter-suspension', 'details.suspension-section')
  await page.evaluate(() => document.querySelector('details.suspension-section')?.removeAttribute('open'))

  // convert -> result rows with download buttons
  await page.evaluate(() => {
    // scoped to the results section: the nav tab is also labelled 轉換
    const b = [...document.querySelectorAll('section.results button')].find(
      (x) => x.textContent.trim() === '轉換',
    )
    b?.click()
  })
  await sleep(2500)
  await shotSel(page, 'converter-results', 'section.results')

  await browser.close()
}

// ----------------------------------------------------------------- analyzer
async function analyzerPass() {
  console.log('analyzer pass')
  const { browser, page } = await launch()
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await importText(page, [{ name: 'demo-session.csv', text: buildDemoCsv() }])
  await clickTab(page, '分析')
  await sleep(4500)

  await shot(page, 'analyzer-overview', { fullPage: true })
  await shotCard(page, 'analyzer-accel-test', '加速測試')
  await shotCard(page, 'analyzer-track-file', '賽道設定')

  // card menu (layout §4.10)
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    document.querySelector('button.menu-toggle')?.click()
  })
  await sleep(700)
  // the popover scrolls internally; let it grow so the whole menu is captured
  await page.evaluate(() => {
    for (const sel of ['.card-menu .popover', '.card-menu .popover-scroll']) {
      const el = document.querySelector(sel)
      if (el) {
        el.style.maxHeight = 'none'
        el.style.overflow = 'visible'
      }
    }
  })
  await sleep(400)
  await shotSel(page, 'analyzer-card-menu', '.card-menu .popover')
  await page.keyboard.press('Escape')
  await sleep(400)

  // gear-ratio calculator: feed it the engine-speed channel
  await pick(page, '變速齒比計算器', 'RPM')
  await sleep(1200)
  await shotCard(page, 'analyzer-gear-ratio', '變速齒比計算器')

  // track map, enlarged + channel colouring (§4.2 / §4.6)
  await resizeCard(page, '賽道地圖', 400, 180)
  await shotCard(page, 'analyzer-trackmap', '賽道地圖')
  await pick(page, '軌跡通道標記', 'GPS_Speed')
  await clickInCard(page, '軌跡通道標記', '軌跡上色')
  await sleep(1500)
  await shotCard(page, 'analyzer-track-markers', '軌跡通道標記')
  await shotCard(page, 'analyzer-trackmap-coloured', '賽道地圖')

  // lap table, enlarged so more columns/rows fit
  await resizeCard(page, '圈次表', 380, -300)
  await shotCard(page, 'analyzer-lap-table', '圈次表')

  // select two laps so the chart shows the lap overlay rather than a
  // 13-minute-wide sawtooth of the whole session
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.dashboard-card table tbody tr')]
    rows[1]?.click()
    rows[2]?.click()
  })
  await sleep(1500)

  // time-series chart (the right-hand column cannot grow wider, only taller)
  await resizeCard(page, '圖表 1', 0, 220)
  await pick(page, '圖表 1', 'GPS_Speed')
  await pick(page, '圖表 1', 'RPM')
  await sleep(1500)
  await shotCard(page, 'analyzer-chart', '圖表 1')
  await shotCard(page, 'analyzer-lap-selection', '圈次表')

  // sector gates (the card hides itself until gates exist)
  await forceShowCard(page, 'Sector 閘門')
  await sleep(1000)
  await clickInCard(page, 'Sector 閘門', '自動偵測彎道')
  await sleep(2500)
  await shotCard(page, 'analyzer-sector-gates', 'Sector 閘門')

  // scatter chart
  await page.evaluate(() => document.querySelector('button.menu-toggle')?.click())
  await sleep(500)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.card-menu .add-row')].find((x) =>
      x.textContent.includes('散佈圖'),
    )
    b?.click()
  })
  await sleep(800)
  await page.keyboard.press('Escape')
  await sleep(600)
  const scatterTitle = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.dashboard-card header')].map((h) => h.innerText.trim())
    return titles.find((t) => t.includes('散佈')) ?? ''
  })
  if (scatterTitle) {
    await resizeCard(page, scatterTitle.split('\n')[0], 200, 100)
    await pick(page, scatterTitle.split('\n')[0], 'GPS_Speed', 0)
    await pick(page, scatterTitle.split('\n')[0], 'Lean_Angle', 1)
    await sleep(2000)
    await shotCard(page, 'analyzer-scatter', scatterTitle.split('\n')[0])
  } else {
    console.log('  MISSING scatter card')
  }

  await browser.close()
}

// ------------------------------------------------------- two sessions (4.12)
async function multiSessionPass() {
  console.log('multi-session pass')
  const { browser, page } = await launch()
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await importText(page, [
    { name: 'demo-session.csv', text: buildDemoCsv() },
    {
      name: 'demo-session-2.csv',
      text: buildDemoCsv({ lapPace: [0.9, 0.95, 0.98, 1.005, 0.97, 0.93], seed: 21, jitterM: 0.45 }),
    },
  ])
  await clickTab(page, '分析')
  await sleep(5000)
  // tick every loaded log so the second one is compared against the primary
  // (the compare checkbox only exists on the analyzer tab's file bar)
  await page.evaluate(() => {
    for (const cb of document.querySelectorAll('.filebar input[type=checkbox]')) {
      if (!cb.checked) cb.click()
    }
  })
  await sleep(5000)
  await shotSel(page, 'analyzer-multi-session-filebar', '.filebar')
  await shotCard(page, 'analyzer-session-merge', 'GPS 場次合併')
  await resizeCard(page, '圈次表', 380, 260)
  await sleep(800)
  await shotCard(page, 'analyzer-multi-session-laps', '圈次表')
  // selecting a lap from each session is what brings up the overlay alignment
  await page.evaluate(() => {
    const tables = [...document.querySelectorAll('.dashboard-card table')]
    tables[0]?.querySelectorAll('tbody tr')[2]?.click()
    tables[1]?.querySelectorAll('tbody tr')[1]?.click()
  })
  await sleep(2000)
  await shotCard(page, 'analyzer-lap-align', '疊圈對位微調')
  await browser.close()
}

// ----------------------------------------------------------------- settings
async function settingsPass() {
  console.log('settings pass')
  const { browser, page } = await launch()
  await importText(page, [{ name: 'demo-session.csv', text: buildDemoCsv() }])
  await clickTab(page, '設定')
  await sleep(2000)
  await shot(page, 'settings-overview')
  await page.evaluate(() => window.scrollTo(0, 700))
  await sleep(700)
  await shot(page, 'settings-tracks-transfer')
  await browser.close()
}

// ------------------------------------------------------------------- mobile
async function mobilePass() {
  console.log('mobile pass')
  const { browser, page } = await launch({ width: 375, height: 812, isMobile: true, hasTouch: true })
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await sleep(1500)
  await importText(page, [{ name: 'demo-session.csv', text: buildDemoCsv() }])
  await shot(page, 'mobile-converter')
  // on a narrow viewport the imported log is not auto-activated for analysis
  await page.evaluate(() => {
    const cb = document.querySelector('.filebar input[type=checkbox]')
    if (cb && !cb.checked) cb.click()
  })
  await sleep(1200)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.bottom-nav__tab')][1]
    b?.click()
  })
  await sleep(6000)
  await shot(page, 'mobile-analyzer')
  await page.evaluate(() => window.scrollTo(0, 520))
  await sleep(800)
  await shot(page, 'mobile-analyzer-cards')
  await browser.close()
}

const only = process.argv[3]
const passes = {
  converter: converterPass,
  analyzer: analyzerPass,
  multi: multiSessionPass,
  settings: settingsPass,
  mobile: mobilePass,
}
for (const [name, fn] of Object.entries(passes)) {
  if (only && only !== name) continue
  await fn()
}
console.log('\n' + shots.length + ' shots:', shots.join(', '))
