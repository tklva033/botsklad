export class AuditLogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async log(entry, db = this.pool) {
    await db.query(
      `
        INSERT INTO user_action_logs (
          id, user_id, action_type, entity_type, entity_id, old_value, new_value, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      `,
      [
        entry.id,
        entry.userId || null,
        entry.actionType,
        entry.entityType,
        entry.entityId || null,
        entry.oldValue ? JSON.stringify(entry.oldValue) : null,
        entry.newValue ? JSON.stringify(entry.newValue) : null,
        entry.createdAt
      ]
    );
  }
}
