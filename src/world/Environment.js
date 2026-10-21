import * as THREE from 'three'
import { PALETTE, material, signalMaterial } from '../core/Palette.js'
import Sky from './Sky.js'
import Terrain from './Terrain.js'

/**
 * 场地环境：地形、天球、光、雾、边界。
 *
 * 这一版的取向是「黄昏的户外空地」，不是「室内展厅」。
 * 三条硬规则，都是从调研里抄来的：
 *
 *   1. 雾色 = 天际线色。两者不一致的话，远处地面和天空之间会出现一条硬边，
 *      整个纵深就废了。
 *   2. 光要有方向。主光一盏负责形体和阴影，半球光只负责「暗部不死黑」，
 *      再加一盏低强度的暖色补光模拟地面反弹。
 *   3. 边界不能是一条发光的直线框，要是被设计过的矮石墙 + 立柱。
 *      发光边框是最像调试台的东西，没有之一。
 */
export default class Environment {
  constructor(_options = {}) {
    this.physics = _options.physics
    this.sizes = _options.sizes
    this.renderer = _options.renderer

    /** 可行走半径。边界墙在这里，地形从这里之外开始抬升 */
    this.playRadius = _options.playRadius || 36

    this.container = new THREE.Group()
    this.container.name = 'environment'

    this.sun = null
    this.lastShadowPosition = new THREE.Vector3(9999, 0, 9999)

    this.setTerrain()
    this.setSky()
    this.setLights()
    this.setFog()
    this.setBoundary()
  }

  // ---------------- 地形 ----------------

  setTerrain() {
    this.terrain = new Terrain({ playRadius: this.playRadius })
    this.container.add(this.terrain.mesh)

    // 物理地面：一张无限水平面。
    // 可行走区在物理上是平的（角色的落地高度由它决定），
    // 所以地形在 playRadius 以内也必须是平的，两者才对得上。
    this.physics.addGround()
  }

  // ---------------- 天球 ----------------

  setSky() {
    this.sky = new Sky()
    this.container.add(this.sky.mesh)
  }

  // ---------------- 光 ----------------

  setLights() {
    // 半球光：冷天 + 冷紫的地面。只负责把暗部提起来，不负责造型。
    // 天的颜色要冷 —— 暖色留给天空和远景，近景要是也被染成橙的，
    // 整幅画就只剩一个色相，什么层次都没了。
    this.hemisphere = new THREE.HemisphereLight(0x7d94d0, 0x4a4058, 0.95)
    this.container.add(this.hemisphere)

    // 主光：从右侧偏后打过来，38° 高度角。
    // 高度角不能低于 ~35°：山脊在 54m 外，影子会扫进场地，
    // 而阴影贴图只覆盖角色周围 ±26m，远处的山影接不上，会出现硬边。
    // 38° 是压着这条线取的：山影刚好落在场外，
    // 但路标柱和石块的影子被拉长到 2~3 倍，地面就不空了。
    this.sunDirection = new THREE.Vector3(0.772, 0.616, 0.157).normalize()

    // 主光接近中性暖白，不给饱和橙。
    // 暖调是从天空和雾里来的，不是从主光来的。
    const sun = new THREE.DirectionalLight(0xffeacb, 2.9)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 110
    // ±26m：1024² 覆盖 52m 是 0.05 单位/texel，
    // 走位范围内的小物件（草丛、石块）也能投出干净的影子。
    sun.shadow.camera.left = -26
    sun.shadow.camera.right = 26
    sun.shadow.camera.top = 26
    sun.shadow.camera.bottom = -26
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.03
    sun.shadow.camera.updateProjectionMatrix()

    this.sun = sun
    this.container.add(sun)
    this.container.add(sun.target)

    // 补光：来自主光反方向的暖色，模拟地面/墙面的反弹。
    // 不投影，只把背光面从死黑里拉出来。
    this.bounce = new THREE.DirectionalLight(0xd99a72, 0.38)
    this.bounce.position.set(-24, 9, -14)
    this.container.add(this.bounce)
  }

  // ---------------- 雾 ----------------

  setFog() {
    // 雾色必须和天球的地平线色一致。
    // near 要够远：雾一上来就把中景吃掉的话，地面自己的颜色全没了，
    // 整个画面只剩天际线那一个橙。
    this.fog = new THREE.Fog(PALETTE.fog, 38, 138)
    return this.fog
  }

  // ---------------- 边界 ----------------

  /**
   * 一圈矮石墙 + 立柱 + 灯。
   *
   * 替代原来的「发光边框」：同样是界定边界，但看起来是有人设计过的，
   * 而不是编辑器里拖出来的框。物理碰撞也跟着它走，
   * 玩家不会撞到看不见的墙。
   */
  setBoundary() {
    const segments = 36
    const radius = this.playRadius
    const arc = (Math.PI * 2 * radius) / segments
    const length = arc * 0.78
    const wallHeight = 1.15
    const thickness = 0.48

    const wallMaterial = material('bodySecondary')
    const capMaterial = material('trim')
    const postMaterial = material('bodySecondary')
    const lampMaterial = signalMaterial(PALETTE.emissiveSignal)

    const wallGeometry = new THREE.BoxGeometry(length, wallHeight, thickness)
    const capGeometry = new THREE.BoxGeometry(length, 0.09, thickness + 0.14)
    const postGeometry = new THREE.CylinderGeometry(0.2, 0.25, 2.2, 8)
    const lampGeometry = new THREE.SphereGeometry(0.17, 10, 8)

    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, segments)
    const caps = new THREE.InstancedMesh(capGeometry, capMaterial, segments)
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, segments)
    const lamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, segments)

    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3(1, 1, 1)
    const up = new THREE.Vector3(0, 1, 0)

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2

      // 石墙段
      position.set(Math.sin(angle) * radius, wallHeight / 2, Math.cos(angle) * radius)
      quaternion.setFromAxisAngle(up, angle)
      matrix.compose(position, quaternion, scale)
      walls.setMatrixAt(i, matrix)

      // 压顶
      position.set(Math.sin(angle) * radius, wallHeight + 0.045, Math.cos(angle) * radius)
      matrix.compose(position, quaternion, scale)
      caps.setMatrixAt(i, matrix)

      // 立柱放在两段之间的缺口上
      const postAngle = ((i + 0.5) / segments) * Math.PI * 2
      const px = Math.sin(postAngle) * radius
      const pz = Math.cos(postAngle) * radius
      position.set(px, 1.1, pz)
      quaternion.setFromAxisAngle(up, postAngle)
      matrix.compose(position, quaternion, scale)
      posts.setMatrixAt(i, matrix)

      // 每三根立柱顶上一盏灯
      if (i % 3 === 0) {
        position.set(px, 2.32, pz)
        matrix.compose(position, quaternion, scale)
        lamps.setMatrixAt(i, matrix)
      } else {
        matrix.compose(new THREE.Vector3(0, -999, 0), quaternion, scale)
        lamps.setMatrixAt(i, matrix)
      }

      // 物理：每段墙一个盒子。归 2 号分组，相机遮挡射线会跳过它们。
      // 碰撞盒要**比可见的墙段长**：可见段只占圆周的 78%（留缺口给立柱），
      // 碰撞盒如果照抄这个长度，段与段之间会留下 1m 多的缝，
      // 玩家能从缝里挤出去。
      this.physics.addBox({
        x: Math.sin(angle) * radius,
        y: wallHeight / 2,
        z: Math.cos(angle) * radius,
        width: arc * 1.04,
        height: wallHeight * 2,
        depth: thickness,
        rotationY: angle,
        group: 2,
      })
    }

    for (const mesh of [walls, caps, posts, lamps]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      this.container.add(mesh)
    }

    // 灯不投影（自发光的小球投出来的影子没有意义，还浪费阴影通道）
    lamps.castShadow = false
  }

  // ---------------- 每帧 ----------------

  /**
   * 阴影相机跟着角色走，阴影贴图手动刷新。
   *
   * 阴影贴图默认每帧重算，但场景是静态的、只有角色在动。
   * 关掉自动更新，只在角色真的移动过时手动标脏一次，
   * 阴影通道的开销直接降到接近零。
   */
  update(_position) {
    if (!this.sun || !_position) return

    this.sun.position.copy(_position).addScaledVector(this.sunDirection, 42)
    this.sun.target.position.copy(_position)
    this.sun.target.updateMatrixWorld()

    if (this.renderer && this.lastShadowPosition.distanceToSquared(_position) > 0.01) {
      this.renderer.shadowMap.needsUpdate = true
      this.lastShadowPosition.copy(_position)
    }
  }

  /** 质量档位：影响阴影贴图与像素比 */
  setQuality(_level) {
    const sun = this.sun
    if (!sun) return

    if (_level === 'low') {
      sun.castShadow = false
    } else if (_level === 'medium') {
      sun.castShadow = true
      sun.shadow.mapSize.set(1024, 1024)
    } else {
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
    }

    if (sun.shadow.map) {
      sun.shadow.map.dispose()
      sun.shadow.map = null
    }

    if (this.renderer) this.renderer.shadowMap.needsUpdate = true
  }

  dispose() {
    this.terrain.dispose()
    this.sky.dispose()
  }
}
