/**
 * 视觉度量探针：Edge headless + CDP 打开站点，进场后截图，
 * 把截图送回页面用 2D canvas 解码，按 threejs-game-skills 的
 * visual-scorecard.md 指标算：colorEntropyBits / edgeDensity /
 * luminance.contrast / dominantColorShare。
 *
 * 用法：node visual-metrics.mjs <url> [输出目录]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TARGET_URL = process.argv[2] || 'http://localhost:3000/'
const OUT_DIR = process.argv[3] || path.join(os.tmpdir(), 'visual-metrics-out')
const PORT = 9334

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aufheben-vm-'))
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1280,720',
    'about:blank',
  ],
  { stdio: 'ignore' }
)

let exitCode = 1
try {
  await waitForDevtools()
  const target = await getTarget()
  const cdp = await connect(target.webSocketDebuggerUrl)

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  console.log(`→ ${TARGET_URL}`)
  await cdp.send('Page.navigate', { url: TARGET_URL })
  await sleep(3000)

  const box = await evaluate(
    cdp,
    `(() => {
       const b = document.getElementById('loaderStart')
       if (!b) return null
       const r = b.getBoundingClientRect()
       return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
     })()`
  )
  if (box) {
    await mouseClick(cdp, box.x, box.y)
    await sleep(1500)
  }

  // 渲染器诊断
  const diag = await evaluate(
    cdp,
    `(() => {
       const a = window.aufheben
       if (!a) return null
       const info = a.renderer.info
       return {
         drawCalls: info.render.calls,
         triangles: info.render.triangles,
         programs: info.programs ? info.programs.length : 0,
         geometries: info.memory.geometries,
         textures: info.memory.textures,
         lights: (() => { let n = 0; a.scene.traverse(o => { if (o.isLight) n++ }); return n })(),
         shadowMapSize: (() => {
           let s = 0
           a.scene.traverse(o => { if (o.isLight && o.shadow && o.shadow.mapSize) s = Math.max(s, o.shadow.mapSize.x) })
           return s
         })(),
         toneMapping: a.renderer.toneMapping,
         exposure: a.renderer.toneMappingExposure,
         outputColorSpace: a.renderer.outputColorSpace,
         pixelRatio: a.renderer.getPixelRatio(),
         fov: a.camera.instance.fov,
         cameraDistance: a.camera.currentDistance,
         fog: a.scene.fog ? { color: a.scene.fog.color.getHexString(), near: a.scene.fog.near, far: a.scene.fog.far } : null,
         background: a.scene.background ? String(a.scene.background) : null,
       }
     })()`
  )
  console.log('渲染器诊断:', JSON.stringify(diag, null, 2))

  // 截图 + 度量
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'shot.png'), Buffer.from(shot.data, 'base64'))

  const metrics = await evaluate(
    cdp,
    `(async () => {
      const b64 = ${JSON.stringify(shot.data)}
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
      const cv = document.createElement('canvas')
      cv.width = img.width; cv.height = img.height
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data
      const W = cv.width, H = cv.height
      const stepX = Math.max(1, Math.floor(W / 160))
      const stepY = Math.max(1, Math.floor(H / 90))
      const cols = Math.floor(W / stepX), rows = Math.floor(H / stepY)
      const lum = new Float64Array(cols * rows)
      const buckets = new Map()
      let samples = 0
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const o = ((gy * stepY) * W + gx * stepX) * 4
          const r = d[o], g = d[o+1], b = d[o+2]
          lum[gy * cols + gx] = 0.2126 * r + 0.7152 * g + 0.0722 * b
          const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4)
          buckets.set(key, (buckets.get(key) || 0) + 1)
          samples++
        }
      }
      const sorted = Array.from(lum).sort((a, b) => a - b)
      const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length
      const p5 = sorted[Math.floor(sorted.length * 0.05)]
      const p95 = sorted[Math.floor(sorted.length * 0.95)]
      let entropy = 0, dominant = 0
      for (const c of buckets.values()) {
        const p = c / samples
        entropy -= p * Math.log2(p)
        dominant = Math.max(dominant, c)
      }
      let edges = 0, checked = 0
      for (let gy = 0; gy < rows - 1; gy++) {
        for (let gx = 0; gx < cols - 1; gx++) {
          const i = gy * cols + gx
          const dx = Math.abs(lum[i] - lum[i+1])
          const dy = Math.abs(lum[i] - lum[i+cols])
          if (Math.max(dx, dy) > 12) edges++
          checked++
        }
      }
      const round = (v, n) => Number(v.toFixed(n))
      return {
        size: [W, H],
        colorBuckets: buckets.size,
        colorEntropyBits: round(entropy, 2),
        edgeDensity: round(edges / checked, 3),
        luminance: { mean: round(mean,1), p5: round(p5,1), p95: round(p95,1), contrast: round(p95 - p5, 1) },
        dominantColorShare: round(dominant / samples, 3),
        nonBackgroundShare: round(1 - dominant / samples, 3),
      }
    })()`
  )

  console.log('视觉度量:', JSON.stringify(metrics, null, 2))

  const fails = []
  if (metrics.colorEntropyBits < 3.0) fails.push(`colorEntropyBits ${metrics.colorEntropyBits} < 3.0 → 稀疏扁平场景`)
  if (metrics.dominantColorShare > 0.6) fails.push(`dominantColorShare ${metrics.dominantColorShare} > 0.6 → 稀疏扁平场景`)
  if (metrics.edgeDensity < 0.04) fails.push(`edgeDensity ${metrics.edgeDensity} < 0.04 → 几何体占主导或构图空`)
  if (metrics.luminance.contrast < 60) fails.push(`luminance.contrast ${metrics.luminance.contrast} < 60 → 雾/暗部压缩`)
  console.log(fails.length ? '未达指标:\n  - ' + fails.join('\n  - ') : '四项指标全部达标')

  exitCode = 0
} catch (error) {
  console.error('失败:', error.message)
} finally {
  edge.kill()
  try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch {}
}
process.exit(exitCode)

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return
    } catch {}
    await sleep(250)
  }
  throw new Error('Edge DevTools 端口没起来')
}
async function getTarget() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const list = await response.json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('找不到可用的页面 target')
  return page
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const handlers = new Map()
    const listeners = {}
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && handlers.has(message.id)) {
        const { resolve: done, reject: fail } = handlers.get(message.id)
        handlers.delete(message.id)
        if (message.error) fail(new Error(message.error.message))
        else done(message.result)
      } else if (message.method && listeners[message.method]) {
        for (const listener of listeners[message.method]) listener(message.params)
      }
    })
    socket.addEventListener('error', reject)
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          return new Promise((done, fail) => {
            const id = Math.floor(Math.random() * 1e9)
            handlers.set(id, { resolve: done, reject: fail })
            socket.send(JSON.stringify({ id, method, params }))
          })
        },
        on(method, listener) {
          listeners[method] = listeners[method] || []
          listeners[method].push(listener)
        },
      })
    })
  })
}
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
async function mouseClick(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
