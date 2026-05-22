# MianClaw Compatible Backend

这是给解包后的 MianClaw/OpenClaw 前端使用的本地兼容服务层。

## 启动

```bash
npm install
npm start
```

默认地址：

```text
http://127.0.0.1:3001
```

前端静态预览地址：

```text
http://localhost:4173/app/dist/
```

## 当前范围

- 注册/登录引导页：`/clawhouse/key.html`
- SaaS 后台骨架：`/saas-admin`
- Electron IPC 与 HostAPI 的浏览器兼容接口
- 设置、Gateway、providers、channels、skills、cron、logs、usage、updates 等兼容路由
- 本地 SQLite 数据：`data/clawhouse.sqlite`

## 已定架构

正式上线后，用户侧只接入我们的 NewAPI 中转站 Key。当前保留本地兼容层，是为了先跑通壳子、日志、插件、定时任务、更新和后台页面。

## 更新配置

未来服务器部署时设置：

```env
APP_VERSION=0.3.9
UPDATE_MANIFEST_URL=https://your-domain.com/mianclaw/update.json
```

客户端可调用：

```text
GET  /api/update/status
POST /api/update/check
```

SaaS 后台规划见 `docs/saas-admin-plan.md`。
