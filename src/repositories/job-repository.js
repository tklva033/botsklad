export class JobRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async enqueue(job, db = this.pool) {
    await db.query(
      `
        INSERT INTO background_jobs (
          id, job_type, payload, status, attempts, run_at, last_error, created_at, updated_at
        ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)
      `,
      [
        job.id,
        job.jobType,
        JSON.stringify(job.payload || {}),
        job.status || "pending",
        job.attempts || 0,
        job.runAt,
        job.lastError || null,
        job.createdAt,
        job.updatedAt
      ]
    );
  }

  async claimPending(limit = 10, db = this.pool) {
    const result = await db.query(
      `
        UPDATE background_jobs
        SET status = 'processing',
            updated_at = NOW(),
            attempts = attempts + 1
        WHERE id IN (
          SELECT id
          FROM background_jobs
          WHERE status = 'pending' AND run_at <= NOW()
          ORDER BY run_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING
          id,
          job_type AS "jobType",
          payload,
          status,
          attempts,
          run_at AS "runAt",
          last_error AS "lastError",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [limit]
    );

    return result.rows;
  }

  async markDone(id, db = this.pool) {
    await db.query(
      `UPDATE background_jobs SET status = 'done', updated_at = NOW(), last_error = NULL WHERE id = $1`,
      [id]
    );
  }

  async markFailed(id, message, db = this.pool) {
    await db.query(
      `UPDATE background_jobs SET status = 'failed', updated_at = NOW(), last_error = $2 WHERE id = $1`,
      [id, message]
    );
  }
}
