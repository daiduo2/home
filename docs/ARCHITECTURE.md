# 架构与决策记录

这份文档记录**为什么这样做**，不是**做了什么**——做了什么看代码和 README。

## 1. 形态选择

目标形态是 Bruno Simon 式可交互 3D 主页：访客在场地里走动，走到展台前才看到内容。

选它的理由，以及它带来的代价：

| 收益 | 代价 |
|---|---|
| 记忆点强，交互本身就是能力证明 | 找人成本高，赶时间的人找不到邮箱 |
| 内容按"逛到哪"自然展开，不受页面顺序限制 | 维护成本远高于静态页 |
| 低多边形场景天然适合科研向的克制调性 | 无 JS / 读屏用户完全拿不到内容 |

所以**文字清单是必备兜底，不是可选项**。`Tab` 打开，URL 加 `?list=1` 直接打开，`<noscript>` 里也有一份。

## 2. 底座：3d-folio 借鉴了什么

参考仓库 `jet-tong/3d-folio`（Bruno Simon 2019 版 fork，MIT，源仓库 `bruno-simon/three.js-template`）。原技术栈：webpack 4 + three 0.131.3 + cannon 0.6.2 + gsap 2 + howler。

### 直接借鉴

- **交互范式**：撞到地标才打开内容，不做导航栏
- **matcap 烘焙光照**：Bruno 视觉的灵魂，目标是让低端机也跑得动
- **低多边形扁平面调性**：`flatShading` + 玩具感几何体
- **阴影贴图跟随主体**：避免远处阴影边缘闪烁

### 明确不借鉴

| 3d-folio 的做法 | 原因 |
|---|---|
| `cannon` 0.6.2 + `RaycastVehicle` | 步行角色用不到车辆物理；cannon-es 才有 ESM 和现代 API |
| 它的相机系统 | **它的相机根本不跟随车**——是"拉远 + 滚动浏览"的展示型相机，靠 `Zone` 进出事件切两个固定角度。角色相机必须自己写 |
| `Area` / `Zone` 分区机制 | 当前场景规模用不上，等有多个区域再引 |
| `World/Sections/*` | 全是 Jensen 的私有内容 |
| `ThreejsJourney.js` | 推销 Three.js Journey 课程的弹窗，个人主页不需要 |
| `EasterEggs.js` 里的彩蛋 | 与 Jensen 个人绑定 |
| `static/social/*`（2.68 MB 分享图）与 `.wav`（6.66 MB） | 首屏用不到；`.wav` 在原 webpack 配置里根本没有 rule，从未被打包 |

### 原仓库里值得警惕的坑

- `Controls.js` 多处调用 `this.camera.pan.reset()`，而 `Camera.setPan()` 被注释掉 → `this.camera.pan` 是 `undefined`，**触屏前进/后退/刹车直接抛 TypeError**
- `Application.js` 里 `renderer.gammaFactor` / `gammaOutPut` 从 r112 就被删除，在 0.131 里已是无效赋值
- 0.131 时代没有 `ColorManagement`，迁到 0.169 后默认开启，**整体视觉会变**，自定义 shader 需要手动处理 `sRGBToLinear`
- 自定义 shader 里的 `#include <encodings_fragment>` 在 0.169 要改成 `#include <colorspace_fragment>`
- r169 的 `TransformControls` 不再继承 `Object3D`（改继承 `Controls`），场景图挂载方式变了
- `OrbitControls.enableKeys` 在 r165 已移除，`listenToKeyEvents` 也没了

## 3. 关键技术决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 构建 | Vite 5 | 原仓库是 webpack 4 + Babel，迁到 Vite 能直接用 ESM、免 loader 配置 |
| 物理 | cannon-es 0.20 | 步行角色只需要刚体 + 球体碰撞 + 射线；cannon-es 是 cannon 的现代 fork，API 兼容且有 ESM |
| 角色碰撞体 | 固定旋转的球体（半径 0.42） | 球体不会翻滚、不会卡进地面，水平速度由脚本接管，竖直交给重力。胶囊在 cannon-es 里还得拼两个形状 |
| 角色视觉 | 程序化搭的低多边形人形 | 不引外部模型依赖，风格与场景一致，走路动画靠腿部摆动 |
| 立牌文字 | Canvas 贴图 | 少一个依赖（troika-three-text），中文渲染没问题，牌子数量不多 |
| 立牌朝向 | 每帧绕 Y 轴朝向相机 | 固定朝向时玩家从侧后方过来只能看到黑背板 |
| 天空 | CSS 渐变 + `renderer.alpha = true` | 零成本，且雾色能和背景对上；不用画天空盒 |
| 指针锁定 | 首次点击画面时才请求 | `start()` 里立刻请求会在部分嵌入式环境挂起甚至阻塞交互 |

## 4. 踩过的坑

### 4.1 `requestAnimationFrame` 在不可见标签页里会暂停

**症状**：加载屏永远停在"编译着色器"，进度条不动。

**原因**：`prepare()` 里用 `await new Promise(r => requestAnimationFrame(r))` 等浏览器渲染，而页面不可见时 rAF 被冻结，await 永不 resolve。

**修法**：两处都改。
- 等待改用 `setTimeout(resolve, 0)`
- 主循环改成 **rAF + setInterval(33ms) 双驱动**，同一帧只更新一次（靠时间戳去重）。这样嵌入式 WebView、被遮挡的标签页都不会卡死。

### 4.2 `display: flex` 会盖掉 `hidden` 属性

**症状**：加载屏永远挡在最上层，点击"进入场景"没反应。

**原因**：`.loader { display: flex }` 覆盖了 `[hidden]` 自带的 `display: none`。而且 `.loader.is-hidden` 设了 `pointer-events: none`，导致点击穿透到 canvas，触发指针锁定，浏览器自动化调用直接卡死 275 秒。

**修法**：凡是带 `display` 的选择器，都要显式写一条 `[hidden] { display: none }`。

### 4.3 billboard 转错了对象

**症状**：黑色背板转到牌子前面，挡住半个画面。

**原因**：`board` 是 `group` 的子节点，转 `board.rotation.y` 会被 `group.rotation.y` 再叠一次。

**修法**：转 `group`，让整块展台一起转。

### 4.4 自写的 GLSL `#include` 预处理器

3d-folio 用 `glslify-loader`，Vite 没有等价物，本项目在 `vite.config.js` 里手写了一个。两个必须注意的点：

1. 正则会误伤 three 自带的 `#include <common>` → 找不到对应 partial 文件时**保持原样不动**，不要抛错
2. Vite 插件的 `transform` 必须返回**合法 JS 模块**，裸 GLSL 会被当 JS 解析而语法错误 → 要包成 `export default "..."`

### 4.5 浏览器自动化环境测不了交互

内置 Browser 的标签页处于不可见状态，rAF 停摆、合成事件不派发。**结论：交互验证不能靠它**。

替代方案：`tools/smoke.mjs` 用 Edge headless + CDP 跑真实路径（点按钮、按键、读物理坐标、收控制台错误）。这个脚本抓出了 4.3 的 bug。

### 4.6 cannon-es 刚体休眠会让人走不动

**症状**：进入场景后站着不动约 1 秒，再按 W 键角色完全不动——但 `input.keys` 里明明有
`KeyW`，`body.velocity.z` 也是 -7，只有 `body.position` 一动不动。

**原因**：`world.allowSleep = true`（默认），刚体静止超过 `sleepTimeLimit`（1 秒）后进入
`SLEEPING`，cannon-es 对休眠刚体**跳过积分**。而角色的移动是直接写 `body.velocity`
（不走 `applyImpulse`），**不会触发唤醒**，也没有任何地方调 `wakeUp()`。
于是刚体永远醒不过来。

**修法**：角色刚体 `body.allowSleep = false`。静态场景用 mass 0，本来就不需要休眠。

**为什么难发现**：本地 `vite preview` 跑得快，角色出生时被碰撞弹开过（速度不为零），
刚好在休眠阈值前按下了 W，掩盖了这个 bug。线上机器慢、页面加载久，角色安静地站在原地，
1 秒后睡着——**真实访客一定会踩到**。

`tools/smoke.mjs` 现在会先 idle 1.8 秒再断言 `body.sleepState === 0`，把这个 bug 锁住。


## 5. 性能预算

当前首屏（gzip）：

| chunk | 原始 | gzip |
|---|---|---|
| three | 470 KB | 118.6 KB |
| cannon-es | 86 KB | 24.9 KB |
| 应用代码 | 29 KB | 9.7 KB |
| CSS | 8 KB | 2.2 KB |
| **合计** | **≈ 593 KB** | **≈ 155 KB** |

场景资产目前是**程序化生成**的（几何体 + Canvas 贴图），零额外请求。移植 matcap 材质后要重新核算：matcap 贴图 14 张共约 120 KB，加 Draco 解码器约 200 KB。

目标：首屏 gzip ≤ 400 KB。

## 6. 下一步

| 优先级 | 事项 | 备注 |
|---|---|---|
| 高 | 填内容 | bailu 的确切地址、各项目的图与链接 |
| 高 | 移植 matcap 材质 | Bruno 视觉的灵魂，需要改 `encodings_fragment` → `colorspace_fragment` |
| 中 | 音效 | howler 已装但未接，脚步与环境音 |
| 中 | 场景分区 | 不同区域换氛围（对应 bailu 的恐怖调性） |
| 中 | `prefers-reduced-motion` 降级 | 降级成可滚动页面，不做 3D |
| 低 | 3D 角色模型 | 换成有骨骼的 glTF 模型，取代程序化人形 |

## 7. 部署链路（2026-10-21 重做）

### 7.1 为什么重做

原 workflow 只做一件事：在服务器上跑 `deploy-app`，而 `deploy-app` 的第一步是
`git clone https://github.com/daiduo2/home.git`。**服务器访问 github.com 稳定失败**
（`GnuTLS recv error (-110): The TLS connection was non-properly terminated`），
每次部署都在这一步挂 90 秒后 exit 128。2026-10-13 那次成功只是运气。

### 7.2 现在的流程

```
push main
  → Actions: checkout → setup-node(20) → npm ci → vite build → tar 打包
  → appleboy/scp-action 把 dist.tar.gz 传到服务器 /tmp
  → appleboy/ssh-action 在服务器上解包覆盖 + nginx reload + 健康检查
```

服务器不再碰 github，只接收产物。构建和部署的职责因此分开了：
构建在 Actions 里（可复现、和本机一致），部署只是"把文件放到 web root"。

### 7.3 三个必须记住的坑

**① root 目录不要写死。** 部署脚本用三路反查定位 web root：

1. 让 nginx 自己吐出当前页面（`curl -H "Host: aufheben.top" http://127.0.0.1/`），
   从里面取产物文件名，再在磁盘上 `find` 这个文件 → 它所在目录的上级就是 root（最准）
2. 读 nginx 配置里的 `root` 指令
3. 回退到 `/var/www/home/dist`

服务器的真实 root 是 `/var/www/home/dist`，vhost 在 `/etc/nginx/sites-enabled/home`。

**② 解包只覆盖不删除。** `tar -xzf` 不加 `--delete`：残留的旧 asset 文件无害
（index.html 只引用新 hash），但万一路径判断错了，也不会删掉线上正在用的东西。

**③ HTML 必须显式 no-store。** 腾讯云 EO 默认缓存 HTML，源站更新后访客拿到的还是旧
index.html（`EO-Cache-Status: HIT`，`Age` 一直涨，而且刷新时拿到的是节点之间的旧副本，
不是源站的新文件）。修法是在 nginx 的 server 块里加：

```nginx
add_header Cache-Control "no-cache, no-store, must-revalidate" always;
```

放在 server 级而不是 `location = /index.html`：因为 `location ~* \.(js|css|...)$`
里已经有自己的 `add_header`，本来就不继承 server 级的 header，静态资源的长缓存不受影响。
部署脚本会幂等地补这一行（先备份，`nginx -t` 不过就回滚）。

**注意**：这条只防未来。已经缓存进去的旧对象，得在 EO 控制台刷新缓存才会清掉，
或者等 TTL 到期。

### 7.4 appleboy/ssh-action@v1 的输入格式（踩过）

- `envs` 传的是**变量名**（逗号分隔），action 从 runner 环境里取值，
  用单引号安全转义后 `export` 到远端脚本。值要在**步骤级 `env:`** 里给，
  写进 `with: env:` 会被当成未知输入，workflow 直接校验失败（run 0 秒就红）。
- v1 **没有** `script_stop` 输入（v0.x 才有）。多行脚本靠脚本自己的 `set -e` 控制。
- `with:` 里只能出现 action.yml 里声明过的输入名，多一个就报错。

### 7.5 服务器只读诊断

`.github/workflows/diag.yml`（workflow_dispatch 手动触发）会在服务器上打印：
nginx 配置全文、vhost 原文、各目录权限与时间戳、站点文件指纹、不同 Host 头下
nginx 分别返回什么、监听端口。改 nginx 配置或排查"线上和本地不一致"时先跑它。

## 8. 相机与性能重做（2026-10-21 第二轮）

### 8.1 先去看别人怎么做的

| 参考 | 结论 |
|---|---|
| `brunosimon/folio-2025`（MIT，Bruno 当前作品） | 相机是**固定 45° 方位角 + FOV 25° 长焦**，鼠标不控视角；材质是 TSL 手搓的两段式卡通明暗，**没有 matcap、没有 EffectComposer、没有描边 pass**，只有一盏方向光 + 阴影相机跟着视野走 |
| `brunosimon/folio-2019`（MIT，2019 老版） | 相机方向是**世界固定轴**，不跟角色朝向转；相机有"迟滞"，角色先动相机再被拽上去 |
| `jet-tong/3d-folio`（本地 `_ref-3d-folio`） | **不能抄相机**：它是原版的改造中间态，跟随相机、键盘驾驶、触屏按钮全被注释掉，桌面端根本开不了车。可抄的是它的视觉方案：零光源 + 零 shadow map + matcap + 假阴影 |

Bruno 自己代码里有个帧率 bug：`lerp(a, b, dt * 10)` 是帧率相关的，高刷屏手感会变紧。
我们统一用 `THREE.MathUtils.damp`（帧率无关的指数阻尼）。

### 8.2 相机的三个 bug 与修法

原来的相机（`Camera.js`）有硬伤，实测确认：

1. **pitch 一抬头，相机就钻到地面以下**。原因是用欧拉角硬转
   （`_offset.applyAxisAngle(RIGHT, pitch)`），pitch 为正时相机的 y 被算到地下，
   而且看向的点不带 pitch，画面根本不跟着抬。实测 pitch=0.6 时相机 y 掉到 0.32。
   **修法**：相机位置沿"视线反方向"推算（`target - direction * distance`），
   看向的点 = 目标点 + 视线方向 × 前瞻，pitch 自然包含在里面。
   另外给相机 y 加一个下限（0.45），抬头时相机停在地面而不是穿过去。
2. **鼠标转视角没有阻尼**，raw movementX 直接累加到 yaw，抖。
   **修法**：yaw/pitch 各自走 `MathUtils.damp`（λ=18）。
3. **指针锁拿不到就完全转不动画面**。指针锁在 iframe、被嵌页面、用户按 Esc 之后都会失效。
   **修法**：Input 层加一条兜底 —— 按住左键拖动也能转视角（`document.mousedown` +
   `mousemove`），指针锁生效时走 `movementX`，没生效时走拖拽。

另外把**角色朝向与相机朝向解耦**：角色面朝移动方向（后退时不转身），
相机 yaw 独立。移动改成相机相对 —— W 永远是"屏幕往前"。

### 8.3 性能取舍

实测基线（Edge headless + GPU）：draw call 21、三角形 268、3 盏灯、2048² 阴影贴图。
**draw call 根本不是瓶颈**（全场只有 19~23 次调用），瓶颈在片元阶段和阴影 pass。

| 项 | 改前 | 改后 | 理由 |
|---|---|---|---|
| 材质 | MeshStandardMaterial | MeshLambertMaterial | 低多边形 + 平面着色下观感几乎一样，但没有 BRDF 分支，片元便宜得多 |
| 光源 | 3 盏（半球 + 主光 + 补光） | 2 盏（半球 + 主光） | 每盏灯都是一次完整光照计算 |
| 阴影贴图 | 2048²，固定覆盖 60×60m | 1024²，**跟着角色走**（±11m） | 同样的贴图尺寸能给出更细的阴影，进入阴影 pass 的东西也少得多 |
| 阴影过滤 | PCFSoftShadowMap | PCFShadowMap | 采样次数少，阴影稍硬但更清晰 |
| 抗锯齿 | 始终开 | 只在 pixelRatio < 2 时开 | 高分屏用分辨率换锐度，MSAA 交给浏览器合成（Bruno 的做法） |
| 静态物件 | 每帧重算矩阵 | `matrixAutoUpdate = false` | 墙、地面、展台子节点都不动 |
| FOV | 55 | 28 | 长焦压缩透视，微缩景观感，也更不容易晕 |
| 相机距离 | 7.5 | 21（滚轮可调 6~46） | 角色是大场景里的小人，不是越肩视角 |
| 相机俯角 | -0.22 | -0.5 | 拉远之后必须更俯，否则地平线压不住画面 |

另外加**自动降级**：每 3 秒量一次实际帧率，低于 42 就把像素比和阴影降一档
（high → medium → low），只降不升（升回去会来回抖）。
"太卡"在不同设备上差一个数量级，写死一套画质必然有人跑不动。

### 8.4 内容边界

这个站是**个人站**，不是 GitHub profile 的翻版。学术履历那套（中国科学院大学、
他山社区、研究方向、geoseg / local-proof-loop）留在 GitHub profile README 里，
不放进场景。场景里放的是这个人自己做的作品：`bailu`（白鹿疗养院，拟真档案网站）
和 `story2`（它背后的交互式叙事框架）。

### 8.5 输入层的三条铁律

"跑起来停不下来"和"往右拖视角却往左转"，都是输入层的问题，跟渲染无关。

1. **触屏持续值和键盘瞬时值必须分开存**。以前键盘的增量直接累加进 `move`，
   松键后 `move` 里还留着上一帧的 1，角色就一直往前走。
   现在分成 `touchMove`（摇杆的持续值）和 `move`（每帧重算的最终值），
   `update()` 里每帧从 `touchMove` + 键盘按键重新算一遍。
2. **look 的符号全链路统一**：`look.x > 0` = 向右转，`look.y > 0` = 向上看。
   以前鼠标移动、触屏拖动、相机消费三处的符号各写各的，左右反就是这么来的。
3. **手柄不参与移动**。本机连着的 DualSense Edge 在 Windows 上报出来的状态是坏的：
   静止时 `axes[1]` 恒为 -1（等于左摇杆一直推到底），而且会跳变，`buttons[2]` 常按。
   任何"读轴 → 驱动移动"的写法都会让角色自己往前冲、或者一顿一顿反向抽搐。
   要加手柄支持，必须先做显式标定（用户按某个键确认手柄、记录静止零点、
   要求明显偏离零点才采信），不能直接读轴就用。

### 8.6 远景相机的遮挡问题

相机拉远到 21m 之后，相机位置落在场地外面，而场地有一圈边界墙。
原来的遮挡射线会把相机硬拽回角色身边，远景取景直接废掉。

修法：边界墙归到 **2 号碰撞分组**（`Physics.addBox` 的 `group` 选项），
射线检测用 `collisionFilterMask = -3`（跳过 2 号）。边界墙仍然挡人，只是不挡镜头。


