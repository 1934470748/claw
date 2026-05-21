# 新版小龙虾后端

这是一个先用于跑通解包前端的兼容后端。

## 启动

```bash
npm install
npm start
```

默认地址：

```text
http://127.0.0.1:3001
```

## 当前范围

- 已实现主要 `/api/settings`、`/api/gateway`、`/api/providers`、`/api/provider-accounts`、`/api/agents`、`/api/channels`、`/api/cron`、`/api/clawhub`、`/api/logs`、`/api/usage` 等兼容接口。
- 数据使用 Node 内置 `node:sqlite` 存在 `data/clawhouse.sqlite`。
- AI 网关、支付、真实渠道登录、文件处理目前是兼容返回，方便先把前端页面跑通。
