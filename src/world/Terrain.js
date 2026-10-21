import * as THREE from 'three'
import { PALETTE, getToonGradient } from '../core/Palette.js'
import { fbm } from '../utils/noise.js'
import { createNoiseTexture } from '../utils/textures.js'

/**
 * 地形。
 *
 * 之前是一张无限平面 + 网格贴图，看起来像调试台。
 * 现在换成两段：
 *
 *   1. 可行走区（半径 playRadius 以内）是**平的** ——
 *      因为角色的落地高度由物理引擎的地面决定，地形起伏会和它打架。
 *      平整不代表难看：明暗层次交给顶点色和噪声贴图，立体感交给地面上的物件。
 *
 *   2. 可行走区之外是**抬起来的一圈山脊** ——
 *      它替代了原来那圈"发光边框墙"来界定边界：
 *      远处不是一张平铺到地平线的纸，而是一道起伏的天际线。
 *
 * 顶点色用两层噪声做色斑（湿/干两种土色），
 * 这比一张平铺贴图耐看得多 —— 平铺贴图在低多边形平面上会看出重复。
 */
export default class Terrain {
  constructor(_options = {}) {
    this.size = _options.size || 320
    this.segments = _options.segments || 80
    this.playRadius = _options.playRadius || 36

    // 山脊：从 ridgeStart 开始抬升，到 ridgeStart + ridgeSpan 达到最大高度
    this.ridgeStart = _options.ridgeStart || 54
    this.ridgeSpan = _options.ridgeSpan || 66
    this.ridgeHeight = _options.ridgeHeight || 18

    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments)
    this.geometry.rotateX(-Math.PI / 2)

    // 地表贴图：一张低对比的程序化噪声。
    // 顶点色负责大尺度的色斑（湿土/干土），这张贴图负责顶点之下的细节 ——
    // 网格只有 4m 一格，光靠顶点色的话，两个顶点之间是完全平的，
    // 贴上这张之后才有"土面"的质感。
    // 基色接近白，只做明暗调制，不抢顶点色的颜色。
    this.detailTexture = createNoiseTexture({
      size: 512,
      base: '#ffffff',
      dark: '#d9d2c8',
      light: '#ffffff',
      seed: 7,
      repeat: 10,
      speckles: 420,
    })

    this.material = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getToonGradient(),
      map: this.detailTexture,
      flatShading: true,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'terrain'
    this.mesh.receiveShadow = true
    this.mesh.castShadow = false
    this.mesh.matrixAutoUpdate = false

    this.applyHeights()
    this.applyVertexColors()
    this.mesh.updateMatrix()
  }

  /**
   * 某个坐标的地面高度。
   * 场景里所有要贴地的东西（石块、草丛、展台、角色阴影）都问它。
   */
  heightAt(_x, _z) {
    const r = Math.hypot(_x, _z)
    if (r <= this.ridgeStart) return 0

    const t = Math.min(1, (r - this.ridgeStart) / this.ridgeSpan)
    const t2 = t * t

    // 噪声让山脊不是一圈光滑的碗，而是一道有起伏的天际线
    const n = fbm(_x * 0.011 + 13.7, _z * 0.011 - 7.3, 4)

    return t2 * this.ridgeHeight * (0.45 + n * 1.0)
  }

  applyHeights() {
    const position = this.geometry.attributes.position
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)
      position.setY(i, this.heightAt(x, z))
    }
    position.needsUpdate = true
    this.geometry.computeVertexNormals()
  }

  /**
   * 顶点色：两层噪声做色斑。
   *
   * 大尺度决定"这一片是干土还是湿地"，小尺度打散边界，
   * 免得出现一圈一圈的等高线状色带。
   */
  applyVertexColors() {
    const position = this.geometry.attributes.position
    const colors = new Float32Array(position.count * 3)

    // 三种土色：湿的（冷紫）、干的（暖褐）、苔（橄榄绿）。
    // 只有两种色相的时候，地面就是一片均匀的紫；
    // 多掺一种，地面才有"不同地方不一样"的感觉。
    // 整体亮度不能压太低：近景地面占画面下三分之一，
    // 太暗的话那一带直接糊成一块黑。
    const damp = new THREE.Color(0x413a58)
    const dry = new THREE.Color(0x7a685c)
    const moss = new THREE.Color(0x525d45)
    const shade = new THREE.Color(0x2c2636)

    const color = new THREE.Color()

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)

      const large = fbm(x * 0.026 + 4.2, z * 0.026 - 9.6, 3)
      const fine = fbm(x * 0.11 - 21.3, z * 0.11 + 5.8, 2)

      const blend = Math.min(1, Math.max(0, large * 0.86 + fine * 0.34 - 0.06))
      color.copy(damp).lerp(dry, blend)

      // 苔藓只长在另一层噪声圈出的斑块里，不跟主色相混
      const mossNoise = fbm(x * 0.042 + 51.7, z * 0.042 - 23.1, 2)
      if (mossNoise > 0.56) {
        color.lerp(moss, Math.min(1, (mossNoise - 0.56) * 2.4))
      }

      // 山脊上再压暗一点，配合远景雾形成层次
      const r = Math.hypot(x, z)
      if (r > this.ridgeStart) {
        const t = Math.min(1, (r - this.ridgeStart) / this.ridgeSpan)
        color.lerp(shade, t * 0.55)
      }

      colors[i * 3 + 0] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }

    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }

  dispose() {
    this.detailTexture.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}
