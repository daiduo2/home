import * as THREE from 'three'
import Physics from './Physics.js'
import Environment from './Environment.js'
import Character from './Character.js'
import Landmarks from './Landmarks.js'
import landmarkData from '../data/landmarks.js'

/**
 * 场景总装。物理 → 角色 → 地标 → 事件，顺序固定。
 */
export default class World {
  constructor(_options = {}) {
    this.time = _options.time
    this.sizes = _options.sizes
    this.camera = _options.camera
    this.input = _options.input
    this.events = _options.events

    this.container = new THREE.Group()
    this.container.name = 'world'

    this.physics = new Physics()
    this.environment = new Environment({
      physics: this.physics,
      sizes: this.sizes,
    })
    this.container.add(this.environment.container)

    this.character = new Character({
      physics: this.physics,
    })
    this.container.add(this.character.object)

    this.landmarks = new Landmarks({
      physics: this.physics,
      data: landmarkData,
    })
    this.container.add(this.landmarks.container)

    this.activeLandmark = null
  }

  update(_delta) {
    this.physics.update(_delta)

    const look = this.input.consumeLook()
    this.camera.applyLook(look)

    // 先定朝向，角色才知道"屏幕前方"是哪儿
    this.camera.updateAim(_delta)
    this.character.update(_delta, this.input.move, this.camera)
    this.camera.updatePosition(_delta, this.character)
    this.environment.update(this.character.object.position)

    this.landmarks.faceCamera(this.camera.position)
    this.updateLandmarkFocus()
  }

  updateLandmarkFocus() {
    const found = this.landmarks.findActive(this.character.object.position)
    const id = found ? found.entry.id : null
    const previous = this.activeLandmark ? this.activeLandmark.entry.id : null

    if (id !== previous) {
      this.activeLandmark = found
      // 传 entry 而不是 item，界面层要的就是那条数据
      this.events.trigger('landmark:focus', { landmark: found ? found.entry : null })
    }
  }

  /** 交互键触发：返回当前地标数据 */
  interact() {
    if (!this.activeLandmark) return null
    return this.activeLandmark.entry
  }

  setQuality(_level) {
    this.environment.setQuality(_level)
  }

  destroy() {
    this.character.destroy()
    this.landmarks.destroy()
    this.physics.destroy()
  }
}
