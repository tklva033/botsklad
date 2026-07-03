import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureEmbeddedPostgres } from "../src/database/embedded-postgres.js";
import { createDbPool, closeDbPool } from "../src/database/postgres.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export async function initDatabase() {
  await ensureEmbeddedPostgres();
  const schemaPath = path.join(currentDir, "schema.sql");
  const sql = await fs.readFile(schemaPath, "utf8");
  const pool = createDbPool();

  try {
    await pool.query(sql);
    console.log("PostgreSQL schema initialized successfully.");
  } finally {
    await closeDbPool(pool);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await initDatabase();
}
