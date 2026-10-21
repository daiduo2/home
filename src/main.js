import Application from './core/Application.js'

const canvas = document.querySelector('.js-canvas')
const application = new Application({ canvas })

application.time.on('tick', () => {
  application.update()
})

const params = new URLSearchParams(window.location.search)

application.prepare().then(() => {
  if (params.get('skip') === '1') {
    // 调试旁路：跳过加载屏直接进场
    application.loader.root.hidden = true
    application.start()
    return
  }
  application.loader.onStart(() => {
    application.start()
  })
})

// ?list=1 直接给纯文字清单，给读屏用户和赶时间的人一条路
if (params.get('list') === '1') {
  application.interface.fallback.hidden = false
}

// 便于在控制台里调试
window.aufheben = application
