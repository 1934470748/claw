# MianClaw SaaS Admin Plan

## 目标

MianClaw 是 OpenClaw 的产品壳。正式上线后，用户注册、Key 签发、余额、用量、套餐和客户端更新都由我们的 SaaS 后台管理；桌面端只拿到可用 Key 并写入本地配置。

## 今天先做什么

- 先稳定客户端壳子、插件、日志、定时任务和本地后台页面。
- NewAPI 中转站未确定前，不继续扩展 Key 调用逻辑。
- 保留本地 SQLite 兼容接口，方便前端页面不报错。

## 推荐 SaaS 底座

先用 `nextjs/saas-starter` 承接正式后台：

- GitHub: https://github.com/nextjs/saas-starter
- 技术栈：Next.js、Postgres、Drizzle、Stripe、shadcn/ui
- 自带能力：登录、团队、RBAC、Stripe Checkout、客户门户、活动日志

它适合本项目，因为认证、计费和后台基础能力已经齐全，我们主要补 MianClaw 与 NewAPI 的业务模块。

## 后续模块

1. 用户与 NewAPI 绑定
   - SaaS 用户注册/登录。
   - 绑定 NewAPI 用户 id、访问令牌和签发 Key。
   - 只允许使用我们的 NewAPI 中转站 Key。

2. Key 管理
   - 管理员接口创建、查询、禁用、轮换 Key。
   - 后台展示脱敏 Key 和完整状态。
   - 桌面端负责写入本地 `openclaw.json`。

3. 用量与余额
   - 同步 NewAPI 日志、额度、余额、模型分布和错误记录。
   - 给用户侧显示余额、用量、请求消耗。

4. 套餐与支付
   - Stripe 产品映射到额度包或月付套餐。
   - 支付成功后更新 NewAPI 额度或发放权益。

5. 客户端更新
   - 服务器托管更新 manifest。
   - 客户端调用 `/api/update/status` 和 `/api/update/check`。

## 更新 Manifest

```json
{
  "version": "0.4.0",
  "notes": "Bug fixes and provider updates",
  "downloadUrl": "https://example.com/releases/mianclaw-0.4.0.exe",
  "publishedAt": "2026-05-22T00:00:00.000Z"
}
```

## 第一版后台 API 草案

- `GET /admin/users`
- `GET /admin/users/:id/usage`
- `POST /admin/users/:id/issue-key`
- `POST /admin/users/:id/quota`
- `GET /admin/update/manifest`
- `POST /admin/update/manifest`
