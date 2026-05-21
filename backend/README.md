# ClawHouse Compatible Backend

This backend is the browser-compatible service layer for the unpacked ClawHouse/OpenClaw frontend.

## Start

```bash
npm install
npm start
```

Default URL:

```text
http://127.0.0.1:3001
```

Frontend static preview currently runs from:

```text
http://localhost:4173/app/dist/
```

## Current Scope

- Provider key saving for NewAPI and common OpenAI-compatible official vendors.
- Automatic `openclaw.json` sync for the active ClawHouse provider.
- Browser shim for Electron IPC/HostAPI calls.
- Compatible routes for settings, gateway, providers, provider accounts, channels, skills, cron tasks, logs, usage, and updates.
- Local SQLite data at `data/clawhouse.sqlite`.

## Update Manifest

For future server deployment, set:

```env
APP_VERSION=0.3.9
UPDATE_MANIFEST_URL=https://your-domain.com/clawhouse/update.json
```

Then the frontend can call:

```text
GET  /api/update/status
POST /api/update/check
```

The manifest format is documented in `docs/saas-admin-plan.md`.
