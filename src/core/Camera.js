import * as THREE from 'three'

/**
 * 第三人称跟随相机。
 *
 * 借鉴 brunosimon/folio-2025 的两点：
 *   - 长焦（FOV 36）+ 相机跟在角色斜后方，构图稳，不容易晕
 *   - 跟随带迟滞：角色先动，相机再被"拽"上去
 *
 * 和它不一样的一点：Bruno 固定 45° 方位角、鼠标不控视角；我们是步行探索，
 * 鼠标要能自由转头，所以 yaw/pitch 由输入驱动。
 *
 * 三个容易写错的地方（都踩过）：
 *   1. 相机位置沿"视线反方向"推算，不要用欧拉角硬转 —— 否则 pitch 为正时
 *      相机会被推到地面以下，俯仰完全失效
 *   2. 看向的点要包含 pitch，视角才会真的抬头 / 低头
 *   3. 平滑用帧率无关的指数阻尼（THREE.MathUtils.damp），
 *      逐帧 lerp 在 144Hz 屏上会变快
 */
export default class Camera {
  constructor(_options = {}) {
    this.sizes = _options.sizes
    this.time = _options.time
    this.physics = _options.physics

    this.firstPerson = false

    // 目标角度：输入直接改这两个
    this.yaw = 0
    this.pitch = -0.5

    // 实际使用的角度：阻尼平滑后的结果
    this.smoothYaw = 0
    this.smoothPitch = -0.5

    // 远景：角色只是大场景里的小人，相机拉远抬高
    this.distance = 21
    this.currentDistance = 21
    this.minDistance = 6
    this.maxDistance = 46

    // pitch > 0 抬头，< 0 低头。
    // 远景机位下基本是俯视：抬头到 0.35 就够了，再高相机会往地面以下钻。
    this.minPitch = -1.05
    this.maxPitch = 0.35

    this.height = 1.45
    this.lookAhead = 1.2
    this.minCameraY = 0.45

    this.lookSensitivity = 18

    this.position = new THREE.Vector3(0, 2, 6)
    this.target = new THREE.Vector3(0, 1.4, 0)
    this.direction = new THREE.Vector3(0, 0, -1)
    this.forward = new THREE.Vector3(0, 0, -1)
    this.right = new THREE.Vector3(1, 0, 0)

    this.instance = new THREE.PerspectiveCamera(
      28,
      this.sizes.viewport.width / this.sizes.viewport.height,
      0.1,
      260
    )

    this._target = new THREE.Vector3()
    this._lookPoint = new THREE.Vector3()
    this._desired = new THREE.Vector3()
    this._initialised = false
  }

  setFirstPerson(_value) {
    this.firstPerson = _value
  }

  toggleFirstPerson() {
    this.firstPerson = !this.firstPerson
    return this.firstPerson
  }

  /**
   * 输入层给的是"视角增量"，约定 look.x > 0 = 向右转、look.y > 0 = 向上看。
   * 这里只累加到目标角度，平滑放到 update 里统一做（帧率无关）。
   */
  applyLook(_look) {
    // yaw 减小 = 视线向右转（direction.x = -sin(yaw) 会变大）
    this.yaw -= _look.x
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + _look.y,
      this.minPitch,
      this.maxPitch
    )
  }

  /** 滚轮改距离 */
  zoom(_delta) {
    this.distance = THREE.MathUtils.clamp(
      this.distance + _delta,
      this.minDistance,
      this.maxDistance
    )
  }

  /** 角色水平前向（相机 yaw 决定） */
  getForward() {
    return this.forward
  }

  /** 角色水平右向 */
  getRight() {
    return this.right
  }

  updateAim(_delta) {
    // 角度平滑：damp 是帧率无关的指数阻尼
    this.smoothYaw = THREE.MathUtils.damp(
      this.smoothYaw,
      this.yaw,
      this.lookSensitivity,
      _delta
    )
    this.smoothPitch = THREE.MathUtils.damp(
      this.smoothPitch,
      this.pitch,
      this.lookSensitivity,
      _delta
    )

    // 视线方向：水平部分由 yaw 决定，垂直部分由 pitch 决定
    const cp = Math.cos(this.smoothPitch)
    this.direction.set(
      -Math.sin(this.smoothYaw) * cp,
      Math.sin(this.smoothPitch),
      -Math.cos(this.smoothYaw) * cp
    )

    // 水平前向 / 右向：移动要用，忽略俯仰
    this.forward.set(-Math.sin(this.smoothYaw), 0, -Math.cos(this.smoothYaw))
    this.right.set(Math.cos(this.smoothYaw), 0, -Math.sin(this.smoothYaw))
  }

  updatePosition(_delta, _character) {
    const characterPosition = _character.object.position

    // 注视点：角色胸口
    this._target.set(
      characterPosition.x,
      characterPosition.y + this.height,
      characterPosition.z
    )

    if (this.firstPerson) {
      this._desired.copy(this._target)
      this._desired.y = characterPosition.y + 1.62
      this.instance.position.copy(this._desired)
      this._lookPoint.copy(this._desired).addScaledVector(this.direction, 10)
      this.instance.lookAt(this._lookPoint)
      this.position.copy(this._desired)
      return
    }

    // 期望的相机距离：被墙挡住时拉近
    let wanted = this.distance
    const hit = this.physics
      ? this.physics.raycastClosestPoint(
          { x: this._target.x, y: this._target.y, z: this._target.z },
          {
            x: this._target.x - this.direction.x * this.distance,
            y: this._target.y - this.direction.y * this.distance,
            z: this._target.z - this.direction.z * this.distance,
          }
        )
      : null

    if (hit && hit.distance < wanted) {
      wanted = Math.max(this.minDistance, hit.distance - 0.35)
    }

    // 拉近要快（不能穿墙），推远要慢（避免边缘抖动）
    const lambda = wanted < this.currentDistance ? 22 : 8
    this.currentDistance = THREE.MathUtils.damp(
      this.currentDistance,
      wanted,
      lambda,
      _delta
    )

    // 期望位置：沿视线反方向退开
    this._desired
      .copy(this._target)
      .addScaledVector(this.direction, -this.currentDistance)

    // 别钻进地面以下
    if (this._desired.y < this.minCameraY) {
      this._desired.y = this.minCameraY
    }

    if (!this._initialised) {
      this.instance.position.copy(this._desired)
      this._initialised = true
    } else {
      this.instance.position.copy(this._desired)
    }

    // 看向：角色胸口 + 视线方向的前瞻
    this._lookPoint.copy(this._target).addScaledVector(this.direction, this.lookAhead)
    this.instance.lookAt(this._lookPoint)
    this.position.copy(this.instance.position)
  }

  resize() {
    this.instance.aspect = this.sizes.viewport.width / this.sizes.viewport.height
    this.instance.updateProjectionMatrix()
  }
}
