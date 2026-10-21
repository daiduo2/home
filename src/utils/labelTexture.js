import * as THREE from 'three'

/**
 * 生成一张文字贴图，贴在场景里的立牌上。
 * 用 canvas 而不是 troika-three-text，是为了少一个依赖；
 * 牌子数量不多、尺寸固定，canvas 贴图完全够用。
 */
export default function createLabelTexture(_options = {}) {
  const {
    title = '',
    subtitle = '',
    badge = '',
    accent = '#6366f1',
    width = 1024,
    height = 512,
    background = '#12121a',
  } = _options

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  // 底
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  // 左侧强调条
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, 14, height)

  // 边框
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, width - 3, height - 3)

  const paddingX = 64

  let y = 92

  if (badge) {
    ctx.font = '500 30px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = accent
    ctx.fillText(badge.toUpperCase(), paddingX, y)
    y += 58
  }

  ctx.font = '600 62px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = '#f0f0f0'
  ctx.fillText(title, paddingX, y)
  y += 62

  if (subtitle) {
    ctx.font = '400 34px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = '#a1a1aa'
    ctx.fillText(subtitle, paddingX, y)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}
