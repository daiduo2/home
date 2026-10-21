import EventEmitter from './EventEmitter.js'

/**
 * 视口尺寸与设备能力。移植自 3d-folio 的 Utils/Sizes.js。
 */
export default class Sizes extends EventEmitter {
  constructor() {
    super()

    this.touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    this.viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    }

    this.setViewport()

    window.addEventListener('resize', () => {
      this.setViewport()
      this.trigger('resize')
    })
  }

  setViewport() {
    this.viewport.width = window.innerWidth
    this.viewport.height = window.innerHeight
  }

  /** 像素比上限：移动端压到 1.5，桌面端 2 —— 直接影响填充率 */
  get pixelRatioCap() {
    return this.touch ? 1.5 : 2
  }
}
