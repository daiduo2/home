/**
 * 确定性噪声。
 *
 * 全场景的程序化生成（地形起伏、地面色斑、散布密度）都走这里，
 * 保证同一份代码每次跑出来的东西一模一样 —— 随机必须可复现，
 * 不能用 Math.random()。
 *
 * 基于 sin 的哈希，够用且没有查表开销。
 */

/** 二维哈希，返回 0~1 */
export function hash2(_x, _y) {
  const h = Math.sin(_x * 127.1 + _y * 311.7) * 43758.5453123
  return h - Math.floor(h)
}

/** 一次平滑插值的值噪声，返回 0~1 */
export function valueNoise(_x, _y) {
  const xi = Math.floor(_x)
  const yi = Math.floor(_y)
  const xf = _x - xi
  const yf = _y - yi

  // smoothstep 插值权重，避免网格状的方块感
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)

  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/**
 * 多倍频叠加（fractal brownian motion），返回 0~1。
 * 倍频越多细节越碎，但会整体向 0.5 收敛。
 */
export function fbm(_x, _y, _octaves = 4, _lacunarity = 2.0, _gain = 0.5) {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0

  for (let i = 0; i < _octaves; i++) {
    sum += valueNoise(_x * frequency, _y * frequency) * amplitude
    norm += amplitude
    amplitude *= _gain
    frequency *= _lacunarity
  }

  return sum / norm
}

/**
 * 带"团块"倾向的密度场。
 *
 * 均匀撒点是程序化布景最大的破绽 —— 一眼就能看出是随机生成的。
 * 这个函数让密度自然地聚成一团一团的：先把坐标折叠成块，
 * 块内再用一个偏移量把点拉到一起。
 *
 * @returns {number} 0~1，值越大表示这里越适合长东西
 */
export function clumpField(_x, _z, _cellSize = 18) {
  const cx = Math.floor(_x / _cellSize)
  const cz = Math.floor(_z / _cellSize)

  // 块中心用一个哈希偏移，避免出现规则的格点
  const ox = (hash2(cx, cz) - 0.5) * _cellSize * 0.8
  const oz = (hash2(cx + 91.7, cz - 43.3) - 0.5) * _cellSize * 0.8

  const dx = _x - (cx * _cellSize + ox)
  const dz = _z - (cz * _cellSize + oz)
  const dist = Math.hypot(dx, dz)

  // 距团块中心越近密度越高
  const falloff = Math.max(0, 1 - dist / (_cellSize * 0.55))
  const jitter = hash2(_x * 3.7, _z * 2.3)

  return falloff * falloff * (0.55 + jitter * 0.45)
}
