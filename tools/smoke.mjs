/**
 * 冒烟测试：用 Edge headless + CDP 打开站点，验证关键路径。
 *
 * 覆盖：
 *   1. 页面加载无 JS 错误
 *   2. 加载屏出现「进入场景」按钮，点击后真正进场（title 变化）
 *   3. 按 W 键角色真的往前走（读物理刚体坐标）
 *   4. 截图存盘
 *
 * 用法：node tools/smoke.mjs [url] [输出目录]
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TARGET_URL = process.argv[2] || 'http://localhost:3000/'
const OUT_DIR = process.argv[3] || path.resolve(process.cwd(), 'tools', 'smoke-out')
const PORT = 9333

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------- 启动 Edge ----------
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aufheben-smoke-'))
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

  const errors = []
  cdp.on('Runtime.exceptionThrown', (params) => {
    errors.push(
      params.exceptionDetails?.exception?.description ||
        params.exceptionDetails?.text ||
        'unknown exception'
    )
  })
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      errors.push(params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
  })

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')

  console.log(`→ 打开 ${TARGET_URL}`)
  await cdp.send('Page.navigate', { url: TARGET_URL })
  await sleep(3000)

  // ---------- 1. 加载屏就绪 ----------
  const buttonReady = await evaluate(
    cdp,
    `(() => {
       const b = document.getElementById('loaderStart')
       const loader = document.getElementById('loader')
       return b && !b.hidden && loader && getComputedStyle(loader).display !== 'none'
     })()`
  )
  console.log(`  加载屏就绪：${buttonReady}`)
  if (!buttonReady) {
    throw new Error('加载屏没有出现「进入场景」按钮')
  }

  // ---------- 2. 点击「进入场景」 ----------
  const box = await evaluate(
    cdp,
    `(() => {
       const r = document.getElementById('loaderStart').getBoundingClientRect()
       return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
     })()`
  )
  await mouseClick(cdp, box.x, box.y)
  await sleep(1200)

  const started = await evaluate(cdp, `window.aufheben ? window.aufheben.started : false`)
  const loaderGone = await evaluate(
    cdp,
    `(() => {
       const l = document.getElementById('loader')
       return l.hidden || getComputedStyle(l).display === 'none'
     })()`
  )
  console.log(`  已进场：${started} / 加载屏已隐藏：${loaderGone}`)
  if (!started) throw new Error('点击「进入场景」后没有进入场景')

  await saveScreenshot(cdp, path.join(OUT_DIR, '01-scene.png'))

  // ---------- 3. 静止一会儿再按 W ----------
  // 必须先 idle 超过 1 秒：cannon-es 里刚体静止太久会进 SLEEPING，
  // 而移动是直接写 velocity，不会触发唤醒，睡着了就再也走不了。
  await sleep(1800)
  const sleepState = await evaluate(cdp, `window.aufheben.world.character.body.sleepState`)
  console.log(`  刚体休眠状态：${sleepState}（0=AWAKE 1=SLEEPY 2=SLEEPING）`)
  if (sleepState !== 0) throw new Error(`角色刚体进入休眠状态 ${sleepState}，会走不动`)

  // 站着不动时不能自己走。
  // 本机连着的 DualSense Edge 在 Windows 上会报 axes[1] = -1（等于左摇杆推到底），
  // 手柄分支如果直接采信，角色就会自己往前冲停不下来。
  const idleA = await evaluate(cdp, `window.aufheben.world.character.body.position.z`)
  await sleep(1200)
  const idleB = await evaluate(cdp, `window.aufheben.world.character.body.position.z`)
  console.log(`  静置 1.2 秒位移：${Math.abs(idleB - idleA).toFixed(3)}`)
  if (Math.abs(idleB - idleA) > 0.2) throw new Error('没有按键时角色自己在走')

  const before = await evaluate(cdp, `window.aufheben.world.character.body.position.z`)
  await key(cdp, 'KeyW', 'w')
  await sleep(700)
  await key(cdp, 'KeyW', 'w', 'up')
  await sleep(600)
  const after = await evaluate(cdp, `window.aufheben.world.character.body.position.z`)

  const moved = Math.abs(after - before)
  console.log(`  角色 z：${before.toFixed(2)} → ${after.toFixed(2)}（位移 ${moved.toFixed(2)}）`)
  if (moved < 0.5) throw new Error('按 W 键角色没有移动')

  // ---------- 3.5 松键后必须停下来 ----------
  // 以前键盘的增量被累加进 move，松键后 move 里还留着 1，角色会一直走。
  await sleep(700)
  const stop1 = await evaluate(cdp, `window.aufheben.world.character.body.position.z`)
  await sleep(900)
  const stop2 = await evaluate(cdp, `window.aufheben.world.character.body.position.z`)
  const speed = await evaluate(
    cdp,
    `Math.hypot(window.aufheben.world.character.body.velocity.x, window.aufheben.world.character.body.velocity.z)`
  )
  console.log(
    `  松键后：水平速度 ${speed.toFixed(2)}，位置 ${stop1.toFixed(2)} → ${stop2.toFixed(2)}`
  )
  if (speed > 0.3) throw new Error(`松键后速度没有归零：${speed.toFixed(2)}`)
  if (Math.abs(stop2 - stop1) > 0.15) throw new Error('松键后角色还在往前走')

  await saveScreenshot(cdp, path.join(OUT_DIR, '02-walked.png'))

  // ---------- 4. 视角：抬头要真的抬起来 ----------
  // 之前的实现里 pitch 是用欧拉角硬转的，一抬头相机就被推到地面以下，
  // 而且看向的点不带 pitch，画面根本不跟着抬。
  await evaluate(cdp, `window.aufheben.camera.pitch = 0.5`)
  await sleep(700)
  const lookUp = await evaluate(
    cdp,
    `(() => {
       const c = window.aufheben.camera
       return {
         dirY: c.direction.y,
         posY: c.instance.position.y,
         rotX: c.instance.rotation.x,
       }
     })()`
  )
  console.log(
    `  抬头后：视线 y=${lookUp.dirY.toFixed(2)} 相机 y=${lookUp.posY.toFixed(2)} 俯仰=${lookUp.rotX.toFixed(2)}`
  )
  if (lookUp.dirY < 0.2) throw new Error('抬头后视线没有往上')
  if (lookUp.posY < 0.3) throw new Error('抬头后相机掉到地面以下了')
  // 相机绕 X 轴正转 = 抬头（相机默认朝 -Z，rotation.x 转正后 -Z 指向斜上方）
  if (lookUp.rotX < 0.1) throw new Error('抬头后相机俯仰角没有变正')

  // ---------- 5. 拖拽转视角（指针锁拿不到时的兜底） ----------
  const yawBefore = await evaluate(cdp, `window.aufheben.camera.yaw`)
  const dirBefore = await evaluate(
    cdp,
    `(() => { const d = window.aufheben.camera.direction; return [d.x, d.z] })()`
  )
  await evaluate(
    cdp,
    `document.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))`
  )
  await evaluate(
    cdp,
    `document.dispatchEvent(new MouseEvent('mousemove', { movementX: 60, movementY: 0, bubbles: true }))`
  )
  await sleep(400)
  const yawAfter = await evaluate(cdp, `window.aufheben.camera.yaw`)
  const dirAfter = await evaluate(
    cdp,
    `(() => { const d = window.aufheben.camera.direction; return [d.x, d.z] })()`
  )
  await evaluate(
    cdp,
    `document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }))`
  )
  console.log(`  拖拽转视角：yaw ${yawBefore.toFixed(2)} → ${yawAfter.toFixed(2)}`)
  if (Math.abs(yawAfter - yawBefore) < 0.05) {
    throw new Error('拖拽转视角没有生效')
  }

  // 往右拖，视线必须往右转。
  // 起点朝 -Z，屏幕右侧是 +X，所以视线水平分量的 x 必须变大。
  console.log(
    `  视线水平分量 x：${dirBefore[0].toFixed(3)} → ${dirAfter[0].toFixed(3)}`
  )
  if (dirAfter[0] <= dirBefore[0] + 0.05) {
    throw new Error('往右拖没有把视角转向右边（左右反了）')
  }

  // ---------- 6. 走近展台：提示出现 + 展板切到近状态 ----------
  // 「混合呈现」的核心：3D 展板远处只给标题，走近才补上摘要；
  // 同时 HUD 上出现按 E 的提示。两者都要真的发生。
  const nearResult = await evaluate(
    cdp,
    `(() => {
       const w = window.aufheben.world
       // 把角色挪到 about 展台前（展台在 [0, -11]，触发半径 3.4m）
       const body = w.character.body
       body.position.set(0, body.position.y, -8.4)
       body.velocity.set(0, 0, 0)
       return true
     })()`
  )
  await sleep(700)

  const nearState = await evaluate(
    cdp,
    `(() => {
       const w = window.aufheben.world
       const active = w.landmarks.active
       const prompt = document.getElementById('hudPrompt')
       return {
         activeId: active ? active.entry.id : null,
         promptVisible: prompt ? !prompt.hidden : false,
         promptText: prompt ? prompt.textContent.trim() : '',
         // 近状态下展板贴图应该被换成带摘要的那一张
         hasSummary: !!(active && active.boardTexture.image && active.boardTexture.image.width > 0),
       }
     })()`
  )
  console.log(
    `  走近展台：激活=${nearState.activeId} 提示=${nearState.promptVisible ? '显示' : '隐藏'}「${nearState.promptText}」`
  )
  if (nearState.activeId !== 'about') {
    throw new Error(`走近展台没有激活目标：${nearState.activeId}`)
  }
  if (!nearState.promptVisible) {
    throw new Error('走近展台后 HUD 提示没有出现')
  }
  if (!nearState.promptText.includes('aufheben')) {
    throw new Error(`提示内容不对：${nearState.promptText}`)
  }
  if (!nearState.hasSummary) {
    throw new Error('展板贴图没有切到近状态')
  }

  // ---------- 7. 渲染预算 ----------
  const render = await evaluate(
    cdp,
    `(() => {
       const r = window.aufheben.renderer
       let lights = 0
       let shadowSize = 0
       window.aufheben.scene.traverse((o) => {
         if (o.isLight) lights++
         if (o.isDirectionalLight && o.castShadow) shadowSize = o.shadow.mapSize.width
       })
       return {
         calls: r.info.render.calls,
         triangles: r.info.render.triangles,
         lights,
         shadowSize,
       }
     })()`
  )
  console.log(
    `  draw calls=${render.calls} 三角形=${render.triangles} 灯=${render.lights} 阴影贴图=${render.shadowSize}`
  )
  // 桌面预算：draw call ≤ 300、三角形 ≤ 750k、阴影投射灯 ≤ 2、阴影贴图 ≤ 2048
  if (render.calls > 300) throw new Error(`draw call 超出预算：${render.calls}`)
  if (render.triangles > 750000) throw new Error(`三角形超出预算：${render.triangles}`)
  if (render.lights > 3) throw new Error(`光源太多：${render.lights}`)
  if (render.shadowSize > 2048) throw new Error(`阴影贴图太大：${render.shadowSize}`)

  // ---------- 6.5 视觉指标 ----------  // 判据来自 threejs-game-skills 的 visual-scorecard.md。
  // 这四条是"画面里有没有可被眼睛读到的信息"的硬指标：
  // 稀疏扁平、暗、几何体占主导的场景会全挂。
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const metrics = await evaluate(
    cdp,
    `(async () => {
      const b64 = ${JSON.stringify(shot.data)}
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
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
        colorEntropyBits: round(entropy, 2),
        edgeDensity: round(edges / checked, 3),
        contrast: round(p95 - p5, 1),
        dominantColorShare: round(dominant / samples, 3),
      }
    })()`
  )
  console.log(
    `  视觉指标：熵=${metrics.colorEntropyBits} 边缘密度=${metrics.edgeDensity} 对比度=${metrics.contrast} 主色占比=${metrics.dominantColorShare}`
  )
  if (metrics.colorEntropyBits < 3.0) {
    throw new Error(`画面太扁平（熵 ${metrics.colorEntropyBits} < 3.0）：场景缺少可读信息`)
  }
  if (metrics.dominantColorShare > 0.6) {
    throw new Error(`单一颜色占比过高（${metrics.dominantColorShare} > 0.6）：画面是空的`)
  }
  if (metrics.edgeDensity < 0.04) {
    throw new Error(`边缘密度过低（${metrics.edgeDensity} < 0.04）：几何体占主导或构图空`)
  }
  if (metrics.contrast < 60) {
    throw new Error(`明暗对比不足（${metrics.contrast} < 60）：雾或暗部把画面压平了`)
  }

  // ---------- 7. 纯文字清单兜底 ----------
  const fallbackItems = await evaluate(
    cdp,
    `document.querySelectorAll('#fallbackList .fallback__item').length`
  )
  console.log(`  文字清单条目：${fallbackItems}`)
  if (fallbackItems < 1) throw new Error('文字清单兜底没有渲染内容')

  // ---------- 8. 控制台错误 ----------
  if (errors.length) {
    const unique = [...new Set(errors)]
    console.log(`\n控制台错误（去重后 ${unique.length} 条 / 共 ${errors.length} 次）：`)
    for (const error of unique) console.log('  ✗', error.split('\n')[0])
    throw new Error(`有 ${unique.length} 条控制台错误`)
  }

  console.log('\n✓ 冒烟测试全部通过')
  exitCode = 0
} catch (error) {
  console.error(`\n✗ 冒烟测试失败：${error.message}`)
  exitCode = 1
} finally {
  edge.kill()
  await sleep(300)
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {}
}

process.exit(exitCode)

// ---------- CDP 小工具 ----------

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (response.ok) return
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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text)
  }
  return result.result.value
}

async function mouseClick(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
  })
}

async function key(cdp, code, keyName, type = 'down') {
  await cdp.send('Input.dispatchKeyEvent', {
    type: type === 'up' ? 'keyUp' : 'keyDown',
    code,
    key: keyName,
    windowsVirtualKeyCode: code === 'KeyW' ? 87 : 0,
    nativeVirtualKeyCode: code === 'KeyW' ? 87 : 0,
  })
}

async function saveScreenshot(cdp, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'))
  console.log(`  截图：${filePath}`)
}
