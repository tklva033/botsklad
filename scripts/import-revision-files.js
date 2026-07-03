import { initDatabase } from "../database/init-db.js";
import { ensureEmbeddedPostgres, stopEmbeddedPostgres } from "../src/database/embedded-postgres.js";
import { closeDbPool, createDbPool } from "../src/database/postgres.js";
import { AuditLogRepository } from "../src/repositories/audit-log-repository.js";
import { ImportExportService } from "../src/services/import-export-service.js";

const defaultFiles = [
  "C:/Users/User/Downloads/1.xlsx",
  "C:/Users/User/Downloads/2.xlsx",
  "C:/Users/User/Downloads/3.xlsx",
  "C:/Users/User/Downloads/4.xlsx",
  "C:/Users/User/Downloads/5.xlsx",
  "C:/Users/User/Downloads/6.xlsx",
  "C:/Users/User/Downloads/7.xlsx",
  "C:/Users/User/Downloads/8.xlsx",
  "C:/Users/User/Downloads/9.xlsx",
  "C:/Users/User/Downloads/10.xlsx",
  "C:/Users/User/Downloads/11.xlsx"
];

async function main() {
  await ensureEmbeddedPostgres();
  await initDatabase();
  const pool = createDbPool();
  const importExportService = new ImportExportService({
    pool,
    auditLogRepository: new AuditLogRepository(pool)
  });

  try {
    const result = await importExportService.importRevisionWorkbooksFromFiles({
      filePaths: process.argv.slice(2).length ? process.argv.slice(2) : defaultFiles,
      actorId: null
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDbPool(pool);
    await stopEmbeddedPostgres();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
