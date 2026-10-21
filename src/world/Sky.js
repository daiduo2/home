import * as THREE from 'three'
import { PALETTE } from '../core/Palette.js'

/**
 * 渐变天球。
 *
 * 为什么要自己写一个球，而不是用 CSS 渐变当背景？
 * 因为雾色必须和天际线色**完全一致**。CSS 背景和 three 的 fog 是两套系统，
 * 一旦色值对不上，远处地面和天空之间会出现一条硬边，整个纵深就废了。
 * 自己做天球就能保证：地平线那个颜色既是雾色，也是天球上那一圈的���色。
 *
 * 颜色取自 PALETTE：顶深靛 / 地平暖橙 / 地下暗紫。
 */
export default class Sky {
  constructor(_options = {}) {
    // 半径必须小于相机远裁剪面（400），否则天球会被裁掉一半。
    // 300 足够大：玩家最远走到场地边缘，离天球还有 260m 余量。
    this.radius = _options.radius || 300

    this.geometry = new THREE.SphereGeometry(this.radius, 32, 16)

    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(PALETTE.skyTop) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uBottom: { value: new THREE.Color(PALETTE.skyBottom) },
        uExponent: { value: 2.2 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;

        void main() {
          // 用「球面点 - 相机位置」得到视线方向，这样天球永远以观察者为中心，
          // 玩家走到场地任何位置，地平线的高度都不会变。
          vDirection = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        uniform float uExponent;

        varying vec3 vDirection;

        void main() {
          float y = normalize(vDirection).y;

          vec3 color;
          if (y >= 0.0) {
            // 地平线以上：从地平色过渡到顶色。
            // exponent 越大，过渡越靠近地平线（天顶色压得越低）。
            float t = pow(clamp(y, 0.0, 1.0), 1.0 / uExponent);
            color = mix(uHorizon, uTop, t);
          } else {
            // 地平线以下：往暗紫沉，通常被地形挡住。
            float t = pow(clamp(-y, 0.0, 1.0), 0.55);
            color = mix(uHorizon, uBottom, t);
          }

          gl_FragColor = vec4(color, 1.0);

          // ShaderMaterial 不会自动做色调映射和色彩空间转换，
          // 这两行必须手动加，否则天空会和其他物体对不上。
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'sky'
    // 天球永远在最远处，不参与深度写入，渲染顺序排在最前
    this.mesh.renderOrder = -1
    this.mesh.frustumCulled = false
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()
  }

  /** 地平线色，也是雾色 */
  get horizonColor() {
    return PALETTE.skyHorizon
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
