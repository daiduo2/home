import * as THREE from 'three'
import Time from './Time.js'
import Sizes from './Sizes.js'
import Input from './Input.js'
import Camera from './Camera.js'
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

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality !== 'low',
      powerPreference: 'high-performance',
      alpha: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.sizes.pixelRatioCap))
    this.renderer.setSize(this.sizes.viewport.width, this.sizes.viewport.height)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.sizes.on('resize', () => {
      this.renderer.setSize(this.sizes.viewport.width, this.sizes.viewport.height)
      this.camera.resize()
    })
  }

  setScene() {
    // 天空不画在 canvas 里，交给 CSS 渐变：零成本，且雾色能和背景对上
    this.scene.background = null
    this.scene.fog = new THREE.Fog(0x14142e, 34, 96)
  }

  setCamera() {
    this.camera = new Camera({
      sizes: this.sizes,
      time: this.time,
    })
  }

  setWorld() {
    this.world = new World({
      time: this.time,
      sizes: this.sizes,
      camera: this.camera,
      input: this.input,
      events: this.events,
    })
    this.world.physics = this.world.physics
    this.camera.physics = this.world.physics
    this.scene.add(this.world.container)
    this.world.setQuality(this.quality)
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
    this.renderer.render(this.scene, this.camera.instance)

    this.frameCount++
    if (this.frameCount === 120) {
      this.interface.setStats(
        `渲染器 ${this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} · 画质 ${this.quality}`
      )
    }
  }

  destroy() {
    this.time.destroy()
    this.world.destroy()
    this.renderer.dispose()
  }
}
