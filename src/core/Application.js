import * as THREE from 'three'
import Time from './Time.js'
import Sizes from './Sizes.js'
import Input from './Input.js'
import Camera from './Camera.js'
import Vignette from './Vignette.js'
import World from '../world/World.js'
import Loader from '../ui/Loader.js'
import Interface from '../ui/Interface.js'
import landmarkData from '../data/landmarks.js'
import EventEmitter from './EventEmitter.js'

/**
 * 总装。把渲染、输入、场景、界面串起来。
 * 每帧顺序固定：输入 → 物理 → 角色 → 相机 → 渲染。
 */
export default class Application {
  constructor(_options = {}) {
    this.canvas = _options.canvas
    this.events = new EventEmitter()

    this.time = new Time()
    this.sizes = new Sizes()
    this.input = new Input({ domElement: this.canvas })
    this.loader = new Loader()
    this.interface = new Interface({ landmarks: landmarkData })

    this.quality = this.detectQuality()

    this.setRenderer()
    this.setScene()
    this.setCamera()
    this.setWorld()
    this.setEvents()

    this.started = false
    this.frameCount = 0
  }

  detectQuality() {
    const params = new URLSearchParams(window.location.search)
    const forced = params.get('quality')
    if (forced === 'low' || forced === 'medium' || forced === 'high') {
      return forced
    }
    if (this.sizes.touch) return 'low'
    if (window.devicePixelRatio > 2 && window.innerWidth < 1400) return 'medium'
    return 'high'
  }

  setRenderer() {
    this.scene = new THREE.Scene()

    // 高分屏上不要开 MSAA：Bruno 的做法是 pixelRatio >= 2 时用分辨率换锐度，
    // 抗锯齿交给浏览器合成。同屏像素量能差 4 倍。
    const pixelRatio = Math.min(window.devicePixelRatio, this.sizes.pixelRatioCap)

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: pixelRatio < 2,
      powerPreference: 'high-performance',
      alpha: true,
    })
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(this.sizes.viewport.width, this.sizes.viewport.height)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.shadowMap.enabled = true
    // PCF 比 PCFSoft 便宜（采样次数少），阴影稍硬但更清晰
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // 阴影贴图默认每帧重算，但场景是静态的、只有角色在动。
    // 关掉自动更新，改由 Environment 在角色真的移动时手动标脏。
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true

    this.sizes.on('resize', () => {
      this.renderer.setSize(this.sizes.viewport.width, this.sizes.viewport.height)
      this.camera.resize()
    })
  }

  setScene() {
    // 天空不画在 canvas 里，交给场景里的渐变天球：
    // 雾色必须和天际线色一致，用 CSS 渐变当背景的话两者对不上，
    // 远处地面和天空之间会出现一条硬边。
    this.scene.background = null
  }

  setCamera() {
    this.camera = new Camera({
      sizes: this.sizes,
      time: this.time,
    })

    // 相机要进场景图：暗角是挂在相机上的全屏 quad，
    // 相机不在场景图里，它就不会被渲染。
    this.scene.add(this.camera.instance)

    // 暗角：挂相机的一个全屏 quad，不走后处理。
    // 1 个 draw call 的代价，比 EffectComposer 便宜一个数量级。
    // 浓度要克制：暗角是为了收视线，不是为了把四角糊掉。
    // 0.72 时画面下缘已经被压到接近全黑，地面细节全看不见了 ——
    // 而画面下缘恰恰是离相机最近的地面，最该看清。
    this.vignette = new Vignette({ camera: this.camera.instance, darkness: 0.55 })
    this.camera.instance.add(this.vignette.mesh)
  }

  setWorld() {
    this.world = new World({
      time: this.time,
      sizes: this.sizes,
      camera: this.camera,
      input: this.input,
      events: this.events,
      renderer: this.renderer,
    })
    this.world.physics = this.world.physics
    this.camera.physics = this.world.physics
    this.scene.add(this.world.container)
    this.world.setQuality(this.quality)

    // 雾由环境统一给：色值必须和天球的地平线色是同一个
    this.scene.fog = this.world.environment.fog
  }

  setEvents() {
    this.events.on('landmark:focus', ({ landmark }) => {
      this.interface.setPrompt(landmark)
    })

    this.input.on('toggleList', () => {
      this.interface.toggleFallback()
    })

    this.input.on('toggleCamera', () => {
      const value = this.camera.toggleFirstPerson()
      this.interface.setCameraValue(value)
    })

    this.input.on('zoom', ({ delta }) => {
      this.camera.zoom(delta)
    })

    this.interface.onQualityChange = (value) => {
      this.quality = value
      this.world.setQuality(value)
      this.renderer.setPixelRatio(
        value === 'low'
          ? 1
          : Math.min(window.devicePixelRatio, value === 'medium' ? 1.5 : this.sizes.pixelRatioCap)
      )
      this.renderer.shadowMap.enabled = value !== 'low'
    }

    this.interface.onCameraChange = (value) => {
      this.camera.setFirstPerson(value)
    }

    // Esc 依次关闭：面板 → 设置 → 文字清单
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Escape') return
      if (!this.interface.panel.hidden) {
        this.interface.closePanel()
      } else if (!this.interface.settings.hidden) {
        this.interface.settings.hidden = true
      } else if (!this.interface.fallback.hidden) {
        this.interface.closeFallback()
      }
    })
  }

  /** 资源很少（几何体与 canvas 贴图都是程序化生成的），只需要一帧构建时间 */
  async prepare() {
    // 用 setTimeout 而不是 requestAnimationFrame 等待：rAF 在页面不可见时会被暂停，
    // 用它 await 会让加载流程永久卡住。
    const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))

    this.loader.setProgress(0.25, '构建场地')
    await yieldToBrowser()

    this.loader.setProgress(0.7, '摆放展台')
    await yieldToBrowser()

    this.loader.setProgress(0.95, '编译着色器')
    this.renderer.compile(this.scene, this.camera.instance)
    await yieldToBrowser()

    this.loader.ready()
  }

  start() {
    this.started = true
    this.input.setEnabled(true)
    this.interface.show()
    this.interface.setQualityValue(this.quality)
    document.title = 'aufheben · 场景'

    if (this.sizes.touch) {
      this.input.setTouchMode()
      this.loader.setHint('左下摇杆移动 · 右侧拖拽转视角 · E 查看')
    } else {
      // 不在这里立刻请求 Pointer Lock：部分环境（嵌入式 WebView、被遮挡的标签页）
      // 会让请求挂起甚至阻塞后续交互。改成玩家第一次点击画面时再锁定。
      this.loader.setHint('WASD / 方向键移动 · 点击画面锁定视角 · E 查看 · Tab 文字清单')
    }
  }

  update() {
    if (!this.started) {
      this.loader.update()
      this.renderer.render(this.scene, this.camera.instance)
      return
    }

    this.input.update()

    if (this.input.consumeInteract()) {
      const landmark = this.world.interact()
      if (landmark) {
        this.interface.openPanel(landmark)
        this.input.exitPointerLock()
      }
    }

    this.world.update(this.time.delta)
    this.vignette.update(this.time.elapsed)
    this.renderer.render(this.scene, this.camera.instance)

    this.frameCount++
    if (this.frameCount === 120) {
      this.interface.setStats(
        `渲染器 ${this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} · 画质 ${this.quality}`
      )
    }
    this.checkPerformance()
  }

  /**
   * 自动降级：实测帧率太低就降像素比和阴影。
   * "太卡"这件事在不同设备上差一个数量级，写死一套画质必然有人跑不动，
   * 所以让场景自己量自己，量到不行就退一步。
   *
   * 只降不升：升回去会来回抖。
   */
  checkPerformance() {
    if (!this.started) return
    if (this.quality === 'low') return

    const now = performance.now()
    if (!this.perfStart) {
      this.perfStart = now
      this.perfFrames = 0
      return
    }
    this.perfFrames++

    const elapsed = now - this.perfStart
    if (elapsed < 3000) return

    const fps = (this.perfFrames * 1000) / elapsed
    this.perfStart = now
    this.perfFrames = 0

    if (fps >= 42) return

    const next = this.quality === 'high' ? 'medium' : 'low'
    this.quality = next
    this.world.setQuality(next)
    this.renderer.setPixelRatio(
      next === 'low' ? 1 : Math.min(window.devicePixelRatio, 1.25)
    )
    this.renderer.shadowMap.enabled = next !== 'low'
    this.interface.setQualityValue(next)
    this.interface.setStats(
      `实测 ${fps.toFixed(0)} fps，已自动降到${next === 'low' ? '低' : '中'}画质`
    )
  }

  destroy() {
    this.time.destroy()
    this.world.destroy()
    this.vignette.dispose()
    this.renderer.dispose()
  }
}
