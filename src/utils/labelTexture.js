import * as THREE from 'three'
import { PALETTE } from '../core/Palette.js'

/**
 * 展板贴图。
 *
 * 展板有两套状态：
 *   far  —— 远处只看得清标题、副标题、标签。大字，大留白。
 *   near —— 走近之后才补上摘要。小字，密一点。
 *
 * 这套「走近才展开」的做法是 Bruno 那边 InteractivePoints 的翻版：
 * 远处给一个可读的信号，近了才给细节。状态切换时重画一次 canvas，
 * 不是每帧重画，所以开销可以忽略。
 *
 * 用 canvas 而不是 troika-three-text，是为了少一个依赖；
 * 牌子数量不多、尺寸固定，canvas 贴图完全够用。
 */

const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'

/**
 * 中英混排的折行。
 * 按字符逐个试宽度，英文单词不会被拆开太难看（对中文够用）。
 */
function wrapText(_ctx, _text, _maxWidth) {
  const lines = []
  let line = ''

  for (const char of _text) {
    if (char === '\n') {
      lines.push(line)
      line = ''
      continue
    }

    const candidate = line + char
    if (_ctx.measureText(candidate).width > _maxWidth && line) {
      lines.push(line)
      line = char
    } else {
      line = candidate
    }
  }

  if (line) lines.push(line)
  return lines
}

export default function createBoardTexture(_options = {}) {
  const {
    badge = '',
    title = '',
    subtitle = '',
    summary = '',
    accent = '#e8c88a',
    state = 'far',
    width = 1024,
    height = 640,
  } = _options

  const near = state === 'near'

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  // ---- 底：竖向渐变 ----
  // 不能用接近黑的颜色：展板是自发光的，不受光，
  // 周围全是亮天空的时候，一块近黑的板子会像个挖出来的洞。
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, '#3a3247')
  gradient.addColorStop(0.55, '#282134')
  gradient.addColorStop(1, '#1d1926')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // ---- 左侧强调条 + 一层从强调色渗出来的柔光 ----
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, 18, height)
  const bleed = ctx.createLinearGradient(18, 0, 190, 0)
  bleed.addColorStop(0, `${accent}44`)
  bleed.addColorStop(1, `${accent}00`)
  ctx.fillStyle = bleed
  ctx.fillRect(18, 0, 172, height)

  // ---- 内框 ----
  ctx.strokeStyle = 'rgba(224, 203, 164, 0.24)'
  ctx.lineWidth = 3
  ctx.strokeRect(28, 24, width - 56, height - 48)

  const paddingX = 74
  const contentWidth = width - paddingX - 64

  // ---- 标签 ----
  let y = 96
  if (badge) {
    ctx.font = `500 30px ${FONT}`
    ctx.fillStyle = accent
    ctx.fillText(badge, paddingX, y)
    y += near ? 62 : 78
  }

  // ---- 标题 ----
  const titleSize = near ? 62 : 84
  ctx.font = `600 ${titleSize}px ${FONT}`
  ctx.fillStyle = PALETTE.textPrimary ? `#${PALETTE.textPrimary.toString(16).padStart(6, '0')}` : '#f2e7d3'
  const titleLines = wrapText(ctx, title, contentWidth)
  for (const line of titleLines) {
    ctx.fillText(line, paddingX, y)
    y += titleSize * 1.16
  }

  // ---- 副标题 ----
  if (subtitle) {
    y += near ? 4 : 14
    ctx.font = `400 ${near ? 32 : 38}px ${FONT}`
    ctx.fillStyle = near ? '#a89c8c' : '#b6a996'
    const subtitleLines = wrapText(ctx, subtitle, contentWidth)
    for (const line of subtitleLines) {
      ctx.fillText(line, paddingX, y)
      y += (near ? 32 : 38) * 1.35
    }
  }

  // ---- 摘要：只有走近才出现 ----
  if (near && summary) {
    y += 18
    ctx.strokeStyle = 'rgba(224, 203, 164, 0.2)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(paddingX, y)
    ctx.lineTo(paddingX + contentWidth, y)
    ctx.stroke()
    y += 44

    ctx.font = `400 30px ${FONT}`
    ctx.fillStyle = '#8f8478'
    const summaryLines = wrapText(ctx, summary, contentWidth)
    const maxLines = Math.floor((height - y - 60) / 42)

    for (let i = 0; i < Math.min(summaryLines.length, maxLines); i++) {
      ctx.fillText(summaryLines[i], paddingX, y)
      y += 42
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}
