import * as THREE from 'three'

/**
 * 程序化贴图工具。
 *
 * 场景里没有任何外部素材图：地面、假接触阴影、信号环全部在运行时用
 * canvas 画出来。这里集中放生成器，为的是三件事：
 *
 *   1. 可复现。所有随机都走 mulberry32，同一个 seed 出来的贴图永远一样。
 *      调色的时候不用每次重开页面重新比对，截图即存档。
 *   2. 可控。噪点的对比度、光斑的方向和密度、环的粗细都是参数，
 *      不是散落在各个文件里的"看着差不多"的常量。
 *   3. 零依赖。不需要 simplex-noise，也不需要 sharp —— canvas 自带渐变和
 *      像素操作，够画这些东西了。
 *
 * 模块顶层不碰 document：所有 canvas 都在函数内部创建。这样这个文件
 * 在 node 下也能安全 import（跑构建检查、跑单测时不会因为没有 DOM 崩掉）。
 */

/**
 * mulberry32 伪随机数发生器。
 *
 * 全场景唯一的随机源。禁止在别处直接用 Math.random() ——
 * 那会让每次刷新出来的地面纹理都不一样，视觉调校就变成碰运气。
 *
 * @param {number} _seed 种子，同一个种子永远给同一串数
 * @returns {() => number} 返回 [0, 1) 区间浮点数的函数
 */
export function mulberry32(_seed) {
  let state = _seed >>> 0

  return function () {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 把 #rrggbb / #rgb 转成 RGB 分量。
 * 贴图里要按通道做相对色差运算，用分量比用整串颜色方便。
 *
 * @param {string} _hex 十六进制颜色
 * @returns {{r: number, g: number, b: number}}
 */
function hexToRgb(_hex) {
  let value = String(_hex).trim().replace('#', '')

  if (value.length === 3) {
    value = value
      .split('')
      .map((_c) => _c + _c)
      .join('')
  }

  const int = parseInt(value, 16)
  if (Number.isNaN(int)) return { r: 128, g: 128, b: 128 }

  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  }
}

/** 把通道值夹回 0~255 */
function clamp255(_value) {
  if (_value < 0) return 0
  if (_value > 255) return 255
  return _value
}

/**
 * 地面用的噪声贴图：低对比、有方向、克制。
 *
 * 三层叠加：
 *   1. 底色铺满；
 *   2. 柔和的大色斑 —— 亮斑往左上聚、暗斑往右下聚，模拟一个固定方向的
 *      环境光。各向均匀的斑点看着像"脏"，有方向才像"有光"；
 *   3. 细颗粒 —— 逐像素的低幅抖动加少量 1~2px 的可见颗粒点，
 *      色差控制在 ±5% 以内。颗粒感要的是"有细纹"，不是"有噪点"，
 *      黑白椒盐那种高对比噪点会让地面看起来脏兮兮的。
 *
 * @param {object} [_options]
 * @param {number} [_options.size=512] 画布边长
 * @param {string} [_options.base='#2f2836'] 底色
 * @param {string} [_options.dark='#241f2e'] 暗色斑颜色
 * @param {string} [_options.light='#6a5a63'] 亮色斑颜色
 * @param {number} [_options.seed=1] 随机种子
 * @param {number} [_options.repeat=1] 贴图重复次数
 * @param {number} [_options.speckles=260] 512² 画布上的颗粒点数量
 * @returns {THREE.CanvasTexture}
 */
export function createNoiseTexture(_options = {}) {
  const {
    size = 512,
    base = '#2f2836',
    dark = '#241f2e',
    light = '#6a5a63',
    seed = 1,
    repeat = 1,
    speckles = 260,
  } = _options

  const random = mulberry32(seed)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)

  // ---- 大色斑 ----
  const darkRgb = hexToRgb(dark)
  const lightRgb = hexToRgb(light)
  const blotchCount = 14

  for (let i = 0; i < blotchCount; i++) {
    const isLight = random() < 0.55
    const rgb = isLight ? lightRgb : darkRgb

    // 受光方向：亮斑偏向左上（canvas 的 0,0 在左上），暗斑偏向右下
    const origin = isLight ? 0.12 : 0.42
    const cx = (origin + random() * (1 - origin)) * size
    const cy = (origin + random() * (1 - origin)) * size

    const radius = size * (0.15 + random() * 0.3)
    // alpha 压得低：色斑是"大范围的明暗起伏"，不是"一团一团的颜料"。
    // 受光侧（亮斑）比背光侧（暗斑）略重一点，方向感才拉得出来。
    const alpha = isLight ? 0.12 + random() * 0.1 : 0.1 + random() * 0.08

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`)
    gradient.addColorStop(0.55, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.45})`)
    gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)

    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  // ---- 细颗粒：逐像素低幅抖动 ----
  // 相对色差 ±5% 以内，等价于往相邻色里混一点 alpha 0.02~0.05 的颗粒，
  // 幅度再大就会跳成明显的脏点，也会盖掉大色斑的方向感。
  const image = ctx.getImageData(0, 0, size, size)
  const data = image.data

  for (let i = 0; i < data.length; i += 4) {
    const shift = (random() - 0.5) * 2 * 0.05
    data[i] = clamp255(data[i] + shift * data[i])
    data[i + 1] = clamp255(data[i + 1] + shift * data[i + 1])
    data[i + 2] = clamp255(data[i + 2] + shift * data[i + 2])
  }

  ctx.putImageData(image, 0, 0)

  // ---- 少量 1~2px 的可见颗粒点 ----
  // 密度按面积缩放，换分辨率时颗粒的"每平方密度"保持不变。
  const baseRgb = hexToRgb(base)
  const speckleCount = Math.max(1, Math.round((speckles * size * size) / (512 * 512)))

  for (let i = 0; i < speckleCount; i++) {
    const x = Math.floor(random() * size)
    const y = Math.floor(random() * size)
    const w = 1 + Math.floor(random() * 2)
    const h = 1 + Math.floor(random() * 2)

    // 颗粒取底色本身的亮/暗变体，而不是黑白
    const isLight = random() < 0.5
    const factor = isLight ? 1.08 : 0.92
    const alpha = 0.02 + random() * 0.03

    ctx.fillStyle = `rgba(${Math.round(baseRgb.r * factor)}, ${Math.round(
      baseRgb.g * factor
    )}, ${Math.round(baseRgb.b * factor)}, ${alpha})`
    ctx.fillRect(x, y, w, h)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true

  return texture
}

/**
 * 假接触阴影用的柔和圆斑。
 *
 * 影子不是简单的一层线性渐变：中心有一段实心区（半径到 inner），
 * 然后才平滑衰减到 outer 处归零。实心区让物体的"落点"有重量，
 * 线性渐变会让影子看起来是飘着的。
 *
 * @param {object} [_options]
 * @param {number} [_options.size=256] 画布边长
 * @param {number} [_options.inner=0.28] 实心区半径（相对半边长）
 * @param {number} [_options.outer=0.5] 衰减终点半径（相对半边长）
 * @param {string} [_options.color='24, 20, 34'] RGB 三元组，用逗号分隔
 * @returns {THREE.CanvasTexture}
 */
export function createBlobShadowTexture(_options = {}) {
  const { size = 256, inner = 0.28, outer = 0.5, color = '24, 20, 34' } = _options

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const half = size / 2
  const innerRadius = inner * half
  const outerRadius = outer * half
  const innerStop = innerRadius / outerRadius

  const gradient = ctx.createRadialGradient(half, half, 0, half, half, outerRadius)

  // 中心实心区
  gradient.addColorStop(0, `rgba(${color}, 1)`)
  gradient.addColorStop(innerStop, `rgba(${color}, 0.92)`)
  // 衰减段用多级 stop 近似一条曲线：直线渐变会在边缘留一圈硬边
  const falloff = 1 - innerStop
  gradient.addColorStop(innerStop + falloff * 0.35, `rgba(${color}, 0.55)`)
  gradient.addColorStop(innerStop + falloff * 0.7, `rgba(${color}, 0.18)`)
  gradient.addColorStop(1, `rgba(${color}, 0)`)

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  return texture
}

/**
 * 发光信号环（空心圆环）。
 *
 * 用在展台和灯上做"这里有信号"的提示。环内完全透明，
 * alpha 在 inner→outer 之间起落，外沿比内沿淡一点，
 * 免得看起来像一圈硬塑料片。
 *
 * @param {object} [_options]
 * @param {number} [_options.size=256] 画布边长
 * @param {number} [_options.inner=0.62] 环内沿半径（相对半边长）
 * @param {number} [_options.outer=0.78] 环外沿半径（相对半边长）
 * @param {string} [_options.color='255, 184, 107'] RGB 三元组，用逗号分隔
 * @returns {THREE.CanvasTexture}
 */
export function createRingTexture(_options = {}) {
  const { size = 256, inner = 0.62, outer = 0.78, color = '255, 184, 107' } = _options

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const half = size / 2
  const innerRadius = inner * half
  const outerRadius = outer * half
  const innerStop = innerRadius / outerRadius

  const gradient = ctx.createRadialGradient(half, half, 0, half, half, outerRadius)

  gradient.addColorStop(0, `rgba(${color}, 0)`)
  gradient.addColorStop(innerStop, `rgba(${color}, 0)`)
  // 亮心偏内侧，外沿自然更淡 —— 环看着像在发光，而不是被画上去的
  gradient.addColorStop(innerStop + (1 - innerStop) * 0.35, `rgba(${color}, 1)`)
  gradient.addColorStop(innerStop + (1 - innerStop) * 0.75, `rgba(${color}, 0.45)`)
  gradient.addColorStop(1, `rgba(${color}, 0)`)

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  return texture
}
