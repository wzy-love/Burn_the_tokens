# 0元公网分享（Cloudflare Tunnel）

这个方案适合学生或小范围试玩：不买服务器，直接把本机 `http://localhost:5173` 暴露给外网。

## 前提

1. 本机能正常启动游戏
2. 已安装 `cloudflared`

Windows 安装命令：

```bash
winget install Cloudflare.cloudflared
```

## 一键方式

在项目根目录双击：

- `free-tunnel.bat`
- 或右键用 PowerShell 运行 `free-tunnel.ps1`

脚本会：

1. 检查 `cloudflared` 是否安装
2. 检查本地 `5173` 是否可用（不可用会自动启动 `start.bat`）
3. 打开免费公网隧道并输出 `https://*.trycloudflare.com` 链接

把链接发给朋友即可访问。

## 命令方式（可复制）

```bash
npm run tunnel:free
```

或 PowerShell 版：

```bash
npm run tunnel:free:ps
```

## 注意事项

- 关闭 `free-tunnel.bat` 窗口后，公网访问会中断
- 关闭 `free-tunnel.ps1` 窗口后，公网访问也会中断
- 关闭本机开发服务后，公网访问会中断
- 免费链接是临时的，重开隧道可能会变化
- 先修改 `backend/.env` 中的 `ADMIN_KEY`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`
