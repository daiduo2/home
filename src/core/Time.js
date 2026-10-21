import EventEmitter from './EventEmitter.js'

/**
 * 主循环。移植自 3d-folio 的 Utils/Time.js。
 * 对外只暴露 elapsed（累计秒）与 delta（单帧秒），并按 tick 顺序派发事件，
 * 保证物理 → 角色 → 相机 → 渲染 的执行顺序稳定。
 *
 * 用 rAF + setInterval 双驱动：某些嵌入式 WebView 或被遮挡的标签页会暂停 rAF，
 * 只靠 rAF 会让整个场景卡住。两者都走同一个 step()，靠时间戳去重，
 * 正常情况下 rAF 帧先跑，定时器帧会被跳过。
 */
export default class Time extends EventEmitter {
  constructor() {
    super()

    this.start = performance.now()
    this.current = this.start
    this.elapsed = 0
    this.delta = 1 / 60

    this.frame = 0
    this.minFrameInterval = 8

    this.loop = this.loop.bind(this)

    this.raf = requestAnimationFrame(this.loop)
    this.interval = setInterval(this.loop, 33)
  }

  loop() {
    const now = performance.now()
    // 同一帧内只更新一次
    if (now - this.current < this.minFrameInterval) return

    // 钳制 delta，切标签页回来时不会因为一帧几百毫秒把物理算飞
    this.delta = Math.min((now - this.current) / 1000, 1 / 20)
    this.current = now
    this.elapsed += this.delta
    this.frame++

    this.trigger('tick')

    this.raf = requestAnimationFrame(this.loop)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    clearInterval(this.interval)
    this.off('tick')
  }
}
