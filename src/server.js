import http from "node:http";
import { fileURLToPath } from "node:url";
import { initDatabase } from "../database/init-db.js";
import { ensureLegacySeedData } from "../database/migrate-json-to-postgres.js";
import { config } from "./config.js";
import { AdminController } from "./controllers/admin-controller.js";
import { AuthController } from "./controllers/auth-controller.js";
import { InventoryController } from "./controllers/inventory-controller.js";
import { MediaController } from "./controllers/media-controller.js";
import { ReportController } from "./controllers/report-controller.js";
import { RequestController } from "./controllers/request-controller.js";
import { TelegramController } from "./controllers/telegram-controller.js";
import { ensureEmbeddedPostgres, stopEmbeddedPostgres } from "./database/embedded-postgres.js";
import { createDbPool, closeDbPool } from "./database/postgres.js";
import { AuditLogRepository } from "./repositories/audit-log-repository.js";
import { AuthRepository } from "./repositories/auth-repository.js";
import { CatalogRepository } from "./repositories/catalog-repository.js";
import { InventoryRepository } from "./repositories/inventory-repository.js";
import { JobRepository } from "./repositories/job-repository.js";
import { MediaRepository } from "./repositories/media-repository.js";
import { NotificationRepository } from "./repositories/notification-repository.js";
import { ReportRepository } from "./repositories/report-repository.js";
import { RequestRepository } from "./repositories/request-repository.js";
import { createRouter } from "./router.js";
import { AuthService } from "./services/auth-service.js";
import { BackgroundJobService } from "./services/background-job-service.js";
import { ImportExportService } from "./services/import-export-service.js";
import { InventoryService } from "./services/inventory-service.js";
import { MediaService } from "./services/media-service.js";
import { ReportService } from "./services/report-service.js";
import { RequestService } from "./services/request-service.js";
import { TelegramBotService } from "./services/telegram-bot-service.js";
import { TelegramGateway } from "./services/telegram-gateway.js";
import { SessionStore } from "./telegram/session-store.js";
import { TelegramPollingService } from "./telegram/telegram-polling-service.js";
import { TelegramWebhookService } from "./telegram/telegram-webhook-service.js";

export async function buildApp() {
  await ensureEmbeddedPostgres();

  if (config.dbInitOnStart) {
    await initDatabase();
  }

  const pool = createDbPool();

  const seedResult = await ensureLegacySeedData(pool);
  if (seedResult.seeded) {
    console.log(`Seeded ${seedResult.productCount} products from bundled legacy data.`);
  }

  const authRepository = new AuthRepository(pool);
  const catalogRepository = new CatalogRepository(pool);
  const inventoryRepository = new InventoryRepository(pool);
  const notificationRepository = new NotificationRepository(pool);
  const auditLogRepository = new AuditLogRepository(pool);
  const requestRepository = new RequestRepository(pool);
  const mediaRepository = new MediaRepository(pool);
  const jobRepository = new JobRepository(pool);
  const reportRepository = new ReportRepository(pool);

  const authService = new AuthService({
    authRepository,
    auditLogRepository
  });
  const inventoryService = new InventoryService({
    pool,
    authRepository,
    catalogRepository,
    inventoryRepository,
    notificationRepository,
    auditLogRepository
  });
  const requestService = new RequestService({
    pool,
    authService,
    requestRepository,
    catalogRepository,
    inventoryService,
    notificationRepository,
    auditLogRepository
  });
  const mediaService = new MediaService({
    uploadsDir: config.uploadsDir,
    mediaRepository,
    auditLogRepository
  });
  const reportService = new ReportService({
    reportRepository
  });
  const importExportService = new ImportExportService({
    pool,
    auditLogRepository
  });
  const backgroundJobService = new BackgroundJobService({
    pool,
    jobRepository,
    notificationRepository,
    reportRepository,
    reportService,
    reportsDir: config.reportsDir,
    intervalMs: config.schedulerIntervalMs
  });
  const telegramGateway = new TelegramGateway({
    botToken: config.botToken,
    telegramApiBase: config.telegramApiBase
  });
  const sessionStore = new SessionStore();
  const telegramBotService = new TelegramBotService({
    authService,
    inventoryService,
    requestService,
    reportService,
    backgroundJobService,
    mediaService,
    importExportService,
    telegramGateway,
    sessionStore
  });
  const telegramPollingService = new TelegramPollingService({
    telegramGateway,
    telegramBotService,
    timeoutSec: config.telegramPollingTimeoutSec
  });
  const telegramWebhookService = new TelegramWebhookService({
    telegramGateway,
    publicBaseUrl: config.publicBaseUrl,
    webhookPath: config.telegramWebhookPath,
    secretToken: config.telegramWebhookSecret
  });

  const authController = new AuthController(authService);
  const inventoryController = new InventoryController(inventoryService);
  const requestController = new RequestController(requestService);
  const reportController = new ReportController({
    reportService,
    importExportService,
    backgroundJobService
  });
  const mediaController = new MediaController({
    mediaService,
    uploadsDir: config.uploadsDir,
    reportsDir: config.reportsDir
  });
  const adminController = new AdminController({
    reportService,
    requestService,
    inventoryService,
    authService,
    importExportService,
    mediaService,
    backgroundJobService
  });
  const telegramController = new TelegramController(telegramBotService, {
    webhookSecret: config.telegramWebhookSecret
  });

  const router = createRouter({
    authController,
    inventoryController,
    telegramController,
    requestController,
    reportController,
    mediaController,
    adminController,
    telegramWebhookPath: config.telegramWebhookPath
  });

  const server = http.createServer(router);

  if (config.schedulerEnabled) {
    backgroundJobService.start();
  }

  if (config.telegramTransport === "polling" && config.telegramPollingEnabled) {
    try {
      await telegramPollingService.start();
    } catch (error) {
      console.error(
        "Telegram polling disabled:",
        error instanceof Error ? error.message : error
      );
    }
  }

  if (config.telegramTransport === "webhook") {
    try {
      await telegramWebhookService.start();
    } catch (error) {
      console.error(
        "Telegram webhook setup failed:",
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  return {
    server,
    services: {
      pool,
      authService,
      inventoryService,
      telegramBotService,
      requestService,
      reportService,
      importExportService,
      mediaService,
      backgroundJobService,
      telegramPollingService,
      telegramWebhookService
    }
  };
}

export async function startServer(port = config.port) {
  const { server, services } = await buildApp();
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Bot Sklad server listening on http://localhost:${port}`);
      resolve({ server, services, port });
    });
  });
}

export async function stopServer(app) {
  await new Promise((resolve, reject) => {
    app.server.close((error) => (error ? reject(error) : resolve()));
  });

  if (app.services?.backgroundJobService) {
    app.services.backgroundJobService.stop();
  }

  if (app.services?.telegramPollingService) {
    await app.services.telegramPollingService.stop();
  }

  if (app.services?.telegramWebhookService) {
    await app.services.telegramWebhookService.stop();
  }

  if (app.services?.pool) {
    await closeDbPool(app.services.pool);
  }

  await stopEmbeddedPostgres();
}

const entryFile = fileURLToPath(import.meta.url);
if (process.argv[1] && entryFile === process.argv[1]) {
  await startServer();
}
