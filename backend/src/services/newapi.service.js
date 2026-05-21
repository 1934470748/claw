import { env, normalizeBaseUrl } from "../config/env.js";

function authHeaders({ apiKey, accessToken, userId, sessionCookie } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = accessToken || apiKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (userId) headers["New-Api-User"] = String(userId);
  if (sessionCookie) headers.Cookie = sessionCookie;
  return headers;
}

async function parseResponse(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const rawMessage = data?.message || data?.error || data?.msg || text || `NewAPI request failed: ${response.status}`;
    const message = typeof rawMessage === "string" ? rawMessage : JSON.stringify(rawMessage);
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export class NewApiService {
  constructor({ baseUrl = env.newapiBaseUrl } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  withBaseUrl(baseUrl) {
    return new NewApiService({ baseUrl: normalizeBaseUrl(baseUrl || this.baseUrl) });
  }

  async request(path, { method = "GET", body, apiKey, accessToken, userId, sessionCookie, timeoutMs = 30000 } = {}) {
    let baseUrl = this.baseUrl;
    let requestPath = path;
    if (baseUrl.endsWith("/v1") && requestPath.startsWith("/v1/")) {
      requestPath = requestPath.slice(3);
    }
    if (baseUrl.endsWith("/v1") && requestPath.startsWith("/api/")) {
      baseUrl = baseUrl.slice(0, -3);
    }
    const response = await fetch(`${baseUrl}${requestPath}`, {
      method,
      headers: authHeaders({ apiKey, accessToken, userId, sessionCookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return parseResponse(response);
  }

  getStatus() {
    return this.request("/api/status");
  }

  getPricing() {
    return this.request("/api/pricing");
  }

  getNotice() {
    return this.request("/api/notice");
  }

  getModels(apiKey) {
    return this.request("/v1/models", { apiKey });
  }

  chatCompletions({ apiKey, model, messages, stream = false, ...rest }) {
    return this.request("/v1/chat/completions", {
      method: "POST",
      apiKey,
      timeoutMs: 120000,
      body: {
        model: model || env.defaultModel,
        messages,
        stream,
        ...rest
      }
    });
  }

  getProfile({ accessToken, userId }) {
    return this.request("/api/user/self", { accessToken, userId });
  }

  registerUser(payload) {
    const turnstile = encodeURIComponent(payload?.turnstile || "");
    return this.request(`/api/user/register?turnstile=${turnstile}`, {
      method: "POST",
      body: payload
    });
  }

  loginUser({ username, password, turnstile = "" }) {
    return this.request(`/api/user/login?turnstile=${encodeURIComponent(turnstile)}`, {
      method: "POST",
      body: { username, password }
    });
  }

  async loginUserWithSession({ username, password, turnstile = "" }) {
    const response = await fetch(`${this.baseUrl}/api/user/login?turnstile=${encodeURIComponent(turnstile)}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(30000)
    });
    const result = await parseResponse(response);
    const setCookie = response.headers.get("set-cookie") || "";
    return {
      result,
      sessionCookie: setCookie.split(";")[0] || ""
    };
  }

  getGroups({ accessToken, userId }) {
    return this.request("/api/user/self/groups", { accessToken, userId });
  }

  getUserModels({ accessToken, userId }) {
    return this.request("/api/user/models", { accessToken, userId });
  }

  getTokens({ accessToken, userId, sessionCookie, page = 1, size = 20 }) {
    return this.request(`/api/token/?p=${encodeURIComponent(page)}&size=${encodeURIComponent(size)}`, { accessToken, userId, sessionCookie });
  }

  createToken({ accessToken, userId, sessionCookie, payload }) {
    return this.request("/api/token/", {
      method: "POST",
      accessToken,
      userId,
      sessionCookie,
      body: payload
    });
  }

  revealTokenKey({ accessToken, userId, sessionCookie, tokenId }) {
    return this.request(`/api/token/${encodeURIComponent(tokenId)}/key`, {
      method: "POST",
      accessToken,
      userId,
      sessionCookie
    });
  }

  getSelfLogs({ accessToken, userId, page = 1, size = 20 }) {
    return this.request(`/api/log/self?p=${encodeURIComponent(page)}&page_size=${encodeURIComponent(size)}`, { accessToken, userId });
  }

  getSelfLogStat({ accessToken, userId }) {
    return this.request("/api/log/self/stat", { accessToken, userId });
  }

  getSelfData({ accessToken, userId }) {
    return this.request("/api/data/self", { accessToken, userId });
  }
}

export const newapi = new NewApiService();
