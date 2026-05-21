import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "clawhouse.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    api_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_accounts (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    api_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channels (
    channel_type TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS newapi_accounts (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    api_key TEXT,
    access_token TEXT,
    user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const defaults = {
  theme: "system",
  language: "zh-CN",
  launchAtStartup: false,
  telemetryEnabled: false,
  gatewayAutoStart: true,
  gatewayPort: 18866,
  devModeUnlocked: true,
  proxyEnabled: false,
  proxyServer: "",
  proxyHttpServer: "",
  proxyHttpsServer: "",
  proxyAllServer: "",
  proxyBypassRules: ""
};

const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const setSettingStmt = db.prepare(`
  INSERT INTO settings (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

for (const [key, value] of Object.entries(defaults)) {
  if (!getSettingStmt.get(key)) setSettingStmt.run(key, JSON.stringify(value));
}

export function now() {
  return new Date().toISOString();
}

export function readJson(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(rows.map((row) => [row.key, readJson(row.value)]));
}

export function getSetting(key) {
  const row = getSettingStmt.get(key);
  return row ? readJson(row.value) : undefined;
}

export function setSetting(key, value) {
  setSettingStmt.run(key, JSON.stringify(value));
}

export function resetSettings() {
  db.exec("DELETE FROM settings");
  for (const [key, value] of Object.entries(defaults)) {
    setSetting(key, value);
  }
  return getSettings();
}

export function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function listTable(table) {
  return db.prepare(`SELECT value FROM ${table} ORDER BY created_at ASC`).all().map((row) => readJson(row.value, {}));
}

export function getTableItem(table, idColumn, id) {
  const row = db.prepare(`SELECT value FROM ${table} WHERE ${idColumn} = ?`).get(id);
  return row ? readJson(row.value, null) : null;
}

export function saveTableItem(table, idColumn, id, value, extra = {}) {
  const timestamp = now();
  const existing = getTableItem(table, idColumn, id);
  const createdAt = existing?.createdAt || timestamp;
  const saved = { ...existing, ...value, id: value.id ?? existing?.id ?? id, createdAt, updatedAt: timestamp };
  db.prepare(`
    INSERT INTO ${table} (${idColumn}, value, created_at, updated_at${extra.columns ? `, ${extra.columns}` : ""})
    VALUES (?, ?, ?, ?${extra.placeholders ? `, ${extra.placeholders}` : ""})
    ON CONFLICT(${idColumn}) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at${extra.update ? `, ${extra.update}` : ""}
  `).run(id, JSON.stringify(saved), createdAt, timestamp, ...(extra.values || []));
  return saved;
}

export function deleteTableItem(table, idColumn, id) {
  const info = db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`).run(id);
  return info.changes > 0;
}
