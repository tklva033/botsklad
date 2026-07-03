import path from "node:path";
import { loadEnv } from "./utils/env.js";

const rootDir = process.cwd();
loadEnv(rootDir);

const normalizedPublicBaseUrl = resolvePublicBaseUrl(process.env).replace(/\/+$/, "");
const normalizedWebhookPath = normalizeWebhookPath(process.env.TELEGRAM_WEBHOOK_PATH || "/telegram/webhook");
const telegramTransport = normalizeTransport(
  process.env.TELEGRAM_TRANSPORT
    || (String(process.env.TELEGRAM_POLLING_ENABLED || "true").toLowerCase() === "true" ? "polling" : "webhook")
);

export const config = {
  port: Number(process.env.PORT || 3000),
  dataFile: path.resolve(rootDir, process.env.DATA_FILE || "./data/db.json"),
  botToken: process.env.BOT_TOKEN || "",
  telegramApiBase: process.env.TELEGRAM_API_BASE || "https://api.telegram.org",
  databaseUrl: process.env.DATABASE_URL || "",
  dbInitOnStart: String(process.env.DB_INIT_ON_START || "false").toLowerCase() === "true",
  embeddedPostgresEnabled: String(process.env.EMBEDDED_POSTGRES_ENABLED || "true").toLowerCase() === "true",
  embeddedPostgresDir: process.env.EMBEDDED_POSTGRES_DIR
    ? path.resolve(rootDir, process.env.EMBEDDED_POSTGRES_DIR)
    : path.resolve(rootDir, "./data/postgres"),
  telegramTransport,
  telegramPollingEnabled: String(process.env.TELEGRAM_POLLING_ENABLED || "true").toLowerCase() === "true",
  telegramPollingTimeoutSec: Number(process.env.TELEGRAM_POLLING_TIMEOUT_SEC || 25),
  publicBaseUrl: normalizedPublicBaseUrl,
  telegramWebhookPath: normalizedWebhookPath,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
  telegramAdminIds: parseIdList(process.env.TELEGRAM_ADMIN_IDS || ""),
  telegramSupervisorIds: parseIdList(process.env.TELEGRAM_SUPERVISOR_IDS || ""),
  telegramAuditorIds: parseIdList(process.env.TELEGRAM_AUDITOR_IDS || ""),
  telegramKeeperIds: parseIdList(process.env.TELEGRAM_KEEPER_IDS || ""),
  uploadsDir: path.resolve(rootDir, process.env.UPLOADS_DIR || "./uploads"),
  reportsDir: path.resolve(rootDir, process.env.REPORTS_DIR || "./reports"),
  schedulerEnabled: String(process.env.SCHEDULER_ENABLED || "true").toLowerCase() === "true",
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 30000)
};

function normalizeTransport(value) {
  const transport = String(value || "polling").trim().toLowerCase();
  return transport === "webhook" ? "webhook" : "polling";
}

function normalizeWebhookPath(value) {
  const pathValue = String(value || "/telegram/webhook").trim();
  if (!pathValue.startsWith("/")) {
    return `/${pathValue}`;
  }
  return pathValue;
}

function resolvePublicBaseUrl(env) {
  const explicit = String(env.PUBLIC_BASE_URL || "").trim();
  if (explicit) {
    return explicit;
  }

  const renderExternalUrl = String(env.RENDER_EXTERNAL_URL || "").trim();
  if (renderExternalUrl) {
    return renderExternalUrl;
  }

  const railwayPublicDomain = String(env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  if (railwayPublicDomain) {
    return `https://${railwayPublicDomain}`;
  }

  return "";
}

function parseIdList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
