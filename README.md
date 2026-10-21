# aufheben — 个人主页

🌐 线上：https://aufheben.top

一个**可交互的 3D 个人主页**：访客不是在读页面，而是在场地里走动，走到展台前才看到内容。

技术栈 **Vite 5 + Three.js 0.169 + cannon-es**。参考 Bruno Simon 2019 版作品集（MIT）的交互范式，但场景、角色、相机、内容全部重写。

## 交互

| 操作 | 键位 |
|---|---|
| 移动 | `WASD` / 方向键 / 左下虚拟摇杆 / 手柄左摇杆 |
| 转视角 | 鼠标（先点画面锁定指针）/ 触屏右侧拖拽 / 手柄右摇杆 |
| 跑 | 按住 `W`（`Shift` 加速） |
| 查看展台 | `E` / `Enter` / 触屏右下按钮 |
| 切换第一/第三人称 | `C` |
| 纯文字清单 | `Tab` |
| 关闭面板 | `Esc` |

**文字清单是可达性底线。** 不能只靠"走路逛"才能找到内容——赶时间的人和读屏用户需要一条平路。`?list=1` 可以直接打开它。

## 架构

```
src/
├── main.js              启动装配
├── style.css            全部样式（含加载屏 / HUD / 面板 / 清单）
├── core/
│   ├── Application.js   总装：渲染器、场景、循环、事件
│   ├── Camera.js        第三人称跟随 + 第一人称，带遮挡检测
│   ├── Input.js         键鼠 / 触屏 / 手柄统一成 move + look + interact
│   ├── Time.js          主循环（rAF + setInterval 双驱动兜底）
│   ├── Sizes.js         视口与设备能力
│   └── EventEmitter.js  事件总线
├── world/
│   ├── World.js         场景总装，固定每帧顺序
│   ├── Physics.js       cannon-es 世界、地面、边界、射线
│   ├── Environment.js   地面 / 边界 / 灯光 / 雾
│   ├── Character.js     步行角色（球体刚体 + 程序化人形 + 走路动画）
│   └── Landmarks.js     展台系统，牌面始终朝向相机
├── ui/
│   ├── Loader.js        加载屏与进场按钮
│   └── Interface.js     HUD 提示 / 详情面板 / 设置 / 文字清单
├── data/
│   └── landmarks.js     展台清单 ← 内容都写在这里
└── utils/
    └── labelTexture.js  把文字画成贴图贴在立牌上
```

每帧顺序固定：**输入 → 物理 → 角色 → 相机 → 渲染**。

## 加一个展台

只改 `src/data/landmarks.js`，加一条记录：

```js
{
  id: 'bailu',
  type: 'project',
  position: [8, 2],        // 场地坐标 [x, z]
  accent: '#f472b6',       // 强调色
  badge: '作品',            // 立牌左上角的小标签
  title: 'bailu',
  subtitle: '模拟恐怖网站',
  description: '一句话说明这个展台是什么。',
  links: [{ label: '打开', url: 'https://...' }],
}
```

场地是 46 × 46 米，展台底座会自动生成物理碰撞体，玩家走不进去。

## 本地开发

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 输出到 dist/
npm run preview      # 预览构建产物（端口 3000）
```

## 冒烟测试

`tools/smoke.mjs` 用 Edge headless + CDP 跑一遍关键路径：加载屏出现 → 点「进入场景」真正进场 → 按 `W` 键角色真的位移 → 文字清单有内容 → 控制台无错误。

```bash
npm run build
npx vite preview --port 3000 --strictPort   # 另开一个终端
node tools/smoke.mjs http://localhost:3000/
```

截图落在 `tools/smoke-out/`。

## 部署

Push 到 `main` 分支自动触发 GitHub Actions 部署到阿里云 ECS，nginx vhost 在 `deploy/app.conf`。

| Secret | Value |
|---|---|
| `SERVER_HOST` | `139.155.143.138` |
| `SERVER_USER` | `deploy` |
| `SERVER_PASSWORD` | deploy 密码 |
| `PROJECT_NAME` | `home` |
| `PROJECT_TYPE` | `static` |
| `DOMAIN` | `aufheben.top` |
| `APP_PORT` | `3000` |
| `GH_REPO` | `daiduo2/home` |

## 从 3d-folio 借鉴了什么

底座参考 `jet-tong/3d-folio`（Bruno Simon 2019 版 fork，MIT）。**只借鉴思路，没有复制代码**——本项目的引擎层是重写的。

| 借鉴 | 说明 |
|---|---|
| matcap 烘焙光照 | 下一阶段移植：把实时点光换成烘焙光照，低端机也能跑 |
| 展台 = 场景里的地标 | 沿用「撞到东西才打开链接」的发现式导航 |
| 低多边形调性 | 扁平面 + 玩具感几何体 |
| 阴影贴图跟随主体 | 避免远处阴影闪烁 |

**没有借鉴的**：车辆物理（改步行角色）、相机（3d-folio 的相机其实不跟随车，是靠 Zone 切换固定角度）、`Area`/`Zone` 分区机制（暂不需要）、Jensen 的全部私有内容。

## 下一阶段

- [ ] 移植 matcap 材质与着色器（Bruno 视觉的灵魂）
- [ ] 音效：引擎声换成脚步 / 环境音，用 howler
- [ ] 场景分区：不同区域换天空、光照、氛围
- [ ] `prefers-reduced-motion` 下降级为可滚动页面
- [ ] 填内容：bailu 的确切地址、各项目的图与链接
