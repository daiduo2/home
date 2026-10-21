import * as THREE from 'three'
import { PALETTE, material, signalMaterial } from '../core/Palette.js'
import { mulberry32 } from '../utils/textures.js'

/**
 * 参照物系统（Scenery）
 * =====================
 * 场景原来只有「一张无限平面 + 几个悬空牌子」：没有纵深、没有尺度，
 * 玩家走进去像站在调试台上而不是站在一个地方。
 *
 * 这里补上「地面上的东西」——石块、草丛、沿路的小柱子、路灯。
 * 它们不是装饰细节，只干三件事：
 *   1. 尺度参照：0.4m 的石子和 3.2m 的灯柱告诉玩家「这里有多大」；
 *   2. 视线引导：路标柱和路灯排成从出生点通往各个展台的路径，
 *      玩家不用看地图也知道该往哪走；
 *   3. 纵深：地面上要有东西，远处才有层次，平地永远是一张纸。
 *
 * 两条硬规则：
 *   - 密度绝对不能均匀撒。均匀撒是程序化布景最大的破绽，
 *     一眼就看出是「随便生成」的。做法是先把场地切成 cell 网格，
 *     每个 cell 里随机挑 1~2 个 clump 中心，物件只长在 clump 附近，
 *     再用一层低频噪声把 clump 中心推开，避免出现棋盘状的格点感。
 *   - 一切高度都来自 terrain.heightAt(x, z)，这是唯一的地表高度来源。
 *
 * 随机源用 utils/textures.js 里的 mulberry32（全场景唯一），
 * 同一个种子永远长出同一片场地，方便对着画面调参数。
 *
 * 性能：每类物件一个 InstancedMesh，几何体和材质全场景共享，
 * 整套参照物系统只增加 6 个 draw call（4 类物件 + 2 个发光件）。
 */

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/** 场地半径（米）：物件不越过这个圈。 */
const FIELD_RADIUS = 58
/** 边界隆起带宽度：这一圈地形是抬起来的，不放东西。 */
const EDGE_KEEPOUT = 6
/** cell 网格边长（12×12 个区块）。 */
const GRID_CELLS = 12
/** 展台净空半径：展台周围不放任何东西，免得挡住牌子。 */
const LANDMARK_CLEAR = 4
/**
 * 出生点净空半径。
 *
 * 分两种：
 *   - 散布类（石头、草丛）用 5m：玩家一睁眼看到的区域要干净，
 *     这类东西挡视线。
 *   - 路径家具（路标柱、灯柱）用 1.5m：它们又细又高，本来就该站在
 *     路边，而且当前的展台离出生点只有 8~9m，
 *     「5m + 4m」两个净空加起来比整条路还长，
 *     严格按 5m 算的话一条路标柱都放不下。
 */
const SPAWN_CLEAR = 5
const SPAWN_CLEAR_PATH = 1.5
/** 路径中心线净空：石头和草丛不长在路上。 */
const PATH_CLEAR = 1.2
/** 灯与灯之间的最小间距，太近会挤成一团。 */
const LAMP_SPACING = 4.5
/** 路标柱之间的最小间距。 */
const POST_SPACING = 1.3
/** 密度上限：每米可用路径最多几根路标柱 / 几盏灯。 */
const POSTS_PER_METER = 1 / 2.6
const LAMPS_PER_METER = 1 / 9

/** 目标数量（准配额制：先按权重分配总数，再被约束筛掉一部分）。 */
const TARGET_ROCKS = 64
const TARGET_TUFTS = 260
const TARGET_WAYPOSTS = 14
const TARGET_LAMPS = 5

/** 一个 clump 最多长几件，太多了就摊给别的 clump。 */
const MAX_PER_CLUMP = 6
/**
 * 落位存活率：分到配额后有一部分会被边界/净空/路径规则筛掉，
 * 配额先按这个系数放大，最后落到地面的数量才接近目标值。
 * （这个系数是按实际筛选结果标定的）
 */
const ROCK_KEEP_RATE = 0.86
const TUFT_KEEP_RATE = 0.9

/** 草丛的颜色：groundDark 那套冷紫里带一点绿灰，压暗、别抢戏。 */
const TUFTS_COLOR = 0x3a4234

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/**
 * 低频值噪声（双线性 + smoothstep）。
 * 用来把 clump 中心从规整的格点上推开。
 */
function createValueNoise(_seed) {
  const rand = mulberry32(_seed)
  const size = 256
  const table = new Float32Array(size * size)
  for (let i = 0; i < table.length; i++) table[i] = rand()

  const at = (_x, _z) => table[((_z & 255) * size + (_x & 255)) | 0]

  return function (_x, _z) {
    const x0 = Math.floor(_x)
    const z0 = Math.floor(_z)
    const fx = _x - x0
    const fz = _z - z0
    const ux = fx * fx * (3 - 2 * fx)
    const uz = fz * fz * (3 - 2 * fz)
    const a = at(x0, z0)
    const b = at(x0 + 1, z0)
    const c = at(x0, z0 + 1)
    const d = at(x0 + 1, z0 + 1)
    const top = a * (1 - ux) + b * ux
    const bottom = c * (1 - ux) + d * ux
    return top * (1 - uz) + bottom * uz
  }
}

/**
 * 把总数按权重分给各个 clump（最大余数法）。
 *
 * 为什么不用「每个 clump 独立掷骰子决定长几件」：
 * 那样总数量会随 clump 数量浮动，布局一改数量就变；
 * 用配额制可以保证「这一片该有多少块石头」是可预期的，
 * 同时权重是随机的，密度分布依然不均匀。
 *
 * @param {number[]} _weights 每个 clump 的权重（≥0）
 * @param {number} _quota 要分的总数
 * @returns {number[]} 每个 clump 分到的数量，总和 === _quota
 */
function distributeQuota(_weights, _quota) {
  const counts = new Array(_weights.length).fill(0)
  let total = 0
  for (const w of _weights) total += w
  if (total <= 0 || _quota <= 0) return counts

  const remainders = []
  let assigned = 0

  for (let i = 0; i < _weights.length; i++) {
    const exact = (_quota * _weights[i]) / total
    const floor = Math.floor(exact)
    counts[i] = floor
    assigned += floor
    remainders.push({ index: i, rest: exact - floor })
  }

  // 余数从大到小补齐，保证总和精确等于配额
  remainders.sort((a, b) => b.rest - a.rest)
  let left = _quota - assigned
  for (let k = 0; k < remainders.length && left > 0; k++) {
    counts[remainders[k].index] += 1
    left -= 1
  }

  return counts
}

/**
 * 配额削峰：单个 clump 最多 MAX_PER_CLUMP 件，
 * 超出的摊给拿得少的 clump，免得出现「一小堆石头挤成一坨」。
 */
function capQuota(_counts, _cap) {
  const counts = _counts.slice()
  let overflow = 0

  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > _cap) {
      overflow += counts[i] - _cap
      counts[i] = _cap
    }
  }

  while (overflow > 0) {
    let moved = false
    for (let i = 0; i < counts.length && overflow > 0; i++) {
      if (counts[i] < _cap) {
        counts[i] += 1
        overflow -= 1
        moved = true
      }
    }
    if (!moved) break
  }

  return counts
}

/**
 * 按「可用长度」把总数分给各条路径。
 *
 * 为什么不用固定个数：路径长短差很多（出生点到展台可能 8m，也可能 60m），
 * 固定个数要么把短路径塞成一排栅栏，要么长路径上稀稀拉拉。
 * 按长度分才自然。
 *
 * @param {number[]} _lengths 每条路径的可用长度
 * @param {number} _target 总数
 * @param {number} _maxPerMeter 每米最多几个（密度上限）
 */
function allocateByLength(_lengths, _target, _maxPerMeter) {
  const counts = distributeQuota(_lengths, _target)
  const result = []

  for (let i = 0; i < _lengths.length; i++) {
    const length = _lengths[i]
    if (length <= 0) {
      result.push(0)
      continue
    }
    // 至少留一个，否则短路径上一个都没有
    const cap = Math.max(1, Math.floor(length * _maxPerMeter))
    result.push(Math.min(counts[i], cap))
  }

  return result
}

/** 点到折线的最短距离（折线用平面上的点序列表示）。 */
function distanceToPolyline(_x, _z, _points) {
  let min = Infinity
  for (let i = 1; i < _points.length; i++) {
    const ax = _points[i - 1].x
    const az = _points[i - 1].z
    const bx = _points[i].x
    const bz = _points[i].z
    const vx = bx - ax
    const vz = bz - az
    const lenSq = vx * vx + vz * vz
    let t = 0
    if (lenSq > 0) t = ((_x - ax) * vx + (_z - az) * vz) / lenSq
    if (t < 0) t = 0
    else if (t > 1) t = 1
    const cx = ax + vx * t
    const cz = az + vz * t
    const d = Math.hypot(_x - cx, _z - cz)
    if (d < min) min = d
  }
  return min
}

/** 归一化 landmarks 输入，丢掉没有坐标的脏数据。 */
function normalizeLandmarks(_landmarks) {
  if (!Array.isArray(_landmarks)) return []
  const result = []
  for (const entry of _landmarks) {
    if (!entry || !entry.position) continue
    const x = Number(entry.position[0])
    const z = Number(entry.position[1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    result.push({ x, z, accent: entry.accent })
  }
  return result
}

/** 归一化 spawn 输入。 */
function normalizeSpawn(_spawn) {
  const x = _spawn && Number.isFinite(Number(_spawn.x)) ? Number(_spawn.x) : 0
  const z = _spawn && Number.isFinite(Number(_spawn.z)) ? Number(_spawn.z) : 0
  return { x, z }
}

/* ------------------------------------------------------------------ *
 * 几何体
 * ------------------------------------------------------------------ */

/**
 * 把几何体转成平面法线（每面独立顶点）。
 *
 * 为什么手动做：Palette 给的 toon 材质在 three r169 里没有 flatShading，
 * 圆柱这类平滑法线的几何体看起来会太「圆润」，和场景的折面调性不合。
 * 直接拆成非索引三角形重算法线，材质是什么都无所谓。
 */
function makeFaceted(_geometry) {
  const geometry = _geometry.index ? _geometry.toNonIndexed() : _geometry
  geometry.computeVertexNormals()
  return geometry
}

/**
 * 石块：二十面体 detail 0，低多边形。
 * 把几何体原点移到「底面」，实例化时直接贴在地面上，
 * 不用再手动减半高——底面原点的几何体缩放后底部仍在 0。
 */
function createRockGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 0)
  geometry.computeBoundingBox()
  geometry.translate(0, -geometry.boundingBox.min.y, 0)
  return makeFaceted(geometry)
}

/**
 * 草丛：几片交叉的细长三角形拼成一个几何体。
 * 顶点不索引，法线就是每面独立的，低多边形味更足。
 */
function createTuftGeometry() {
  const blades = 4
  const halfWidth = 0.055
  const positions = []

  for (let i = 0; i < blades; i++) {
    const angle = (i / blades) * Math.PI * 2 + 0.4
    const height = 0.3 + (i % 3) * 0.07
    const bend = 0.05 + (i % 2) * 0.05
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    // 一片叶子：底边两点 + 一个带弯曲的顶点
    const local = [
      [-halfWidth, 0, 0],
      [halfWidth, 0, 0],
      [bend, height, i % 2 === 0 ? 0.03 : -0.03],
    ]

    for (const p of local) {
      positions.push(p[0] * cos + p[2] * sin, p[1], -p[0] * sin + p[2] * cos)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return makeFaceted(geometry)
}

/** 路标柱：六边柱，原点在底面。 */
function createWaypostGeometry() {
  const geometry = new THREE.CylinderGeometry(0.075, 0.095, 1, 6)
  geometry.translate(0, 0.5, 0)
  return makeFaceted(geometry)
}

/** 路标柱顶的发光帽：六边小锥台，原点在底面。 */
function createWaypostCapGeometry() {
  const geometry = new THREE.CylinderGeometry(0.08, 0.055, 0.075, 6)
  geometry.translate(0, 0.0375, 0)
  return makeFaceted(geometry)
}

/** 灯柱：细长圆柱（半径 0.06，高 3.2），原点在底面。 */
function createLampPoleGeometry() {
  const geometry = new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8)
  geometry.translate(0, 1.6, 0)
  return makeFaceted(geometry)
}

/** 灯头：一个发光小球，中心在原点。 */
function createLampCapGeometry() {
  return new THREE.SphereGeometry(0.105, 10, 8)
}

/* ------------------------------------------------------------------ *
 * Scenery
 * ------------------------------------------------------------------ */

export default class Scenery {
  /**
   * @param {object} _options
   * @param {object} [_options.physics] 物理世界。
   *   本系统只作装饰，不往物理世界里加碰撞体：
   *   一是几百个装饰碰撞体对 cannon-es 是纯开销，
   *   二是当前物理地面是一张平面，而地形一旦有起伏，
   *   装饰件的碰撞盒高度和角色踩的地面就对不上了。
   *   真要挡路，应该单独给展台和边界加碰撞，而不是给石头加。
   * @param {object} [_options.terrain] 必须提供 heightAt(x, z) → number
   * @param {number} [_options.seed] 随机种子，决定整片布局
   * @param {number} [_options.fieldRadius] 场地半径（默认 58m）
   */
  constructor(_options = {}) {
    this.physics = _options.physics
    this.terrain = _options.terrain
    this.seed = Number.isFinite(_options.seed) ? _options.seed : 20261021
    this.fieldRadius = Number.isFinite(_options.fieldRadius) ? _options.fieldRadius : FIELD_RADIUS
    // 边界隆起带不放东西
    this.placementRadius = Math.max(1, this.fieldRadius - EDGE_KEEPOUT)
    this.cellSize = (this.placementRadius * 2) / GRID_CELLS

    this.container = new THREE.Group()
    this.container.name = 'scenery'

    this.meshes = {}
    this.geometries = []
    this.materials = []
    this.counts = { rocks: 0, tufts: 0, wayposts: 0, lamps: 0 }
    this.pathSamples = []
    this.paths = []
    this.built = false
  }

  /**
   * 生成整片参照物。
   * @param {object} _options
   * @param {Array<{position:[number,number], accent?:string}>} [_options.landmarks]
   * @param {{x:number,z:number}} [_options.spawn]
   * @returns {{rocks:number,tufts:number,wayposts:number,lamps:number}}
   */
  build(_options = {}) {
    const landmarks = normalizeLandmarks(_options.landmarks)
    const spawn = normalizeSpawn(_options.spawn)

    if (!this.terrain || typeof this.terrain.heightAt !== 'function') {
      throw new Error(
        'Scenery: terrain 必须提供 heightAt(x, z) 方法 —— 这是地表高度的唯一来源，没有它物件无法贴地。'
      )
    }

    // 重复 build 时先清干净，避免旧 mesh 留在场景里
    this.reset()

    const rng = mulberry32(this.seed)

    // ---- 1. 路径：出生点 → 每个展台 ----
    const paths = this.buildPaths(landmarks, spawn, rng)
    const pathSamples = paths.map((path) => this.samplePath(path))
    // 留着给调试/自检用：可以直接量「离路径中心线多远」
    this.pathSamples = pathSamples
    // 路径曲线本身要交给 PathTrail 去铺路面
    this.paths = paths

    // 禁放规则的上下文：散布类和路径家具的出生点净空不一样
    const scatterContext = {
      landmarks,
      spawn,
      pathSamples,
      checkPath: true,
      spawnClear: SPAWN_CLEAR,
    }
    const pathContext = {
      landmarks,
      spawn,
      pathSamples,
      checkPath: false,
      spawnClear: SPAWN_CLEAR_PATH,
    }

    // ---- 2. clump 中心：cell 网格 + 低频噪声偏移 ----
    const clumps = this.buildClumps(rng)

    // ---- 3. 石头与草丛：只长在 clump 附近 ----
    const rocks = this.buildRocks(clumps, rng, scatterContext)
    const tufts = this.buildTufts(clumps, rng, scatterContext)

    // ---- 3b. 路肩草：贴着路边长的一圈 ----
    // clump 撒点是按整片场地均摊的，路两边反而最稀 ——
    // 而路两边恰恰是观众视线里占比最大的地带。
    // 单独沿路径补一圈，密度提上去，路也就不再是一条光秃秃的色带。
    const vergeTufts = this.buildVergeTufts(paths, rng, scatterContext)
    tufts.push(...vergeTufts)

    // ---- 4. 路标柱与灯：沿路径排 ----
    const waypostSet = this.buildWayposts(paths, rng, pathContext)
    const lampSet = this.buildLamps(paths, rng, pathContext)

    this.counts = {
      rocks: rocks.length,
      tufts: tufts.length,
      wayposts: waypostSet.posts.length,
      lamps: lampSet.poles.length,
    }

    this.createMeshes(rocks, tufts, waypostSet, lampSet)
    this.built = true

    return this.counts
  }

  /**
   * 每帧更新。目前只做一件极轻量的事：灯头呼吸。
   *
   * 注意：所有灯共享同一个材质实例，所以它们会一起亮一起暗——
   * 这是共享材质换来的省 draw call 的代价，可以接受。
   * @param {number} _elapsed 场景已运行秒数
   */
  update(_elapsed) {
    if (!this.lampCapMaterial) return
    const pulse = 0.5 + 0.5 * Math.sin((_elapsed || 0) * 0.9)
    this.lampCapMaterial.opacity = 0.78 + pulse * 0.22
  }

  /** 释放几何体、材质与 InstancedMesh 的实例缓冲。 */
  dispose() {
    for (const key of Object.keys(this.meshes)) {
      const mesh = this.meshes[key]
      this.container.remove(mesh)
      if (mesh && typeof mesh.dispose === 'function') mesh.dispose()
      delete this.meshes[key]
    }

    for (const geometry of this.geometries) geometry.dispose()
    this.geometries.length = 0

    for (const mat of this.materials) mat.dispose()
    this.materials.length = 0

    // toon 渐变贴图（Palette.getToonGradient）是 Palette 模块的共享资源，
    // 不归本系统所有，这里不能 dispose，否则别的模块的材质会一起坏掉。
    // 本系统自己没建贴图，所以没有别的要释放。

    this.lampCapMaterial = null
    this.built = false

    if (this.container.parent) this.container.parent.remove(this.container)
  }

  /* ---------------------------------------------------------------- *
   * 内部实现
   * ---------------------------------------------------------------- */

  /** 清掉上一次生成的东西（mesh + 几何体 + 材质），重复 build 也不留垃圾。 */
  reset() {
    for (const key of Object.keys(this.meshes)) {
      const mesh = this.meshes[key]
      this.container.remove(mesh)
      if (mesh && typeof mesh.dispose === 'function') mesh.dispose()
      delete this.meshes[key]
    }

    for (const geometry of this.geometries) geometry.dispose()
    this.geometries.length = 0

    for (const mat of this.materials) mat.dispose()
    this.materials.length = 0

    this.lampCapMaterial = null
    this.counts = { rocks: 0, tufts: 0, wayposts: 0, lamps: 0 }
    this.pathSamples = []
    this.paths = []
  }

  /** 地表高度。terrain 是唯一的高度来源。 */
  heightAt(_x, _z) {
    return this.terrain.heightAt(_x, _z)
  }

  /**
   * 从出生点到每个展台连一条路径。
   * 用二次贝塞尔，控制点带一点横向偏移——所有路径都笔直会像尺子画的。
   */
  buildPaths(_landmarks, _spawn, _rng) {
    const paths = []

    for (const landmark of _landmarks) {
      const sx = _spawn.x
      const sz = _spawn.z
      const dx = landmark.x - sx
      const dz = landmark.z - sz
      const length = Math.hypot(dx, dz)

      // 太近就没有「路」可言
      if (length < 2) continue

      // 垂直于前进方向
      const nx = -dz / length
      const nz = dx / length
      const bend = (_rng() * 2 - 1) * length * 0.22

      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(sx, 0, sz),
        new THREE.Vector3(
          (sx + landmark.x) / 2 + nx * bend,
          0,
          (sz + landmark.z) / 2 + nz * bend
        ),
        new THREE.Vector3(landmark.x, 0, landmark.z)
      )

      paths.push({ curve, landmark, length })
    }

    return paths
  }

  /** 把曲线打散成平面折线，供「离路径多远」的判定使用。 */
  samplePath(_path, _count = 48) {
    const points = []
    for (let i = 0; i <= _count; i++) {
      const p = _path.curve.getPointAt(i / _count)
      points.push({ x: p.x, z: p.z })
    }
    return points
  }

  /**
   * clump 中心：先把场地切成 12×12 的 cell，
   * 每个 cell 里挑 1~2 个中心，再用低频噪声把中心推开，
   * 免得整片看起来是网格撒点。
   *
   * 只用「基本落在圆内」的 cell：场地是圆的，
   * 四个角上的 cell 几乎整个在场地外，在那儿撒点等于白撒。
   */
  buildClumps(_rng) {
    const noise = createValueNoise(this.seed ^ 0x9e3779b9)
    const half = this.placementRadius
    const clumps = []

    for (let gz = 0; gz < GRID_CELLS; gz++) {
      for (let gx = 0; gx < GRID_CELLS; gx++) {
        const cellX = -half + gx * this.cellSize
        const cellZ = -half + gz * this.cellSize
        const centerX = cellX + this.cellSize / 2
        const centerZ = cellZ + this.cellSize / 2

        // cell 中心离场心太远就整格跳过
        const keepRadius = this.placementRadius - this.cellSize * 0.75
        if (Math.hypot(centerX, centerZ) > keepRadius) continue

        // 低频噪声：把格点中心挪开最多小半个 cell
        const offsetX = (noise(centerX * 0.06, centerZ * 0.06) * 2 - 1) * this.cellSize * 0.9
        const offsetZ =
          (noise(centerX * 0.06 + 37.7, centerZ * 0.06 - 19.3) * 2 - 1) * this.cellSize * 0.9

        const count = _rng() < 0.45 ? 2 : 1
        for (let i = 0; i < count; i++) {
          clumps.push({
            x: cellX + _rng() * this.cellSize + offsetX,
            z: cellZ + _rng() * this.cellSize + offsetZ,
            radius: this.cellSize * 0.5,
            // 权重偏重尾：有的 clump 长一大簇，有的整块空着，
            // 这才是「不均匀」的来源
            weight: Math.pow(_rng(), 2) + 0.05,
          })
        }
      }
    }

    return clumps
  }

  /**
   * 通用禁放判定：场地边界 / 展台净空 / 出生点净空 /（可选）路径净空。
   * @param {number} _x
   * @param {number} _z
   * @param {object} _context { landmarks, spawn, pathSamples, checkPath, spawnClear }
   */
  isBlocked(_x, _z, _context) {
    if (Math.hypot(_x, _z) > this.placementRadius) return true

    for (const landmark of _context.landmarks) {
      if (Math.hypot(_x - landmark.x, _z - landmark.z) < LANDMARK_CLEAR) return true
    }

    const spawnClear = _context.spawnClear !== undefined ? _context.spawnClear : SPAWN_CLEAR
    if (Math.hypot(_x - _context.spawn.x, _z - _context.spawn.z) < spawnClear) return true

    if (_context.checkPath) {
      for (const samples of _context.pathSamples) {
        if (distanceToPolyline(_x, _z, samples) < PATH_CLEAR) return true
      }
    }

    return false
  }

  /**
   * 石块：clump 中心附近长，数量靠配额制控制。
   * 石块是主要的尺度参照，所以给它们投影。
   */
  buildRocks(_clumps, _rng, _context) {
    const entries = []
    const quota = Math.round(TARGET_ROCKS / ROCK_KEEP_RATE)
    const counts = capQuota(distributeQuota(_clumps.map((c) => c.weight), quota), MAX_PER_CLUMP)

    for (let ci = 0; ci < _clumps.length; ci++) {
      const clump = _clumps[ci]
      for (let i = 0; i < counts[ci]; i++) {
        const angle = _rng() * Math.PI * 2
        // sqrt 让面积分布均匀，否则全挤在 clump 中心
        const radius = clump.radius * Math.sqrt(_rng())
        const x = clump.x + Math.cos(angle) * radius
        const z = clump.z + Math.sin(angle) * radius

        if (this.isBlocked(x, z, _context)) continue

        // 缩放偏小：几块大的石子加一堆小石子比平均大小自然。
        // 上限压在 0.6 左右 —— 再大就成"巨石"了，
        // 一堆两米高的石头会把地面的尺度感彻底带偏，
        // 观众会以为自己在巨人国，而不是在草地上。
        const size = 0.16 + Math.pow(_rng(), 2.0) * 0.44
        const scale = [
          size * (0.78 + _rng() * 0.44),
          size * (0.55 + _rng() * 0.5),
          size * (0.78 + _rng() * 0.44),
        ]

        const quaternion = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            (_rng() * 2 - 1) * 0.25,
            _rng() * Math.PI * 2,
            (_rng() * 2 - 1) * 0.25
          )
        )

        entries.push({
          position: [x, this.heightAt(x, z), z],
          quaternion,
          scale,
          // 每块石头亮度差一点点，避免整片同一个调子
          tint: 0.72 + _rng() * 0.42,
        })
      }
    }

    return entries
  }

  /**
   * 草丛：数量比石头多得多，负责「铺满感」。
   * 不投影——几百个投影会把阴影贴图糊掉。
   */
  buildTufts(_clumps, _rng, _context) {
    const entries = []
    const quota = Math.round(TARGET_TUFTS / TUFT_KEEP_RATE)
    const counts = capQuota(distributeQuota(_clumps.map((c) => c.weight), quota), MAX_PER_CLUMP)

    for (let ci = 0; ci < _clumps.length; ci++) {
      const clump = _clumps[ci]
      for (let i = 0; i < counts[ci]; i++) {
        const angle = _rng() * Math.PI * 2
        const radius = clump.radius * Math.sqrt(_rng())
        const x = clump.x + Math.cos(angle) * radius
        const z = clump.z + Math.sin(angle) * radius

        if (this.isBlocked(x, z, _context)) continue

        const size = 0.75 + _rng() * 0.85
        const quaternion = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            (_rng() * 2 - 1) * 0.16,
            _rng() * Math.PI * 2,
            (_rng() * 2 - 1) * 0.16
          )
        )

        entries.push({
          position: [x, this.heightAt(x, z), z],
          quaternion,
          scale: [size * (0.85 + _rng() * 0.3), size, size * (0.85 + _rng() * 0.3)],
          tint: 0.7 + _rng() * 0.5,
        })
      }
    }

    return entries
  }

  /**
   * 路肩草：沿路径两侧 1.45~3.4m 的一圈带。
   *
   * 为什么单独做一套：clump 撒点把整片场地均摊了 260 丛草，
   * 平均每 9 平方米一丛 —— 路两边和空地一样稀。
   * 但观众真正盯着看的就是路两边那一带，
   * 所以密度要在那里单独提上去。
   *
   * 尺寸比场地里的草丛小：这些草离相机最近，太大会挡住画面。
   */
  buildVergeTufts(_paths, _rng, _context) {
    const entries = []
    if (!Array.isArray(_paths) || _paths.length === 0) return entries

    const spacing = 0.7

    for (let pi = 0; pi < _paths.length; pi++) {
      const path = _paths[pi]
      if (!path || !path.curve) continue

      const length = path.curve.getLength()
      const steps = Math.max(4, Math.floor(length / spacing))

      for (let i = 0; i <= steps; i++) {
        const u = Math.min(0.99, Math.max(0.01, i / steps))
        const point = path.curve.getPointAt(u)
        const tangent = path.curve.getTangentAt(u)

        const nx = -tangent.z
        const nz = tangent.x

        // 每一步随机决定左右和距离，偶发双丛
        const sides = _rng() < 0.18 ? [-1, 1] : [_rng() < 0.5 ? -1 : 1]
        const density = _rng() < 0.72 ? 1 : 0

        for (const side of sides) {
          if (density === 0) continue

          const offset = side * (1.45 + _rng() * 1.95)
          const x = point.x + nx * offset
          const z = point.z + nz * offset

          if (this.isBlocked(x, z, _context)) continue

          const size = 0.5 + _rng() * 0.55
          const quaternion = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              (_rng() * 2 - 1) * 0.2,
              _rng() * Math.PI * 2,
              (_rng() * 2 - 1) * 0.2
            )
          )

          entries.push({
            position: [x, this.heightAt(x, z), z],
            quaternion,
            scale: [size * (0.85 + _rng() * 0.3), size, size * (0.85 + _rng() * 0.3)],
            tint: 0.62 + _rng() * 0.42,
          })
        }
      }
    }

    return entries
  }

  /**
   * 找一条路径上「能放东西」的那一段。
   *
   * 路径两头都是禁区：出生点净空 / 展台净空。
   * 短路径会被这两块禁区吃掉大半甚至整条，短到一定程度就等于没有路。
   *
   * @returns {{from:number,to:number,length:number}} u 的可用区间
   */
  findUsableWindow(_path, _context, _landmarkClear) {
    const steps = 48
    let from = -1
    let to = -1

    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      const p = _path.curve.getPointAt(u)
      const dSpawn = Math.hypot(p.x - _context.spawn.x, p.z - _context.spawn.z)
      const dLand = Math.hypot(p.x - _path.landmark.x, p.z - _path.landmark.z)
      const ok = dSpawn >= _context.spawnClear && dLand >= _landmarkClear
      if (ok) {
        if (from < 0) from = u
        to = u
      }
    }

    if (from < 0) return { from: 0, to: 0, length: 0 }

    const length = _path.curve.getLength()
    return { from, to, length: (to - from) * length }
  }

  /**
   * 路标柱：沿路径等距取点，但每个点都要抖一下、还要随机跳过，
   * 整整齐齐一排路桩反而假。
   *
   * 取点用弧长参数（getPointAt），路径弯一点也不会挤在拐弯处。
   */
  buildWayposts(_paths, _rng, _context) {
    const posts = []
    const caps = []
    if (_paths.length === 0) return { posts, caps }

    const windows = _paths.map((path) => this.findUsableWindow(path, _context, LANDMARK_CLEAR))
    const lengths = windows.map((w) => w.length)
    const counts = allocateByLength(lengths, TARGET_WAYPOSTS, POSTS_PER_METER)

    const placed = []

    for (let pi = 0; pi < _paths.length; pi++) {
      const path = _paths[pi]
      const usable = windows[pi]
      const count = counts[pi]
      if (count <= 0 || usable.to <= usable.from) continue

      // 多放两个候选，再随机丢掉一两个 —— 路标要留缺口，不能整整齐齐
      const candidates = count + 2
      const skipped = new Set()
      const skipCount = Math.min(2, Math.floor(candidates / 3))
      while (skipped.size < skipCount) skipped.add(Math.floor(_rng() * candidates))

      const step = (usable.to - usable.from) / candidates

      for (let i = 0; i < candidates; i++) {
        if (skipped.has(i)) continue

        const u = Math.min(
          0.97,
          Math.max(0.03, usable.from + (i + 0.5) * step + (_rng() * 2 - 1) * step * 0.4)
        )
        const point = path.curve.getPointAt(u)
        const tangent = path.curve.getTangentAt(u)

        // 垂直于路径方向偏移一点，左右随机
        const nx = -tangent.z
        const nz = tangent.x
        const side = _rng() < 0.5 ? -1 : 1
        const offset = side * (0.55 + _rng() * 0.5)

        const x = point.x + nx * offset
        const z = point.z + nz * offset

        if (this.isBlocked(x, z, _context)) continue

        // 互相不要叠在一起
        let tooClose = false
        for (const other of placed) {
          if (Math.hypot(x - other.x, z - other.z) < POST_SPACING) {
            tooClose = true
            break
          }
        }
        if (tooClose) continue
        placed.push({ x, z })

        const height = 1.2 + _rng() * 0.8
        const tilt = new THREE.Euler(
          (_rng() * 2 - 1) * 0.08,
          _rng() * Math.PI * 2,
          (_rng() * 2 - 1) * 0.08
        )
        const quaternion = new THREE.Quaternion().setFromEuler(tilt)
        const base = new THREE.Vector3(x, this.heightAt(x, z), z)

        // 柱体：原点在底面，直接贴地
        posts.push({
          position: [base.x, base.y, base.z],
          quaternion,
          scale: [1, height, 1],
        })

        // 发光帽：跟着倾斜走，放在柱顶
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)
        const capPosition = base.clone().addScaledVector(up, height)
        caps.push({
          position: [capPosition.x, capPosition.y, capPosition.z],
          quaternion,
          scale: [1, 1, 1],
        })
      }
    }

    return { posts, caps }
  }

  /**
   * 灯：放在路径的关键节点（t ≈ 0.25 / 0.55 / 0.85），
   * 数量少但醒目，暗示「这里有光」。
   *
   * 具体取哪些点由「可用区间」决定：短路径上 0.25 会落在出生点净空里，
   * 所以在可用区间里等距取点，等价于「路径上的关键节点」。
   */
  buildLamps(_paths, _rng, _context) {
    const poles = []
    const caps = []
    const placed = []
    if (_paths.length === 0) return { poles, caps }

    const windows = _paths.map((path) => this.findUsableWindow(path, _context, LANDMARK_CLEAR))
    const lengths = windows.map((w) => w.length)
    // 配额放大一点：灯之间还要按间距筛，会掉几个
    const counts = allocateByLength(lengths, TARGET_LAMPS * 1.3, LAMPS_PER_METER)

    for (let pi = 0; pi < _paths.length; pi++) {
      const path = _paths[pi]
      const usable = windows[pi]
      const count = counts[pi]
      if (count <= 0 || usable.to <= usable.from) continue

      const step = (usable.to - usable.from) / count

      for (let i = 0; i < count; i++) {
        if (poles.length >= TARGET_LAMPS) return { poles, caps }

        const u = Math.min(
          0.97,
          Math.max(0.03, usable.from + (i + 0.5) * step + (_rng() * 2 - 1) * step * 0.25)
        )
        const point = path.curve.getPointAt(u)
        const tangent = path.curve.getTangentAt(u)

        const nx = -tangent.z
        const nz = tangent.x
        const side = _rng() < 0.5 ? -1 : 1
        const offset = side * (0.9 + _rng() * 0.45)

        const x = point.x + nx * offset
        const z = point.z + nz * offset

        if (this.isBlocked(x, z, _context)) continue

        let tooClose = false
        for (const other of placed) {
          if (Math.hypot(x - other.x, z - other.z) < LAMP_SPACING) {
            tooClose = true
            break
          }
        }
        if (tooClose) continue
        placed.push({ x, z })

        const height = 3.2 * (0.94 + _rng() * 0.12)
        const tilt = new THREE.Euler(
          (_rng() * 2 - 1) * 0.03,
          _rng() * Math.PI * 2,
          (_rng() * 2 - 1) * 0.03
        )
        const quaternion = new THREE.Quaternion().setFromEuler(tilt)
        const base = new THREE.Vector3(x, this.heightAt(x, z), z)
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)

        poles.push({
          position: [base.x, base.y, base.z],
          quaternion,
          scale: [1, height / 3.2, 1],
        })

        caps.push({
          position: [base.x + up.x * height, base.y + up.y * height, base.z + up.z * height],
          quaternion,
          scale: [1, 1, 1],
        })
      }
    }

    return { poles, caps }
  }

  /* ---------------------------------------------------------------- *
   * 网格与材质
   * ---------------------------------------------------------------- */

  /**
   * 建 6 个 InstancedMesh：石块、草丛、路标柱、路标帽、灯柱、灯头。
   * 发光件必须单独一个 mesh（MeshBasicMaterial 不吃光，
   * 和柱体共用一个 mesh 就会被柱体的光照逻辑带到一起去）。
   */
  createMeshes(_rocks, _tufts, _waypostSet, _lampSet) {
    const waypostCaps = _waypostSet.caps
    const lampCaps = _lampSet.caps

    // ---- 材质：同角色共享同一个实例 ----
    // 石头比其它石构件要暗一档：它们是地上的散件，
    // 用和门柱一样的亮度会变成一堆白疙瘩，抢展台的注意力。
    const rockMaterial = material('bodyPrimary', { color: 0x5d5648 })
    const tuftMaterial = material('bodySecondary', { color: TUFTS_COLOR, side: THREE.DoubleSide })
    const postMaterial = material('bodySecondary')
    // 路标帽要压暗：它是"这里有路"的标记，不是光源。
    // 用满亮的信号色的话，几十个小亮点会在画面里互相抢，
    // 比展台还显眼。
    const waypostCapMaterial = signalMaterial(0x8a6134)
    const lampCapMaterial = signalMaterial(PALETTE.emissiveSignal, {
      transparent: true,
      opacity: 1,
    })
    this.materials.push(rockMaterial, tuftMaterial, postMaterial, waypostCapMaterial, lampCapMaterial)
    this.lampCapMaterial = lampCapMaterial

    // ---- 几何体：全场景共享一份 ----
    const rockGeometry = createRockGeometry()
    const tuftGeometry = createTuftGeometry()
    const waypostGeometry = createWaypostGeometry()
    const waypostCapGeometry = createWaypostCapGeometry()
    const lampPoleGeometry = createLampPoleGeometry()
    const lampCapGeometry = createLampCapGeometry()
    this.geometries.push(
      rockGeometry,
      tuftGeometry,
      waypostGeometry,
      waypostCapGeometry,
      lampPoleGeometry,
      lampCapGeometry
    )

    this.meshes.rocks = this.createMesh('scenery-rocks', rockGeometry, rockMaterial, _rocks, {
      castShadow: true,
      receiveShadow: true,
    })
    this.meshes.tufts = this.createMesh('scenery-tufts', tuftGeometry, tuftMaterial, _tufts, {
      castShadow: false,
      receiveShadow: false,
    })
    this.meshes.wayposts = this.createMesh(
      'scenery-wayposts',
      waypostGeometry,
      postMaterial,
      _waypostSet.posts,
      { castShadow: true, receiveShadow: true }
    )
    this.meshes.waypostCaps = this.createMesh(
      'scenery-waypost-caps',
      waypostCapGeometry,
      waypostCapMaterial,
      waypostCaps,
      { castShadow: false }
    )
    this.meshes.lampPoles = this.createMesh(
      'scenery-lamp-poles',
      lampPoleGeometry,
      postMaterial,
      _lampSet.poles,
      { castShadow: true, receiveShadow: true }
    )
    this.meshes.lampCaps = this.createMesh('scenery-lamp-caps', lampCapGeometry, lampCapMaterial, lampCaps, {
      castShadow: false,
    })
  }

  /** 填实例矩阵。几何体和材质共享，实例只带变换。 */
  createMesh(_name, _geometry, _material, _entries, _options = {}) {
    const mesh = new THREE.InstancedMesh(_geometry, _material, _entries.length)
    mesh.name = _name
    mesh.castShadow = !!_options.castShadow
    mesh.receiveShadow = !!_options.receiveShadow

    const dummy = new THREE.Object3D()
    const color = new THREE.Color()

    for (let i = 0; i < _entries.length; i++) {
      const entry = _entries[i]
      dummy.position.set(entry.position[0], entry.position[1], entry.position[2])
      dummy.quaternion.copy(entry.quaternion)
      dummy.scale.set(entry.scale[0], entry.scale[1], entry.scale[2])
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      if (entry.tint !== undefined) {
        color.setRGB(entry.tint, entry.tint, entry.tint)
        mesh.setColorAt(i, color)
      }
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.count = _entries.length
    // 空的时候直接不画，省一次无意义的遍历
    mesh.visible = _entries.length > 0
    mesh.computeBoundingSphere()

    this.container.add(mesh)
    return mesh
  }
}
