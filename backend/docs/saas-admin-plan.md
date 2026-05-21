# ClawHouse SaaS Admin Plan

## Goal

ClawHouse is an OpenClaw shell with a hosted NewAPI account/key workflow. The desktop/web shell should keep working with user-owned vendor keys, while the SaaS backend manages registration, issued keys, balance, usage, plans, and update delivery.

## Recommended Starter

Use `nextjs/saas-starter` as the first SaaS admin base:

- GitHub: https://github.com/nextjs/saas-starter
- Stack: Next.js, Postgres, Drizzle, Stripe, shadcn/ui
- Useful built-ins: auth, team/user dashboard, RBAC, Stripe Checkout, customer portal, activity logs

Why it fits this project:

- It is close to the current stack style and easy to deploy on Vercel or a Node server.
- It already has auth, billing, dashboard pages, and activity logs, so we can focus on NewAPI integration instead of rebuilding SaaS basics.
- Its dashboard model maps cleanly to ClawHouse accounts, API keys, usage records, subscription plans, and admin operations.

## ClawHouse Modules To Add

1. Account binding
   - Register/login users in the SaaS backend.
   - Bind a NewAPI user id and issued token to each SaaS user.
   - Allow direct vendor keys for DeepSeek, Zhipu, Qwen, SiliconFlow, Moonshot, OpenAI-compatible providers.

2. Key management
   - Create and rotate ClawHouse dedicated keys through NewAPI admin APIs.
   - Store only masked keys in the SaaS UI whenever possible.
   - Keep the local desktop backend responsible for writing `openclaw.json`.

3. Usage and balance
   - Sync NewAPI logs and quota data into SaaS tables.
   - Show request count, token count, quota cost, model distribution, and recent errors.
   - Keep local usage fallback for official vendor keys that do not pass through NewAPI.

4. Plans and payment
   - Stripe products map to quota packages or monthly plans.
   - Payment success should trigger NewAPI quota update or token issuance.

5. Updates
   - Host a manifest JSON at `UPDATE_MANIFEST_URL`.
   - Desktop/web backend checks `/api/update/status` and `/api/update/check`.
   - Manifest shape:

```json
{
  "version": "0.4.0",
  "notes": "Bug fixes and provider updates",
  "downloadUrl": "https://example.com/releases/clawhouse-0.4.0.exe",
  "publishedAt": "2026-05-21T00:00:00.000Z"
}
```

## Next Implementation Slice

Start with the SaaS admin as a separate app, then connect it to this backend by API:

- `GET /admin/users`
- `GET /admin/users/:id/usage`
- `POST /admin/users/:id/issue-key`
- `POST /admin/users/:id/quota`
- `GET /admin/update/manifest`
- `POST /admin/update/manifest`

This keeps the current ClawHouse shell stable while the SaaS platform grows beside it.
