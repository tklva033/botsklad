import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase } from "./init-db.js";
import { createDbPool, closeDbPool, withTransaction } from "../src/database/postgres.js";
import { createId } from "../src/utils/ids.js";
import { parseLegacyLocation } from "../src/utils/location.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");

export async function readLegacyJson(filePath = path.join(rootDir, "data", "db.json")) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function buildSeedPlan(db) {
  const roles = [
    {
      id: "role-admin",
      code: "admin",
      name: "Администратор",
      permissions: ["search", "stock", "receipt", "issue", "move", "audit", "reports", "manage", "settings"]
    },
    {
      id: "role-supervisor",
      code: "supervisor",
      name: "Руководитель",
      permissions: ["search", "stock", "reports"]
    },
    {
      id: "role-keeper",
      code: "keeper",
      name: "Кладовщик",
      permissions: ["search", "stock", "receipt", "issue", "move", "audit"]
    },
    {
      id: "role-auditor",
      code: "auditor",
      name: "Ревизор",
      permissions: ["search", "stock", "audit", "reports"]
    }
  ];

  for (const role of roles) {
    if (role.code === "admin") {
      role.name = "Администратор";
      role.permissions = ["search", "stock", "receipt", "issue", "move", "audit", "reports", "manage", "settings", "request_create", "request_approve", "request_fulfill", "admin_panel", "import_export", "upload_media"];
    }

    if (role.code === "supervisor") {
      role.name = "Руководитель";
      role.permissions = ["search", "stock", "reports", "request_approve", "admin_panel"];
    }

    if (role.code === "keeper") {
      role.name = "Кладовщик";
      role.permissions = ["search", "stock", "receipt", "issue", "move", "audit", "request_create", "request_fulfill", "upload_media"];
    }

    if (role.code === "auditor") {
      role.name = "Ревизор";
      role.permissions = ["search", "stock", "audit", "reports"];
    }
  }

  const categories = new Map();
  const suppliers = new Map();
  const warehouses = new Map();
  const racks = new Map();
  const shelves = new Map();
  const cells = new Map();

  for (const location of db.locations || []) {
    const chain = parseLegacyLocation(location);
    warehouses.set(chain.warehouse.id, chain.warehouse);
    racks.set(chain.rack.id, {
      ...chain.rack,
      warehouseId: chain.warehouse.id
    });
    shelves.set(chain.shelf.id, {
      ...chain.shelf,
      rackId: chain.rack.id
    });
    cells.set(location.id, {
      id: location.id,
      shelfId: chain.shelf.id,
      code: chain.cell.code,
      barcode: chain.cell.barcode,
      fullCode: location.code || chain.cell.fullCode
    });
  }

  const products = (db.products || []).map((product) => {
    const categoryId = `cat-${slug(product.category || "general")}`;
    const supplierId = `sup-${slug(product.supplier || "main-supplier")}`;
    categories.set(categoryId, {
      id: categoryId,
      name: product.category || "General"
    });
    suppliers.set(supplierId, {
      id: supplierId,
      name: product.supplier || "Main Supplier"
    });

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      qrCode: product.qrCode || null,
      barcode: product.barcode || product.sku,
      categoryId,
      supplierId,
      unit: product.unit || "pcs",
      minStock: Number(product.minStock || 0),
      photoUrl: product.photoUrl || "",
      isActive: product.isActive !== false
    };
  });

  const users = (db.users || []).map((user) => ({
    id: user.id,
    phone: user.phone,
    fullName: user.fullName,
    roleId: mapLegacyRoleId(user.role),
    telegramId: user.telegramId || null,
    telegramUsername: user.telegramUsername || null,
    isActive: user.isActive !== false
  }));

  const inventory = (db.inventory || []).map((row) => ({
    id: row.id,
    productId: row.productId,
    cellId: row.locationId,
    quantity: Number(row.quantity || 0)
  }));

  const movementRows = [];
  const receiptRows = [];
  const issueRows = [];
  const revisionRows = [];
  const inventoryHistory = [];
  const notifications = [];
  const userActionLogs = [];
  const ledger = new Map();

  const sortedOperations = [...(db.operations || [])].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  );

  for (const operation of sortedOperations) {
    const createdAt = operation.createdAt || new Date().toISOString();
    const movementId = operation.id;
    const fromCellId = operation.fromLocationId || null;
    const toCellId = operation.toLocationId || null;
    const qty = Number(operation.quantity || 0);

    movementRows.push({
      id: movementId,
      type: operation.type,
      productId: operation.productId,
      quantity: qty,
      fromCellId,
      toCellId,
      performedBy: operation.performedBy || null,
      comment: operation.comment || "",
      metadata: operation.meta || {},
      createdAt
    });

    if (operation.type === "receipt") {
      receiptRows.push({
        id: createId("receipt"),
        movementId,
        supplierId: null,
        warehouseId: toCellId ? warehouseIdByCell(db.locations, toCellId) : null,
        documentNumber: null,
        receivedAt: createdAt,
        createdAt
      });
      applyHistory(ledger, inventoryHistory, operation.productId, toCellId, qty, operation.performedBy, createdAt, movementId);
    }

    if (operation.type === "issue") {
      issueRows.push({
        id: createId("issue"),
        movementId,
        issuedTo: operation.meta?.issuedTo || "",
        requestNumber: null,
        issuedAt: createdAt,
        createdAt
      });
      applyHistory(ledger, inventoryHistory, operation.productId, fromCellId, -qty, operation.performedBy, createdAt, movementId);
    }

    if (operation.type === "move") {
      applyHistory(ledger, inventoryHistory, operation.productId, fromCellId, -qty, operation.performedBy, createdAt, movementId);
      applyHistory(ledger, inventoryHistory, operation.productId, toCellId, qty, operation.performedBy, createdAt, movementId);
    }

    if (operation.type === "audit") {
      const expectedQty = Number(operation.meta?.expectedQty || 0);
      const actualQty = Number(operation.meta?.actualQty || expectedQty);
      const diffQty = Number(operation.meta?.diffQty || actualQty - expectedQty);
      revisionRows.push({
        id: operation.id.startsWith("audit") ? operation.id : createId("rev"),
        movementId,
        cellId: toCellId || fromCellId,
        expectedQty,
        actualQty,
        diffQty,
        status: diffQty === 0 ? "match" : "mismatch",
        checkedBy: operation.performedBy || null,
        createdAt
      });
      setAbsoluteHistory(ledger, inventoryHistory, operation.productId, toCellId || fromCellId, expectedQty, actualQty, operation.performedBy, createdAt, movementId);
    }

    userActionLogs.push({
      id: createId("ulog"),
      userId: operation.performedBy || null,
      actionType: operation.type,
      entityType: "stock_movement",
      entityId: movementId,
      oldValue: null,
      newValue: {
        productId: operation.productId,
        quantity: qty,
        fromCellId,
        toCellId
      },
      createdAt
    });
  }

  for (const item of db.notifications || []) {
    notifications.push({
      id: item.id,
      type: item.type,
      severity: item.type === "low_stock" ? "warning" : "info",
      productId: item.productId || null,
      warehouseId: null,
      cellId: item.locationId || null,
      message: item.message,
      payload: {},
      isRead: false,
      createdAt: item.createdAt || new Date().toISOString()
    });
  }

  return {
    roles,
    users,
    warehouses: [...warehouses.values()],
    racks: [...racks.values()],
    shelves: [...shelves.values()],
    cells: [...cells.values()],
    categories: [...categories.values()],
    suppliers: [...suppliers.values()],
    products,
    inventory,
    stockMovements: movementRows,
    inventoryHistory,
    receipts: receiptRows,
    issues: issueRows,
    revisions: revisionRows,
    notifications,
    userActionLogs
  };
}

export async function migrateJsonToPostgres() {
  const jsonDb = await readLegacyJson();
  const plan = buildSeedPlan(jsonDb);
  await initDatabase();
  const pool = createDbPool();

  try {
    await withTransaction(pool, async (db) => {
      await db.query("DELETE FROM user_action_logs");
      await db.query("DELETE FROM notifications");
      await db.query("DELETE FROM revisions");
      await db.query("DELETE FROM issues");
      await db.query("DELETE FROM receipts");
      await db.query("DELETE FROM inventory_history");
      await db.query("DELETE FROM stock_movements");
      await db.query("DELETE FROM inventory");
      await db.query("DELETE FROM products");
      await db.query("DELETE FROM suppliers");
      await db.query("DELETE FROM categories");
      await db.query("DELETE FROM cells");
      await db.query("DELETE FROM shelves");
      await db.query("DELETE FROM racks");
      await db.query("DELETE FROM warehouses");
      await db.query("DELETE FROM users");

      for (const role of plan.roles) {
        await db.query(
          `
            INSERT INTO roles (id, code, name, permissions)
            VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (id) DO UPDATE
            SET code = EXCLUDED.code,
                name = EXCLUDED.name,
                permissions = EXCLUDED.permissions
          `,
          [role.id, role.code, role.name, JSON.stringify(role.permissions)]
        );
      }

      for (const warehouse of plan.warehouses) {
        await db.query(
          `INSERT INTO warehouses (id, name, code) VALUES ($1, $2, $3)`,
          [warehouse.id, warehouse.name, warehouse.code]
        );
      }

      for (const rack of plan.racks) {
        await db.query(
          `INSERT INTO racks (id, warehouse_id, code, name) VALUES ($1, $2, $3, $4)`,
          [rack.id, rack.warehouseId, rack.code, rack.name]
        );
      }

      for (const shelf of plan.shelves) {
        await db.query(
          `INSERT INTO shelves (id, rack_id, code, name) VALUES ($1, $2, $3, $4)`,
          [shelf.id, shelf.rackId, shelf.code, shelf.name]
        );
      }

      for (const cell of plan.cells) {
        await db.query(
          `INSERT INTO cells (id, shelf_id, code, barcode, full_code) VALUES ($1, $2, $3, $4, $5)`,
          [cell.id, cell.shelfId, cell.code, cell.barcode, cell.fullCode]
        );
      }

      for (const category of plan.categories) {
        await db.query(
          `INSERT INTO categories (id, name) VALUES ($1, $2)`,
          [category.id, category.name]
        );
      }

      for (const supplier of plan.suppliers) {
        await db.query(
          `INSERT INTO suppliers (id, name) VALUES ($1, $2)`,
          [supplier.id, supplier.name]
        );
      }

      for (const user of plan.users) {
        await db.query(
          `
            INSERT INTO users (id, phone, full_name, role_id, telegram_id, telegram_username, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [user.id, user.phone, user.fullName, user.roleId, user.telegramId, user.telegramUsername, user.isActive]
        );
      }

      for (const product of plan.products) {
        await db.query(
          `
            INSERT INTO products (
              id, name, sku, qr_code, barcode, category_id, supplier_id, unit, min_stock, photo_url, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            product.id,
            product.name,
            product.sku,
            product.qrCode,
            product.barcode,
            product.categoryId,
            product.supplierId,
            product.unit,
            product.minStock,
            product.photoUrl,
            product.isActive
          ]
        );
      }

      for (const row of plan.inventory) {
        await db.query(
          `INSERT INTO inventory (id, product_id, cell_id, quantity) VALUES ($1, $2, $3, $4)`,
          [row.id, row.productId, row.cellId, row.quantity]
        );
      }

      for (const movement of plan.stockMovements) {
        await db.query(
          `
            INSERT INTO stock_movements (
              id, movement_type, product_id, quantity, from_cell_id, to_cell_id, performed_by, comment, metadata, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
          `,
          [
            movement.id,
            movement.type,
            movement.productId,
            movement.quantity,
            movement.fromCellId,
            movement.toCellId,
            movement.performedBy,
            movement.comment,
            JSON.stringify(movement.metadata || {}),
            movement.createdAt
          ]
        );
      }

      for (const row of plan.inventoryHistory) {
        await db.query(
          `
            INSERT INTO inventory_history (
              id, product_id, cell_id, movement_id, previous_quantity, new_quantity, change_quantity, changed_by, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            row.id,
            row.productId,
            row.cellId,
            row.movementId,
            row.previousQuantity,
            row.newQuantity,
            row.changeQuantity,
            row.changedBy,
            row.createdAt
          ]
        );
      }

      for (const row of plan.receipts) {
        await db.query(
          `
            INSERT INTO receipts (id, movement_id, supplier_id, warehouse_id, document_number, received_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [row.id, row.movementId, row.supplierId, row.warehouseId, row.documentNumber, row.receivedAt, row.createdAt]
        );
      }

      for (const row of plan.issues) {
        await db.query(
          `
            INSERT INTO issues (id, movement_id, issued_to, request_number, issued_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [row.id, row.movementId, row.issuedTo, row.requestNumber, row.issuedAt, row.createdAt]
        );
      }

      for (const row of plan.revisions) {
        await db.query(
          `
            INSERT INTO revisions (id, movement_id, cell_id, expected_qty, actual_qty, diff_qty, status, checked_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [row.id, row.movementId, row.cellId, row.expectedQty, row.actualQty, row.diffQty, row.status, row.checkedBy, row.createdAt]
        );
      }

      for (const row of plan.notifications) {
        await db.query(
          `
            INSERT INTO notifications (id, type, severity, product_id, warehouse_id, cell_id, message, payload, is_read, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
          `,
          [row.id, row.type, row.severity, row.productId, row.warehouseId, row.cellId, row.message, JSON.stringify(row.payload || {}), row.isRead, row.createdAt]
        );
      }

      for (const row of plan.userActionLogs) {
        await db.query(
          `
            INSERT INTO user_action_logs (id, user_id, action_type, entity_type, entity_id, old_value, new_value, created_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
          `,
          [
            row.id,
            row.userId,
            row.actionType,
            row.entityType,
            row.entityId,
            row.oldValue ? JSON.stringify(row.oldValue) : null,
            row.newValue ? JSON.stringify(row.newValue) : null,
            row.createdAt
          ]
        );
      }
    });

    console.log("Legacy JSON data migrated to PostgreSQL successfully.");
  } finally {
    await closeDbPool(pool);
  }
}

function mapLegacyRoleId(role) {
  const normalized = String(role || "").trim().toLowerCase();
  const map = {
    admin: "role-admin",
    keeper: "role-keeper",
    auditor: "role-auditor",
    supervisor: "role-supervisor",
    manager: "role-supervisor"
  };

  return map[normalized] || "role-keeper";
}

function warehouseIdByCell(locations, locationId) {
  const location = (locations || []).find((item) => item.id === locationId);
  if (!location) {
    return null;
  }
  return parseLegacyLocation(location).warehouse.id;
}

function applyHistory(ledger, historyRows, productId, cellId, delta, changedBy, createdAt, movementId) {
  if (!cellId) {
    return;
  }

  const key = `${productId}:${cellId}`;
  const previousQuantity = Number(ledger.get(key) || 0);
  const newQuantity = previousQuantity + delta;
  ledger.set(key, newQuantity);

  historyRows.push({
    id: createId("hist"),
    productId,
    cellId,
    movementId,
    previousQuantity,
    newQuantity,
    changeQuantity: delta,
    changedBy: changedBy || null,
    createdAt
  });
}

function setAbsoluteHistory(ledger, historyRows, productId, cellId, previousQuantity, newQuantity, changedBy, createdAt, movementId) {
  if (!cellId) {
    return;
  }

  const key = `${productId}:${cellId}`;
  ledger.set(key, newQuantity);

  historyRows.push({
    id: createId("hist"),
    productId,
    cellId,
    movementId,
    previousQuantity,
    newQuantity,
    changeQuantity: newQuantity - previousQuantity,
    changedBy: changedBy || null,
    createdAt
  });
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrateJsonToPostgres();
}
