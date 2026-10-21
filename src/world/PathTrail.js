import * as THREE from 'three'
import { getToonGradient } from '../core/Palette.js'

/**
 * 土路。
 *
 * 为什么需要它：相机跟在角色身后二十几米，画面下缘落在「角色刚走过的那段路」
 * 上。而路径走廊本来就是净空区（不放石头、不长草），于是那一带必然是一片空地，
 * 画面下三分之一就没有任何东西。
 *
 * 一条可见的土路同时解决三件事：
 *   1. 把空地填上，画面下缘有结构；
 *   2. 告诉访客「往那边走」——出生点和四座展台之间的关系变得可读；
 *   3. 给镜头一个引导线，视线自然跟着路走。
 *
 * 实现上是一条贴着地面的窄带（ribbon）：
 *   - 横向 5 条顶点，边缘 alpha 归零 → 软边，不会出现一条生硬的色块边；
 *   - 半宽沿路变化（两头窄中间宽）→ 不像尺子画出来的；
 *   - 抬离地面 1.5cm 并开 polygonOffset → 不和地形抢深度。
 *
 * 为什么不直接画进地形顶点色：地形网格 4 米一格，
 * 一条 2 米宽的路用顶点色根本画不出来。
 */

/** 横向采样：t 是横向归一化坐标，alpha 是该处的不透明度 */
const ACROSS = [
  { t: -1.0, alpha: 0.0 },
  { t: -0.62, alpha: 0.52 },
  { t: 0.0, alpha: 0.8 },
  { t: 0.62, alpha: 0.52 },
  { t: 1.0, alpha: 0.0 },
]

export default class PathTrail {
  /**
   * @param {object} _options
   * @param {object} [_options.terrain] 需要提供 heightAt(x, z)
   * @param {number} [_options.halfWidth=1.05] 路的半宽（米）
   * @param {number} [_options.samples=56] 每条路沿长度方向的采样数
   * @param {number} [_options.lift=0.015] 离地高度，避开 z-fighting
   */
  constructor(_options = {}) {
    this.terrain = _options.terrain
    this.halfWidth = _options.halfWidth ?? 1.05
    this.samples = _options.samples ?? 56
    this.lift = _options.lift ?? 0.015

    this.container = new THREE.Group()
    this.container.name = 'path-trail'

    this.geometry = null
    this.material = null
    this.mesh = null
  }

  /**
   * 生成路面。
   * @param {Array<{curve: THREE.Curve}>} _paths
   */
  build(_paths) {
    if (!Array.isArray(_paths) || _paths.length === 0) return this

    const positions = []
    const colors = []
    const normals = []
    const indices = []

    const core = new THREE.Color(0x8a7358) // 踩实的干土
    const dust = new THREE.Color(0xa89170) // 扬起来的浮土
    const color = new THREE.Color()

    for (let pi = 0; pi < _paths.length; pi++) {
      const path = _paths[pi]
      if (!path || !path.curve) continue

      const rowStart = positions.length / 3

      for (let i = 0; i <= this.samples; i++) {
        const u = i / this.samples
        const point = path.curve.getPointAt(u)
        const tangent = path.curve.getTangentAt(u)

        // 垂直于路径方向（在水平面内）
        const nx = -tangent.z
        const nz = tangent.x

        // 半宽：两端收窄、中间放宽，再叠一点低频抖动，
        // 免得每条路都长得一模一样
        const taper = 0.68 + 0.42 * Math.sin(u * Math.PI)
        const jitter = 0.92 + 0.16 * Math.sin(u * 17.3 + pi * 2.1)
        const width = this.halfWidth * taper * jitter

        // 起点淡入：路不能凭空从脚下冒出来
        const headFade = Math.min(1, u / 0.09)
        // 终点略微收一点，接到展台地盘上
        const tailFade = 1 - 0.25 * Math.max(0, (u - 0.86) / 0.14)

        for (let a = 0; a < ACROSS.length; a++) {
          const slot = ACROSS[a]
          const x = point.x + nx * width * slot.t
          const z = point.z + nz * width * slot.t
          const y = this.heightAt(x, z) + this.lift

          positions.push(x, y, z)
          normals.push(0, 1, 0)

          // 中间踩实、两侧是浮土
          const edge = Math.abs(slot.t)
          color.copy(core).lerp(dust, edge * 0.8)
          const alpha = slot.alpha * headFade * tailFade
          colors.push(color.r, color.g, color.b, alpha)
        }
      }

      // 每两行之间拉一条三角带
      const cols = ACROSS.length
      for (let i = 0; i < this.samples; i++) {
        for (let a = 0; a < cols - 1; a++) {
          const v0 = rowStart + i * cols + a
          const v1 = rowStart + i * cols + a + 1
          const v2 = rowStart + (i + 1) * cols + a
          const v3 = rowStart + (i + 1) * cols + a + 1
          indices.push(v0, v2, v1, v1, v2, v3)
        }
      }
    }

    if (positions.length === 0) return this

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    this.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    // 四分量颜色：alpha 走顶点属性，这是软边的前提
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
    this.geometry.setIndex(indices)
    this.geometry.computeBoundingSphere()

    this.material = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getToonGradient(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'path-trail'
    this.mesh.receiveShadow = true
    this.mesh.castShadow = false
    this.mesh.renderOrder = 1
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()

    this.container.add(this.mesh)
    return this
  }

  heightAt(_x, _z) {
    if (this.terrain && typeof this.terrain.heightAt === 'function') {
      return this.terrain.heightAt(_x, _z)
    }
    return 0
  }

  dispose() {
    if (this.geometry) this.geometry.dispose()
    if (this.material) this.material.dispose()
    this.container.clear()
  }
}
