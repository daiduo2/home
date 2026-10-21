import * as THREE from 'three'
import createLabelTexture from '../utils/labelTexture.js'

/**
 * 地标系统。
 * 场景里的每个"展台"都是一条数据记录：位置、文案、链接。
 * 框架先跑起来，内容后填 —— 往 data/landmarks.js 里加一条记录就会多一个展台。
 */
export default class Landmarks {
  constructor(_options = {}) {
    this.physics = _options.physics
    this.data = _options.data || []

    this.container = new THREE.Group()
    this.container.name = 'landmarks'

    this.items = []
    this.active = null

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

    const accent = _entry.accent || '#6366f1'

    // 底座
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c1c28,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    })
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.22, 6), baseMaterial)
    base.position.y = 0.11
    base.castShadow = true
    base.receiveShadow = true
    group.add(base)

    // 发光边条
    const rimMaterial = new THREE.MeshBasicMaterial({ color: accent })
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.03, 6), rimMaterial)
    rim.position.y = 0.23
    group.add(rim)

    // 立牌
    const texture = createLabelTexture({
      title: _entry.title,
      subtitle: _entry.subtitle,
      badge: _entry.badge,
      accent,
    })
    const boardMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: false })
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), boardMaterial)
    board.position.set(0, 2.1, 0.1)
    group.add(board)

    // 背板（避免从背面看穿）
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x16161f, roughness: 1 })
    )
    back.position.set(0, 2.1, 0.08)
    back.rotation.y = Math.PI
    group.add(back)

    // 支架
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2a38, roughness: 0.8 })
    )
    pole.position.y = 0.92
    group.add(pole)

    // 物理：底座给一个矮墙，防止角色穿过展台
    this.physics.addBox({
      x: group.position.x,
      y: 0.35,
      z: group.position.z,
      width: 2.2,
      height: 0.7,
      depth: 2.2,
    })

    return {
      entry: _entry,
      group,
      board,
      back,
      base,
      rim,
      texture,
      radius: _entry.radius || 3.2,
    }
  }

  /**
   * 立牌始终朝向相机。
   * 牌面如果固定朝向，玩家从侧后方过来就只看到黑背板。
   *
   * 关键：转的是 group（整个展台），而不是 board。
   * board 是 group 的子节点，转 board 会被 group.rotation.y 再叠一次，
   * 结果背板会转到牌子前面，把半个画面挡住。
   */
  faceCamera(_cameraPosition) {
    for (const item of this.items) {
      const dx = _cameraPosition.x - item.group.position.x
      const dz = _cameraPosition.z - item.group.position.z
      item.group.rotation.y = Math.atan2(dx, dz)
    }
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
      item.texture.dispose()
    }
  }
}
