import EventEmitter from './EventEmitter.js'

/**
 * 统一输入层：键盘 + 鼠标（Pointer Lock）+ 触屏摇杆 + 手柄。
 * 对外只暴露三样东西：move（移动向量）、look（视角增量，弧度）、interact（交互）。
 * look 是增量而不是状态，Character 消费后自行清零。
 */
export default class Input extends EventEmitter {
  constructor(_options = {}) {
    super()

    this.domElement = _options.domElement
    this.touch = false

    this.keys = new Set()

    this.move = { x: 0, y: 0 }
    this.look = { x: 0, y: 0 }
    this.interact = false

    this.pointerLocked = false
    this.enabled = false

    this.mouseSensitivity = 0.0022
    this.touchSensitivity = 0.0042

    this.touchStick = null
    this.touchKnob = null
    this.touchActionButton = null
    this.touchLookPointerId = null
    this.touchLookLast = { x: 0, y: 0 }

    this.setKeyEvents()
    this.setMouseEvents()
    this.setTouchEvents()
  }

  /** 场景开始后启用输入，暂停时不响应 */
  setEnabled(_value) {
    this.enabled = _value
    if (!this.enabled) {
      this.keys.clear()
      this.move.x = 0
      this.move.y = 0
    }
  }

  setTouchMode() {
    this.touch = true
    if (this.touchStick) {
      this.touchStick.hidden = false
    }
    if (this.touchActionButton) {
      this.touchActionButton.hidden = false
    }
  }

  // ---------------- 键盘 ----------------

  setKeyEvents() {
    const blockedKeys = new Set([
      'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
    ])

    window.addEventListener('keydown', (event) => {
      if (blockedKeys.has(event.code)) {
        event.preventDefault()
      }
      this.keys.add(event.code)

      if (event.code === 'KeyE' || event.code === 'Enter') {
        this.interact = true
      }
      if (event.code === 'Tab') {
        this.trigger('toggleList')
      }
      if (event.code === 'KeyC') {
        this.trigger('toggleCamera')
      }
    })

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code)
    })

    // 失焦时清空按键，否则会出现"人物一直往前走"
    window.addEventListener('blur', () => {
      this.keys.clear()
    })
  }

  // ---------------- 鼠标 ----------------

  setMouseEvents() {
    if (!this.domElement) return

    this.domElement.addEventListener('click', () => {
      if (this.enabled && !this.touch && !this.pointerLocked) {
        this.requestPointerLock()
      }
    })

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.domElement
      this.trigger('pointerlock', { locked: this.pointerLocked })
    })

    // 锁定失败时静默降级为"只有键盘"，不影响可玩性
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false
      this.trigger('pointerlock', { locked: false })
    })

    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked || !this.enabled) return
      this.look.x -= event.movementX * this.mouseSensitivity
      this.look.y -= event.movementY * this.mouseSensitivity
    })

    document.addEventListener('mousedown', (event) => {
      if (!this.enabled) return
      if (event.button === 0 && !this.pointerLocked && !this.touch) {
        this.requestPointerLock()
      }
    })
  }

  requestPointerLock() {
    if (!this.domElement || !this.domElement.requestPointerLock) return
    try {
      const result = this.domElement.requestPointerLock()
      // 部分实现返回 Promise，失败会 reject；不处理会变成 unhandled rejection
      if (result && typeof result.catch === 'function') {
        result.catch(() => {})
      }
    } catch (error) {
      // 锁定失败不影响键盘操作，静默降级
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
  }

  // ---------------- 触屏 ----------------

  setTouchEvents() {
    this.touchStick = document.getElementById('touchStick')
    this.touchKnob = document.getElementById('touchKnob')
    this.touchActionButton = document.getElementById('touchAction')

    if (this.touchStick) {
      this.touchStick.addEventListener('touchstart', (event) => {
        event.preventDefault()
        this.setTouchMode()
        this.updateStick(event.touches[0])
      }, { passive: false })

      this.touchStick.addEventListener('touchmove', (event) => {
        event.preventDefault()
        this.updateStick(event.touches[0])
      }, { passive: false })

      const end = () => {
        this.move.x = 0
        this.move.y = 0
        if (this.touchKnob) {
          this.touchKnob.style.transform = ''
        }
      }
      this.touchStick.addEventListener('touchend', end)
      this.touchStick.addEventListener('touchcancel', end)
    }

    if (this.touchActionButton) {
      this.touchActionButton.addEventListener('touchstart', (event) => {
        event.preventDefault()
        this.interact = true
      }, { passive: false })
    }

    // 右半屏拖拽 = 转视角
    window.addEventListener('touchstart', (event) => {
      this.setTouchMode()
      for (const touch of event.changedTouches) {
        if (touch.clientX > window.innerWidth * 0.4 && this.touchLookPointerId === null) {
          this.touchLookPointerId = touch.identifier
          this.touchLookLast = { x: touch.clientX, y: touch.clientY }
        }
      }
    }, { passive: true })

    window.addEventListener('touchmove', (event) => {
      if (!this.enabled) return
      for (const touch of event.changedTouches) {
        if (touch.identifier === this.touchLookPointerId) {
          const dx = touch.clientX - this.touchLookLast.x
          const dy = touch.clientY - this.touchLookLast.y
          this.look.x -= dx * this.touchSensitivity
          this.look.y -= dy * this.touchSensitivity
          this.touchLookLast = { x: touch.clientX, y: touch.clientY }
        }
      }
    }, { passive: true })

    window.addEventListener('touchend', (event) => {
      for (const touch of event.changedTouches) {
        if (touch.identifier === this.touchLookPointerId) {
          this.touchLookPointerId = null
        }
      }
    }, { passive: true })
  }

  updateStick(touch) {
    if (!touch || !this.touchStick) return
    const rect = this.touchStick.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const max = rect.width / 2

    let dx = touch.clientX - cx
    let dy = touch.clientY - cy
    const distance = Math.hypot(dx, dy)
    if (distance > max) {
      dx = (dx / distance) * max
      dy = (dy / distance) * max
    }

    if (this.touchKnob) {
      this.touchKnob.style.transform = `translate(${dx}px, ${dy}px)`
    }

    this.move.x = dx / max
    this.move.y = -dy / max
  }

  // ---------------- 手柄 ----------------

  setGamepadState() {
    if (!navigator.getGamepads) return null
    const pads = navigator.getGamepads()
    for (const pad of pads) {
      if (pad && pad.connected) return pad
    }
    return null
  }

  // ---------------- 每帧更新 ----------------

  update() {
    if (!this.enabled) {
      this.move.x = 0
      this.move.y = 0
      return
    }

    // 键盘覆盖摇杆
    let x = this.move.x
    let y = this.move.y

    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1

    // 手柄
    const pad = this.setGamepadState()
    if (pad) {
      const deadzone = 0.18
      const applyAxis = (value) => {
        if (Math.abs(value) < deadzone) return 0
        return (value - Math.sign(value) * deadzone) / (1 - deadzone)
      }
      const axisX = applyAxis(pad.axes[0] || 0)
      const axisY = applyAxis(pad.axes[1] || 0)
      if (axisX !== 0 || axisY !== 0) {
        x = axisX
        y = -axisY
      }
      const lookX = applyAxis(pad.axes[2] || 0)
      const lookY = applyAxis(pad.axes[3] || 0)
      this.look.x -= lookX * 0.045
      this.look.y -= lookY * 0.045

      const buttonA = pad.buttons[0] && pad.buttons[0].pressed
      if (buttonA && !this._padA) {
        this.interact = true
      }
      this._padA = buttonA
    }

    const length = Math.hypot(x, y)
    if (length > 1) {
      x /= length
      y /= length
    }

    this.move.x = x
    this.move.y = y
  }

  /** 消费掉本帧的交互触发 */
  consumeInteract() {
    const value = this.interact
    this.interact = false
    return value
  }

  /** 消费掉本帧累计的视角增量 */
  consumeLook() {
    const out = { x: this.look.x, y: this.look.y }
    this.look.x = 0
    this.look.y = 0
    return out
  }
}
