import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { PALETTE, material, signalMaterial } from '../core/Palette.js'
import createBoardTexture from '../utils/labelTexture.js'
import { createBlobShadowTexture } from '../utils/textures.js'

/**
 * 展台。
 *
 * 之前每个展台是「一个六边形底座 + 一张悬空的平面牌子」——
 * 四根杆子杵在空地上，怎么调都像测试台。
 *
 * 现在每个展台是一座小构筑物：地盘、立柱、门楣、嵌在框里的展板。
 * 它同时是三件事：
 *   · 尺度参照（4.3m 高的门，人 1.75m，一眼能看出比例）
 *   · 引导物（走近它，内容才展开）
 *   · 内容载体（远处看标题，近了补摘要）
 *
 * 展板不做 billboard：牌面固定朝向路径，玩家从任何一侧走过来都能读到
 * （贴图双面）。牌面跟着相机转的话，建筑感就没了。
 */

/**
 * 近相机淡出的阈值（米）。
 *
 * 相机在角色身后二十几米，玩家走过一座构筑物时，相机也会从它旁边擦过去。
 * 门楣在 4.9m 高，相机在 3.9m 高，两者一错开，
 * 门楣的边角就会怼进画面右上角 —— 看起来像一块渲染错误的黑斑。
 *
 * 所以相机离构筑物太近时把它淡掉。阈值卡在「门楣刚好开始进画面」的距离：
 * 再远就看得见构筑物本身了，那时候淡掉反而像是建筑凭空消失。
 */
const FADE_NEAR = 3.5
const FADE_FAR = 7
export default class Landmarks {
  constructor(_options = {}) {
    this.physics = _options.physics
    this.data = _options.data || []

    this.container = new THREE.Group()
    this.container.name = 'landmarks'

    this.items = []
    this.active = null
    this.blobTexture = createBlobShadowTexture()

    this.build()
  }
  build() {
    for (const entry of this.data) {
      const item = this.createItem(entry)
      this.items.push(item)
      this.container.add(item.group)
    }
  }

  createItem(_entry) {
    const group = new THREE.Group()
    group.position.set(_entry.position[0], 0, _entry.position[1])
    group.rotation.y = _entry.rotation || 0

    const accent = _entry.accent || '#e8c88a'

    // ---------------- 地盘 ----------------
    // 深色圆盘 + 一圈发光环。发光环是「这里有东西」的信号，
    // 也是唯一一处饱和度高的颜色，所以只给一圈，不给一片。
    const discGeometry = new THREE.CircleGeometry(2.9, 28)
    discGeometry.rotateX(-Math.PI / 2)
    const disc = new THREE.Mesh(discGeometry, material('decalDark', { transparent: true }))
    disc.position.y = 0.02
    disc.receiveShadow = true
    group.add(disc)

    const accentMaterial = signalMaterial(accent, { transparent: true })
    const ringGeometry = new THREE.RingGeometry(2.8, 2.97, 40)
    ringGeometry.rotateX(-Math.PI / 2)

    // ---------------- 立柱 + 门楣 ----------------
    const postGeometry = new THREE.BoxGeometry(0.4, 4.3, 0.4)
    const postLeft = postGeometry.clone()
    postLeft.translate(-2.95, 2.15, 0)
    const postRight = postGeometry.clone()
    postRight.translate(2.95, 2.15, 0)
    postGeometry.dispose()

    const structure = new THREE.Mesh(
      mergeGeometries([postLeft, postRight]),
      material('bodyPrimary', { transparent: true })
    )
    structure.castShadow = true
    structure.receiveShadow = true
    group.add(structure)

    const lintelGeometry = new THREE.BoxGeometry(6.6, 0.55, 0.55)
    lintelGeometry.translate(0, 4.55, 0)
    const lintel = new THREE.Mesh(lintelGeometry, material('bodySecondary', { transparent: true }))
    lintel.castShadow = true
    lintel.receiveShadow = true
    group.add(lintel)

    const trimGeometry = new THREE.BoxGeometry(6.85, 0.12, 0.68)
    trimGeometry.translate(0, 4.9, 0)
    const trim = new THREE.Mesh(trimGeometry, material('trim', { transparent: true }))
    trim.castShadow = true
    group.add(trim)

    // ---------------- 强调条（和环同一个材质，可以合并）----------------
    const barGeometry = new THREE.BoxGeometry(5.0, 0.09, 0.09)
    barGeometry.translate(0, 3.94, 0.06)
    const accentMesh = new THREE.Mesh(
      mergeGeometries([ringGeometry, barGeometry]),
      accentMaterial
    )
    group.add(accentMesh)

    // ---------------- 展板 ----------------
    const boardTexture = createBoardTexture({
      badge: _entry.badge,
      title: _entry.title,
      subtitle: _entry.subtitle,
      summary: _entry.description,
      accent,
      state: 'far',
    })

    const boardMaterial = new THREE.MeshBasicMaterial({
      map: boardTexture,
      side: THREE.DoubleSide,
      transparent: true,
    })
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 3.125), boardMaterial)
    board.position.set(0, 2.5, 0)
    group.add(board)

    // 静态物件不用每帧重算矩阵
    for (const child of group.children) {
      child.updateMatrix()
      child.matrixAutoUpdate = false
    }

    // ---------------- 物理 ----------------
    // 立柱和展板挡人。中间是通的 —— 玩家能走进门楣底下，
    // 站到展板跟前，那才是"走到展台前"。
    const cos = Math.cos(group.rotation.y)
    const sin = Math.sin(group.rotation.y)
    const toWorld = (lx, lz) => ({
      x: group.position.x + lx * cos + lz * sin,
      z: group.position.z - lx * sin + lz * cos,
    })

    for (const lx of [-2.95, 2.95]) {
      const p = toWorld(lx, 0)
      this.physics.addBox({
        x: p.x,
        y: 2.15,
        z: p.z,
        width: 0.5,
        height: 4.3,
        depth: 0.5,
        rotationY: group.rotation.y,
      })
    }

    const panel = toWorld(0, 0)
    this.physics.addBox({
      x: panel.x,
      y: 2.5,
      z: panel.z,
      width: 5.0,
      height: 3.2,
      depth: 0.3,
      rotationY: group.rotation.y,
    })

    return {
      entry: _entry,
      group,
      board,
      boardTexture,
      boardMaterial,
      accentMaterial,
      accentBase: new THREE.Color(accent),
      accentHot: new THREE.Color(accent).lerp(new THREE.Color(0xffffff), 0.45),
      accentMix: 0,
      // 近相机淡出用的材质清单 + 当前不透明度
      fadeMaterials: [disc.material, structure.material, lintel.material, trim.material, accentMaterial, boardMaterial],
      fadeMix: 1,
      radius: _entry.radius || 3.4,
    }
  }

  /**
   * 切换"哪个展台是当前目标"。
   * 靠近时展板补上摘要、强调色提亮；离开时收回。
   */
  setActive(_item) {
    if (this.active === _item) return

    if (this.active) {
      this.active.boardTexture.dispose()
      this.active.boardTexture = createBoardTexture({
        badge: this.active.entry.badge,
        title: this.active.entry.title,
        subtitle: this.active.entry.subtitle,
        summary: this.active.entry.description,
        accent: this.active.entry.accent,
        state: 'far',
      })
      this.active.boardMaterial.map = this.active.boardTexture
      this.active.boardMaterial.needsUpdate = true
    }

    this.active = _item

    if (_item) {
      _item.boardTexture.dispose()
      _item.boardTexture = createBoardTexture({
        badge: _item.entry.badge,
        title: _item.entry.title,
        subtitle: _item.entry.subtitle,
        summary: _item.entry.description,
        accent: _item.entry.accent,
        state: 'near',
      })
      _item.boardMaterial.map = _item.boardTexture
      _item.boardMaterial.needsUpdate = true
    }
  }

  update(_delta, _cameraPosition) {
    for (const item of this.items) {
      const target = item === this.active ? 1 : 0

      if (Math.abs(item.accentMix - target) >= 0.001) {
        // 指数趋近，和相机阻尼一个路子，帧率无关
        item.accentMix += (target - item.accentMix) * (1 - Math.exp(-8 * _delta))
        item.accentMaterial.color.copy(item.accentBase).lerp(item.accentHot, item.accentMix)
      }

      this.updateFade(item, _delta, _cameraPosition)
    }
  }

  /**
   * 近相机淡出。
   *
   * 相机从构筑物旁边擦过去的时候，门楣会顶进画面。
   * 这里把离相机太近的构筑物整体淡掉，而不是让它挡在镜头前。
   */
  updateFade(_item, _delta, _cameraPosition) {
    let wanted = 1

    if (_cameraPosition) {
      const dx = _item.group.position.x - _cameraPosition.x
      const dz = _item.group.position.z - _cameraPosition.z
      const distance = Math.hypot(dx, dz)
      wanted =
        distance >= FADE_FAR
          ? 1
          : distance <= FADE_NEAR
            ? 0
            : (distance - FADE_NEAR) / (FADE_FAR - FADE_NEAR)
    }

    if (Math.abs(_item.fadeMix - wanted) < 0.002) {
      // 稳定态：淡完之后整个 group 直接不画，省掉六次 draw call
      if (_item.fadeMix < 0.999 && _item.group.visible) _item.group.visible = false
      return
    }

    _item.fadeMix += (wanted - _item.fadeMix) * (1 - Math.exp(-9 * _delta))

    const opacity = _item.fadeMix
    for (const m of _item.fadeMaterials) m.opacity = opacity
    _item.group.visible = opacity > 0.01
  }

  /**
   * 找角色附近最近的地标。
   * @returns {object|null}
   */
  findActive(_characterPosition) {
    let best = null
    let bestDistance = Infinity

    for (const item of this.items) {
      const dx = item.group.position.x - _characterPosition.x
      const dz = item.group.position.z - _characterPosition.z
      const distance = Math.hypot(dx, dz)
      if (distance < item.radius && distance < bestDistance) {
        bestDistance = distance
        best = item
      }
    }

    return best
  }

  destroy() {
    for (const item of this.items) {
      item.boardTexture.dispose()
      item.boardMaterial.dispose()
      item.accentMaterial.dispose()
    }
    this.blobTexture.dispose()
  }
}
