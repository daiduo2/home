# three.js 交互式 3D 项目调研（2026-10-21）

调研目的：上一轮只看了 3 个「个人主页类」项目，样本太窄，结论不成立。
这一轮把范围放到**已开源的 three.js 交互式 3D 项目，尤其是 3D 游戏**，看它们的
角色控制器、相机、关卡组织、渲染管线、交互反馈到底怎么写。

---

## 0. 结论摘要

1. **上一轮调研的方法是错的，不是结论错了。** 拿「个人主页」当样本，只能抄到皮相。
   真正的手感、关卡组织、交互反馈都在游戏源码里。
2. **我们当前的底子客观上不合格**，不是"简陋"，是**画面里没有可被眼睛读到的信息**
   （见第 2 节的四项指标）。
3. **卡顿从来不是瓶颈。** draw call 33 / 三角形 440，桌面预算 300 / 750k，
   只用掉不到 10%。场景是空的。
4. **架构上有一处根本性错误**：用 cannon-es 动态刚体当角色。
   4 个开源项目里 3 个用运动学角色。休眠、翻滚、卡地三个坑全部源于此。
5. **交互模型要换**：现在「展台 = 一块永远立在那的板子 + 一个 DOM 弹窗」。
   行业做法是**有状态机的 3D 对象**（HIDDEN/OPEN/CONCEALED），靠近触发 reveal，
   带音效和补间。
6. **氛围不用后处理**：渐变天球 + 雾色=天空底色 + 挂 camera 的暗角 quad +
   backface 放大法描边，四样加起来 3~4 个 draw call。
7. **matcap 这条划掉**：在五个开源项目的源码里 grep 0 命中，找不到一手证据，
   而且它会让场景失去方向光的明暗层次。

---

## 1. 上一轮调研的三个问题

| 问题 | 后果 |
|---|---|
| 样本全是 portfolio 站（Bruno folio-2025 / folio-2019）+ 一个半废弃的改造中间态（jet-tong/3d-folio，相机全被注释） | 没看到任何真正的游戏控制器/关卡组织 |
| 只研究了渲染，没研究玩法 | 抄了「TSL 卡通明暗」，但那套要 WebGPU + three 0.183，我们用 0.169 经典管线，根本抄不了 |
| 没有客观判据 | 「底子烂」一直只是感觉，说不出烂在哪 |

---

## 2. 底子体检：用知识库自带的视觉评分卡打分

判据来自 `majidmanzarpour/threejs-game-skills`
（`skills/threejs-aaa-graphics-builder/references/visual-scorecard.md`），
指标定义在 `skills/threejs-qa-release/scripts/inspect-threejs-canvas.mjs` 的
`computePixelMetrics()`。

**线上实测（https://aufheben.top/，Edge headless 1280×720）**：

| 指标 | 实测 | 门槛 | 判定 |
|---|---|---|---|
| `colorEntropyBits` | **1.06** | ≥ 3.0 | 不及格 |
| `dominantColorShare` | **0.769** | ≤ 0.6 | 不及格 |
| `edgeDensity` | **0.034** | ≥ 0.04 | 不及格 |
| `luminance.contrast` | **5.7** | ≥ 60 | 不及格 |

整帧画面的亮度只落在 255 级里的 **5.7 级**跨度内，77% 的像素是同一个颜色。
四项全挂。

**同时命中的「自动失败项」**（评分卡 §Automatic failures）：

- 活动画面被未加工的占位物和空地主导 —— 命中
- 主角资产是未加工的原始几何体加发光 —— 命中
- 用雾/黑暗代替缺失的场景几何 —— 命中（深蓝网格地面 + 雾 + 深色牌子）

**渲染预算对照**（`references/technical-art.md`）：

| 指标 | 我们 | 桌面预算 | 移动端预算 |
|---|---|---|---|
| draw call | 33 | ≤ 300 | ≤ 150 |
| 三角形 | 440 | ≤ 750k | ≤ 300k |
| 几何体 | 34 | ≤ 300 | ≤ 200 |
| 贴图 | 6 | ≤ 60 | ≤ 40 |
| 阴影投射灯 | 1 | ≤ 2 | 1 |
| 阴影贴图 | 1024 | ≤ 2048 | ≤ 1024 |
| 后期 pass | 0 | ≤ 2 | 0-1 |

**结论：预算几乎全空。**「卡」的问题从来不是 draw call，是我们在空地上省电。
可以放心把几何量放大一个数量级。

---

## 3. 调研样本

### 3.1 角色控制器与相机

| 仓库 | stars | 控制器类型 | 碰撞体 | 相机 | 遮挡 |
|---|---|---|---|---|---|
| `matthias-schuetz/THREE-BasicThirdPersonGame` | 148 | 刚体（cannon.js 0.6） | Box | 固定偏移 2.5D 侧视 | 无 |
| `yomotsu/meshwalk` | 312 | **运动学**（自研三角形碰撞） | 胶囊 r.5/h2 | camera-controls spring arm，极角 30°~120° | **球形扫掠** r=0.1 |
| `hh-hang/three-player-controller` | 267 | **运动学**（位置推出） | 胶囊（模型 bbox 推出） | OrbitControls + 临界阻尼弹簧 | 射线 + lerp 0.18 |
| `hexianWeb/Third-Person-MC` | 195 | 运动学 | 胶囊 r.3/h.55 | 固定偏移 + 指数阻尼 λ12 | 无 |

> ⚠️ `THREE-BasicThirdPersonGame` 的 README 称 "third person game"，实际是
> **Z 轴朝上的 2.5D 侧视脚手架**，只能当反例。
> ⚠️ `three-player-controller` 被描述为有手柄映射，**与实现不符**：全仓
> `gamepad` 0 命中，README 也未宣称。

**关键结论：3/4 用运动学角色，根本不给角色用物理引擎。**
我们用 cannon-es 动态球体当角色是少数派。

### 3.2 场景构建与零素材美术

| 仓库 | stars | 场景组织 | 纹理来源 | 材质 | 光照 | 雾 | 相机 FOV |
|---|---|---|---|---|---|---|---|
| `StarKnightt/jungle-trail` | 305 | 手写曲线骨架 + 程序化高度场，分块 24m | **GPU GLSL 烘焙**（albedo/normal/ORM） | MeshStandard + 逐顶点属性 | 方向光（由散射推导 ≤7.6）+ Hemisphere 0x82a081/0x63513a 0.55 | FogExp2 0x323c2c 0.038 | 58（第一人称） |
| `EvanBacon/pillar-valley` | 772 | 运行时无限生成 + 对象池 | 无贴图，纯色 HSL | MeshPhong + flatShading | Directional 0xffffff 2.4 + Hemi 0xfff4e0/0xffb070 1.6 | **高度雾，色 = 背景渐变** | 70 |
| `Steve245270533/gallery` | 781 | glb 场景 + 运行时贴图 | 外部 glb + png | MeshBasic/Phong | glb 内 PointLight | 无 | 55 |
| `wwwtyro/Astray` | 607 | 程序化迷宫 11×11 | 外部 png | MeshPhong | 单盏跟随相机的 PointLight | 无 | 60 |

### 3.3 手感与交互流程

- `majidmanzarpour/threejs-game-skills`（2559 stars）—— 9 个 skill 的知识库，
  含可直接抄的脚手架（`assets/threejs-vite-game/`）。本轮最高信号来源。
- `gamedev-skills/awesome-gamedev-agent-skills` —— 74 个 skill 索引，含
  camera-systems / input-systems / level-design / audio-design 等 reference。
- `akarlsten/cuberun`（352）—— r3f 小游戏，看完整结构和交互流程。
- `EvanBacon/Expo-Crossy-Road`（1165）—— 看移动端适配和游戏循环。

### 3.4 渲染管线与性能预算

`iErcann/enari-engine`（279）· `mohsenheydari/three-fps`（230）· `lo-th/phy`（745）·
`hmans/composer-suite`（568）· `jeromeetienne/threex`（334，vendor three r59，2017 年）。

> `lo-th/phy` 仓库 741MB，克隆超时，改用 GitHub raw API 逐文件读取。

### 3.5 自己加读的：Bruno `folio-2025`

`brunosimon/folio-2025`（MIT）是「portfolio 当游戏」的原型，1374 个文件。
上一轮只看了它的渲染，这次补看了它的**组织方式**（见第 6 节）。

---

## 4. 角色控制器与相机

### 4.1 控制器

**运动学是主流。** `meshwalk` 的 `CharacterController.move(velocity)` 只存"期望水平
速度"，位置自己积分（`src/core/CharacterController.ts:291,731`），无刚体、无冲量。
`three-player-controller` 注释直接写「不走刚体冲量核（位置推出式 CharacterController）」
（`src/systems/CharacterMovement.ts:19-22`）。

**没有休眠坑，是因为它们根本没给角色用引擎。** cannon-es 0.20 的 `World` 构造里
`this.allowSleep = !!options.allowSleep`（默认 **false**）——**是我们自己的
`Physics.js:25` 主动打开了它**，才需要给角色打 `body.allowSleep = false` 的补丁。

**碰撞体统一是胶囊。** 盒碰撞体会卡棱角（BasicTPG 就用 Box）。

**加速度/减速度要分开。**
`three-player-controller/src/systems/CharacterMovement.ts:76-88`：

```ts
const accelStep = c.playerAcceleration * c.decelBase * delta;
const targetX = c.moveDir.x * c.curPlayerSpeed;
const diffX = targetX - c.playerVelocity.x;
const xzApplied = Math.min(xzDiffLen, hasXZInput ? accelStep : decelStep);
c.playerVelocity.x += (diffX / xzDiffLen) * xzApplied;
```

我们现在是单一混合系数 `blend = min(1, acceleration * delta)`（`Character.js:162`），
**帧率相关**且停下时没有专门的减速度 → 「滑停」。

**标准趋近式是 `1 - exp(-k·dt)`**，不是 `min(1, k·dt)`。
`threejs-game-skills` 脚手架 `Player.ts:53-56`：

```ts
this.targetVelocity.set(this.move.x, 0, this.move.y).multiplyScalar(tuning.speed * dash);
const smoothing = 1 - Math.exp(-tuning.acceleration * delta);
this.velocity.lerp(this.targetVelocity, smoothing);
```

参数：`speed 5.8 / dashMultiplier 1.75 / acceleration 13`。

**地面检测用射线，不靠碰撞事件。** `meshwalk` 还做了坡度（`slopeLimit = 50°`）和
自动上台阶（`stepOffset 0.3`）。

**手柄：4 个仓库一个都没实现**（`grep gamepad` 全仓 0 命中）。
与我们「手柄不参与移动」的结论一致 —— 而且我们实测过本机 DualSense 轴是坏的。

**输入层每帧从零重算。** `meshwalk/src/TPS/KeyboardControls.ts:213-222` 布尔量重算
输入向量、对角归一化、blur 时清零。`three-player-controller` 的触屏有**死区 0.2**
（`src/utils/MobileControls.ts:206-209`）。

**固定步长 + 追帧上限。** `meshwalk/src/core/World.ts:148-183`：`fps=60` 累加器 +
每帧 4 个 substep，`MAX_CATCH_UP_FRAMES = 5` 防止切标签页后「死亡螺旋」。
我们 `world.step(1/60, delta, 5)` 已等价。

### 4.2 相机

**极角夹紧，而不是欧拉角硬转。**
`meshwalk/src/TPS/ThirdPersonCameraControls.ts:54-62`：`minPolarAngle 30° /
maxPolarAngle 120°`。这就是「抬头钻到地面以下」的正解 —— 夹极角。
`composer-suite` 的 OrbitControls 也用 `maxPolarAngle = Math.PI * 0.48`（≈86°，
永不入地）。

**遮挡用球形扫掠（Unreal SpringArm 语义），不是细射线。**
`meshwalk/src/TPS/ThirdPersonCameraControls.ts:110-136`：

```ts
const direction = _v3A.setFromSpherical(this._spherical).divideScalar(this._spherical.radius);
const hit = this.world.colliders[i].sphereCast(this._target, direction, maxDistance, radius);
```

并给了近裁剪面约束（`:46-52`）：
`collisionRadius >= camera.near * tan(fov/2) * sqrt(1+aspect²)`。
我们当前 near 0.1 / fov 28 → r ≥ 0.048。

**跟随用指数阻尼。** `three-player-controller` 临界阻尼弹簧（`springCameraTime 0.05`）；
`Third-Person-MC` 的 `dampVec3(..., lambda 12, dt)`。我们已有的 λ22（拉近快）/
λ8（推远慢）方向正确。

**相机与角色朝向解耦。** 只有 `Third-Person-MC` 完全耦合（相机跟着角色朝向转）。
「后退不转身」只有我们实现，比 meshwalk（永远面朝移动方向）更保守，合理。

**指针锁失败兜底。** 只有我们和 `three-player-controller` 有。
后者 `src/systems/InputSystem.ts:241-246` 只在 `document.pointerLockElement === domElement`
时才用 `movementX`，否则完全不转 —— 我们做得更全。

---

## 5. 场景构建与零素材美术

### 5.1 「测试台感」的四个来源

`jungle-trail` / `pillar-valley` / `gallery` / `Astray` 的共同结论：

1. **纵深**：雾 + 背景渐变，且**雾色必须 = 地平线色**，不能各走各的。
2. **地面不是一张无限平面**：要有起伏、遮挡物、有限边界。
3. **光有方向**：一盏方向光做主光 + 阴影，半球光只负责「暗部不死黑」。
4. **空间有构成**：地标沿视线分拍摆放，不是平铺。

我们当前：无限平面 + 网格贴图 + 发光边框墙 + 雾色等于地面色 —— **四条全中**。

### 5.2 最该抄的一条

`pillar-valley/src/Game/GameScene.ts:42-61`：**屏幕空间渐变当 background，
同一个表达式做雾**，地平线无缝。

```ts
const skyGradient = mix(this.topColorUniform, horizonUniform, smoothstep(0.4, 1.0, screenUV.y));
this.backgroundNode = skyGradient;

const heightFactor = smoothstep(-350, 50, positionWorld.y).oneMinus();
this.fogNode = fog(skyGradient, heightFactor);
```

top `0x8dc8f5` ↔ `0x7877b4`，horizon `0xffb6df`。

### 5.3 雾色是「对比度地板」

比远景物体亮、比近景暗。`jungle-trail` 的雾 `0x323c2c` 配「远处深色 thicket
shade 0.74」——雾不是用来遮丑的，是用来建立层次的。

### 5.4 零素材做法

| 手段 | 出处 | 关键值 |
|---|---|---|
| GPU GLSL 烘焙 albedo/normal/ORM | jungle-trail `src/gfx/bake.js:10-12` | `void surf(vec2 uv, out vec3 albedo, out float height, out float rough, out float ao)` |
| CanvasTexture 画文字牌/地面色斑 | 我们已有 `labelTexture.js` | 把网格线换成 value noise |
| flatShading + 倒角接高光 | pillar-valley `Platform.ts:33-38` | `PLATFORM_BEVEL = 0.05` |
| 两灯配方 | pillar-valley `Game.ts:405-408` | Directional 2.4 + Hemi(0xfff4e0, 0xffb070, 1.6) |
| InstancedMesh 按（地块×变体）分桶 | jungle-trail `vegetation.js:1443` | 保证视锥剔除有效 |
| 密度用概率场 + 3 段 clump 噪声 | jungle-trail `vegetation.js:904-940` | **绝不用均匀撒** |

### 5.5 角色要显得大，靠参照物不靠 FOV

`FOV 越大越"玩具感"`。想让小人显得大：**距离拉近到 8~12m + FOV 30~35**，
再在场景里放可比的参照物（柱子/树/建筑）。调 FOV 不如放参照物有效。

### 5.6 不要抄

- **无限平面 + 发光边框墙** ← 就是我们现在这样
- Astray / gallery 的外部 png 与 glb —— 我们没有素材
- `MeshBasicMaterial` 做立牌（gallery 的牌子不接光）—— 像贴纸浮在空中
- 纯 Phong + 灰白 PointLight（Astray）—— 没有雾和背景，地面边缘直接露馅
- jungle-trail 的体积雾/光轴/PMREM 全套后处理（`atmosphere.js` 48KB、`grade.js` 66KB）
  —— 成本极高，我们没有 3D 场景密度去养它
- FOV 70 换"玩具感"（pillar-valley）—— 那是它的风格

---

## 6. 渲染管线与性能预算

样本：`iErcann/enari-engine`（279）、`mohsenheydari/three-fps`（230）、
`lo-th/phy`（745）、`hmans/composer-suite`（568）、`jeromeetienne/threex`（334）。

### 6.1 renderer 参数（精确值）

| | enari-engine | three-fps | phy | composer-suite | threex |
|---|---|---|---|---|---|
| three 版本 | `^0.164.0` | `^0.127.0` | peer `>= 0.183.2` | `^0.145.0` | vendor r59 / r67 |
| 色彩空间 | `outputColorSpace = SRGBColorSpace` | `outputEncoding = sRGBEncoding`（r127 旧 API） | 未显式写（0.183 默认即 SRGB） | 未显式写（R3F 负责） | 不适用 |
| tonemapping | `NoToneMapping` | `ReinhardToneMapping` | `NeutralToneMapping` | `flat` → NoToneMapping | 无 |
| exposure | `1.1` | `1` | `0.5` | — | — |
| shadowMap.type | `PCFSoftShadowMap` | `PCFSoftShadowMap` | 未指定 | `shadows` | r59 默认 PCF |
| antialias | `false` | `true` | `true`（dpr>2 或 LOW 档关） | `false` | 默认 true |
| pixelRatio | `1` | `devicePixelRatio`（**无上限**） | `min(dpr,2)` | 滑杆 0.125–2，默认 1 | 无 |

**没有一个项目用 `ACESFilmicToneMapping`。** enari / three-fps / composer-suite
全是 `NoToneMapping`，只有 phy 用 `NeutralToneMapping`。
→ 我们现在用 ACES + exposure 1.05 不是错，但纯色 low-poly 场景用
`NoToneMapping` + exposure 1.1（enari 组合）更常见。

### 6.2 氛围不靠后期，靠三层

**① 渐变天空 + 雾色 = 天空底色。**
`three-fps/src/entities/Sky/Sky.js`：`topColor / bottomColor / offset / exponent`
四个 uniform，`SphereBufferGeometry(1000,32,15)`，BackSide，
配 `FogExp2(0x89b2eb, 0.002)`，**雾色严格等于 bottomColor**。
`composer-suite` 更省：`background #222` + `fogExp2("#222", 0.03)`。

**② 暗角挂 camera 的全屏 quad，不走后处理。**
`phy/src/3TH/Vignette.js`：`PlaneGeometry(2,2)` + ShaderMaterial，
`depthTest:false / depthWrite:false / renderOrder:10000 / frustumCulled:false`，
uniforms `offset 1.05 / darkness 1 / grain 0.1`。**成本 1 个 draw call**，
比 `UnrealBloomPass` 便宜一个数量级，还自带胶片颗粒。

**③ 描边用 backface 放大法，不是后处理边缘检测。**
`threex/src/threex.outlinehelper/threex.outlinehelper.js:4-47`：
复制一份同 geometry，`side: THREE.BackSide`，按 FOV 与屏幕尺寸缩放外壳，
使**屏幕空间粗细恒定**：

```js
var verticalFov = camera.fov / 180 * Math.PI;
var viewPlaneHeight = objectDistance * (2 * Math.tan(verticalFov / 2));
var screenHeight = renderer.domElement.height;
var objectScreenHeight = screenHeight / viewPlaneHeight * objectHeight;
var scaleRatio = 0.0025 * (250 / objectScreenHeight);
var scaleFactor = 1 + scaleRatio * thickness;   // 屏幕空间恒定粗细
```

零额外 render target，每个物体 +1 draw call。

### 6.3 阴影：手动刷新 + 收紧范围

`enari-engine/src/View/Renderer/SkyLight.ts:34-46`：

```js
this.directionalLight.shadow.camera.right = 150   // ← 范围太大，浪费 1024²
this.directionalLight.shadow.mapSize.width  = 1024
this.directionalLight.shadow.bias  = -0.001
this.directionalLight.shadow.autoUpdate = false
```

`SceneLighting.ts:31-37` —— 阴影**每秒才更新一次**：

```js
this.shadowUpdater = new PeriodicUpdater(1000, () => {
    this.renderer.shadowMap.needsUpdate = true
}, this)
```

`phy/src/3TH/Lights.js`：2048² 但正交范围只有 ±30，near 5 / far 70，
bias 0.0001，radius 4。

> 我们现在 1024² 配 ±11m（±11 → 0.021 单位/texel）已经不错，但**没有开
> `shadowMap.autoUpdate = false`**，等于每帧重渲染阴影贴图。

### 6.4 美术风格与 matcap

**这批源码里没有一处 `flatShading` 或手搓 `onBeforeCompile`。**
全部是 PBR 贴图流：three-fps 是 `MeshStandardMaterial` + AO/normal/metalness/roughness
四件套 2K tga.png；enari 是 `MeshStandardMaterial`（烘焙 glb）+ `MeshPhongMaterial`。

**`grep matcap` 在三仓库里 0 命中。** composer-suite 只是把 `MeshMatcapMaterial`
做成可被 shader patch 的组件（`packages/material-composer-patched/src/patched.tsx:81`），
不是为了 matcap 视觉。

> ⚠️ **修正上一轮的判断**：我们之前把「matcap」列为候选手法，
> 但在这批开源源码里**找不到一手证据**。它能把 low-poly 统一成玩具感且不吃光，
> 代价是整个场景失去方向光的明暗层次——**对我们的展台不合适**。这条降级处理。

### 6.5 性能

- **没有任何仓库硬编码 draw call 数字**，只有运行时监控
  （enari `debugUI.addMonitor(info.render, 'calls')`、three-fps 用 stats.js）。
- **`THREE.LOD`：五个项目 0 处使用。**
- **`InstancedMesh`：只有 composer-suite**（`vfx-composer/src/InstancedParticles.ts:25-105`，
  capacity 1000，用 `attribute.updateRange.offset/count` 做部分上传，只传新发射的那段）。
- **纹理压缩**：只有 enari 用了 DRACO + Meshopt。**KTX2 / basis 五个项目都没有。**
- **降级**：phy 最完整，用 GPU tier 一次性定档而不是逐帧抖：

```js
const gpuTier = await getGPUTier();
if( Main.isMobile || perf.fps < 60 ){
    options.mode = 'LOW';
    options.quality = 1;      // → 地面 RT 从 2048 降到 1024
}
// addLight(): if( options.mode === 'LOW' ){ options.shadow = 0; options.reflect = 0; }
```

我们现在的「每 3 秒量帧率、低于 42 就降一档、只降不升」方向一致，可保留。

### 6.6 渲染层不要抄

1. `three-fps` 的 `setPixelRatio(window.devicePixelRatio)`（无上限）——4K 屏直接 4 倍像素
2. `three-fps` 的 3072² 阴影贴图 + 所有 mesh 都 `castShadow`
3. `enari` 的正交阴影范围 ±150 配 1024² —— 精度摊薄成 0.29 单位/texel，
   我们的展台只有几米大，应收到 ±20（0.039 单位/texel）
4. `enari` 的 SSAO + Bloom + LensDistortion 三件套 —— 我们 draw call 才 33，
   堆后期只会让低端机更卡；它自己 `hasPostProcess` 默认 false 才是对的默认值
5. **`threex` 整仓** —— vendor three r59/r67，2017 年最后提交，API 全部过时。
   只有 `OutlineHelper` 的数学值得移植
6. `phy` 的 `Reflector` 地面（额外 RT + 每帧重渲染）—— 对零素材没意义
7. `composer-suite` 的 matcap 补丁路线 —— 它是为了做 shader 组合框架

---

## 7. Bruno `folio-2025` 深读（补上一轮没看的部分）

上一轮只看了它的渲染。这次看组织方式。

### 7.1 世界按 Areas 分区

`sources/Game/World/Areas/` 下每个区一个自包含类，10~55KB：
`CircuitArea` / `ProjectsArea` / `LabArea` / `CareerArea` / `SocialArea` /
`BowlingArea` / `AltarArea` / `CookieArea` / `AchievementsArea` / `LandingArea` / `Intro`。

**一个内容类别 = 一个区。** 这直接回答了「3D 个人主页怎么组织内容」。

### 7.2 世界 = 一堆「景观系统」

`sources/Game/World/World.js:47-86`：

```js
this.grid = new Grid()
this.intro = new Intro()
...
this.floor = new Floor()
this.waterSurface = new WaterSurface()
this.grass = new Grass()
this.windLines = new WindLines()
this.confetti = new Confetti()
this.leaves = new Leaves()
this.rain = new RainLines()
this.lightnings = new Lightnings()
this.fireballs = new Fireballs()
this.snow = new Snow()
this.bushes = new Bushes()
this.birchTrees = new Trees('Birch Tree', ..., '#ff4f2b', '#ff903f')
this.oakTrees = new Trees('Oak Tree', ..., '#b4b536', '#d8cf3b')
this.cherryTrees = new Trees('Cherry Tree', ..., '#ff6d6d', '#ff9990')
this.flowers = new Flowers()
this.bricks = new Bricks()
this.fences = new Fences()
this.benches = new Benches()
this.poleLights = new PoleLights()
this.lanterns = new Lanterns()
this.scenery = new Scenery()
this.areas = new Areas()
```

**注意 `Trees` 的构造参数带两组颜色** —— 同一套几何体靠颜色变体撑出多个树种。
这是「零素材」下做丰富性的关键手法。

### 7.3 光照：一盏方向光 + TSL 两段式明暗

`sources/Game/Ligthing.js`：
- `DirectionalLight(0xffffff, 5)`，方向用球坐标 + 昼夜循环驱动
- `coreShadowEdgeLow -0.25 / coreShadowEdgeHigh 1` —— 卡通明暗的硬边
- `bounceColor = #82487f` —— 假 GI 的反弹色
- **阴影相机范围 = `view.optimalArea.radius`**（跟着相机注视区走，不是整个世界）
- `shadowBias -0.001 / shadowNormalBias 0.1 / shadowRadius 3`
- `mapSize 2048`（高画质）/ `512`（其他）

> 我们的 three 0.169 走经典 WebGLRenderer，**TSL 那套抄不了**（要 WebGPU +
> three 0.183，API 名字都变了，且 Safari/Firefox 的 WebGPU 支持还不稳）。
> 等价做法：用 `onBeforeCompile` 在经典管线里实现两段式明暗 + 假反弹光。

### 7.4 交互模型：带状态机的 3D 对象

`sources/Game/InteractivePoints.js`：

```js
static STATE_HIDDEN = 3
static STATE_OPEN = 4
static STATE_CONCEALED = 5
```

每个可交互物有 `reveal()` / `conceal()` / `hide()` / `show()`。
进入 2.5 单位半径 → `isIn = true` → `reveal()`（带音效 + gsap 补间）；
离开 → `conceal()`。多个候选时取**最近**的那个。

两个细节值得抄：
1. **只在玩家移动超过 0.2 单位时才重算距离**（`:585` `if(distanceTraveled > 0.2 || this.needsTest)`），
   避免每帧遍历。
2. **「按 E」提示是 3D 图标，`depthTest: false`** —— 永远压在最上层，
   不会被场景里的东西挡住。

---

## 8. 手感与交互反馈

来自 `threejs-game-skills` 与 `awesome-gamedev-agent-skills`。

### 8.1 反馈要分层，且按顺序

`game-feel.md:5-13`：
**输入延迟 ≤100ms → 响应曲线 → 接触反馈 → 相机 → 音画同步。**
我们只有第 1 层的一半（能走），后四层全空。

### 8.2 「可交互」要靠 affordance，不是文字说明

`ui-patterns.md:11,15`：「用图标/交互形态代替解释文字」「near-world for diegetic prompts」；
`:56` 把「用文字解释本该设计成 affordance 的操作」列为 recurring failure。

**我们 HUD 常驻的 `WASD 移动 / 鼠标转视角 / E 查看` 正是被点名的那一类。**

### 8.3 角色要有 idle 状态

我们 `Character.js:197-215`：停下时 `walkPhase` 不再推进（else 分支乘 0），
`bob` 冻结成常量 —— **没有 idle 呼吸**，`swing` 归零也是瞬时的。
这就是「方块在滑」的根因。

参考：
- `CrossyPlayer.ts:40-49` idle 呼吸（scale.y 1→0.8→1，0.3s，repeat -1，Power1 easeIn/Out）
- `cuberun/src/components/Ship.js:146-153` 程序化转向侧倾 `rotation.z = horizontalVelocity * 1.5`

### 8.4 移动端是一等公民

`ui-patterns.md:27-33` 六条硬规则：
pointer 事件发出与键鼠**同一个 intent**、必须处理
`pointerup/pointercancel/lostpointercapture/blur`、44px 触控目标、
`touch-action` 作用域化。

我们：摇杆已有但**无死区**、无 pointercancel 复位、`touch-action` 未作用域化。
死区标准：`dead 0.2`，`scaled = (mag - dead) / (1 - dead)`，**径向**死区
（逐轴死区会切出方洞）。

### 8.5 声音是完成度信号

`audio-workflows.md:76-84`：用户手势后 unlock、master/sfx/ui/ambience 分组、
同一个高频 SFX 要有 cooldown 或变体池。

零素材可跑的解锁 + 振荡器方案（脚手架 `AudioSystem.ts:5-40`）：

```ts
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });
...
this.context = new AudioContextClass(); await this.context.resume();
```

```ts
oscillator.frequency.setValueAtTime(320 + index * 22, now);
oscillator.frequency.exponentialRampToValueAtTime(680 + index * 24, now + 0.12);
gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02); // →0.08→0.0001
```

> **我们仓库里根本没有 `AudioContext`** —— `Interface.js:96` 的 `soundToggle` 是空壳。

### 8.6 交互反馈参数（`game-feel.md`）

| 效果 | 参数 |
|---|---|
| 屏震（trauma） | `TRAUMA_DECAY 1.4`、`MAX_OFFSET 0.55`、`MAX_ROLL 0.1`；拾取 0.15 / 受击 0.4 / 爆炸 0.7 |
| squash/stretch | 1.15 / 0.9，约 180ms |
| FOV punch | +4~8°，clamp 10，200ms 时间常数 |
| 命中闪白 | emissiveIntensity peak 2.4 / 220ms |
| 拾取弹出 | 0.28s 升起淡出 |

### 8.7 不要抄

- trauma² 屏震 / hitstop / 全屏闪 —— `game-feel.md:13` 自己都说会遮挡下一次决策
- 游戏化 HUD（LEVEL / KM/H / SCORE）—— 我们是主页，没有分数
- `Math.random()`（`CrossyGame.ts:272`）—— 破坏确定性，用 seeded RNG
- `GameOverScreen.js:46` 的 `window.location.reload()` 重开
- 骨骼动画 + glTF 资产管线 —— 我们是程序化低多边形

---

## 9. 反例对照：gqy20 的「3D 首屏」

`gqy20/gqy20.github.io` 的首屏是 **Godot 导出的 3D 场景**
（`godot/home-runtime/scripts/topology_world.gd`，979 行）。
但读源码后发现：**它是 Godot 的 2D `_draw()` 自绘拓扑图**，
`Rect2` / `StyleBoxFlat` / 胶囊 / 点阵，全是 2D 绘制指令。

产品形态完全不同：**引导式叙事**（stage / journey / path / section），
不是自由探索。

可抄的部分（与我们的路线不冲突）：
- **8 色命名色板**：`BG #0a0e1a` / `SURFACE #0f1424` / `INK #edf1f7` /
  `MUTED #a9b4c7` / `LINE rgba(140,200,255,0.18)` / `ACCENT #ffb86b` /
  `FLOW #63d9ff` / `VERIFIED #b8f26d`
- `reduced_motion` 支持（我们没有）
- `is_visible` → 页面不可见时暂停
- 缓动函数（`_ease_out_expo` / `_ease_in_out_cubic`）
- **章节结构**：内容不是「走到展台前」，而是「按顺序推进的章节」

---

## 10. 可以抄 / 不要抄

### 10.1 直接抄

1. `1 - exp(-k·dt)` 速度趋近（`Player.ts:55`），k ≈ 13
2. 加速度与减速度分离（`CharacterMovement.ts:76-88`）
3. 运动学胶囊角色 + 物理引擎只管静态几何（3/4 仓库一致）
4. 极角夹紧 30°~120° 代替 pitch 硬夹（`meshwalk`）
5. 球形扫掠遮挡 + 近裁剪约束（`meshwalk`）
6. 天空渐变 background 与雾同表达式（`pillar-valley`）
7. 两灯配方：Directional 2.2~2.4 + Hemisphere(冷天/暖地) 0.6~1.6
8. flatShading + 倒角 0.05
9. InstancedMesh 按（地块×变体）分桶
10. 概率场 + 3 段 clump 噪声做密度
11. 交互物三态 + 2.5m 半径 + 只在移动 >0.2 时重算
12. 「按 E」提示用 `depthTest: false` 的 3D 图标
13. 径向死区 0.2 + pointercancel/blur 复位
14. WebAudio 手势解锁 + 振荡器 chime（零素材出声）
15. 命名材质角色：`bodyPrimary / bodySecondary / trim / emissiveSignal /
    groundContact / decalDark / decalLight`（`technical-art.md:27-29`）
16. 同一几何体靠颜色变体撑多个树种（Bruno 的 `Trees`）
17. **渐变天球 + 雾色 = 天空底色**（three-fps `Sky.js` / composer-suite `#222`）
18. **暗角挂 camera 的全屏 quad**（phy `Vignette.js`，`depthTest:false`、
    `renderOrder:10000`、`frustumCulled:false`、grain 0.1），零后期开销
19. **描边用 backface 放大法**（threex `OutlineHelper`），屏幕粗细恒定、零额外 RT
20. **阴影手动刷新**：`shadowMap.autoUpdate = false` + 只在角色/光源变动时 `needsUpdate`
21. **降级用一次性分档**（phy GPU tier），不是逐帧调 dpr

### 10.2 不要抄

1. 无限平面 + 发光边框墙
2. cannon-es 刚体当角色（我们的现状）
3. `min(1, k·dt)` 这种帧率相关的趋近
4. trauma 屏震 / hitstop / 分数 HUD
5. `Math.random()`
6. TSL/WebGPU 那套（浏览器支持不稳）
7. 外部 glb / png 素材
8. 纯 Phong + 灰白 PointLight + 无雾
9. jungle-trail 的体积雾/PMREM 全套后处理
10. `window.location.reload()` 重开
11. `setPixelRatio(window.devicePixelRatio)` 无上限（three-fps）
12. 3072² 阴影贴图 + 所有 mesh 都 `castShadow`（three-fps）
13. 正交阴影范围 ±150 配 1024²（enari，精度摊薄成 0.29 单位/texel）
14. SSAO + Bloom + LensDistortion 三件套（enari）
15. **`threex` 整仓**（vendor three r59/r67，2017 年最后提交，API 全过时）
16. `Reflector` 镜面地面（phy，额外 RT + 每帧重渲染）
17. **matcap** —— 这批源码里 grep 0 命中，没有一手证据；
    且它会让整个场景失去方向光的明暗层次，对展台不合适

---

## 11. 重写方案（草案，待确认）

### 11.1 形态

保留「访客走进场地，走到展台前才看到内容」，但把**空地**换成**有构成的世界**：
一条从入口蜿蜒到四个展台的路径，路边有参照物（柱子、灯、路标、地形起伏），
四个展台各占一个不同的场景位置（不是四个平铺的牌子）。

### 11.2 分层重写

| 层 | 现状 | 改成 |
|---|---|---|
| 角色 | cannon-es 动态球体刚体 | **运动学胶囊**，物理只管静态几何与射线 |
| 地面 | 无限平面 + 网格 CanvasTexture | 有起伏的地形块 + 程序化噪声贴图 + 顶点色 |
| 天空 | `scene.background = null` + CSS 渐变 | 渐变天球（top/bottom/offset/exponent 四 uniform），**雾色 = 天空底色** |
| 光 | 半球 1.9 + 方向 2.4 | 方向 2.4（主光）+ 半球 0.85（冷天暖地）+ `onBeforeCompile` 两段式明暗 + 假反弹光 |
| 边界 | 发光矮墙 | 地形隆起 + 浓雾 |
| 展台 | 底座 + 平面立牌 | 构筑物（台座+矮墙+门楣）+ 嵌框立牌 + 三态 + 假阴影 |
| 描边 | 无 | backface 放大法（threex `OutlineHelper`），只给当前激活的展台开 |
| 暗角 | 无 | 挂 camera 的全屏 quad（phy `Vignette.js`），1 个 draw call，带胶片颗粒 |
| 阴影 | 1024² 跟随角色，每帧重算 | 同样 1024²，但 `shadowMap.autoUpdate = false`，角色移动才刷新 |
| 交互 | 距离判定 + DOM 弹窗 | 3D 状态机 + `depthTest:false` 提示图标 + 音效 + 补间 |
| 角色动画 | 摆腿，停下冻结 | idle 呼吸 / walk / run 三态 + 转向侧倾 |
| 相机 | pitch 硬夹 | 极角 30°~120° + 球形扫掠遮挡 |
| 声音 | 无 | WebAudio master/sfx/ui/ambience，零素材振荡器 |
| HUD | 常驻键位表 | 收进加载页/设置，场内只留近世界提示 |
| tonemapping | ACESFilmic + 1.05 | 纯色 low-poly 场景可换 `NoToneMapping` + 1.1（enari 组合），待 A/B |

### 11.3 验收判据

用视觉评分卡的指标做 before/after：

| 指标 | 目标 |
|---|---|
| `colorEntropyBits` | ≥ 3.0 |
| `dominantColorShare` | ≤ 0.6 |
| `edgeDensity` | ≥ 0.04 |
| `luminance.contrast` | ≥ 60 |

加上渲染预算不超（draw call ≤ 300 / 三角形 ≤ 750k / 阴影灯 ≤ 2），
以及移动端视口的独立截图。

---

## 附：可复用的工具

`tools/visual-metrics.mjs` —— Edge headless + CDP 截图，
把图送回页面用 2D canvas 解码，按评分卡算四项指标 + 采集渲染器诊断。
参考 `skills/threejs-qa-release/scripts/inspect-threejs-canvas.mjs` 的
`computePixelMetrics()`，但不依赖 Playwright（本机没有）。
