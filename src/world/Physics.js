import * as CANNON from 'cannon-es'

/**
 * 射线检测时用的碰撞掩码：跳过 2 号分组。
 * 2 号分组是场地边界墙 —— 远景相机会落在场地外，
 * 如果射线撞上边界墙，相机会被硬拽回角色身边，取景就废了。
 */
const RAY_MASK = -3

/**
 * 物理世界（cannon-es）。
 * 3d-folio 用的是 cannon 0.6.2 + RaycastVehicle；步行角色不需要车辆物理，
 * 只用到刚体、球体碰撞与射线检测，这些在 cannon-es 里都是稳定 API。
 */
export default class Physics {
  /** 射线掩码：跳过 2 号分组（场地边界墙） */
  static RAY_MASK = RAY_MASK

  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -24, 0),
    })

    this.world.broadphase = new CANNON.SAPBroadphase(this.world)
    this.world.allowSleep = true
    this.world.solver.iterations = 10
    this.world.defaultContactMaterial.friction = 0
    this.world.defaultContactMaterial.restitution = 0

    // 角色与场景的接触材质：摩擦设为 0，由脚本自己控制移动，贴地才稳
    this.characterMaterial = new CANNON.Material('character')
    this.worldMaterial = new CANNON.Material('world')
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.characterMaterial, this.worldMaterial, {
        friction: 0,
        restitution: 0,
      })
    )

    this.fixedTimeStep = 1 / 60
    this.accumulator = 0

    this.bodies = []
  }

  addBody(_body) {
    this.world.addBody(_body)
    this.bodies.push(_body)
    return _body
  }

  /** 静态地面：用一个无限大的水平面 */
  addGround(_options = {}) {
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.worldMaterial,
    })
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    body.position.set(_options.x || 0, _options.y || 0, _options.z || 0)
    this.addBody(body)
    return body
  }

  /** 静态盒子：墙、台阶、展台 */
  addBox(_options = {}) {
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(
        new CANNON.Vec3(
          (_options.width || 1) / 2,
          (_options.height || 1) / 2,
          (_options.depth || 1) / 2
        )
      ),
      material: this.worldMaterial,
    })
    body.position.set(_options.x || 0, _options.y || 0, _options.z || 0)
    if (_options.rotationY) {
      body.quaternion.setFromEuler(0, _options.rotationY, 0)
    }
    // 碰撞分组：边界墙放 2 号，射线检测时跳过它们
    // （远景相机会落在场地外，不然会被边界墙把镜头硬拽回来）
    if (_options.group) {
      body.collisionFilterGroup = _options.group
    }
    this.addBody(body)
    return body
  }

  /** 从 from 向下打一条射线，返回命中信息或 null */
  raycastDown(_from, _distance) {
    const to = new CANNON.Vec3(_from.x, _from.y - _distance, _from.z)
    const result = new CANNON.RaycastResult()
    this.world.raycastClosest(
      new CANNON.Vec3(_from.x, _from.y, _from.z),
      to,
      { collisionFilterMask: Physics.RAY_MASK, skipBackfaces: true },
      result
    )
    return result.hasHit ? result : null
  }

  /** 从 from 指向 to 的射线，返回 {distance, point, normal} 或 null */
  raycastClosestPoint(_from, _to) {
    const result = new CANNON.RaycastResult()
    this.world.raycastClosest(
      new CANNON.Vec3(_from.x, _from.y, _from.z),
      new CANNON.Vec3(_to.x, _to.y, _to.z),
      { collisionFilterMask: Physics.RAY_MASK, skipBackfaces: true },
      result
    )
    if (!result.hasHit) return null
    return {
      distance: result.distance,
      point: result.hitPointWorld,
      normal: result.hitNormalWorld,
    }
  }

  update(_delta) {
    // 固定步长累加，避免不同帧率下物理表现不一致
    this.accumulator += _delta
    const maxSubSteps = 5
    this.world.step(this.fixedTimeStep, _delta, maxSubSteps)
  }

  destroy() {
    for (const body of this.bodies) {
      this.world.removeBody(body)
    }
    this.bodies.length = 0
  }
}
