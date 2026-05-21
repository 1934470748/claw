import express from "express";
import cors from "cors";
import morgan from "morgan";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, normalizeBaseUrl } from "./config/env.js";
import {
  db,
  deleteTableItem,
  getSetting,
  getSettings,
  getTableItem,
  listTable,
  makeId,
  now,
  resetSettings,
  saveTableItem,
  setSetting
} from "./db.js";
import { newapi } from "./services/newapi.service.js";

const app = express();
const port = env.port;
// ClawHouse bundled Gateway runs on 18866 (not the env variable 18789)
const gatewayPort = 18866;
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use("/clawhouse", express.static(path.join(__dirname, "../public/clawhouse")));

function ok(res, body = {}) {
  res.json({ success: true, ...body });
}

function fail(res, status, error) {
  res.status(status).json({ success: false, error: error instanceof Error ? error.message : String(error) });
}

// ─── SSE Support ──────────────────────────────────────────────────

const sseClients = new Set();

function sseRegister(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(":\n\n");
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

function sseBroadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// ─── Helper ────────────────────────────────────────────────────────

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function getApiKey() {
  const account = getNewApiAccount();
  if (account?.apiKey) return account.apiKey;
  const providerRow = db.prepare("SELECT api_key FROM providers WHERE api_key IS NOT NULL AND api_key <> '' LIMIT 1").get();
  if (providerRow?.api_key) return providerRow.api_key;
  const accountRow = db.prepare("SELECT api_key FROM provider_accounts WHERE api_key IS NOT NULL AND api_key <> '' LIMIT 1").get();
  return accountRow?.api_key || null;
}

function maskSecret(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 10) return "****";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

/**
 * 根据 API Key 自动推断所属厂商的 baseUrl
 * 已知前缀规则（具体规则放前面，通用 sk- 兜底）：
 *   sk-Nso5z 开头 → 硅基流动 (https://api.siliconflow.cn)
 *   sk-tMx 开头 → 零一万物 (https://api.lingyiwf.com)
 *   sk- 开头 → DeepSeek 官方 (https://api.deepseek.com)
 *   moonshot 开头 → Kimi (https://api.moonshot.cn)
 *   其他 → 返回 null（走中转站）
 */
const providerProfiles = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-chat",
    modelAlias: "DeepSeek Chat"
  },
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelId: "glm-4-flash",
    modelAlias: "GLM 4 Flash"
  },
  siliconflow: {
    baseUrl: "https://api.siliconflow.cn/v1",
    modelId: "deepseek-ai/DeepSeek-V3.2",
    modelAlias: "DeepSeek V3.2"
  },
  lingyiwanwu: {
    baseUrl: "https://api.lingyiwf.com/v1",
    modelId: "yi-lightning",
    modelAlias: "Yi Lightning"
  },
  moonshot: {
    baseUrl: "https://api.moonshot.cn/v1",
    modelId: "kimi-k2-0905-preview",
    modelAlias: "Kimi K2"
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    modelId: "gpt-4o-mini",
    modelAlias: "GPT 4o mini"
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelId: "qwen-plus",
    modelAlias: "Qwen Plus"
  },
  baichuan: {
    baseUrl: "https://api.baichuan-ai.com/v1",
    modelId: "Baichuan4",
    modelAlias: "Baichuan 4"
  },
  minimax: {
    baseUrl: "https://api.minimax.chat/v1",
    modelId: "MiniMax-M1",
    modelAlias: "MiniMax M1"
  },
  stepfun: {
    baseUrl: "https://api.stepfun.com/v1",
    modelId: "step-2-mini",
    modelAlias: "Step 2 mini"
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "deepseek/deepseek-chat-v3.1",
    modelAlias: "DeepSeek Chat"
  },
  newapi: {
    baseUrl: normalizeBaseUrl(env.newapiBaseUrl) + "/v1",
    modelId: "DeepSeek-V4-Flash",
    modelAlias: "DeepSeek V4 Flash"
  }
};

function normalizeApiBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/v1") || normalized.endsWith("/api/paas/v4")) return normalized;
  return `${normalized}/v1`;
}

function inferProviderProfile(apiKey, baseUrl) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const url = typeof baseUrl === "string" ? baseUrl.trim() : "";
  if (url.includes("deepseek.com")) return { key: "deepseek", ...providerProfiles.deepseek, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("bigmodel.cn")) return { key: "zhipu", ...providerProfiles.zhipu, baseUrl: normalizeBaseUrl(url) };
  if (url.includes("siliconflow.cn")) return { key: "siliconflow", ...providerProfiles.siliconflow, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("lingyiwf.com")) return { key: "lingyiwanwu", ...providerProfiles.lingyiwanwu, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("moonshot.cn")) return { key: "moonshot", ...providerProfiles.moonshot, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("api.openai.com")) return { key: "openai", ...providerProfiles.openai, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("dashscope.aliyuncs.com")) return { key: "qwen", ...providerProfiles.qwen, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("baichuan-ai.com")) return { key: "baichuan", ...providerProfiles.baichuan, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("minimax.chat")) return { key: "minimax", ...providerProfiles.minimax, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("stepfun.com")) return { key: "stepfun", ...providerProfiles.stepfun, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("openrouter.ai")) return { key: "openrouter", ...providerProfiles.openrouter, baseUrl: normalizeApiBaseUrl(url) };
  if (url.includes("ovov.fun") || url.includes("124.220.216.160")) return { key: "newapi", ...providerProfiles.newapi, baseUrl: normalizeApiBaseUrl(url) };

  if (!key) return null;
  if (key.startsWith("sk-Nso5z")) return { key: "siliconflow", ...providerProfiles.siliconflow };
  if (key.startsWith("sk-tMx")) return { key: "lingyiwanwu", ...providerProfiles.lingyiwanwu };
  if (key.startsWith("moonshot")) return { key: "moonshot", ...providerProfiles.moonshot };
  if (key.startsWith("sk-or-")) return { key: "openrouter", ...providerProfiles.openrouter };
  if (key.startsWith("sk-proj-")) return { key: "openai", ...providerProfiles.openai };
  if (key.startsWith("sk-ant-")) return { key: "openrouter", ...providerProfiles.openrouter };
  if (key.toLowerCase().startsWith("bsk-")) return { key: "baichuan", ...providerProfiles.baichuan };
  if (key.toLowerCase().startsWith("step-")) return { key: "stepfun", ...providerProfiles.stepfun };
  if (key.toLowerCase().startsWith("minimax-")) return { key: "minimax", ...providerProfiles.minimax };
  if (key.toLowerCase().startsWith("dashscope-")) return { key: "qwen", ...providerProfiles.qwen };
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key) || key.toLowerCase().startsWith("zhipu-")) {
    return { key: "zhipu", ...providerProfiles.zhipu };
  }
  if (key.startsWith("sk-")) return { key: "deepseek", ...providerProfiles.deepseek };
  return null;
}

function inferBaseUrl(apiKey, baseUrl) {
  return inferProviderProfile(apiKey, baseUrl)?.baseUrl || null;
}

/**
 * 获取最合适的默认 baseUrl：
 * 1. 先看 apiKey 前缀能否识别厂商
 * 2. 否则走中转站
 */
function getDefaultBaseUrl(apiKey) {
  return inferBaseUrl(apiKey) || env.newapiBaseUrl;
}

function isNewApiBaseUrl(baseUrl) {
  const url = String(baseUrl || "");
  return url.includes("api.ovov.fun") || url.includes("124.220.216.160");
}

function getOpenClawConfigCandidatesLegacy() {
  return [
    process.env.OPENCLAW_CONFIG_PATH,
    path.resolve(process.cwd(), "../新版小龙虾/data/openclaw/openclaw.json"),
    "C:/Users/PC/Desktop/新版小龙虾/data/openclaw/openclaw.json",
    path.join(process.env.USERPROFILE || "", ".openclaw/openclaw.json")
  ].filter(Boolean);
}

function getOpenClawConfigCandidates() {
  const candidates = [
    process.env.OPENCLAW_CONFIG_PATH,
    path.resolve(process.cwd(), "../新版小龙虾/data/openclaw/openclaw.json"),
    "C:/Users/PC/Desktop/新版小龙虾/data/openclaw/openclaw.json",
    path.join(process.env.USERPROFILE || "", ".openclaw/openclaw.json")
  ].filter(Boolean);

  const desktop = path.join(process.env.USERPROFILE || "", "Desktop");
  candidates.push(path.join(desktop, "新版小龙虾", "data/openclaw/openclaw.json"));
  try {
    for (const entry of fs.readdirSync(desktop, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(desktop, entry.name, "data/openclaw/openclaw.json"));
    }
  } catch {}

  return [...new Set(candidates)];
}

function writeOpenClawConfigTextFallback(filePath, profile, apiKey) {
  const providerKey = getOpenClawProviderKey(profile);
  const modelRef = `${providerKey}/${profile.modelId}`;
  const providerBaseUrl = getOpenClawProviderBaseUrl(profile);
  let content = fs.readFileSync(filePath, "utf8");
  const replaceStringProp = (source, prop, value) => {
    const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const pattern = new RegExp(`"${prop}"\\s*:\\s*"[^"]*"`);
    return pattern.test(source)
      ? source.replace(pattern, `"${prop}": "${escaped}"`)
      : source;
  };

  content = replaceStringProp(content, "apiKey", apiKey);
  content = replaceStringProp(content, "baseUrl", providerBaseUrl);
  content = content.replace(/"primary"\s*:\s*"[^"]+\/[^"]+"/, `"primary": "${modelRef}"`);
  fs.writeFileSync(filePath, content, "utf8");
}

function getOpenClawProviderKey(profile) {
  return profile?.key === "newapi" || profile?.key === "custom" ? "clawhouse" : profile?.key || "clawhouse";
}

function getOpenClawProviderBaseUrl(profile) {
  if (profile?.key === "deepseek") return "https://api.deepseek.com";
  return profile?.baseUrl;
}

function syncOpenClawAuthProfiles(configPath, apiKey, providerKey = "clawhouse") {
  const authPath = path.join(path.dirname(configPath), "agents/main/agent/auth-profiles.json");
  try {
    let authConfig = { version: 1, profiles: {} };
    if (fs.existsSync(authPath)) {
      authConfig = JSON.parse(fs.readFileSync(authPath, "utf8"));
    }
    if (!authConfig.profiles) authConfig.profiles = {};
    authConfig.profiles[`${providerKey}:default`] = {
      type: "api_key",
      provider: providerKey,
      key: apiKey
    };
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify(authConfig, null, 2), "utf8");
  } catch (error) {
    console.warn(`[sync] Failed to update OpenClaw auth profiles: ${error.message}`);
  }
}

function syncClawxProviders(openClawConfigPath, profile, apiKey, providerKey) {
  const appDataDir = path.resolve(path.dirname(openClawConfigPath), "..");
  const providersPath = path.join(appDataDir, "clawx-providers.json");
  if (!fs.existsSync(providersPath)) return;

  try {
    const nowIso = now();
    const modelRef = `${providerKey}/${profile.modelId}`;
    const baseUrl = getOpenClawProviderBaseUrl(profile);
    const label = profile.modelAlias || profile.key || providerKey;
    const data = JSON.parse(fs.readFileSync(providersPath, "utf8"));
    if (!data.providers) data.providers = {};
    if (!data.providerAccounts) data.providerAccounts = {};
    if (!data.apiKeys) data.apiKeys = {};
    if (!data.providerSecrets) data.providerSecrets = {};

    for (const account of Object.values(data.providerAccounts)) {
      if (account && typeof account === "object") account.isDefault = false;
    }

    data.providerAccounts[providerKey] = {
      ...(data.providerAccounts[providerKey] || {}),
      id: providerKey,
      vendorId: providerKey === "clawhouse" ? "custom" : providerKey,
      label: providerKey === "clawhouse" ? "ClawHouse" : label,
      authMode: "api_key",
      baseUrl,
      model: modelRef,
      enabled: true,
      isDefault: true,
      createdAt: data.providerAccounts[providerKey]?.createdAt || nowIso,
      updatedAt: nowIso
    };
    data.apiKeys[providerKey] = apiKey;
    data.providerSecrets[providerKey] = {
      type: "api_key",
      accountId: providerKey,
      apiKey
    };
    data.defaultProvider = providerKey;
    data.defaultProviderAccountId = providerKey;

    fs.writeFileSync(providersPath, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.warn(`[sync] Failed to update ClawHouse provider store: ${error.message}`);
  }
}

function syncOpenClawProviderConfig({ apiKey, baseUrl }) {
  if (!apiKey) return null;
  const profile = inferProviderProfile(apiKey, baseUrl) || {
    key: "custom",
    baseUrl: normalizeApiBaseUrl(baseUrl || env.newapiBaseUrl),
    modelId: env.defaultModel,
    modelAlias: env.defaultModel
  };
  const providerKey = getOpenClawProviderKey(profile);
  const modelRef = `${providerKey}/${profile.modelId}`;
  const providerBaseUrl = getOpenClawProviderBaseUrl(profile);

  let updated = false;
  for (const filePath of getOpenClawConfigCandidates()) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, "utf8");
      try {
        const ocConfig = JSON.parse(content);
        if (!ocConfig.models) ocConfig.models = {};
        if (!ocConfig.models.providers) ocConfig.models.providers = {};
        ocConfig.models.providers[providerKey] = {
          ...(ocConfig.models.providers[providerKey] || {}),
          api: "openai-completions",
          apiKey,
          baseUrl: providerBaseUrl,
          models: [{ id: profile.modelId, name: profile.modelAlias }]
        };
        if (!ocConfig.agents) ocConfig.agents = {};
        if (!ocConfig.agents.defaults) ocConfig.agents.defaults = {};
        if (!ocConfig.agents.defaults.model) ocConfig.agents.defaults.model = {};
        ocConfig.agents.defaults.model.primary = modelRef;
        if (!ocConfig.agents.defaults.models) ocConfig.agents.defaults.models = {};
        ocConfig.agents.defaults.models[modelRef] = { alias: profile.modelAlias };
        fs.writeFileSync(filePath, JSON.stringify(ocConfig, null, 2), "utf8");
      } catch {
        writeOpenClawConfigTextFallback(filePath, profile, apiKey);
      }
      syncOpenClawAuthProfiles(filePath, apiKey, providerKey);
      syncClawxProviders(filePath, { ...profile, baseUrl: providerBaseUrl }, apiKey, providerKey);
      console.log(`[sync] OpenClaw config updated: provider=${providerKey} baseUrl=${providerBaseUrl} model=${profile.modelId} apiKey=${maskSecret(apiKey)}`);
      updated = true;
    } catch (error) {
      console.warn(`[sync] Failed to update OpenClaw config ${filePath}: ${error.message}`);
    }
  }
  if (updated) return profile;
  return profile;
}

function readAccountRow(row) {
  if (!row) return null;
  const value = JSON.parse(row.value || "{}");
  const baseUrl = value.baseUrl || getDefaultBaseUrl(row.api_key || value.apiKey) || env.newapiBaseUrl;
  return {
    ...value,
    id: row.id,
    baseUrl,
    userId: row.user_id || value.userId || null,
    apiKey: row.api_key || value.apiKey || null,
    accessToken: row.access_token || value.accessToken || null,
    hasApiKey: Boolean(row.api_key || value.apiKey),
    hasAccessToken: Boolean(row.access_token || value.accessToken),
    maskedApiKey: maskSecret(row.api_key || value.apiKey),
    maskedAccessToken: maskSecret(row.access_token || value.accessToken)
  };
}

function publicAccount(account) {
  if (!account) return null;
  const { apiKey, accessToken, ...safe } = account;
  return safe;
}

function publicProvider(item) {
  if (!item) return item;
  const { apiKey, accessToken, ...safe } = item;
  return {
    ...safe,
    hasApiKey: Boolean(item.hasApiKey || apiKey),
    maskedApiKey: item.maskedApiKey || maskSecret(apiKey),
    hasAccessToken: Boolean(item.hasAccessToken || accessToken)
  };
}

function getNewApiAccount(id = "default") {
  const row = db.prepare("SELECT * FROM newapi_accounts WHERE id = ?").get(id);
  const account = readAccountRow(row);
  if (account || id !== "default") return account;
  const providerRow = db.prepare("SELECT api_key FROM providers WHERE api_key IS NOT NULL AND api_key <> '' LIMIT 1").get();
  const accountRow = db.prepare("SELECT api_key FROM provider_accounts WHERE api_key IS NOT NULL AND api_key <> '' LIMIT 1").get();
  const apiKey = providerRow?.api_key || accountRow?.api_key || null;
  if (!apiKey) return null;
  return {
    id: "default",
    baseUrl: getDefaultBaseUrl(apiKey),
    apiKey,
    accessToken: null,
    userId: null,
    hasApiKey: true,
    hasAccessToken: false,
    maskedApiKey: maskSecret(apiKey),
    maskedAccessToken: null
  };
}

function readProviderAccount(row, id = "provider") {
  if (!row?.api_key) return null;
  const value = row.value ? JSON.parse(row.value || "{}") : {};
  const inferredBaseUrl = inferBaseUrl(row.api_key);
  return {
    ...value,
    id: value.id || id,
    baseUrl: inferredBaseUrl || value.baseUrl || env.newapiBaseUrl,
    apiKey: row.api_key,
    hasApiKey: true,
    maskedApiKey: maskSecret(row.api_key),
    source: "provider"
  };
}

function getChatAccount() {
  const providerRow = db.prepare(`
    SELECT id, value, api_key
    FROM providers
    WHERE api_key IS NOT NULL AND api_key <> ''
    ORDER BY updated_at DESC
    LIMIT 1
  `).get();
  const providerAccount = readProviderAccount(providerRow, providerRow?.id);
  if (providerAccount?.baseUrl && inferBaseUrl(providerAccount.apiKey)) return providerAccount;

  const accountRow = db.prepare(`
    SELECT id, value, api_key
    FROM provider_accounts
    WHERE api_key IS NOT NULL AND api_key <> ''
    ORDER BY updated_at DESC
    LIMIT 1
  `).get();
  const savedProviderAccount = readProviderAccount(accountRow, accountRow?.id);
  if (savedProviderAccount?.baseUrl && inferBaseUrl(savedProviderAccount.apiKey)) return savedProviderAccount;

  return getNewApiAccount();
}

function resolveChatModel(model, baseUrl) {
  const requested = typeof model === "string" ? model.trim() : "";
  if (String(baseUrl || "").includes("api.deepseek.com")) {
    return requested.startsWith("deepseek-") ? requested : "deepseek-chat";
  }
  return requested || env.defaultModel;
}

function readGatewayTokenFromConfig(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const config = JSON.parse(content);
    const token = config?.gateway?.auth?.token || config?.gatewayToken || config?.gateway?.token;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  } catch {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const match = content.match(/"token"\s*:\s*"(clawx-[^"]+)"/);
      return match?.[1] || null;
    } catch {
      return null;
    }
  }
}

function getGatewayToken() {
  const candidates = [
    process.env.OPENCLAW_CONFIG_PATH,
    path.resolve(process.cwd(), "../新版小龙虾/data/openclaw/openclaw.json"),
    "C:/Users/PC/Desktop/新版小龙虾/data/openclaw/openclaw.json",
    path.join(process.env.USERPROFILE || "", ".openclaw/openclaw.json")
  ].filter(Boolean);

  for (const candidate of candidates) {
    const token = readGatewayTokenFromConfig(candidate);
    if (token) return token;
  }
  return null;
}

function saveNewApiAccount(input = {}) {
  const timestamp = now();
  const id = input.id || "default";
  const existing = getNewApiAccount(id);
  const account = {
    ...existing,
    id,
    baseUrl: normalizeBaseUrl(input.baseUrl || existing?.baseUrl || env.newapiBaseUrl),
    userId: input.userId ?? existing?.userId ?? null,
    username: input.username ?? existing?.username ?? null,
    quota: input.quota ?? existing?.quota ?? null,
    usedQuota: input.usedQuota ?? existing?.usedQuota ?? null,
    group: input.group ?? existing?.group ?? null,
    lastSyncAt: input.lastSyncAt ?? existing?.lastSyncAt ?? null,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  const apiKey = input.apiKey ?? existing?.apiKey ?? null;
  const accessToken = input.accessToken ?? existing?.accessToken ?? null;
  db.prepare(`
    INSERT INTO newapi_accounts (id, value, api_key, access_token, user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      value = excluded.value,
      api_key = excluded.api_key,
      access_token = excluded.access_token,
      user_id = excluded.user_id,
      updated_at = excluded.updated_at
  `).run(id, JSON.stringify(account), apiKey, accessToken, account.userId, account.createdAt, account.updatedAt);
  return getNewApiAccount(id);
}

function saveUsageRecord(record) {
  const id = record.id || makeId("usage");
  const createdAt = record.createdAt || now();
  const saved = { ...record, id, createdAt };
  db.prepare("INSERT INTO usage_records (id, value, created_at) VALUES (?, ?, ?)").run(id, JSON.stringify(saved), createdAt);
  return saved;
}

function listUsageRecords({ limit = 100 } = {}) {
  return db.prepare("SELECT value FROM usage_records ORDER BY created_at DESC LIMIT ?").all(limit).map((row) => {
    try { return JSON.parse(row.value); } catch { return {}; }
  });
}

function summarizeUsage(records = listUsageRecords()) {
  const today = new Date().toISOString().slice(0, 10);
  const todayRecords = records.filter((record) => String(record.createdAt || "").slice(0, 10) === today);
  const totalTokens = todayRecords.reduce((sum, record) => sum + Number(record.totalTokens || 0), 0);
  const totalCost = todayRecords.reduce((sum, record) => sum + Number(record.quotaCost || 0), 0);
  const byModel = {};
  for (const record of todayRecords) {
    const model = record.model || "unknown";
    byModel[model] ??= { model, requests: 0, totalTokens: 0, quotaCost: 0 };
    byModel[model].requests += 1;
    byModel[model].totalTokens += Number(record.totalTokens || 0);
    byModel[model].quotaCost += Number(record.quotaCost || 0);
  }
  return {
    todayRequests: todayRecords.length,
    todayTokens: totalTokens,
    todayCost: totalCost,
    activeModels: Object.values(byModel).sort((a, b) => b.requests - a.requests),
    recentRequests: records.slice(0, 20)
  };
}

// ─── In-Memory Chat Sessions ──────────────────────────────────────

const chatSessions = new Map();

function getSession(key) {
  if (!chatSessions.has(key)) {
    chatSessions.set(key, {
      key,
      displayName: "新对话",
      messages: [],
      createdAt: now(),
      updatedAt: now()
    });
  }
  return chatSessions.get(key);
}

function listChannelViews() {
  try {
    const rows = db.prepare("SELECT * FROM channels ORDER BY created_at ASC").all();
    return rows.map(r => {
      try { return { ...JSON.parse(r.value), channel_type: r.channel_type, enabled: !!r.enabled }; }
      catch { return { channel_type: r.channel_type, enabled: !!r.enabled }; }
    });
  } catch { return []; }
}

// ─── Gateway RPC ──────────────────────────────────────────────────

function getChannelStatus() {
  const supported = [
    { type: "wechat", name: "WeChat", label: "WeChat", enabled: true, installed: false, status: "available", mode: "plugin" },
    { type: "lark", name: "Feishu / Lark", label: "Feishu / Lark", enabled: true, installed: false, status: "available", mode: "plugin" },
    { type: "dingtalk", name: "DingTalk", label: "DingTalk", enabled: true, installed: false, status: "available", mode: "stream" },
    { type: "qq", name: "QQ Bot", label: "QQ Bot", enabled: true, installed: false, status: "available", mode: "builtin" },
    { type: "wecom", name: "WeCom", label: "WeCom", enabled: true, installed: false, status: "available", mode: "plugin" }
  ];
  const configured = listChannelViews();
  return { supported, configured, channels: configured, accounts: [], defaultAccountId: null };
}

function listCronJobs() {
  const jobs = listTable("cron_jobs");
  return {
    jobs,
    items: jobs,
    summary: {
      total: jobs.length,
      running: jobs.filter((job) => job.status === "running").length,
      paused: jobs.filter((job) => job.status === "paused").length,
      failed: jobs.filter((job) => job.status === "failed").length
    }
  };
}

function getSkillsStatus() {
  return {
    skills: [],
    items: [],
    catalogs: [
      { id: "builtin", name: "Built-in", enabled: true },
      { id: "market", name: "Market", enabled: true }
    ],
    updatedAt: now()
  };
}

function readRuntimeLogs(limit = 200) {
  const logDirs = [
    path.resolve(process.cwd(), "logs"),
    path.resolve(process.cwd(), "data/logs"),
    path.resolve(process.cwd(), "../新版小龙虾/data/logs")
  ];
  const files = [];
  for (const dir of logDirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (/\.(log|txt)$/i.test(name)) files.push(path.join(dir, name));
      }
    } catch {}
  }
  files.sort((a, b) => {
    try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
  });
  const file = files[0] || null;
  if (!file) return { file: null, lines: [], entries: [], total: 0 };
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-limit);
  return {
    file,
    lines,
    entries: lines.map((message, index) => ({
      id: `${path.basename(file)}:${index}`,
      level: /error|fail|unauthorized|auth/i.test(message) ? "ERROR" : /warn/i.test(message) ? "WARN" : "INFO",
      message,
      timestamp: null
    })),
    total: lines.length
  };
}

function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((part) => Number(part.replace(/\D/g, "")) || 0);
  const pb = String(b || "0").split(".").map((part) => Number(part.replace(/\D/g, "")) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function getUpdateStatus() {
  const currentVersion = env.appVersion;
  if (!env.updateManifestUrl) {
    return { status: "not-configured", available: false, currentVersion, updateInfo: null };
  }
  const response = await fetch(env.updateManifestUrl, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Update manifest ${response.status}`);
  const manifest = await response.json();
  const latestVersion = manifest.version || manifest.latestVersion || currentVersion;
  const available = compareVersions(latestVersion, currentVersion) > 0;
  return {
    status: available ? "available" : "up-to-date",
    available,
    currentVersion,
    latestVersion,
    updateInfo: manifest
  };
}

async function gatewayRpc(method, params = {}) {
  switch (method) {
    case "skills.status":
    case "skills.list":
      return getSkillsStatus();
    case "skills.update":
      return { updated: true };
    case "channels.status":
    case "channels.list":
      return getChannelStatus();
    case "channels.add":
      return { channel: params || {} };
    case "channels.connect":
      return { status: "connected", qr: null };
    case "channels.disconnect":
    case "channels.delete":
      return { success: true };
    case "channels.requestQr":
      return { status: "connected", qr: null };
    case "cron.status":
    case "cron.list":
    case "cron.jobs":
    case "tasks.list":
      return listCronJobs();
    case "logs.list":
    case "runtime.logs":
      return readRuntimeLogs(Number(params?.limit || 200));
    case "sessions.list":
      return {
        sessions: Array.from(chatSessions.values()).map((session) => ({
          key: session.key,
          displayName: session.displayName,
          updatedAt: session.updatedAt,
          model: "mock-model"
        }))
      };
    case "chat.history": {
      // Proxy to REAL OpenClaw Gateway
      try {
        const gwRes = await fetch(gatewayUrl + "/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "req", id: makeId("rpc"), method: "chat.history", params: params || {} }),
          signal: AbortSignal.timeout(10000)
        });
        if (gwRes.ok) {
          const data = await gwRes.json();
          return data.result || { messages: [] };
        }
      } catch (e) {
        console.log(`[gateway-proxy] chat.history failed: ${e.message}, using local`);
      }
      // Fallback to local
      const session = getSession(params?.sessionKey || "main");
      return { messages: session.messages, thinkingLevel: null };
    }
    case "chat.send": {
      const runId = makeId("run");
      const sessionKey = params?.sessionKey || "main";
      const session = getSession(sessionKey);
      const message = typeof params?.message === "string" ? params.message : "";
      const account = getChatAccount();
      const apiKey = account?.apiKey || getApiKey();

      if (apiKey && message) {
        const userMessage = { id: makeId("msg"), role: "user", content: message, timestamp: now() };
        session.messages.push(userMessage);
        session.updatedAt = now();
        if (session.displayName === "新对话" || session.displayName === "鏂板璇?") session.displayName = message.slice(0, 40);

        try {
          const baseUrl = account?.baseUrl || getDefaultBaseUrl(apiKey);
          const model = resolveChatModel(params?.model, baseUrl);
          const baseClient = newapi.withBaseUrl(baseUrl);
          const history = session.messages
            .filter((item) => item.role === "user" || item.role === "assistant")
            .slice(-20)
            .map((item) => ({ role: item.role, content: typeof item.content === "string" ? item.content : String(item.content || "") }));
          const startedAt = Date.now();
          const completion = await baseClient.chatCompletions({
            apiKey,
            model,
            messages: history,
            stream: false
          });
          const assistantText = completion?.choices?.[0]?.message?.content || completion?.choices?.[0]?.text || "";
          const usage = completion?.usage || {};
          session.messages.push({
            id: makeId("msg"),
            role: "assistant",
            content: assistantText || "NewAPI 已返回空内容。",
            timestamp: now(),
            runId,
            model: completion?.model || model
          });
          session.updatedAt = now();
          saveUsageRecord({
            sessionKey,
            runId,
            model: completion?.model || model,
            promptTokens: usage.prompt_tokens || usage.promptTokens || 0,
            completionTokens: usage.completion_tokens || usage.completionTokens || 0,
            totalTokens: usage.total_tokens || usage.totalTokens || 0,
            quotaCost: usage.quota || usage.cost || usage.total_quota || 0,
            latencyMs: Date.now() - startedAt,
            status: "success"
          });
          sseBroadcast("gateway:notification", { type: "chat-message", sessionKey, runId });
          return { runId };
        } catch (err) {
          saveUsageRecord({
            sessionKey,
            runId,
            model: resolveChatModel(params?.model, account?.baseUrl || getDefaultBaseUrl(apiKey)),
            totalTokens: 0,
            quotaCost: 0,
            latencyMs: 0,
            status: "error",
            error: err.message
          });
          return { runId, error: `NewAPI failed: ${err.message}` };
        }
      }

      // Fallback to REAL OpenClaw Gateway when NewAPI is not bound yet.
      try {
        const gwRes = await fetch(gatewayUrl + "/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "req", id: makeId("rpc"), method: "chat.send", params }),
          signal: AbortSignal.timeout(120000)
        });
        if (!gwRes.ok) {
          const errText = await gwRes.text().catch(() => "");
          return { runId, error: `Gateway error ${gwRes.status}: ${errText.slice(0, 200)}` };
        }
        const data = await gwRes.json();
        sseBroadcast("gateway:notification", { type: "chat-message", sessionKey: params?.sessionKey || "main", runId });
        return data.result || { runId };
      } catch (err) {
        return { runId, error: `Gateway proxy failed: ${err.message}` };
      }
    }
    case "chat.abort":
      return { aborted: true };
    default:
      return {};
  }
}

// ─── Routes ────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  ok(res, {
    name: "ClawHouse Compatible Backend",
    version: "0.1.0",
    time: now()
  });
});

app.get("/health", (req, res) => ok(res, { status: "ok" }));

app.get("/api/settings", (req, res) => res.json(getSettings()));
app.put("/api/settings", (req, res) => {
  for (const [key, value] of Object.entries(req.body || {})) setSetting(key, value);
  ok(res, { settings: getSettings() });
});
app.get("/api/settings/:key", (req, res) => {
  const value = getSetting(req.params.key);
  if (value === undefined) return fail(res, 404, "Setting not found");
  res.json({ value });
});
app.put("/api/settings/:key", (req, res) => {
  setSetting(req.params.key, req.body?.value);
  ok(res);
});
app.post("/api/settings/reset", (req, res) => {
  const s = resetSettings();
  ok(res, { settings: s });
});

// ─── Provider ──────────────────────────────────────────────────────

app.get("/api/provider-accounts", (req, res) => {
  const list = listTable("provider_accounts").map(publicProvider);
  ok(res, { accounts: list, items: list });
});
app.get("/api/provider-accounts/default", (req, res) => {
  const row = db.prepare("SELECT * FROM provider_accounts ORDER BY created_at ASC LIMIT 1").all();
  if (row.length > 0) return ok(res, { account: row[0], providerId: row[0].id });
  ok(res, { account: null, providerId: null });
});
app.post("/api/provider-accounts", (req, res) => {
  const payload = req.body?.account || req.body || {};
  const apiKey = req.body?.apiKey ?? payload.apiKey;
  const accessToken = req.body?.accessToken ?? payload.accessToken;
  const { id, baseUrl, userId, ...value } = payload;
  const pk = id || makeId("prov");
  const profile = inferProviderProfile(apiKey, baseUrl);
  const resolvedBaseUrl = baseUrl || profile?.baseUrl || null;
  saveTableItem("provider_accounts", "id", pk, { ...value, id: pk, baseUrl: resolvedBaseUrl, userId, provider: profile?.key || value.provider }, {
    columns: "api_key",
    placeholders: "?",
    values: [apiKey || null],
    update: "api_key = excluded.api_key"
  });
  let openclawProfile = null;
  if (apiKey && profile && !isNewApiBaseUrl(resolvedBaseUrl)) {
    openclawProfile = syncOpenClawProviderConfig({ apiKey, baseUrl: resolvedBaseUrl });
  }
  if (apiKey && isNewApiBaseUrl(resolvedBaseUrl)) {
    saveNewApiAccount({ apiKey, accessToken, baseUrl: resolvedBaseUrl, userId });
    openclawProfile = syncOpenClawProviderConfig({ apiKey, baseUrl: resolvedBaseUrl });
  }
  ok(res, { account: publicProvider(getTableItem("provider_accounts", "id", pk)), openclaw: openclawProfile });
});

app.get("/api/providers", (req, res) => {
  const list = listTable("providers").map(publicProvider);
  ok(res, { providers: list, items: list });
});
app.post("/api/providers", (req, res) => {
  const config = req.body?.config || req.body || {};
  const { id, apiKey, accessToken, baseUrl, userId, ...value } = { ...config, apiKey: req.body?.apiKey ?? config.apiKey, accessToken: req.body?.accessToken ?? config.accessToken };
  const pk = id || makeId("prov");
  const explicitNewApiBaseUrl = req.body?.newapiBaseUrl || req.body?.newApiBaseUrl || req.body?.newapi?.baseUrl;
  const profile = inferProviderProfile(apiKey, baseUrl || explicitNewApiBaseUrl);
  const resolvedBaseUrlForProvider = baseUrl || explicitNewApiBaseUrl || profile?.baseUrl || null;
  saveTableItem("providers", "id", pk, { ...value, id: pk, baseUrl: resolvedBaseUrlForProvider, userId, provider: profile?.key || value.provider }, {
    columns: "api_key",
    placeholders: "?",
    values: [apiKey || null],
    update: "api_key = excluded.api_key"
  });
  let openclawProfile = null;
  if (apiKey && profile && !isNewApiBaseUrl(resolvedBaseUrlForProvider)) {
    openclawProfile = syncOpenClawProviderConfig({ apiKey, baseUrl: resolvedBaseUrlForProvider });
  }
  if (apiKey && (explicitNewApiBaseUrl || isNewApiBaseUrl(resolvedBaseUrlForProvider))) {
    saveNewApiAccount({ apiKey, accessToken, baseUrl: resolvedBaseUrlForProvider, userId });
    openclawProfile = syncOpenClawProviderConfig({ apiKey, baseUrl: resolvedBaseUrlForProvider });
  }
  return ok(res, { provider: publicProvider(getTableItem("providers", "id", pk)), openclaw: openclawProfile });
  saveTableItem("providers", "id", pk, { ...value, id: pk, baseUrl, userId }, {
    columns: "api_key",
    placeholders: "?",
    values: [apiKey || null],
    update: "api_key = excluded.api_key"
  });
  // 如果没传 baseUrl，自动根据 apiKey 推断厂商地址
  const resolvedBaseUrl = baseUrl || inferBaseUrl(apiKey) || null;
  const legacyExplicitNewApiBaseUrl = req.body?.newapiBaseUrl || req.body?.newApiBaseUrl || req.body?.newapi?.baseUrl;
  if (apiKey || accessToken || legacyExplicitNewApiBaseUrl || userId) saveNewApiAccount({ apiKey, accessToken, baseUrl: legacyExplicitNewApiBaseUrl || resolvedBaseUrl, userId });

  // Also save to OpenClaw config so Gateway can use it
  try {
    const clawhouseOpenclawJson = "C:/Users/PC/Desktop/openclaw2/新版小龙虾/data/openclaw/openclaw.json";
    if (fs.existsSync(clawhouseOpenclawJson)) {
      const ocConfig = JSON.parse(fs.readFileSync(clawhouseOpenclawJson, "utf8"));
      if (!ocConfig.models) ocConfig.models = {};
      if (!ocConfig.models.providers) ocConfig.models.providers = {};
      if (!ocConfig.models.providers.clawhouse) ocConfig.models.providers.clawhouse = {};
      if (apiKey) ocConfig.models.providers.clawhouse.apiKey = apiKey;
      if (resolvedBaseUrl) ocConfig.models.providers.clawhouse.baseUrl = resolvedBaseUrl;
      if (accessToken) ocConfig.models.providers.clawhouse.accessToken = accessToken;
      ocConfig.models.providers.clawhouse.api = "openai-completions";
      fs.writeFileSync(clawhouseOpenclawJson, JSON.stringify(ocConfig, null, 2), "utf8");
      console.log(`[sync] OpenClaw config updated: baseUrl=${resolvedBaseUrl} apiKey=${maskSecret(apiKey || accessToken)}`);
    }
  } catch (ocErr) {
    console.warn("[sync] Failed to update OpenClaw config:", ocErr.message);
  }
  ok(res, { provider: publicProvider(getTableItem("providers", "id", pk)) });
});
app.get("/api/providers/:id/has-api-key", (req, res) => {
  const account = getNewApiAccount();
  if (req.params.id === "clawhouse" && account?.apiKey) return res.json({ hasKey: true });
  const row = db.prepare("SELECT api_key FROM providers WHERE id = ?").get(req.params.id);
  res.json({ hasKey: Boolean(row?.api_key) });
});
app.get("/api/providers/default", (req, res) => {
  const row = db.prepare("SELECT * FROM providers ORDER BY created_at ASC LIMIT 1").all();
  ok(res, { providerId: row.length > 0 ? row[0].id : null });
});

app.get("/api/provider-vendors", (req, res) => {
  ok(res, {
    vendors: [
      { key: "deepseek", label: "DeepSeek", models: ["deepseek-chat", "deepseek-reasoner"] },
      { key: "zhipu", label: "智谱 GLM", models: ["glm-4-flash", "glm-4-plus"] },
      { key: "qwen", label: "通义千问", models: ["qwen-plus", "qwen-turbo", "qwen-max"] },
      { key: "siliconflow", label: "硅基流动", models: ["deepseek-ai/DeepSeek-V3.2"] },
      { key: "moonshot", label: "Moonshot / Kimi", models: ["kimi-k2-0905-preview"] },
      { key: "openai", label: "OpenAI", models: ["gpt-4o-mini", "gpt-4o"] },
      { key: "openrouter", label: "OpenRouter", models: ["deepseek/deepseek-chat-v3.1"] },
      { key: "baichuan", label: "百川智能", models: ["Baichuan4"] },
      { key: "minimax", label: "MiniMax", models: ["MiniMax-M1"] },
      { key: "stepfun", label: "阶跃星辰", models: ["step-2-mini"] }
    ]
  });
});

app.post("/api/providers/validate", asyncRoute(async (req, res) => {
  const { apiKey, providerId, baseUrl } = req.body || {};
  const profile = inferProviderProfile(apiKey, baseUrl || providerProfiles[providerId]?.baseUrl);
  if (!apiKey) return ok(res, { valid: false, error: "API Key is required", profile: null });
  if (!profile) return ok(res, { valid: false, error: "无法识别厂商，请填写 Base URL", profile: null });

  try {
    const client = newapi.withBaseUrl(profile.baseUrl);
    const models = await client.getModels(apiKey);
    ok(res, {
      valid: true,
      profile: {
        key: profile.key,
        baseUrl: profile.baseUrl,
        modelId: profile.modelId,
        modelAlias: profile.modelAlias
      },
      models: models?.data || models || null
    });
  } catch (error) {
    ok(res, {
      valid: false,
      error: error.message,
      status: error.status || null,
      profile: {
        key: profile.key,
        baseUrl: profile.baseUrl,
        modelId: profile.modelId,
        modelAlias: profile.modelAlias
      }
    });
  }
}));

// NewAPI account binding and dashboard data. API Key is used for model calls;
// Access Token is used for user profile, balance, logs and statistics.
app.get("/api/newapi/account", (req, res) => {
  ok(res, { account: publicAccount(getNewApiAccount()) });
});

app.post("/api/newapi/bind", asyncRoute(async (req, res) => {
  const { baseUrl, apiKey, accessToken, userId } = req.body || {};
  const accountInput = {
    baseUrl: normalizeBaseUrl(baseUrl || env.newapiBaseUrl),
    apiKey,
    accessToken,
    userId
  };
  const client = newapi.withBaseUrl(accountInput.baseUrl);
  const validation = { apiKey: null, accessToken: null };
  let profile = null;
  let models = null;

  if (apiKey) {
    try {
      models = await client.getModels(apiKey);
      validation.apiKey = { ok: true };
    } catch (error) {
      validation.apiKey = { ok: false, error: error.message, status: error.status || null };
    }
  }

  if (accessToken) {
    try {
      profile = await client.getProfile({ accessToken, userId });
      validation.accessToken = { ok: true };
    } catch (error) {
      validation.accessToken = { ok: false, error: error.message, status: error.status || null };
    }
  }

  const profileData = profile?.data || profile;
  const saved = saveNewApiAccount({
    ...accountInput,
    userId: userId || profileData?.id || profileData?.user_id || null,
    username: profileData?.username || profileData?.display_name || profileData?.email || null,
    quota: profileData?.quota ?? profileData?.balance ?? null,
    usedQuota: profileData?.used_quota ?? profileData?.used ?? null,
    group: profileData?.group || profileData?.group_name || null,
    lastSyncAt: now()
  });

  ok(res, {
    account: publicAccount(saved),
    profile: profileData || null,
    models: models?.data || models || null,
    validation
  });
}));

app.get("/api/newapi/status", asyncRoute(async (req, res) => {
  const account = getNewApiAccount();
  const client = newapi.withBaseUrl(account?.baseUrl || env.newapiBaseUrl);
  res.json(await client.getStatus());
}));

app.get("/api/newapi/pricing", asyncRoute(async (req, res) => {
  const account = getNewApiAccount();
  const client = newapi.withBaseUrl(account?.baseUrl || env.newapiBaseUrl);
  res.json(await client.getPricing());
}));

app.get("/api/newapi/profile", asyncRoute(async (req, res) => {
  const account = getNewApiAccount();
  if (!account?.accessToken) return fail(res, 400, "NewAPI access token is not bound");
  const client = newapi.withBaseUrl(account.baseUrl);
  const profile = await client.getProfile({ accessToken: account.accessToken, userId: account.userId });
  const profileData = profile?.data || profile;
  saveNewApiAccount({
    ...account,
    username: profileData?.username || profileData?.display_name || profileData?.email || account.username,
    quota: profileData?.quota ?? profileData?.balance ?? account.quota,
    usedQuota: profileData?.used_quota ?? profileData?.used ?? account.usedQuota,
    group: profileData?.group || profileData?.group_name || account.group,
    lastSyncAt: now()
  });
  ok(res, { profile: profileData });
}));

app.get("/api/newapi/models", asyncRoute(async (req, res) => {
  const account = getNewApiAccount();
  const apiKey = account?.apiKey || getApiKey();
  if (!apiKey) return fail(res, 400, "NewAPI API key is not bound");
  const client = newapi.withBaseUrl(account?.baseUrl || env.newapiBaseUrl);
  res.json(await client.getModels(apiKey));
}));

app.get("/api/newapi/logs", asyncRoute(async (req, res) => {
  const account = getNewApiAccount();
  if (!account?.accessToken) return fail(res, 400, "NewAPI access token is not bound");
  const client = newapi.withBaseUrl(account.baseUrl);
  res.json(await client.getSelfLogs({
    accessToken: account.accessToken,
    userId: account.userId,
    page: Number(req.query.p || 1),
    size: Number(req.query.size || 20)
  }));
}));

app.get("/api/newapi/logs/stat", asyncRoute(async (req, res) => {
  const account = getNewApiAccount();
  if (!account?.accessToken) return fail(res, 400, "NewAPI access token is not bound");
  const client = newapi.withBaseUrl(account.baseUrl);
  res.json(await client.getSelfLogStat({ accessToken: account.accessToken, userId: account.userId }));
}));

app.get("/api/newapi/quota", asyncRoute(async (req, res) => {
  const account = getNewApiAccount();
  if (!account?.accessToken) return fail(res, 400, "NewAPI access token is not bound");
  const client = newapi.withBaseUrl(account.baseUrl);
  res.json(await client.getSelfData({ accessToken: account.accessToken, userId: account.userId }));
}));

app.get("/api/newapi/tokens", asyncRoute(async (req, res) => {
  const account = getNewApiAccount();
  if (!account?.accessToken) return fail(res, 400, "NewAPI access token is not bound");
  const client = newapi.withBaseUrl(account.baseUrl);
  res.json(await client.getTokens({
    accessToken: account.accessToken,
    userId: account.userId,
    page: Number(req.query.p || 1),
    size: Number(req.query.size || 20)
  }));
}));

app.post("/api/newapi/issue-key", asyncRoute(async (req, res) => {
  const { userId, name, quota, unlimitedQuota, expiredTime, models } = req.body || {};
  const accessToken = req.body?.accessToken || env.newapiAdminAccessToken;
  const targetUserId = userId || req.body?.newApiUserId || env.newapiAdminUserId;
  if (!accessToken) return fail(res, 400, "NEWAPI_ADMIN_ACCESS_TOKEN is not configured");
  if (!targetUserId) return fail(res, 400, "userId is required to issue a user key");

  const client = newapi.withBaseUrl(req.body?.baseUrl || env.newapiBaseUrl);
  const tokenPayload = {
    name: name || "ClawHouse Desktop",
    unlimited_quota: unlimitedQuota ?? env.issueKeyDefaultQuota <= 0,
    remain_quota: Number.isFinite(Number(quota)) ? Number(quota) : env.issueKeyDefaultQuota,
    expired_time: Number.isFinite(Number(expiredTime)) ? Number(expiredTime) : -1,
    models: Array.isArray(models) ? models : []
  };

  const created = await client.createToken({
    accessToken,
    userId: targetUserId,
    payload: tokenPayload
  });
  const createdData = created?.data || created;
  const tokenId = createdData?.id || createdData?.token?.id;
  let key = createdData?.key || createdData?.token || createdData?.value || null;

  if (!key && tokenId) {
    const keyResult = await client.revealTokenKey({ accessToken, userId: targetUserId, tokenId });
    const keyData = keyResult?.data || keyResult;
    key = keyData?.key || keyData?.token || keyData?.value || null;
  }

  if (!key) {
    return ok(res, {
      issued: false,
      token: createdData,
      message: "Token was created, but NewAPI did not return the raw key. Please verify token reveal permissions."
    });
  }

  saveNewApiAccount({
    apiKey: key,
    baseUrl: req.body?.baseUrl || env.newapiBaseUrl,
    userId: targetUserId,
    lastSyncAt: now()
  });

  ok(res, {
    issued: true,
    apiKey: key,
    maskedApiKey: maskSecret(key),
    tokenId: tokenId || null,
    token: createdData
  });
}));

function extractNewApiUserId(payload) {
  const data = payload?.data || payload?.user || payload;
  return data?.id || data?.user_id || data?.userId || data?.uid || null;
}

async function issueKeyForUser({ userId, sessionCookie, name, baseUrl, quota, unlimitedQuota, expiredTime, models }) {
  const accessToken = env.newapiAdminAccessToken;
  if (!accessToken && !sessionCookie) {
    const error = new Error("NewAPI session is not available");
    error.status = 400;
    throw error;
  }
  if (!userId) {
    const error = new Error("NewAPI user id was not returned");
    error.status = 400;
    throw error;
  }
  const client = newapi.withBaseUrl(baseUrl || env.newapiBaseUrl);
  const tokenPayload = {
    name: name || "ClawHouse Desktop",
    unlimited_quota: unlimitedQuota ?? env.issueKeyDefaultQuota <= 0,
    remain_quota: Number.isFinite(Number(quota)) ? Number(quota) : env.issueKeyDefaultQuota,
    expired_time: Number.isFinite(Number(expiredTime)) ? Number(expiredTime) : -1,
    models: Array.isArray(models) ? models : []
  };
  const auth = sessionCookie ? { sessionCookie, userId } : { accessToken, userId };
  const created = await client.createToken({ ...auth, payload: tokenPayload });
  const createdData = created?.data || created;
  const tokenId = createdData?.id || createdData?.token?.id;
  let key = createdData?.key || createdData?.token || createdData?.value || null;
  if (!key && !tokenId && sessionCookie) {
    const tokensResult = await client.getTokens({ sessionCookie, userId, page: 1, size: 10 });
    const tokensData = tokensResult?.data || tokensResult;
    const items = Array.isArray(tokensData?.items) ? tokensData.items : Array.isArray(tokensData) ? tokensData : [];
    const token = items.find((item) => item?.name === tokenPayload.name) || items[0];
    if (token?.id) {
      createdData.id = token.id;
    }
  }
  const resolvedTokenId = tokenId || createdData?.id || createdData?.token?.id;
  if (!key && resolvedTokenId) {
    const keyResult = await client.revealTokenKey({ ...auth, tokenId: resolvedTokenId });
    const keyData = keyResult?.data || keyResult;
    key = keyData?.key || keyData?.token || keyData?.value || null;
  }
  if (!key) {
    const error = new Error("Token was created, but NewAPI did not return the raw key");
    error.status = 502;
    error.token = createdData;
    throw error;
  }
  const account = saveNewApiAccount({ apiKey: key, baseUrl: baseUrl || env.newapiBaseUrl, userId, lastSyncAt: now() });
  return { key, apiKey: key, maskedApiKey: maskSecret(key), tokenId: resolvedTokenId || null, token: createdData, account: publicAccount(account) };
}

app.post("/api/clawhouse/register-and-issue-key", asyncRoute(async (req, res) => {
  const { username, password, email, verificationCode, turnstile, name } = req.body || {};
  if (!username || !password) return fail(res, 400, "username and password are required");
  const client = newapi.withBaseUrl(req.body?.baseUrl || env.newapiBaseUrl);
  const registerPayload = {
    username,
    password,
    email,
    verification_code: verificationCode,
    turnstile: turnstile || ""
  };
  Object.keys(registerPayload).forEach((key) => registerPayload[key] === undefined && delete registerPayload[key]);
  const registerResult = await client.registerUser(registerPayload);
  let userId = extractNewApiUserId(registerResult);
  let loginResult = null;
  let sessionCookie = "";
  if (!userId) {
    const session = await client.loginUserWithSession({ username, password, turnstile });
    loginResult = session.result;
    sessionCookie = session.sessionCookie;
    userId = extractNewApiUserId(loginResult);
  }
  const issued = await issueKeyForUser({ userId, sessionCookie, name, baseUrl: req.body?.baseUrl });
  ok(res, { mode: "register", userId, register: registerResult?.data || registerResult, login: loginResult?.data || loginResult, ...issued });
}));

app.post("/api/clawhouse/login-and-issue-key", asyncRoute(async (req, res) => {
  const { username, password, turnstile, name } = req.body || {};
  if (!username || !password) return fail(res, 400, "username and password are required");
  const client = newapi.withBaseUrl(req.body?.baseUrl || env.newapiBaseUrl);
  const session = await client.loginUserWithSession({ username, password, turnstile });
  const loginResult = session.result;
  const userId = extractNewApiUserId(loginResult);
  const issued = await issueKeyForUser({ userId, sessionCookie: session.sessionCookie, name, baseUrl: req.body?.baseUrl });
  ok(res, { mode: "login", userId, login: loginResult?.data || loginResult, ...issued });
}));

app.get("/api/newapi/dashboard", asyncRoute(async (req, res) => {
  const account = getNewApiAccount();
  const localUsage = summarizeUsage();
  const dashboard = {
    mode: account?.accessToken ? "newapi-bound" : "local",
    account: publicAccount(account),
    profile: null,
    quota: null,
    logStat: null,
    usage: localUsage,
    errors: []
  };
  if (account?.accessToken) {
    const client = newapi.withBaseUrl(account.baseUrl);
    for (const [key, loader] of Object.entries({
      profile: () => client.getProfile({ accessToken: account.accessToken, userId: account.userId }),
      quota: () => client.getSelfData({ accessToken: account.accessToken, userId: account.userId }),
      logStat: () => client.getSelfLogStat({ accessToken: account.accessToken, userId: account.userId })
    })) {
      try {
        const value = await loader();
        dashboard[key] = value?.data || value;
      } catch (error) {
        dashboard.errors.push({ source: key, message: error.message, status: error.status || null });
      }
    }
  }
  ok(res, { dashboard });
}));

app.get("/api/dashboard/summary", (req, res) => {
  ok(res, { summary: summarizeUsage(), account: publicAccount(getNewApiAccount()) });
});

app.get("/api/usage/recent-token-history", (req, res) => {
  const records = listUsageRecords({ limit: Number(req.query.limit || 100) });
  ok(res, {
    entries: records,
    total: records.reduce((sum, record) => sum + Number(record.totalTokens || 0), 0),
    limit: Number(req.query.limit || 100)
  });
});

// ─── Agents ────────────────────────────────────────────────────────

app.get("/api/agents", (req, res) => {
  const list = listTable("agents");
  ok(res, { agents: list, items: list });
});

// ─── Cron ──────────────────────────────────────────────────────────

app.get("/api/cron-jobs", (req, res) => {
  ok(res, listCronJobs());
});

app.get("/api/cron", (req, res) => ok(res, listCronJobs()));
app.get("/api/cron/status", (req, res) => ok(res, listCronJobs()));
app.get("/api/cron/tasks", (req, res) => ok(res, listCronJobs()));
app.get("/api/cron/jobs", (req, res) => res.json(listTable("cron_jobs")));
app.post("/api/cron/jobs", (req, res) => {
  const value = req.body || {};
  const id = value.id || makeId("cron");
  const saved = saveTableItem("cron_jobs", "id", id, { ...value, id, status: value.status || "paused" });
  ok(res, { job: saved });
});
app.post("/api/cron-jobs", (req, res) => {
  const value = req.body || {};
  const id = value.id || makeId("cron");
  const saved = saveTableItem("cron_jobs", "id", id, { ...value, id, status: value.status || "paused" });
  ok(res, { job: saved });
});
app.delete("/api/cron-jobs/:id", (req, res) => ok(res, { deleted: deleteTableItem("cron_jobs", "id", req.params.id) }));

// ─── Channels ──────────────────────────────────────────────────────

app.get("/api/channels", (req, res) => {
  ok(res, getChannelStatus());
});

app.get("/api/channels/status", (req, res) => ok(res, getChannelStatus()));
app.get("/api/channels/accounts", (req, res) => ok(res, { accounts: [], items: [], defaultAccountId: null }));
app.get("/api/channels/config", (req, res) => ok(res, getChannelStatus()));
app.get("/api/channels/config/:type", (req, res) => {
  const channel = getTableItem("channels", "channel_type", req.params.type);
  ok(res, { channel, config: channel });
});
app.post("/api/channels/config/:type", (req, res) => {
  const type = req.params.type;
  const value = { ...(req.body || {}), channel_type: type, type, enabled: req.body?.enabled !== false };
  const saved = saveTableItem("channels", "channel_type", type, value, {
    columns: "enabled",
    placeholders: "?",
    values: [value.enabled ? 1 : 0],
    update: "enabled = excluded.enabled"
  });
  ok(res, { channel: saved, config: saved });
});
app.delete("/api/channels/config/:type", (req, res) => ok(res, { deleted: deleteTableItem("channels", "channel_type", req.params.type) }));

app.get("/api/skills", (req, res) => ok(res, getSkillsStatus()));
app.get("/api/skills/status", (req, res) => ok(res, getSkillsStatus()));
app.get("/api/skills/configs", (req, res) => res.json([]));
app.post("/api/skills/update", (req, res) => ok(res, { updated: true, ...getSkillsStatus() }));
app.get("/api/clawhub/list", (req, res) => ok(res, { skills: [], items: [], marketplace: [] }));
app.get("/api/clawhub/installed", (req, res) => ok(res, { skills: [], items: [] }));
app.post("/api/clawhub/install", (req, res) => ok(res, { installed: false, message: "Skill installation is not available in browser mode" }));
app.post("/api/clawhub/uninstall", (req, res) => ok(res, { removed: false }));

app.get("/api/logs", (req, res) => ok(res, readRuntimeLogs(Number(req.query.limit || 200))));
app.get("/api/runtime/logs", (req, res) => ok(res, readRuntimeLogs(Number(req.query.limit || 200))));
app.get("/api/openclaw/logs", (req, res) => ok(res, readRuntimeLogs(Number(req.query.limit || 200))));

// ─── Gateway RPC ───────────────────────────────────────────────────

app.post("/api/gateway/rpc", asyncRoute(async (req, res) => {
  const { method } = req.body || {};
  if (!method) return fail(res, 400, "Missing method");
  ok(res, { result: await gatewayRpc(method, req.body?.params || {}) });
}));

app.get("/api/gateway/status", (req, res) => {
  ok(res, {
    state: "running",
    port: gatewayPort,
    gatewayReady: true,
    version: "0.1.0",
    mode: "compat"
  });
});

app.get("/api/gateway/health", (req, res) => {
  fetch(gatewayUrl + "/health", { signal: AbortSignal.timeout(3000) })
    .then(r => r.json().then(d => ok(res, { gateway: "ok", ...d })).catch(() => ok(res, { gateway: "ok" })))
    .catch(() => ok(res, { gateway: "unreachable" }));
});

app.post("/api/gateway/start", (req, res) => ok(res, { success: true, message: "Gateway is already running (compat mode)" }));
app.post("/api/gateway/stop", (req, res) => ok(res, { success: true, message: "Gateway stop requested" }));
app.post("/api/gateway/restart", (req, res) => {
  sseBroadcast("gateway:restarting", {});
  ok(res, { success: true, message: "Gateway restart requested" });
});

// ─── Control UI ────────────────────────────────────────────────────

app.get("/api/gateway/control-ui", (req, res) => {
  const baseUrl = `http://127.0.0.1:${gatewayPort}`;
  const token = getGatewayToken();
  const tokenParam = token ? `token=${encodeURIComponent(token)}` : "";
  ok(res, {
    token,
    baseUrl,
    url: tokenParam ? `${baseUrl}/?${tokenParam}` : baseUrl,
    chatUrl: tokenParam
      ? `${baseUrl}/chat?session=agent%3Amain%3Amain&${tokenParam}`
      : `${baseUrl}/chat?session=agent%3Amain%3Amain`,
    success: true
  });
});

// ─── Events / SSE ──────────────────────────────────────────────────

app.get("/api/events", (req, res) => sseRegister(res));

// ─── Update ────────────────────────────────────────────────────────

app.get("/api/update/status", asyncRoute(async (req, res) => ok(res, await getUpdateStatus())));
app.post("/api/update/check", asyncRoute(async (req, res) => ok(res, await getUpdateStatus())));

// ─── Chat Stream (v2 SSE endpoint for send + progressive response) ─

app.post("/api/chat/stream", asyncRoute(async (req, res) => {
  const { message, sessionKey } = req.body || {};
  const sk = sessionKey || "main";
  const session = getSession(sk);
  const runId = makeId("run");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  function sendSSE(event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  }

  // Ack
  sendSSE("message-start", { id: runId, runId, sessionKey: sk });

  // Try Gateway proxy
  try {
    const gwRes = await fetch(gatewayUrl + "/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "req", id: makeId("rpc"), method: "chat.send", params: { ...req.body } }),
      signal: AbortSignal.timeout(120000)
    });
    if (gwRes.ok) {
      const data = await gwRes.json();
      const result = data.result || {};
      if (result.error) {
        sendSSE("error", { error: result.error, runId });
      } else {
        sendSSE("done", { runId, sessionKey: sk, ...result });
      }
    } else {
      sendSSE("error", { error: `Gateway ${gwRes.status}`, runId });
    }
  } catch (err) {
    sendSSE("error", { error: err.message, runId });
  }

  res.end();
  sseBroadcast("gateway:notification", { type: "chat-message", sessionKey: sk, runId });
}));

// ─── Runtime Info ──────────────────────────────────────────────────

app.get("/api/runtime/info", (req, res) => {
  ok(res, {
    info: { platform: "browser", version: "0.1.0", nodeVersion: process.version }
  });
});

// ─── Start ─────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  fail(res, err.status || 500, err);
});

app.listen(port, () => {
  console.log(`ClawHouse backend listening on http://127.0.0.1:${port}`);
  console.log(`Chat SSE endpoint: POST http://127.0.0.1:${port}/api/chat/stream`);
  console.log(`Gateway proxy: ${gatewayUrl}`);
});
