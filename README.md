# Burn Token Arena

一个完整前后端小游戏项目，包含账号、持久化、赛季玩法、排行榜和容器化部署。

## 已完善功能（6 项）

1. 启动体验：`start.bat` 会等待前端就绪后自动弹浏览器  
2. 数据持久化：后端接入 `Prisma + SQLite`（`backend/dev.db`）  
3. 经济平衡：正态分布回归调节，数值配置集中在 `backend/src/gameConfig.js`  
4. 账号体系：支持用户名/邮箱注册登录，JWT 鉴权与刷新  
5. 游戏扩展：赛季、Boss 回合、每日任务、登录奖励、成就墙、道具系统  
6. 部署：`Dockerfile + docker-compose + nginx` 一键容器运行  

## 本地运行

### 一键启动

```bash
npm run dev
```

或者双击 `start.bat`。  
脚本会自动等待服务就绪后打开 `http://localhost:5173`。

### 依赖安装

```bash
npm install --prefix frontend
npm install --prefix backend
```

### 数据库初始化

```bash
npm run db:push
```

## Docker 运行

```bash
npm run docker:up
```

打开 `http://localhost:5173`。  
停止容器：

```bash
npm run docker:down
```

## 线上部署（GitHub Pages + Render）

适合你现在这种「博客在 GitHub Pages，游戏要长期给别人玩」的场景：

- 前端部署到 GitHub Pages（例如 `https://wzy-love.github.io/token-game/`）
- 后端部署到 Render（或同类 Node 托管）

### 1) 部署后端（Render）

- Root Directory：`backend`
- Build Command：`npm install && npm run db:generate && npm run db:push`
- Start Command：`npm run start`

后端环境变量至少配置：

```bash
PORT=4000
DATABASE_URL=file:./dev.db
JWT_ACCESS_SECRET=change-this-access-secret
JWT_REFRESH_SECRET=change-this-refresh-secret
JWT_ACCESS_EXPIRES_IN=2h
JWT_REFRESH_EXPIRES_IN=14d
ADMIN_KEY=your-admin-key
CORS_ORIGINS=https://wzy-love.github.io
```

如果你前端是子路径（比如 `/token-game/`），`CORS_ORIGINS` 只写域名即可，不需要带路径。

### 2) 配置 GitHub Pages 自动发布

项目已内置工作流：`.github/workflows/deploy-frontend-pages.yml`。

在仓库 `Settings -> Secrets and variables -> Actions -> Variables` 中新增：

- `VITE_API_BASE`：你的后端地址，例如 `https://your-backend.onrender.com/api`
- `VITE_BASE_PATH`：你的前端部署路径，例如 `/token-game/`

然后在仓库 `Settings -> Pages` 中把 Source 设为 **GitHub Actions**。

### 3) 推送触发发布

推送到 `main` 后会自动构建并发布 `frontend/dist`。  
工作流会自动复制 `index.html` 到 `404.html`，避免页面刷新时出现 404。

### 4) 从零发布（当前目录还没 git 时）

如果你的项目目录还不是 git 仓库，先执行：

```bash
git init
git add .
git commit -m "chore: prepare deployment for pages and render"
git branch -M main
git remote add origin https://github.com/<your-name>/<your-repo>.git
git push -u origin main
```

推送后：

- Render 可以直接读取仓库中的 `render.yaml`（Blueprint 部署）
- GitHub Actions 会自动触发前端 Pages 发布

## 0 元公网分享（学生友好）

如果你不想买服务器，可以用免费隧道把本机游戏分享给别人试玩。

### 1) 安装 cloudflared（Windows）

```bash
winget install Cloudflare.cloudflared
```

### 2) 启动本地服务

```bash
npm run dev
```

或双击 `start.bat`。

### 3) 开启隧道（推荐一键）

优先直接双击根目录 `one-click-online.bat`。  
它会自动检查并启动本地服务（若未启动），然后开启免费公网隧道。  
终端会输出一个 `https://*.trycloudflare.com` 链接，把它发给别人即可访问。

如果你觉得进入速度慢，推荐用 **高速分享模式**（生产构建 + Docker + 隧道）：

- 双击 `one-click-online-fast.bat`
- 或命令行运行 `npm run online:fast`

这个模式会在本地 `http://localhost:5174` 启动生产版，再把它映射到公网，首屏通常更快。

你也可以命令行启动：

```bash
npm run tunnel:free
```

PowerShell 版：

```bash
npm run tunnel:free:ps
```

命令行一键联机版：

```bash
npm run online:oneclick
```

命令行高速联机版：

```bash
npm run online:fast
```

详细说明见：`docs/zero-cost-tunnel.md`。

## 测试与质量

### 后端接口测试（Vitest + Supertest）

```bash
npm run test:backend
```

### 前端 E2E（Playwright）

首次请安装浏览器：

```bash
npm run test:e2e:install
```

运行 E2E：

```bash
npm run test:e2e
```

全部测试（后端 + E2E）：

```bash
npm run test
```

## 目录说明

- `frontend`：React + Vite + Tailwind 游戏界面  
- `backend`：Express + Prisma + SQLite API  
- `backend/prisma/schema.prisma`：数据模型  
- `backend/src/gameConfig.js`：概率、Boss、任务、成就等游戏配置  
- `render.yaml`：Render Blueprint 部署配置（后端）  
- `.github/workflows/deploy-frontend-pages.yml`：GitHub Pages 自动发布工作流  
- `docker-compose.yml`：容器编排  
- `docker-compose.fast.yml`：高速分享端口覆盖（5174/4001）  
- `frontend/.env.production.example`：线上前端环境变量示例  
- `free-tunnel.bat`：0元公网试玩一键隧道脚本  
- `free-tunnel.ps1`：PowerShell 一键隧道脚本  
- `one-click-online.bat`：一键开服并开启公网隧道（最推荐）  
- `one-click-online-fast.bat`：一键生产模式开服并开启公网隧道（更快）  
- `docs/zero-cost-tunnel.md`：免费公网分享说明  

## API 概览

- `POST /api/auth/register` 账号注册  
- `POST /api/auth/login` 账号登录  
- `POST /api/auth/refresh` 刷新访问令牌  
- `GET /api/auth/me` 获取当前登录玩家信息  
- `POST /api/auth/session` 兼容旧匿名会话（保留）  
- `GET /api/game/state?playerId=...` 获取游戏状态  
- `POST /api/game/burn` 执行燃烧（支持道具）  
- `POST /api/game/reset` 重置当前玩家  
- `POST /api/game/daily/claim` 领取任务奖励  
- `GET /api/game/leaderboard` 获取赛季榜  
- `POST /api/game/leaderboard/submit` 提交当前分数  

### 社交玩法 API

- `GET /api/social/overview` 社交总览（好友/PK/房间）  
- `POST /api/social/friends/add` 添加好友  
- `POST /api/social/pk/challenge` 发起好友 PK  
- `POST /api/social/pk/submit` 提交 PK 分数  
- `POST /api/social/rooms/create` 创建房间赛  
- `POST /api/social/rooms/join` 加入房间赛  
- `POST /api/social/rooms/submit` 提交房间分数  
- `POST /api/social/share` 生成战报分享链接（前端分享页：`/share/:shareCode`）  

### 运营后台

- 后台页面：`http://localhost:5173/admin`
- 默认管理密钥：`admin123`（可用 `ADMIN_KEY` 环境变量覆盖）

### 可观测性

- 后端日志分级：`LOG_LEVEL=debug|info|warn|error`
- 自动记录接口耗时（包含 `x-request-id`、状态码、duration）
- 后端错误追踪：配置 `SENTRY_DSN` 后自动上报异常
- 前端错误追踪：配置 `VITE_SENTRY_DSN` 后自动上报前端错误

## 经济分布平衡

- 后端按玩家 `tokensLeft` 计算均值和标准差（近似正态分布）
- 中间人群进行轻微回归，避免通胀失控
- 最穷/最富两端玩家默认豁免平衡（保留极端玩家）

示例燃烧请求：

```json
{
  "playerId": "your-player-id",
  "amount": 100,
  "useItems": ["shield", "double"]
}
```
