import { Pool } from "pg";
import { loadEnv } from "../utils/env.js";

loadEnv();

export function createDbPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  const sslEnabled = String(process.env.DB_SSL || "false").toLowerCase() === "true";
  return new Pool({
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DB_MAX_CONNECTIONS || 10)
  });
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDbPool(pool) {
  await pool.end();
}
