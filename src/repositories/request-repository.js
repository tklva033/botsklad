export class RequestRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(request, db = this.pool) {
    await db.query(
      `
        INSERT INTO issue_requests (
          id, product_id, requested_qty, preferred_cell_id, requested_by, approved_by, fulfilled_issue_id,
          priority, status, comment, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      [
        request.id,
        request.productId,
        request.requestedQty,
        request.preferredCellId || null,
        request.requestedBy || null,
        request.approvedBy || null,
        request.fulfilledIssueId || null,
        request.priority,
        request.status,
        request.comment || "",
        request.createdAt,
        request.updatedAt
      ]
    );
  }

  async list(filters = {}) {
    const clauses = [];
    const params = [];
    let index = 1;

    if (filters.status) {
      clauses.push(`ir.status = $${index++}`);
      params.push(filters.status);
    }

    if (filters.requestedBy) {
      clauses.push(`ir.requested_by = $${index++}`);
      params.push(filters.requestedBy);
    }

    if (filters.approvedBy) {
      clauses.push(`ir.approved_by = $${index++}`);
      params.push(filters.approvedBy);
    }

    if (filters.productId) {
      clauses.push(`ir.product_id = $${index++}`);
      params.push(filters.productId);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.pool.query(
      `
        SELECT
          ir.id,
          ir.product_id AS "productId",
          ir.requested_qty AS "requestedQty",
          ir.preferred_cell_id AS "preferredCellId",
          ir.requested_by AS "requestedBy",
          ir.approved_by AS "approvedBy",
          ir.fulfilled_issue_id AS "fulfilledIssueId",
          ir.priority,
          ir.status,
          ir.comment,
          ir.created_at AS "createdAt",
          ir.updated_at AS "updatedAt",
          p.name AS "productName",
          p.sku AS "productSku",
          c.full_code AS "preferredCellCode",
          ru.full_name AS "requestedByName",
          au.full_name AS "approvedByName"
        FROM issue_requests ir
        JOIN products p ON p.id = ir.product_id
        LEFT JOIN cells c ON c.id = ir.preferred_cell_id
        LEFT JOIN users ru ON ru.id = ir.requested_by
        LEFT JOIN users au ON au.id = ir.approved_by
        ${whereSql}
        ORDER BY ir.created_at DESC
      `,
      params
    );

    return result.rows;
  }

  async findById(id, db = this.pool) {
    const result = await db.query(
      `
        SELECT
          ir.id,
          ir.product_id AS "productId",
          ir.requested_qty AS "requestedQty",
          ir.preferred_cell_id AS "preferredCellId",
          ir.requested_by AS "requestedBy",
          ir.approved_by AS "approvedBy",
          ir.fulfilled_issue_id AS "fulfilledIssueId",
          ir.priority,
          ir.status,
          ir.comment,
          ir.created_at AS "createdAt",
          ir.updated_at AS "updatedAt",
          p.name AS "productName",
          p.sku AS "productSku",
          p.unit,
          c.full_code AS "preferredCellCode",
          ru.full_name AS "requestedByName",
          au.full_name AS "approvedByName"
        FROM issue_requests ir
        JOIN products p ON p.id = ir.product_id
        LEFT JOIN cells c ON c.id = ir.preferred_cell_id
        LEFT JOIN users ru ON ru.id = ir.requested_by
        LEFT JOIN users au ON au.id = ir.approved_by
        WHERE ir.id = $1
        LIMIT 1
      `,
      [id]
    );

    return result.rows[0] || null;
  }

  async updateStatus({ id, status, approvedBy = null, fulfilledIssueId = null }, db = this.pool) {
    const result = await db.query(
      `
        UPDATE issue_requests
        SET status = $2,
            approved_by = COALESCE($3, approved_by),
            fulfilled_issue_id = COALESCE($4, fulfilled_issue_id),
            updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          product_id AS "productId",
          requested_qty AS "requestedQty",
          preferred_cell_id AS "preferredCellId",
          requested_by AS "requestedBy",
          approved_by AS "approvedBy",
          fulfilled_issue_id AS "fulfilledIssueId",
          priority,
          status,
          comment,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [id, status, approvedBy, fulfilledIssueId]
    );

    return result.rows[0] || null;
  }
}
