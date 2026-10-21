import * as THREE from 'three'

/**
 * 画面暗角 + 胶片颗粒。
 *
 * 解决两件事：
 *   1. 暗角把视线收回画面中心，顺手压掉四角的高光溢出；
 *   2. 胶片颗粒给纯色块一点细纹，抵消大面积平涂带来的"塑料感"。
 *
 * 关键做法：顶点着色器直接输出 `gl_Position = vec4(position.xy, 1.0, 1.0)`，
 * 绕开投影矩阵，把这块 2×2 的平面直接铺满 NDC 全屏。这样它
 *   - 永远在画面最上层，不受相机 FOV 和宽高比影响；
 *   - 不需要每帧跟随相机做变换（顶点位置直接就是裁剪坐标）。
 *
 * 代价是它不参与深度：靠 depthTest:false + renderOrder 999 保证压在最上面。
 */

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // PlaneGeometry(2, 2) 的顶点本来就在 [-1, 1]，直接当裁剪坐标用，
    // 等于「这块面就是整个屏幕」，不需要投影矩阵参与。
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uDarkness;
  uniform float uOffset;
  uniform float uGrain;
  uniform float uTime;

  varying vec2 vUv;

  // 经典的 hash 噪声：够随机，够便宜
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // 到中心的归一化距离：中心 0，边中 1.0，四角约 1.41
    float dist = length(vUv - 0.5) * 2.0;

    // uOffset 控制暗角铺开的范围：值越小暗角越靠外。
    // smoothstep 保证边缘是软过渡，不会出现一圈硬边。
    float edge = smoothstep(uOffset * 0.30, uOffset * 1.25, dist);

    // 颗粒按秒跳一次，不是每帧都换 —— 每帧换就是噪点爆闪，很廉价。
    float second = floor(uTime);
    float n = hash(vUv * 1024.0 + second * 37.0);

    float alpha = edge * uDarkness + (n - 0.5) * uGrain;

    gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(alpha, 0.0, 1.0));
  }
`

export default class Vignette {
  /**
   * @param {object} _options
   * @param {THREE.Camera} [_options.camera] 相机（只记录，不自动挂载）
   * @param {number} [_options.darkness=1.0] 暗角浓度
   * @param {number} [_options.offset=1.05] 暗角铺开范围
   * @param {number} [_options.grain=0.07] 颗粒强度
   */
  constructor(_options = {}) {
    const { camera, darkness = 1.0, offset = 1.05, grain = 0.07 } = _options

    this.camera = camera

    this.uniforms = {
      uDarkness: { value: darkness },
      uOffset: { value: offset },
      uGrain: { value: grain },
      uTime: { value: 0 },
    }

    this.geometry = new THREE.PlaneGeometry(2, 2)

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      // 暗角是屏幕效果，不该被场景里的任何东西挡住，也不该写深度
      depthTest: false,
      depthWrite: false,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    // 顶点直接输出裁剪坐标，包围盒判定没有意义，关掉省一次计算
    this.mesh.frustumCulled = false
    // 排在所有透明物体之后，保证压在画面最上层
    this.mesh.renderOrder = 999
    // 矩阵不参与渲染（着色器绕开了它），不需要每帧更新
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()

    // 注意：这里不 add 到任何场景。
    // 由调用方负责 `camera.add(vignette.mesh)` —— 挂到相机下，暗角才会跟着
    // 镜头一起走，不会随着视角偏移漂出画面。
    // 提醒一句：相机本身要在场景图里（scene.add(camera)），
    // 否则它的子物体不会被渲染器遍历到，暗角不会出现。
  }

  /**
   * 每帧更新颗粒的时间。
   *
   * @param {number} _elapsed 累计时间（秒）
   */
  update(_elapsed) {
    this.uniforms.uTime.value = _elapsed
  }

  /**
   * 视口尺寸变化。
   * 这个面是 NDC 全屏的，宽高比变化不影响它，所以这里不需要改 uniform；
   * 保留接口是为了让调用方的 resize 管线保持统一。
   */
  setSize(_width, _height) {}

  /** 释放 GPU 资源 */
  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
