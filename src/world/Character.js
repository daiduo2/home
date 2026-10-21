import * as THREE from 'three'
import * as CANNON from 'cannon-es'

const UP = new THREE.Vector3(0, 1, 0)

/**
 * 步行角色。
 * 物理用一个固定旋转的球体（cannon-es 常见做法）：水平速度由脚本接管，
 * 竖直方向交给重力。这样角色不会翻滚、不会卡进地面，也不需要骨骼动画系统。
 * 视觉是程序化搭的低多边形人形，走路时靠腿部摆动表现，与场景的低多边形调性一致。
 */
export default class Character {
  constructor(_options = {}) {
    this.physics = _options.physics
    this.radius = 0.42
    this.height = 1.75

    this.walkSpeed = 4.2
    this.runSpeed = 7.0
    this.acceleration = 28
    this.jumpVelocity = 8.5
    this.groundOffset = this.radius

    this.isGrounded = false
    this.isRunning = false
    this.walkPhase = 0

    this.setMesh()
    this.setBody()
  }

  setMesh() {
    this.object = new THREE.Group()
    this.object.name = 'character'

    const skin = new THREE.MeshStandardMaterial({
      color: 0xf5d0b0,
      roughness: 0.85,
      metalness: 0,
      flatShading: true,
    })
    const shirt = new THREE.MeshStandardMaterial({
      color: 0x6366f1,
      roughness: 0.8,
      metalness: 0.05,
      flatShading: true,
    })
    const pants = new THREE.MeshStandardMaterial({
      color: 0x2b2b3a,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    })

    // 躯干
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), shirt)
    torso.position.y = 1.12
    this.object.add(torso)

    // 头
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 0), skin)
    head.position.y = 1.63
    this.object.add(head)

    // 朝向标记：低多边形脑袋是正反不分的，加个鼻子才知道角色面朝哪
    const face = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.16, 3),
      new THREE.MeshStandardMaterial({ color: 0x2f2320, roughness: 0.9, flatShading: true })
    )
    face.rotation.x = Math.PI / 2
    face.position.set(0, 1.62, 0.19)
    this.object.add(face)

    // 手臂
    this.armLeft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), shirt)
    this.armLeft.position.set(-0.33, 1.14, 0)
    this.armLeft.geometry.translate(0, -0.3, 0)
    this.object.add(this.armLeft)

    this.armRight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), shirt)
    this.armRight.position.set(0.33, 1.14, 0)
    this.armRight.geometry.translate(0, -0.3, 0)
    this.object.add(this.armRight)

    // 腿
    this.legLeft = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.76, 0.17), pants)
    this.legLeft.position.set(-0.14, 0.76, 0)
    this.legLeft.geometry.translate(0, -0.38, 0)
    this.object.add(this.legLeft)

    this.legRight = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.76, 0.17), pants)
    this.legRight.position.set(0.14, 0.76, 0)
    this.legRight.geometry.translate(0, -0.38, 0)
    this.object.add(this.legRight)

    this.object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }

  setBody() {
    const body = new CANNON.Body({
      mass: 70,
      shape: new CANNON.Sphere(this.radius),
      material: this.physics.characterMaterial,
      linearDamping: 0.02,
      angularDamping: 1,
    })
    body.fixedRotation = true
    body.updateMassProperties()
    body.position.set(0, this.groundOffset + 0.05, 0)
    this.body = this.physics.addBody(body)
  }

  get position() {
    return this.body.position
  }

  jump() {
    if (!this.isGrounded) return
    this.body.velocity.y = this.jumpVelocity
    this.isGrounded = false
  }

  /**
   * @param {number} _delta 秒
   * @param {{x:number,y:number}} _move 移动向量，y 为正表示向前
   * @param {{x:number,y:number}} _look 视角增量（弧度），同时用于角色朝向
   * @param {number} _yaw 当前朝向角
   */
  update(_delta, _move, _look, _yaw) {
    this.updateGroundState()

    // 朝向：视角水平增量直接转角色，垂直增量只影响相机
    if (Math.abs(_look.x) > 0.00001) {
      this.object.rotation.y += _look.x
    }

    const targetSpeed = _move.y > 0.1 ? this.runSpeed : this.walkSpeed
    this.isRunning = _move.y > 0.1

    // 把移动向量转到角色局部空间
    const sin = Math.sin(this.object.rotation.y)
    const cos = Math.cos(this.object.rotation.y)
    const localX = _move.x * cos - _move.y * sin
    const localZ = -_move.x * sin - _move.y * cos

    const targetVx = localX * targetSpeed
    const targetVz = localZ * targetSpeed

    const blend = Math.min(1, this.acceleration * _delta)
    this.body.velocity.x += (targetVx - this.body.velocity.x) * blend
    this.body.velocity.z += (targetVz - this.body.velocity.z) * blend

    // 同步视觉
    this.object.position.set(
      this.body.position.x,
      this.body.position.y - this.groundOffset,
      this.body.position.z
    )

    this.updateAnimation(_delta, Math.hypot(localX, localZ))
  }

  updateGroundState() {
    const from = this.body.position
    const hit = this.physics.raycastDown(
      { x: from.x, y: from.y, z: from.z },
      this.radius + 0.22
    )
    this.isGrounded = !!hit
  }

  updateAnimation(_delta, _speed) {
    const moving = _speed > 0.2
    if (moving) {
      this.walkPhase += _delta * (this.isRunning ? 13 : 9)
    } else {
      // 停下时把腿收回来
      this.walkPhase += (0 - (this.walkPhase % (Math.PI * 2))) * 0
    }

    const swing = moving ? Math.sin(this.walkPhase) * 0.62 : 0
    this.legLeft.rotation.x = swing
    this.legRight.rotation.x = -swing
    this.armLeft.rotation.x = -swing * 0.75
    this.armRight.rotation.x = swing * 0.75

    // 站立时轻微上下浮动，避免完全静止
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.05 : Math.sin(this.walkPhase * 0.25) * 0.012
    this.object.children[0].position.y = 1.12 + bob
  }

  destroy() {
    this.object.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
        else child.material.dispose()
      }
    })
  }
}
