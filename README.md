# aufheben — 个人主页

🌐 线上: https://aufheben.top

3D 个人主页，技术栈 **Vite + Three.js**。

## 本地开发

```bash
npm install
npm run dev          # http://localhost:5173
```

## 构建

```bash
npm run build        # 输出到 dist/
npm run preview      # 预览构建产物
```

## 部署

Push 到 `main` 分支自动触发 GitHub Actions 部署到阿里云 ECS。
首次部署需要在 GitHub Secrets 配：

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

## 服务器手动部署

```bash
ssh deploy@139.155.143.138
deploy-app home daiduo2/home aufheben.top 3000 static true
```

## 升级路线

| 阶段 | 改动 | 预计 |
|---|---|---|
| 入门版（当前） | Vite + Three.js 简单几何体 | ✅ 完成 |
| 进阶版 | React Three Fiber + 物理 + 资源 | 后续 |
| 完整版 | 自建场景 + 角色控制 + 多区块 | 长期 |

## 目录结构

```
.
├── index.html           # Vite 入口
├── src/
│   ├── main.js          # Three.js 场景
│   └── style.css
├── deploy/
│   └── app.conf         # nginx vhost
└── .github/workflows/
    └── deploy.yml       # GitHub Actions
```
