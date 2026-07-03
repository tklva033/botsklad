import { normalizeText } from "../utils/text.js";

export class CatalogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async searchProducts(query = "") {
    const q = normalizeText(query);
    const likeValue = `%${q}%`;

    const result = await this.pool.query(
      `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.qr_code AS "qrCode",
          p.barcode,
          p.unit,
          p.min_stock AS "minStock",
          COALESCE(pp.file_path, p.photo_url) AS "photoUrl",
          p.is_active AS "isActive",
          c.name AS category,
          s.name AS supplier
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        LEFT JOIN product_photos pp ON pp.product_id = p.id AND pp.is_primary = TRUE
        WHERE p.is_active = TRUE
          AND (
            $1 = ''
            OR LOWER(p.name) LIKE $2
            OR LOWER(p.sku) LIKE $2
            OR LOWER(COALESCE(p.qr_code, '')) LIKE $2
            OR LOWER(COALESCE(p.barcode, '')) LIKE $2
            OR LOWER(COALESCE(c.name, '')) LIKE $2
          )
        ORDER BY p.name
      `,
      [q, likeValue]
    );

    return result.rows;
  }

  async listProducts(limit = 20, offset = 0) {
    const result = await this.pool.query(
      `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.unit,
          COALESCE(SUM(i.quantity), 0) AS "totalQuantity"
        FROM products
        p
        LEFT JOIN inventory i ON i.product_id = p.id
        WHERE p.is_active = TRUE
        GROUP BY p.id
        ORDER BY
          CASE
            WHEN LEFT(p.name, 1) BETWEEN CHR(1040) AND CHR(1103) THEN 0
            WHEN LEFT(p.name, 1) IN (CHR(1025), CHR(1105)) THEN 0
            WHEN p.name ~ '^[0-9]' THEN 1
            ELSE 2
          END,
          p.name
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    return result.rows.map((row) => ({
      ...row,
      totalQuantity: Number(row.totalQuantity || 0)
    }));
  }

  async listCells() {
    const result = await this.pool.query(
      `
        SELECT
          c.id,
          c.full_code AS "fullCode"
        FROM cells c
        ORDER BY c.full_code
      `
    );

    return result.rows;
  }

  async listWarehouses() {
    const result = await this.pool.query(
      `
        SELECT
          id,
          name,
          code
        FROM warehouses
        ORDER BY name ASC
      `
    );

    return result.rows;
  }

  async getProductCard(productId) {
    const result = await this.pool.query(
      `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.qr_code AS "qrCode",
          p.barcode,
          p.unit,
          p.min_stock AS "minStock",
          COALESCE(pp.file_path, p.photo_url) AS "photoUrl",
          p.is_active AS "isActive",
          c.name AS category,
          s.name AS supplier
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        LEFT JOIN product_photos pp ON pp.product_id = p.id AND pp.is_primary = TRUE
        WHERE p.id = $1
        LIMIT 1
      `,
      [productId]
    );

    const product = result.rows[0];
    if (!product) {
      return null;
    }

    const inventory = await this.pool.query(
      `
        SELECT
          i.id,
          i.quantity,
          w.name AS warehouse,
          r.code AS rack,
          s.code AS shelf,
          c.code AS cell,
          c.full_code AS "fullCode",
          c.id AS "cellId"
        FROM inventory i
        JOIN cells c ON c.id = i.cell_id
        JOIN shelves s ON s.id = c.shelf_id
        JOIN racks r ON r.id = s.rack_id
        JOIN warehouses w ON w.id = r.warehouse_id
        WHERE i.product_id = $1
        ORDER BY c.full_code
      `,
      [productId]
    );

    const lastDates = await this.pool.query(
      `
        SELECT
          MAX(CASE WHEN movement_type = 'receipt' THEN created_at END) AS "lastReceiptAt",
          MAX(CASE WHEN movement_type = 'issue' THEN created_at END) AS "lastIssueAt"
        FROM stock_movements
        WHERE product_id = $1
      `,
      [productId]
    );

    return {
      product,
      inventory: inventory.rows,
      lastReceiptAt: lastDates.rows[0]?.lastReceiptAt || null,
      lastIssueAt: lastDates.rows[0]?.lastIssueAt || null
    };
  }

  async getHistory(productId, limit = 20) {
    const result = await this.pool.query(
      `
        SELECT
          sm.id,
          sm.movement_type AS type,
          sm.quantity,
          sm.comment,
          sm.created_at AS "createdAt",
          sm.metadata,
          u.full_name AS "actorName",
          fc.full_code AS "fromCode",
          tc.full_code AS "toCode"
        FROM stock_movements sm
        LEFT JOIN users u ON u.id = sm.performed_by
        LEFT JOIN cells fc ON fc.id = sm.from_cell_id
        LEFT JOIN cells tc ON tc.id = sm.to_cell_id
        WHERE sm.product_id = $1
        ORDER BY sm.created_at DESC
        LIMIT $2
      `,
      [productId, limit]
    );

    return result.rows;
  }
}
