export class AuthRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findUserByPhone(phone) {
    const result = await this.pool.query(
      `
        SELECT
          u.id,
          u.phone,
          u.full_name AS "fullName",
          u.telegram_id AS "telegramId",
          u.telegram_username AS "telegramUsername",
          u.is_active AS "isActive",
          r.code AS role,
          r.name AS "roleName",
          r.permissions AS permissions
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.phone = $1 AND u.is_active = TRUE
        LIMIT 1
      `,
      [phone]
    );

    return result.rows[0] || null;
  }

  async updateTelegramBinding(userId, telegramUserId, telegramUsername) {
    const result = await this.pool.query(
      `
        UPDATE users
        SET telegram_id = $2,
            telegram_username = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          phone,
          full_name AS "fullName",
          telegram_id AS "telegramId",
          telegram_username AS "telegramUsername",
          is_active AS "isActive"
      `,
      [userId, telegramUserId, telegramUsername || null]
    );

    return result.rows[0] || null;
  }

  async findUserByTelegramId(telegramId) {
    const result = await this.pool.query(
      `
        SELECT
          u.id,
          u.phone,
          u.full_name AS "fullName",
          u.telegram_id AS "telegramId",
          u.telegram_username AS "telegramUsername",
          u.is_active AS "isActive",
          r.code AS role,
          r.name AS "roleName",
          r.permissions AS permissions
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.telegram_id = $1
        LIMIT 1
      `,
      [telegramId]
    );

    return result.rows[0] || null;
  }

  async findUserById(userId) {
    const result = await this.pool.query(
      `
        SELECT
          u.id,
          u.phone,
          u.full_name AS "fullName",
          u.telegram_id AS "telegramId",
          u.telegram_username AS "telegramUsername",
          u.is_active AS "isActive",
          r.code AS role,
          r.name AS "roleName",
          r.permissions AS permissions
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1
        LIMIT 1
      `,
      [userId]
    );

    return result.rows[0] || null;
  }

  async listUsers() {
    const result = await this.pool.query(
      `
        SELECT
          u.id,
          u.phone,
          u.full_name AS "fullName",
          u.telegram_id AS "telegramId",
          u.telegram_username AS "telegramUsername",
          u.is_active AS "isActive",
          r.code AS role,
          r.name AS "roleName",
          r.permissions AS permissions
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = TRUE
        ORDER BY u.full_name ASC
      `
    );

    return result.rows;
  }

  async findPreferredBotUser() {
    const result = await this.pool.query(
      `
        SELECT
          u.id,
          u.phone,
          u.full_name AS "fullName",
          u.telegram_id AS "telegramId",
          u.telegram_username AS "telegramUsername",
          u.is_active AS "isActive",
          r.code AS role,
          r.name AS "roleName",
          r.permissions AS permissions
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = TRUE
        ORDER BY
          CASE r.code
            WHEN 'admin' THEN 1
            WHEN 'supervisor' THEN 2
            WHEN 'keeper' THEN 3
            WHEN 'auditor' THEN 4
            ELSE 5
          END,
          u.full_name ASC
        LIMIT 1
      `
    );

    return result.rows[0] || null;
  }

  async countActiveUsers() {
    const result = await this.pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM users
        WHERE is_active = TRUE
      `
    );

    return Number(result.rows[0]?.total || 0);
  }

  async createTelegramUser({
    id,
    phone,
    fullName,
    roleId,
    telegramId,
    telegramUsername
  }) {
    const result = await this.pool.query(
      `
        INSERT INTO users (
          id,
          phone,
          full_name,
          role_id,
          telegram_id,
          telegram_username,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING
          id,
          phone,
          full_name AS "fullName",
          telegram_id AS "telegramId",
          telegram_username AS "telegramUsername",
          is_active AS "isActive"
      `,
      [id, phone, fullName, roleId, telegramId, telegramUsername || null]
    );

    return result.rows[0] || null;
  }
}
