import * as THREE from 'three'

/**
 * 场地骨架：地面、边界、光照、雾。
 * 只做"能走、能看"的基础结构，具体的地标和陈设由 Landmarks 与后续内容填。
 *
 * 性能取向（参考 brunosimon/folio-2025 的取舍）：
 *   - 材质用 Lambert 而不是 Standard：低多边形 + 平面着色下观感几乎一样，
 *     片元阶段便宜得多
 *   - 只留一盏方向光 + 半球光，不要第二盏补光（每盏灯都是一次完整光照计算）
 *   - 阴影相机跟着角色走：只覆盖脚下一小块，同样的贴图尺寸能给出更细的阴影，
 *     需要渲染进阴影贴图的东西也少得多
 */
export default class Environment {
  constructor(_options = {}) {
    this.physics = _options.physics
    this.sizes = _options.sizes

    this.area = 46

    this.container = new THREE.Group()
    this.container.name = 'environment'

    this.sun = null

    this.setFloor()
    this.setBorders()
    this.setLights()
    this.setFog()
  }

  setFloor() {
    const texture = this.createGridTexture()
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(this.area / 2, this.area / 2)
    texture.colorSpace = THREE.SRGBColorSpace

    const material = new THREE.MeshLambertMaterial({
      map: texture,
      color: 0xffffff,
    })

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(this.area, this.area), material)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    // 静态物件不用每帧重算矩阵
    floor.updateMatrix()
    floor.matrixAutoUpdate = false
    this.container.add(floor)

    this.physics.addGround()
  }

  createGridTexture() {
    const size = 512
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#16161f'
    ctx.fillRect(0, 0, size, size)

    ctx.strokeStyle = 'rgba(140, 155, 230, 0.26)'
    ctx.lineWidth = 2
    ctx.strokeRect(0, 0, size, size)

    ctx.strokeStyle = 'rgba(140, 155, 230, 0.12)'
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const p = (size / 4) * i
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, p)
      ctx.lineTo(size, p)
      ctx.stroke()
    }

    const texture = new THREE.CanvasTexture(canvas)
    return texture
  }

  setBorders() {
    const half = this.area / 2
    const height = 1.1
    const thickness = 0.5

    const material = new THREE.MeshLambertMaterial({
      color: 0x26263a,
      flatShading: true,
    })

    // 顶边一条发光条：远看是一条亮线标示边界，不会像一堵墙那样挡住地平线
    const rimMaterial = new THREE.MeshBasicMaterial({ color: 0x4f5bd8 })

    const sides = [
      { x: 0, z: -half, w: this.area },
      { x: 0, z: half, w: this.area },
      { x: -half, z: 0, w: this.area },
      { x: half, z: 0, w: this.area },
    ]

    for (const side of sides) {
      const isHorizontal = side.z !== 0
      const width = isHorizontal ? side.w : thickness
      const depth = isHorizontal ? thickness : side.w

      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
      wall.position.set(side.x, height / 2, side.z)
      wall.castShadow = true
      wall.receiveShadow = true
      wall.updateMatrix()
      wall.matrixAutoUpdate = false
      this.container.add(wall)

      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.06, depth),
        rimMaterial
      )
      rim.position.set(side.x, height + 0.03, side.z)
      rim.updateMatrix()
      rim.matrixAutoUpdate = false
      this.container.add(rim)

      this.physics.addBox({
        x: side.x,
        y: height / 2,
        z: side.z,
        width,
        height: height * 2,
        depth,
      })
    }
  }

  setLights() {
    // 半球光当环境光，冷天空 + 暗地面
    const hemisphere = new THREE.HemisphereLight(0xa8b8ff, 0x1c1c28, 1.9)
    this.container.add(hemisphere)

    // 一盏方向光负责阴影。强度给足，靠半球光补暗部。
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 60
    // 阴影相机只覆盖角色周围一小块：贴图更细，开销也更小
    sun.shadow.camera.left = -11
    sun.shadow.camera.right = 11
    sun.shadow.camera.top = 11
    sun.shadow.camera.bottom = -11
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.02
    sun.shadow.camera.updateProjectionMatrix()

    this.sun = sun
    this.container.add(sun)
    this.container.add(sun.target)
  }

  setFog() {
    // 雾拉远一点：场地 46 米见方，雾起点太近会把半张画面吃掉
    this.fog = new THREE.Fog(0x0a0a0f, 34, 96)
    return this.fog
  }

  /**
   * 阴影相机跟着角色走。
   * 每帧把光源和它的目标一起平移，阴影范围就跟着人走，
   * 不用每次都把整个场地塞进阴影贴图。
   */
  update(_position) {
    if (!this.sun || !_position) return
    this.sun.position.set(_position.x + 11, _position.y + 17, _position.z + 8)
    this.sun.target.position.set(_position.x, _position.y, _position.z)
    this.sun.target.updateMatrixWorld()
  }

  /** 质量档位：影响阴影贴图与像素比 */
  setQuality(_level) {
    const sun = this.sun
    if (!sun) return

    if (_level === 'low') {
      sun.castShadow = false
    } else if (_level === 'medium') {
      sun.castShadow = true
      sun.shadow.mapSize.set(512, 512)
    } else {
      sun.castShadow = true
      sun.shadow.mapSize.set(1024, 1024)
    }

    if (sun.shadow.map) {
      sun.shadow.map.dispose()
      sun.shadow.map = null
    }
  }
}
