import * as THREE from 'three'

const UP = new THREE.Vector3(0, 1, 0)
const RIGHT = new THREE.Vector3(1, 0, 0)

/**
 * 相机。
 * 默认第三人称跟随角色（能看见自己站在展台前，符合作品集的展示需求），
 * 可切第一人称（沉浸更强，适合强调氛围的段落）。
 * 第三人称下会向前方做一次射线，避免相机穿进墙里。
 */
export default class Camera {
  constructor(_options = {}) {
    this.sizes = _options.sizes
    this.time = _options.time
    this.physics = _options.physics

    this.firstPerson = false

    this.yaw = 0
    this.pitch = -0.26

    this.distance = 5.4
    this.height = 1.5
    this.minPitch = -1.2
    this.maxPitch = 0.9

    this.position = new THREE.Vector3(0, 2, 6)
    this.target = new THREE.Vector3(0, 1.4, 0)
    this.lookAt = new THREE.Vector3()

    this.instance = new THREE.PerspectiveCamera(
      55,
      this.sizes.viewport.width / this.sizes.viewport.height,
      0.1,
      200
    )

    this._offset = new THREE.Vector3()
    this._desired = new THREE.Vector3()
    this._smoothed = new THREE.Vector3()
    this._initialised = false
  }

  setFirstPerson(_value) {
    this.firstPerson = _value
  }

  toggleFirstPerson() {
    this.firstPerson = !this.firstPerson
    return this.firstPerson
  }

  applyLook(_look) {
    this.yaw += _look.x
    this.pitch = THREE.MathUtils.clamp(this.pitch + _look.y, this.minPitch, this.maxPitch)
  }

  update(_delta, _character) {
    const characterPosition = _character.object.position

    if (this.firstPerson) {
      this._offset.set(0, 1.62, 0)
      this._desired.copy(characterPosition).add(this._offset)
      this.instance.position.copy(this._desired)
      this.instance.rotation.set(0, 0, 0)
      this.instance.rotateY(this.yaw)
      this.instance.rotateX(this.pitch)
      this.position.copy(this._desired)
      return
    }

    // 目标点：角色胸口略高
    this._desired.set(characterPosition.x, characterPosition.y + this.height, characterPosition.z)

    // 相机相对目标的偏移：先沿 yaw 转到水平，再沿 pitch 抬起
    this._offset.set(0, 0, this.distance)
    this._offset.applyAxisAngle(UP, this.yaw)
    this._offset.applyAxisAngle(RIGHT, this.pitch)

    // 遮挡检测：从目标往相机方向打一条射线
    const hit = this.physics
      ? this.physics.raycastClosestPoint(
          { x: this._desired.x, y: this._desired.y, z: this._desired.z },
          {
            x: this._desired.x + this._offset.x,
            y: this._desired.y + this._offset.y,
            z: this._desired.z + this._offset.z,
          }
        )
      : null

    if (hit) {
      const distance = hit.distance
      this._offset.multiplyScalar(Math.max(0.6, (distance - 0.35) / this.distance))
    }

    const finalPosition = this._offset.add(this._desired)

    if (!this._initialised) {
      this._smoothed.copy(finalPosition)
      this._initialised = true
    } else {
      // 指数平滑，与帧率无关
      const damping = 1 - Math.pow(0.0015, _delta)
      this._smoothed.lerp(finalPosition, damping)
    }

    this.instance.position.copy(this._smoothed)
    this.position.copy(this._smoothed)

    // 看向角色前方一点，避免正对后脑勺
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(UP, this.yaw)
    this.lookAt.copy(this._desired).addScaledVector(forward, 1.1)
    this.instance.lookAt(this.lookAt)
  }

  resize() {
    this.instance.aspect = this.sizes.viewport.width / this.sizes.viewport.height
    this.instance.updateProjectionMatrix()
  }
}
