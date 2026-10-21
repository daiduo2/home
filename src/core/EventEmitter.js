/**
 * 极简事件总线。移植自 3d-folio 的 Utils/EventEmitter.js，去掉了不用的部分。
 */
export default class EventEmitter {
  constructor() {
    this.callbacks = {}
  }

  on(_event, _callback) {
    if (!this.callbacks[_event]) {
      this.callbacks[_event] = []
    }
    this.callbacks[_event].push(_callback)
    return this
  }

  off(_event, _callback) {
    const list = this.callbacks[_event]
    if (!list) return this
    if (!_callback) {
      delete this.callbacks[_event]
      return this
    }
    const index = list.indexOf(_callback)
    if (index !== -1) list.splice(index, 1)
    return this
  }

  trigger(_event, _data = {}) {
    const list = this.callbacks[_event]
    if (!list) return this
    for (const callback of [...list]) {
      callback(_data)
    }
    return this
  }
}
