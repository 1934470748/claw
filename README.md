# ClawHouse Compatible Backend

This repository contains the compatible backend and browser-mode frontend shim for the ClawHouse/OpenClaw shell.

## Structure

- `backend/` - Express backend, NewAPI registration/key issuing, provider routing, OpenClaw config sync.
- `frontend-web/` - Browser test shim files patched into the unpacked ClawHouse frontend for local web testing.

## Local Backend

```powershell
cd backend
npm install
copy .env.example .env
npm start
```

Default backend port: `3001`.
