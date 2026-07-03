import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeedPlan, readLegacyJson } from "../database/migrate-json-to-postgres.js";
import { SessionStore } from "../src/telegram/session-store.js";
import { TelegramBotService } from "../src/telegram/telegram-bot-service.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");

async function main() {
  const schemaSql = await fs.readFile(path.join(rootDir, "database", "schema.sql"), "utf8");
  const requiredTables = [
    "roles",
    "users",
    "warehouses",
    "racks",
    "shelves",
    "cells",
    "categories",
    "suppliers",
    "products",
    "inventory",
    "inventory_history",
    "stock_movements",
    "receipts",
    "issues",
    "issue_requests",
    "revisions",
    "notifications",
    "product_photos",
    "background_jobs"
  ];

  for (const table of requiredTables) {
    if (!schemaSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
      throw new Error(`Schema is missing table: ${table}`);
    }
  }

  const legacyDb = await readLegacyJson();
  const plan = buildSeedPlan(legacyDb);

  if (!plan.products.length || !plan.users.length || !plan.cells.length) {
    throw new Error("Migration plan did not produce the required seed entities");
  }

  const replies = [];
  const bot = new TelegramBotService({
    authService: {
      async loginByPhone() {
        return { id: "u-1", fullName: "Tester", role: "admin", permissions: ["search", "stock", "receipt", "issue", "move", "audit", "reports", "request_create", "request_approve", "request_fulfill"] };
      },
      async findByTelegramId() {
        return { id: "u-1", fullName: "Tester", role: "admin", phone: "+79990000000", permissions: ["search", "stock", "receipt", "issue", "move", "audit", "reports", "request_create", "request_approve", "request_fulfill"] };
      },
      can(user, permission) {
        return Array.isArray(user?.permissions) && user.permissions.includes(permission);
      },
      async listUsers() {
        return [{ id: "u-1", fullName: "Tester" }];
      }
    },
    inventoryService: {
      async searchProducts() {
        return [
          {
            product: {
              id: "p-1",
              name: "Bolt M12x40",
              sku: "34567",
              qrCode: "QR-34567",
              barcode: "34567",
              category: "Fasteners",
              supplier: "Main Supplier",
              unit: "pcs",
              minStock: 50,
              photoUrl: ""
            },
            totalQuantity: 154,
            locations: [
              {
                locationId: "loc-1",
                code: "A-03/2/B",
                warehouse: "Main",
                rack: "A-03",
                shelf: "2",
                cell: "B",
                quantity: 154
              }
            ],
            lastReceiptAt: "2026-06-12T09:00:00.000Z",
            lastIssueAt: "2026-06-15T10:30:00.000Z",
            history: [
              { createdAt: "2026-06-12T09:00:00.000Z", type: "receipt", quantity: 250, actorName: "Tester" }
            ]
          }
        ];
      },
      async listProducts() {
        return [{ id: "p-1", name: "Bolt M12x40", sku: "34567" }];
      },
      async listCells() {
        return [{ id: "loc-1", fullCode: "A-03/2/B" }];
      },
      async getLowStock() {
        return [];
      },
      async getStats() {
        return { totalProducts: 1, totalQuantity: 154, receiptsToday: 0, issuesToday: 0, mismatches: 0 };
      },
      async getProductById() {
        return (await this.searchProducts())[0];
      },
      async receipt() {
        return { product: { name: "Bolt M12x40" } };
      },
      async issue() {
        return { product: { name: "Bolt M12x40" } };
      },
      async move() {
        return { product: { name: "Bolt M12x40" } };
      },
      async audit() {
        return { audit: { diffQty: 0 } };
      },
      async listWarehouses() {
        return [{ id: "wh-1", name: "Main Warehouse", code: "MAIN" }];
      }
    },
    requestService: {
      async listRequests(filters) {
        return filters?.status === "pending"
          ? [{
              id: "req-1",
              productId: "p-1",
              productName: "Bolt M12x40",
              productSku: "34567",
              requestedQty: 40,
              preferredCellCode: "A-03/2/B",
              requestedByName: "Tester",
              status: "pending",
              priority: "normal",
              comment: "",
              createdAt: "2026-06-18T09:00:00.000Z"
            }]
          : [];
      },
      async getRequestById() {
        return {
          id: "req-1",
          productId: "p-1",
          productName: "Bolt M12x40",
          productSku: "34567",
          unit: "pcs",
          requestedQty: 40,
          preferredCellCode: "A-03/2/B",
          requestedByName: "Tester",
          status: "pending",
          priority: "normal",
          comment: "",
          createdAt: "2026-06-18T09:00:00.000Z"
        };
      },
      async approveRequest() {
        return { id: "req-1" };
      }
    },
    reportService: {
      async getAnalytics() {
        return {
          summary: { receipts: 10, issues: 5 },
          topProducts: [{ name: "Bolt M12x40", sku: "34567", total: 100 }],
          userActivity: [{ fullName: "Tester", actions: 3 }],
          lowStock: [],
          movementTimeline: []
        };
      }
    },
    backgroundJobService: {
      async enqueue() {
        return { id: "job-1" };
      }
    },
    telegramGateway: {
      async sendMessage(chatId, text, extra) {
        replies.push({ chatId, text, extra });
      },
      async answerCallbackQuery() {}
    },
    sessionStore: new SessionStore()
  });

  await bot.processUpdate({
    message: {
      chat: { id: 1001 },
      from: { id: 7001, username: "tester" },
      text: "/start"
    }
  });

  await bot.processUpdate({
    callback_query: {
      id: "cb-1",
      data: "menu:main",
      from: { id: 7001, username: "tester" },
      message: { chat: { id: 1001 } }
    }
  });

  await bot.processUpdate({
    callback_query: {
      id: "cb-2",
      data: "menu:issue",
      from: { id: 7001, username: "tester" },
      message: { chat: { id: 1001 } }
    }
  });

  await bot.processUpdate({
    callback_query: {
      id: "cb-3",
      data: "menu:reports",
      from: { id: 7001, username: "tester" },
      message: { chat: { id: 1001 } }
    }
  });

  if (!replies.length) {
    throw new Error("Telegram bot smoke test produced no replies");
  }

  const adminHtmlSource = await fs.readFile(path.join(rootDir, "src", "controllers", "admin-controller.js"), "utf8");
  if (!adminHtmlSource.includes("Bot Sklad Admin")) {
    throw new Error("Admin panel markup was not found");
  }

  console.log("Check passed.");
}

await main();
