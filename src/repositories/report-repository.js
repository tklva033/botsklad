export class ReportRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getSummary(filters = {}) {
    const scope = buildMovementScope(filters);
    const result = await this.pool.query(
      `
        WITH scoped AS (
          SELECT sm.*
          FROM stock_movements
          ${scope.fromClause}
          ${scope.whereClause}
        )
        SELECT json_build_object(
          'receipts', COALESCE(SUM(CASE WHEN movement_type = 'receipt' THEN quantity END), 0),
          'issues', COALESCE(SUM(CASE WHEN movement_type = 'issue' THEN quantity END), 0),
          'moves', COALESCE(SUM(CASE WHEN movement_type = 'move' THEN quantity END), 0),
          'audits', COALESCE(COUNT(*) FILTER (WHERE movement_type = 'audit'), 0),
          'uniqueProducts', COALESCE(COUNT(DISTINCT product_id), 0),
          'activeEmployees', COALESCE(COUNT(DISTINCT performed_by), 0)
        ) AS summary
        FROM scoped
      `,
      scope.params
    );

    return result.rows[0]?.summary || {};
  }

  async getTopProducts(filters = {}, limit = 10) {
    const scope = buildMovementScope(filters);
    const result = await this.pool.query(
      `
        SELECT
          p.id,
          p.name,
          p.sku,
          COALESCE(SUM(sm.quantity), 0) AS total
        ${scope.fromClause}
        JOIN products p ON p.id = sm.product_id
        ${scope.whereWithExtra(`sm.movement_type IN ('issue', 'receipt')`)}
        GROUP BY p.id
        ORDER BY total DESC
        LIMIT $${scope.params.length + 1}
      `,
      [...scope.params, limit]
    );

    return result.rows.map((row) => ({ ...row, total: Number(row.total || 0) }));
  }

  async getUserActivity(filters = {}) {
    const scope = buildActionScope(filters);
    const result = await this.pool.query(
      `
        SELECT
          u.id,
          u.full_name AS "fullName",
          COUNT(ual.id)::int AS actions
        FROM users u
        LEFT JOIN user_action_logs ual
          ON ual.user_id = u.id
         ${scope.onClause}
        GROUP BY u.id
        ORDER BY actions DESC, u.full_name ASC
      `,
      scope.params
    );

    return result.rows;
  }

  async getLowStockDetailed(filters = {}) {
    const clauses = [`p.is_active = TRUE`];
    const params = [];
    let index = 1;

    if (filters.warehouseId) {
      clauses.push(`w.id = $${index++}`);
      params.push(filters.warehouseId);
    }

    const result = await this.pool.query(
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
        LEFT JOIN cells c ON c.id = i.cell_id
        LEFT JOIN shelves s ON s.id = c.shelf_id
        LEFT JOIN racks r ON r.id = s.rack_id
        LEFT JOIN warehouses w ON w.id = r.warehouse_id
        WHERE ${clauses.join(" AND ")}
        GROUP BY p.id
        HAVING COALESCE(SUM(i.quantity), 0) <= p.min_stock
        ORDER BY "totalQuantity" ASC
      `,
      params
    );

    return result.rows.map((row) => ({
      ...row,
      minStock: Number(row.minStock || 0),
      totalQuantity: Number(row.totalQuantity || 0)
    }));
  }

  async getMovementTimeline(filters = {}) {
    const scope = buildMovementScope(filters);
    const result = await this.pool.query(
      `
        SELECT
          DATE(sm.created_at) AS day,
          sm.movement_type AS type,
          COALESCE(SUM(sm.quantity), 0) AS total
        ${scope.fromClause}
        ${scope.whereClause}
        GROUP BY DATE(sm.created_at), sm.movement_type
        ORDER BY day ASC, type ASC
      `,
      scope.params
    );

    return result.rows.map((row) => ({ ...row, total: Number(row.total || 0) }));
  }

  async getWarehouseSnapshot(filters = {}) {
    const clauses = [];
    const params = [];
    let index = 1;

    if (filters.warehouseId) {
      clauses.push(`w.id = $${index++}`);
      params.push(filters.warehouseId);
    }

    const result = await this.pool.query(
      `
        SELECT
          w.id,
          w.name,
          w.code,
          COUNT(DISTINCT i.product_id)::int AS "productCount",
          COALESCE(SUM(i.quantity), 0) AS "totalQuantity"
        FROM warehouses w
        LEFT JOIN racks r ON r.warehouse_id = w.id
        LEFT JOIN shelves s ON s.rack_id = r.id
        LEFT JOIN cells c ON c.shelf_id = s.id
        LEFT JOIN inventory i ON i.cell_id = c.id
        ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        GROUP BY w.id
        ORDER BY w.name ASC
      `,
      params
    );

    return result.rows.map((row) => ({
      ...row,
      productCount: Number(row.productCount || 0),
      totalQuantity: Number(row.totalQuantity || 0)
    }));
  }

  async getCategoryTurnover(filters = {}) {
    const scope = buildMovementScope(filters);
    const result = await this.pool.query(
      `
        SELECT
          COALESCE(cat.name, 'Без категории') AS name,
          COALESCE(SUM(CASE WHEN sm.movement_type = 'receipt' THEN sm.quantity END), 0) AS receipts,
          COALESCE(SUM(CASE WHEN sm.movement_type = 'issue' THEN sm.quantity END), 0) AS issues
        ${scope.fromClause}
        JOIN products p ON p.id = sm.product_id
        LEFT JOIN categories cat ON cat.id = p.category_id
        ${scope.whereWithExtra(`sm.movement_type IN ('issue', 'receipt')`)}
        GROUP BY cat.name
        ORDER BY issues DESC, receipts DESC, name ASC
      `,
      scope.params
    );

    return result.rows.map((row) => ({
      ...row,
      receipts: Number(row.receipts || 0),
      issues: Number(row.issues || 0)
    }));
  }

  async getRequestSummary(filters = {}) {
    const clauses = [];
    const params = [];
    let index = 1;

    if (filters.dateFrom) {
      clauses.push(`ir.created_at >= $${index++}`);
      params.push(filters.dateFrom);
    } else {
      clauses.push(`ir.created_at >= NOW() - ($${index++} || ' days')::interval`);
      params.push(Number(filters.periodDays || 30));
    }

    if (filters.dateTo) {
      clauses.push(`ir.created_at <= $${index++}`);
      params.push(filters.dateTo);
    }

    if (filters.employeeId) {
      clauses.push(`(ir.requested_by = $${index} OR ir.approved_by = $${index})`);
      params.push(filters.employeeId);
      index += 1;
    }

    if (filters.warehouseId) {
      clauses.push(`r.warehouse_id = $${index++}`);
      params.push(filters.warehouseId);
    }

    const result = await this.pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE ir.status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE ir.status = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE ir.status = 'fulfilled')::int AS fulfilled,
          COUNT(*) FILTER (WHERE ir.status = 'rejected')::int AS rejected
        FROM issue_requests ir
        LEFT JOIN cells c ON c.id = ir.preferred_cell_id
        LEFT JOIN shelves s ON s.id = c.shelf_id
        LEFT JOIN racks r ON r.id = s.rack_id
        WHERE ${clauses.join(" AND ")}
      `,
      params
    );

    return result.rows[0] || {
      pending: 0,
      approved: 0,
      fulfilled: 0,
      rejected: 0
    };
  }
}

function buildMovementScope(filters = {}) {
  const clauses = [];
  const params = [];
  let index = 1;

  if (filters.dateFrom) {
    clauses.push(`sm.created_at >= $${index++}`);
    params.push(filters.dateFrom);
  } else {
    clauses.push(`sm.created_at >= NOW() - ($${index++} || ' days')::interval`);
    params.push(Number(filters.periodDays || 30));
  }

  if (filters.dateTo) {
    clauses.push(`sm.created_at <= $${index++}`);
    params.push(filters.dateTo);
  }

  if (filters.employeeId) {
    clauses.push(`sm.performed_by = $${index++}`);
    params.push(filters.employeeId);
  }

  if (filters.warehouseId) {
    clauses.push(`(rf.warehouse_id = $${index} OR rt.warehouse_id = $${index})`);
    params.push(filters.warehouseId);
    index += 1;
  }

  const fromClause = `
    FROM stock_movements sm
    LEFT JOIN cells cf ON cf.id = sm.from_cell_id
    LEFT JOIN shelves sf ON sf.id = cf.shelf_id
    LEFT JOIN racks rf ON rf.id = sf.rack_id
    LEFT JOIN cells ct ON ct.id = sm.to_cell_id
    LEFT JOIN shelves st ON st.id = ct.shelf_id
    LEFT JOIN racks rt ON rt.id = st.rack_id
  `;

  return {
    fromClause,
    whereClause: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    whereWithExtra(extra) {
      const all = [...clauses, extra];
      return `WHERE ${all.join(" AND ")}`;
    }
  };
}

function buildActionScope(filters = {}) {
  const clauses = [];
  const params = [];
  let index = 1;

  if (filters.dateFrom) {
    clauses.push(`ual.created_at >= $${index++}`);
    params.push(filters.dateFrom);
  } else {
    clauses.push(`ual.created_at >= NOW() - ($${index++} || ' days')::interval`);
    params.push(Number(filters.periodDays || 30));
  }

  if (filters.dateTo) {
    clauses.push(`ual.created_at <= $${index++}`);
    params.push(filters.dateTo);
  }

  if (filters.employeeId) {
    clauses.push(`ual.user_id = $${index++}`);
    params.push(filters.employeeId);
  }

  return {
    onClause: clauses.length ? `AND ${clauses.join(" AND ")}` : "",
    params
  };
}
