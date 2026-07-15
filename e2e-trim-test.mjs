// Temporary E2E: trim + playback verification against the local dev server.
// Run: node e2e-trim-test.mjs   (dev:d1 must be running on :3000)
import { chromium } from 'playwright'

const log = (...a) => console.log('[e2e]', ...a)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext()
const page = await ctx.newPage()
page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error' || m.type() === 'warning' || /\[trim\]|Trim|seek|decode|MediaRecorder|record/i.test(t)) {
    console.log(`[page:${m.type()}]`, t.slice(0, 300))
  }
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))

const dumpState = async () => {
  const s = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]')
    const v = dlg ? dlg.querySelector('video') : document.querySelector('video')
    return {
      dialogText: dlg ? dlg.innerText.replace(/\n+/g, ' | ').slice(0, 400) : null,
      video: v ? { t: v.currentTime, paused: v.paused, ended: v.ended, ready: v.readyState, w: v.videoWidth, err: v.error?.code ?? null, seeking: v.seeking } : null,
    }
  }).catch(() => 'page gone')
  console.log('[state]', JSON.stringify(s))
}

try {
  // 1. Login
  await page.goto('http://localhost:3000/welcome', { waitUntil: 'domcontentloaded' })
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smoketest-mobile@example.com', password: 'Sm0keTest!2026' }),
    })
    return r.status
  })
  log('login status:', status)
  if (status !== 200) throw new Error('login failed')

  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 30000 })

  // 2. Generate a 12s clip in-page (distinct visuals to spot in playback)
  log('generating 12s synthetic clip (real time)...')
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 640; canvas.height = 360
    const c = canvas.getContext('2d')
    const stream = canvas.captureStream(30)
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise((res) => { rec.onstop = res })
    let t = 0
    const iv = setInterval(() => {
      t += 33
      c.fillStyle = '#123456'; c.fillRect(0, 0, 640, 360)
      c.fillStyle = '#ff8800'
      c.beginPath(); c.arc(320 + 200 * Math.sin(t / 400), 200, 40, 0, 7); c.fill()
      c.fillStyle = '#fff'; c.font = 'bold 44px sans-serif'
      c.fillText('TRIM E2E ' + (t / 1000).toFixed(1), 40, 80)
    }, 33)
    rec.start(200)
    await new Promise((r) => setTimeout(r, 12000))
    clearInterval(iv); rec.stop(); await done
    window.__clip = new File([new Blob(chunks, { type: 'video/webm' })], 'e2e-12s.webm', { type: 'video/webm' })
    return window.__clip.size
  })

  // 3. Inject into the uploader -> trimmer should open
  await page.evaluate(() => {
    const input = document.querySelector('input[type=file]')
    const dt = new DataTransfer()
    dt.items.add(window.__clip)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForSelector('text=Trim your clip', { timeout: 20000 })
  log('trimmer opened')
  // Give the duration probe a moment, confirm it resolved (Infinity-duration webm)
  await page.waitForFunction(() => /0:1\d long/.test(document.body.innerText), null, { timeout: 15000 })
  log('duration probed:', await page.evaluate(() => (document.body.innerText.match(/clip is (\S+) long/) || [])[1]))

  // 4. Trim & analyze (canvas host-encode path)
  await page.click('button:has-text("Trim & analyze")')
  log('trimming (real time ~10s, may retry alternate format)...')

  // 5. Wait for either the sport dialog (success) or an error message,
  //    dumping trimmer state every 10s so hangs are diagnosable.
  const stateTimer = setInterval(() => void dumpState(), 10000)
  let outcome
  try {
    outcome = await Promise.race([
      page.waitForSelector('text=What type of fight clip is this?', { timeout: 90000 }).then(() => 'success'),
      page.waitForSelector('p.text-destructive', { timeout: 90000 }).then(async (el) => 'ERROR: ' + (await el.textContent())),
    ])
  } finally {
    clearInterval(stateTimer)
  }
  if (String(outcome).startsWith('ERROR')) throw new Error('trim failed: ' + outcome)
  log('trim confirmed, sport dialog open')

  // 6. Pick BJJ + close (wait for the trimmer dialog to be fully gone first)
  await page.waitForSelector('text=Trim your clip', { state: 'detached', timeout: 10000 })
  await page.click('button:has-text("BJJ")')
  await page.click('button:has-text("Use these settings")')
  // The whole page must be interactive again — no stranded modal overlay.
  await page.waitForSelector('div[data-state="open"].fixed.inset-0', { state: 'detached', timeout: 10000 })
  log('dialogs closed cleanly, no stuck overlay')

  // 7. Verify the trimmed clip loaded with a real picture + sane duration
  await page.waitForFunction(() => {
    const v = document.querySelector('video')
    return v && v.videoWidth > 0 && Number.isFinite(v.duration) && v.duration > 8 && v.duration < 12
  }, null, { timeout: 30000 })
  const meta = await page.evaluate(() => {
    const v = document.querySelector('video')
    return { duration: v.duration, w: v.videoWidth, h: v.videoHeight }
  })
  log('trimmed clip in player:', JSON.stringify(meta))

  // 8. Boot pipeline -> Ready -> AUTO-PLAY (default now ON). Wait for actual playback.
  log('waiting for boot + auto-play (deep track can take a few minutes)...')
  await page.waitForFunction(() => {
    const v = document.querySelector('video')
    return v && !v.paused && v.currentTime > 0.5 && v.videoWidth > 0
  }, null, { timeout: 300000, polling: 2000 })
  const play1 = await page.evaluate(() => document.querySelector('video').currentTime)
  await page.waitForTimeout(2500)
  const play2 = await page.evaluate(() => document.querySelector('video').currentTime)
  log(`AUTO-PLAY VERIFIED: currentTime ${play1.toFixed(2)} -> ${play2.toFixed(2)} (advancing=${play2 > play1})`)
  if (!(play2 > play1)) throw new Error('video not actually advancing')

  console.log('\n=== PASS: trim + auto-play verified end-to-end ===')
} catch (err) {
  console.error('\n=== FAIL:', err.message, '===')
  process.exitCode = 1
} finally {
  await browser.close()
}
