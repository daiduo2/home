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

    // 触屏摇杆的持续值，和键盘的瞬时值必须分开存。
    // 以前键盘的增量直接累加进 move，松键后 move 里还留着上一帧的值，
    // 角色就永远停不下来。
    this.touchMove = { x: 0, y: 0 }

    // move：每帧重新算出来的最终移动向量（相机相对）
    this.move = { x: 0, y: 0 }
    // look：视角增量。x > 0 表示向右转，y > 0 表示向上看
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
      this.touchMove.x = 0
      this.touchMove.y = 0
      this.move.x = 0
      this.move.y = 0
      this.look.x = 0
      this.look.y = 0
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
      if (this.pointerLocked) this.dragging = false
      this.trigger('pointerlock', { locked: this.pointerLocked })
    })

    // 锁定失败时静默降级为"只有键盘"，不影响可玩性
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false
      this.trigger('pointerlock', { locked: false })
    })

    // 按住左键拖动也能转视角。
    // 指针锁在 iframe、被嵌页面、或者用户按 Esc 之后会失效，
    // 没有这条兜底，画面就完全转不动了 —— 这正是"视角操作有问题"的一大来源。
    document.addEventListener('mousedown', (event) => {
      if (!this.enabled) return
      if (event.button === 0 && !this.touch && !this.pointerLocked) {
        this.dragging = true
        this.requestPointerLock()
      }
    })

    document.addEventListener('mouseup', () => {
      this.dragging = false
    })

    document.addEventListener('mousemove', (event) => {
      if (!this.enabled) return
      if (!this.pointerLocked && !this.dragging) return
      // 约定：look.x > 0 = 视角向右，look.y > 0 = 向上看
      this.look.x += event.movementX * this.mouseSensitivity
      this.look.y -= event.movementY * this.mouseSensitivity
    })

    // 滚轮改相机距离
    document.addEventListener(
      'wheel',
      (event) => {
        if (!this.enabled) return
        event.preventDefault()
        this.trigger('zoom', { delta: Math.sign(event.deltaY) * 0.7 })
      },
      { passive: false }
    )
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
        this.touchMove.x = 0
        this.touchMove.y = 0
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
          this.look.x += dx * this.touchSensitivity
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

    this.touchMove.x = dx / max
    this.touchMove.y = -dy / max
  }

  // ---------------- 手柄 ----------------

  /**
   * 手柄目前**不参与移动**，这是有意为之。
   *
   * 实测本机连着的 DualSense Edge 在 Windows 上报出来的状态是坏的：
   * 静止时 axes[1] 恒为 -1（等于左摇杆一直推到底），而且这个值还会跳变，
   * buttons[2] 也是常按的。任何"读轴 → 驱动移动"的写法都会让角色
   * 自己往前冲、或者一顿一顿地反向抽搐，而且停不下来。
   *
   * 要加手柄支持的话，必须先做显式标定（用户按某个键确认手柄、
   * 记录静止零点、并且要求明显偏离零点才采信），不能直接读轴就用。
   */
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
      this.touchMove.x = 0
      this.touchMove.y = 0
      this.move.x = 0
      this.move.y = 0
      return
    }

    // 每帧从零重算：触屏摇杆的持续值 + 键盘的瞬时值。
    // 千万别把键盘的增量累加回 move —— 松键后 move 里还留着上一帧的 1，
    // 角色就会一直往前走停不下来。
    let x = this.touchMove.x
    let y = this.touchMove.y

    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1

    // 手柄不参与移动（原因见 setGamepadState 的注释）

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
