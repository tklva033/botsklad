import { withTransaction } from "../database/postgres.js";
import { HttpError } from "../middlewares/http-error.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/dates.js";

export class InventoryService {
  constructor({
    pool,
    authRepository,
    catalogRepository,
    inventoryRepository,
    notificationRepository,
    auditLogRepository
  }) {
    this.pool = pool;
    this.authRepository = authRepository;
    this.catalogRepository = catalogRepository;
    this.inventoryRepository = inventoryRepository;
    this.notificationRepository = notificationRepository;
    this.auditLogRepository = auditLogRepository;
  }

  async getStats() {
    return this.inventoryRepository.getStats();
  }

  async searchProducts(query) {
    const products = await this.catalogRepository.searchProducts(query);
    const cards = await Promise.all(products.map((item) => this.getProductById(item.id)));
    return cards;
  }

  async listProducts(limit = 20, offset = 0) {
    return this.catalogRepository.listProducts(limit, offset);
  }

  async listCells() {
    return this.catalogRepository.listCells();
  }

  async listWarehouses() {
    return this.catalogRepository.listWarehouses();
  }

  async getProductById(productId) {
    const card = await this.catalogRepository.getProductCard(productId);
    if (!card) {
      throw new HttpError(404, "Product not found");
    }

    const history = await this.catalogRepository.getHistory(productId, 20);
    const totalQuantity = card.inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

    return {
      product: {
        ...card.product,
        minStock: Number(card.product.minStock || 0)
      },
      totalQuantity,
      locations: card.inventory.map((item) => ({
        locationId: item.cellId,
        code: item.fullCode,
        warehouse: item.warehouse,
        rack: item.rack,
        shelf: item.shelf,
        cell: item.cell,
        quantity: Number(item.quantity || 0)
      })),
      lastReceiptAt: card.lastReceiptAt,
      lastIssueAt: card.lastIssueAt,
      history
    };
  }

  async getHistory(productId) {
    return this.catalogRepository.getHistory(productId, 50);
  }

  async getLowStock() {
    const lowStock = await this.inventoryRepository.getLowStock();
    return lowStock.map((item) => ({
      product: {
        id: item.id,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        minStock: item.minStock
      },
      totalQuantity: item.totalQuantity
    }));
  }

  async receipt(payload) {
    return withTransaction(this.pool, async (db) => {
      const actor = await this.requireUser(payload.actorId);
      const product = await this.requireProduct(payload.productId);
      const cell = await this.requireCellById(payload.locationId, db);
      const quantity = this.requirePositiveQuantity(payload.quantity);
      const inventoryRow =
        (await this.inventoryRepository.getInventoryRowForUpdate(product.id, cell.id, db)) ||
        (await this.inventoryRepository.createInventoryRow(product.id, cell.id, db));

      const previousQuantity = Number(inventoryRow.quantity || 0);
      const newQuantity = previousQuantity + quantity;
      await this.inventoryRepository.updateInventoryQuantity(inventoryRow.id, newQuantity, db);

      const createdAt = nowIso();
      const movement = {
        id: createId("move"),
        type: "receipt",
        productId: product.id,
        quantity,
        fromCellId: null,
        toCellId: cell.id,
        performedBy: actor.id,
        comment: payload.comment || "",
        metadata: {
          warehouseId: cell.warehouseId
        },
        createdAt
      };

      await this.inventoryRepository.insertMovement(movement, db);
      await this.inventoryRepository.insertHistory(
        {
          id: createId("hist"),
          productId: product.id,
          cellId: cell.id,
          movementId: movement.id,
          previousQuantity,
          newQuantity,
          changeQuantity: quantity,
          changedBy: actor.id,
          createdAt
        },
        db
      );

      await this.inventoryRepository.insertReceipt(
        {
          id: createId("receipt"),
          movementId: movement.id,
          supplierId: null,
          warehouseId: cell.warehouseId,
          receivedAt: createdAt,
          createdAt
        },
        db
      );

      await this.auditLogRepository.log(
        {
          id: createId("ulog"),
          userId: actor.id,
          actionType: "receipt",
          entityType: "inventory",
          entityId: inventoryRow.id,
          oldValue: { quantity: previousQuantity },
          newValue: { quantity: newQuantity, productId: product.id, cellId: cell.id },
          createdAt
        },
        db
      );

      await this.notificationRepository.create(
        {
          id: createId("notif"),
          type: "new_receipt",
          severity: "info",
          productId: product.id,
          warehouseId: cell.warehouseId,
          cellId: cell.id,
          message: `Новое поступление: ${product.name}, +${quantity} ${product.unit}`,
          payload: {
            quantity,
            productId: product.id,
            cellId: cell.id
          },
          createdAt
        },
        db
      );

      await this.createLowStockNotificationIfNeeded(product.id, db);
      return this.getOperationResult(product.id, movement);
    });
  }

  async issue(payload) {
    return withTransaction(this.pool, async (db) => {
      const actor = await this.requireUser(payload.actorId);
      const product = await this.requireProduct(payload.productId);
      const cell = await this.requireCellById(payload.locationId, db);
      const quantity = this.requirePositiveQuantity(payload.quantity);
      const inventoryRow = await this.inventoryRepository.getInventoryRowForUpdate(
        product.id,
        cell.id,
        db
      );

      if (!inventoryRow) {
        await this.notificationRepository.create(
          {
            id: createId("notif"),
            type: "negative_stock_blocked",
            severity: "warning",
            productId: product.id,
            warehouseId: cell.warehouseId,
            cellId: cell.id,
            message: `Запрещена выдача: нет остатка для ${product.name}`,
            payload: {
              requestedQuantity: quantity
            },
            createdAt: nowIso()
          },
          db
        );
        throw new HttpError(400, "Inventory row not found");
      }

      const previousQuantity = Number(inventoryRow.quantity || 0);
      const newQuantity = previousQuantity - quantity;
      if (newQuantity < 0) {
        await this.notificationRepository.create(
          {
            id: createId("notif"),
            type: "negative_stock_blocked",
            severity: "warning",
            productId: product.id,
            warehouseId: cell.warehouseId,
            cellId: cell.id,
            message: `Запрещен отрицательный остаток по ${product.name}`,
            payload: {
              previousQuantity,
              requestedQuantity: quantity
            },
            createdAt: nowIso()
          },
          db
        );
        throw new HttpError(400, "Not enough stock at selected location");
      }

      await this.inventoryRepository.updateInventoryQuantity(inventoryRow.id, newQuantity, db);
      const createdAt = nowIso();
      const movement = {
        id: createId("move"),
        type: "issue",
        productId: product.id,
        quantity,
        fromCellId: cell.id,
        toCellId: null,
        performedBy: actor.id,
        comment: payload.comment || "",
        metadata: {
          issuedTo: payload.issuedTo || ""
        },
        createdAt
      };

      await this.inventoryRepository.insertMovement(movement, db);
      await this.inventoryRepository.insertHistory(
        {
          id: createId("hist"),
          productId: product.id,
          cellId: cell.id,
          movementId: movement.id,
          previousQuantity,
          newQuantity,
          changeQuantity: -quantity,
          changedBy: actor.id,
          createdAt
        },
        db
      );

      await this.inventoryRepository.insertIssue(
        {
          id: createId("issue"),
          movementId: movement.id,
          issuedTo: payload.issuedTo || "",
          issuedAt: createdAt,
          createdAt
        },
        db
      );

      await this.auditLogRepository.log(
        {
          id: createId("ulog"),
          userId: actor.id,
          actionType: "issue",
          entityType: "inventory",
          entityId: inventoryRow.id,
          oldValue: { quantity: previousQuantity },
          newValue: { quantity: newQuantity, productId: product.id, cellId: cell.id },
          createdAt
        },
        db
      );

      await this.createLowStockNotificationIfNeeded(product.id, db);
      return this.getOperationResult(product.id, movement);
    });
  }

  async move(payload) {
    return withTransaction(this.pool, async (db) => {
      const actor = await this.requireUser(payload.actorId);
      const product = await this.requireProduct(payload.productId);
      const fromCell = await this.requireCellById(payload.fromLocationId, db);
      const toCell = await this.requireCellById(payload.toLocationId, db);
      const quantity = this.requirePositiveQuantity(payload.quantity);

      const fromInventory = await this.inventoryRepository.getInventoryRowForUpdate(
        product.id,
        fromCell.id,
        db
      );

      if (!fromInventory) {
        throw new HttpError(400, "Inventory row not found");
      }

      const toInventory =
        (await this.inventoryRepository.getInventoryRowForUpdate(product.id, toCell.id, db)) ||
        (await this.inventoryRepository.createInventoryRow(product.id, toCell.id, db));

      const fromPrevious = Number(fromInventory.quantity || 0);
      const toPrevious = Number(toInventory.quantity || 0);
      const fromNew = fromPrevious - quantity;
      const toNew = toPrevious + quantity;

      if (fromNew < 0) {
        await this.notificationRepository.create(
          {
            id: createId("notif"),
            type: "negative_stock_blocked",
            severity: "warning",
            productId: product.id,
            warehouseId: fromCell.warehouseId,
            cellId: fromCell.id,
            message: `Запрещено перемещение: недостаточно остатка по ${product.name}`,
            payload: {
              previousQuantity: fromPrevious,
              requestedQuantity: quantity
            },
            createdAt: nowIso()
          },
          db
        );
        throw new HttpError(400, "Not enough stock at source location");
      }

      await this.inventoryRepository.updateInventoryQuantity(fromInventory.id, fromNew, db);
      await this.inventoryRepository.updateInventoryQuantity(toInventory.id, toNew, db);

      const createdAt = nowIso();
      const movement = {
        id: createId("move"),
        type: "move",
        productId: product.id,
        quantity,
        fromCellId: fromCell.id,
        toCellId: toCell.id,
        performedBy: actor.id,
        comment: payload.comment || "",
        metadata: {},
        createdAt
      };

      await this.inventoryRepository.insertMovement(movement, db);
      await this.inventoryRepository.insertHistory(
        {
          id: createId("hist"),
          productId: product.id,
          cellId: fromCell.id,
          movementId: movement.id,
          previousQuantity: fromPrevious,
          newQuantity: fromNew,
          changeQuantity: -quantity,
          changedBy: actor.id,
          createdAt
        },
        db
      );

      await this.inventoryRepository.insertHistory(
        {
          id: createId("hist"),
          productId: product.id,
          cellId: toCell.id,
          movementId: movement.id,
          previousQuantity: toPrevious,
          newQuantity: toNew,
          changeQuantity: quantity,
          changedBy: actor.id,
          createdAt
        },
        db
      );

      await this.auditLogRepository.log(
        {
          id: createId("ulog"),
          userId: actor.id,
          actionType: "move",
          entityType: "inventory",
          entityId: fromInventory.id,
          oldValue: {
            fromCellId: fromCell.id,
            fromQuantity: fromPrevious,
            toCellId: toCell.id,
            toQuantity: toPrevious
          },
          newValue: {
            fromCellId: fromCell.id,
            fromQuantity: fromNew,
            toCellId: toCell.id,
            toQuantity: toNew
          },
          createdAt
        },
        db
      );

      return this.getOperationResult(product.id, movement);
    });
  }

  async audit(payload) {
    return withTransaction(this.pool, async (db) => {
      const actor = await this.requireUser(payload.actorId);
      const product = await this.requireProduct(payload.productId);
      const cell = await this.requireCellById(payload.locationId, db);
      const actualQty = this.requireNonNegativeQuantity(payload.actualQty);
      const inventoryRow =
        (await this.inventoryRepository.getInventoryRowForUpdate(product.id, cell.id, db)) ||
        (await this.inventoryRepository.createInventoryRow(product.id, cell.id, db));

      const expectedQty = Number(inventoryRow.quantity || 0);
      const diffQty = actualQty - expectedQty;
      await this.inventoryRepository.updateInventoryQuantity(inventoryRow.id, actualQty, db);

      const createdAt = nowIso();
      const movement = {
        id: createId("move"),
        type: "audit",
        productId: product.id,
        quantity: Math.abs(diffQty),
        fromCellId: cell.id,
        toCellId: cell.id,
        performedBy: actor.id,
        comment: payload.comment || "",
        metadata: {
          expectedQty,
          actualQty,
          diffQty
        },
        createdAt
      };

      await this.inventoryRepository.insertMovement(movement, db);
      await this.inventoryRepository.insertHistory(
        {
          id: createId("hist"),
          productId: product.id,
          cellId: cell.id,
          movementId: movement.id,
          previousQuantity: expectedQty,
          newQuantity: actualQty,
          changeQuantity: diffQty,
          changedBy: actor.id,
          createdAt
        },
        db
      );

      await this.inventoryRepository.insertRevision(
        {
          id: createId("rev"),
          movementId: movement.id,
          cellId: cell.id,
          expectedQty,
          actualQty,
          diffQty,
          status: diffQty === 0 ? "match" : "mismatch",
          checkedBy: actor.id,
          createdAt
        },
        db
      );

      await this.auditLogRepository.log(
        {
          id: createId("ulog"),
          userId: actor.id,
          actionType: "audit",
          entityType: "inventory",
          entityId: inventoryRow.id,
          oldValue: { quantity: expectedQty },
          newValue: { quantity: actualQty, diffQty, cellId: cell.id },
          createdAt
        },
        db
      );

      if (diffQty !== 0) {
        await this.notificationRepository.create(
          {
            id: createId("notif"),
            type: "audit_error",
            severity: "warning",
            productId: product.id,
            warehouseId: cell.warehouseId,
            cellId: cell.id,
            message: `Ошибка ревизии по ${product.name}: ожидалось ${expectedQty}, факт ${actualQty}`,
            payload: {
              expectedQty,
              actualQty,
              diffQty
            },
            createdAt
          },
          db
        );
      }

      await this.createLowStockNotificationIfNeeded(product.id, db);
      return {
        audit: {
          expectedQty,
          actualQty,
          diffQty
        },
        operation: await this.getOperationResult(product.id, movement)
      };
    });
  }

  async getOperationResult(productId, movement) {
    const productCard = await this.getProductById(productId);
    return {
      ...movement,
      product: productCard.product,
      fromLocation: productCard.locations.find((item) => item.locationId === movement.fromCellId) || null,
      toLocation: productCard.locations.find((item) => item.locationId === movement.toCellId) || null
    };
  }

  async requireUser(userId) {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new HttpError(404, "User not found");
    }
    return user;
  }

  async requireProduct(productId) {
    const card = await this.catalogRepository.getProductCard(productId);
    if (!card) {
      throw new HttpError(404, "Product not found");
    }
    return card.product;
  }

  async requireCellById(cellId, db) {
    const result = await db.query(
      `
        SELECT
          c.id,
          c.full_code AS "fullCode",
          r.warehouse_id AS "warehouseId"
        FROM cells c
        JOIN shelves s ON s.id = c.shelf_id
        JOIN racks r ON r.id = s.rack_id
        WHERE c.id = $1
        LIMIT 1
      `,
      [cellId]
    );

    const cell = result.rows[0];
    if (!cell) {
      throw new HttpError(404, "Location not found");
    }

    return cell;
  }

  requirePositiveQuantity(value) {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new HttpError(400, "Quantity must be greater than zero");
    }
    return qty;
  }

  requireNonNegativeQuantity(value) {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new HttpError(400, "Quantity must be zero or greater");
    }
    return qty;
  }

  async createLowStockNotificationIfNeeded(productId, db) {
    const rows = await this.inventoryRepository.getLowStock(productId);
    if (!rows.length) {
      return;
    }

    const item = rows[0];
    await this.notificationRepository.create(
      {
        id: createId("notif"),
        type: "low_stock",
        severity: "warning",
        productId,
        warehouseId: null,
        cellId: null,
        message: `Минимальный остаток: ${item.name}, осталось ${item.totalQuantity} ${item.unit}`,
        payload: {
          totalQuantity: item.totalQuantity,
          minStock: item.minStock
        },
        createdAt: nowIso()
      },
      db
    );
  }
}
