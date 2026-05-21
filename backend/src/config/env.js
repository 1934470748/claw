import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnv(envPath);

export const env = {
  port: Number(process.env.PORT || 3001),
  gatewayPort: Number(process.env.GATEWAY_PORT || 18789),
  newapiBaseUrl: process.env.NEWAPI_BASE_URL || "https://api.ovov.fun",
  defaultModel: process.env.NEWAPI_DEFAULT_MODEL || "gpt-4.1-nano-2025-04-14",
  newapiAdminAccessToken: process.env.NEWAPI_ADMIN_ACCESS_TOKEN || "",
  newapiAdminUserId: process.env.NEWAPI_ADMIN_USER_ID || "",
  issueKeyDefaultQuota: Number(process.env.NEWAPI_ISSUE_KEY_DEFAULT_QUOTA || 0)
};

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || env.newapiBaseUrl).replace(/\/+$/, "");
}
