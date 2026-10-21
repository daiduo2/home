import * as THREE from 'three'

/**
 * 场地骨架：地面、边界、光照、雾。
 * 只做"能走、能看"的基础结构，具体的地标和陈设由 Landmarks 与后续内容填。
 */
export default class Environment {
  constructor(_options = {}) {
    this.physics = _options.physics
    this.sizes = _options.sizes

    this.area = 46

    this.container = new THREE.Group()
    this.container.name = 'environment'

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

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
    })

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(this.area, this.area), material)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
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

    const material = new THREE.MeshStandardMaterial({
      color: 0x26263a,
      roughness: 0.9,
      metalness: 0.1,
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
      this.container.add(wall)

      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.06, depth),
        rimMaterial
      )
      rim.position.set(side.x, height + 0.03, side.z)
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
    const hemisphere = new THREE.HemisphereLight(0xa8b8ff, 0x1c1c28, 1.7)
    this.container.add(hemisphere)

    const sun = new THREE.DirectionalLight(0xfff2e0, 2.1)
    sun.position.set(14, 22, 10)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 80
    sun.shadow.camera.left = -30
    sun.shadow.camera.right = 30
    sun.shadow.camera.top = 30
    sun.shadow.camera.bottom = -30
    sun.shadow.bias = -0.0005
    this.container.add(sun)
    this.container.add(sun.target)

    // 一盏冷色补光，避免阴影面全黑
    const fill = new THREE.DirectionalLight(0x6f86ff, 0.8)
    fill.position.set(-16, 10, -12)
    this.container.add(fill)
  }

  setFog() {
    // 雾拉远一点：场地 46 米见方，雾起点太近会把半张画面吃掉
    this.fog = new THREE.Fog(0x0a0a0f, 34, 96)
    return this.fog
  }

  /** 质量档位：影响阴影贴图与像素比 */
  setQuality(_level) {
    let sun = null
    this.container.traverse((child) => {
      if (child.isDirectionalLight && child.castShadow) sun = child
    })

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
  }
}
