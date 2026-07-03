export class NotificationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(notification, db = this.pool) {
    await db.query(
      `
        INSERT INTO notifications (
          id, type, severity, product_id, warehouse_id, cell_id, message, payload, is_read, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      `,
      [
        notification.id,
        notification.type,
        notification.severity,
        notification.productId || null,
        notification.warehouseId || null,
        notification.cellId || null,
        notification.message,
        JSON.stringify(notification.payload || {}),
        Boolean(notification.isRead),
        notification.createdAt
      ]
    );
  }

  async listRecent(limit = 20) {
    const result = await this.pool.query(
      `
        SELECT
          id,
          type,
          severity,
          product_id AS "productId",
          warehouse_id AS "warehouseId",
          cell_id AS "cellId",
          message,
          payload,
          is_read AS "isRead",
          created_at AS "createdAt"
        FROM notifications
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows;
  }
}
