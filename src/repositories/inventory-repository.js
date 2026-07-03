import { createId } from "../utils/ids.js";

export class InventoryRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getStats() {
    const [productsResult, qtyResult, todayResult, mismatchResult] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int AS count FROM products WHERE is_active = TRUE`),
      this.pool.query(`SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory`),
      this.pool.query(
        `
          SELECT
            COALESCE(SUM(CASE WHEN movement_type = 'receipt' AND DATE(created_at) = CURRENT_DATE THEN quantity END), 0) AS "receiptsToday",
            COALESCE(SUM(CASE WHEN movement_type = 'issue' AND DATE(created_at) = CURRENT_DATE THEN quantity END), 0) AS "issuesToday"
          FROM stock_movements
        `
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS count FROM revisions WHERE diff_qty <> 0`
      )
    ]);

    return {
      totalProducts: productsResult.rows[0].count,
      totalQuantity: Number(qtyResult.rows[0].total || 0),
      receiptsToday: Number(todayResult.rows[0].receiptsToday || 0),
      issuesToday: Number(todayResult.rows[0].issuesToday || 0),
      mismatches: mismatchResult.rows[0].count
    };
  }

  async getInventorySummary(productId, db = this.pool) {
    const result = await db.query(
      `
        SELECT COALESCE(SUM(quantity), 0) AS total
        FROM inventory
        WHERE product_id = $1
      `,
      [productId]
    );

    return Number(result.rows[0].total || 0);
  }

  async getLowStock(productId = null, db = this.pool) {
    const result = await db.query(
      `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.unit,
          p.min_stock AS "minStock",
          COALESCE(SUM(i.quantity), 0) AS "totalQuantity"
        FROM products p
        LEFT JOIN inventory i ON i.product_id = p.id
        WHERE p.is_active = TRUE
          AND ($1::text IS NULL OR p.id = $1)
        GROUP BY p.id
        HAVING COALESCE(SUM(i.quantity), 0) <= p.min_stock
        ORDER BY p.name
      `,
      [productId]
    );

    return result.rows.map((row) => ({
      ...row,
      totalQuantity: Number(row.totalQuantity || 0),
      minStock: Number(row.minStock || 0)
    }));
  }

  async getProductBySkuOrQr(identifier, db = this.pool) {
    const result = await db.query(
      `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.qr_code AS "qrCode",
          p.barcode,
          p.unit,
          p.min_stock AS "minStock",
          p.photo_url AS "photoUrl"
        FROM products p
        WHERE p.sku = $1 OR p.qr_code = $1 OR p.barcode = $1
        LIMIT 1
      `,
      [identifier]
    );

    return result.rows[0] || null;
  }

  async getCellByFullCode(fullCode, db = this.pool) {
    const result = await db.query(
      `
        SELECT
          c.id,
          c.full_code AS "fullCode",
          r.warehouse_id AS "warehouseId"
        FROM cells c
        JOIN shelves s ON s.id = c.shelf_id
        JOIN racks r ON r.id = s.rack_id
        WHERE c.full_code = $1
        LIMIT 1
      `,
      [fullCode]
    );

    return result.rows[0] || null;
  }

  async getInventoryRowForUpdate(productId, cellId, db) {
    const result = await db.query(
      `
        SELECT id, product_id AS "productId", cell_id AS "cellId", quantity
        FROM inventory
        WHERE product_id = $1 AND cell_id = $2
        FOR UPDATE
      `,
      [productId, cellId]
    );

    return result.rows[0] || null;
  }

  async createInventoryRow(productId, cellId, db) {
    const row = {
      id: createId("inv"),
      productId,
      cellId,
      quantity: 0
    };

    await db.query(
      `
        INSERT INTO inventory (id, product_id, cell_id, quantity, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
      `,
      [row.id, row.productId, row.cellId, row.quantity]
    );

    return row;
  }

  async updateInventoryQuantity(inventoryId, quantity, db) {
    await db.query(
      `
        UPDATE inventory
        SET quantity = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [inventoryId, quantity]
    );
  }

  async insertMovement(movement, db) {
    await db.query(
      `
        INSERT INTO stock_movements (
          id, movement_type, product_id, quantity, from_cell_id, to_cell_id, performed_by, comment, reference_code, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
      `,
      [
        movement.id,
        movement.type,
        movement.productId,
        movement.quantity,
        movement.fromCellId || null,
        movement.toCellId || null,
        movement.performedBy || null,
        movement.comment || "",
        movement.referenceCode || null,
        JSON.stringify(movement.metadata || {}),
        movement.createdAt
      ]
    );
  }

  async insertHistory(history, db) {
    await db.query(
      `
        INSERT INTO inventory_history (
          id, product_id, cell_id, movement_id, previous_quantity, new_quantity, change_quantity, changed_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        history.id,
        history.productId,
        history.cellId,
        history.movementId || null,
        history.previousQuantity,
        history.newQuantity,
        history.changeQuantity,
        history.changedBy || null,
        history.createdAt
      ]
    );
  }

  async insertReceipt(receipt, db) {
    await db.query(
      `
        INSERT INTO receipts (
          id, movement_id, supplier_id, warehouse_id, document_number, received_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        receipt.id,
        receipt.movementId,
        receipt.supplierId || null,
        receipt.warehouseId || null,
        receipt.documentNumber || null,
        receipt.receivedAt,
        receipt.createdAt
      ]
    );
  }

  async insertIssue(issue, db) {
    await db.query(
      `
        INSERT INTO issues (
          id, movement_id, issued_to, request_number, issued_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        issue.id,
        issue.movementId,
        issue.issuedTo || "",
        issue.requestNumber || null,
        issue.issuedAt,
        issue.createdAt
      ]
    );
  }

  async insertRevision(revision, db) {
    await db.query(
      `
        INSERT INTO revisions (
          id, movement_id, cell_id, expected_qty, actual_qty, diff_qty, status, checked_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        revision.id,
        revision.movementId,
        revision.cellId,
        revision.expectedQty,
        revision.actualQty,
        revision.diffQty,
        revision.status,
        revision.checkedBy || null,
        revision.createdAt
      ]
    );
  }
}
