/**
 * 加载屏：进度条 + 进场按钮。
 * 进场按钮不是装饰——Pointer Lock 必须由用户手势触发，浏览器不允许程序化锁定。
 */
export default class Loader {
  constructor() {
    this.root = document.getElementById('loader')
    this.fill = document.getElementById('loaderFill')
    this.status = document.getElementById('loaderStatus')
    this.startButton = document.getElementById('loaderStart')
    this.hint = document.getElementById('loaderHint')

    this.progress = 0
    this.displayed = 0
    this.done = false
  }

  setProgress(_value, _label) {
    this.progress = Math.max(this.progress, Math.min(1, _value))
    if (_label) {
      this.status.textContent = _label
    }
  }

  /** 每帧平滑逼近真实进度，避免进度条跳变 */
  update() {
    this.displayed += (this.progress - this.displayed) * 0.12
    this.fill.style.width = `${(this.displayed * 100).toFixed(1)}%`
  }

  ready() {
    this.done = true
    this.setProgress(1, '场景已就绪')
    this.startButton.hidden = false
    this.startButton.focus()
  }

  onStart(_callback) {
    this.startButton.addEventListener('click', () => {
      try {
        this.root.classList.add('is-hidden')
        setTimeout(() => {
          this.root.hidden = true
        }, 700)
        _callback()
      } catch (error) {
        // 启动失败时把原因留在屏幕上，别让用户对着一个不动的场景发呆
        this.root.classList.remove('is-hidden')
        this.root.hidden = false
        this.status.textContent = `启动失败：${error.message}`
        this.startButton.hidden = true
        throw error
      }
    })
  }

  setHint(_text) {
    this.hint.textContent = _text
  }
}
