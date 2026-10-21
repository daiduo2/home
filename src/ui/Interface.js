/**
 * 界面层：HUD 提示、地标详情面板、设置、纯文字清单兜底。
 * 文字清单是可访问性的底线——不能只靠"开车逛"才能找到内容。
 */
export default class Interface {
  constructor(_options = {}) {
    this.landmarks = _options.landmarks || []

    this.hud = document.getElementById('hud')
    this.prompt = document.getElementById('hudPrompt')
    this.panel = document.getElementById('panel')
    this.settings = document.getElementById('settings')
    this.fallback = document.getElementById('fallback')

    this.setPanelEvents()
    this.setFallbackEvents()
    this.setSettingsEvents()
    this.renderFallbackList()
  }

  show() {
    this.hud.hidden = false
  }

  // ---------------- 地标提示 ----------------

  setPrompt(_landmark) {
    if (!_landmark) {
      this.prompt.hidden = true
      this.prompt.onclick = null
      return
    }
    this.prompt.hidden = false
    this.prompt.innerHTML = `<kbd>E</kbd><span>${_landmark.title}</span>`
    this.prompt.onclick = () => this.openPanel(_landmark)
  }

  // ---------------- 详情面板 ----------------

  openPanel(_landmark) {
    if (!_landmark) return

    document.getElementById('panelKicker').textContent = _landmark.badge || ''
    document.getElementById('panelTitle').textContent = _landmark.title
    document.getElementById('panelDesc').textContent = _landmark.description || ''

    const links = document.getElementById('panelLinks')
    links.innerHTML = ''
    for (const link of _landmark.links || []) {
      const anchor = document.createElement('a')
      anchor.className = 'panel__link'
      anchor.href = link.url
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      anchor.textContent = link.label
      links.appendChild(anchor)
    }

    this.panel.hidden = false
  }

  closePanel() {
    this.panel.hidden = true
  }

  setPanelEvents() {
    document.getElementById('panelClose').addEventListener('click', () => this.closePanel())
    this.panel.addEventListener('click', (event) => {
      if (event.target === this.panel) this.closePanel()
    })
  }

  // ---------------- 设置 ----------------

  setSettingsEvents() {
    const open = () => {
      this.settings.hidden = false
    }
    const close = () => {
      this.settings.hidden = true
    }

    document.getElementById('btnSettings').addEventListener('click', open)
    document.getElementById('settingsClose').addEventListener('click', close)
    this.settings.addEventListener('click', (event) => {
      if (event.target === this.settings) close()
    })

    this.onQualityChange = null
    this.onSoundChange = null
    this.onCameraChange = null

    document.getElementById('qualitySelect').addEventListener('change', (event) => {
      if (this.onQualityChange) this.onQualityChange(event.target.value)
    })
    document.getElementById('soundToggle').addEventListener('change', (event) => {
      if (this.onSoundChange) this.onSoundChange(event.target.checked)
    })
    document.getElementById('cameraToggle').addEventListener('change', (event) => {
      if (this.onCameraChange) this.onCameraChange(event.target.checked)
    })
  }

  setStats(_text) {
    document.getElementById('statsNote').textContent = _text
  }

  setQualityValue(_value) {
    document.getElementById('qualitySelect').value = _value
  }

  setCameraValue(_value) {
    document.getElementById('cameraToggle').checked = _value
  }

  // ---------------- 纯文字清单 ----------------

  renderFallbackList() {
    const list = document.getElementById('fallbackList')
    list.innerHTML = ''

    for (const landmark of this.landmarks) {
      const item = document.createElement('div')
      item.className = 'fallback__item'

      const title = document.createElement('h3')
      title.textContent = landmark.title
      item.appendChild(title)

      if (landmark.subtitle) {
        const subtitle = document.createElement('p')
        subtitle.textContent = landmark.subtitle
        item.appendChild(subtitle)
      }

      if (landmark.description) {
        const description = document.createElement('p')
        description.textContent = landmark.description
        item.appendChild(description)
      }

      for (const link of landmark.links || []) {
        const anchor = document.createElement('a')
        anchor.href = link.url
        anchor.target = '_blank'
        anchor.rel = 'noopener noreferrer'
        anchor.textContent = link.label
        anchor.style.display = 'block'
        anchor.style.marginTop = '6px'
        item.appendChild(anchor)
      }

      list.appendChild(item)
    }

    // noscript 版本同步一份
    const noscriptList = document.getElementById('noscriptList')
    if (noscriptList) {
      noscriptList.innerHTML = list.innerHTML
    }
  }

  toggleFallback() {
    this.fallback.hidden = !this.fallback.hidden
    if (!this.fallback.hidden) {
      this.closePanel()
      this.settings.hidden = true
    }
  }

  closeFallback() {
    this.fallback.hidden = true
  }

  setFallbackEvents() {
    document.getElementById('btnList').addEventListener('click', () => this.toggleFallback())
    document.getElementById('fallbackClose').addEventListener('click', () => this.closeFallback())
  }
}
