import * as THREE from 'three'

/**
 * 场景色板与材质角色。
 *
 * 这是整个站唯一的一份颜色定义。所有材质都从这里取色，
 * 不允许在别处写临时色号 —— 否则调一次配色要翻十几个文件。
 *
 * 配色取向：黄昏 + 档案纸。暖橙的天际线对上冷紫的地面，
 * 展台各自一个低饱和强调色。不用霓虹，不用纯黑。
 */
export const PALETTE = {
  // ---- 天空三段：顶 / 地平线 / 地平线以下 ----
  // 顶色不能太暗：ACES 色调映射会把暗部再压一档，
  // 太暗的话画面上半截会变成一块死黑。
  skyTop: 0x2b3560,
  skyHorizon: 0xd08a5e,
  skyBottom: 0x2a2231,

  // ---- 雾 ----
  // 必须等于 skyHorizon。雾色和天际线色不一致的话，
  // 远处地面和天空之间会出现一条硬边，整个纵深就废了。
  fog: 0xd08a5e,

  // ---- 地面 ----
  groundLight: 0x57495a,
  groundDark: 0x2f2836,
  groundEdge: 0x1d1a26,

  // ---- 结构件 ----
  bodyPrimary: 0x7f7666, // 石柱、台座的主色（暖灰）
  bodySecondary: 0x4c4658, // 次级构件、梁、边界矮墙
  trim: 0xcbb894, // 边缘高光、装饰条

  // ---- 信号 ----
  emissiveSignal: 0xffb86b, // 发光信号色，和天际线呼应

  // ---- 接触与贴花 ----
  groundContact: 0x181422, // 假接触阴影
  decalDark: 0x241f2e,
  decalLight: 0xf2e7d3,

  // ---- 文字 ----
  textPrimary: 0xf2e7d3,
  textMuted: 0xa89c8c,
  textDim: 0x6f6558,
}

/**
 * 展台强调色。同一套黄昏底色上取的低饱和色相，
 * 每个展台一个，够区分又不打架。
 */
export const ACCENTS = {
  sand: '#e8c88a',
  rust: '#e0705c',
  steel: '#7fa8c9',
  sage: '#9ac49b',
}

/** 卡通明暗的分级。3 档：暗部 / 中间调 / 亮部。 */
const TOON_STEPS = [0.42, 0.74, 1.0]

let gradientMap = null

/**
 * 卡通明暗的渐变贴图。
 *
 * 用 MeshToonMaterial + 这张 1D 贴图，在经典 WebGL 管线里
 * 就能拿到「两段式硬边明暗」——效果和 Bruno 用 TSL 手搓的
 * core shadow 是同一个意思，实现方式完全不同（他那条要 WebGPU）。
 */
export function getToonGradient() {
  if (gradientMap) return gradientMap

  const data = new Uint8Array(TOON_STEPS.length * 4)
  TOON_STEPS.forEach((_value, _index) => {
    const c = Math.round(_value * 255)
    data[_index * 4 + 0] = c
    data[_index * 4 + 1] = c
    data[_index * 4 + 2] = c
    data[_index * 4 + 3] = 255
  })

  const texture = new THREE.DataTexture(data, TOON_STEPS.length, 1, THREE.RGBAFormat)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  gradientMap = texture
  return texture
}

/**
 * 材质角色表。
 *
 * 角色是「这个零件在场景里扮演什么」，不是「它是什么颜色」。
 * 同一个角色在所有地方用同一个材质实例，draw call 和
 * 材质数量都压得住。
 */
const ROLES = {
  /** 主体外壳：石柱、台座、墙体 */
  bodyPrimary: { color: PALETTE.bodyPrimary, flatShading: true },
  /** 次级构件：梁、台阶、边框 */
  bodySecondary: { color: PALETTE.bodySecondary, flatShading: true },
  /** 边缘装饰条 */
  trim: { color: PALETTE.trim, flatShading: true },
  /** 发光信号：灯头、指示条 */
  emissiveSignal: { color: PALETTE.emissiveSignal, emissive: PALETTE.emissiveSignal, emissiveIntensity: 1.4 },
  /** 接触阴影受体 */
  groundContact: { color: PALETTE.groundContact },
  /** 深色贴花面 */
  decalDark: { color: PALETTE.decalDark },
  /** 浅色贴花面 */
  decalLight: { color: PALETTE.decalLight },
}

/**
 * 按角色拿材质。
 *
 * @param {string} _role 角色名
 * @param {object} [_options] 覆盖项（color / flatShading / transparent / vertexColors …）
 * @returns {THREE.Material}
 */
export function material(_role, _options = {}) {
  const role = ROLES[_role]
  if (!role) throw new Error(`未知材质角色：${_role}`)

  const options = { ...role, ..._options }

  // 自发光的不走 toon（它不吃光），普通材质全部走 toon 渐变
  if (!options.emissive) {
    options.gradientMap = getToonGradient()
  }

  const MaterialClass = options.emissive
    ? THREE.MeshLambertMaterial
    : THREE.MeshToonMaterial

  // flatShading 必须构造完再赋值：
  // three r169 的 MeshToonMaterial 没有声明这个属性，
  // 在构造函数里传会触发「is not a property of this material」的警告。
  // 但 WebGLPrograms 是通用读 `material.flatShading === true` 的，
  // 所以构造后赋值一样生效。
  const flatShading = options.flatShading
  delete options.flatShading

  const material = new MaterialClass(options)
  if (flatShading) {
    material.flatShading = true
    material.needsUpdate = true
  }
  material.name = _role
  return material
}

/**
 * 自发光材质：不吃环境光，直接发亮。
 * 用于灯头、指示条这类「信号」件。
 */
export function signalMaterial(_color, _options = {}) {
  return new THREE.MeshBasicMaterial({ color: _color, ..._options })
}
